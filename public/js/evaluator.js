import { api, esc, nl, toast, fmt, frDate, setTitle, plate, dom, disc } from './ui.js';
import { COM_LEVELS, GLOBAL_LEVELS, TYPE_LINE, missingAnswers, computeScore } from './shared.js';
import { seriesTimes, frTime } from './planning-shared.js';
import { raceHtml } from './race.js';

let ctx = null;
const filters = { day: null, series: '', q: '' };
let raceOpen = false;

async function loadCtx() {
  const [c, sch] = await Promise.all([api('/eval/context'), api('/eval/schedule').catch(() => null)]);
  ctx = c;
  // heure de passage de chaque candidat dans cette salle, d'après sa place dans la série
  if (sch) {
    for (const cand of ctx.candidates) {
      const ser = sch.planning.days.find((d) => d.date === cand.day)?.series[cand.series - 1];
      const r = sch.roundOf[cand.seat];
      cand.time = ser && r ? seriesTimes(sch.planning, ser, sch.slots.length).rounds[r - 1].start : null;
    }
    ctx.candidates.sort((a, b) => (a.day || '').localeCompare(b.day || '') || (a.series || 0) - (b.series || 0) || (a.time || '99').localeCompare(b.time || '99'));
  }
  return ctx;
}

export async function roomView(app) {
  await loadCtx();
  const s = ctx.station;
  setTitle(`Salle ${s.slot}`);
  const days = [...new Set(ctx.candidates.map((c) => c.day).filter(Boolean))].sort();
  const today = new Date().toISOString().slice(0, 10);
  if (filters.day === null) filters.day = days.includes(today) ? today : (days[0] || '');
  const v = ctx.vignette;
  const list = (a) => (a || []).filter((x) => x?.trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  const seriesOf = [...new Set(ctx.candidates.filter((c) => !filters.day || c.day === filters.day).map((c) => c.series).filter(Boolean))].sort();

  const draw = () => {
    const shown = ctx.candidates.filter((c) => (!filters.day || c.day === filters.day)
      && (!filters.series || String(c.series) === filters.series)
      && (!filters.q || `${c.number} ${c.first_name} ${c.last_name}`.toLowerCase().includes(filters.q.toLowerCase())));
    const done = shown.filter((c) => c.eval_id).length;
    const next = shown.find((c) => !c.eval_id && c.time);
    app.innerHTML = `
      <div class="room-head">${plate(s.slot, 'xl')}
        <div style="flex:1"><h1>${esc(s.title || s.domain || `Salle ${s.slot}`)}</h1>
          <div class="tags" style="margin-top:6px">${dom(s.domain)}${s.discipline ? `<span>${disc(s.discipline)}</span>` : ''}</div>
          <div class="muted small" style="margin-top:4px">${esc(ctx.evaluator)}, ${esc(ctx.exam.name)}</div></div></div>
      ${ctx.exam.eval_open ? '' : '<p class="alert warn">La saisie n\'est pas encore ouverte. L\'équipe l\'ouvre le matin du passage.</p>'}
      <details class="panel" style="padding:14px 18px"><summary style="cursor:pointer"><strong>Relire la vignette et les consignes</strong></summary>
        <div style="margin-top:10px"><p>${esc(v.role)}, ${esc(v.lieu)}</p><p>${nl(v.contexte)}</p>${v.infos ? `<p>${nl(v.infos)}</p>` : ''}
        ${list(v.doit) ? `<p><strong>Vous devez :</strong></p><ul>${list(v.doit)}</ul>` : ''}
        ${list(v.nedoitpas) ? `<p><strong>Vous ne devez pas :</strong></p><ul>${list(v.nedoitpas)}</ul>` : ''}
        <p><em>${esc(TYPE_LINE[s.type] || '')}</em></p>
        ${ctx.examinateur.scenario || ctx.examinateur.consignes ? `<h3>Pour toi</h3><p>${nl(ctx.examinateur.scenario)}</p><p>${nl(ctx.examinateur.consignes)}</p>` : ''}
        <h3>Repères de la performance globale</h3>
        <ul>${GLOBAL_LEVELS.map((l, i) => `<li><strong>${i}. ${l}</strong>${ctx.grille.global[i] ? ` : ${esc(ctx.grille.global[i])}` : ''}</li>`).join('')}</ul>
        <p class="small"><a href="#/apercu/${s.id}/grille" target="_blank">Imprimer la grille papier de secours</a></p></div>
      </details>
      <details class="panel race-panel" style="padding:14px 18px" ${raceOpen ? 'open' : ''}><summary style="cursor:pointer"><strong>🏇 La course du jour</strong> <span class="small muted" id="race-sum"></span></summary>
        <div id="race" style="margin-top:10px"><p class="muted small">Chargement…</p></div></details>
      <div class="row" style="margin-top:18px">
        ${days.length > 1 ? `<select id="day" style="max-width:190px" aria-label="Jour">${days.map((d) => `<option value="${d}" ${d === filters.day ? 'selected' : ''}>${frDate(d)}</option>`).join('')}<option value="" ${!filters.day ? 'selected' : ''}>Tous les jours</option></select>` : ''}
        <div class="chips" role="group" aria-label="Série"><button data-s="" class="${!filters.series ? 'on' : ''}">Toutes</button>
          ${seriesOf.map((n) => `<button data-s="${n}" class="${String(n) === filters.series ? 'on' : ''}">Série ${n}</button>`).join('')}</div>
        <span class="spacer"></span>
        <input id="q" type="text" placeholder="Numéro ou nom" value="${esc(filters.q)}" style="max-width:180px" aria-label="Chercher un candidat">
      </div>
      <p class="muted small" style="margin:12px 0 0">${done} grille${done > 1 ? 's' : ''} saisie${done > 1 ? 's' : ''} sur ${shown.length}. <button class="small quiet" id="reload">Actualiser</button></p>
      <div class="cand-list">${shown.map((c) => `<button class="cand ${c.eval_id ? 'done' : ''} ${c === next ? 'next' : ''}" data-id="${c.id}">${c === next ? '<span class="next-tag">À suivre</span>' : ''}
          <span class="cand-no">${esc(c.number || 'Sans numéro')}</span>${c.time ? `<span class="small muted">${frTime(c.time)}</span>` : ''}<span class="who">${esc(c.first_name)} ${esc((c.last_name || '').slice(0, 1))}.</span>
          <span class="st">${c.eval_id ? (c.absent ? 'Absent' : `${fmt(c.score, 1)} sur 20`) : 'À évaluer'}${c.n_others ? `<small class="faint" style="display:block">${c.eval_id ? 'ton binôme aussi' : 'déjà notée par ton binôme'}</small>` : ''}</span></button>`).join('') || '<p class="muted">Aucun candidat avec ces filtres.</p>'}</div>`;
    app.querySelector('#day')?.addEventListener('change', (e) => { filters.day = e.target.value; filters.series = ''; roomView(app); });
    app.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { filters.series = b.dataset.s; draw(); }));
    app.querySelector('#q').addEventListener('input', (e) => { filters.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = app.querySelector('#q'); q.focus(); q.setSelectionRange(pos, pos); });
    app.querySelector('#reload').addEventListener('click', () => roomView(app));
    app.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', () => { location.hash = `#/eval/candidat/${b.dataset.id}`; }));
    const rp = app.querySelector('.race-panel');
    rp.addEventListener('toggle', () => { raceOpen = rp.open; });
    api('/eval/race').then((R) => {
      const box = app.querySelector('#race'); if (!box) return;
      box.innerHTML = raceHtml(R, { me: ctx.evaluator });
      const i = R.horses.findIndex((h) => h.name.toLowerCase() === ctx.evaluator.toLowerCase());
      app.querySelector('#race-sum').textContent = i < 0 ? 'ton cheval attend ta première grille' : `tu es ${i + 1}${i ? 'e' : 'er'} sur ${R.horses.length}`;
    }).catch(() => { const box = app.querySelector('#race'); if (box) box.innerHTML = ''; });
  };
  draw();
}

