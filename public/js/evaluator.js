import { api, esc, nl, toast, fmt, frDate, setTitle } from './ui.js';
import { COM_LEVELS, GLOBAL_LEVELS, TYPE_LINE, missingAnswers, computeScore } from './shared.js';

let ctx = null;
const filters = { day: null, series: '', q: '' };

async function loadCtx() { ctx = await api('/eval/context'); return ctx; }

export async function roomView(app) {
  await loadCtx();
  const s = ctx.station;
  setTitle(`Salle ${s.slot}`);
  const days = [...new Set(ctx.candidates.map((c) => c.day).filter(Boolean))].sort();
  const today = new Date().toISOString().slice(0, 10);
  if (!filters.day) filters.day = days.includes(today) ? today : (days[0] || '');
  const v = ctx.vignette;
  const list = (a) => (a || []).filter((x) => x?.trim()).map((x) => `<li>${esc(x)}</li>`).join('');

  const draw = () => {
    const shown = ctx.candidates.filter((c) => (!filters.day || c.day === filters.day)
      && (!filters.series || String(c.series) === filters.series)
      && (!filters.q || `${c.number} ${c.first_name} ${c.last_name}`.toLowerCase().includes(filters.q.toLowerCase())));
    const done = shown.filter((c) => c.eval_id).length;
    app.innerHTML = `
      <div class="row between"><div><h1>Salle ${esc(s.slot)}</h1>
        <div class="muted small">${esc(ctx.exam.name)} · ${esc(s.title || s.domain || '')} · évaluateur : ${esc(ctx.evaluator)}</div></div>
        <button id="reload" class="small">Actualiser</button></div>
      ${ctx.exam.eval_open ? '' : '<p class="alert warn">La saisie est fermée pour l\'instant. L\'équipe l\'ouvre le matin du passage.</p>'}
      <details class="card"><summary><strong>Vignette et consignes</strong></summary>
        <p>${esc(v.role)} – ${esc(v.lieu)}</p><p>${nl(v.contexte)}</p>${v.infos ? `<p>${nl(v.infos)}</p>` : ''}
        ${list(v.doit) ? `<p><strong>Vous devez :</strong></p><ul>${list(v.doit)}</ul>` : ''}
        ${list(v.nedoitpas) ? `<p><strong>Vous ne devez pas :</strong></p><ul>${list(v.nedoitpas)}</ul>` : ''}
        <p><em>${esc(TYPE_LINE[s.type] || '')}</em></p>
        ${ctx.examinateur.scenario || ctx.examinateur.consignes ? `<h3>Consignes à l'examinateur</h3><p>${nl(ctx.examinateur.scenario)}</p><p>${nl(ctx.examinateur.consignes)}</p>` : ''}
        <h3>Performance globale : descripteurs</h3>
        <ul>${GLOBAL_LEVELS.map((l, i) => `<li><strong>${i} – ${l}</strong> : ${esc(ctx.grille.global[i] || '')}</li>`).join('')}</ul>
        <p class="small"><a href="#/apercu/${s.id}/grille" target="_blank">Grille papier de secours</a></p>
      </details>
      <div class="card">
        <div class="row">
          <select id="day" style="max-width:200px">${days.map((d) => `<option value="${d}" ${d === filters.day ? 'selected' : ''}>${frDate(d)}</option>`).join('')}<option value="" ${!filters.day ? 'selected' : ''}>Tous les jours</option></select>
          <select id="series" style="max-width:150px"><option value="">Toutes les séries</option>${[1, 2, 3, 4].map((n) => `<option value="${n}" ${String(n) === filters.series ? 'selected' : ''}>Série ${n}</option>`).join('')}</select>
          <input id="q" type="text" placeholder="N° ou nom" value="${esc(filters.q)}" style="max-width:180px">
          <span class="small muted">${done} / ${shown.length} saisi(s)</span>
        </div>
        <div class="cand-list" style="margin-top:12px">${shown.map((c) => `<button class="cand ${c.eval_id ? 'done' : ''}" data-id="${c.id}">
          <div class="n">${esc(c.number || '—')}</div><div class="small">${esc(c.first_name)} ${esc((c.last_name || '').slice(0, 1))}.</div>
          <div class="small muted">${c.eval_id ? (c.absent ? 'absent' : `${fmt(c.score, 1)} / 20`) : 'à évaluer'}</div></button>`).join('') || '<p class="muted">Aucun candidat pour ce filtre.</p>'}</div>
      </div>`;
    app.querySelector('#day').addEventListener('change', (e) => { filters.day = e.target.value; draw(); });
    app.querySelector('#series').addEventListener('change', (e) => { filters.series = e.target.value; draw(); });
    app.querySelector('#q').addEventListener('input', (e) => { filters.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = app.querySelector('#q'); q.focus(); q.setSelectionRange(pos, pos); });
    app.querySelector('#reload').addEventListener('click', () => roomView(app));
    app.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', () => { location.hash = `#/eval/candidat/${b.dataset.id}`; }));
  };
  draw();
}

