import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  DEFAULT_SLOTS, STATUSES, normalizeContent, qualityChecks, computeScore, missingAnswers, rankMap, sameName,
} from '../public/js/shared.js';
import { registerJp } from './jp.js';
import { normalizePlanning } from '../public/js/planning-shared.js';
import { registerPlanning } from './planning.js';
import { registerExtras } from './extras.js';
import { registerAccueil } from './accueil.js';
import { registerBenevoles } from './benevoles.js';
import { registerBanque } from './banque.js';
import { registerProgression } from './progression.js';
import { registerMail, notifier } from './mail.js';
import { examState, loadExamState, closedMessage } from './state.js';
import { registerSystem, nightly, hourly } from './system.js';
import { offerLater } from './waitlist.js';
import { withDeadlines, notifyStepLater } from './writing.js';
import { examDataset as datasetOf } from './dataset.js';

const app = new Hono().basePath('/api');
const COOKIE = 'omas_s';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- utilitaires ----------

// Une cellule qui commence par = + - @ serait exécutée comme formule par le tableur : on la neutralise
const csvCell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,.]*$/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };

function genCode(len = 8) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
function genToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const httpError = (status, message) => Object.assign(new Error(message), { status });
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();

// Codes d'accès : uniques sur toute la base (salles, rédacteurs, candidats, inscrits des journées).
// Une seule requête, quel que soit le nombre de codes demandés.
async function freshCodes(db, n) {
  const base = `SELECT code AS c FROM candidates UNION ALL SELECT code FROM jp_participants
    UNION ALL SELECT code FROM people UNION ALL SELECT eval_code FROM stations`;
  // la table des bénévoles n'existe qu'une fois la migration 0010 passée : sans elle, on continue sans
  const rows = await all(db, `${base} UNION ALL SELECT code FROM volunteer_signups`).catch(() => all(db, base));
  const taken = new Set(rows.map((r) => r.c));
  const out = [];
  let guard = 0;
  while (out.length < n) {
    if (++guard > n * 50 + 100) throw httpError(500, 'Impossible de générer des codes uniques');
    const code = genCode();
    if (!taken.has(code)) { taken.add(code); out.push(code); }
  }
  return out;
}
const uniqueCode = async (db) => (await freshCodes(db, 1))[0];

