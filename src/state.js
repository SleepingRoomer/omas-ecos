// État d'une session à l'instant T : saisie des grilles ouverte ou non, détail des grilles visible ou non.
// La vérité vient du planning (horaires des séries) et des réglages de l'équipe, pas d'une case cochée le matin.
import { normalizePlanning, evalState, detailsState } from '../public/js/planning-shared.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Une ligne de la table exams (SELECT *) et le nombre de stations jouées suffisent : aucune requête ici.
export function examState(exam, nPlayed = 10, now = Date.now()) {
  const raw = parse(exam.planning);
  const planning = normalizePlanning(raw, exam);
  // sessions d'avant : la case « saisie ouverte » cochée vaut une ouverture forcée, tant que l'équipe n'a pas choisi
  if ((!raw || raw.eval_mode === undefined) && exam.eval_open) planning.eval_mode = 'open';
  const n = nPlayed || 10;
  return { planning, eval: evalState(planning, n, now), details: detailsState(planning, exam.show_details, n, now) };
}

// Charge la session et son état en une seule requête
export async function loadExamState(db, examId) {
  const exam = await db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id AND s.played = 1) AS n_played FROM exams e WHERE e.id = ?`).bind(examId).first();
  if (!exam) return null;
  return { exam, ...examState(exam, exam.n_played) };
}

// Message pour un évaluateur qui arrive hors des heures de saisie
export function closedMessage(st) {
  if (st.mode === 'closed') return 'La saisie est fermée par l\'équipe pour cette session.';
  if (st.opens_at) {
    const d = new Date(st.opens_at);
    const when = d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    return `La saisie n'est pas encore ouverte : elle ouvre d'elle-même le ${when}, une heure avant la première convocation.`;
  }
  if (st.no_planning) return 'La saisie ouvre d\'après les horaires du planning : l\'équipe doit d\'abord régler les jours de passage.';
  return 'La saisie est fermée : la salle a fermé après la dernière série.';
}
