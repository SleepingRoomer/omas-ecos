import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  DEFAULT_SLOTS, STATUSES, normalizeContent, qualityChecks, computeScore, missingAnswers, rankMap,
} from '../public/js/shared.js';
import { registerJp } from './jp.js';

const app = new Hono().basePath('/api');
const COOKIE = 'omas_s';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------- utilitaires ----------

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

async function uniqueCode(db, table) {
  for (let i = 0; i < 20; i++) {
    const code = genCode();
    const col = table === 'stations' ? 'eval_code' : 'code';
    if (await one(db, `SELECT 1 FROM ${table} WHERE ${col} = ?`, code)) continue;
    if ((table === 'candidates' || table === 'jp_participants')
      && await one(db, `SELECT 1 FROM ${table === 'candidates' ? 'jp_participants' : 'candidates'} WHERE code = ?`, code)) continue;
    return code;
  }
  throw httpError(500, 'Impossible de générer un code unique');
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

app.post('/login', async (c) => {
  const { role, code, name } = await c.req.json();
  const db = c.env.DB;
  const clean = String(code || '').trim();
  if (!clean) throw httpError(400, 'Code requis');
  if (role === 'admin') {
    if (!c.env.ADMIN_PASSWORD || !safeEqual(clean, c.env.ADMIN_PASSWORD)) throw httpError(401, 'Mot de passe incorrect');
    await createSession(c, 'admin', null, 'Administrateur', 12);
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
    if (!part) throw httpError(401, 'Code inconnu');
    await createSession(c, 'participant', part.id, `${part.first_name} ${part.last_name}`);
    return c.json({ kind: 'participant' });
  }
  if (role === 'redaction') {
    const p = await one(db, 'SELECT * FROM people WHERE code = ? AND active = 1', upper);
    if (!p) throw httpError(401, 'Code inconnu');
    await createSession(c, 'auteur', p.id, p.name);
    return c.json({ kind: 'auteur' });
  }
  if (role === 'evaluateur') {
    const st = await one(db, 'SELECT * FROM stations WHERE eval_code = ?', upper);
    if (!st) throw httpError(401, 'Code de salle inconnu');
    const n = String(name || '').trim();
    if (n.length < 2) throw httpError(400, 'Indiquez votre nom');
    await createSession(c, 'evaluateur', st.id, n, 14);
    return c.json({ kind: 'evaluateur' });
  }
  throw httpError(400, 'Rôle inconnu');
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
    (SELECT COUNT(*) FROM evaluations WHERE exam_id = e.id) AS n_evaluations
    FROM exams e ORDER BY e.id DESC`);
  return c.json(rows);
});

app.post('/exams', need('admin'), async (c) => {
  const b = await c.req.json();
  if (!String(b.name || '').trim()) throw httpError(400, 'Nom requis');
  const db = c.env.DB;
  const r = await run(db, 'INSERT INTO exams (name, starts_on, ends_on) VALUES (?,?,?)', b.name.trim(), b.starts_on || null, b.ends_on || null);
  const id = r.meta.last_row_id;
  if (b.create_slots !== false) {
    for (const s of DEFAULT_SLOTS) {
      await run(db, 'INSERT INTO stations (exam_id, slot, domain, type, played, eval_code) VALUES (?,?,?,?,?,?)',
        id, s.slot, s.domain, s.type, s.played, await uniqueCode(db, 'stations'));
    }
  }
  return c.json({ id });
});

app.get('/exams/:id', need('admin'), async (c) => {
  const e = await one(c.env.DB, 'SELECT * FROM exams WHERE id = ?', c.req.param('id'));
  if (!e) throw httpError(404, 'Session introuvable');
  return c.json(e);
});

app.patch('/exams/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const fields = ['name', 'starts_on', 'ends_on', 'eval_open', 'show_results', 'show_details', 'corrections_published'];
  const sets = []; const vals = [];
  for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(typeof b[f] === 'boolean' ? (b[f] ? 1 : 0) : b[f]); }
  if (sets.length) await run(c.env.DB, `UPDATE exams SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
  return c.json({ ok: true });
});

app.delete('/exams/:id', need('admin'), async (c) => {
  const id = c.req.param('id');
  const n = await one(c.env.DB, 'SELECT COUNT(*) AS n FROM evaluations WHERE exam_id = ?', id);
  if (n.n > 0) throw httpError(400, 'Cette session contient des évaluations : suppression impossible.');
  await run(c.env.DB, 'DELETE FROM exams WHERE id = ?', id);
  return c.json({ ok: true });
});

// ---------- personnes (rédaction) ----------

app.get('/people', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `SELECT p.*,
    (SELECT COUNT(*) FROM stations WHERE author_id = p.id) AS n_author,
    (SELECT COUNT(*) FROM stations WHERE peer_id = p.id OR expert_id = p.id) AS n_review
    FROM people p ORDER BY p.active DESC, p.name`);
  return c.json(rows);
});

