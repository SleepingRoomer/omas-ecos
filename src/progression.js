// Fiches procédures (membres connectés) et progression d'un étudiant d'une session à l'autre
import { FICHES, FICHES_META } from './fiches-data.js';
import { emailHash } from './rgpd.js';

export function registerProgression(app, h) {
  const { need, httpError, all, one } = h;
  const MEMBERS = ['etudiant', 'participant', 'admin', 'benevole', 'auteur'];

  app.get('/fiches', need(...MEMBERS), (c) => c.json({ meta: FICHES_META, fiches: FICHES.map(({ html, ...f }) => f) }));
  app.get('/fiches/:id', need(...MEMBERS), (c) => {
    const i = FICHES.findIndex((f) => f.id === c.req.param('id'));
    if (i < 0) throw httpError(404, 'Fiche introuvable');
    return c.json({ ...FICHES[i], prev: FICHES[i - 1]?.id || null, next: FICHES[i + 1]?.id || null });
  });

  // Toutes les sessions passées avec la même adresse e-mail : moyenne, rang, moyenne de la promo, et détail par domaine.
  // Le calcul se fait dans la base, une requête par session dans un seul batch.
  app.get('/me/progression', need('etudiant'), async (c) => {
    const db = c.env.DB;
    const me = await one(db, 'SELECT id, email, exam_id, first_name, last_name FROM candidates WHERE id = ?', c.get('session').subject_id);
    if (!me?.email) return c.json({ sessions: [] });
    // sessions où la même adresse est encore en clair, et sessions anonymisées où seule son empreinte est restée
    const hash = await emailHash(db, me.email);
    const rows = await all(db, `SELECT c.id, c.exam_id, e.name, e.starts_on FROM candidates c JOIN exams e ON e.id = c.exam_id
      WHERE ((lower(c.email) = lower(?) AND (lower(c.last_name) = lower(?) OR lower(c.first_name) = lower(?))) OR json_extract(c.extra, '$.email_hash') = ?)
        AND c.status != 'annule' AND (e.show_results = 1 OR c.id = ?) ORDER BY e.starts_on, e.id`, me.email, me.last_name, me.first_name, hash, me.id);
    if (!rows.length) return c.json({ sessions: [] });
    const stmts = rows.map((r) => db.prepare(`WITH st AS (SELECT candidate_id, station_id, AVG(score) AS s FROM evaluations WHERE exam_id = ? AND absent = 0 AND score IS NOT NULL GROUP BY candidate_id, station_id),
        ca AS (SELECT candidate_id, AVG(s) AS a, COUNT(*) AS n FROM st GROUP BY candidate_id),
        cpl AS (SELECT * FROM ca WHERE n >= (SELECT COUNT(*) FROM stations WHERE exam_id = ? AND played = 1))
      SELECT (SELECT a FROM ca WHERE candidate_id = ?) AS avg, (SELECT n FROM ca WHERE candidate_id = ?) AS n,
        (SELECT AVG(a) FROM cpl) AS cohort, (SELECT COUNT(*) FROM cpl) AS ranked,
        (SELECT COUNT(*) + 1 FROM cpl WHERE a > (SELECT a FROM cpl WHERE candidate_id = ?)) AS rank,
        (SELECT 1 FROM cpl WHERE candidate_id = ?) AS complete`).bind(r.exam_id, r.exam_id, r.id, r.id, r.id, r.id));
    const ids = rows.map((r) => r.id);
    stmts.push(db.prepare(`SELECT v.candidate_id, s.domain, AVG(v.score) AS score,
        (SELECT AVG(o.score) FROM evaluations o WHERE o.station_id = s.id AND o.absent = 0) AS mean
      FROM evaluations v JOIN stations s ON s.id = v.station_id
      WHERE v.candidate_id IN (${ids.map(() => '?').join(',')}) AND v.absent = 0 GROUP BY v.candidate_id, s.id`).bind(...ids));
    const res = await db.batch(stmts);
    const dom = res.pop().results;
    return c.json({ sessions: rows.map((r, i) => {
      const x = res[i].results[0] || {};
      const by = {};
      for (const d of dom.filter((d) => d.candidate_id === r.id && d.domain)) {
        const b = (by[d.domain] ||= { score: 0, mean: 0, n: 0 }); b.score += d.score; b.mean += d.mean || 0; b.n += 1;
      }
      return { name: r.name, starts_on: r.starts_on, current: r.id === me.id, avg: x.avg ?? null, cohort: x.cohort ?? null,
        rank: x.complete ? x.rank : null, ranked: x.ranked || 0,
        domains: Object.fromEntries(Object.entries(by).map(([k, b]) => [k, { score: b.score / b.n, mean: b.mean / b.n, n: b.n }])) };
    }).filter((s) => s.avg !== null) });
  });
}
