// Comptes nominatifs de l'équipe et journal des actions sensibles.
// Chaque membre a son propre code (montré une seule fois, gardé en base sous forme d'empreinte) ; le mot de passe commun
// ADMIN_PASSWORD reste un accès de secours, qu'on peut refuser une fois les comptes créés.
import { sha256, pepper } from './rgpd.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genSecret(len = 12) { const b = new Uint8Array(len); crypto.getRandomValues(b); return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join(''); }
const codeHash = async (db, code) => sha256(`team:${await pepper(db)}:${String(code).trim().toUpperCase().replace(/[\s-]+/g, '')}`);
const fmtCode = (c) => c.replace(/(.{4})(?=.)/g, '$1-');

async function teamOnly(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'team_only'").first().catch(() => null);
  return r?.value === '1';
}

// Connexion de l'équipe : renvoie { name, member_id } ou null
export async function teamLogin(env, db, code) {
  const clean = String(code || '').trim();
  const member = await db.prepare('SELECT * FROM team_members WHERE code_hash = ? AND active = 1').bind(await codeHash(db, clean)).first().catch(() => null);
  if (member) {
    await db.prepare("UPDATE team_members SET last_login_at = datetime('now') WHERE id = ?").bind(member.id).run();
    return { name: member.name, member_id: member.id };
  }
  if (env.ADMIN_PASSWORD && safeEqual(clean, env.ADMIN_PASSWORD)) {
    if (await teamOnly(db)) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE active = 1').first().catch(() => ({ n: 0 }));
      if (n.n > 0) return { refused: true };
    }
    return { name: 'Administrateur', member_id: null };
  }
  return null;
}
function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------- journal ----------
// Libellés lisibles des actions de l'équipe. Le contenu des requêtes n'est jamais gardé (données personnelles).
const ACTIONS = [
  [/^POST \/login$/, 'Connexion d\'un organisateur'],
  [/^DELETE \/exams\/\d+$/, 'Suppression d\'une session'],
  [/^POST \/exams$/, 'Création d\'une session'],
  [/^PATCH \/exams\/\d+$/, 'Réglages d\'une session'],
  [/^POST \/exams\/\d+\/anonymize$/, 'Anonymisation d\'une session'],
  [/^GET \/exams\/\d+\/export$/, 'Téléchargement d\'une sauvegarde complète'],
  [/^GET \/exams\/\d+\/results\.csv$/, 'Export des résultats (CSV)'],
  [/^POST \/exams\/\d+\/regen-room-codes$/, 'Nouveaux codes de salle'],
  [/^POST \/exams\/\d+\/candidates$/, 'Import ou ajout de candidats'],
  [/^PATCH \/candidates\/\d+$/, 'Modification d\'un candidat'],
  [/^DELETE \/candidates\/\d+$/, 'Suppression d\'un candidat'],
  [/^DELETE \/evaluations\/\d+$/, 'Suppression d\'une grille'],
  [/^POST \/import\//, 'Restauration d\'une sauvegarde'],
  [/^DELETE \/people\/\d+$/, 'Suppression d\'un rédacteur'],
  [/^DELETE \/signups\/\d+$/, 'Retrait d\'un bénévole'],
  [/^POST \/volunteers\/\d+\/erase$/, 'Effacement d\'un bénévole (RGPD)'],
  [/^(POST|PATCH|DELETE) \/team/, 'Comptes des organisateurs'],
  [/^PUT \/team\/settings$/, 'Accès des organisateurs'],
  [/^PUT \/rgpd$/, 'Durées de conservation'],
  [/^POST \/rgpd\/purge$/, 'Purge des données personnelles'],
  [/^PATCH \/claims\/\d+$/, 'Réponse à une réclamation'],
  [/^PUT \/mail\/settings$/, 'Réglages des e-mails'],
  [/^POST \/exams\/\d+\/mail\//, 'Envoi groupé d\'e-mails'],
  [/^POST \/waitlist\/\d+\/offer$/, 'Place proposée depuis la liste d\'attente'],
  [/^DELETE \/exams\/\d+\/test-candidates$/, 'Suppression des étudiants fictifs'],
];
export const auditLabel = (method, path) => ACTIONS.find(([re]) => re.test(`${method} ${path}`))?.[1] || null;

export async function audit(c, s, method, path, label) {
  const db = c.env.DB;
  await db.prepare('INSERT INTO audit_log (who, member_id, action, method, path, ip) VALUES (?,?,?,?,?,?)')
    .bind(s?.name || '?', s?.kind === 'admin' ? s.subject_id ?? null : null, label, method, path.slice(0, 120), c.req.header('CF-Connecting-IP') || 'local').run().catch(() => {});
}

// Après chaque réponse de l'API : si un membre de l'équipe vient de faire une action sensible, on la note
export const auditMiddleware = async (c, next) => {
  await next();
  const s = c.get('session');
  if (s?.kind !== 'admin' || c.res.status >= 400) return;
  const path = new URL(c.req.url).pathname.replace(/^\/api/, '');
  const label = auditLabel(c.req.method, path);
  if (!label || path === '/login') return;
  const p = audit(c, s, c.req.method, path, label);
  try { c.executionCtx.waitUntil(p); } catch { await p; }
};

export function registerTeam(app, h) {
  const { need, httpError, all, one, run } = h;

  app.get('/team', need('admin'), async (c) => {
    const db = c.env.DB;
    const [members, log, only] = await Promise.all([
      all(db, 'SELECT id, name, email, active, last_login_at, created_at FROM team_members ORDER BY active DESC, name').catch(() => null),
      all(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').catch(() => []),
      teamOnly(db),
    ]);
    const s = c.get('session');
    return c.json({ ready: members !== null, members: members || [], log, team_only: only, me: { name: s.name, member_id: s.subject_id ?? null } });
  });

  app.post('/team', need('admin'), async (c) => {
    const db = c.env.DB;
    const b = await c.req.json();
    const name = String(b.name || '').trim().slice(0, 80);
    if (name.length < 2) throw httpError(400, 'Indique le nom de la personne.');
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || '').trim()) ? String(b.email).trim().toLowerCase() : null;
    const code = genSecret();
    await run(db, 'INSERT INTO team_members (name, email, code_hash) VALUES (?,?,?)', name, email, await codeHash(db, code))
      .catch((e) => { throw httpError(400, /no such table/.test(String(e)) ? 'Colle d\'abord la migration 0014 dans la console D1.' : 'Création impossible.'); });
    return c.json({ ok: true, code: fmtCode(code) });
  });

  app.patch('/team/:id', need('admin'), async (c) => {
    const db = c.env.DB;
    const m = await one(db, 'SELECT * FROM team_members WHERE id = ?', c.req.param('id'));
    if (!m) throw httpError(404, 'Membre introuvable');
    const b = await c.req.json();
    const s = c.get('session');
    if ('active' in b) {
      if (!b.active && s.subject_id === m.id) throw httpError(400, 'Tu ne peux pas désactiver ton propre compte.');
      await run(db, 'UPDATE team_members SET active = ? WHERE id = ?', b.active ? 1 : 0, m.id);
      if (!b.active) await run(db, "DELETE FROM auth_sessions WHERE kind = 'admin' AND subject_id = ?", m.id);
    }
    if (b.regen) {
      const code = genSecret();
      await run(db, 'UPDATE team_members SET code_hash = ? WHERE id = ?', await codeHash(db, code), m.id);
      await run(db, "DELETE FROM auth_sessions WHERE kind = 'admin' AND subject_id = ?", m.id);
      return c.json({ ok: true, code: fmtCode(code) });
    }
    return c.json({ ok: true });
  });

  // Refuser le mot de passe commun : seulement depuis un compte nominatif, pour ne pas s'enfermer dehors
  app.put('/team/settings', need('admin'), async (c) => {
    const db = c.env.DB;
    const { team_only } = await c.req.json();
    const s = c.get('session');
    if (team_only && !s.subject_id) throw httpError(400, 'Connecte-toi d\'abord avec ton propre code avant de refuser le mot de passe commun.');
    await run(db, "INSERT INTO settings (key, value) VALUES ('team_only', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", team_only ? '1' : '0');
    if (team_only) await run(db, "DELETE FROM auth_sessions WHERE kind = 'admin' AND subject_id IS NULL");
    return c.json({ ok: true });
  });
}