app.post('/people', need('admin'), async (c) => {
  const b = await c.req.json();
  const list = Array.isArray(b) ? b : [b];
  const ids = [];
  for (const p of list) {
    if (!String(p.name || '').trim()) continue;
    const r = await run(c.env.DB, 'INSERT INTO people (name, email, phone, specialty, code) VALUES (?,?,?,?,?)',
      p.name.trim(), p.email || null, p.phone || null, p.specialty || null, await uniqueCode(c.env.DB, 'people'));
    ids.push(r.meta.last_row_id);
  }
  return c.json({ ids });
});

app.patch('/people/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const sets = []; const vals = [];
  for (const f of ['name', 'email', 'phone', 'specialty', 'active']) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]); }
  if (b.regen_code) { sets.push('code = ?'); vals.push(await uniqueCode(c.env.DB, 'people')); }
  if (sets.length) await run(c.env.DB, `UPDATE people SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- stations ----------

const STATION_LIST_SQL = `SELECT s.id, s.exam_id, s.slot, s.played, s.domain, s.type, s.discipline, s.title, s.status,
  s.author_id, s.peer_id, s.expert_id, s.eval_code, s.updated_at,
  a.name AS author_name, p.name AS peer_name, x.name AS expert_name, e.name AS exam_name,
  (SELECT COUNT(*) FROM evaluations v WHERE v.station_id = s.id) AS n_evaluations,
  (SELECT COUNT(*) FROM reviews r WHERE r.station_id = s.id AND r.action = 'comment') AS n_comments
  FROM stations s
  JOIN exams e ON e.id = s.exam_id
  LEFT JOIN people a ON a.id = s.author_id
  LEFT JOIN people p ON p.id = s.peer_id
  LEFT JOIN people x ON x.id = s.expert_id`;

app.get('/exams/:id/stations', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `${STATION_LIST_SQL} WHERE s.exam_id = ? ORDER BY s.played DESC, s.slot`, c.req.param('id'));
  return c.json(rows);
});

app.post('/exams/:id/stations', need('admin'), async (c) => {
  const b = await c.req.json();
  const slot = String(b.slot || '').trim().toUpperCase();
  if (!slot) throw httpError(400, 'Emplacement requis (ex. R3)');
  const r = await run(c.env.DB, 'INSERT INTO stations (exam_id, slot, domain, type, played, eval_code) VALUES (?,?,?,?,?,?)',
    c.req.param('id'), slot, b.domain || null, b.type || 'SANS', b.played ? 1 : 0, await uniqueCode(c.env.DB, 'stations'));
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
  if (b.regen_code) { sets.push('eval_code = ?'); vals.push(await uniqueCode(db, 'stations')); }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    await run(db, `UPDATE stations SET ${sets.join(', ')} WHERE id = ?`, ...vals, st.id);
  }
  if (b.status && b.status !== st.status) {
    await run(db, 'INSERT INTO reviews (station_id, author_name, stage, action, comment) VALUES (?,?,?,?,?)',
      st.id, 'Administrateur', st.status, 'status', `Statut changé : ${STATUSES[st.status]} → ${STATUSES[b.status]}`);
  }
  return c.json({ ok: true });
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
  return c.json(rows);
});

app.get('/stations/:id', need('admin', 'auteur', 'evaluateur'), async (c) => {
  const db = c.env.DB;
  const st = await one(db, `${STATION_LIST_SQL} WHERE s.id = ?`, c.req.param('id'));
  if (!st) throw httpError(404, 'Station introuvable');
  const rights = stationRights(c.get('session'), st);
  if (!rights.read) throw httpError(403, 'Accès refusé');
  const full = await one(db, 'SELECT content FROM stations WHERE id = ?', st.id);
  const content = normalizeContent(parse(full.content, {}));
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
  }
  await run(db, 'INSERT INTO reviews (station_id, author_name, stage, action, comment) VALUES (?,?,?,?,?)',
    st.id, s.name || 'Administrateur', st.status, action, text || null);
  return c.json({ ok: true });
});

// ---------- candidats ----------

app.get('/exams/:id/candidates', need('admin'), async (c) => {
  const rows = await all(c.env.DB, `SELECT c.*, (SELECT COUNT(*) FROM evaluations v WHERE v.candidate_id = c.id) AS n_evaluations
    FROM candidates c WHERE c.exam_id = ? ORDER BY c.day, c.series, c.number, c.last_name`, c.req.param('id'));
  return c.json(rows);
});

app.post('/exams/:id/candidates', need('admin'), async (c) => {
  const examId = c.req.param('id');
  const b = await c.req.json();
  const list = Array.isArray(b.rows) ? b.rows : [b];
  let n = 0;
  for (const r of list) {
    if (!String(r.last_name || '').trim() && !String(r.first_name || '').trim()) continue;
    await run(c.env.DB, `INSERT INTO candidates (exam_id, last_name, first_name, email, phone, faculty, year, slot_label, day, series, status, code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, examId, String(r.last_name || '').trim(), String(r.first_name || '').trim(),
    r.email || null, r.phone || null, r.faculty || null, r.year || null, r.slot_label || null, r.day || null,
    r.series ? Number(r.series) : null, r.status === 'annule' ? 'annule' : 'inscrit', await uniqueCode(c.env.DB, 'candidates'));
    n++;
  }
  return c.json({ imported: n });
});

