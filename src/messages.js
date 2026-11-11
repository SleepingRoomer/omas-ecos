// Messages aux salles : l'équipe écrit depuis En direct (« Pause prolongée de 5 min », « B3 : le PS change »),
// le message s'affiche en bandeau chez les évaluateurs, à l'accueil, chez les bénévoles et sur l'écran de projection.
// Gardés dans planning.broadcasts (20 derniers), visibles 45 minutes ou jusqu'à ce que l'équipe les retire.
import { normalizePlanning, liveClock } from '../public/js/planning-shared.js';
import { holdsChrono } from './benevoles.js';

export const MESSAGE_MINUTES = 45;
const live = (m, now = Date.now()) => m && !m.cleared_at && now - Date.parse(m.at) < MESSAGE_MINUTES * 60e3;

export function registerMessages(app, h) {
  const { need, httpError, one, run, parse } = h;
  const load = async (db, examId) => {
    const exam = await one(db, 'SELECT id, name, planning, starts_on, ends_on FROM exams WHERE id = ?', examId);
    if (!exam) throw httpError(404, 'Session introuvable');
    return { exam, planning: normalizePlanning(parse(exam.planning, null), exam) };
  };
  const save = (db, exam, planning) => run(db, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify(planning), exam.id);

  app.get('/exams/:id/broadcasts', need('admin'), async (c) => {
    const { planning } = await load(c.env.DB, c.req.param('id'));
    const list = (planning.broadcasts || []).slice().reverse();
    return c.json({ minutes: MESSAGE_MINUTES, list: list.map((m) => ({ ...m, live: live(m) })) });
  });

  app.post('/exams/:id/broadcasts', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await load(db, c.req.param('id'));
    const b = await c.req.json();
    const text = String(b.text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!text) throw httpError(400, 'Écris le message.');
    const slot = b.slot ? String(b.slot).slice(0, 8) : null;
    const msg = { id: Date.now(), text, slot, at: new Date().toISOString(), by: c.get('session').name || 'Organisateurs' };
    planning.broadcasts = [...(planning.broadcasts || []), msg].slice(-20);
    await save(db, exam, planning);
    return c.json({ ok: true, message: msg });
  });

  app.delete('/exams/:id/broadcasts/:mid', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await load(db, c.req.param('id'));
    planning.broadcasts = (planning.broadcasts || []).map((m) => (String(m.id) === c.req.param('mid') ? { ...m, cleared_at: new Date().toISOString() } : m));
    await save(db, exam, planning);
    return c.json({ ok: true });
  });

  // Ce que voit chacun : la session et la salle se déduisent de sa connexion
  app.get('/broadcast', need('evaluateur', 'accueil', 'benevole', 'admin'), async (c) => {
    const db = c.env.DB;
    const s = c.get('session');
    let examId = null; let slot = null;
    if (s.kind === 'evaluateur') { const st = await one(db, 'SELECT exam_id, slot FROM stations WHERE id = ?', s.subject_id); examId = st?.exam_id; slot = st?.slot; }
    else if (s.kind === 'accueil') examId = s.subject_id;
    else if (s.kind === 'benevole') {
      // un bénévole voit les messages pour toutes les salles, et ceux de la salle où il est aujourd'hui
      examId = (await one(db, 'SELECT exam_id FROM volunteer_signups WHERE id = ?', s.subject_id).catch(() => null))?.exam_id;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
      slot = (await one(db, 'SELECT st.slot FROM assignments a JOIN stations st ON st.id = a.station_id WHERE a.signup_id = ? AND a.day = ? LIMIT 1', s.subject_id, today).catch(() => null))?.slot || '-';
    } else examId = Number(c.req.query('exam')) || null;
    if (!examId) return c.json({ messages: [] });
    const exam = await one(db, 'SELECT planning FROM exams WHERE id = ?', examId);
    const list = (parse(exam?.planning, {})?.broadcasts || []).filter((m) => live(m) && (!m.slot || !slot || m.slot === slot));
    return c.json({ messages: list.slice(-3).reverse().map(({ id, text, slot: sl, at }) => ({ id, text, slot: sl, at })) });
  });

  // ---------- conduite de la série : l'accueil ou l'équipe lance chaque tour, tout le monde suit le même chrono ----------
  const examOf = async (c) => {
    const db = c.env.DB; const s = c.get('session');
    if (s.kind === 'evaluateur') return (await one(db, 'SELECT exam_id, slot FROM stations WHERE id = ?', s.subject_id)) || {};
    if (s.kind === 'accueil') return { exam_id: s.subject_id };
    if (s.kind === 'benevole') return { exam_id: (await one(db, 'SELECT exam_id FROM volunteer_signups WHERE id = ?', s.subject_id).catch(() => null))?.exam_id };
    return { exam_id: Number(c.req.query('exam')) || null };
  };

  app.post('/exams/:id/live', need('admin', 'accueil', 'benevole'), async (c) => {
    const db = c.env.DB; const s = c.get('session');
    if (s.kind === 'accueil' && Number(s.subject_id) !== Number(c.req.param('id'))) throw httpError(403, 'Accès refusé');
    if (s.kind === 'benevole' && !(await holdsChrono(db, s, c.req.param('id')))) throw httpError(403, 'Seul le bénévole du chrono peut lancer les tours.');
    const { exam, planning } = await load(db, c.req.param('id'));
    const b = await c.req.json();
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    if (b.phase === 'fin' || b.phase === 'stop') planning.live = null;
    else {
      if (!['tour', 'pause', 'debrief'].includes(b.phase)) throw httpError(400, 'Étape inconnue');
      const series = Number(b.series); const round = Number(b.round) || 1;
      if (!planning.days.find((d) => d.date === today)?.series[series - 1]) throw httpError(400, 'Cette série n\'existe pas aujourd\'hui.');
      planning.live = { day: today, series, round, phase: b.phase, started_at: new Date().toISOString(), by: s.name || (s.kind === 'benevole' ? 'Chrono' : 'Accueil') };
    }
    await save(db, exam, planning);
    return c.json({ ok: true, live: planning.live, now: Date.now() });
  });

  // Le chrono en cours, relu régulièrement par les écrans (évaluateurs, accueil, bénévoles, projection)
  app.get('/live', need('evaluateur', 'accueil', 'benevole', 'admin'), async (c) => {
    const db = c.env.DB;
    const { exam_id: examId, slot } = await examOf(c);
    if (!examId) return c.json({ live: null, now: Date.now() });
    const exam = await one(db, 'SELECT planning, starts_on, ends_on FROM exams WHERE id = ?', examId);
    const P = normalizePlanning(parse(exam?.planning, null), exam || {});
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const L = P.live && P.live.day === today ? liveClock(P.live, P) : null;
    // un chrono oublié depuis plus d'une heure ne s'affiche plus
    const stale = L && L.remaining < -60 * 60e3;
    return c.json({ live: stale ? null : L, slot: slot || null, now: Date.now() });
  });
}
