// Accueil le jour J : émargement par QR code ou dans la liste
import { api, esc, toast, longDate, frDate } from './ui.js';
import { seriesTimes, frTime } from './planning-shared.js';

// Page ouverte en scannant le QR code d'une convocation avec l'appareil photo d'un téléphone de l'équipe
export async function scanView(app, token) {
  try {
    const R = await api(`/checkin/${encodeURIComponent(token)}`, { method: 'POST' });
    const c = R.candidate;
    const ok = c.status !== 'annule';
    app.innerHTML = `<div class="narrow scan ${ok ? (R.already ? 'again' : 'ok') : 'ko'}">
      <div class="scan-mark">${ok ? (R.already ? '↺' : '✓') : '✗'}</div>
      <div class="cand-no big">${esc(c.number || '')}</div>
      <h1>${esc(c.first_name)} ${esc(c.last_name)}</h1>
      <p class="lede">${ok ? (R.already ? 'Déjà émargé tout à l\'heure.' : 'Présence enregistrée.') : 'Inscription annulée : ce candidat a libéré sa place.'}</p>
      ${ok ? `<p>${c.day ? `${esc(longDate(c.day))}, série ${c.series}` : 'Sans créneau'}${R.convocation ? `, convocation à ${R.convocation}` : ''}.</p>` : ''}
      ${R.wrong_day ? '<p class="alert warn">Attention : ce candidat n\'est pas convoqué aujourd\'hui.</p>' : ''}
      ${ok && c.number ? `<p class="alert info">Donne-lui l'étiquette <strong>${esc(c.number)}</strong>, à coller sur sa blouse.</p>` : ''}
      <p class="small muted">${esc(R.exam.name)}. Scanne le QR code suivant avec l'appareil photo.</p>
      <a class="btn" href="#/admin/session/${R.exam.id}/accueil">Liste de l'accueil</a></div>`;
  } catch (e) {
    app.innerHTML = `<div class="narrow scan ko"><div class="scan-mark">✗</div><h1>QR code non reconnu</h1><p>${esc(e.message)}</p></div>`;
  }
}

let state = { day: null, q: '' };

export async function accueilTab(box, exam) {
  const D = await api(`/exams/${exam.id}/planning`);
  const P = D.planning;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const days = P.days.map((d) => d.date);
  if (!state.day || !days.includes(state.day)) state.day = days.includes(today) ? today : days[0];
  const day = P.days.find((d) => d.date === state.day);
  const list = D.candidates.filter((c) => c.status !== 'annule' && c.day === state.day && c.seat);
  const draw = () => {
    const q = state.q.toLowerCase();
    const here = list.filter((c) => c.checked_in_at).length;
    box.innerHTML = `
      <div class="row" style="margin-bottom:8px">
        <select id="acc-day" style="max-width:240px" aria-label="Jour">${days.map((d) => `<option value="${d}" ${d === state.day ? 'selected' : ''}>${esc(longDate(d))}</option>`).join('')}</select>
        <input id="acc-q" placeholder="Nom ou numéro" value="${esc(state.q)}" style="max-width:240px" aria-label="Chercher">
        <span class="spacer"></span><button class="small" id="acc-reload">Actualiser</button></div>
      <p class="alert info small">Le plus rapide : un membre de l'équipe, connecté en admin sur son téléphone, scanne le QR code de la convocation avec l'appareil photo. La présence s'enregistre toute seule. Cette liste sert pour ceux qui n'ont pas leur QR code.</p>
      <div class="panel row between" style="margin:10px 0"><div><strong>Étiquettes des candidats</strong>
        <div class="small muted">Une planche par série, à imprimer avant le jour J et à remettre à l'émargement : numéro, prénom, circuit de départ et QR code qui ouvre la grille chez l'évaluateur.</div></div>
        <a class="btn small" href="#/admin/session/${exam.id}/etiquettes" target="_blank">Imprimer les étiquettes</a></div>
      <div class="facts"><div><div class="v">${here}<span class="faint"> / ${list.length}</span></div><div class="l">présents</div></div>
        <div><div class="v">${list.filter((c) => c.confirmed_at).length}</div><div class="l">avaient confirmé leur venue</div></div></div>
      ${(day?.series || []).map((s, i) => {
        const T = seriesTimes(P, s, D.slots.length);
        const ls = list.filter((c) => c.series === i + 1 && (!q || `${c.number} ${c.first_name} ${c.last_name}`.toLowerCase().includes(q)));
        if (!ls.length) return '';
        const h = ls.filter((c) => c.checked_in_at).length;
        return `<h3>Série ${i + 1} <span class="small muted">convocation ${frTime(s.convocation)}, début ${frTime(T.start)} · ${h} / ${ls.length} présents</span></h3>
          <div class="acc-list">${ls.sort((a, b) => a.seat - b.seat).map((c) => `<button class="acc ${c.checked_in_at ? 'here' : ''}" data-id="${c.id}" data-p="${c.checked_in_at ? 0 : 1}">
            <span class="cand-no">${esc(c.number || '')}</span><span>${esc(c.first_name)} ${esc(c.last_name)}</span>
            <span class="acc-st">${c.checked_in_at ? '✓ présent' : c.confirmed_at ? 'confirmé' : ''}</span></button>`).join('')}</div>`;
      }).join('') || '<p class="muted">Aucun candidat ce jour-là.</p>'}`;
    box.querySelector('#acc-day').addEventListener('change', (e) => { state.day = e.target.value; accueilTab(box, exam); });
    box.querySelector('#acc-q').addEventListener('input', (e) => { state.q = e.target.value; const p = e.target.selectionStart; draw(); const i = box.querySelector('#acc-q'); i.focus(); i.setSelectionRange(p, p); });
    box.querySelector('#acc-reload').addEventListener('click', () => accueilTab(box, exam));
    box.querySelectorAll('.acc').forEach((b) => b.addEventListener('click', async () => {
      const c = list.find((x) => String(x.id) === b.dataset.id);
      const present = b.dataset.p === '1';
      if (!present && !window.confirm(`Annuler la présence de ${c.first_name} ${c.last_name} ?`)) return;
      try { await api(`/candidates/${c.id}/presence`, { method: 'POST', body: { present } }); c.checked_in_at = present ? new Date().toISOString() : null; draw(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  };
  draw();
  void frDate;
}
