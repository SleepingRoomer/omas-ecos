// Tableau de bord d'une session : tout ce qui reste à faire, sur une seule page.
// Une dizaine de requêtes au plus ; les comptes se font ici, l'écran ne fait qu'afficher.
import { normalizePlanning } from '../public/js/planning-shared.js';
import { stepDeadline } from '../public/js/shared.js';
import { mailReady } from './mail.js';

const parisToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const shortDay = (d) => `${DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}`;
const HALF = { am: 'matin', pm: 'après-midi' };
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function registerDashboard(app, h) {
  const { need, httpError, all, one, parse } = h;

  app.get('/exams/:id/dashboard', need('admin'), async (c) => {
    const db = c.env.DB;
    const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', c.req.param('id'));
    if (!exam) throw httpError(404, 'Session introuvable');
    const P = normalizePlanning(parse(exam.planning, null), exam);
    const [cands, stations, signups, assigns, waiting, mailPending, nEval, claims] = await Promise.all([
      all(db, 'SELECT status, day, series, seat, number, confirmed_at, checked_in_at FROM candidates WHERE exam_id = ?', exam.id),
      all(db, 'SELECT id, slot, title, status, played, type FROM stations WHERE exam_id = ? ORDER BY slot', exam.id),
      all(db, 'SELECT id, roles, halfdays FROM volunteer_signups WHERE exam_id = ?', exam.id).catch(() => []),
      all(db, 'SELECT signup_id, day, half, role, station_id FROM assignments WHERE exam_id = ?', exam.id).catch(() => []),
      one(db, "SELECT COUNT(*) AS n FROM waitlist WHERE exam_id = ? AND status = 'waiting'", exam.id).catch(() => ({ n: 0 })),
      exam.anonymized_at ? { n: 0 } : one(db, `SELECT COUNT(*) AS n FROM candidates c WHERE c.exam_id = ? AND c.status != 'annule' AND c.day IS NOT NULL AND COALESCE(c.email, '') != ''
        AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.kind = 'convocation' AND m.ref = CAST(c.id AS TEXT) AND m.status = 'sent')`, exam.id).catch(() => ({ n: 0 })),
      one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE exam_id = ?', exam.id),
      one(db, "SELECT COUNT(*) AS n FROM claims WHERE exam_id = ? AND status = 'open'", exam.id).catch(() => ({ n: 0 })),
    ]);

    const today = parisToday();
    const first = P.days[0]?.date || exam.starts_on; const last = P.days[P.days.length - 1]?.date || exam.ends_on || first;
    const until = first ? daysBetween(today, first) : null;
    const phase = !first ? 'sans-date' : today < first ? 'avant' : today <= last ? 'pendant' : 'apres';

    // ---------- candidats et places ----------
    const played = stations.filter((s) => s.played);
    const nSlots = played.length;
    const active = cands.filter((x) => x.status !== 'annule');
    const placed = active.filter((x) => x.day && x.seat);
    const seats = P.days.reduce((a, d) => a + d.series.filter((s) => !s.closed).length, 0) * nSlots;
    const C = {
      inscrits: active.length, annules: cands.length - active.length, places: seats, places_libres: Math.max(0, seats - placed.length),
      sans_creneau: active.filter((x) => !x.day).length, a_numeroter: placed.filter((x) => !x.number).length,
      confirmes: placed.filter((x) => x.confirmed_at).length, places_occupees: placed.length,
      presents_aujourdhui: placed.filter((x) => x.day === today && x.checked_in_at).length, attendus_aujourdhui: placed.filter((x) => x.day === today).length,
      attente: waiting.n || 0, convocations_a_envoyer: mailPending.n || 0,
    };

    // ---------- stations ----------
    const late = played.filter((s) => (stepDeadline(s, P.writing_deadlines)?.late || 0) > 0);
    const S = { jouees: nSlots, validees: played.filter((s) => s.status === 'validee').length, en_retard: late.map((s) => s.slot) };

    // ---------- bénévoles, demi-journée par demi-journée ----------
    const perRoom = P.evaluators_per_room || 2;
    const halfdays = P.days.flatMap((d) => [...new Set(d.series.filter((s) => !s.closed).map((s) => (toMin(s.start) < 12 * 60 ? 'am' : 'pm')))].map((half) => ({ day: d.date, half })));
    const needReserve = played.some((s) => s.type === 'PS' || s.type === 'PSS');
    const B = halfdays.map(({ day, half }) => {
      const here = assigns.filter((a) => a.day === day && a.half === half);
      const missing = [];
      let need = 0; let got = 0;
      for (const st of played) {
        const inRoom = here.filter((a) => a.station_id === st.id);
        const ev = inRoom.filter((a) => a.role === 'evaluateur').length;
        const wantPs = st.type === 'PS' || st.type === 'PSS';
        const ps = inRoom.filter((a) => a.role === 'ps' || a.role === 'pss').length;
        need += perRoom + (wantPs ? 1 : 0); got += Math.min(ev, perRoom) + (wantPs ? Math.min(ps, 1) : 0);
        if (ev < perRoom || (wantPs && !ps)) missing.push(st.slot);
      }
      const reserve = here.filter((a) => a.role === 'reserve').length;
      const accueil = here.filter((a) => a.role === 'logistique').length;
      const dispo = signups.filter((s) => parse(s.halfdays, []).includes(`${day}|${half}`)).length;
      return { day, half, label: `${shortDay(day)} ${HALF[half]}`, need, got, missing, reserve, need_reserve: needReserve, accueil, dispo };
    });

    // ---------- matériel ----------
    const checks = P.materiel_check || {};
    const M = {
      impressions: Object.keys(checks).filter((k) => k.startsWith('print|')).length, impressions_total: 8,
      salles_pretes: played.filter((s) => checks[`${s.slot}|__salle`]).length, salles: nSlots,
      commun_enregistre: Array.isArray(P.materiel_common),
    };

    // ---------- ce qu'il reste à faire, du plus urgent au moins urgent ----------
    const todo = [];
    const add = (level, text, tab) => todo.push({ level, text, tab });
    const soon = until !== null && until <= 3;
    if (!mailReady(c.env)) add('urgent', 'Les e-mails ne partent pas : clé Brevo à configurer.', 'systeme');
    if (phase === 'avant' || phase === 'sans-date') {
      if (S.validees < S.jouees) add(until !== null && until <= 14 ? 'urgent' : 'todo', `${plural(S.jouees - S.validees, 'station n\'est', 'stations ne sont')} pas encore ${S.jouees - S.validees > 1 ? 'validées' : 'validée'}.`, 'stations');
      if (S.en_retard.length) add('todo', `En retard dans le circuit de rédaction : ${S.en_retard.join(', ')}.`, 'stations');
      if (C.sans_creneau) add('todo', `${plural(C.sans_creneau, 'inscrit n\'a', 'inscrits n\'ont')} pas de créneau.`, 'planning');
      if (!P.publish && C.places_occupees) add('todo', 'Les créneaux ne sont pas encore publiés aux étudiants.', 'planning');
      if (C.a_numeroter) add(soon ? 'urgent' : 'todo', `${plural(C.a_numeroter, 'candidat', 'candidats')} à numéroter (étiquettes et grilles).`, 'candidats');
      if (C.convocations_a_envoyer && until !== null && until <= 21) add(until <= 7 ? 'urgent' : 'todo', `${plural(C.convocations_a_envoyer, 'convocation', 'convocations')} à envoyer.`, 'reglages');
      if (C.places_libres && C.attente) add('todo', `${plural(C.places_libres, 'place libre', 'places libres')} et ${C.attente} en liste d'attente.`, 'candidats');
    }
    if (phase !== 'apres') {
      const nowMin = toMin(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }));
      const passed = (x) => x.day < today || (x.day === today && x.half === 'am' && nowMin >= 13 * 60) || (x.day === today && nowMin >= 19 * 60);
      for (const b of B.filter((x) => !passed(x))) {
        if (b.missing.length) add(until !== null && until <= 7 ? 'urgent' : 'todo', `${b.label} : ${plural(b.need - b.got, 'poste', 'postes')} à pourvoir (${b.missing.slice(0, 5).join(', ')}${b.missing.length > 5 ? '…' : ''}).`, 'benevoles');
        if (b.need_reserve && !b.reserve) add(until !== null && until <= 7 ? 'urgent' : 'todo', `${b.label} : pas de PS ou PSS de réserve.`, 'benevoles');
        if (!b.accueil) add('todo', `${b.label} : personne à l'accueil.`, 'benevoles');
      }
      if (!P.accueil_code && until !== null && until <= 7) add(soon ? 'urgent' : 'todo', 'Code d\'accueil à créer et à donner à l\'étudiant de l\'accueil.', 'accueil');
      if (until !== null && until <= 5 && M.impressions < M.impressions_total) add(soon ? 'urgent' : 'todo', `Impressions : ${M.impressions} sur ${M.impressions_total} cochées.`, 'materiel');
      if ((until === 1 || phase === 'pendant') && M.salles_pretes < M.salles) add('urgent', `Salles prêtes : ${M.salles_pretes} sur ${M.salles}.`, 'materiel');
    }
    if (claims.n) add('urgent', `${plural(claims.n, 'réclamation', 'réclamations')} en attente de réponse.`, 'resultats');
    if (phase === 'apres' && !exam.anonymized_at && daysBetween(last, today) > (P.claims_days || 0)) add('todo', 'Session terminée : penser à télécharger la sauvegarde puis à anonymiser.', 'reglages');
    const rank = { urgent: 0, todo: 1 };
    todo.sort((a, b) => rank[a.level] - rank[b.level]);

    return c.json({ exam: { id: exam.id, name: exam.name, anonymized: !!exam.anonymized_at }, phase, until, first, last, today,
      candidats: C, stations: S, benevoles: B, materiel: M, grilles: nEval.n, accueil_code: !!P.accueil_code, todo });
  });
}