app.patch('/candidates/:id', need('admin'), async (c) => {
  const b = await c.req.json();
  const sets = []; const vals = [];
  for (const f of ['last_name', 'first_name', 'email', 'phone', 'faculty', 'year', 'slot_label', 'day', 'series', 'status', 'number']) {
    if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] === '' ? null : b[f]); }
  }
  if (b.regen_code) { sets.push('code = ?'); vals.push(await uniqueCode(c.env.DB, 'candidates')); }
  if (sets.length) await run(c.env.DB, `UPDATE candidates SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
  return c.json({ ok: true });
});

app.delete('/candidates/:id', need('admin'), async (c) => {
  const n = await one(c.env.DB, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', c.req.param('id'));
  if (n.n > 0) throw httpError(400, 'Ce candidat a des évaluations : passez-le plutôt en « annulé ».');
  await run(c.env.DB, 'DELETE FROM candidates WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

// Attribue un créneau (jour + série) à tous les candidats d'un même libellé de billetterie
app.post('/exams/:id/candidates/assign-slot', need('admin'), async (c) => {
  const { slot_label, day, series } = await c.req.json();
  await run(c.env.DB, 'UPDATE candidates SET day = ?, series = ? WHERE exam_id = ? AND slot_label = ?',
    day || null, series ? Number(series) : null, c.req.param('id'), slot_label);
  return c.json({ ok: true });
});

// Numérote les candidats : J<jour>-S<série>-<nn>, dans l'ordre alphabétique
app.post('/exams/:id/candidates/renumber', need('admin'), async (c) => {
  const db = c.env.DB;
  const examId = c.req.param('id');
  const rows = await all(db, `SELECT id, day, series FROM candidates WHERE exam_id = ? AND status != 'annule'
    AND day IS NOT NULL AND series IS NOT NULL ORDER BY day, series, last_name, first_name`, examId);
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const counters = {};
  const stmts = [];
  for (const r of rows) {
    const key = `${r.day}|${r.series}`;
    counters[key] = (counters[key] || 0) + 1;
    const num = `J${days.indexOf(r.day) + 1}-S${r.series}-${String(counters[key]).padStart(2, '0')}`;
    stmts.push(db.prepare('UPDATE candidates SET number = ? WHERE id = ?').bind(num, r.id));
  }
  stmts.push(db.prepare("UPDATE candidates SET number = NULL WHERE exam_id = ? AND (status = 'annule' OR day IS NULL OR series IS NULL)").bind(examId));
  await db.batch(stmts);
  return c.json({ numbered: rows.length });
});

// ---------- résultats ----------

async function examResults(db, examId) {
  const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', examId);
  if (!exam) throw httpError(404, 'Session introuvable');
  const stations = (await all(db, 'SELECT id, slot, domain, type, title, discipline, played, content FROM stations WHERE exam_id = ? ORDER BY slot', examId))
    .map((s) => ({ ...s, content: normalizeContent(parse(s.content, {})) }));
  const candidates = await all(db, "SELECT * FROM candidates WHERE exam_id = ? AND status != 'annule'", examId);
  const evals = (await all(db, 'SELECT * FROM evaluations WHERE exam_id = ?', examId))
    .map((e) => ({ ...e, answers: parse(e.answers, {}) }));
  const played = stations.filter((s) => s.played);

  // par station : moyenne et rangs
  const stationStats = {};
  for (const s of stations) {
    const ev = evals.filter((e) => e.station_id === s.id && !e.absent && e.score !== null);
    const scores = ev.map((e) => e.score);
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const sd = scores.length > 1 ? Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1)) : null;
    stationStats[s.id] = {
      n: scores.length, mean, sd,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      ranks: rankMap(ev.map((e) => ({ id: e.candidate_id, value: e.score }))),
    };
  }

  // par candidat : moyenne des stations passées, complétude, rang
  const perCandidate = candidates.map((cand) => {
    const ev = evals.filter((e) => e.candidate_id === cand.id);
    const scored = ev.filter((e) => !e.absent && e.score !== null);
    const avg = scored.length ? scored.reduce((a, b) => a + b.score, 0) / scored.length : null;
    const done = played.every((s) => ev.some((e) => e.station_id === s.id));
    return { cand, ev, avg, done, n: ev.length };
  });
  const completed = perCandidate.filter((p) => p.done && p.avg !== null);
  const ranks = rankMap(completed.map((p) => ({ id: p.cand.id, value: p.avg })));
  return { exam, stations, played, candidates, evals, stationStats, perCandidate, completed, ranks };
}

app.get('/exams/:id/results', need('admin'), async (c) => {
  const R = await examResults(c.env.DB, c.req.param('id'));
  const rows = R.perCandidate.map((p) => ({
    id: p.cand.id, number: p.cand.number, name: `${p.cand.last_name} ${p.cand.first_name}`, day: p.cand.day, series: p.cand.series,
    avg: p.avg, done: p.done, n: p.n, rank: R.ranks.get(p.cand.id) ?? null,
    scores: Object.fromEntries(p.ev.map((e) => [e.station_id, e.absent ? 'abs' : e.score])),
  })).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.avg ?? -1) - (a.avg ?? -1));

  const stations = R.stations.map((s) => {
    const st = R.stationStats[s.id];
    const ev = R.evals.filter((e) => e.station_id === s.id && !e.absent);
    const items = s.content.grille.apt.filter((i) => i.label?.trim()).map((i) => ({
      id: i.id, label: i.label,
      rate: ev.length ? ev.filter((e) => e.answers?.apt?.[i.id]?.ok === true).length / ev.length : null,
    }));
    const com = s.content.grille.com.filter((i) => i.label?.trim()).map((i) => ({
      id: i.id, label: i.label,
      mean: ev.length ? ev.reduce((a, e) => a + (Number(e.answers?.com?.[i.id]) || 0), 0) / ev.length : null,
    }));
    const byGlobal = [0, 1, 2, 3, 4].map((g) => {
      const x = ev.filter((e) => e.global === g && e.score !== null);
      return { level: g, n: x.length, mean: x.length ? x.reduce((a, e) => a + e.score, 0) / x.length : null };
    });
    const evaluators = [...new Set(ev.map((e) => e.evaluator_name))].map((name) => {
      const x = ev.filter((e) => e.evaluator_name === name && e.score !== null);
      return { name, n: x.length, mean: x.length ? x.reduce((a, e) => a + e.score, 0) / x.length : null };
    });
    return {
      id: s.id, slot: s.slot, title: s.title, domain: s.domain, discipline: s.discipline, played: s.played,
      n: st.n, mean: st.mean, sd: st.sd, min: st.min, max: st.max, items, com, byGlobal, evaluators,
    };
  });
  return c.json({ exam: R.exam, rows, stations, completed: R.completed.length, total: R.candidates.length });
});

app.get('/exams/:id/results.csv', need('admin'), async (c) => {
  const R = await examResults(c.env.DB, c.req.param('id'));
  const head = ['Rang', 'Numéro', 'Nom', 'Prénom', 'E-mail', 'Moyenne /20', 'Complet', ...R.played.map((s) => `${s.slot} ${s.title || ''}`.trim())];
  const lines = [head];
  for (const p of [...R.perCandidate].sort((a, b) => (R.ranks.get(a.cand.id) ?? 1e9) - (R.ranks.get(b.cand.id) ?? 1e9))) {
    lines.push([R.ranks.get(p.cand.id) ?? '', p.cand.number ?? '', p.cand.last_name, p.cand.first_name, p.cand.email ?? '',
      p.avg === null ? '' : p.avg.toFixed(2).replace('.', ','), p.done ? 'oui' : 'non',
      ...R.played.map((s) => { const e = p.ev.find((x) => x.station_id === s.id); return !e ? '' : e.absent ? 'absent' : String(e.score).replace('.', ','); })]);
  }
  const csv = '﻿' + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="resultats.csv"' } });
});

// Bulletin d'un candidat (vue étudiant, aussi utilisée par l'admin)
async function candidateReport(db, candidateId, asAdmin) {
  const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', candidateId);
  if (!cand) throw httpError(404, 'Candidat introuvable');
  const R = await examResults(db, cand.exam_id);
  const ex = R.exam;
  const me = R.perCandidate.find((p) => p.cand.id === cand.id);
  const showResults = asAdmin || ex.show_results;
  const showDetails = asAdmin || ex.show_details;
  const showCorr = asAdmin || ex.corrections_published;
  const stations = R.played.map((s) => {
    const e = me?.ev.find((x) => x.station_id === s.id);
    const st = R.stationStats[s.id];
    const out = { slot: s.slot, title: s.title, domain: s.domain, discipline: s.discipline, evaluated: !!e, absent: !!e?.absent };
    if (e && !e.absent && showResults) {
      out.score = e.score; out.points = e.points; out.max_points = e.max_points;
      out.rank = st.ranks.get(cand.id) ?? null; out.n = st.n; out.mean = st.mean;
      if (showDetails) {
        out.apt = s.content.grille.apt.filter((i) => i.label?.trim()).map((i) => ({
          label: i.label, points: Number(i.points) > 0 ? Number(i.points) : 1,
          ok: e.answers?.apt?.[i.id]?.ok === true, comment: e.answers?.apt?.[i.id]?.comment || '',
        }));
        out.com = s.content.grille.com.filter((i) => i.label?.trim()).map((i) => ({ label: i.label, value: Number(e.answers?.com?.[i.id]) || 0 }));
        out.comment = e.comment || '';
        out.evaluator = e.evaluator_name;
      }
    }
    if (showCorr) out.correction = { text: s.content.pedago.correction, references: s.content.pedago.references };
    return out;
  });
  return {
    candidate: { number: cand.number, first_name: cand.first_name, last_name: cand.last_name, day: cand.day, series: cand.series },
    exam: { name: ex.name, show_results: !!showResults, show_details: !!showDetails, corrections_published: !!showCorr },
    summary: showResults ? {
      avg: me?.avg ?? null, done: !!me?.done, evaluated: me?.n ?? 0, total_stations: R.played.length,
      rank: R.ranks.get(cand.id) ?? null, ranked: R.completed.length, registered: R.candidates.length,
      cohort_mean: R.completed.length ? R.completed.reduce((a, p) => a + p.avg, 0) / R.completed.length : null,
    } : null,
    stations,
    updated_at: new Date().toISOString(),
  };
}

app.get('/me/results', need('etudiant'), async (c) => c.json(await candidateReport(c.env.DB, c.get('session').subject_id, false)));
app.get('/candidates/:id/report', need('admin'), async (c) => c.json(await candidateReport(c.env.DB, c.req.param('id'), true)));

// ---------- évaluateurs ----------

app.get('/eval/context', need('evaluateur'), async (c) => {
  const db = c.env.DB;
  const st = await one(db, 'SELECT * FROM stations WHERE id = ?', c.get('session').subject_id);
  if (!st) throw httpError(404, 'Station introuvable');
  const exam = await one(db, 'SELECT id, name, eval_open FROM exams WHERE id = ?', st.exam_id);
  const content = normalizeContent(parse(st.content, {}));
  const candidates = await all(db, `SELECT c.id, c.number, c.first_name, c.last_name, c.day, c.series,
    v.id AS eval_id, v.absent, v.score, v.evaluator_name
    FROM candidates c LEFT JOIN evaluations v ON v.candidate_id = c.id AND v.station_id = ?
    WHERE c.exam_id = ? AND c.status != 'annule' ORDER BY c.day, c.series, c.number, c.last_name`, st.id, st.exam_id);
  return c.json({
    evaluator: c.get('session').name,
    exam,
    station: { id: st.id, slot: st.slot, title: st.title, domain: st.domain, discipline: st.discipline, type: st.type },
    vignette: content.vignette, examinateur: content.examinateur, grille: content.grille,
    candidates,
  });
});

app.get('/eval/evaluations/:candidateId', need('evaluateur'), async (c) => {
  const e = await one(c.env.DB, 'SELECT * FROM evaluations WHERE station_id = ? AND candidate_id = ?',
    c.get('session').subject_id, c.req.param('candidateId'));
  return c.json(e ? { ...e, answers: parse(e.answers, {}) } : null);
});

app.put('/eval/evaluations', need('evaluateur'), async (c) => {
  const db = c.env.DB;
  const s = c.get('session');
  const st = await one(db, 'SELECT * FROM stations WHERE id = ?', s.subject_id);
  const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', st.exam_id);
  if (!exam.eval_open) throw httpError(403, 'La saisie est fermée pour cette session.');
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
  await run(db, `INSERT INTO evaluations (exam_id, station_id, candidate_id, evaluator_name, absent, answers, global, comment, points, max_points, score)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(station_id, candidate_id) DO UPDATE SET evaluator_name = excluded.evaluator_name, absent = excluded.absent,
      answers = excluded.answers, global = excluded.global, comment = excluded.comment, points = excluded.points,
      max_points = excluded.max_points, score = excluded.score, updated_at = datetime('now')`,
  st.exam_id, st.id, cand.id, s.name, absent ? 1 : 0, JSON.stringify(answers), absent ? null : global,
  absent ? null : (String(b.comment || '').trim() || null), points, max, score);
  return c.json({ ok: true, score });
});

app.delete('/evaluations/:id', need('admin'), async (c) => {
  await run(c.env.DB, 'DELETE FROM evaluations WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

registerJp(app, { need, httpError, all, one, run, uniqueCode, parse });

app.all('*', () => { throw httpError(404, 'Route inconnue'); });

export default app;
