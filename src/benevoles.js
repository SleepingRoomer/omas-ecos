// Bénévoles : inscription par session, disponibilités par demi-journée, affectation aux salles,
// connexion par code personnel, calibration avant la session, suivi d'une session à l'autre.
import { toMin } from '../public/js/planning-shared.js';
import { normalizeContent, computeScore } from '../public/js/shared.js';
import { examState, closedMessage } from './state.js';

export const ROLES = { evaluateur: 'Évaluateur', ps: 'Patient standardisé', pss: 'Professionnel de santé standardisé', logistique: 'Accueil et logistique' };
// Postes du planning : les rôles d'inscription, plus le PS ou PSS de réserve (prêt à remplacer un absent)
export const POSTS = { ...ROLES, reserve: 'PS ou PSS de réserve', chrono: 'Chrono de la série' };
const HALVES = { am: 'matin', pm: 'après-midi' };

// Le bénévole connecté tient-il le chrono de cette session (poste « chrono » du planning des salles) ?
export async function holdsChrono(db, s, examId) {
  if (s?.kind !== 'benevole') return false;
  const r = await db.prepare("SELECT 1 AS ok FROM assignments WHERE signup_id = ? AND exam_id = ? AND role = 'chrono' LIMIT 1").bind(s.subject_id, Number(examId)).first().catch(() => null);
  return !!r;
}