// INSERT de plusieurs lignes par requête, sans dépasser 100 paramètres par requête (limite D1).
// Renvoie des requêtes préparées à passer à db.batch : un batch ne compte que pour un appel.
function multiInsert(db, table, cols, rows, tail = '') {
  const per = Math.max(1, Math.floor(100 / cols.length));
  const stmts = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const ph = chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    stmts.push(db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph} ${tail}`)
      .bind(...chunk.flatMap((r) => cols.map((c) => (r[c] === undefined ? null : r[c])))));
  }
  return stmts;
}
async function batch(db, stmts) {
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
}

app.onError((err, c) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  return c.json({ error: err.message || 'Erreur serveur' }, status);
});

// ---------- sessions ----------

async function createSession(c, kind, subjectId, name, hours = 24 * 30) {
  const token = genToken();
  const expires = new Date(Date.now() + hours * 3600e3).toISOString();
  await run(c.env.DB, 'INSERT INTO auth_sessions (token, kind, subject_id, name, expires_at) VALUES (?,?,?,?,?)',
    token, kind, subjectId ?? null, name ?? null, expires);
  setCookie(c, COOKIE, token, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: hours * 3600,
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

// Défense contre les requêtes venues d'un autre site : une écriture doit venir de nos propres pages
app.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw httpError(403, 'Origine refusée');
  }
  await next();
  // les réponses de l'API contiennent des données personnelles : jamais en cache, jamais interprétées autrement
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
});

app.use('*', async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (token) {
    const s = await one(c.env.DB, 'SELECT * FROM auth_sessions WHERE token = ? AND expires_at > ?', token, new Date().toISOString());
    if (s) c.set('session', s);
  }
  await next();
});

const need = (...kinds) => async (c, next) => {
  const s = c.get('session');
  if (!s) throw httpError(401, 'Connexion requise');
  if (!kinds.includes(s.kind)) throw httpError(403, 'Accès refusé');
  await next();
};

// Limite de tentatives : au-delà, on bloque l'adresse IP 15 minutes. Une salle de faculté partage souvent
// une même adresse, d'où une marge large pour les codes ; le mot de passe de l'équipe est plus strict.
const LIMITS = { admin: 8, other: 40 };
const clientIp = (c) => c.req.header('CF-Connecting-IP') || 'local';
async function checkAttempts(c, role) {
  const r = await one(c.env.DB, "SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > datetime('now', '-15 minutes') AND (role = 'admin') = ?",
    clientIp(c), role === 'admin' ? 1 : 0);
  if (r.n >= (role === 'admin' ? LIMITS.admin : LIMITS.other)) throw httpError(429, 'Trop de tentatives : réessaie dans 15 minutes.');
}
async function failed(c, role, message) {
  const db = c.env.DB;
  await db.batch([
    db.prepare('INSERT INTO login_failures (ip, role) VALUES (?, ?)').bind(clientIp(c), role === 'admin' ? 'admin' : role || null),
    db.prepare("DELETE FROM login_failures WHERE at < datetime('now', '-1 day')"),
  ]);
  return httpError(401, message);
}

app.post('/login', async (c) => {
  const { role, code, name } = await c.req.json();
  const db = c.env.DB;
  const clean = String(code || '').trim();
  if (!clean) throw httpError(400, 'Code requis');
  await checkAttempts(c, role);
  if (role === 'admin') {
    if (!c.env.ADMIN_PASSWORD || !safeEqual(clean, c.env.ADMIN_PASSWORD)) throw await failed(c, 'admin', 'Mot de passe incorrect');
    await createSession(c, 'admin', null, 'Administrateur', 12);
    // adresse du site, pour les liens des e-mails envoyés par la tâche planifiée
    await run(db, "INSERT INTO settings (key, value) VALUES ('site_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", new URL(c.req.url).origin).catch(() => {});
    return c.json({ kind: 'admin' });
  }
  const upper = clean.toUpperCase().replace(/\s+/g, '');
  if (role === 'etudiant') {
    const cand = await one(db, "SELECT * FROM candidates WHERE code = ? AND status != 'annule'", upper);
    if (cand) {
      await createSession(c, 'etudiant', cand.id, `${cand.first_name} ${cand.last_name}`);
      return c.json({ kind: 'etudiant' });
    }
    const part = await one(db, "SELECT * FROM jp_participants WHERE code = ? AND status != 'annule'", upper);
    if (!part) throw await failed(c, role, 'Code inconnu');
    await createSession(c, 'participant', part.id, `${part.first_name} ${part.last_name}`);
    return c.json({ kind: 'participant' });
  }
  if (role === 'redaction') {
    const p = await one(db, 'SELECT * FROM people WHERE code = ? AND active = 1', upper);
    if (!p) throw await failed(c, role, 'Code inconnu');
    await createSession(c, 'auteur', p.id, p.name);
    return c.json({ kind: 'auteur' });
  }
  if (role === 'evaluateur' || role === 'benevole') {
    // un code personnel de bénévole ouvre son espace (planning, calibration, accès direct à sa salle)
    const vol = await one(db, 'SELECT s.id, v.first_name, v.last_name FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.code = ?', upper).catch(() => null);
    if (vol) {
      await createSession(c, 'benevole', vol.id, `${vol.first_name} ${vol.last_name}`, 24 * 30);
      return c.json({ kind: 'benevole' });
    }
    const st = await one(db, 'SELECT * FROM stations WHERE eval_code = ?', upper);
    if (!st) throw await failed(c, role, 'Code de salle inconnu');
    const E = await loadExamState(db, st.exam_id);
    if (!E.eval.open) throw httpError(403, closedMessage(E.eval));
    let n = String(name || '').trim().replace(/\s+/g, ' ');
    if (n.length < 2) throw httpError(400, 'Indiquez votre nom');
    // un nom tapé qui correspond à une personne affectée à la salle prend son orthographe exacte :
    // « dr martin » et « Martin Dupont » ne font plus deux évaluateurs dans les résultats
    const known = (await roomNames(db, st)).filter((x) => sameName(x, n));
    if (known.length === 1) n = known[0];
    await createSession(c, 'evaluateur', st.id, n, 14);
    return c.json({ kind: 'evaluateur' });
  }
  throw httpError(400, 'Rôle inconnu');
});

// Personnes affectées à une salle aujourd'hui (évaluateurs), pour choisir son nom au lieu de le taper
async function roomNames(db, st) {
  const rows = await all(db, `SELECT DISTINCT v.first_name || ' ' || v.last_name AS n, a.half FROM assignments a
    JOIN volunteer_signups s ON s.id = a.signup_id JOIN volunteers v ON v.id = s.volunteer_id
    WHERE a.station_id = ? AND a.day = ? AND a.role = 'evaluateur' ORDER BY v.last_name`, st.id, parisToday()).catch(() => []);
  const half = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit' })) < 12 ? 'am' : 'pm';
  return [...new Set([...rows.filter((r) => r.half === half), ...rows].map((r) => r.n))];
}

app.post('/room-names', async (c) => {
  const db = c.env.DB;
  const code = String((await c.req.json()).code || '').toUpperCase().replace(/\s+/g, '');
  if (code.length < 6) return c.json({ names: [] });
  await checkAttempts(c, 'evaluateur');
  const st = await one(db, 'SELECT * FROM stations WHERE eval_code = ?', code);
  // code personnel de bénévole, ou code inconnu : rien à proposer (le formulaire de connexion dira la suite)
  if (!st) return c.json({ names: [] });
  const E = await loadExamState(db, st.exam_id);
  if (!E.eval.open) return c.json({ names: [], closed: closedMessage(E.eval) });
  return c.json({ slot: st.slot, names: await roomNames(db, st) });
});

app.post('/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await run(c.env.DB, 'DELETE FROM auth_sessions WHERE token = ?', token);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.get('/me', (c) => {
  const s = c.get('session');
  if (!s) return c.json({ kind: null });
  return c.json({ kind: s.kind, name: s.name, subject_id: s.subject_id });
});

// ---------- sessions d'ECOS (examens) ----------

app.get('/exams', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `SELECT e.*,
    (SELECT COUNT(*) FROM candidates WHERE exam_id = e.id AND status != 'annule') AS n_candidates,
    (SELECT COUNT(*) FROM stations WHERE exam_id = e.id) AS n_stations,
    (SELECT COUNT(*) FROM evaluations WHERE exam_id = e.id) AS n_evaluations,
    (SELECT COUNT(*) FROM stations WHERE exam_id = e.id AND played = 1) AS n_played
    FROM exams e ORDER BY e.id DESC`);
  return c.json(rows.map(withState));
});

// Dans ce que voit l'équipe, eval_open vaut « ouverte en ce moment » et le détail du calcul est joint
function withState(e) {
  const S = examState(e, e.n_played);
  return { ...e, eval_open: S.eval.open ? 1 : 0, eval_state: S.eval, details_state: S.details, planning: e.planning };
}

app.post('/exams', need('admin'), async (c) => {
  const b = await c.req.json();
  if (!String(b.name || '').trim()) throw httpError(400, 'Nom requis');
  const db = c.env.DB;
  // jours précis de la session (par exemple deux week-ends) : ils fixent aussi le planning
  const days = [...new Set((Array.isArray(b.days) ? b.days : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const planning = days.length ? JSON.stringify(normalizePlanning({ days: days.map((date) => ({ date })) })) : null;
  const r = await run(db, 'INSERT INTO exams (name, starts_on, ends_on, planning) VALUES (?,?,?,?)', b.name.trim(),
    days[0] || b.starts_on || null, days[days.length - 1] || b.ends_on || null, planning);
  const id = r.meta.last_row_id;
  if (b.create_slots !== false) {
    const codes = await freshCodes(db, DEFAULT_SLOTS.length);
    await batch(db, multiInsert(db, 'stations', ['exam_id', 'slot', 'domain', 'type', 'played', 'eval_code'],
      DEFAULT_SLOTS.map((s, i) => ({ exam_id: id, slot: s.slot, domain: s.domain, type: s.type, played: s.played, eval_code: codes[i] }))));
  }
  return c.json({ id });
});

app.get('/exams/:id', need('admin'), async (c) => {
  const E = await loadExamState(c.env.DB, c.req.param('id'));
  if (!E) throw httpError(404, 'Session introuvable');
  return c.json(withState(E.exam));
});

app.patch('/exams/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const fields = ['name', 'starts_on', 'ends_on', 'eval_open', 'show_results', 'show_details', 'corrections_published'];
  const sets = []; const vals = [];
  // l'ancienne case « saisie ouverte » vaut désormais une ouverture ou une fermeture forcée
  if ('eval_open' in b && !('eval_mode' in b)) b.eval_mode = b.eval_open ? 'open' : 'closed';
  for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(typeof b[f] === 'boolean' ? (b[f] ? 1 : 0) : b[f]); }
  if (sets.length) await run(c.env.DB, `UPDATE exams SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
  if ('eval_mode' in b || 'details_embargo' in b) {
    const E = await loadExamState(c.env.DB, c.req.param('id'));
    if (!E) throw httpError(404, 'Session introuvable');
    const P = { ...E.planning };
    if ('eval_mode' in b) P.eval_mode = ['auto', 'open', 'closed'].includes(b.eval_mode) ? b.eval_mode : 'auto';
    if ('details_embargo' in b) P.details_embargo = !!b.details_embargo;
    await run(c.env.DB, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify(P), E.exam.id);
  }
  return c.json({ ok: true });
});

app.delete('/exams/:id', need('admin'), async (c) => {
  const id = c.req.param('id');
  const n = await one(c.env.DB, 'SELECT COUNT(*) AS n FROM evaluations WHERE exam_id = ?', id);
  if (n.n > 0 && c.req.query('force') !== '1') throw httpError(400, 'Cette session contient des grilles saisies : confirme la suppression.');
  await run(c.env.DB, 'DELETE FROM exams WHERE id = ?', id);
  return c.json({ ok: true });
});

