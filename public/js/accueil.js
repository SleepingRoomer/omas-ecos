// Accueil le jour J : émargement par QR code ou dans la liste
import { api, esc, toast, longDate, frDate, setTitle } from './ui.js';
import { seriesTimes, frTime, rotationFor } from './planning-shared.js';
import { state as appState } from './app.js';

const isDesk = () => appState.me?.kind === 'accueil';

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
      ${R.absent_in?.length ? `<p class="alert warn">Déjà noté absent en ${R.absent_in.map(esc).join(', ')}. S'il passe encore dans ${R.absent_in.length > 1 ? 'ces salles' : 'cette salle'}, l'évaluateur remplit sa grille normalement ; sinon, préviens un organisateur.</p>` : ''}
      ${ok && c.number ? `<p class="alert info">Donne-lui l'étiquette <strong>${esc(c.number)}</strong>, à coller sur sa blouse.</p>` : ''}
      <p class="small muted">${esc(R.exam.name)}. Scanne le QR code suivant avec l'appareil photo.</p>
      <a class="btn" href="${isDesk() ? '#/accueil' : `#/admin/session/${R.exam.id}/accueil`}">Liste de l'accueil</a></div>`;
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
      <p class="alert info small">Le plus rapide : sur un téléphone connecté à l'accueil, scanne le QR code de la convocation avec l'appareil photo. La présence s'enregistre toute seule. Cette liste sert pour ceux qui n'ont pas leur QR code.</p>
      ${isDesk() ? '' : `<div class="panel" style="margin:10px 0" id="acc-code-box"><div class="row between"><div><strong>Code d'accueil</strong>
        <div class="small muted">À donner à l'étudiant qui tient l'accueil : avec l'onglet « Accueil » de la page de connexion, il émarge, imprime les étiquettes et fait le brief des circuits, sans accès au reste. Valable la veille et pendant les jours de la session.</div></div>
        <div class="row" style="flex-wrap:nowrap">${P.accueil_code ? `<span class="code-input" style="font-size:1.2rem;letter-spacing:.12em;font-weight:800">${esc(P.accueil_code)}</span><button class="small quiet" id="acc-copy">Copier le lien</button>` : ''}
          <button class="small" id="acc-gen">${P.accueil_code ? 'Nouveau code' : 'Créer le code'}</button></div></div></div>`}
      <div class="panel row between" style="margin:10px 0"><div><strong>Étiquettes des candidats</strong>
        <div class="small muted">Une planche par série, à imprimer avant le jour J et à remettre à l'émargement : numéro, prénom, circuit de départ et QR code qui ouvre la grille chez l'évaluateur.</div></div>
        <a class="btn small" href="${isDesk() ? '#/etiquettes' : `#/admin/session/${exam.id}/etiquettes`}" ${isDesk() ? '' : 'target="_blank"'}>Imprimer les étiquettes</a></div>
      <div class="panel row between" style="margin:10px 0"><div><strong>Chrono de la série</strong>
        <div class="small muted">${isDesk() ? 'C\'est le bénévole du chrono qui lance chaque tour. En secours, tu peux le faire d\'ici.' : 'Un bénévole dédié lance chaque tour depuis son espace (poste « Chrono » du planning des salles). Ouvre-le ici en secours.'} Les évaluateurs, l'accueil et l'écran de projection suivent le même chrono, même avec du retard.</div></div>
        <a class="btn small primary" href="${isDesk() ? '#/conduite' : `#/admin/session/${exam.id}/conduite`}">Ouvrir le chrono</a></div>
      <div class="panel row between" style="margin:10px 0"><div><strong>Brief des circuits</strong>
        <div class="small muted">Avant chaque série, en salle d'attente : qui commence sur quel circuit, la salle de départ de chacun, le changement à la pause. À montrer sur un écran ou un téléphone.</div></div>
        <a class="btn small" href="${isDesk() ? '#/brief' : `#/admin/session/${exam.id}/brief`}">Ouvrir le brief</a></div>
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
    box.querySelector('#acc-gen')?.addEventListener('click', async () => {
      if (P.accueil_code && !window.confirm('Créer un nouveau code ? L\'ancien ne marchera plus et l\'accueil devra se reconnecter.')) return;
      try { const r = await api(`/exams/${exam.id}/accueil-code`, { method: 'POST' }); P.accueil_code = r.code; draw(); toast('Code d\'accueil prêt'); } catch (e) { toast(e.message, 'error'); }
    });
    box.querySelector('#acc-copy')?.addEventListener('click', async () => { await navigator.clipboard?.writeText(`${location.origin}/#/?role=accueil&code=${P.accueil_code}`).catch(() => {}); toast('Lien copié'); });
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

// ---------- espace de l'accueil (code d'accueil) ----------
export async function accueilSpace(app, view) {
  const examId = appState.me.subject_id;
  const D = await api(`/exams/${examId}/planning`);
  const exam = { id: examId, name: D.exam.name, back: '#/accueil' };
  if (view === 'etiquettes') return (await import('./etiquettes.js')).labelsView(app, exam);
  if (view === 'brief') return briefView(app, exam);
  setTitle(`Accueil, ${exam.name}`);
  app.innerHTML = `<h1>Accueil</h1><p class="muted" style="margin:6px 0 14px">${esc(exam.name)}</p><div id="tab"></div><div id="acc-guide" style="margin-top:24px"></div>`;
  import('./guide.js').then((G) => G.guideSection(app.querySelector('#acc-guide'), ['accueil'], { planning: D.planning })).catch(() => {});
  return accueilTab(app.querySelector('#tab'), exam);
}

