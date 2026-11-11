// Répétition de A à Z avec des données fictives, dans une vraie session d'INES (en production comme en local).
// Tout ce qui est créé ici porte une adresse en @exemple.org : aucun e-mail ne part vers ces adresses,
// les grilles ne sont simulées que pour ces candidats-là, et tout se supprime d'un clic.
// Les noms et les titres restent naturels (pas de « (fictif) ») : on reconnaît les personnes à leur adresse
// et les stations d'exemple au repère demo de leur contenu (ou, pour les anciennes, à « (exemple) » en fin de titre).
import { STATIONS, contentFor } from '../scripts/demo/stations.mjs';
import { normalizePlanning, toMin } from '../public/js/planning-shared.js';
import { normalizeContent, computeScore } from '../public/js/shared.js';

const FAKE = '%@exemple.org';
const DEMO_STATION = "(json_extract(content, '$.demo') = 1 OR title LIKE '%(exemple)')";
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const slug = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.');
// pseudo-hasard reproductible : la même répétition donne les mêmes notes
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };

const WRITERS = [['Yasmine Haddad', 'Cardiologie'], ['Karim Benali', 'Médecine d\'urgence'], ['Sarah Lemaire', 'Pneumologie'], ['Mehdi Ouali', 'Neurologie'], ['Inès Chabane', 'Endocrinologie'], ['Omar Diallo', 'Hépato-gastro-entérologie']];
const EVALS = [['Amina', 'Rahmani', 'Médecin', 'Cardiologie'], ['Yanis', 'Belkacem', 'Interne', 'Médecine générale'], ['Sofia', 'Mansouri', 'Chef de clinique', 'Pneumologie'],
  ['Nour', 'Haddad', 'Interne', 'Pédiatrie'], ['Mehdi', 'Cherif', 'Docteur junior', 'Médecine d\'urgence'], ['Hugo', 'Petit', 'Médecin', 'Médecine interne'], ['Claire', 'Roux', 'Interne', 'Neurologie'],
  ['Rayan', 'Toumi', 'Interne', 'Endocrinologie'], ['Léa', 'Garnier', 'Médecin', 'Gynécologie'], ['Bilal', 'Kaci', 'Chef de clinique', 'Hématologie'], ['Emma', 'Fontaine', 'Interne', 'Psychiatrie'],
  ['Samir', 'Bouzid', 'Médecin', 'Médecine générale'], ['Julie', 'Marchand', 'Interne', 'Rhumatologie'], ['Ismaël', 'Traoré', 'Docteur junior', 'Urologie']];
const VOLS = [['Lina', 'Bouzid', ['ps']], ['Adam', 'Meziane', ['ps', 'pss']], ['Sara', 'Khelifi', ['ps']], ['Ilyes', 'Rahal', ['pss']], ['Maryam', 'Benamar', ['ps', 'logistique']],
  ['Sofiane', 'Aït', ['logistique']], ['Hajar', 'Lahlou', ['logistique', 'ps']], ['Nassim', 'Ferrah', ['pss', 'logistique']]];

