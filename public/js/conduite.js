// Conduite de la série : l'étudiant de l'accueil (ou l'équipe) lance chaque tour d'un bouton.
// Tous les écrans suivent ce chrono : évaluateurs, accueil, bénévoles, projection. Avec du retard, chacun reste synchronisé.
import { api, esc, toast, setTitle, longDate } from './ui.js';
import { nextLiveStep, seriesTimes, frTime, liveSeat } from './planning-shared.js';
import { live, liveRemaining } from './app.js';

const LABEL = { tour: (r) => `Lancer le tour ${r}`, pause: () => 'Lancer la pause', debrief: () => 'Lancer le débrief', fin: () => 'Terminer la série' };
let chosen = null;

export async function conduiteView(app, exam) {
  const D = await api(`/exams/${exam.id}/planning`);
  const P = D.planning; const n = D.slots.length;
  setTitle(`Chrono, ${D.exam.name}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const day = P.days.find((d) => d.date === today);
  const nowMin = () => { const [h, m] = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':').map(Number); return h * 60 + m; };
  const toM = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  let busy = false;
  const draw = () => {
    if (!location.hash.match(/conduite$/)) return;
    const L = live.state;
    if (!day) { app.innerHTML = `<a class="back" href="${exam.back || `#/admin/session/${exam.id}/direct`}">Retour</a><h1>Chrono</h1><p class="alert info">Pas de série aujourd'hui pour cette session.</p>`; return; }
    if (L) chosen = L.series;
    if (!chosen) { const k = day.series.findIndex((s) => toM(seriesTimes(P, s, n).end) >= nowMin()); chosen = (k < 0 ? day.series.length - 1 : k) + 1; }
    const ser = day.series[chosen - 1]; const T = seriesTimes(P, ser, n);
    const mine = L && L.series === chosen ? L : null;
    const next = nextLiveStep(mine, P, n, chosen);
    // écart avec le planning : début prévu du tour en cours comparé à son lancement réel
    const planned = mine && mine.phase === 'tour' ? T.rounds[mine.round - 1]?.start : null;
    const delta = planned ? (() => { const hm = new Date(mine.started_at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }); return toM(hm) - toM(planned); })() : null;
    const rem = liveRemaining();
    const who = mine && mine.phase === 'tour' ? D.slots.map((sl) => { const seat = liveSeat(D.slots, sl, mine.round); const c = D.candidates.find((x) => x.day === today && x.series === chosen && x.seat === seat && x.status !== 'annule'); return [sl, c]; }) : [];
    app.innerHTML = `
      <a class="back" href="${exam.back || `#/admin/session/${exam.id}/direct`}">Retour</a>
      <div class="row between"><h1>Chrono</h1>
        <select id="cd-ser" style="width:auto" aria-label="Série" ${mine ? 'disabled' : ''}>${day.series.map((s, i) => `<option value="${i + 1}" ${i + 1 === chosen ? 'selected' : ''}>Série ${i + 1} (${frTime(s.start)})</option>`).join('')}</select></div>
      <p class="muted" style="margin:4px 0 14px">${esc(longDate(today))}, série ${chosen} : début prévu ${frTime(T.start)}, fin des passages ${frTime(T.end)}.</p>
      <div class="cd-clock ${mine ? mine.phase : ''} ${mine && rem <= 0 ? 'over' : ''}">
        ${mine ? `<span class="cd-what">${mine.phase === 'tour' ? `Tour ${mine.round} sur ${n}` : mine.phase === 'pause' ? 'Pause' : 'Débrief'}</span>
          <span class="cd-time" id="cd-time">--:--</span>
          <span class="small">${delta !== null ? (delta > 1 ? `${delta} min de retard sur le planning` : delta < -1 ? `${-delta} min d'avance sur le planning` : 'À l\'heure du planning') : ''}</span>`
        : '<span class="cd-what">Pas encore lancée</span><span class="small">Lance le tour 1 quand tous les candidats sont devant leur salle de départ.</span>'}
      </div>
      <button class="primary cd-go" id="cd-go">${LABEL[next.phase](next.round)}</button>
      ${mine ? `<div class="row" style="justify-content:center;gap:8px;margin-top:10px"><button class="small quiet" id="cd-restart">Relancer ${mine.phase === 'tour' ? `le tour ${mine.round}` : 'ce chrono'} à zéro</button><button class="small quiet" id="cd-stop">Arrêter le chrono</button></div>` : ''}
      <p class="small muted" style="text-align:center;margin-top:10px">Tous les écrans suivent ce chrono : évaluateurs, accueil, bénévoles et projection. Les évaluateurs voient aussi le bon candidat pour le tour lancé.</p>
      ${who.length ? `<h2>Tour ${mine.round} : qui est où</h2><div class="cd-rooms">${who.map(([sl, c]) => `<div class="cd-room"><span class="plate ${/^B/i.test(sl) ? 'c-b' : ''}">${esc(sl)}</span><span>${c ? esc(c.number || '') : '<span class="muted">vide</span>'}${c && !c.checked_in_at ? ' <span class="small" style="color:#b9770e">pas émargé</span>' : ''}</span></div>`).join('')}</div>` : ''}`;
    const tick = () => { const el = app.querySelector('#cd-time'); if (!el) return; const r = liveRemaining(); const s = Math.max(0, Math.round((r ?? 0) / 1000)); el.textContent = r === null ? '--:--' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    tick();
    const send = async (body) => {
      if (busy) return; busy = true;
      try { await api(`/exams/${exam.id}/live`, { method: 'POST', body }); window.dispatchEvent(new Event('ines-live-refresh')); }
      catch (err) { toast(err.message, 'error'); }
      setTimeout(() => { busy = false; }, 1500);
    };
    app.querySelector('#cd-ser')?.addEventListener('change', (e) => { chosen = Number(e.target.value); draw(); });
    app.querySelector('#cd-go').addEventListener('click', () => {
      if (next.phase === 'fin' && !window.confirm('Terminer la série ? Le chrono disparaît des écrans.')) return;
      send({ phase: next.phase === 'fin' ? 'stop' : next.phase, series: chosen, round: next.round });
    });
    app.querySelector('#cd-restart')?.addEventListener('click', () => { if (window.confirm('Remettre ce chrono à zéro ?')) send({ phase: mine.phase, series: chosen, round: mine.round }); });
    app.querySelector('#cd-stop')?.addEventListener('click', () => { if (window.confirm('Arrêter le chrono ? Les écrans reviennent aux horaires du planning.')) send({ phase: 'stop' }); });
    clearInterval(window.__cdTick); window.__cdTick = setInterval(() => { if (!location.hash.match(/conduite$/)) { clearInterval(window.__cdTick); return; } tick(); }, 1000);
  };
  window.removeEventListener('ines-live', window.__cdLive || (() => {}));
  window.__cdLive = () => draw();
  window.addEventListener('ines-live', window.__cdLive);
  draw();
}