export async function gridView(app, candidateId) {
  if (!ctx) await loadCtx();
  const cand = ctx.candidates.find((c) => String(c.id) === String(candidateId));
  if (!cand) { app.innerHTML = '<p class="alert error">Candidat introuvable.</p>'; return; }
  const existing = await api(`/eval/evaluations/${candidateId}`);
  const g = ctx.grille;
  const apt = g.apt.filter((i) => i.label?.trim());
  const com = g.com.filter((i) => i.label?.trim());
  const ans = { apt: existing?.answers?.apt ? structuredClone(existing.answers.apt) : {}, com: existing?.answers?.com ? { ...existing.answers.com } : {} };
  let global = existing?.global ?? null;
  let absent = !!existing?.absent;
  let comment = existing?.comment || '';
  let showMissing = false;
  setTitle(`${cand.number || ''} · Salle ${ctx.station.slot}`);

  const draw = () => {
    const miss = new Set(missingAnswers(g, ans, global, absent));
    const sc = computeScore(g, ans, absent);
    const flag = (id) => (showMissing && miss.has(id) ? 'missing' : '');
    app.innerHTML = `
      <p class="small"><a href="#/eval">← Liste des candidats</a></p>
      <div class="row between"><div><h1><span class="code">${esc(cand.number || '—')}</span> ${esc(cand.first_name)} ${esc(cand.last_name)}</h1>
        <div class="small muted">Salle ${esc(ctx.station.slot)} · ${cand.day ? frDate(cand.day) : ''} · série ${cand.series ?? '?'}
        ${existing ? ` · déjà saisie par ${esc(existing.evaluator_name)}, tu la modifies` : ''}</div></div>
        <button id="absent" class="${absent ? 'danger' : ''}">${absent ? 'Marqué absent (annuler)' : 'Candidat absent'}</button></div>
      ${absent ? '<p class="alert warn">Le candidat sera noté absent pour cette station. Elle ne comptera pas dans sa moyenne.</p>' : `
      <div class="card"><h2>Aptitudes cliniques et techniques</h2>
        ${apt.map((i, k) => { const a = ans.apt[i.id] || {}; return `<div class="grid-item ${flag(i.id)}">
          <div>${k + 1}. ${esc(i.label)} <span class="muted small">(${i.points || 1} pt)</span></div>
          <div class="choice"><button class="yes ${a.ok === true ? 'on' : ''}" data-apt="${i.id}" data-v="1">Observé</button>
            <button class="no ${a.ok === false ? 'on' : ''}" data-apt="${i.id}" data-v="0">Non observé</button>
            <button class="small" data-note="${i.id}">${a.comment ? 'Commentaire ✓' : '+ Commentaire'}</button></div>
          ${a.comment || a.editing ?`<input type="text" data-cmt="${i.id}" value="${esc(a.comment || '')}" placeholder="Précision pour le candidat" style="margin-top:6px">` : ''}
        </div>`; }).join('')}</div>
      <div class="card"><h2>Communication et attitudes</h2>
        ${com.map((i) => `<div class="grid-item ${flag(i.id)}"><div>${esc(i.label)}</div>
          <div class="choice">${COM_LEVELS.map((l) => `<button class="${Number(ans.com[i.id]) === l.v && ans.com[i.id] !== undefined ? 'on' : ''}" data-com="${i.id}" data-v="${l.v}">${l.l}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="card"><h2>Performance globale</h2>
        <div class="grid-item ${flag('global')}"><div class="choice">${GLOBAL_LEVELS.map((l, k) => `<button class="${global === k ? 'on' : ''}" data-global="${k}">${k} · ${l}</button>`).join('')}</div>
        ${global !== null && g.global[global] ? `<p class="small muted" style="margin:6px 0 0">${esc(g.global[global])}</p>` : ''}</div>
        <label>Commentaire pour le candidat <span class="hint">(une force, un point à travailler)</span></label>
        <textarea id="comment" rows="3">${esc(comment)}</textarea></div>`}
      <div class="sticky-bottom row between">
        <span class="small">${absent ? 'Absent' : `${miss.size ? `<strong style="color:var(--err)">${miss.size} élément(s) à remplir</strong>` : 'Grille complète'} · note provisoire ${fmt(sc.score, 2)} / 20`}</span>
        <button class="primary" id="save" ${ctx.exam.eval_open ? '' : 'disabled'}>Enregistrer</button></div>`;
    bind(miss);
  };

  const bind = (miss) => {
    app.querySelector('#absent').addEventListener('click', () => { absent = !absent; draw(); });
    app.querySelectorAll('[data-apt]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.apt;
      ans.apt[id] = { ...(ans.apt[id] || {}), ok: b.dataset.v === '1' };
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
        toast(`${miss.size} élément(s) à remplir avant d'enregistrer`, 'error');
        app.querySelector('.missing')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const clean = Object.fromEntries(Object.entries(ans.apt).map(([k, v]) => [k, { ok: v.ok, comment: (v.comment || '').trim() }]));
      try {
        const r = await api('/eval/evaluations', { method: 'PUT', body: { candidate_id: cand.id, absent, answers: { apt: clean, com: ans.com }, global, comment } });
        toast(absent ? 'Absence enregistrée' : `Enregistré : ${fmt(r.score, 2)} / 20`);
        ctx = null;
        location.hash = '#/eval';
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}
