// Données personnelles : empreinte des adresses (progression conservée après anonymisation), durées de conservation,
// purge automatique, effacement à la demande, et ce qu'affiche la page de confidentialité.
import { getSettings } from './mail.js';

export const RGPD_DEFAULTS = { volunteer_years: 3, mail_log_months: 12, waitlist_days: 60, anonymize_months: 6 };

const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

async function setting(db, key) {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first().catch(() => null);
  return r?.value ?? null;
}
async function saveSetting(db, key, value) {
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, typeof value === 'string' ? value : JSON.stringify(value)).run();
}

export async function rgpdSettings(db) {
  return { ...RGPD_DEFAULTS, ...parse(await setting(db, 'rgpd'), {}) };
}

// Sel propre à cette base, tiré une fois : sans lui, l'empreinte d'une adresse ne permet pas de la retrouver
export async function pepper(db) {
  let p = await setting(db, 'hash_salt');
  if (!p) {
    const b = new Uint8Array(24); crypto.getRandomValues(b);
    p = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    await db.prepare("INSERT INTO settings (key, value) VALUES ('hash_salt', ?) ON CONFLICT(key) DO NOTHING").bind(p).run();
    p = (await setting(db, 'hash_salt')) || p; // si deux requêtes l'ont tiré en même temps, on garde celui qui est en base
  }
  return p;
}

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function emailHash(db, email, salt = null) {
  const e = normEmail(email);
  if (!e) return null;
  return sha256(`${salt || await pepper(db)}:${e}`);
}

// Effacer un bénévole ou un évaluateur : son nom et ses coordonnées disparaissent, ses demi-journées restent dans les statistiques
export function eraseVolunteerStmts(db, id) {
  return [
    db.prepare(`UPDATE volunteers SET first_name = 'Bénévole', last_name = '#' || id, email = 'efface-' || id || '@invalide.local', phone = NULL,
      status = NULL, specialty = NULL, updated_at = datetime('now') WHERE id = ?`).bind(id),
    db.prepare('UPDATE volunteer_signups SET note = NULL WHERE volunteer_id = ?').bind(id),
    db.prepare("DELETE FROM auth_sessions WHERE kind = 'benevole' AND subject_id IN (SELECT id FROM volunteer_signups WHERE volunteer_id = ?)").bind(id),
  ];
}

// Purge de la nuit : bénévoles sans activité depuis la durée fixée, adresses du journal des e-mails, listes d'attente des sessions passées
export async function rgpdPurge(env, { now = Date.now() } = {}) {
  const db = env.DB;
  const S = await rgpdSettings(db);
  const out = { volunteers: 0, mail_log: 0, waitlist: 0 };
  const cutoff = new Date(now - S.volunteer_years * 365.25 * 864e5).toISOString().slice(0, 10);
  // dernière activité : la date de la dernière session à laquelle il s'est inscrit, ou sa date d'inscription
  const old = (await db.prepare(`SELECT v.id FROM volunteers v WHERE v.email NOT LIKE 'efface-%'
    AND COALESCE((SELECT MAX(COALESCE(e.ends_on, e.starts_on, substr(s.created_at, 1, 10))) FROM volunteer_signups s JOIN exams e ON e.id = s.exam_id WHERE s.volunteer_id = v.id),
      substr(v.created_at, 1, 10)) < ? LIMIT 40`).bind(cutoff).all().catch(() => ({ results: [] }))).results;
  if (old.length) { await db.batch(old.flatMap((v) => eraseVolunteerStmts(db, v.id))); out.volunteers = old.length; }
  const [m, w] = await db.batch([
    db.prepare(`UPDATE mail_log SET to_email = '', error = NULL WHERE to_email != '' AND created_at < datetime('now', ?)`).bind(`-${S.mail_log_months} months`),
    db.prepare(`DELETE FROM waitlist WHERE exam_id IN (SELECT id FROM exams WHERE COALESCE(ends_on, starts_on) < date('now', ?))`).bind(`-${S.waitlist_days} days`),
  ]).catch(() => [{ meta: {} }, { meta: {} }]);
  out.mail_log = m.meta?.changes ?? 0; out.waitlist = w.meta?.changes ?? 0;
  return out;
}