export function registerBenevoles(app, h) {
  const { need, httpError, all, one, run, parse, freshCodes, batch, createSession } = h;
  const ip = (c) => c.req.header('CF-Connecting-IP') || 'local';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const nowMin = () => { const [hh, mm] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':').map(Number); return hh * 60 + mm; };

  async function planningOf(db, examId) {
    const exam = await one(db, 'SELECT e.*, (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id AND s.played = 1) AS n_played FROM exams e WHERE e.id = ?', examId);
    if (!exam) throw httpError(404, 'Session introuvable');
    const S = examState(exam, exam.n_played);
    return { exam, planning: S.planning, state: S };
  }
  // Les demi-journées d'une session : un jour, matin ou après-midi, selon l'heure de début des séries
  const halfdaysOf = (P) => P.days.flatMap((d) => {
    const halves = [...new Set(d.series.map((s) => (toMin(s.start) < 12 * 60 ? 'am' : 'pm')))];
    return halves.map((hf) => ({ key: `${d.date}|${hf}`, day: d.date, half: hf }));
  });

  // ---------- inscription publique ----------
  // Deux portes d'entrée pour une même table : les bénévoles (externes, PS, PSS, logistique) et les évaluateurs
  // (médecins, internes), qui ont leur propre lien, leur propre formulaire et peuvent venir la journée entière.
  const EVAL_STATUS = ['Médecin', 'Interne', 'Docteur junior', 'Chef de clinique', 'Autre soignant'];
  const disciplinesOf = async (db, examId) => (await all(db, "SELECT DISTINCT COALESCE(NULLIF(discipline, ''), domain) AS d FROM stations WHERE exam_id = ? AND played = 1 AND COALESCE(NULLIF(discipline, ''), domain) IS NOT NULL ORDER BY d", examId)).map((r) => r.d);

  app.get('/public/exams/:id/benevoles', async (c) => {
    const { exam, planning } = await planningOf(c.env.DB, c.req.param('id'));
    return c.json({ id: exam.id, name: exam.name, open: !!planning.volunteers_open, halfdays: halfdaysOf(planning), roles: ROLES });
  });
  app.get('/public/exams/:id/evaluateurs', async (c) => {
    const { exam, planning } = await planningOf(c.env.DB, c.req.param('id'));
    return c.json({ id: exam.id, name: exam.name, open: !!planning.evaluators_open, halfdays: halfdaysOf(planning), place: planning.place,
      per_room: planning.evaluators_per_room || 2, disciplines: await disciplinesOf(c.env.DB, exam.id), statuses: EVAL_STATUS });
  });

  async function signup(c, track) {
    const db = c.env.DB;
    const { exam, planning } = await planningOf(db, c.req.param('id'));
    const isEval = track === 'evaluateur';
    if (!(isEval ? planning.evaluators_open : planning.volunteers_open)) throw httpError(400, isEval ? 'Les inscriptions des évaluateurs ne sont pas ouvertes.' : 'Les inscriptions des bénévoles ne sont pas ouvertes.');
    const recent = await one(db, "SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND role = 'benevole' AND at > datetime('now', '-1 hour')", ip(c));
    if (recent.n >= 8) throw httpError(429, 'Trop d\'inscriptions depuis cette connexion : réessaie dans une heure.');
    const b = await c.req.json();
    const t = (v, n = 120) => String(v || '').trim().slice(0, n);
    const email = t(b.email, 160).toLowerCase();
    if (!t(b.first_name) || !t(b.last_name)) throw httpError(400, 'Indique ton nom et ton prénom.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    const roles = isEval ? ['evaluateur'] : (b.roles || []).filter((r) => ROLES[r]);
    if (!roles.length) throw httpError(400, 'Choisis au moins un rôle.');
    const valid = new Set(halfdaysOf(planning).map((x) => x.key));
    let halfdays = [...new Set((b.halfdays || []).filter((k) => valid.has(k)))];
    if (!isEval) {
      // bénévoles : une demi-journée par jour au plus, on ne garde que la première cochée pour chaque jour
      const perDay = new Map(); for (const k of halfdays) if (!perDay.has(k.split('|')[0])) perDay.set(k.split('|')[0], k);
      halfdays = [...perDay.values()];
    }
    if (!halfdays.length) throw httpError(400, 'Coche au moins une demi-journée.');
    const prefs = isEval ? {
      track: 'evaluateur',
      disciplines: (Array.isArray(b.disciplines) ? b.disciplines : []).map((x) => t(x, 60)).filter(Boolean).slice(0, 12),
      first_time: !!b.first_time,
    } : { track: 'benevole' };
    await run(db, `INSERT INTO volunteers (email, first_name, last_name, phone, status, specialty) VALUES (?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, phone = COALESCE(excluded.phone, phone),
      status = excluded.status, specialty = excluded.specialty, updated_at = datetime('now')`,
    email, t(b.first_name), t(b.last_name), t(b.phone, 30) || null, t(b.status, 40) || null, t(b.specialty, 80) || null);
    const v = await one(db, 'SELECT id FROM volunteers WHERE email = ?', email);
    const prev = await one(db, 'SELECT code FROM volunteer_signups WHERE exam_id = ? AND volunteer_id = ?', exam.id, v.id);
    const code = prev?.code || (await freshCodes(db, 1))[0];
    const vals = [exam.id, v.id, JSON.stringify(roles), JSON.stringify(halfdays), t(b.note, 300) || null, code];
    const ins = (withPrefs) => db.prepare(`INSERT INTO volunteer_signups (exam_id, volunteer_id, roles, halfdays, note, code${withPrefs ? ', prefs' : ''}) VALUES (?,?,?,?,?,?${withPrefs ? ',?' : ''})
        ON CONFLICT(exam_id, volunteer_id) DO UPDATE SET roles = excluded.roles, halfdays = excluded.halfdays, note = excluded.note${withPrefs ? ', prefs = excluded.prefs' : ''}`)
      .bind(...vals, ...(withPrefs ? [JSON.stringify(prefs)] : []));
    const hit = db.prepare("INSERT INTO login_failures (ip, role) VALUES (?, 'benevole')").bind(ip(c));
    // sans la migration 0013 (colonne prefs), l'inscription passe quand même, sans les préférences
    await db.batch([ins(true), hit]).catch(() => db.batch([ins(false), hit]));
    if (!prev) {
      const sg = await one(db, 'SELECT id FROM volunteer_signups WHERE exam_id = ? AND volunteer_id = ?', exam.id, v.id);
      h.notifier?.(c).volunteer(sg.id);
    }
    return c.json({ ok: true, code, updated: !!prev });
  }
  app.post('/public/exams/:id/benevoles', (c) => signup(c, 'benevole'));
  app.post('/public/exams/:id/evaluateurs', (c) => signup(c, 'evaluateur'));

  // ---------- équipe ----------
  app.get('/exams/:id/benevoles', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await planningOf(db, c.req.param('id'));
    const [signups, assigns, stations, calib, grids] = await Promise.all([
      all(db, `SELECT s.id, s.roles, s.halfdays, s.note, s.code, s.created_at, s.prefs, v.id AS volunteer_id, v.first_name, v.last_name, v.email, v.phone, v.status, v.specialty
        FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.exam_id = ? ORDER BY v.last_name, v.first_name`, exam.id)
        .catch(() => all(db, `SELECT s.id, s.roles, s.halfdays, s.note, s.code, s.created_at, NULL AS prefs, v.id AS volunteer_id, v.first_name, v.last_name, v.email, v.phone, v.status, v.specialty
        FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.exam_id = ? ORDER BY v.last_name, v.first_name`, exam.id)),
      all(db, 'SELECT id, signup_id, day, half, role, station_id FROM assignments WHERE exam_id = ?', exam.id),
      all(db, 'SELECT id, slot, title, type, domain, discipline FROM stations WHERE exam_id = ? AND played = 1 ORDER BY slot', exam.id),
      all(db, `SELECT k.id, k.station_id, a.signup_id, a.agreement, a.score, a.ref_score FROM calibrations k LEFT JOIN calibration_answers a ON a.calibration_id = k.id WHERE k.exam_id = ?`, exam.id),
      all(db, 'SELECT lower(evaluator_name) AS n, COUNT(*) AS k FROM evaluations WHERE exam_id = ? GROUP BY lower(evaluator_name)', exam.id),
    ]);
    const gridsBy = Object.fromEntries(grids.map((g) => [g.n, g.k]));
    return c.json({
      exam: { id: exam.id, name: exam.name }, open: !!planning.volunteers_open, evaluators_open: !!planning.evaluators_open, per_room: planning.evaluators_per_room || 2,
      halfdays: halfdaysOf(planning), roles: POSTS, stations, assignments: assigns,
      calibrations: [...new Map(calib.map((k) => [k.id, { id: k.id, station_id: k.station_id }])).values()],
      signups: signups.map((s) => ({ ...s, roles: parse(s.roles, []), halfdays: parse(s.halfdays, []), prefs: parse(s.prefs, null) || { track: 'benevole' },
        grids: gridsBy[`${s.first_name} ${s.last_name}`.toLowerCase()] || 0,
        calibration: calib.filter((k) => k.signup_id === s.id).map((k) => ({ station_id: k.station_id, agreement: k.agreement, score: k.score, ref_score: k.ref_score })) })),
    });
  });

  app.put('/exams/:id/benevoles/settings', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await planningOf(db, c.req.param('id'));
    const b = await c.req.json();
    const next = { ...planning };
    if ('open' in b) next.volunteers_open = !!b.open;
    if ('evaluators_open' in b) next.evaluators_open = !!b.evaluators_open;
    if ('per_room' in b) next.evaluators_per_room = Math.min(3, Math.max(1, Number(b.per_room) || 2));
    await run(db, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify(next), exam.id);
    return c.json({ ok: true });
  });

  // Remplace toutes les affectations d'une demi-journée (ou de toute la session) d'un coup
  app.put('/exams/:id/assignments', need('admin'), async (c) => {
    const db = c.env.DB;
    const examId = Number(c.req.param('id'));
    const { items = [], scope = null } = await c.req.json();
    const signups = new Set((await all(db, 'SELECT id FROM volunteer_signups WHERE exam_id = ?', examId)).map((s) => s.id));
    const stations = new Set((await all(db, 'SELECT id FROM stations WHERE exam_id = ?', examId)).map((s) => s.id));
    const clean = items.filter((a) => signups.has(a.signup_id) && POSTS[a.role] && /^\d{4}-\d{2}-\d{2}$/.test(a.day) && HALVES[a.half])
      .map((a) => ({ exam_id: examId, signup_id: a.signup_id, day: a.day, half: a.half, role: a.role, station_id: stations.has(a.station_id) ? a.station_id : null }));
    const del = scope ? db.prepare('DELETE FROM assignments WHERE exam_id = ? AND day = ? AND half = ?').bind(examId, scope.day, scope.half)
      : db.prepare('DELETE FROM assignments WHERE exam_id = ?').bind(examId);
    const stmts = [del];
    const per = 14;
    for (let i = 0; i < clean.length; i += per) {
      const chunk = clean.slice(i, i + per);
      stmts.push(db.prepare(`INSERT INTO assignments (exam_id, signup_id, day, half, role, station_id) VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(',')}
        ON CONFLICT(exam_id, signup_id, day, half) DO UPDATE SET role = excluded.role, station_id = excluded.station_id`)
        .bind(...chunk.flatMap((a) => [a.exam_id, a.signup_id, a.day, a.half, a.role, a.station_id])));
    }
    await batch(db, stmts);
    return c.json({ ok: true, n: clean.length });
  });

  app.delete('/signups/:id', need('admin'), async (c) => {
    const db = c.env.DB;
    await db.batch([
      db.prepare("DELETE FROM auth_sessions WHERE kind = 'benevole' AND subject_id = ?").bind(c.req.param('id')),
      db.prepare('DELETE FROM volunteer_signups WHERE id = ?').bind(c.req.param('id')),
    ]);
    return c.json({ ok: true });
  });

  // ---------- espace du bénévole ----------
  async function meSignup(c) {
    const db = c.env.DB;
    const s = await one(db, `SELECT s.*, v.first_name, v.last_name, v.email, v.status FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.id = ?`,
      c.get('session').subject_id);
    if (!s) throw httpError(404, 'Inscription introuvable');
    return { db, s, ...(await planningOf(db, s.exam_id)) };
  }

  app.get('/benevole/me', need('benevole'), async (c) => {
    const { db, s, exam, planning, state } = await meSignup(c);
    const [assigns, calibs, history] = await Promise.all([
      all(db, `SELECT a.day, a.half, a.role, a.station_id, st.slot, st.title FROM assignments a LEFT JOIN stations st ON st.id = a.station_id
        WHERE a.signup_id = ? ORDER BY a.day, a.half`, s.id),
      all(db, `SELECT k.id, k.station_id, st.slot, a.agreement, a.score, a.ref_score FROM calibrations k JOIN stations st ON st.id = k.station_id
        LEFT JOIN calibration_answers a ON a.calibration_id = k.id AND a.signup_id = ? WHERE k.exam_id = ? ORDER BY st.slot`, s.id, s.exam_id),
      all(db, `SELECT e.name, e.starts_on, (SELECT COUNT(*) FROM assignments a WHERE a.signup_id = vs.id) AS halfdays
        FROM volunteer_signups vs JOIN exams e ON e.id = vs.exam_id WHERE vs.volunteer_id = ? ORDER BY e.starts_on`, s.volunteer_id),
    ]);
    const t = today(); const m = nowMin();
    const times = (day, half) => {
      const d = planning.days.find((x) => x.date === day);
      const ser = (d?.series || []).filter((x) => (toMin(x.start) < 12 * 60 ? 'am' : 'pm') === half);
      return ser.length ? { from: ser[0].convocation, series: ser.length } : null;
    };
    const mine = assigns.map((a) => ({ ...a, times: times(a.day, a.half),
      now: a.day === t && ((a.half === 'am' && m < 13 * 60 + 30) || (a.half === 'pm' && m >= 12 * 60)) }));
    // son avis s'ouvre dès que sa première demi-journée est passée
    const done = (a) => a.day < t || (a.day === t && ((a.half === 'am' && m >= 12 * 60) || (a.half === 'pm' && m >= 17 * 60)));
    const prefs = parse(s.prefs, null) || {};
    // ses stations à calibrer : celles où il évalue, sinon toutes celles qui ont un cas
    const myStations = new Set(assigns.filter((a) => a.role === 'evaluateur' && a.station_id).map((a) => a.station_id));
    return c.json({
      me: { first_name: s.first_name, last_name: s.last_name, roles: parse(s.roles, []), halfdays: parse(s.halfdays, []), code: s.code, prefs: parse(s.prefs, null) || { track: 'benevole' } },
      exam: { id: exam.id, name: exam.name, eval_open: state.eval.open, opens_at: state.eval.opens_at, place: planning.place },
      roles: POSTS, assignments: mine,
      feedback: prefs.feedback || null, feedback_open: assigns.some(done),
      calibrations: calibs.filter((k) => !myStations.size || myStations.has(k.station_id)),
      history,
    });
  });

  // Avis de l'équipe de la journée : trois questions et un mot libre, après sa première demi-journée
  app.post('/benevole/feedback', need('benevole'), async (c) => {
    const { db, s } = await meSignup(c);
    const b = await c.req.json();
    const note = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);
    const fb = { orga: note(b.orga), briefing: note(b.briefing), again: ['oui', 'peut-etre', 'non'].includes(b.again) ? b.again : null,
      comment: String(b.comment || '').trim().slice(0, 1500), at: new Date().toISOString() };
    if (!fb.orga && !fb.briefing && !fb.again && !fb.comment) throw httpError(400, 'Réponds au moins à une question.');
    const prefs = parse(s.prefs, null) || { track: 'benevole' };
    await run(db, 'UPDATE volunteer_signups SET prefs = ? WHERE id = ?', JSON.stringify({ ...prefs, feedback: fb }), s.id);
    return c.json({ ok: true });
  });

  app.get('/exams/:id/team-feedback', need('admin'), async (c) => {
    const db = c.env.DB;
    const rows = await all(db, `SELECT s.id, s.prefs, v.first_name, (SELECT group_concat(DISTINCT a.role) FROM assignments a WHERE a.signup_id = s.id) AS posts
      FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.exam_id = ?`, c.req.param('id')).catch(() => []);
    const list = rows.map((r) => ({ id: r.id, first_name: r.first_name, posts: (r.posts || '').split(',').filter(Boolean), track: (parse(r.prefs, null) || {}).track || 'benevole', ...((parse(r.prefs, null) || {}).feedback || {}) }))
      .filter((r) => r.at);
    return c.json({ list, asked: rows.filter((r) => r.posts).length });
  });

  // Entrer dans sa salle : si une affectation d'évaluateur tombe maintenant, on ouvre la salle sous son nom
  app.post('/benevole/enter', need('benevole'), async (c) => {
    const { db, s, state } = await meSignup(c);
    if (!state.eval.open) throw httpError(403, closedMessage(state.eval));
    const t = today(); const half = nowMin() < 12 * 60 + 15 ? 'am' : 'pm';
    const a = await one(db, "SELECT * FROM assignments WHERE signup_id = ? AND day = ? AND role = 'evaluateur' AND station_id IS NOT NULL ORDER BY half = ? DESC LIMIT 1", s.id, t, half);
    if (!a) throw httpError(400, 'Aucune salle ne t\'est attribuée aujourd\'hui. Demande ton code de salle à l\'accueil.');
    await createSession(c, 'evaluateur', a.station_id, `${s.first_name} ${s.last_name}`, 14);
    return c.json({ ok: true });
  });

  // ---------- calibration ----------
  // L'équipe décrit un passage (texte ou vidéo) et remplit la grille de référence ;
  // chaque évaluateur note le même passage et voit où il s'écarte de la référence.
  app.get('/stations/:id/calibration', need('admin', 'benevole'), async (c) => {
    const db = c.env.DB;
    const st = await one(db, 'SELECT id, exam_id, slot, title, type, content FROM stations WHERE id = ?', c.req.param('id'));
    if (!st) throw httpError(404, 'Station introuvable');
    const k = await one(db, 'SELECT * FROM calibrations WHERE station_id = ?', st.id);
    const content = normalizeContent(parse(st.content, {}));
    const sess = c.get('session');
    let mine = null;
    if (sess.kind === 'benevole') {
      const s = await one(db, 'SELECT exam_id FROM volunteer_signups WHERE id = ?', sess.subject_id);
      if (s?.exam_id !== st.exam_id || !k) throw httpError(404, 'Pas de calibration pour cette station');
      const a = await one(db, 'SELECT * FROM calibration_answers WHERE calibration_id = ? AND signup_id = ?', k.id, sess.subject_id);
      mine = a ? { answers: parse(a.answers, {}), score: a.score, ref_score: a.ref_score, agreement: a.agreement } : null;
    }
    return c.json({
      station: { id: st.id, exam_id: st.exam_id, slot: st.slot, title: st.title, type: st.type },
      vignette: content.vignette, grille: content.grille,
      calibration: k ? { scenario: k.scenario, video_url: k.video_url, reference: sess.kind === 'admin' || mine ? parse(k.reference, {}) : null } : null,
      mine,
    });
  });

  app.put('/stations/:id/calibration', need('admin'), async (c) => {
    const db = c.env.DB;
    const st = await one(db, 'SELECT id, exam_id FROM stations WHERE id = ?', c.req.param('id'));
    const b = await c.req.json();
    const video = /^https:\/\/[^\s<>"']+$/i.test(String(b.video_url || '').trim()) ? String(b.video_url).trim() : null;
    await run(db, `INSERT INTO calibrations (exam_id, station_id, scenario, video_url, reference) VALUES (?,?,?,?,?)
      ON CONFLICT(station_id) DO UPDATE SET scenario = excluded.scenario, video_url = excluded.video_url, reference = excluded.reference`,
    st.exam_id, st.id, String(b.scenario || '').slice(0, 6000), video, JSON.stringify(b.reference || {}));
    return c.json({ ok: true });
  });

  app.post('/stations/:id/calibration/answer', need('benevole'), async (c) => {
    const db = c.env.DB;
    const sess = c.get('session');
    const st = await one(db, 'SELECT id, exam_id, content FROM stations WHERE id = ?', c.req.param('id'));
    const k = await one(db, 'SELECT * FROM calibrations WHERE station_id = ?', st?.id);
    const s = await one(db, 'SELECT exam_id FROM volunteer_signups WHERE id = ?', sess.subject_id);
    if (!k || s?.exam_id !== st.exam_id) throw httpError(404, 'Pas de calibration pour cette station');
    const grille = normalizeContent(parse(st.content, {})).grille;
    const b = await c.req.json();
    const answers = { apt: b.answers?.apt || {}, com: b.answers?.com || {} };
    const ref = parse(k.reference, {});
    const mine = computeScore(grille, answers, false).score;
    const refScore = computeScore(grille, ref, false).score;
    const apt = grille.apt.filter((i) => i.label?.trim());
    const agree = apt.length ? apt.filter((i) => (answers.apt[i.id]?.ok === true) === (ref.apt?.[i.id]?.ok === true)).length / apt.length : null;
    await run(db, `INSERT INTO calibration_answers (calibration_id, signup_id, answers, score, ref_score, agreement) VALUES (?,?,?,?,?,?)
      ON CONFLICT(calibration_id, signup_id) DO UPDATE SET answers = excluded.answers, score = excluded.score, ref_score = excluded.ref_score, agreement = excluded.agreement, created_at = datetime('now')`,
    k.id, sess.subject_id, JSON.stringify(answers), mine, refScore, agree);
    return c.json({ ok: true, score: mine, ref_score: refScore, agreement: agree, reference: ref });
  });

  // ---------- suivi des bénévoles, toutes sessions confondues ----------
  app.get('/volunteers', need('admin'), async (c) => {
    const db = c.env.DB;
    const [vols, signups, assigns, grids, calib] = await Promise.all([
      all(db, 'SELECT * FROM volunteers ORDER BY last_name, first_name'),
      all(db, 'SELECT s.id, s.volunteer_id, s.exam_id, s.roles, e.name AS exam_name, e.starts_on FROM volunteer_signups s JOIN exams e ON e.id = s.exam_id'),
      all(db, 'SELECT signup_id, role, COUNT(*) AS n FROM assignments GROUP BY signup_id, role'),
      all(db, 'SELECT exam_id, lower(evaluator_name) AS n, COUNT(*) AS k FROM evaluations GROUP BY exam_id, lower(evaluator_name)'),
      all(db, 'SELECT signup_id, COUNT(*) AS n, AVG(agreement) AS agr FROM calibration_answers GROUP BY signup_id'),
    ]);
    const gridOf = new Map(grids.map((g) => [`${g.exam_id}|${g.n}`, g.k]));
    return c.json(vols.map((v) => {
      const ss = signups.filter((s) => s.volunteer_id === v.id);
      const name = `${v.first_name} ${v.last_name}`.toLowerCase();
      const half = assigns.filter((a) => ss.some((s) => s.id === a.signup_id));
      const cal = calib.filter((k) => ss.some((s) => s.id === k.signup_id));
      return {
        id: v.id, name: `${v.first_name} ${v.last_name}`, email: v.email, phone: v.phone, status: v.status, specialty: v.specialty,
        sessions: ss.map((s) => ({ name: s.exam_name, starts_on: s.starts_on, roles: parse(s.roles, []) })),
        halfdays: half.reduce((a, x) => a + x.n, 0), by_role: Object.fromEntries(Object.keys(ROLES).map((r) => [r, half.filter((x) => x.role === r).reduce((a, x) => a + x.n, 0)])),
        grids: ss.reduce((a, s) => a + (gridOf.get(`${s.exam_id}|${name}`) || 0), 0),
        calibrations: cal.reduce((a, k) => a + k.n, 0),
      };
    }));
  });
}
