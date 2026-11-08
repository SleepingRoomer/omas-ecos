// Réclamations des étudiants sur une grille : une demande par station, dans le délai fixé après l'ouverture du détail.
// L'équipe répond, et peut corriger les items concernés : la note est recalculée pour toutes les grilles du passage.
import { claimsWindow } from '../public/js/planning-shared.js';
import { normalizeContent, computeScore } from '../public/js/shared.js';
import { examState } from './state.js';
import { layout, sendMails, siteUrl } from './mail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
export const CLAIM_STATUS = { open: 'En attente', accepted: 'Acceptée', rejected: 'Refusée' };

export async function examWithPlayed(db, examId) {
  return db.prepare('SELECT e.*, (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id AND s.played = 1) AS n_played FROM exams e WHERE e.id = ?').bind(examId).first();
}
export const windowOf = (exam) => { const S = examState(exam, exam.n_played); return claimsWindow(S.planning, exam.show_details, exam.n_played || 10); };

export function registerClaims(app, h) {
  const { need, httpError, all, one, run } = h;

  app.post('/me/claims', need('etudiant'), async (c) => {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', c.get('session').subject_id);
    const exam = await examWithPlayed(db, cand.exam_id);
    const W = windowOf(exam);
    if (!W.open) throw httpError(400, W.enabled ? 'Les réclamations sont fermées pour cette session.' : 'Pas de réclamation possible pour cette session.');
    const b = await c.req.json();
    const message = String(b.message || '').trim().slice(0, 1500);
    if (message.length < 15) throw httpError(400, 'Explique en quelques phrases ce qui te semble faux dans la grille.');
    const st = await one(db, 'SELECT id FROM stations WHERE id = ? AND exam_id = ? AND played = 1', b.station_id, exam.id);
    if (!st) throw httpError(404, 'Station introuvable');
    const ev = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE station_id = ? AND candidate_id = ? AND absent = 0', st.id, cand.id);
    if (!ev.n) throw httpError(400, 'Pas de grille saisie pour cette station.');
    await run(db, 'INSERT INTO claims (exam_id, candidate_id, station_id, message) VALUES (?,?,?,?)', exam.id, cand.id, st.id, message)
      .catch((e) => { throw httpError(400, /UNIQUE/.test(String(e)) ? 'Tu as déjà fait une réclamation pour cette station.' : 'Réclamation impossible pour le moment.'); });
    return c.json({ ok: true });
  });

  // Liste de l'équipe, avec de quoi corriger : les items de la grille et ce qu'a coché chaque évaluateur
  app.get('/exams/:id/claims', need('admin'), async (c) => {
    const db = c.env.DB;
    const exam = await examWithPlayed(db, c.req.param('id'));
    if (!exam) throw httpError(404, 'Session introuvable');
    const claims = await all(db, `SELECT k.*, c.number, c.first_name, c.last_name, s.slot, s.title FROM claims k
      JOIN candidates c ON c.id = k.candidate_id JOIN stations s ON s.id = k.station_id WHERE k.exam_id = ? ORDER BY k.status = 'open' DESC, k.id`, exam.id).catch(() => null);
    if (claims === null) return c.json({ ready: false, claims: [], window: windowOf(exam) });
    const open = claims.filter((k) => k.status === 'open');
    const [contents, evals] = open.length ? await Promise.all([
      all(db, `SELECT id, content FROM stations WHERE id IN (${[...new Set(open.map((k) => k.station_id))].map(() => '?').join(',')})`, ...new Set(open.map((k) => k.station_id))),
      all(db, `SELECT station_id, candidate_id, evaluator_name, answers, score FROM evaluations WHERE absent = 0 AND candidate_id IN (${[...new Set(open.map((k) => k.candidate_id))].map(() => '?').join(',')})`, ...new Set(open.map((k) => k.candidate_id))),
    ]) : [[], []];
    const grille = Object.fromEntries(contents.map((r) => [r.id, normalizeContent(parse(r.content, {})).grille]));
    return c.json({
      ready: true, window: windowOf(exam),
      claims: claims.map((k) => {
        if (k.status !== 'open') return k;
        const g = grille[k.station_id];
        const grids = evals.filter((e) => e.station_id === k.station_id && e.candidate_id === k.candidate_id).map((e) => ({ ...e, answers: parse(e.answers, {}) }));
        return {
          ...k, raters: grids.map((x) => ({ name: x.evaluator_name, score: x.score })),
          items: (g?.apt || []).filter((i) => i.label?.trim()).map((i) => ({ id: i.id, label: i.label, points: Number(i.points) > 0 ? Number(i.points) : 1,
            ok: grids.map((x) => x.answers?.apt?.[i.id]?.ok === true) })),
        };
      }),
    });
  });

  app.patch('/claims/:id', need('admin'), async (c) => {
    const db = c.env.DB;
    const k = await one(db, 'SELECT * FROM claims WHERE id = ?', c.req.param('id'));
    if (!k) throw httpError(404, 'Réclamation introuvable');
    const b = await c.req.json();
    if (!['accepted', 'rejected'].includes(b.status)) throw httpError(400, 'Réponse inconnue');
    const answer = String(b.answer || '').trim().slice(0, 1500);
    if (answer.length < 5) throw httpError(400, 'Écris une réponse à l\'étudiant.');
    // corrections : l'item est coché ou décoché dans toutes les grilles du passage, puis la note est recalculée
    let newScore = null; const scores = [];
    const fix = b.status === 'accepted' && b.corrections && typeof b.corrections === 'object' ? b.corrections : null;
    if (fix && Object.keys(fix).length) {
      const st = await one(db, 'SELECT content FROM stations WHERE id = ?', k.station_id);
      const g = normalizeContent(parse(st.content, {})).grille;
      const grids = await all(db, 'SELECT id, answers FROM evaluations WHERE station_id = ? AND candidate_id = ? AND absent = 0', k.station_id, k.candidate_id);
      const stmts = grids.map((e) => {
        const a = parse(e.answers, {}); a.apt ||= {};
        for (const [id, ok] of Object.entries(fix)) if (g.apt.some((i) => i.id === id)) a.apt[id] = { ...(a.apt[id] || {}), ok: !!ok };
        const sc = computeScore(g, a, false);
        scores.push(sc.score);
        return db.prepare("UPDATE evaluations SET answers = ?, points = ?, max_points = ?, score = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(a), sc.points, sc.max, sc.score, e.id);
      });
      if (stmts.length) await db.batch(stmts);
      if (scores.length) newScore = Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 100) / 100;
    }
    const who = c.get('session').name || 'Équipe';
    await run(db, "UPDATE claims SET status = ?, answer = ?, answered_by = ?, answered_at = datetime('now') WHERE id = ?", b.status, answer, who, k.id);
    // l'étudiant est prévenu
    const x = await one(db, `SELECT c.email, c.first_name, c.last_name, c.code, s.slot, s.title, e.name AS exam_name FROM candidates c JOIN stations s ON s.id = ? JOIN exams e ON e.id = c.exam_id WHERE c.id = ?`, k.station_id, k.candidate_id);
    if (x?.email) {
      const url = await siteUrl(c.env, db, c);
      const p = sendMails(c.env, db, [{
        kind: 'reclamation', exam_id: k.exam_id, ref: String(k.id), to: x.email, name: `${x.first_name} ${x.last_name}`,
        subject: `Ta réclamation sur la station ${x.slot} : ${b.status === 'accepted' ? 'acceptée' : 'réponse de l\'équipe'}`,
        html: layout({
          title: `Réponse à ta réclamation, ${x.first_name}`,
          intro: `Station <b>${esc(x.slot)}${x.title ? `, ${esc(x.title)}` : ''}</b> des <b>${esc(x.exam_name)}</b>. ${b.status === 'accepted' ? 'L\'équipe a relu ta grille et te donne raison.' : 'L\'équipe a relu ta grille avec l\'évaluateur.'}`,
          rows: [['Réponse', esc(answer).replace(/\n/g, '<br>')], ...(newScore !== null ? [['Nouvelle note', `${String(newScore).replace('.', ',')} / 20`]] : [])],
          button: { url: `${url}/#/?role=etudiant&code=${encodeURIComponent(x.code)}`, label: 'Voir mes résultats' },
        }),
      }]).catch(() => {});
      try { c.executionCtx.waitUntil(p); } catch { await p; }
    }
    return c.json({ ok: true, score: newScore });
  });
}