// Sessions terminées depuis longtemps et pas encore anonymisées : rappel sur la page État du système
export async function toAnonymize(db, S) {
  return (await db.prepare(`SELECT id, name, ends_on, (SELECT COUNT(*) FROM candidates c WHERE c.exam_id = exams.id) AS n FROM exams
    WHERE anonymized_at IS NULL AND COALESCE(ends_on, starts_on) < date('now', ?) ORDER BY ends_on`).bind(`-${S.anonymize_months} months`).all().catch(() => ({ results: [] }))).results;
}

export function registerRgpd(app, h) {
  const { need, httpError, one } = h;

  // Ce qu'affiche la page publique de confidentialité
  app.get('/public/privacy', async (c) => {
    const [S, M] = await Promise.all([rgpdSettings(c.env.DB), getSettings(c.env.DB)]);
    return c.json({ ...S, contact: M.reply_to || null });
  });

  app.get('/rgpd', need('admin'), async (c) => {
    const db = c.env.DB;
    const S = await rgpdSettings(db);
    const cutoff = new Date(Date.now() - S.volunteer_years * 365.25 * 864e5).toISOString().slice(0, 10);
    const [sessions, vols, last] = await Promise.all([
      toAnonymize(db, S),
      one(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN email LIKE 'efface-%' THEN 1 ELSE 0 END) AS erased FROM volunteers`).catch(() => null),
      setting(db, 'cron_last'),
    ]);
    const due = await one(db, `SELECT COUNT(*) AS n FROM volunteers v WHERE v.email NOT LIKE 'efface-%'
      AND COALESCE((SELECT MAX(COALESCE(e.ends_on, e.starts_on)) FROM volunteer_signups s JOIN exams e ON e.id = s.exam_id WHERE s.volunteer_id = v.id), substr(v.created_at, 1, 10)) < ?`, cutoff).catch(() => null);
    return c.json({ settings: S, to_anonymize: sessions, volunteers: { total: vols?.n || 0, erased: vols?.erased || 0, due: due?.n || 0 }, last_purge: parse(last, null)?.rgpd || null });
  });

  app.put('/rgpd', need('admin'), async (c) => {
    const b = await c.req.json();
    const S = await rgpdSettings(c.env.DB);
    const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number(v) || d));
    const next = {
      volunteer_years: clamp(b.volunteer_years ?? S.volunteer_years, 1, 5, 3),
      mail_log_months: clamp(b.mail_log_months ?? S.mail_log_months, 3, 36, 12),
      waitlist_days: clamp(b.waitlist_days ?? S.waitlist_days, 7, 365, 60),
      anonymize_months: clamp(b.anonymize_months ?? S.anonymize_months, 1, 24, 6),
    };
    await saveSetting(c.env.DB, 'rgpd', next);
    return c.json(next);
  });

  // Droit à l'effacement d'un bénévole ou d'un évaluateur
  app.post('/volunteers/:id/erase', need('admin'), async (c) => {
    const db = c.env.DB;
    const v = await one(db, 'SELECT id FROM volunteers WHERE id = ?', c.req.param('id'));
    if (!v) throw httpError(404, 'Personne introuvable');
    await db.batch(eraseVolunteerStmts(db, v.id));
    return c.json({ ok: true });
  });

  app.post('/rgpd/purge', need('admin'), async (c) => {
    const r = await rgpdPurge(c.env);
    const last = parse(await setting(c.env.DB, 'cron_last'), {}) || {};
    await saveSetting(c.env.DB, 'cron_last', { ...last, rgpd: r }).catch(() => {});
    return c.json(r);
  });
}
