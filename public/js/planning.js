// Onglet Planning d'une session : jours, séries, places, convocations, échanges
import { api, esc, toast, frDate, longDate, plate, downloadCsv, setTitle } from './ui.js';
import { normalizePlanning, rotationFor, seriesTimes, frTime } from './planning-shared.js';

const ui = { sel: null, moving: null };
const key = (d, s) => `${d}|${s}`;

function grid(P, slots, list, d, n, opts = {}) {
  const ser = P.days.find((x) => x.date === d).series[n - 1];
  const T = seriesTimes(P, ser, slots.length);
  const rot = rotationFor(slots);
  const bySeat = new Map(list.map((c) => [c.seat, c]));
  const who = (seat) => {
    const c = bySeat.get(seat);
    return c ? `<span class="g-no">${String(seat).padStart(2, '0')}</span> ${esc(c.first_name)} ${esc(opts.print ? c.last_name : `${(c.last_name || '').slice(0, 1)}.`)}` : `<span class="g-no">${String(seat).padStart(2, '0')}</span> <span class="faint">libre</span>`;
  };
  const rows = [];
  for (const r of T.rounds) {
    rows.push(`<tr><th class="g-time">${frTime(r.start)}</th>${slots.map((sl) => {
      let seat = 0; for (let k = 1; k <= rot.seats; k++) if (rot.at(k, r.round) === sl) seat = k;
      return `<td class="g-cell ${/^A/.test(sl) ? 'ga' : 'gb'}">${who(seat)}</td>`;
    }).join('')}</tr>`);
    if (T.pause && r.end === T.pause.start) rows.push(`<tr class="g-break"><th class="g-time">${frTime(T.pause.start)}</th><td colspan="${slots.length}">Pause de ${P.pause_minutes} minutes, changement de circuit</td></tr>`);
  }
  rows.push(`<tr class="g-break"><th class="g-time">${frTime(T.end)}</th><td colspan="${slots.length}">Fin de la série${T.debrief ? `, débriefing et correction jusqu'à ${frTime(T.debrief.end)}` : ''}</td></tr>`);
  return `<div class="table-wrap g-wrap"><table class="g-table">
    <thead><tr><th class="g-time">Série ${n}</th>${slots.map((sl) => `<th>${plate(sl, 'sm')}${P.rooms[sl] ? `<div class="small faint">${esc(P.rooms[sl])}</div>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

export async function planningTab(box, exam, draft = null) {
  const D = await api(`/exams/${exam.id}/planning`);
  const P = draft ? normalizePlanning(draft, exam) : D.planning;
  const slots = D.slots;
  const cap = slots.length;
  const active = D.candidates.filter((c) => c.status !== 'annule');
  const at = (d, n) => active.filter((c) => c.day === d && c.series === n);
  const unplaced = active.filter((c) => !c.day || !c.series || !c.seat);
  const allSeries = P.days.flatMap((d) => d.series.map((s, i) => ({ d: d.date, n: i + 1, s })));
  if (!ui.sel || !allSeries.some((x) => key(x.d, x.n) === ui.sel)) ui.sel = allSeries[0] ? key(allSeries[0].d, allSeries[0].n) : null;
  const [sd, sn] = ui.sel ? [ui.sel.split('|')[0], Number(ui.sel.split('|')[1])] : [];
  const confirmed = active.filter((c) => c.confirmed_at).length;
  const swapsDone = D.swaps.filter((s) => s.status === 'done').length;
  const swapsOpen = D.swaps.filter((s) => s.status === 'open').length;
  const moving = ui.moving && active.find((c) => c.id === ui.moving);

  box.innerHTML = `
    <div class="facts">
      <div><div class="v">${active.length - unplaced.length}<span class="faint"> / ${allSeries.length * cap}</span></div><div class="l">places occupées sur ${allSeries.length} séries</div></div>
      <div><div class="v">${unplaced.length}</div><div class="l">inscrits sans place</div></div>
      <div><div class="v">${confirmed}</div><div class="l">venues confirmées</div></div>
      <div><div class="v">${swapsDone}</div><div class="l">échanges faits${swapsOpen ? `, ${swapsOpen} demande${swapsOpen > 1 ? 's' : ''} en cours` : ''}</div></div>
    </div>
    ${!P.days.length ? '<p class="alert warn">Ajoute les jours de passage dans les réglages du planning, plus bas.</p>' : ''}
    <div class="row" style="margin:6px 0 14px">
      <button id="place" class="${unplaced.length ? 'primary' : ''}">Placer les inscrits${unplaced.length ? ` (${unplaced.length})` : ''}</button>
      <a class="btn" href="#/admin/session/${exam.id}/planning-imprimer" target="_blank">Imprimer le planning</a>
      <button id="relance">Exporter les non confirmés</button>
      <span class="small muted">Placer garde chacun à sa place et range les nouveaux par ordre alphabétique dans leur série.</span>
    </div>
    ${moving ? `<p class="alert info row between"><span>Déplacement de <strong>${esc(moving.first_name)} ${esc(moving.last_name)}</strong> : clique une place libre ou un autre candidat (dans n'importe quelle série) pour échanger.</span><button class="small" id="stop-move">Annuler</button></p>` : ''}

    <div class="cal">${P.days.map((d) => `<div class="cal-day"><div class="cal-date">${esc(longDate(d.date))}</div>
      ${d.series.map((s, i) => {
        const l = at(d.date, i + 1); const T = seriesTimes(P, s, cap); const conf = l.filter((c) => c.confirmed_at).length;
        return `<button class="cal-ser ${ui.sel === key(d.date, i + 1) ? 'on' : ''} ${s.closed ? 'closed' : ''}" data-sel="${key(d.date, i + 1)}">
          <span class="row between"><strong>Série ${i + 1}</strong><span class="small">${frTime(s.convocation)}</span></span>
          <span class="small muted">${frTime(T.start)} à ${frTime(T.end)}</span>
          <span class="fill"><i style="width:${Math.min(100, (l.length / cap) * 100)}%" class="${l.length > cap ? 'over' : l.length === cap ? 'full' : ''}"></i></span>
          <span class="small">${l.length} / ${cap}${l.length ? `, ${conf} confirmé${conf > 1 ? 's' : ''}` : ''}${s.closed ? ', fermée' : ''}</span></button>`;
      }).join('')}</div>`).join('')}</div>

    ${ui.sel ? `<h2>${esc(longDate(sd))}, série ${sn}</h2>
      <div class="ser-grid">
        <div class="seats">${Array.from({ length: cap }, (_, k) => k + 1).map((seat) => {
          const c = at(sd, sn).find((x) => x.seat === seat);
          return `<button class="seat ${c ? '' : 'free'} ${c && c.id === ui.moving ? 'moving' : ''}" data-seat="${seat}" data-cid="${c ? c.id : ''}">
            <span class="g-no">${String(seat).padStart(2, '0')}</span>
            ${c ? `<span class="nm">${esc(c.first_name)} ${esc(c.last_name)}${c.confirmed_at ? ' <span class="ok-mark" title="Venue confirmée">✓</span>' : ''}</span>` : '<span class="faint">Place libre</span>'}
          </button>`;
        }).join('')}
        ${at(sd, sn).filter((c) => !c.seat).map((c) => `<button class="seat moving-src" data-cid="${c.id}"><span class="g-no">?</span><span class="nm">${esc(c.first_name)} ${esc(c.last_name)}</span></button>`).join('')}
        <p class="small muted">Clique un candidat pour le déplacer ou l'échanger avec un autre. La grille ci-dessous montre qui est dans quelle salle à chaque tour.</p></div>
        <div>${grid(P, slots, at(sd, sn).filter((c) => c.seat), sd, sn)}</div>
      </div>` : ''}

    ${unplaced.length ? `<h2>Sans place</h2><div class="chips-list">${unplaced.map((c) => `<button class="seat moving-src ${c.id === ui.moving ? 'moving' : ''}" data-cid="${c.id}">
      <span class="nm">${esc(c.first_name)} ${esc(c.last_name)}</span><span class="small faint">${c.day ? `${frDate(c.day)}, série ${c.series ?? '?'}` : esc(c.slot_label || 'aucun créneau')}</span></button>`).join('')}</div>` : ''}

    ${D.swaps.length ? `<h2>Échanges entre étudiants</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Demande de</th><th>Avec</th><th>Statut</th></tr></thead><tbody>
      ${D.swaps.map((s) => { const pl = (x) => { if (!x) return ''; const [d, n] = x.split('|'); return `${frDate(d)}, S${n}`; };
        return `<tr><td class="small">${esc((s.done_at || s.created_at || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(s.who)}${s.from_place ? `<div class="small muted">${pl(s.from_place)} → ${pl(s.to_place)}</div>` : ''}</td>
        <td>${esc(s.partner || '')}</td><td>${s.status === 'done' ? '<span class="pill ok">Fait</span>' : s.status === 'open' ? '<span class="pill">En attente</span>' : '<span class="pill faint">Retirée</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>` : ''}

    <details class="panel" id="cfg" ${!P.days.length || draft ? 'open' : ''}>
      ${draft ? '<p class="alert warn">Modifications pas encore enregistrées.</p>' : ''}<summary style="cursor:pointer"><strong>Réglages du planning</strong> <span class="muted">jours, horaires, lieu, salles, échanges</span></summary>
      <h3>Jours et séries</h3>
      <div id="days">${P.days.map((d, di) => `<div class="cfg-day" data-di="${di}">
        <div class="row"><input type="date" value="${esc(d.date)}" data-f="date" aria-label="Date" style="max-width:180px"><span class="spacer"></span><button type="button" class="small quiet" data-rmday>Retirer ce jour</button></div>
        <table class="cfg-ser"><thead><tr><th>Série</th><th>Convocation</th><th>Début</th><th>Pause</th><th>Fermée aux échanges</th><th></th></tr></thead><tbody>
        ${d.series.map((s, si) => `<tr data-si="${si}"><td>${si + 1}</td><td><input type="time" value="${esc(s.convocation)}" data-f="convocation"></td><td><input type="time" value="${esc(s.start)}" data-f="start"></td>
          <td><input type="checkbox" data-f="pause" ${s.nopause ? '' : 'checked'} aria-label="Pause"></td><td><input type="checkbox" data-f="closed" ${s.closed ? 'checked' : ''} aria-label="Fermée"></td>
          <td><button type="button" class="small quiet" data-rmser>Retirer</button></td></tr>`).join('')}
        </tbody></table><button type="button" class="small" data-addser>Ajouter une série</button></div>`).join('')}</div>
      <button type="button" class="small" id="addday" style="margin-top:8px">Ajouter un jour</button>
      <h3>Rythme</h3>
      <div class="grid cols-4" style="gap:10px">
        <div><label for="p-rot">Minutes par tour</label><input id="p-rot" type="number" min="5" value="${P.rotation_minutes}"></div>
        <div><label for="p-pa">Pause après le tour</label><input id="p-pa" type="number" min="0" value="${P.pause_after}"></div>
        <div><label for="p-pm">Minutes de pause</label><input id="p-pm" type="number" min="0" value="${P.pause_minutes}"></div>
        <div><label for="p-db">Minutes de débriefing</label><input id="p-db" type="number" min="0" value="${P.debrief_minutes}"></div>
      </div>
      <h3>Convocation</h3>
      <label for="p-place">Lieu</label><textarea id="p-place" rows="2" placeholder="Faculté, bâtiment, étage, accès">${esc(P.place)}</textarea>
      <label for="p-ins">À savoir avant de venir</label><textarea id="p-ins" rows="4" placeholder="Blouse, carte d'étudiant, arriver à l'heure de convocation, pas de téléphone pendant les stations…">${esc(P.instructions)}</textarea>
      <h3>Salles</h3><p class="small muted">Le nom de la salle de chaque station apparaît dans le parcours des étudiants.</p>
      <div class="grid cols-5" style="gap:8px">${slots.map((sl) => `<div><label for="room-${sl}">${plate(sl, 'sm')}</label><input id="room-${sl}" data-room="${sl}" value="${esc(P.rooms[sl] || '')}" placeholder="Salle"></div>`).join('')}</div>
      <h3>Échanges entre étudiants</h3>
      <label class="check"><input type="checkbox" id="p-swaps" ${P.swaps_open ? 'checked' : ''}><span>Les étudiants peuvent échanger leur créneau entre eux depuis leur espace</span></label>
      <div style="max-width:260px"><label for="p-close">Fermeture des échanges, en heures avant la convocation</label><input id="p-close" type="number" min="0" value="${P.swaps_close_hours}"></div>
      <button class="primary" id="save-cfg" style="margin-top:16px">Enregistrer le planning</button>
    </details>`;

  const reload = () => planningTab(box, exam);
  box.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => { ui.sel = b.dataset.sel; reload(); }));
  box.querySelector('#stop-move')?.addEventListener('click', () => { ui.moving = null; reload(); });
  box.querySelector('#place').addEventListener('click', async () => {
    const r = await api(`/exams/${exam.id}/candidates/renumber`, { method: 'POST' });
    toast(`${r.numbered} candidats placés${r.overflow ? `, ${r.overflow} sans place (séries pleines)` : ''}`, r.overflow ? 'error' : 'ok');
    reload();
  });
  box.querySelector('#relance').addEventListener('click', () => {
    const rows = active.filter((c) => c.seat && !c.confirmed_at).sort((a, b) => (a.number || '').localeCompare(b.number || ''));
    downloadCsv(`a-relancer-${exam.id}.csv`, [['Numéro', 'Nom', 'Prénom', 'Téléphone', 'E-mail', 'Jour', 'Série'],
      ...rows.map((c) => [c.number, c.last_name, c.first_name, c.phone, c.email, c.day, c.series])]);
  });

  // déplacer : un premier clic choisit le candidat, le second la place (libre ou occupée)
  box.querySelectorAll('.seat').forEach((b) => b.addEventListener('click', async () => {
    const cid = Number(b.dataset.cid) || null;
    if (!ui.moving) { if (cid) { ui.moving = cid; reload(); } return; }
    if (cid === ui.moving) { ui.moving = null; reload(); return; }
    if (!b.dataset.seat) { ui.moving = cid; reload(); return; }
    const src = active.find((c) => c.id === ui.moving);
    const moves = [{ id: src.id, day: sd, series: sn, seat: Number(b.dataset.seat) }];
    if (cid) moves.push({ id: cid, day: src.day, series: src.series, seat: src.seat });
    try {
      await api(`/exams/${exam.id}/seats`, { method: 'POST', body: { moves } });
      toast(cid ? 'Places échangées' : 'Candidat déplacé');
      ui.moving = null; reload();
    } catch (e) { toast(e.message, 'error'); }
  }));

  // réglages
  const readCfg = () => {
    const days = [...box.querySelectorAll('.cfg-day')].map((el) => ({
      date: el.querySelector('[data-f="date"]').value,
      series: [...el.querySelectorAll('tr[data-si]')].map((tr) => ({
        convocation: tr.querySelector('[data-f="convocation"]').value, start: tr.querySelector('[data-f="start"]').value,
        nopause: !tr.querySelector('[data-f="pause"]').checked, closed: tr.querySelector('[data-f="closed"]').checked,
      })),
    }));
    const rooms = {}; box.querySelectorAll('[data-room]').forEach((i) => { if (i.value.trim()) rooms[i.dataset.room] = i.value.trim(); });
    return { ...P, days, rooms, rotation_minutes: +box.querySelector('#p-rot').value, pause_after: +box.querySelector('#p-pa').value,
      pause_minutes: +box.querySelector('#p-pm').value, debrief_minutes: +box.querySelector('#p-db').value,
      place: box.querySelector('#p-place').value, instructions: box.querySelector('#p-ins').value,
      swaps_open: box.querySelector('#p-swaps').checked, swaps_close_hours: +box.querySelector('#p-close').value };
  };
  const redrawCfg = (np) => planningTab(box, exam, np).then(() => box.querySelector('#cfg')?.scrollIntoView({ block: 'start' }));
  box.querySelector('#addday').addEventListener('click', () => {
    const c = readCfg(); const last = c.days[c.days.length - 1];
    const next = last ? new Date(new Date(`${last.date}T12:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10) : (exam.starts_on || new Date().toISOString().slice(0, 10));
    c.days.push({ date: next, series: last ? last.series.map((s) => ({ ...s })) : undefined }); redrawCfg(c);
  });
  box.querySelectorAll('[data-rmday]').forEach((b) => b.addEventListener('click', () => { const c = readCfg(); c.days.splice(+b.closest('.cfg-day').dataset.di, 1); redrawCfg(c); }));
  box.querySelectorAll('[data-addser]').forEach((b) => b.addEventListener('click', () => {
    const c = readCfg(); const d = c.days[+b.closest('.cfg-day').dataset.di]; const l = d.series[d.series.length - 1];
    d.series.push(l ? { start: l.start, convocation: l.convocation } : { start: '08:30', convocation: '08:15' }); redrawCfg(c);
  }));
  box.querySelectorAll('[data-rmser]').forEach((b) => b.addEventListener('click', () => {
    const c = readCfg(); c.days[+b.closest('.cfg-day').dataset.di].series.splice(+b.closest('tr').dataset.si, 1); redrawCfg(c);
  }));
  box.querySelector('#save-cfg').addEventListener('click', async () => {
    const c = readCfg();
    const lost = active.filter((x) => x.day && !c.days.some((d) => d.date === x.day && d.series.length >= x.series)).length;
    if (lost && !window.confirm(`${lost} candidat(s) sont placés sur un jour ou une série que tu retires. Ils garderont leur créneau mais sans horaire. Continuer ?`)) return;
    try { await api(`/exams/${exam.id}/planning`, { method: 'PUT', body: { planning: c } }); toast('Planning enregistré'); reload(); } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------- impression : un planning par demi-journée, comme le tableur ----------
export async function planningPrint(app, exam) {
  const D = await api(`/exams/${exam.id}/planning`);
  const P = D.planning;
  setTitle(`Planning, ${exam.name}`);
  const active = D.candidates.filter((c) => c.status !== 'annule' && c.seat);
  const pages = P.days.flatMap((d) => d.series.map((s, i) => ({ d, s, n: i + 1 })));
  app.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><button class="primary" onclick="window.print()">Imprimer</button>
    <span class="small muted">Une page par série, à afficher à l'accueil et dans le couloir.</span></div>
    ${pages.map(({ d, s, n }) => `<div class="sheet landscape plan-sheet"><h2 style="margin:0 0 2mm">${esc(longDate(d.date))}, série ${n}</h2>
      <div style="margin:0 0 3mm">Convocation ${frTime(s.convocation)}, passage à ${frTime(s.start)}</div>
      ${grid(P, D.slots, active.filter((c) => c.day === d.date && c.series === n), d.date, n, { print: true })}</div>`).join('')}`;
}
