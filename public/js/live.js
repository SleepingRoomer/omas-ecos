// Onglet « En direct » : le jour J, la course des évaluateurs et les grilles en retard
import { api, esc, plate, longDate, toast } from './ui.js';
import { candidateSchedule, frTime } from './planning-shared.js';
import { raceHtml } from './race.js';

let timer = null;
let chosen = null;
const GRACE = 10; // minutes laissées après la fin d'un tour avant de signaler une grille manquante

export async function liveTab(box, exam) {
  clearInterval(timer);
  const draw = async () => {
    const [R, P, Res] = await Promise.all([
      api(`/exams/${exam.id}/race${chosen ? `?day=${chosen}` : ''}`),
      api(`/exams/${exam.id}/planning`),
      api(`/exams/${exam.id}/results`),
    ]);
    const day = R.day;
    const slotId = Object.fromEntries(Res.stations.map((s) => [s.slot, s.id]));
    const rowOf = new Map(Res.rows.map((r) => [r.id, r]));
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    const [hh, mm] = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
    const nowMin = hh * 60 + mm;
    const past = (end) => day < today || (day === today && nowMin >= Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) + GRACE);
    // grilles attendues à cette heure, et celles qui manquent
    const missing = []; let expected = 0;
    for (const c of P.candidates.filter((x) => x.day === day && x.seat && x.status !== 'annule')) {
      const sch = candidateSchedule(P.planning, P.slots, c.day, c.series, c.seat);
      for (const st of sch?.steps || []) {
        if (!past(st.end)) continue;
        expected++;
        if (rowOf.get(c.id)?.scores[slotId[st.slot]] === undefined) missing.push({ c, st });
      }
    }
    const bySlot = {};
    missing.forEach((m) => { (bySlot[m.st.slot] ??= []).push(m); });
    box.innerHTML = `
      <div class="row" style="margin-bottom:6px">
        ${R.days.length > 1 ? `<select id="live-day" style="max-width:240px" aria-label="Jour">${R.days.map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>${esc(longDate(d))}</option>`).join('')}</select>` : ''}
        <span class="small muted">Mise à jour automatique toutes les 30 secondes.</span><span class="spacer"></span>
        <a class="btn small" href="#/admin/session/${exam.id}/projection">Mode projection</a>
        <button class="small" id="live-refresh">Actualiser</button></div>
      <div class="facts">
        <div><div class="v">${expected - missing.length}<span class="faint"> / ${expected}</span></div><div class="l">grilles attendues à cette heure</div></div>
        <div><div class="v">${missing.length}</div><div class="l">en retard de plus de ${GRACE} minutes</div></div>
        <div><div class="v">${R.horses.length}</div><div class="l">évaluateurs en piste</div></div>
      </div>
      ${missing.length ? `<div class="panel hl"><h3 style="margin-top:0">Grilles en retard</h3>
        <p class="small muted">Le candidat est passé dans la salle, mais personne n'a encore saisi sa grille. Va voir l'évaluateur, ou récupère la grille papier.</p>
        ${Object.entries(bySlot).sort().map(([slot, list]) => `<div class="late-row">${plate(slot)}<span><strong>${list.length}</strong> grille${list.length > 1 ? 's' : ''}</span>
          <span class="small muted">${list.slice(0, 12).map((m) => `${esc(m.c.number || `${m.c.first_name} ${m.c.last_name}`)} (${frTime(m.st.start)})`).join(', ')}${list.length > 12 ? '…' : ''}</span></div>`).join('')}</div>`
        : expected ? '<p class="alert ok">Toutes les grilles attendues à cette heure sont saisies.</p>' : ''}
      <h2>🏇 La course des évaluateurs</h2>
      <p class="small muted">Chaque grille saisie fait avancer le cheval de son évaluateur. Les évaluateurs voient la même course dans leur salle : de quoi encourager la saisie au fil de l'eau.</p>
      <div class="panel">${raceHtml(R)}</div>`;
    box.querySelector('#live-day')?.addEventListener('change', (e) => { chosen = e.target.value; draw(); });
    box.querySelector('#live-refresh').addEventListener('click', () => draw().catch((e) => toast(e.message, 'error')));
  };
  await draw();
  timer = setInterval(() => {
    if (!location.hash.endsWith('/direct') || document.visibilityState !== 'visible') return;
    draw().catch(() => {});
  }, 30000);
}