// ---------- brief des circuits ----------
// Ce que l'étudiant de l'accueil montre en salle d'attente avant chaque série : circuit et salle de départ de chacun,
// et le changement de circuit à la pause (même numéro de salle, sur l'autre circuit).
const brief = { day: null, series: null };
export async function briefView(app, exam) {
  const D = await api(`/exams/${exam.id}/planning`);
  const P = D.planning;
  const rot = rotationFor(D.slots);
  const half = D.slots.length / 2;
  setTitle(`Brief des circuits, ${exam.name}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const days = P.days.map((d) => d.date);
  if (!brief.day || !days.includes(brief.day)) brief.day = days.includes(today) ? today : days[0];
  const nowMin = (() => { const [h, m] = new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':').map(Number); return h * 60 + m; })();
  const toM = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
  const draw = () => {
    const day = P.days.find((d) => d.date === brief.day);
    const series = day?.series || [];
    // par défaut : la prochaine série qui n'a pas encore commencé aujourd'hui
    if (!brief.series || brief.series > series.length) {
      const k = brief.day === today ? series.findIndex((s) => toM(s.start) >= nowMin - 5) : 0;
      brief.series = (k < 0 ? 0 : k) + 1;
    }
    const ser = series[brief.series - 1];
    const T = ser ? seriesTimes(P, ser, D.slots.length) : null;
    const list = D.candidates.filter((c) => c.status !== 'annule' && c.day === brief.day && c.series === brief.series && c.seat).sort((a, b) => a.seat - b.seat);
    const twoCircuits = rot.seats === D.slots.length && D.slots.some((s) => /^A/i.test(s)) && D.slots.some((s) => /^B/i.test(s));
    const group = (first) => {
      const seats = Array.from({ length: twoCircuits ? half : D.slots.length }, (_, i) => (first === 'B' ? half : 0) + i + 1);
      return seats.map((seat) => {
        const c = list.find((x) => x.seat === seat);
        const start = rot.at(seat, 1); const after = twoCircuits ? rot.at(seat, half + 1) : null;
        return `<div class="brief-row ${c ? '' : 'empty'}"><span class="plate ${/^A/i.test(start) ? 'c-a' : 'c-b'}">${esc(start)}</span>
          <span class="brief-who"><b>${c ? esc(c.number || `Place ${seat}`) : `Place ${seat}`}</b>${c ? `<span>${esc(c.first_name)}</span>` : '<span class="muted">place libre</span>'}</span>
          ${after ? `<span class="brief-after">puis <b>${esc(after)}</b></span>` : ''}${c?.checked_in_at ? '<span class="brief-ok" title="Présent">✓</span>' : ''}</div>`;
      }).join('');
    };
    app.innerHTML = `
      <a class="back" href="${exam.back || `#/admin/session/${exam.id}/accueil`}">Accueil</a>
      <div class="row between brief-head"><div><h1>Série ${brief.series}${ser ? ` <span class="muted" style="font-weight:400">· début ${frTime(T.start)}</span>` : ''}</h1>
        <p class="muted" style="margin:4px 0 0">${esc(longDate(brief.day))}${ser ? `, convocation ${frTime(ser.convocation)}, fin des passages ${frTime(T.end)}` : ''}</p></div>
        <div class="row no-print"><select id="br-day" aria-label="Jour" style="width:auto">${days.map((d) => `<option value="${d}" ${d === brief.day ? 'selected' : ''}>${esc(frDate(d))}</option>`).join('')}</select>
          <select id="br-ser" aria-label="Série" style="width:auto">${series.map((s, i) => `<option value="${i + 1}" ${i + 1 === brief.series ? 'selected' : ''}>Série ${i + 1} (${frTime(s.start)})</option>`).join('')}</select>
          <button class="small" id="br-full">Plein écran</button></div></div>
      ${twoCircuits ? `<div class="brief">
        <section class="brief-col a"><h2>Vous commencez sur le circuit A</h2><p class="small muted">Places 1 à ${half}</p>${group('A')}</section>
        <section class="brief-col b"><h2>Vous commencez sur le circuit B</h2><p class="small muted">Places ${half + 1} à ${D.slots.length}</p>${group('B')}</section></div>`
        : `<div class="brief"><section class="brief-col a"><h2>Salle de départ</h2>${group('A')}</section></div>`}
      <div class="panel brief-rules"><h3 style="margin-top:0">À dire avant d'entrer</h3><ol>
        <li>Ton circuit de départ est en couleur sur ton étiquette : <b style="color:var(--a)">bleu pour A</b>, <b style="color:var(--b-ink)">turquoise pour B</b>. Garde-la bien visible : l'évaluateur ne connaît que ton numéro.</li>
        <li>${P.rotation_minutes} minutes par salle. À la sonnerie, tu passes à la salle suivante du même circuit${twoCircuits ? ` (${D.slots.filter((s) => /^A/i.test(s)).slice(0, 2).join(' → ')} → …, et après la dernière on revient à la première)` : ''}.</li>
        ${twoCircuits ? `<li>Après ${P.pause_after} tours, pause de ${P.pause_minutes} minutes. Puis tu changes de circuit et tu commences dans la salle du même numéro (A2 → B2, B4 → A4).</li>` : ''}
        <li>Lis la vignette sur la porte avant d'entrer. Débrief de ${P.debrief_minutes} minutes à la fin, tous ensemble.</li></ol></div>`;
    app.querySelector('#br-day').addEventListener('change', (e) => { brief.day = e.target.value; brief.series = null; draw(); });
    app.querySelector('#br-ser').addEventListener('change', (e) => { brief.series = Number(e.target.value); draw(); });
    app.querySelector('#br-full').addEventListener('click', () => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => {}); });
  };
  draw();
}