export function registerDemo(app, h) {
  const { need, httpError, all, one, freshCodes, multiInsert, batch } = h;

  async function examOf(db, id) {
    const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', id);
    if (!exam) throw httpError(404, 'Session introuvable');
    if (exam.anonymized_at) throw httpError(400, 'Session anonymisée.');
    return { exam, planning: normalizePlanning(parse(exam.planning, null), exam) };
  }

  // Ce qu'il y a déjà de fictif dans la session, pour l'affichage du panneau
  app.get('/exams/:id/demo', need('admin'), async (c) => {
    const db = c.env.DB; const id = c.req.param('id');
    const [cands, vols, people, grids, stations] = await Promise.all([
      one(db, 'SELECT COUNT(*) AS n FROM candidates WHERE exam_id = ? AND email LIKE ?', id, FAKE),
      one(db, 'SELECT COUNT(*) AS n FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.exam_id = ? AND v.email LIKE ?', id, FAKE).catch(() => ({ n: 0 })),
      one(db, 'SELECT COUNT(*) AS n FROM people WHERE email LIKE ?', FAKE),
      one(db, 'SELECT COUNT(*) AS n FROM evaluations v JOIN candidates c ON c.id = v.candidate_id WHERE v.exam_id = ? AND c.email LIKE ?', id, FAKE),
      one(db, `SELECT COUNT(*) AS n FROM stations WHERE exam_id = ? AND ${DEMO_STATION}`, id),
    ]);
    return c.json({ candidates: cands.n, volunteers: vols.n, people: people.n, grids: grids.n, stations: stations.n });
  });

  // Stations d'exemple dans les emplacements vides, et des rédacteurs fictifs pour le circuit
  app.post('/exams/:id/demo/stations', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam } = await examOf(db, c.req.param('id'));
    let people = await all(db, 'SELECT id FROM people WHERE email LIKE ? ORDER BY id', FAKE);
    if (people.length < WRITERS.length) {
      const codes = await freshCodes(db, WRITERS.length);
      await batch(db, multiInsert(db, 'people', ['name', 'email', 'specialty', 'code'],
        WRITERS.map(([n, sp], i) => ({ name: `Dr ${n}`, email: `redaction.${slug(n)}@exemple.org`, specialty: sp, code: codes[i] }))));
      people = await all(db, 'SELECT id FROM people WHERE email LIKE ? ORDER BY id', FAKE);
    }
    const stations = await all(db, 'SELECT id, slot, title, content FROM stations WHERE exam_id = ?', exam.id);
    const empty = stations.filter((s) => STATIONS[s.slot] && !s.title && !(normalizeContent(parse(s.content, {})).grille.apt || []).some((i) => i.label?.trim()));
    const pid = (k) => people[k % people.length].id;
    // les stations jouées sont prêtes ; les deux réserves restent dans le circuit de relecture, pour essayer les relances
    await batch(db, empty.map((s, k) => db.prepare(`UPDATE stations SET title = ?, discipline = ?, content = ?, status = ?, author_id = ?, peer_id = ?, expert_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(STATIONS[s.slot].title, STATIONS[s.slot].discipline, JSON.stringify({ ...normalizeContent(contentFor(s.slot)), demo: 1 }),
        s.slot === 'R1' ? 'relecture_pair' : s.slot === 'R2' ? 'redaction' : 'validee', pid(k), pid(k + 2), pid(k + 4), s.id)));
    return c.json({ filled: empty.length, skipped: stations.length - empty.length });
  });

  // Évaluateurs, PS, PSS et logistique fictifs, disponibles sur toutes les demi-journées de la session
  app.post('/exams/:id/demo/volunteers', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await examOf(db, c.req.param('id'));
    const halfdays = planning.days.flatMap((d) => [...new Set(d.series.map((s) => (toMin(s.start) < 12 * 60 ? 'am' : 'pm')))].map((x) => `${d.date}|${x}`));
    if (!halfdays.length) throw httpError(400, 'Règle d\'abord les jours de la session.');
    const people = [
      ...EVALS.map(([f, l, st, sp], i) => ({ f, l, st, sp, roles: ['evaluateur'], prefs: { track: 'evaluateur', disciplines: [sp], first_time: i % 3 === 0 }, email: `evaluateur.${slug(f + l)}@exemple.org` })),
      ...VOLS.map(([f, l, roles]) => ({ f, l, st: 'Externe', sp: 'DFASM2', roles, prefs: { track: 'benevole' }, email: `benevole.${slug(f + l)}@exemple.org` })),
    ];
    await batch(db, multiInsert(db, 'volunteers', ['email', 'first_name', 'last_name', 'status', 'specialty'],
      people.map((p) => ({ email: p.email, first_name: p.f, last_name: p.l, status: p.st, specialty: p.sp })), 'ON CONFLICT(email) DO NOTHING'));
    const ids = Object.fromEntries((await all(db, 'SELECT id, email FROM volunteers WHERE email LIKE ?', FAKE)).map((v) => [v.email, v.id]));
    const already = new Set((await all(db, 'SELECT volunteer_id FROM volunteer_signups WHERE exam_id = ?', exam.id)).map((r) => r.volunteer_id));
    const todo = people.filter((p) => ids[p.email] && !already.has(ids[p.email]));
    const codes = await freshCodes(db, todo.length);
    const rows = todo.map((p, i) => ({ exam_id: exam.id, volunteer_id: ids[p.email], roles: JSON.stringify(p.roles),
      // les évaluateurs peuvent venir toute la session ; les bénévoles une demi-journée par jour, en alternant
      halfdays: JSON.stringify(p.prefs.track === 'evaluateur' ? halfdays : planning.days.map((d, k) => `${d.date}|${(i + k) % 2 ? 'pm' : 'am'}`).filter((x) => halfdays.includes(x))),
      note: '', code: codes[i], prefs: JSON.stringify(p.prefs) }));
    await batch(db, multiInsert(db, 'volunteer_signups', ['exam_id', 'volunteer_id', 'roles', 'halfdays', 'note', 'code', 'prefs'], rows))
      .catch(() => batch(db, multiInsert(db, 'volunteer_signups', ['exam_id', 'volunteer_id', 'roles', 'halfdays', 'note', 'code'], rows.map(({ prefs, ...r }) => r))));
    return c.json({ added: rows.length });
  });

  // Grilles simulées pour les candidats fictifs d'un jour (ou d'une série) : de quoi tester résultats, analyse et réclamations
  app.post('/exams/:id/demo/grids', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam } = await examOf(db, c.req.param('id'));
    const { day, series = null } = await c.req.json();
    const [cands, stations, assigns] = await Promise.all([
      all(db, `SELECT c.id, c.seat, c.series FROM candidates c WHERE c.exam_id = ? AND c.email LIKE ? AND c.status != 'annule' AND c.day = ? AND c.seat IS NOT NULL ${series ? 'AND c.series = ?' : ''}`,
        ...[exam.id, FAKE, day, ...(series ? [Number(series)] : [])]),
      all(db, 'SELECT id, slot, content FROM stations WHERE exam_id = ? AND played = 1', exam.id),
      all(db, `SELECT a.station_id, a.half, v.first_name || ' ' || v.last_name AS name FROM assignments a JOIN volunteer_signups s ON s.id = a.signup_id
        JOIN volunteers v ON v.id = s.volunteer_id WHERE a.exam_id = ? AND a.day = ? AND a.role = 'evaluateur' AND a.station_id IS NOT NULL`, exam.id, day).catch(() => []),
    ]);
    if (!cands.length) throw httpError(400, 'Aucun candidat fictif placé ce jour-là (adresses en @exemple.org, avec une place).');
    const grilles = stations.map((s) => ({ ...s, g: normalizeContent(parse(s.content, {})).grille })).filter((s) => s.g.apt.some((i) => i.label?.trim()));
    if (!grilles.length) throw httpError(400, 'Les stations jouées n\'ont pas encore de grille : ajoute d\'abord les stations d\'exemple.');
    const rows = [];
    for (const cand of cands) {
      const ability = 0.4 + 0.5 * hash(`cand${cand.id}`);
      for (const st of grilles) {
        const half = cand.series <= 2 ? 'am' : 'pm';
        const names = assigns.filter((a) => a.station_id === st.id && a.half === half).map((a) => a.name);
        const raters = names.length ? names : [`Évaluateur de la salle ${st.slot}`];
        const absent = hash(`abs${cand.id}`) < 0.03;
        for (const name of raters) {
          const answers = { apt: {}, com: {} };
          st.g.apt.filter((i) => i.label?.trim()).forEach((i, k) => { answers.apt[i.id] = { ok: hash(`${cand.id}${st.slot}${k}${name}`) < ability }; });
          st.g.com.filter((i) => i.label?.trim()).forEach((i, k) => { answers.com[i.id] = Math.round(Math.min(1, Math.max(0, ability + (hash(`c${cand.id}${k}${name}`) - 0.5) * 0.5)) * 4) / 4; });
          const sc = computeScore(st.g, answers, absent);
          rows.push({ exam_id: exam.id, station_id: st.id, candidate_id: cand.id, evaluator_name: name, absent: absent ? 1 : 0, answers: JSON.stringify(absent ? {} : answers),
            global: absent ? null : Math.max(0, Math.min(4, Math.round(ability * 5 - 0.5))), comment: !absent && hash(`m${cand.id}${st.slot}`) < 0.3 ? 'Bon début, pense à hiérarchiser tes hypothèses avant de conclure.' : null,
            points: sc.points, max_points: sc.max, score: sc.score });
        }
      }
    }
    await batch(db, multiInsert(db, 'evaluations', ['exam_id', 'station_id', 'candidate_id', 'evaluator_name', 'absent', 'answers', 'global', 'comment', 'points', 'max_points', 'score'],
      rows, 'ON CONFLICT(station_id, candidate_id, evaluator_name) DO NOTHING'));
    return c.json({ candidates: cands.length, grids: rows.length });
  });

  // Tout ce qui est fictif disparaît : candidats et leurs grilles, bénévoles, rédacteurs, et le contenu des stations d'exemple
  app.delete('/exams/:id/demo', need('admin'), async (c) => {
    const db = c.env.DB; const id = c.req.param('id');
    const stmts = [
      db.prepare("DELETE FROM auth_sessions WHERE kind = 'etudiant' AND subject_id IN (SELECT id FROM candidates WHERE exam_id = ? AND email LIKE ?)").bind(id, FAKE),
      db.prepare('DELETE FROM swaps WHERE exam_id = ? AND (candidate_id IN (SELECT id FROM candidates WHERE email LIKE ?) OR partner_id IN (SELECT id FROM candidates WHERE email LIKE ?))').bind(id, FAKE, FAKE),
      db.prepare('DELETE FROM waitlist WHERE exam_id = ? AND email LIKE ?').bind(id, FAKE),
      db.prepare('DELETE FROM candidates WHERE exam_id = ? AND email LIKE ?').bind(id, FAKE),
      db.prepare("DELETE FROM evaluations WHERE exam_id = ? AND candidate_id IN (SELECT id FROM candidates WHERE exam_id = ? AND email LIKE ?)").bind(id, id, FAKE),
      db.prepare("DELETE FROM evaluations WHERE exam_id = ? AND evaluator_name LIKE 'Évaluateur fictif %'").bind(id),
      db.prepare(`UPDATE stations SET title = NULL, discipline = NULL, content = '{}', status = 'a_attribuer', author_id = NULL, peer_id = NULL, expert_id = NULL WHERE exam_id = ? AND ${DEMO_STATION} AND NOT EXISTS (SELECT 1 FROM evaluations v WHERE v.station_id = stations.id)`).bind(id),
    ];
    await db.batch(stmts);
    // bénévoles et rédacteurs fictifs : partout, puisqu'ils ne servent qu'aux répétitions
    await db.batch([
      db.prepare("DELETE FROM auth_sessions WHERE kind = 'benevole' AND subject_id IN (SELECT s.id FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE v.email LIKE ?)").bind(FAKE),
      db.prepare('DELETE FROM volunteers WHERE email LIKE ?').bind(FAKE),
    ]).catch(() => {});
    const writers = await all(db, 'SELECT id FROM people WHERE email LIKE ?', FAKE);
    if (writers.length) {
      const ph = writers.map(() => '?').join(',');
      await db.batch([
        db.prepare(`UPDATE stations SET author_id = NULL WHERE author_id IN (${ph})`).bind(...writers.map((w) => w.id)),
        db.prepare(`UPDATE stations SET peer_id = NULL WHERE peer_id IN (${ph})`).bind(...writers.map((w) => w.id)),
        db.prepare(`UPDATE stations SET expert_id = NULL WHERE expert_id IN (${ph})`).bind(...writers.map((w) => w.id)),
        db.prepare(`UPDATE jp_ateliers SET author_id = NULL WHERE author_id IN (${ph})`).bind(...writers.map((w) => w.id)),
        db.prepare(`UPDATE jp_ateliers SET reviewer_id = NULL WHERE reviewer_id IN (${ph})`).bind(...writers.map((w) => w.id)),
        db.prepare(`DELETE FROM auth_sessions WHERE kind = 'auteur' AND subject_id IN (${ph})`).bind(...writers.map((w) => w.id)),
        db.prepare('DELETE FROM people WHERE email LIKE ?').bind(FAKE),
      ]);
    }
    return c.json({ ok: true });
  });
}
