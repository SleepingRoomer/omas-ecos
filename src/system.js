// État du système (page de l'équipe) et tâche planifiée de la nuit.
// Les migrations sont collées à la main dans la console D1 : on vérifie ici que les tables et colonnes attendues existent.
import { dailyReminders, mailReady } from './mail.js';

// Ce que chaque migration doit avoir créé : table, ou table.colonne
export const MIGRATIONS = [
  ['0001_init', ['exams', 'people', 'stations', 'reviews', 'candidates', 'evaluations', 'auth_sessions']],
  ['0002_journees_procedure', ['jp_days', 'jp_ateliers', 'jp_reviews', 'jp_slots', 'jp_participants']],
  ['0003_binomes', ['evaluations~evaluator_name[^,]*COLLATE NOCASE', 'candidates.extra']],
  ['0004_planning', ['exams.planning', 'candidates.seat', 'candidates.confirmed_at', 'swaps']],
  ['0005_swap_responses', ['swap_responses']],
  ['0006_wishes', ['candidates.wishes', 'candidates.wishes_at']],
  ['0007_securite', ['login_failures', 'evaluations.ip']],
  ['0008_communication', ['settings', 'feedback']],
  ['0009_accueil', ['candidates.checkin', 'candidates.checked_in_at', 'waitlist']],
  ['0010_benevoles', ['volunteers', 'volunteer_signups', 'assignments', 'calibrations', 'calibration_answers']],
  ['0011_banque', ['station_files', 'stations.origin_id']],
  ['0012_mails_rgpd', ['mail_log', 'exams.anonymized_at']],
];

// SQLite garde le texte du CREATE TABLE à jour après un ALTER TABLE ADD COLUMN : une seule requête suffit
export async function checkMigrations(db) {
  const rows = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all()).results;
  const tables = new Map(rows.map((r) => [r.name, r.sql || '']));
  const has = (spec) => {
    if (spec.includes('~')) {
      const [t, re] = spec.split('~');
      return tables.has(t) && new RegExp(re, 'i').test(tables.get(t).replace(/\s+/g, ' '));
    }
    const [t, col] = spec.split('.');
    if (!tables.has(t)) return false;
    if (!col) return true;
    return new RegExp(`[(,]\\s*"?${col}"?\\s`, 'i').test(tables.get(t).replace(/\s+/g, ' '));
  };
  return MIGRATIONS.map(([name, specs]) => {
    const missing = specs.filter((s) => !has(s)).map((s) => (s.includes('~') ? `${s.split('~')[0]} (structure à refaire)` : s));
    return { name, ok: !missing.length, missing };
  });
}

async function setting(db, key) {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first().catch(() => null);
  try { return JSON.parse(r?.value); } catch { return r?.value ?? null; }
}
async function saveSetting(db, key, value) {
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value)).run().catch(() => {});
}

// Purge : connexions expirées, tentatives de connexion anciennes
export async function purge(db) {
  const now = new Date().toISOString();
  const [a, b] = await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now),
    db.prepare("DELETE FROM login_failures WHERE at < datetime('now', '-1 day')"),
  ]);
  return { sessions: a.meta?.changes ?? 0, failures: b.meta?.changes ?? 0 };
}

// Tâche planifiée : les rappels d'abord (ils ont une heure à respecter), la purge ensuite, puis le compte rendu
export async function nightly(env) {
  const db = env.DB;
  const started = new Date().toISOString();
  const out = { at: started, reminders: null, purge: null, error: null };
  try { out.reminders = await dailyReminders(env); } catch (e) { out.error = `rappels : ${String(e.message || e).slice(0, 200)}`; }
  try { out.purge = await purge(db); } catch (e) { out.error = `${out.error ? `${out.error} ; ` : ''}purge : ${String(e.message || e).slice(0, 200)}`; }
  out.ms = Date.now() - new Date(started).getTime();
  await saveSetting(db, 'cron_last', out);
  return out;
}

// Prochaine exécution de la tâche planifiée (0 16 * * * UTC)
export function nextCron(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16, 0, 0));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function registerSystem(app, h) {
  const { need, all, one } = h;

  app.get('/system/status', need('admin'), async (c) => {
    const db = c.env.DB;
    const env = c.env;
    const count = (sql) => one(db, sql).then((r) => r?.n ?? null).catch(() => null);
    const [migrations, cronLast, mailSettings, d1mig, sessions, expired, failures, mails, mailFailed, lastMail] = await Promise.all([
      checkMigrations(db),
      setting(db, 'cron_last'),
      setting(db, 'mail'),
      all(db, 'SELECT name, applied_at FROM d1_migrations ORDER BY id').catch(() => null),
      count('SELECT COUNT(*) AS n FROM auth_sessions'),
      count(`SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at < '${new Date().toISOString()}'`),
      count("SELECT COUNT(*) AS n FROM login_failures WHERE at > datetime('now', '-1 day')"),
      count("SELECT COUNT(*) AS n FROM mail_log WHERE created_at > datetime('now', '-30 days') AND status = 'sent'"),
      count("SELECT COUNT(*) AS n FROM mail_log WHERE created_at > datetime('now', '-30 days') AND status = 'failed'"),
      one(db, 'SELECT created_at, status, error FROM mail_log ORDER BY id DESC LIMIT 1').catch(() => null),
    ]);
    return c.json({
      now: new Date().toISOString(),
      migrations: { list: migrations, all_ok: migrations.every((m) => m.ok), tracked_by_wrangler: d1mig },
      mail: {
        ready: mailReady(env), missing: ['BREVO_API_KEY', 'MAIL_FROM'].filter((k) => !env[k]),
        from: env.MAIL_FROM || null, from_name: env.MAIL_FROM_NAME || 'INES · OMAS Externat (par défaut)',
        reply_to: mailSettings?.reply_to || null, auto: mailSettings ? Object.fromEntries(Object.entries(mailSettings).filter(([k]) => k.startsWith('auto_'))) : null,
        sent_30d: mails, failed_30d: mailFailed, last: lastMail,
      },
      cron: { last: cronLast, next: nextCron(), schedule: '0 16 * * * (UTC), soit 17 h en hiver et 18 h en été à Paris' },
      sessions: { total: sessions, expired, failures_24h: failures },
      secrets: { ADMIN_PASSWORD: !!env.ADMIN_PASSWORD, BREVO_API_KEY: !!env.BREVO_API_KEY, MAIL_FROM: !!env.MAIL_FROM, MAIL_FROM_NAME: !!env.MAIL_FROM_NAME, SITE_URL: !!env.SITE_URL },
    });
  });

  // Lancer la purge tout de suite, sans attendre la nuit
  app.post('/system/purge', need('admin'), async (c) => c.json(await purge(c.env.DB)));

  // Lancer la tâche de la nuit à la main (les rappels ne partent qu'une fois : le journal des e-mails fait foi)
  app.post('/system/run-nightly', need('admin'), async (c) => c.json(await nightly(c.env)));
}
