// Sauvegarde hebdomadaire vers R2 : chaque session en cours ou récente, au format du bouton « Télécharger la sauvegarde »
// (réimportable depuis la liste des sessions), plus l'annuaire de l'équipe. On garde huit semaines.
// Sans le binding R2 « BACKUP » dans wrangler.jsonc, rien ne se passe et la page État du système le signale.
import { examDataset } from './dataset.js';

const KEEP_WEEKS = 8;
const parisDate = (now) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

export async function weeklyBackup(env, { now = Date.now(), force = false } = {}) {
  if (!env.BACKUP) return { off: true };
  const weekday = new Date(now).toLocaleDateString('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
  if (!force && weekday !== 'Sun') return { skipped: 'pas dimanche' };
  const db = env.DB;
  const day = parisDate(now);
  const since = parisDate(now - 120 * 864e5);
  // sessions pas encore anonymisées, en cours, à venir ou terminées depuis moins de quatre mois
  const exams = (await db.prepare('SELECT id, name FROM exams WHERE anonymized_at IS NULL AND (ends_on IS NULL OR ends_on >= ?) ORDER BY id DESC LIMIT 6').bind(since).all()).results;
  const files = [];
  for (const e of exams) {
    const json = await examDataset(db, e.id, true);
    if (!json) continue;
    const key = `sauvegardes/${day}/session-${e.id}.json`;
    await env.BACKUP.put(key, json, { httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: { session: e.name } });
    files.push({ key, size: json.length });
  }
  const [people, volunteers, signups, assignments] = await Promise.all([
    db.prepare('SELECT * FROM people').all(),
    db.prepare('SELECT * FROM volunteers').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM volunteer_signups').all().catch(() => ({ results: [] })),
    db.prepare('SELECT * FROM assignments').all().catch(() => ({ results: [] })),
  ]);
  const team = JSON.stringify({ format: 'omas-ecos-equipe', version: 1, exported_at: new Date(now).toISOString(),
    people: people.results, volunteers: volunteers.results, volunteer_signups: signups.results, assignments: assignments.results });
  await env.BACKUP.put(`sauvegardes/${day}/equipe.json`, team, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  files.push({ key: `sauvegardes/${day}/equipe.json`, size: team.length });
  // ménage : on ne garde que les huit dernières semaines
  const limit = parisDate(now - KEEP_WEEKS * 7 * 864e5);
  const old = (await env.BACKUP.list({ prefix: 'sauvegardes/', limit: 500 })).objects.map((o) => o.key).filter((k) => (k.split('/')[1] || '') < limit);
  if (old.length) await env.BACKUP.delete(old.slice(0, 200));
  return { day, files: files.length, bytes: files.reduce((a, f) => a + f.size, 0), removed: old.length };
}

// Pour la page État du système : la dernière sauvegarde présente dans R2
export async function lastBackup(env) {
  if (!env.BACKUP) return { configured: false };
  const objs = (await env.BACKUP.list({ prefix: 'sauvegardes/', limit: 500 }).catch(() => ({ objects: [] }))).objects;
  const days = [...new Set(objs.map((o) => o.key.split('/')[1]).filter(Boolean))].sort();
  const last = days[days.length - 1] || null;
  return { configured: true, last, weeks: days.length, files: last ? objs.filter((o) => o.key.startsWith(`sauvegardes/${last}/`)).map((o) => ({ key: o.key, size: o.size })) : [] };
}