export async function gridView(app, candidateId) {
  if (!ctx) await loadCtx();
  const cand = ctx.candidates.find((c) => String(c.id) === String(candidateId));
  if (!cand) { app.innerHTML = '<p class="alert error">Ce candidat n\'existe pas dans cette session.</p>'; return; }
  const existing = await api(`/eval/evaluations/${candidateId}`);
  const g = ctx.grille;
  const apt = g.apt.filter((i) => i.label?.trim());
  const com = g.com.filter((i) => i.label?.trim());
  const ans = { apt: existing?.answers?.apt ? structuredClone(existing.answers.apt) : {}, com: existing?.answers?.com ? { ...existing.answers.com } : {} };
  let global = existing?.global ?? null;
  let absent = !!existing?.absent;
  let comment = existing?.comment || '';
  let showMissing = false;
  setTitle(`${cand.number || ''}, salle ${ctx.station.slot}`);

  const draw = () => {
    const y = window.scrollY;
    const miss = new Set(missingAnswers(g, ans, global, absent));
    const sc = computeScore(g, ans, absent);
    const flag = (id) => (showMissing && miss.has(id) ? 'missing' : '');
    app.innerHTML = `
      <a class="back" href="#/eval">Retour à la liste</a>
      <div class="row between">
        <div class="cand-head">${plate(ctx.station.slot, 'lg')}<div><span class="cand-no">${esc(cand.number || '')}</span>
          <div class="muted">${esc(cand.first_name)} ${esc(cand.last_name)}</div></div></div>
        <button id="absent" class="${absent ? 'danger solid' : 'danger'}">${absent ? 'Absent : annuler' : 'Candidat absent'}</button></div>
      ${existing ? '<p class="alert info small">Tu as déjà rempli cette grille. Ce que tu enregistres remplace ta version.</p>' : ''}
      ${absent ? '<p class="alert warn">Le candidat sera noté absent à cette station. Elle ne comptera pas dans sa moyenne.</p>' : `
      <h2>Aptitudes cliniques et techniques</h2>
      ${apt.map((i, k) => { const a = ans.apt[i.id] || {}; return `<div class="q ${flag(i.id)}">
        <div class="label"><b>${k + 1}</b><span style="flex:1">${esc(i.label)}</span><span class="pts">${i.points || 1} pt</span></div>
        <div class="yesno"><button class="yes ${a.ok === true ? 'on' : ''}" data-apt="${i.id}" data-v="1" aria-pressed="${a.ok === true}">Observé</button>
          <button class="no ${a.ok === false ? 'on' : ''}" data-apt="${i.id}" data-v="0" aria-pressed="${a.ok === false}">Non observé</button></div>
        ${a.comment || a.editing ? `<input type="text" data-cmt="${i.id}" value="${esc(a.comment || '')}" placeholder="Précision pour le candidat" style="margin-top:8px" aria-label="Commentaire sur l'item ${k + 1}">`
          : `<button class="small quiet note-toggle" data-note="${i.id}">Ajouter une précision</button>`}
      </div>`; }).join('')}
      <h2>Communication et attitudes</h2>
      ${com.map((i) => `<div class="q ${flag(i.id)}"><div class="label"><span>${esc(i.label)}</span></div>
        <div class="scale">${COM_LEVELS.map((l) => { const on = ans.com[i.id] !== undefined && Number(ans.com[i.id]) === l.v; return `<button class="${on ? 'on' : ''}" data-com="${i.id}" data-v="${l.v}" aria-pressed="${on}"><strong>${String(l.v).replace('.', ',')}</strong>${l.l}</button>`; }).join('')}</div></div>`).join('')}
      <h2>Performance globale</h2>
      <div class="q ${flag('global')}">
        <div class="scale">${GLOBAL_LEVELS.map((l, k) => `<button class="${global === k ? 'on' : ''}" data-global="${k}" aria-pressed="${global === k}"><strong>${k}</strong>${l}</button>`).join('')}</div>
        ${global !== null && g.global[global] ? `<p class="small muted" style="margin:10px 0 0">${esc(g.global[global])}</p>` : ''}</div>
      <label for="comment">Commentaire pour le candidat <span class="hint">(une force, un point à travailler)</span></label>
      <textarea id="comment" rows="3">${esc(comment)}</textarea>`}
      <div class="sticky-bar">
        ${absent ? '<span><strong>Absent</strong></span>' : `<span class="score">${fmt(sc.score, 1)}<small> / 20</small></span>
        <span class="small ${miss.size ? '' : 'muted'}" style="${miss.size ? 'color:var(--ko);font-weight:700' : ''}">${miss.size ? `${miss.size} réponse${miss.size > 1 ? 's' : ''} manquante${miss.size > 1 ? 's' : ''}` : 'Grille complète'}</span>`}
        <span class="spacer"></span>
        <button class="primary" id="save" ${ctx.exam.eval_open ? '' : 'disabled'}>Enregistrer<span class="long">&nbsp;la grille</span></button></div>`;
    window.scrollTo(0, y);
    bind(miss);
  };

  const bind = (miss) => {
    app.querySelector('#absent').addEventListener('click', () => { absent = !absent; draw(); });
    app.querySelectorAll('[data-apt]').forEach((b) => b.addEventListener('click', () => {
      ans.apt[b.dataset.apt] = { ...(ans.apt[b.dataset.apt] || {}), ok: b.dataset.v === '1' };
      draw();
    }));
    app.querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.note;
      ans.apt[id] = { ...(ans.apt[id] || {}), comment: ans.apt[id]?.comment || '', editing: true };
      draw();
      app.querySelector(`[data-cmt="${id}"]`)?.focus();
    }));
    app.querySelectorAll('[data-cmt]').forEach((inp) => inp.addEventListener('input', () => { ans.apt[inp.dataset.cmt].comment = inp.value; }));
    app.querySelectorAll('[data-com]').forEach((b) => b.addEventListener('click', () => { ans.com[b.dataset.com] = Number(b.dataset.v); draw(); }));
    app.querySelectorAll('[data-global]').forEach((b) => b.addEventListener('click', () => { global = Number(b.dataset.global); draw(); }));
    app.querySelector('#comment')?.addEventListener('input', (e) => { comment = e.target.value; });
    app.querySelector('#save').addEventListener('click', async () => {
      if (miss.size && !absent) {
        showMissing = true; draw();
        toast(`Il manque ${miss.size} réponse${miss.size > 1 ? 's' : ''}`, 'error');
        app.querySelector('.missing')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const clean = Object.fromEntries(Object.entries(ans.apt).map(([k, v]) => [k, { ok: v.ok, comment: (v.comment || '').trim() }]));
      try {
        const r = await api('/eval/evaluations', { method: 'PUT', body: { candidate_id: cand.id, absent, answers: { apt: clean, com: ans.com }, global, comment } });
        toast(absent ? `${cand.number} noté absent` : `Grille enregistrée : ${fmt(r.score, 1)} sur 20`);
        ctx = null;
        location.hash = '#/eval';
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}
