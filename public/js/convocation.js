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
      ${S.enabled || S.history.length ? `<h2>Échanger mon créneau</h2>${swapHtml()}` : ''}`;
    bind();
  };

  const swapHtml = () => {
    const hist = S.history.length ? `<p class="small muted">Échanges déjà faits : ${S.history.length}. Ton créneau actuel est celui affiché plus haut.</p>` : '';
    if (!S.open) return `<div class="panel"><p style="margin:0">${esc(S.why || 'Échanges fermés.')}</p>${hist}</div>`;
    const offers = S.offers.length ? `<div class="panel hl"><h3 style="margin-top:0">${S.offers.length > 1 ? `${S.offers.length} étudiants veulent ta place` : 'Un étudiant veut ta place'}</h3>
      ${S.offers.map((o) => `<div class="row between swap-offer"><div><strong>${esc(when(o))}</strong><div class="small muted">${conv(o)}</div></div>
        <button class="primary small" data-accept="${esc(o.code)}">Échanger avec ce créneau</button></div>`).join('')}
      <p class="small muted" style="margin-bottom:0">L'échange est immédiat : tu prends son créneau et il prend le tien.</p></div>` : '';
    const mine = S.mine ? `<div class="panel"><h3 style="margin-top:0">Ta demande est en ligne</h3>
      ${S.mine.wanted.length ? `<p>Tu cherches : ${S.mine.wanted.map((k) => { const o = S.options.find((x) => x.key === k); return o ? `<strong>${esc(when(o))}</strong>` : ''; }).filter(Boolean).join(', ')}. Les étudiants de ces créneaux voient ta demande et peuvent l'accepter.</p>` : '<p>Ta demande n\'est visible par personne : elle ne sert qu\'avec le code ci-dessous.</p>'}
      <p>Tu t'es arrangé avec quelqu'un ? Donne-lui ce code, il l'entre dans son espace :</p><div class="code big-code">${esc(S.mine.code)}</div>
      <button class="small quiet" id="cancel-swap" style="margin-top:12px">Retirer ma demande</button></div>`
      : `<details class="panel"><summary style="cursor:pointer"><strong>Je voudrais un autre créneau</strong></summary>
        <p class="small muted">Coche les créneaux qui t'arrangent. Si un étudiant de l'un d'eux accepte, vos places sont échangées tout de suite. Sans rien cocher, ta demande reste privée et passe par un code à donner à un ami.</p>
        <div class="swap-opts">${S.options.map((o) => `<label class="check"><input type="checkbox" value="${esc(o.key)}"><span><strong>${esc(when(o))}</strong><br><span class="small muted">${conv(o)}</span></span></label>`).join('')}</div>
        <button class="primary" id="post-swap" style="margin-top:12px">Publier ma demande</button></details>`;
    return `${offers}${mine}
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
    box.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => accept(b.dataset.accept)));
    box.querySelector('#post-swap')?.addEventListener('click', async () => {
      const wanted = [...box.querySelectorAll('.swap-opts input:checked')].map((i) => i.value);
      try { await api('/me/swaps', { method: 'POST', body: { wanted } }); toast('Demande publiée'); reload(); } catch (e) { toast(e.message, 'error'); }
    });
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
