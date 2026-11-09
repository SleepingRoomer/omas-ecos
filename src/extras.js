// Communication (OMAS, OMAS Externat, agenda), avis des étudiants
import { normalizePlanning } from '../public/js/planning-shared.js';

export const DEFAULT_ABOUT = {
  omas: "L'OMAS, Organisation Musulmane des Acteurs de Santé, est une association loi 1901 à but non lucratif, présente dans plusieurs villes de France. Elle rassemble des étudiants et des professionnels de santé de toutes les filières, et elle est ouverte à tous, sans condition de confession.\n\nSa mission tient en trois mots : former des soignants compétents, engagés et attentifs à l'éthique ; servir la santé de tous par la prévention et l'éducation à la santé ; fédérer un réseau d'acteurs de santé qui se transmettent ce qu'ils savent.",
  externat: "OMAS Externat accompagne les externes jusqu'aux ECOS et à l'internat : ECOS blancs, journées procédure, ateliers et ressources.\n\nNotre ambition est simple : un entraînement de qualité, accessible à tous, sans chercher à faire de profit. Les tarifs couvrent les frais d'organisation, et tout le reste repose sur des bénévoles, étudiants et internes, qui ont envie de transmettre.",
  links: [],
  events: [],
};

const okUrl = (u) => /^https:\/\/[^\s<>"']+$/i.test(String(u || '').trim());

export function registerExtras(app, h) {
  const { need, httpError, all, one, run, parse } = h;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

  async function about(db) {
    const row = await one(db, "SELECT value FROM settings WHERE key = 'about'");
    return { ...DEFAULT_ABOUT, ...(row ? parse(row.value, {}) : {}) };
  }

  // Public : aucune donnée personnelle, seulement la présentation et les dates à venir
  app.get('/about', async (c) => {
    const db = c.env.DB;
    const t = today();
    const [A, exams, jps] = await Promise.all([
      about(db),
      all(db, 'SELECT id, name, starts_on, ends_on, planning FROM exams WHERE COALESCE(ends_on, starts_on) >= ? ORDER BY starts_on', t),
      all(db, `SELECT j.id, j.name, j.starts_on, j.ends_on, (SELECT group_concat(day) FROM (SELECT DISTINCT day FROM jp_slots WHERE jp_id = j.id ORDER BY day)) AS days
        FROM jp_days j WHERE COALESCE(j.ends_on, j.starts_on) >= ? ORDER BY j.starts_on`, t),
    ]);
    const upcoming = [
      ...exams.filter((e) => !/test|fictif/i.test(e.name)).map((e) => {
        const P = normalizePlanning(parse(e.planning, null), e);
        return { kind: 'ecos', title: e.name, days: P.days.map((d) => d.date).filter((d) => d >= t) };
      }),
      ...jps.filter((j) => !/test|fictif/i.test(j.name)).map((j) => ({ kind: 'jp', title: j.name, days: String(j.days || j.starts_on || '').split(',').filter((d) => d && d >= t) })),
      ...(A.events || []).filter((e) => e.date && e.date >= t).map((e) => ({ kind: 'autre', title: e.title, days: [e.date], place: e.place, text: e.text, url: okUrl(e.url) ? e.url : null })),
    ].filter((e) => e.days.length).sort((a, b) => a.days[0].localeCompare(b.days[0]));
    return c.json({ omas: A.omas, externat: A.externat, links: (A.links || []).filter((l) => okUrl(l.url)), upcoming, events: A.events || [] });
  });

  app.put('/about', need('admin'), async (c) => {
    const b = await c.req.json();
    const clean = {
      omas: String(b.omas || '').slice(0, 4000), externat: String(b.externat || '').slice(0, 4000),
      links: (b.links || []).filter((l) => String(l.label || '').trim() && okUrl(l.url)).slice(0, 12)
        .map((l) => ({ label: String(l.label).trim().slice(0, 60), url: String(l.url).trim() })),
      events: (b.events || []).filter((e) => String(e.title || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '')).slice(0, 40)
        .map((e) => ({ title: String(e.title).trim().slice(0, 120), date: e.date, place: String(e.place || '').slice(0, 120), text: String(e.text || '').slice(0, 400), url: okUrl(e.url) ? String(e.url).trim() : '' })),
    };
    const bad = (b.links || []).filter((l) => String(l.url || '').trim() && !okUrl(l.url)).length + (b.events || []).filter((e) => String(e.url || '').trim() && !okUrl(e.url)).length;
    await run(c.env.DB, "INSERT INTO settings (key, value) VALUES ('about', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')", JSON.stringify(clean));
    return c.json({ ok: true, ignored_links: bad });
  });

  // ---------- avis des étudiants ----------
  const SCALE = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);

  app.get('/me/feedback', need('etudiant'), async (c) => {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', c.get('session').subject_id);
    const [ev, mine, slots] = await Promise.all([
      one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', cand.id),
      one(db, 'SELECT answers, comment, updated_at FROM feedback WHERE exam_id = ? AND candidate_id = ?', cand.exam_id, cand.id),
      all(db, 'SELECT slot FROM stations WHERE exam_id = ? AND played = 1 ORDER BY slot', cand.exam_id),
    ]);
    const open = ev.n > 0 || (cand.day && cand.day < today());
    return c.json({ open, slots: slots.map((s) => s.slot), mine: mine ? { ...parse(mine.answers, {}), comment: mine.comment, updated_at: mine.updated_at } : null });
  });

  app.post('/me/feedback', need('etudiant'), async (c) => {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', c.get('session').subject_id);
    const ev = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', cand.id);
    if (!(ev.n > 0 || (cand.day && cand.day < today()))) throw httpError(400, 'Le questionnaire ouvre après ton passage.');
    const b = await c.req.json();
    const slots = (await all(db, 'SELECT slot FROM stations WHERE exam_id = ? AND played = 1', cand.exam_id)).map((s) => s.slot);
    const answers = {
      global: SCALE(b.global, 5), organisation: SCALE(b.organisation, 5), recommend: SCALE(b.recommend, 10),
      stations: Object.fromEntries(slots.map((s) => [s, SCALE(b.stations?.[s], 5)]).filter(([, v]) => v !== null)),
    };
    if (answers.global === null) throw httpError(400, 'Donne au moins ta note globale.');
    await run(db, `INSERT INTO feedback (exam_id, candidate_id, answers, comment) VALUES (?,?,?,?)
      ON CONFLICT(exam_id, candidate_id) DO UPDATE SET answers = excluded.answers, comment = excluded.comment, updated_at = datetime('now')`,
    cand.exam_id, cand.id, JSON.stringify(answers), String(b.comment || '').trim().slice(0, 2000) || null);
    return c.json({ ok: true });
  });

  // Synthèse pour l'équipe : anonyme, jamais de nom à côté d'un avis
  app.get('/exams/:id/feedback', need('admin'), async (c) => {
    const rows = await all(c.env.DB, 'SELECT answers, comment, updated_at FROM feedback WHERE exam_id = ? ORDER BY updated_at DESC', c.req.param('id'));
    return c.json(rows.map((r) => ({ ...parse(r.answers, {}), comment: r.comment, at: r.updated_at })));
  });
}