// ---------- personnes (rédaction) ----------

app.get('/people', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `SELECT p.*,
    (SELECT COUNT(*) FROM stations WHERE author_id = p.id) + (SELECT COUNT(*) FROM jp_ateliers WHERE author_id = p.id) AS n_author,
    (SELECT COUNT(*) FROM stations WHERE peer_id = p.id OR expert_id = p.id) + (SELECT COUNT(*) FROM jp_ateliers WHERE reviewer_id = p.id) AS n_review
    FROM people p ORDER BY p.active DESC, p.name`);
  return c.json(rows);
});

app.post('/people', need('admin'), async (c) => {
  const b = await c.req.json();
  const list = Array.isArray(b) ? b : [b];
  const rows = list.filter((p) => String(p.name || '').trim());
  const codes = await freshCodes(c.env.DB, rows.length);
  await batch(c.env.DB, multiInsert(c.env.DB, 'people', ['name', 'email', 'phone', 'specialty', 'code'],
    rows.map((p, i) => ({ name: p.name.trim(), email: p.email || null, phone: p.phone || null, specialty: p.specialty || null, code: codes[i] }))));
  return c.json({ added: rows.length });
});

app.patch('/people/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const sets = []; const vals = [];
  for (const f of ['name', 'email', 'phone', 'specialty', 'active']) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]); }
  if (b.regen_code) { sets.push('code = ?'); vals.push(await uniqueCode(c.env.DB)); }
  if (sets.length) await run(c.env.DB, `UPDATE people SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
  return c.json({ ok: true });
});

app.delete('/people/:id', need('admin'), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  // les stations et ateliers qu'il suivait repassent « à attribuer » pour ce rôle
  await db.batch([
    db.prepare('UPDATE stations SET author_id = NULL WHERE author_id = ?').bind(id),
    db.prepare('UPDATE stations SET peer_id = NULL WHERE peer_id = ?').bind(id),
    db.prepare('UPDATE stations SET expert_id = NULL WHERE expert_id = ?').bind(id),
    db.prepare('UPDATE jp_ateliers SET author_id = NULL WHERE author_id = ?').bind(id),
    db.prepare('UPDATE jp_ateliers SET reviewer_id = NULL WHERE reviewer_id = ?').bind(id),
    db.prepare("DELETE FROM auth_sessions WHERE kind = 'auteur' AND subject_id = ?").bind(id),
    db.prepare('DELETE FROM people WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- stations ----------

const STATION_LIST_SQL = `SELECT s.id, s.exam_id, s.slot, s.played, s.domain, s.type, s.discipline, s.title, s.status,
  s.author_id, s.peer_id, s.expert_id, s.eval_code, s.updated_at,
  a.name AS author_name, p.name AS peer_name, x.name AS expert_name, e.name AS exam_name, e.planning AS exam_planning,
  (SELECT COUNT(*) FROM evaluations v WHERE v.station_id = s.id) AS n_evaluations,
  (SELECT COUNT(*) FROM reviews r WHERE r.station_id = s.id AND r.action = 'comment') AS n_comments
  FROM stations s
  JOIN exams e ON e.id = s.exam_id
  LEFT JOIN people a ON a.id = s.author_id
  LEFT JOIN people p ON p.id = s.peer_id
  LEFT JOIN people x ON x.id = s.expert_id`;

app.get('/exams/:id/stations', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `${STATION_LIST_SQL} WHERE s.exam_id = ? ORDER BY s.played DESC, s.slot`, c.req.param('id'));
  return c.json(withDeadlines(rows));
});

app.post('/exams/:id/stations', need('admin'), async (c) => {
  const b = await c.req.json();
  const slot = String(b.slot || '').trim().toUpperCase();
  if (!slot) throw httpError(400, 'Emplacement requis (ex. R3)');
  const r = await run(c.env.DB, 'INSERT INTO stations (exam_id, slot, domain, type, played, eval_code) VALUES (?,?,?,?,?,?)',
    c.req.param('id'), slot, b.domain || null, b.type || 'SANS', b.played ? 1 : 0, await uniqueCode(c.env.DB));
  return c.json({ id: r.meta.last_row_id });
});

app.patch('/stations/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const db = c.env.DB;
  const st = await one(db, 'SELECT * FROM stations WHERE id = ?', c.req.param('id'));
  if (!st) throw httpError(404, 'Station introuvable');
  const sets = []; const vals = [];
  for (const f of ['slot', 'played', 'domain', 'type', 'discipline', 'title', 'author_id', 'peer_id', 'expert_id', 'status']) {
    if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] === '' ? null : b[f]); }
  }
  if (b.status && !STATUSES[b.status]) throw httpError(400, 'Statut inconnu');
  // une station attribuée passe automatiquement en rédaction
  if ('author_id' in b && b.author_id && st.status === 'a_attribuer' && !('status' in b)) { sets.push('status = ?'); vals.push('redaction'); }
  if (b.regen_code) { sets.push('eval_code = ?'); vals.push(await uniqueCode(db)); }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    await run(db, `UPDATE stations SET ${sets.join(', ')} WHERE id = ?`, ...vals, st.id);
  }
  if (b.status && b.status !== st.status) {
    await run(db, 'INSERT INTO reviews (station_id, author_name, stage, action, comment) VALUES (?,?,?,?,?)',
      st.id, 'Administrateur', st.status, 'status', `Statut changé : ${STATUSES[st.status]} → ${STATUSES[b.status]}`);
  }
  // la station arrive chez quelqu'un (nouvelle étape ou nouvelle personne sur l'étape en cours) : on le prévient
  if ((b.status && b.status !== st.status) || ['author_id', 'peer_id', 'expert_id'].some((f) => f in b && b[f] && b[f] !== st[f])) notifyStepLater(c, st.id);
  return c.json({ ok: true });
});

// Échéances du circuit de rédaction, une date par étape (dans le planning de la session)
app.put('/exams/:id/writing', need('admin'), async (c) => {
  const E = await loadExamState(c.env.DB, c.req.param('id'));
  if (!E) throw httpError(404, 'Session introuvable');
  const b = (await c.req.json()).deadlines || {};
  const deadlines = Object.fromEntries(Object.entries(b).filter(([k, v]) => STATUSES[k] && /^\d{4}-\d{2}-\d{2}$/.test(v)));
  await run(c.env.DB, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify({ ...E.planning, writing_deadlines: deadlines }), E.exam.id);
  return c.json({ ok: true, deadlines });
});

// Nouveaux codes pour toutes les salles d'une session (entre deux week-ends, par exemple) :
// les anciens codes et les évaluateurs connectés avec eux sont coupés
app.post('/exams/:id/regen-room-codes', need('admin'), async (c) => {
  const db = c.env.DB;
  const st = await all(db, 'SELECT id FROM stations WHERE exam_id = ?', c.req.param('id'));
  const codes = await freshCodes(db, st.length);
  await batch(db, [
    ...st.map((x, i) => db.prepare('UPDATE stations SET eval_code = ? WHERE id = ?').bind(codes[i], x.id)),
    db.prepare(`DELETE FROM auth_sessions WHERE kind = 'evaluateur' AND subject_id IN (SELECT id FROM stations WHERE exam_id = ?)`).bind(c.req.param('id')),
  ]);
  return c.json({ ok: true, n: st.length });
});

app.delete('/stations/:id', need('admin'), async (c) => {
  const n = await one(c.env.DB, 'SELECT COUNT(*) AS n FROM evaluations WHERE station_id = ?', c.req.param('id'));
  if (n.n > 0) throw httpError(400, 'Cette station a déjà des évaluations.');
  await run(c.env.DB, 'DELETE FROM stations WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

// Droits d'une session sur une station
function stationRights(s, st) {
  const isAdmin = s.kind === 'admin';
  const isAuthor = s.kind === 'auteur' && st.author_id === s.subject_id;
  const isPeer = s.kind === 'auteur' && st.peer_id === s.subject_id;
  const isExpert = s.kind === 'auteur' && st.expert_id === s.subject_id;
  const isEval = s.kind === 'evaluateur' && st.id === s.subject_id;
  const involved = isAdmin || isAuthor || isPeer || isExpert;
  const editable = isAdmin ? st.status !== 'validee' : isAuthor && ['redaction', 'corrections'].includes(st.status);
  return { isAdmin, isAuthor, isPeer, isExpert, isEval, involved, read: involved || isEval, editable };
}

app.get('/redaction/stations', need('auteur'), async (c) => {
  const id = c.get('session').subject_id;
  const rows = await all(c.env.DB, `${STATION_LIST_SQL} WHERE s.author_id = ? OR s.peer_id = ? OR s.expert_id = ?
    ORDER BY e.id DESC, s.slot`, id, id, id);
  return c.json(withDeadlines(rows));
});

app.get('/stations/:id', need('admin', 'auteur', 'evaluateur'), async (c) => {
  const db = c.env.DB;
  const row = await one(db, `${STATION_LIST_SQL} WHERE s.id = ?`, c.req.param('id'));
  if (!row) throw httpError(404, 'Station introuvable');
  const [st] = withDeadlines([row]);
  const rights = stationRights(c.get('session'), st);
  if (!rights.read) throw httpError(403, 'Accès refusé');
  if (rights.isEval && !rights.involved) await openRoom(c);
  const full = await one(db, 'SELECT content FROM stations WHERE id = ?', st.id);
  const content = normalizeContent(parse(full.content, {}));
  // l'évaluateur n'a besoin ni de la correction ni des références
  if (rights.isEval && !rights.involved) content.pedago = { correction: '', references: '' };
  const reviews = rights.involved
    ? await all(db, 'SELECT * FROM reviews WHERE station_id = ? ORDER BY id DESC', st.id) : [];
  if (!rights.isAdmin) delete st.eval_code;
  return c.json({ station: st, content, reviews, rights, checks: qualityChecks(st, content) });
});

app.put('/stations/:id/content', need('admin', 'auteur'), async (c) => {
  const db = c.env.DB;
  const st = await one(db, 'SELECT * FROM stations WHERE id = ?', c.req.param('id'));
  if (!st) throw httpError(404, 'Station introuvable');
  const rights = stationRights(c.get('session'), st);
  if (!rights.editable) throw httpError(403, 'Station non modifiable à cette étape');
  const b = await c.req.json();
  const content = normalizeContent(b.content);
  const evals = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE station_id = ?', st.id);
  if (evals.n > 0 && !rights.isAdmin) throw httpError(400, 'Station déjà évaluée : modification impossible.');
  await run(db, `UPDATE stations SET content = ?, title = ?, discipline = ?, updated_at = datetime('now') WHERE id = ?`,
    JSON.stringify(content), b.title ?? st.title, b.discipline ?? st.discipline, st.id);
  const updated = { ...st, title: b.title ?? st.title };
  return c.json({ ok: true, checks: qualityChecks(updated, content) });
});

// Circuit de validation
const FLOW = {
  redaction: { submit: { who: ['author', 'admin'], to: 'relecture_pair' } },
  relecture_pair: { approve: { who: ['peer', 'admin'], to: 'relecture_expert' }, revise: { who: ['peer', 'admin'], to: 'redaction' } },
  relecture_expert: { approve: { who: ['expert', 'admin'], to: 'test' }, revise: { who: ['expert', 'admin'], to: 'redaction' } },
  test: { approve: { who: ['author', 'admin'], to: 'corrections' }, revise: { who: ['author', 'admin'], to: 'redaction' } },
  corrections: { submit: { who: ['author', 'admin'], to: 'validation' } },
  validation: {
    approve: { who: ['admin'], to: 'validee' },
    revise: { who: ['admin'], to: 'corrections' },
    refuse: { who: ['admin'], to: 'refusee' },
  },
};

app.post('/stations/:id/review', need('admin', 'auteur'), async (c) => {
  const db = c.env.DB;
  const s = c.get('session');
  const st = await one(db, 'SELECT * FROM stations WHERE id = ?', c.req.param('id'));
  if (!st) throw httpError(404, 'Station introuvable');
  const r = stationRights(s, st);
  if (!r.involved) throw httpError(403, 'Accès refusé');
  const { action, comment } = await c.req.json();
  const text = String(comment || '').trim();
  if (action === 'comment') {
    if (!text) throw httpError(400, 'Commentaire vide');
  } else {
    const step = FLOW[st.status]?.[action];
    if (!step) throw httpError(400, 'Action impossible à cette étape');
    const roles = [r.isAdmin && 'admin', r.isAuthor && 'author', r.isPeer && 'peer', r.isExpert && 'expert'].filter(Boolean);
    if (!step.who.some((w) => roles.includes(w))) throw httpError(403, "Cette étape revient à quelqu'un d'autre");
    if ((action === 'revise' || action === 'refuse') && !text) throw httpError(400, 'Expliquez ce qui est à revoir');
    if (step.to === 'validee') {
      const errors = qualityChecks(st, parse(st.content, {})).filter((x) => x.level === 'error');
      if (errors.length) throw httpError(400, `Validation impossible : ${errors.length} point(s) bloquant(s) dans la check-list.`);
    }
    await run(db, "UPDATE stations SET status = ?, updated_at = datetime('now') WHERE id = ?", step.to, st.id);
    notifyStepLater(c, st.id);
  }
  await run(db, 'INSERT INTO reviews (station_id, author_name, stage, action, comment) VALUES (?,?,?,?,?)',
    st.id, s.name || 'Administrateur', st.status, action, text || null);
  return c.json({ ok: true });
});

// ---------- candidats ----------

const CAND_COLS = ['exam_id', 'last_name', 'first_name', 'email', 'phone', 'faculty', 'year', 'slot_label', 'day', 'series', 'status', 'code'];

app.get('/exams/:id/candidates', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `SELECT c.*, (SELECT COUNT(*) FROM evaluations v WHERE v.candidate_id = c.id) AS n_evaluations
    FROM candidates c WHERE c.exam_id = ? ORDER BY c.day, c.series, c.number, c.last_name`, c.req.param('id'));
  return c.json(rows);
});

app.post('/exams/:id/candidates', need('admin'), async (c) => {
  const examId = c.req.param('id');
  const b = await c.req.json();
  const list = (Array.isArray(b.rows) ? b.rows : [b])
    .filter((r) => String(r.last_name || '').trim() || String(r.first_name || '').trim());
  const codes = await freshCodes(c.env.DB, list.length);
  await batch(c.env.DB, multiInsert(c.env.DB, 'candidates', [...CAND_COLS, 'extra'], list.map((r, i) => ({
    exam_id: Number(examId), last_name: String(r.last_name || '').trim(), first_name: String(r.first_name || '').trim(),
    email: r.email || null, phone: r.phone || null, faculty: r.faculty || null, year: r.year || null, slot_label: r.slot_label || null,
    day: r.day || null, series: r.series ? Number(r.series) : null, status: r.status === 'annule' ? 'annule' : 'inscrit', code: codes[i],
    extra: (() => {
      const x = {};
      if (String(r.prepa || '').trim()) x.prepa = String(r.prepa).trim();
      if (String(r.tarif || '').trim()) { x.tarif = String(r.tarif).trim(); x.adherent = /adh[ée]rent/i.test(x.tarif) && !/non[\s-]*adh/i.test(x.tarif); }
      return Object.keys(x).length ? JSON.stringify(x) : null;
    })(),
  }))));
  return c.json({ imported: list.length });
});

app.patch('/candidates/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const sets = []; const vals = [];
  for (const f of ['last_name', 'first_name', 'email', 'phone', 'faculty', 'year', 'slot_label', 'day', 'series', 'status', 'number']) {
    if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] === '' ? null : b[f]); }
  }
  if (b.regen_code) { sets.push('code = ?'); vals.push(await uniqueCode(c.env.DB)); }
  if ('tarif' in b) {
    const t = String(b.tarif || '').trim();
    sets.push("extra = json_set(COALESCE(extra, '{}'), '$.tarif', ?, '$.adherent', json(?))");
    vals.push(t, t ? String(/adh[ée]rent/i.test(t) && !/non[\s-]*adh/i.test(t)) : 'null');
  }
  if (('day' in b || 'series' in b) && !('seat' in b)) sets.push('seat = NULL', 'number = NULL');
  if (b.status === 'annule') sets.push('seat = NULL', 'number = NULL');
  const before = b.status === 'annule' ? await one(c.env.DB, 'SELECT exam_id, status, day FROM candidates WHERE id = ?', c.req.param('id')) : null;
  if (sets.length) await run(c.env.DB, `UPDATE candidates SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
  // une place annulée par l'équipe repart aussi à la liste d'attente
  if (before && before.status !== 'annule' && before.day) offerLater(c, before.exam_id);
  return c.json({ ok: true });
});

