// Onglet « En direct » : le jour J, la course des évaluateurs et les grilles en retard
import { api, esc, plate, longDate, toast } from './ui.js';
import { candidateSchedule, frTime, passageInRoom } from './planning-shared.js';
import { raceHtml } from './race.js';

let timer = null;
let chosen = null;
const GRACE = 10; // minutes laissées après la fin d'un tour avant de signaler une grille manquante

export async function liveTab(root, exam) {
  clearInterval(timer);
  // le panneau des messages reste en place : la mise à jour automatique ne touche que la suite
  root.innerHTML = '<div id="msg-panel"></div><div id="live-body"></div>';
  const box = root.querySelector('#live-body');
  messagesPanel(root.querySelector('#msg-panel'), exam);
  const draw = async () => {
    const [R, P, Res] = await Promise.all([
      api(`/exams/${exam.id}/race${chosen ? `?day=${chosen}` : ''}`),
      api(`/exams/${exam.id}/planning`),
      api(`/exams/${exam.id}/results`),
    ]);
    const day = R.day;
    const checks = day ? await api(`/exams/${exam.id}/live-checks?day=${day}`).catch(() => []) : [];
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
    // grilles enregistrées avant que le candidat soit passé dans la salle : sans doute le mauvais candidat
    const candById = new Map(P.candidates.map((c) => [c.id, c]));
    const early = checks.map((g) => {
      const c = candById.get(g.candidate_id); if (!c) return null;
      const p = passageInRoom(P.planning, P.slots, g.slot, c); if (!p) return null;
      const at = Date.parse(`${g.created_at.replace(' ', 'T')}Z`);
      return at < p.start.getTime() - 2 * 60e3 ? { g, c, p, at } : null;
    }).filter(Boolean);
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
      ${early.length ? `<div class="panel hl"><h3 style="margin-top:0">Grilles à vérifier</h3>
        <p class="small muted">Ces grilles ont été enregistrées avant l'heure de passage prévue du candidat dans la salle : l'évaluateur s'est peut-être trompé de candidat. Vérifie avec lui ; si c'est une erreur, supprime la grille depuis le bulletin du candidat et fais-la ressaisir sous le bon numéro.</p>
        ${early.map((x) => `<div class="late-row">${plate(x.g.slot)}<span><strong>${esc(x.c.number || '')}</strong> ${esc(x.c.first_name)} ${esc((x.c.last_name || '').slice(0, 1))}.</span>
          <span class="small muted">par ${esc(x.g.evaluator_name)}, enregistrée à ${new Date(x.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}, passage prévu à ${frTime(x.p.startHHMM)}</span>
          <a class="small" href="#/admin/session/${exam.id}/candidat/${x.c.id}">Bulletin</a></div>`).join('')}</div>` : ''}
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

// ---------- messages aux salles ----------
// Un message tapé ici s'affiche en bandeau chez les évaluateurs (toutes les salles ou une seule), à l'accueil,
// chez les bénévoles connectés et sur l'écran de projection, pendant 45 minutes ou jusqu'à ce qu'on le retire.
async function messagesPanel(box, exam) {
  const [M, P] = await Promise.all([api(`/exams/${exam.id}/broadcasts`), api(`/exams/${exam.id}/planning`)]);
  const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const draw = () => {
    box.innerHTML = `<div class="panel"><h3 style="margin-top:0">Message aux salles</h3>
      <form id="msg-form" class="row" style="gap:8px;flex-wrap:wrap">
        <input id="msg-text" maxlength="200" placeholder="Pause prolongée de 5 min" style="flex:1;min-width:220px" aria-label="Message">
        <select id="msg-slot" style="width:auto" aria-label="Pour qui"><option value="">Toutes les salles et l'accueil</option>${P.slots.map((s) => `<option value="${esc(s)}">Salle ${esc(s)} seulement</option>`).join('')}</select>
        <button class="primary" type="submit">Envoyer</button></form>
      <p class="small muted" style="margin:6px 0 0">Il s'affiche en bandeau sur les téléphones des évaluateurs, à l'accueil et sur l'écran de projection, en moins de 30 secondes, pendant ${M.minutes} minutes.</p>
      ${M.list.length ? `<div class="msg-list">${M.list.slice(0, 6).map((m) => `<div class="msg-item ${m.live ? '' : 'off'}">
        <span class="small muted">${time(m.at)}</span>${m.slot ? plate(m.slot, 'sm') : ''}<span style="flex:1">${esc(m.text)}</span>
        ${m.live ? `<button class="small quiet" data-rm="${m.id}">Retirer</button>` : `<span class="small muted">${m.cleared_at ? 'retiré' : 'expiré'}</span>`}</div>`).join('')}</div>` : ''}
      </div>`;
    box.querySelector('#msg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = box.querySelector('#msg-text').value.trim(); if (!text) return;
      try {
        await api(`/exams/${exam.id}/broadcasts`, { method: 'POST', body: { text, slot: box.querySelector('#msg-slot').value || null } });
        Object.assign(M, await api(`/exams/${exam.id}/broadcasts`)); draw(); toast('Message envoyé');
      } catch (err) { toast(err.message, 'error'); }
    });
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/exams/${exam.id}/broadcasts/${b.dataset.rm}`, { method: 'DELETE' });
      Object.assign(M, await api(`/exams/${exam.id}/broadcasts`)); draw();
    }));
  };
  draw();
}
