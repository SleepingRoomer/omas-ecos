// Espace étudiant : convocation, parcours de la journée, confirmation de venue et échanges de créneau
import { api, esc, nl, toast, longDate, frDate, plate } from './ui.js';
import { frTime } from './planning-shared.js';

const when = (o) => `${longDate(o.date)}, série ${o.series}`;
const conv = (o) => (o.convocation ? `convocation à ${frTime(o.convocation)}` : '');

function ics(C) {
  const s = C.schedule;
  const d = C.day.replace(/-/g, '');
  const t = (hhmm) => `${d}T${hhmm.replace(':', '')}00`;
  const end = s.debrief ? s.debrief.end : s.end;
  const desc = [`Candidat ${C.candidate.number || ''}`, `Passage de ${frTime(s.start)} à ${frTime(s.end)}`, C.instructions || ''].filter(Boolean).join('\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OMAS//ECOS blancs//FR', 'BEGIN:VEVENT',
    `UID:omas-ecos-${d}-${C.series}-${C.seat}@omas`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/Paris:${t(s.convocation || s.start)}`, `DTEND;TZID=Europe/Paris:${t(end)}`,
    `SUMMARY:${C.exam.name}`, `LOCATION:${(C.place || '').replace(/\n/g, ', ')}`, `DESCRIPTION:${desc}`,
    'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:ECOS blancs demain', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = 'ecos-blancs-omas.ics';
  a.click();
}

export function parcoursHtml(s) {
  const rows = [];
  s.steps.forEach((st, i) => {
    rows.push(`<li><span class="t">${frTime(st.start)}</span>${plate(st.slot, 'lg')}<span class="what"><strong>Station ${esc(st.slot)}</strong>${st.room ? `<span class="muted">${esc(st.room)}</span>` : ''}</span></li>`);
    if (s.pause && st.end === s.pause.start) rows.push(`<li class="brk"><span class="t">${frTime(s.pause.start)}</span><span class="what">Pause, puis changement de circuit</span></li>`);
  });
  rows.push(`<li class="brk"><span class="t">${frTime(s.end)}</span><span class="what">Fin des stations${s.debrief ? `, débriefing et correction jusqu'à ${frTime(s.debrief.end)}` : ''}</span></li>`);
  return `<ol class="parcours">${rows.join('')}</ol>`;
}

export async function convocationPanel(box, reload) {
  const C = await api('/me/convocation');
  const S = C.swaps;
  const s = C.schedule;
  const first = s?.steps[0]?.slot?.[0];
  const draw = () => {
    box.innerHTML = !C.placed ? `<div class="panel"><h2>Ta convocation</h2><p>Ton créneau de passage n'est pas encore fixé. Il apparaîtra ici dès que l'équipe aura établi le planning.</p></div>` : `
      <section class="convoc">
        <div class="convoc-main">
          <div class="kicker">Ta convocation</div>
          <div class="date">${esc(longDate(C.day))}</div>
          <div class="hour">${frTime(s.convocation || s.start)}</div>
          <div class="muted">Passage de ${frTime(s.start)} à ${frTime(s.end)}${s.debrief ? `, débriefing jusqu'à ${frTime(s.debrief.end)}` : ''}. Tu commences par le circuit ${esc(first || '')}.</div>
          ${C.place ? `<div class="where">${nl(C.place)}</div>` : ''}
        </div>
        <div class="convoc-side">
          <div class="small muted">Ton numéro</div><div class="cand-no big">${esc(C.candidate.number || '')}</div>
          <div class="small muted">Série ${C.series}, place ${C.seat}</div>
        </div>
      </section>
      <div class="row no-print" style="margin:10px 0 4px">
        ${C.confirmed_at ? `<span class="pill ok">Venue confirmée</span><button class="small quiet" data-confirm="0">Je ne peux plus venir</button>`
          : '<button class="primary" data-confirm="1">Je confirme ma venue</button>'}
        <button class="small" id="ics">Ajouter à mon agenda</button>
        <button class="small quiet" onclick="window.print()">Imprimer</button>
      </div>
      ${C.instructions ? `<div class="panel"><h3 style="margin-top:0">À savoir avant de venir</h3><div>${nl(C.instructions)}</div></div>` : ''}
      <h2>Ton parcours</h2>
      <p class="small muted">Un tour toutes les ${C.rotation_minutes} minutes : lecture de la vignette devant la porte, puis la station. Les sujets restent secrets jusqu'au jour J.</p>
      ${parcoursHtml(s)}
      ${S.enabled || S.history.length ? `<h2 id="echanges">Échanger mon créneau</h2>${swapHtml()}` : ''}`;
    const waiting = S.open ? S.board.filter((o) => o.compatible).length + (S.mine?.proposals.length || 0) : 0;
    if (waiting) box.insertAdjacentHTML('afterbegin', `<p class="alert info row between no-print"><span><strong>${waiting > 1 ? `${waiting} échanges t'attendent` : 'Un échange t\'attend'}</strong> : un étudiant cherche ton créneau ou te propose le sien.</span><a class="btn small" href="#/resultats" data-go="echanges">Voir</a></p>`);
    bind();
  };

  const swapHtml = () => {
    const hist = S.history.length ? `<p class="small muted">Échanges déjà faits : ${S.history.length}. Ton créneau actuel est celui affiché plus haut.</p>` : '';
    if (!S.open) return `<div class="panel"><p style="margin:0">${esc(S.why || 'Échanges fermés.')}</p>${hist}</div>`;
    const M = S.mine;
    const mine = M ? `<div class="panel ${M.proposals.length ? 'hl' : ''}"><h3 style="margin-top:0">Ta demande</h3>
      ${M.wanted.length ? `<p>Tu quittes ton créneau et tu cherches : ${M.wanted.map((k) => { const o = S.options.find((x) => x.key === k); return o ? `<strong>${esc(when(o))}</strong>` : ''; }).filter(Boolean).join(', ')}.
        Tous les étudiants la voient : ceux de ces créneaux peuvent l'accepter directement, les autres peuvent te proposer le leur.</p>`
        : '<p>Ta demande est privée : elle ne sert qu\'avec le code ci-dessous.</p>'}
      ${M.proposals.length ? `<h3>${M.proposals.length > 1 ? `${M.proposals.length} propositions reçues` : 'Une proposition reçue'}</h3>
        ${M.proposals.map((p) => `<div class="row between swap-offer"><div><strong>${esc(when(p))}</strong><div class="small muted">${conv(p)}</div></div>
          <div class="row" style="gap:6px"><button class="primary small" data-prop-accept="${p.id}">Accepter</button><button class="small" data-prop-refuse="${p.id}">Refuser</button></div></div>`).join('')}` : ''}
      ${M.declined || M.refused ? `<p class="small muted">${M.declined ? `${M.declined} étudiant${M.declined > 1 ? 's ont' : ' a'} décliné ta demande. ` : ''}${M.refused ? `Tu as refusé ${M.refused} proposition${M.refused > 1 ? 's' : ''}.` : ''}</p>` : ''}
      <p class="small">Tu t'es arrangé avec quelqu'un ? Donne-lui ce code : <span class="code big-code">${esc(M.code)}</span></p>
      <button class="small quiet" id="cancel-swap">Retirer ma demande</button></div>`
      : `<details class="panel"><summary style="cursor:pointer"><strong>Demander un autre créneau</strong></summary>
        <p class="small muted">Coche les créneaux qui t'arrangent. Ta demande est visible par tous les étudiants : ceux d'un créneau coché peuvent l'accepter et l'échange est immédiat, les autres peuvent te proposer leur créneau et c'est toi qui décides.</p>
        <label class="check"><input type="checkbox" id="all-opts"><span><strong>N'importe quel autre créneau</strong></span></label>
        <div class="swap-opts">${S.options.map((o) => `<label class="check"><input type="checkbox" value="${esc(o.key)}"><span><strong>${esc(when(o))}</strong><br><span class="small muted">${conv(o)}</span></span></label>`).join('')}</div>
        <div class="row" style="margin-top:12px"><button class="primary" id="post-swap">Publier ma demande</button>
          <button class="small quiet" id="post-private">Créer seulement un code pour un ami</button></div></details>`;
    const board = [...S.board].sort((x, y) => Number(y.compatible) - Number(x.compatible));
    const card = (o) => `<div class="swap-card ${o.compatible ? 'match' : ''}">
      <div><div class="small muted">Quitte</div><strong>${esc(when(o.from))}</strong><div class="small muted">${conv(o.from)}</div></div>
      <div><div class="small muted">Cherche</div>${o.wanted.map((w) => `<div class="${w.key === `${C.day}|${C.series}` ? 'me' : ''}">${esc(when(w))}</div>`).join('')}</div>
      <div class="acts">${o.compatible
        ? `<button class="primary small" data-accept="${esc(o.code)}">Accepter l'échange</button><button class="small" data-decline="${esc(o.code)}">Refuser</button>`
        : o.proposed === 'pending' ? '<span class="pill">Proposition envoyée</span>'
          : o.proposed === 'refused' ? '<span class="pill">Proposition refusée</span><button class="small quiet" data-decline="' + esc(o.code) + '">Masquer</button>'
            : `<button class="small" data-propose="${esc(o.code)}">Proposer mon créneau</button><button class="small quiet" data-decline="${esc(o.code)}">Refuser</button>`}</div></div>`;
    return `${mine}
      <h3>Demandes des autres étudiants${board.length ? ` (${board.length})` : ''}</h3>
      ${board.length ? `<p class="small muted">${board.some((o) => o.compatible) ? 'En haut, celles qui cherchent ton créneau : tu peux les accepter tout de suite. ' : ''}Pour les autres, tu peux proposer ton créneau : l'étudiant accepte ou refuse.</p>
        <div class="swap-board">${board.map(card).join('')}</div>` : '<p class="muted small">Aucune demande pour l\'instant.</p>'}
      <details class="panel"><summary style="cursor:pointer"><strong>J'ai reçu un code d'échange</strong></summary>
        <form id="code-form" class="row" style="margin-top:10px"><input id="swap-code" class="code-input" maxlength="8" placeholder="K7XP2Q" style="max-width:180px" aria-label="Code d'échange" autocomplete="off">
        <button class="small">Voir le créneau</button></form><div id="code-out"></div></details>
      <p class="small muted">Échanges possibles jusqu'à ${S.close_hours} h avant la convocation. Un échange remet ta confirmation de venue à zéro.</p>${hist}`;
  };

  const bind = () => {
    box.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
      await api('/me/confirm', { method: 'POST', body: { present: b.dataset.confirm === '1' } });
      toast(b.dataset.confirm === '1' ? 'Merci, ta venue est confirmée' : 'Noté. Pense à libérer ta place si tu ne viens pas.');
      reload();
    }));
    box.querySelector('#ics')?.addEventListener('click', () => ics(C));
    box.querySelector('[data-go]')?.addEventListener('click', (e) => { e.preventDefault(); box.querySelector('#echanges')?.scrollIntoView({ behavior: 'smooth' }); });
    box.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => accept(b.dataset.accept)));
    const act = async (path, body, msg) => { try { await api(path, { method: 'POST', body }); toast(msg); reload(); } catch (e) { toast(e.message, 'error'); } };
    box.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => act('/me/swaps/decline', { code: b.dataset.decline }, 'Demande retirée de ton espace')));
    box.querySelectorAll('[data-propose]').forEach((b) => b.addEventListener('click', () => act('/me/swaps/propose', { code: b.dataset.propose }, 'Proposition envoyée : l\'étudiant va pouvoir accepter ou refuser')));
    box.querySelectorAll('[data-prop-refuse]').forEach((b) => b.addEventListener('click', () => act(`/me/proposals/${b.dataset.propRefuse}/refuse`, {}, 'Proposition refusée')));
    box.querySelectorAll('[data-prop-accept]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('Accepter cette proposition ? Ton parcours et ton numéro changent tout de suite.')) return;
      try { const r = await api(`/me/proposals/${b.dataset.propAccept}/accept`, { method: 'POST' }); toast(`C'est fait : tu passes ${frDate(r.now.date)}, série ${r.now.series}`); reload(); } catch (e) { toast(e.message, 'error'); }
    }));
    const allBox = box.querySelector('#all-opts');
    allBox?.addEventListener('change', () => box.querySelectorAll('.swap-opts input').forEach((i) => { i.checked = allBox.checked; }));
    const publish = async (wanted) => { try { await api('/me/swaps', { method: 'POST', body: { wanted } }); toast(wanted.length ? 'Demande publiée' : 'Code créé'); reload(); } catch (e) { toast(e.message, 'error'); } };
    box.querySelector('#post-swap')?.addEventListener('click', () => {
      const wanted = [...box.querySelectorAll('.swap-opts input:checked')].map((i) => i.value);
      if (!wanted.length) { toast('Coche au moins un créneau, ou crée seulement un code pour un ami', 'error'); return; }
      publish(wanted);
    });
    box.querySelector('#post-private')?.addEventListener('click', () => publish([]));
    box.querySelector('#cancel-swap')?.addEventListener('click', async () => { await api('/me/swaps', { method: 'DELETE' }); toast('Demande retirée'); reload(); });
    box.querySelector('#code-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = box.querySelector('#swap-code').value.trim();
      const out = box.querySelector('#code-out');
      try {
        const o = await api(`/me/swaps/${encodeURIComponent(code)}`);
        out.innerHTML = `<p>Ce code te propose <strong>${esc(when(o))}</strong> (${conv(o)}), à la place de ton créneau actuel.</p><button class="primary small" data-accept="${esc(code)}">Accepter l'échange</button>`;
        out.querySelector('[data-accept]').addEventListener('click', () => accept(code));
      } catch (err) { out.innerHTML = `<p class="alert warn">${esc(err.message)}</p>`; }
    });
  };

  const accept = async (code) => {
    if (!window.confirm('Échanger ton créneau ? Ton parcours et ton numéro changent tout de suite.')) return;
    try {
      const r = await api('/me/swaps/accept', { method: 'POST', body: { code } });
      toast(`C'est fait : tu passes ${frDate(r.now.date)}, série ${r.now.series}`);
      reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  draw();
  return C;
}