app.delete('/candidates/:id', need('admin'), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const n = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', id);
  if (n.n > 0 && c.req.query('force') !== '1') throw httpError(400, 'Ce candidat a des grilles saisies : confirme la suppression.');
  await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE kind = 'etudiant' AND subject_id = ?").bind(id),
    db.prepare('DELETE FROM candidates WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// Attribue un créneau (jour + série) à tous les candidats d'un même libellé de billetterie
app.post('/exams/:id/candidates/assign-slot', need('admin'), async (c) => {
  const { slot_label, day, series } = await c.req.json();
  await run(c.env.DB, 'UPDATE candidates SET day = ?, series = ?, seat = NULL, number = NULL WHERE exam_id = ? AND slot_label = ?',
    day || null, series ? Number(series) : null, c.req.param('id'), slot_label);
  return c.json({ ok: true });
});

// La numérotation (places dans les séries) est dans planning.js

// ---------- résultats ----------

// Plusieurs évaluateurs peuvent noter le même passage (binôme) : la note de la station est la moyenne
// de leurs notes. Un passage n'est « absent » que si tous ses évaluateurs l'ont marqué absent.
function mergePassages(rows) {
  const map = new Map();
  for (const e of rows) {
    const k = `${e.station_id}|${e.candidate_id}`;
    let m = map.get(k);
    if (!m) { m = { station_id: e.station_id, candidate_id: e.candidate_id, raters: [] }; map.set(k, m); }
    m.raters.push(e);
  }
  for (const m of map.values()) {
    const sc = m.raters.filter((e) => !e.absent && e.score !== null);
    m.absent = sc.length === 0 && m.raters.every((e) => e.absent);
    const avg = (f) => (sc.length ? sc.reduce((x, e) => x + (e[f] ?? 0), 0) / sc.length : null);
    m.score = avg('score'); m.points = avg('points'); m.max_points = sc.length ? sc[0].max_points : null;
  }
  return [...map.values()];
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sdev = (xs) => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : null; };

// Calcul léger (sans lire le détail des grilles) : il tourne à chaque actualisation des pages étudiants.
async function examResults(db, examId) {
  const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', examId);
  if (!exam) throw httpError(404, 'Session introuvable');
  const [stations, candidates, raw] = await Promise.all([
    all(db, 'SELECT id, slot, domain, type, title, discipline, played FROM stations WHERE exam_id = ? ORDER BY slot', examId),
    all(db, "SELECT id, number, last_name, first_name, email, day, series FROM candidates WHERE exam_id = ? AND status != 'annule'", examId),
    all(db, 'SELECT id, station_id, candidate_id, evaluator_name, absent, points, max_points, score FROM evaluations WHERE exam_id = ?', examId),
  ]);
  const played = stations.filter((s) => s.played);
  const passages = mergePassages(raw);
  const byStation = new Map(stations.map((s) => [s.id, []]));
  const byCand = new Map(candidates.map((c) => [c.id, []]));
  for (const p of passages) { byStation.get(p.station_id)?.push(p); byCand.get(p.candidate_id)?.push(p); }

  const stationStats = {};
  for (const s of stations) {
    const ev = (byStation.get(s.id) || []).filter((p) => !p.absent && p.score !== null && byCand.has(p.candidate_id));
    const scores = ev.map((p) => p.score);
    stationStats[s.id] = {
      n: scores.length, mean: mean(scores), sd: sdev(scores),
      min: scores.length ? Math.min(...scores) : null, max: scores.length ? Math.max(...scores) : null,
      ranks: rankMap(ev.map((p) => ({ id: p.candidate_id, value: p.score }))),
    };
  }
  const playedIds = played.map((s) => s.id);
  const perCandidate = candidates.map((cand) => {
    const ev = byCand.get(cand.id);
    const scored = ev.filter((p) => !p.absent && p.score !== null);
    const done = playedIds.every((id) => ev.some((p) => p.station_id === id));
    return { cand, ev, avg: mean(scored.map((p) => p.score)), done, n: ev.length };
  });
  const completed = perCandidate.filter((p) => p.done && p.avg !== null);
  const ranks = rankMap(completed.map((p) => ({ id: p.cand.id, value: p.avg })));
  return { exam, stations, played, candidates, raw, passages, stationStats, perCandidate, completed, ranks };
}

app.get('/exams/:id/results', need('admin'), async (c) => {
  const R = await examResults(c.env.DB, c.req.param('id'));
  const rows = R.perCandidate.map((p) => ({
    id: p.cand.id, number: p.cand.number, name: `${p.cand.last_name} ${p.cand.first_name}`, day: p.cand.day, series: p.cand.series,
    avg: p.avg, done: p.done, n: p.n, rank: R.ranks.get(p.cand.id) ?? null,
    scores: Object.fromEntries(p.ev.map((e) => [e.station_id, e.absent ? 'abs' : e.score])),
    raters: Object.fromEntries(p.ev.map((e) => [e.station_id, e.raters.length])),
  })).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.avg ?? -1) - (a.avg ?? -1));
  const stations = R.stations.map((s) => {
    const { ranks, ...st } = R.stationStats[s.id];
    return { id: s.id, slot: s.slot, title: s.title, domain: s.domain, discipline: s.discipline, played: s.played, ...st };
  });
  return c.json({ exam: R.exam, rows, stations, completed: R.completed.length, total: R.candidates.length, grids: R.raw.length });
});

app.get('/exams/:id/results.csv', need('admin'), async (c) => {
  const R = await examResults(c.env.DB, c.req.param('id'));
  const head = ['Rang', 'Numéro', 'Nom', 'Prénom', 'E-mail', 'Moyenne /20', 'Complet', ...R.played.map((s) => `${s.slot} ${s.title || ''}`.trim())];
  const lines = [head];
  for (const p of [...R.perCandidate].sort((a, b) => (R.ranks.get(a.cand.id) ?? 1e9) - (R.ranks.get(b.cand.id) ?? 1e9))) {
    lines.push([R.ranks.get(p.cand.id) ?? '', p.cand.number ?? '', p.cand.last_name, p.cand.first_name, p.cand.email ?? '',
      p.avg === null ? '' : p.avg.toFixed(2).replace('.', ','), p.done ? 'oui' : 'non',
      ...R.played.map((s) => { const e = p.ev.find((x) => x.station_id === s.id); return !e ? '' : e.absent ? 'absent' : e.score.toFixed(2).replace('.', ','); })]);
  }
  const csv = '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="resultats.csv"' } });
});

// Bulletin d'un candidat (vue étudiant, aussi utilisée par l'admin)
async function candidateReport(db, candidateId, asAdmin) {
  const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', candidateId);
  if (!cand) throw httpError(404, 'Candidat introuvable');
  const R = await examResults(db, cand.exam_id);
  const ex = R.exam;
  const me = R.perCandidate.find((p) => p.cand.id === cand.id);
  const D = examState(ex, R.played.length).details;
  const showResults = asAdmin || ex.show_results;
  const showDetails = asAdmin || D.visible;
  const showCorr = asAdmin || ex.corrections_published;
  // le détail des grilles n'est lu que pour ce candidat
  // le contenu sert aussi au plan de révision (item et situation de départ de chaque station)
  const needContent = showResults || showCorr;
  const [contents, mine] = needContent ? await Promise.all([
    all(db, 'SELECT id, content FROM stations WHERE exam_id = ? AND played = 1', cand.exam_id),
    showDetails ? all(db, 'SELECT station_id, evaluator_name, absent, answers, comment, score FROM evaluations WHERE candidate_id = ?', cand.id) : [],
  ]) : [[], []];
  const contentOf = new Map(contents.map((r) => [r.id, normalizeContent(parse(r.content, {}))]));
  const stations = R.played.map((s) => {
    const e = me?.ev.find((x) => x.station_id === s.id);
    const st = R.stationStats[s.id];
    const out = { slot: s.slot, title: s.title, domain: s.domain, discipline: s.discipline, evaluated: !!e, absent: !!e?.absent };
    const content = contentOf.get(s.id);
    if (content && showResults) { out.item = content.identite.item || ''; out.sdd = content.identite.sdd || ''; }
    if (e && !e.absent && showResults) {
      out.score = e.score; out.points = e.points; out.max_points = e.max_points;
      out.rank = st.ranks.get(cand.id) ?? null; out.n = st.n; out.mean = st.mean;
      out.raters = e.raters.length;
      if (showDetails && content) {
        const grids = mine.filter((x) => x.station_id === s.id && !x.absent).map((x) => ({ ...x, answers: parse(x.answers, {}) }));
        const k = grids.length || 1;
        out.apt = content.grille.apt.filter((i) => i.label?.trim()).map((i) => {
          const share = grids.filter((g) => g.answers?.apt?.[i.id]?.ok === true).length / k;
          return {
            label: i.label, points: Number(i.points) > 0 ? Number(i.points) : 1, ok: share === 1, share,
            comment: grids.map((g) => g.answers?.apt?.[i.id]?.comment).filter(Boolean).join(' / '),
          };
        });
        out.com = content.grille.com.filter((i) => i.label?.trim())
          .map((i) => ({ label: i.label, value: grids.reduce((a, g) => a + (Number(g.answers?.com?.[i.id]) || 0), 0) / k }));
        out.comments = grids.map((g) => g.comment).filter(Boolean);
        out.comment = out.comments.join('\n\n');
        if (asAdmin) out.by_rater = grids.map((g) => ({ name: g.evaluator_name, score: g.score }));
      }
    }
    if (showCorr && content) out.correction = { text: content.pedago.correction, references: content.pedago.references,
      images: (content.documents || []).filter((d) => d.file_id && /^image\//.test(d.file_mime || '')).map((d) => ({ id: d.file_id, nom: d.nom })) };
    return out;
  });
  return {
    candidate: { number: asAdmin || parse(ex.planning, {})?.publish !== false ? cand.number : null, first_name: cand.first_name, last_name: cand.last_name, day: cand.day, series: cand.series },
    exam: { name: ex.name, show_results: !!showResults, show_details: !!showDetails, corrections_published: !!showCorr,
      details_from: !asAdmin && D.held ? D.from : null },
    summary: showResults ? {
      avg: me?.avg ?? null, done: !!me?.done, evaluated: me?.n ?? 0, total_stations: R.played.length,
      rank: R.ranks.get(cand.id) ?? null, ranked: R.completed.length, registered: R.candidates.length,
      cohort_mean: mean(R.completed.map((p) => p.avg)),
    } : null,
    stations,
    updated_at: new Date().toISOString(),
  };
}

app.get('/me/results', need('etudiant'), async (c) => c.json(await candidateReport(c.env.DB, c.get('session').subject_id, false)));
app.get('/candidates/:id/report', need('admin'), async (c) => c.json(await candidateReport(c.env.DB, c.req.param('id'), true)));

// ---------- jeu de données pour l'analyse et sauvegarde (src/dataset.js) ----------
async function examDataset(db, examId, full) {
  const r = await datasetOf(db, examId, full);
  if (!r) throw httpError(404, 'Session introuvable');
  return r;
}

app.get('/exams/:id/dataset', need('admin'), async (c) => new Response(await examDataset(c.env.DB, c.req.param('id'), false),
  { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));

app.get('/exams/:id/export', need('admin'), async (c) => new Response(await examDataset(c.env.DB, c.req.param('id'), true), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="session-${c.req.param('id')}.json"` },
}));

// ---------- restauration d'une session (sauvegarde ou ancien site) ----------
// L'import se fait en plusieurs appels pour rester sous les limites de D1 :
// 1. la session et ses stations, 2. les candidats par paquets, 3. les grilles par paquets.

app.post('/import/exam', need('admin'), async (c) => {
  const db = c.env.DB;
  const b = await c.req.json();
  if (!String(b.exam?.name || '').trim()) throw httpError(400, 'Nom de session manquant');
  const stations = Array.isArray(b.stations) ? b.stations : [];
  if (!stations.length) throw httpError(400, 'Aucune station dans le fichier');
  const r = await run(db, 'INSERT INTO exams (name, starts_on, ends_on, planning) VALUES (?,?,?,?)', b.exam.name.trim(), b.exam.starts_on || null, b.exam.ends_on || null,
    b.exam.planning ? JSON.stringify(b.exam.planning) : null);
  const examId = r.meta.last_row_id;
  const codes = await freshCodes(db, stations.length);
  await batch(db, multiInsert(db, 'stations', ['exam_id', 'slot', 'played', 'domain', 'type', 'discipline', 'title', 'status', 'content', 'eval_code'],
    stations.map((s, i) => ({
      exam_id: examId, slot: String(s.slot || `S${i + 1}`).toUpperCase(), played: s.played === 0 || s.played === false ? 0 : 1,
      domain: s.domain || null, type: s.type || 'SANS', discipline: s.discipline || null, title: s.title || null,
      status: STATUSES[s.status] ? s.status : 'validee', content: JSON.stringify(normalizeContent(s.content || {})), eval_code: codes[i],
    }))));
  const ids = await all(db, 'SELECT id, slot FROM stations WHERE exam_id = ?', examId);
  const bySlot = Object.fromEntries(ids.map((x) => [x.slot, x.id]));
  return c.json({ exam_id: examId, stations: stations.map((s, i) => [s.key ?? s.slot, bySlot[String(s.slot || `S${i + 1}`).toUpperCase()]]) });
});

app.post('/import/:examId/candidates', need('admin'), async (c) => {
  const db = c.env.DB;
  const examId = Number(c.req.param('examId'));
  if (!await one(db, 'SELECT 1 FROM exams WHERE id = ?', examId)) throw httpError(404, 'Session introuvable');
  const rows = (await c.req.json()).rows || [];
  if (rows.length > 500) throw httpError(400, 'Paquet trop gros (500 lignes au plus)');
  // on garde les codes d'origine (les étudiants les connaissent déjà) sauf s'ils sont pris
  const base = `SELECT code AS c FROM candidates UNION ALL SELECT code FROM jp_participants
    UNION ALL SELECT code FROM people UNION ALL SELECT eval_code FROM stations`;
  const existing = await all(db, `${base} UNION ALL SELECT code FROM volunteer_signups`).catch(() => all(db, base));
  const taken = new Set(existing.map((r) => r.c));
  let changed = 0;
  const out = rows.map((r) => {
    let code = String(r.code || '').toUpperCase().replace(/\s+/g, '');
    if (code.length < 6 || taken.has(code)) {
      if (code) changed++;
      do code = genCode(); while (taken.has(code));
    }
    taken.add(code);
    return {
      exam_id: examId, number: r.number ?? null, last_name: String(r.last_name || '').trim() || '?', first_name: String(r.first_name || '').trim(),
      email: r.email || null, phone: r.phone || null, faculty: r.faculty || null, year: r.year || null, slot_label: r.slot_label || null,
      day: r.day || null, series: r.series ? Number(r.series) : null, status: r.status === 'annule' ? 'annule' : 'inscrit', code,
      extra: r.extra ? JSON.stringify(r.extra) : null, seat: r.seat ? Number(r.seat) : null, confirmed_at: r.confirmed_at || null, key: r.key,
    };
  });
  await batch(db, multiInsert(db, 'candidates', [...CAND_COLS, 'number', 'extra', 'seat', 'confirmed_at'], out));
  const ids = await all(db, 'SELECT id, code FROM candidates WHERE exam_id = ?', examId);
  const byCode = Object.fromEntries(ids.map((x) => [x.code, x.id]));
  return c.json({ imported: out.length, codes_changed: changed, candidates: out.map((r) => [r.key ?? r.code, byCode[r.code]]) });
});

app.post('/import/:examId/evaluations', need('admin'), async (c) => {
  const db = c.env.DB;
  const examId = Number(c.req.param('examId'));
  const rows = (await c.req.json()).rows || [];
  if (rows.length > 800) throw httpError(400, 'Paquet trop gros (800 grilles au plus)');
  const [st, ca] = await Promise.all([
    all(db, 'SELECT id FROM stations WHERE exam_id = ?', examId),
    all(db, 'SELECT id FROM candidates WHERE exam_id = ?', examId),
  ]);
  const okSt = new Set(st.map((x) => x.id));
  const okCa = new Set(ca.map((x) => x.id));
  const clean = rows.filter((r) => okSt.has(r.station_id) && okCa.has(r.candidate_id)).map((r) => ({
    exam_id: examId, station_id: r.station_id, candidate_id: r.candidate_id,
    evaluator_name: String(r.evaluator_name || '').trim().replace(/\s+/g, ' '), absent: r.absent ? 1 : 0,
    answers: JSON.stringify(r.answers || {}), global: r.global ?? null, comment: r.comment || null,
    points: r.points ?? null, max_points: r.max_points ?? null, score: r.score ?? null,
    created_at: r.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
  }));
  await batch(db, multiInsert(db, 'evaluations', ['exam_id', 'station_id', 'candidate_id', 'evaluator_name', 'absent', 'answers', 'global', 'comment', 'points', 'max_points', 'score', 'created_at'],
    clean, 'ON CONFLICT(station_id, candidate_id, evaluator_name) DO NOTHING'));
  return c.json({ imported: clean.length, skipped: rows.length - clean.length });
});

// ---------- course des évaluateurs ----------
// Un cheval par évaluateur : il avance à chaque grille saisie pour les candidats du jour.
const parisToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

async function race(db, examId, wanted) {
  const days = (await all(db, "SELECT DISTINCT day FROM candidates WHERE exam_id = ? AND day IS NOT NULL AND status != 'annule' ORDER BY day", examId)).map((d) => d.day);
  const today = parisToday();
  let day = wanted && days.includes(wanted) ? wanted : days.includes(today) ? today : null;
  if (!day) {
    const last = await one(db, `SELECT c.day FROM evaluations v JOIN candidates c ON c.id = v.candidate_id WHERE v.exam_id = ? AND c.day IS NOT NULL
      ORDER BY v.updated_at DESC LIMIT 1`, examId);
    day = last?.day || days[0] || null;
  }
  if (!day) return { day: null, days, target: 0, horses: [] };
  const [rows, target] = await Promise.all([
    all(db, `SELECT v.evaluator_name AS name, s.slot, COUNT(*) AS n, MAX(v.updated_at) AS last FROM evaluations v
      JOIN candidates c ON c.id = v.candidate_id JOIN stations s ON s.id = v.station_id
      WHERE v.exam_id = ? AND c.day = ? GROUP BY v.evaluator_name, s.slot`, examId, day),
    one(db, "SELECT COUNT(*) AS n FROM candidates WHERE exam_id = ? AND day = ? AND status != 'annule'", examId, day),
  ]);
  const by = new Map();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    const h = by.get(k) || { name: r.name, slots: [], n: 0, last: null };
    h.slots.push(r.slot); h.n += r.n; h.last = !h.last || r.last > h.last ? r.last : h.last;
    by.set(k, h);
  }
  return { day, days, today, target: target.n, horses: [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)) };
}

app.get('/exams/:id/race', need('admin'), async (c) => c.json(await race(c.env.DB, c.req.param('id'), c.req.query('day'))));
app.get('/eval/race', need('evaluateur'), async (c) => {
  const st = await openRoom(c);
  const r = await race(c.env.DB, st.exam_id, c.req.query('day'));
  return c.json({ ...r, me: evalName(c.get('session')) });
});

// ---------- évaluateurs ----------
// Chaque évaluateur a sa propre grille. En binôme, chacun remplit la sienne sur son téléphone,
// ou ils en remplissent une seule à deux sur le même appareil.

const evalName = (s) => String(s.name || '').trim().replace(/\s+/g, ' ');

// Hors des heures de saisie, un code de salle (même photographié) ne donne plus accès à rien
async function openRoom(c) {
  const st = await one(c.env.DB, 'SELECT * FROM stations WHERE id = ?', c.get('session').subject_id);
  if (!st) throw httpError(404, 'Station introuvable');
  const E = await loadExamState(c.env.DB, st.exam_id);
  if (!E.eval.open) throw httpError(403, closedMessage(E.eval));
  st.exam_state = E;
  return st;
}

app.get('/eval/context', need('evaluateur'), async (c) => {
  const db = c.env.DB;
  const s = c.get('session');
  const st = await openRoom(c);
  const E = st.exam_state;
  const exam = { id: E.exam.id, name: E.exam.name, eval_open: E.eval.open, closes_at: E.eval.closes_at };
  const content = normalizeContent(parse(st.content, {}));
  const candidates = await all(db, `SELECT c.id, c.number, c.first_name, substr(c.last_name, 1, 1) || '.' AS last_name, c.day, c.series, c.seat,
    v.id AS eval_id, v.absent, v.score, v.evaluator_name,
    (SELECT COUNT(*) FROM evaluations o WHERE o.candidate_id = c.id AND o.station_id = ? AND o.evaluator_name != ?) AS n_others
    FROM candidates c LEFT JOIN evaluations v ON v.candidate_id = c.id AND v.station_id = ? AND v.evaluator_name = ?
    WHERE c.exam_id = ? AND c.status != 'annule' ORDER BY c.day, c.series, c.number, c.last_name`,
  st.id, evalName(s), st.id, evalName(s), st.exam_id);
  return c.json({
    evaluator: evalName(s),
    exam,
    station: { id: st.id, slot: st.slot, title: st.title, domain: st.domain, discipline: st.discipline, type: st.type },
    vignette: content.vignette, examinateur: content.examinateur, grille: content.grille,
    documents: content.documents.filter((d) => d.nom || d.file_id).map((d) => ({ nom: d.nom, remis_par: d.remis_par, description: d.description, file_id: d.file_id || null, file_mime: d.file_mime || null })),
    candidates,
  });
});

app.get('/eval/evaluations/:candidateId', need('evaluateur'), async (c) => {
  const s = c.get('session');
  await openRoom(c);
  const e = await one(c.env.DB, 'SELECT * FROM evaluations WHERE station_id = ? AND candidate_id = ? AND evaluator_name = ?',
    s.subject_id, c.req.param('candidateId'), evalName(s));
  return c.json(e ? { ...e, answers: parse(e.answers, {}) } : null);
});

app.put('/eval/evaluations', need('evaluateur'), async (c) => {
  const db = c.env.DB;
  const s = c.get('session');
  const st = await openRoom(c);
  const b = await c.req.json();
  const cand = await one(db, 'SELECT * FROM candidates WHERE id = ? AND exam_id = ?', b.candidate_id, st.exam_id);
  if (!cand) throw httpError(404, 'Candidat introuvable');
  const grille = normalizeContent(parse(st.content, {})).grille;
  const absent = !!b.absent;
  const global = b.global === null || b.global === undefined || b.global === '' ? null : Number(b.global);
  const answers = absent ? {} : { apt: b.answers?.apt || {}, com: b.answers?.com || {} };
  const miss = missingAnswers(grille, answers, global, absent);
  if (miss.length) throw httpError(400, `${miss.length} élément(s) de la grille non rempli(s).`);
  const { points, max, score } = computeScore(grille, answers, absent);
  await run(db, `INSERT INTO evaluations (exam_id, station_id, candidate_id, evaluator_name, absent, answers, global, comment, points, max_points, score, ip)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(station_id, candidate_id, evaluator_name) DO UPDATE SET absent = excluded.absent,
      answers = excluded.answers, global = excluded.global, comment = excluded.comment, points = excluded.points,
      max_points = excluded.max_points, score = excluded.score, ip = excluded.ip, updated_at = datetime('now')`,
  st.exam_id, st.id, cand.id, evalName(s), absent ? 1 : 0, JSON.stringify(answers), absent ? null : global,
  absent ? null : (String(b.comment || '').trim() || null), points, max, score, clientIp(c));
  return c.json({ ok: true, score });
});

app.delete('/evaluations/:id', need('admin'), async (c) => {
  await run(c.env.DB, 'DELETE FROM evaluations WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

registerJp(app, { need, httpError, all, one, run, uniqueCode, freshCodes, multiInsert, batch, parse });
registerPlanning(app, { need, httpError, all, one, run, parse, batch, genCode, freshCodes, multiInsert, notifier });
registerExtras(app, { need, httpError, all, one, run, parse });
registerAccueil(app, { need, httpError, all, one, run, parse, genCode, freshCodes, notifier });
registerBenevoles(app, { need, httpError, all, one, run, parse, freshCodes, batch, createSession, notifier });
registerBanque(app, { need, httpError, all, one, run, parse, stationRights, STATION_LIST_SQL });
registerProgression(app, { need, httpError, all, one });
registerMail(app, { need, httpError, all, one, run, parse, batch });
registerSystem(app, { need, all, one });

app.all('*', () => { throw httpError(404, 'Route inconnue'); });

// la tâche planifiée (tous les jours en fin d'après-midi) : rappels de la veille, purge des connexions expirées
export default {
  fetch: app.fetch,
  // deux déclencheurs : 16 h UTC pour la tâche du soir, toutes les heures pour la liste d'attente
  scheduled: (event, env, ctx) => ctx.waitUntil(event.cron === '0 16 * * *' ? nightly(env) : hourly(env)),
};
