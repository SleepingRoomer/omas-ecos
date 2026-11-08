// Bénévoles : inscription publique, espace personnel, planning de l'équipe, calibration et suivi
import { api, esc, toast, setTitle, plate, frDate, longDate, fmt, pct, csvCell } from './ui.js';
import { COM_LEVELS, computeScore } from './shared.js';

const HALF = { am: 'Matin', pm: 'Après-midi' };
const hdLabel = (k) => { const [d, h] = k.split('|'); return `${longDate(d)}, ${HALF[h].toLowerCase()}`; };
const STATUS = ['Externe', 'Interne', 'Médecin', 'Autre soignant', 'Autre'];

// ---------- inscription publique ----------
export async function publicSignup(app, examId) {
  let E;
  try { E = await api(`/public/exams/${examId}/benevoles`); } catch { app.innerHTML = '<p class="alert error">Session introuvable.</p>'; return; }
  setTitle(`Bénévoles, ${E.name}`);
  if (!E.open) { app.innerHTML = `<div class="narrow"><h1>${esc(E.name)}</h1><p class="panel">Les inscriptions des bénévoles ne sont pas ouvertes pour cette session.</p></div>`; return; }
  const byDay = {}; for (const h of E.halfdays) (byDay[h.day] ||= []).push(h);
  app.innerHTML = `<div class="narrow" style="max-width:660px">
    <h1>Devenir bénévole</h1>
    <p class="lede">${esc(E.name)}</p>
    <p>Sans évaluateurs, patients et professionnels standardisés, pas d'ECOS blancs. Une demi-journée suffit, et on t'explique tout : grille en main, calibration en ligne avant la session, débrief à la fin.</p>
    <form id="vf" class="panel">
      <div class="grid cols-2" style="gap:10px"><div><label for="v-ln" style="margin-top:0">Nom</label><input id="v-ln" name="last_name" required autocomplete="family-name"></div>
        <div><label for="v-fn" style="margin-top:0">Prénom</label><input id="v-fn" name="first_name" required autocomplete="given-name"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="v-em">E-mail</label><input id="v-em" name="email" type="email" required autocomplete="email"></div>
        <div><label for="v-ph">Téléphone</label><input id="v-ph" name="phone" autocomplete="tel"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="v-st">Tu es</label><select id="v-st" name="status">${STATUS.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div><label for="v-sp">Spécialité ou année <span class="hint">(facultatif)</span></label><input id="v-sp" name="specialty" placeholder="Interne de MG, DFASM3…"></div></div>
      <fieldset class="vol-roles"><legend>Ce que tu veux bien faire</legend>
        ${Object.entries(E.roles).map(([k, l]) => `<label class="check"><input type="checkbox" name="roles" value="${k}" ${k === 'evaluateur' ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
        <p class="small muted" style="margin:4px 0 0">Les PS jouent un patient d'après un script, les PSS un soignant (infirmier, collègue au téléphone…).</p></fieldset>
      <fieldset><legend>Tes disponibilités <span class="hint">(une demi-journée par jour au plus)</span></legend>
        <div class="vol-days">${Object.entries(byDay).map(([d, hs]) => `<div class="vol-day"><strong>${esc(longDate(d))}</strong>
          <div class="seg small">${hs.map((h) => `<label class="pick"><input type="checkbox" name="halfdays" value="${h.key}" data-day="${d}"><span>${HALF[h.half]}</span></label>`).join('')}</div></div>`).join('')}</div></fieldset>
      <label for="v-no">Un mot pour l'équipe <span class="hint">(facultatif)</span></label><input id="v-no" name="note" placeholder="Je viens avec une amie, je préfère la cardio…">
      <p class="small muted">Tes coordonnées servent uniquement à organiser les ECOS blancs de l'OMAS et à te recontacter pour les prochaines sessions.</p>
      <button class="primary" style="margin-top:6px">Je m'inscris</button>
    </form><div id="vf-out"></div></div>`;
  // une seule demi-journée par jour : cocher le matin décoche l'après-midi
  app.querySelectorAll('[name=halfdays]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) app.querySelectorAll(`[name=halfdays][data-day="${cb.dataset.day}"]`).forEach((o) => { if (o !== cb) o.checked = false; });
  }));
  app.querySelector('#vf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd); body.roles = fd.getAll('roles'); body.halfdays = fd.getAll('halfdays');
    try {
      const r = await api(`/public/exams/${examId}/benevoles`, { method: 'POST', body });
      app.querySelector('#vf').remove();
      app.querySelector('#vf-out').innerHTML = `<div class="alert ok"><strong>Merci, c'est noté${r.updated ? ' (ton inscription est mise à jour)' : ''} !</strong>
        <p>Ton code personnel : <span class="code" style="font-size:1.3em">${esc(r.code)}</span>. Garde-le : il ouvre ton espace bénévole, avec ton planning, la calibration de ta station et l'accès direct à ta salle le jour J.</p>
        <a class="button primary" href="#/?role=evaluateur&code=${esc(r.code)}">Ouvrir mon espace</a></div>`;
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- inscription publique des évaluateurs ----------
export async function publicEvaluatorSignup(app, examId) {
  let E;
  try { E = await api(`/public/exams/${examId}/evaluateurs`); } catch { app.innerHTML = '<p class="alert error">Session introuvable.</p>'; return; }
  setTitle(`Évaluateurs, ${E.name}`);
  if (!E.open) { app.innerHTML = `<div class="narrow"><h1>${esc(E.name)}</h1><p class="panel">Les inscriptions des évaluateurs ne sont pas ouvertes pour cette session.</p></div>`; return; }
  const byDay = {}; for (const h of E.halfdays) (byDay[h.day] ||= []).push(h);
  const days = Object.keys(byDay);
  app.innerHTML = `<div class="narrow" style="max-width:680px">
    <h1>Devenir évaluateur</h1>
    <p class="lede">${esc(E.name)}${E.place ? `, ${esc(E.place)}` : ''}</p>
    <div class="panel ev-why">
      <p>Les ECOS blancs d'OMAS Externat reproduisent l'examen national : dix stations de huit minutes, deux circuits, des patients standardisés. Ce qui en fait un vrai entraînement, c'est le regard d'un soignant dans chaque salle.</p>
      <div class="ev-steps">
        <div><b>Avant</b><span>Dix minutes en ligne : la vignette de votre station et une calibration sur un passage de référence, pour que les notes soient comparables d'une salle à l'autre.</span></div>
        <div><b>Le jour J</b><span>Briefing une heure avant la première série, puis vous notez chaque candidat sur votre téléphone : grille d'items, communication, un mot de retour. ${E.per_room > 1 ? `Vous êtes ${E.per_room} par salle.` : ''}</span></div>
        <div><b>Après</b><span>Un débrief de trente minutes avec les candidats de la série, et une attestation de participation si vous la souhaitez.</span></div>
      </div>
    </div>
    <form id="ef" class="panel">
      <div class="grid cols-2" style="gap:10px"><div><label for="e-ln" style="margin-top:0">Nom</label><input id="e-ln" name="last_name" required autocomplete="family-name"></div>
        <div><label for="e-fn" style="margin-top:0">Prénom</label><input id="e-fn" name="first_name" required autocomplete="given-name"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="e-em">E-mail</label><input id="e-em" name="email" type="email" required autocomplete="email"></div>
        <div><label for="e-ph">Téléphone <span class="hint">(pour le jour J)</span></label><input id="e-ph" name="phone" autocomplete="tel"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="e-st">Vous êtes</label><select id="e-st" name="status">${E.statuses.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
        <div><label for="e-sp">Spécialité</label><input id="e-sp" name="specialty" placeholder="Médecine générale, cardiologie…"></div></div>
      ${E.disciplines.length ? `<fieldset class="vol-roles"><legend>Les disciplines où vous êtes à l'aise <span class="hint">(facultatif, pour vous placer au mieux)</span></legend>
        <div class="ev-disc">${E.disciplines.map((d) => `<label class="pick"><input type="checkbox" name="disciplines" value="${esc(d)}"><span>${esc(d)}</span></label>`).join('')}</div>
        <p class="small muted" style="margin:6px 0 0">Les grilles sont écrites pour être remplies par tout soignant : ce n'est qu'une préférence.</p></fieldset>` : ''}
      <fieldset><legend>Vos disponibilités <span class="hint">(une demi-journée ou la journée)</span></legend>
        <div class="vol-days">${days.map((d) => `<div class="vol-day"><strong>${esc(longDate(d))}</strong>
          <div class="seg small">${byDay[d].map((h) => `<label class="pick"><input type="checkbox" name="halfdays" value="${h.key}"><span>${HALF[h.half]}</span></label>`).join('')}</div></div>`).join('')}</div></fieldset>
      <label class="check" style="margin-top:12px"><input type="checkbox" name="first_time"><span>C'est ma première fois comme évaluateur aux ECOS blancs</span></label>
      <label class="check"><input type="checkbox" name="attestation" checked><span>Je souhaite une attestation de participation</span></label>
      <label for="e-no">Un mot pour l'équipe <span class="hint">(facultatif)</span></label><input id="e-no" name="note" placeholder="Je viens avec un collègue, je dois partir à 17 h…">
      <p class="small muted">Vos coordonnées servent uniquement à organiser les ECOS blancs d'OMAS Externat et à vous recontacter pour les prochaines sessions.</p>
      <button class="primary" style="margin-top:6px">Je m'inscris comme évaluateur</button>
    </form><div id="ef-out"></div></div>`;
  app.querySelector('#ef').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd); body.halfdays = fd.getAll('halfdays'); body.disciplines = fd.getAll('disciplines');
    body.first_time = fd.has('first_time'); body.attestation = fd.has('attestation');
    try {
      const r = await api(`/public/exams/${examId}/evaluateurs`, { method: 'POST', body });
      app.querySelector('#ef').remove();
      app.querySelector('#ef-out').innerHTML = `<div class="alert ok"><strong>Merci, c'est noté${r.updated ? ' (votre inscription est mise à jour)' : ''} !</strong>
        <p>Votre code personnel : <span class="code" style="font-size:1.3em">${esc(r.code)}</span>. Gardez-le : il ouvre votre espace évaluateur, avec votre planning, la calibration de votre station et, le jour J, l'accès direct à votre salle.</p>
        <a class="button primary" href="#/?role=evaluateur&code=${esc(r.code)}">Ouvrir mon espace</a></div>`;
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- espace du bénévole ----------
export async function volunteerSpace(app) {
  const M = await api('/benevole/me');
  const isEval = M.me.prefs?.track === 'evaluateur';
  setTitle(isEval ? 'Mon espace évaluateur' : 'Mon espace bénévole');
  const now = M.assignments.find((a) => a.now && a.role === 'evaluateur' && a.station_id);
  const todo = M.calibrations.filter((k) => k.agreement === null || k.agreement === undefined);
  app.innerHTML = `
    <h1>Bonjour ${esc(M.me.first_name)}</h1>
    <p class="lede">${esc(M.exam.name)}${M.exam.place ? `, ${esc(M.exam.place)}` : ''}. ${isEval ? 'Merci de donner de votre temps aux candidats.' : 'Merci d\'être là.'}</p>
    ${now ? `<div class="panel vol-now"><div class="row between"><div>${plate(now.slot, 'lg')} <strong>C'est maintenant : salle ${esc(now.slot)}</strong>
        <div class="small muted">${esc(now.title || '')}</div></div>
      <button class="primary" id="enter" ${M.exam.eval_open ? '' : 'disabled'}>Ouvrir ma salle</button></div>
      ${M.exam.eval_open ? '' : `<p class="small muted" style="margin:8px 0 0">La saisie ouvre d'elle-même une heure avant la première convocation${M.exam.opens_at ? `, le ${esc(new Date(M.exam.opens_at).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }))}` : ''}.</p>`}</div>` : ''}
    <h2>Mon planning</h2>
    ${M.assignments.length ? `<div class="vol-plan">${M.assignments.map((a) => `<div class="vol-slot ${a.now ? 'now' : ''}">
        <div class="small muted">${esc(longDate(a.day))}</div><strong>${HALF[a.half]}${a.times ? `, convocation ${esc(a.times.from)}` : ''}</strong>
        <div class="row" style="margin-top:6px">${a.slot ? plate(a.slot) : ''}<span>${esc(M.roles[a.role])}${a.slot ? `, salle ${esc(a.slot)}` : ''}</span></div>
        ${a.title && a.role !== 'logistique' ? `<div class="small muted">${esc(a.title)}</div>` : ''}</div>`).join('')}</div>`
    : `<p class="panel">L'équipe prépare le planning. Tu as proposé : ${M.me.halfdays.map((k) => esc(hdLabel(k))).join(', ') || 'aucune demi-journée'}.</p>`}
    ${M.calibrations.length ? `<h2>Calibration</h2>
      <p class="small muted">Avant la session, note un passage de référence avec la grille de ta station. Tu vois ensuite où tu t'écartes de la correction de l'équipe : c'est ce qui rend les notes comparables d'une salle à l'autre.</p>
      <div class="vol-plan">${M.calibrations.map((k) => `<a class="vol-slot link" href="#/calibration/${k.station_id}">
        <div class="row">${plate(k.slot)}<strong>Salle ${esc(k.slot)}</strong></div>
        ${k.agreement === null || k.agreement === undefined ? '<span class="pill warn">À faire</span>'
          : `<span class="small">Accord ${pct(k.agreement)}, ta note ${fmt(k.score, 1)} contre ${fmt(k.ref_score, 1)}</span>`}</a>`).join('')}</div>
      ${todo.length ? `<p class="small">${todo.length} calibration${todo.length > 1 ? 's' : ''} à faire.</p>` : ''}` : ''}
    ${M.history.length > 1 ? `<h2>Avec l'OMAS</h2><p>${M.history.length} sessions, ${M.history.reduce((a, h) => a + h.halfdays, 0)} demi-journées. Merci !</p>` : ''}
    <p class="small muted" style="margin-top:28px">Ton code personnel : <span class="code">${esc(M.me.code)}</span></p>`;
  app.querySelector('#enter')?.addEventListener('click', async () => {
    try { await api('/benevole/enter', { method: 'POST' }); location.hash = '#/eval'; location.reload(); } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- calibration ----------
export async function calibrationView(app, stationId, kind) {
  const D = await api(`/stations/${stationId}/calibration`);
  const admin = kind === 'admin';
  const g = D.grille;
  const apt = g.apt.filter((i) => i.label?.trim());
  const com = g.com.filter((i) => i.label?.trim());
  const ref = D.calibration?.reference || { apt: {}, com: {} };
  const ans = admin ? structuredClone({ apt: ref.apt || {}, com: ref.com || {} }) : structuredClone(D.mine?.answers || { apt: {}, com: {} });
  let result = D.mine ? { ...D.mine, reference: ref } : null;
  let scenario = D.calibration?.scenario || '';
  let video = D.calibration?.video_url || '';
  setTitle(`Calibration, salle ${D.station.slot}`);
  const back = admin ? `#/admin/session/${D.station.exam_id}/benevoles` : '#/benevole';
  const draw = () => {
    const y = window.scrollY;
    const sc = computeScore(g, ans, false);
    const R = result?.reference;
    const diff = (id) => (R && !admin ? ((ans.apt[id]?.ok === true) !== (R.apt?.[id]?.ok === true) ? 'off' : 'same') : '');
    app.innerHTML = `
      <a class="back" href="${back}">Retour</a>
      <div class="row">${plate(D.station.slot, 'lg')}<div><h1 style="margin:0">Calibration</h1><div class="muted">${esc(D.station.title || '')}</div></div></div>
      ${admin ? `<p class="small muted">Décris un passage type (ou mets le lien d'une vidéo), puis coche la grille comme l'équipe la corrigerait : c'est la référence à laquelle chaque évaluateur se compare.</p>
        <label for="k-sc">Le passage à noter</label><textarea id="k-sc" rows="8" placeholder="Le candidat entre, se présente, ne vérifie pas l'identité…">${esc(scenario)}</textarea>
        <label for="k-vi">Vidéo <span class="hint">(lien https, facultatif)</span></label><input id="k-vi" value="${esc(video)}" placeholder="https://…">`
      : !D.calibration ? '<p class="panel">Pas encore de passage de référence pour cette station.</p>'
      : `${D.vignette.contexte || (D.vignette.doit || []).some(Boolean) ? `<div class="panel"><h3 style="margin-top:0">Consigne du candidat</h3><p>${esc(D.vignette.contexte || '')}</p>
          ${(D.vignette.doit || []).filter(Boolean).length ? `<ul>${D.vignette.doit.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        <div class="panel"><h3 style="margin-top:0">Le passage</h3><p style="white-space:pre-wrap">${esc(D.calibration.scenario || '')}</p>
          ${D.calibration.video_url ? `<p><a href="${esc(D.calibration.video_url)}" target="_blank" rel="noopener noreferrer">Voir la vidéo</a></p>` : ''}</div>
        ${result ? `<div class="alert ${result.agreement >= 0.85 ? 'ok' : 'warn'}"><strong>Accord avec la référence : ${pct(result.agreement)}</strong>.
          Ta note ${fmt(result.score, 1)}, celle de l'équipe ${fmt(result.ref_score, 1)}. Les items surlignés sont ceux où tu t'écartes : relis-les avant le jour J.</div>` : ''}`}
      ${admin || D.calibration ? `<h2>Aptitudes cliniques et techniques</h2>
      ${apt.map((i, k) => { const a = ans.apt[i.id] || {}; const d = diff(i.id); return `<div class="q ${d === 'off' ? 'calib-off' : ''}">
        <div class="label"><b>${k + 1}</b><span style="flex:1">${esc(i.label)}</span><span class="pts">${i.points || 1} pt</span></div>
        <div class="yesno"><button class="yes ${a.ok === true ? 'on' : ''}" data-apt="${i.id}" data-v="1">Observé</button>
          <button class="no ${a.ok === false ? 'on' : ''}" data-apt="${i.id}" data-v="0">Non observé</button></div>
        ${d === 'off' ? `<p class="small" style="margin:6px 0 0">Référence : <strong>${R.apt?.[i.id]?.ok ? 'observé' : 'non observé'}</strong></p>` : ''}</div>`; }).join('')}
      <h2>Communication et attitudes</h2>
      ${com.map((i) => `<div class="q"><div class="label"><span>${esc(i.label)}</span></div>
        <div class="scale">${COM_LEVELS.map((l) => `<button class="${ans.com[i.id] !== undefined && Number(ans.com[i.id]) === l.v ? 'on' : ''}" data-com="${i.id}" data-v="${l.v}"><strong>${String(l.v).replace('.', ',')}</strong>${l.l}</button>`).join('')}</div>
        ${R && !admin && R.com?.[i.id] !== undefined && Number(R.com[i.id]) !== Number(ans.com[i.id]) ? `<p class="small" style="margin:6px 0 0">Référence : <strong>${String(R.com[i.id]).replace('.', ',')}</strong></p>` : ''}</div>`).join('')}
      <div class="sticky-bar"><span class="score">${fmt(sc.score, 1)}<small> / 20</small></span><span class="spacer"></span>
        <button class="primary" id="save">${admin ? 'Enregistrer la référence' : result ? 'Corriger et revoir' : 'Valider et comparer'}</button></div>` : ''}`;
    window.scrollTo(0, y);
    app.querySelectorAll('[data-apt]').forEach((b) => b.addEventListener('click', () => { ans.apt[b.dataset.apt] = { ok: b.dataset.v === '1' }; draw(); }));
    app.querySelectorAll('[data-com]').forEach((b) => b.addEventListener('click', () => { ans.com[b.dataset.com] = Number(b.dataset.v); draw(); }));
    app.querySelector('#k-sc')?.addEventListener('input', (e) => { scenario = e.target.value; });
    app.querySelector('#k-vi')?.addEventListener('input', (e) => { video = e.target.value; });
    app.querySelector('#save')?.addEventListener('click', async () => {
      try {
        if (admin) {
          await api(`/stations/${stationId}/calibration`, { method: 'PUT', body: { scenario, video_url: video, reference: ans } });
          toast('Référence enregistrée');
        } else {
          result = await api(`/stations/${stationId}/calibration/answer`, { method: 'POST', body: { answers: ans } });
          draw(); window.scrollTo(0, 0);
        }
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}

// ---------- onglet de l'équipe ----------
// Ce qu'il faut dans une salle selon le type de station
const needs = (st, perRoom) => [...Array.from({ length: perRoom }, (_, i) => ({ role: 'evaluateur', label: `Évaluateur ${i + 1}` })),
  ...(st.type === 'PS' ? [{ role: 'ps', label: 'PS' }] : st.type === 'PSS' ? [{ role: 'pss', label: 'PSS' }] : [])];

export async function benevolesTab(box, exam) {
  const D = await api(`/exams/${exam.id}/benevoles`);
  const link = `${location.origin}/#/benevole/${exam.id}`;
  const linkEval = `${location.origin}/#/evaluateur/${exam.id}`;
  const discOf = (st) => (st.discipline || st.domain || '').toLowerCase();
  const likes = (s, st) => (s.prefs?.disciplines || []).some((d) => d.toLowerCase() === discOf(st));
  let hd = D.halfdays[0]?.key || null;
  // affectations en cours d'édition, par demi-journée
  const plan = {};
  for (const h of D.halfdays) plan[h.key] = { rooms: {}, logistique: [] };
  for (const a of D.assignments) {
    const p = plan[`${a.day}|${a.half}`]; if (!p) continue;
    if (a.role === 'logistique' || !a.station_id) p.logistique.push(a.signup_id);
    else (p.rooms[a.station_id] ||= []).push({ role: a.role, signup_id: a.signup_id });
  }
  const sById = Object.fromEntries(D.signups.map((s) => [s.id, s]));
  const avail = (k) => D.signups.filter((s) => s.halfdays.includes(k));
  const used = (k) => { const p = plan[k]; return new Set([...Object.values(p.rooms).flat().map((x) => x.signup_id), ...p.logistique]); };
  const coverage = (k) => {
    let need = 0; let got = 0;
    for (const st of D.stations) for (const [i, n] of needs(st, D.per_room).entries()) { need++; if (slotOf(k, st.id, n.role, i)) got++; }
    return { need, got };
  };
  const slotOf = (k, stId, role, i) => (plan[k].rooms[stId] || []).filter((x) => x.role === role)[role === 'evaluateur' ? i : 0]?.signup_id || null;
  const setSlot = (k, stId, role, i, sid) => {
    const list = plan[k].rooms[stId] ||= [];
    const same = list.filter((x) => x.role === role);
    const others = list.filter((x) => x.role !== role);
    const idx = role === 'evaluateur' ? i : 0;
    same[idx] = sid ? { role, signup_id: sid } : null;
    plan[k].rooms[stId] = [...others, ...same.filter(Boolean)];
  };

  // Affectation automatique : d'abord les rôles rares (PS, PSS), puis les évaluateurs, en commençant par ceux qui ont le moins de choix.
  // Un bénévole qui a déjà fait une salle à la même session y retourne si possible (moins de grilles à découvrir).
  const auto = (k) => {
    const p = plan[k];
    const pool = avail(k).filter((s) => !used(k).has(s.id));
    // on remet quelqu'un dans la salle qu'il a déjà faite, sinon dans une discipline qu'il a cochée
    const prefer = (s, stId) => (D.assignments.some((a) => a.signup_id === s.id && a.station_id === stId) ? 0 : likes(s, D.stations.find((x) => x.id === stId) || {}) ? 1 : 2);
    for (const role of ['ps', 'pss', 'evaluateur']) {
      for (const st of D.stations) {
        needs(st, D.per_room).forEach((n, i) => {
          if (n.role !== role || slotOf(k, st.id, role, i)) return;
          const cands = pool.filter((s) => s.roles.includes(role)).sort((a, b) => prefer(a, st.id) - prefer(b, st.id) || a.roles.length - b.roles.length);
          if (!cands.length) return;
          setSlot(k, st.id, role, i, cands[0].id);
          pool.splice(pool.indexOf(cands[0]), 1);
        });
      }
    }
    for (const s of pool.filter((x) => x.roles.includes('logistique'))) p.logistique.push(s.id);
  };
  const itemsOf = (k) => {
    const [day, half] = k.split('|');
    return [...Object.entries(plan[k].rooms).flatMap(([stId, l]) => l.map((x) => ({ signup_id: x.signup_id, role: x.role, station_id: Number(stId), day, half }))),
      ...plan[k].logistique.map((sid) => ({ signup_id: sid, role: 'logistique', station_id: null, day, half }))];
  };
  const save = async (k) => {
    const [day, half] = k.split('|');
    await api(`/exams/${exam.id}/assignments`, { method: 'PUT', body: { scope: { day, half }, items: itemsOf(k) } });
  };

  const draw = () => {
    const A = hd ? avail(hd) : [];
    const U = hd ? used(hd) : new Set();
    const cov = hd ? coverage(hd) : { need: 0, got: 0 };
    const opt = (role, cur, st) => `<option value="">–</option>${A.filter((s) => s.roles.includes(role) && (!U.has(s.id) || s.id === cur))
      .sort((a, b) => (st && likes(b, st)) - (st && likes(a, st)) || a.last_name.localeCompare(b.last_name))
      .map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${st && likes(s, st) ? '★ ' : ''}${esc(s.first_name)} ${esc(s.last_name)}${s.prefs?.track === 'evaluateur' && s.status ? ` (${esc(s.status)})` : ''}</option>`).join('')}`;
    box.innerHTML = `
      <div class="panel"><div class="row between" style="align-items:flex-start;gap:18px">
        <div>
          <div class="row"><label class="check" style="margin:0"><input type="checkbox" id="b-open" ${D.open ? 'checked' : ''}><span>Inscriptions des <strong>bénévoles</strong> ouvertes</span></label>
            <button class="small" id="b-copy">Copier le lien bénévoles</button></div>
          <div class="row" style="margin-top:8px"><label class="check" style="margin:0"><input type="checkbox" id="e-open" ${D.evaluators_open ? 'checked' : ''}><span>Inscriptions des <strong>évaluateurs</strong> ouvertes</span></label>
            <button class="small" id="e-copy">Copier le lien évaluateurs</button></div>
        </div>
        <div class="row"><label for="b-per" class="small" style="margin:0">Évaluateurs par salle</label>
          <select id="b-per" style="width:auto">${[1, 2, 3].map((n) => `<option ${n === D.per_room ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
        <p class="small muted" style="margin:10px 0 0">Deux liens, un même espace : les bénévoles (externes, PS, PSS, logistique) et les évaluateurs (médecins, internes, avec leurs disciplines préférées et la journée entière possible). Chacun reçoit un code personnel qui ouvre son espace (onglet Évaluateur de la page de connexion) : planning, calibration de sa station, et le jour J un bouton qui ouvre directement sa salle, sans code de porte. Dans les listes ci-dessous, ★ signale une discipline cochée par la personne.</p></div>

      <h2>Inscrits <span class="muted">(${D.signups.length}, dont ${D.signups.filter((s) => s.prefs?.track === 'evaluateur').length} par le lien évaluateurs)</span></h2>
      ${D.signups.length ? `<div class="table-wrap"><table><thead><tr><th>Personne</th><th>Rôles</th>${D.halfdays.map((h) => `<th class="num small">${esc(frDate(h.day))}<br>${HALF[h.half]}</th>`).join('')}<th>Calibration</th><th></th></tr></thead><tbody>
        ${D.signups.map((s) => `<tr data-s="${s.id}"><td><strong>${esc(s.last_name)}</strong> ${esc(s.first_name)}${s.prefs?.track === 'evaluateur' ? ' <span class="pill ink" style="font-size:.7rem">Évaluateur</span>' : ''}${s.prefs?.first_time ? ' <span class="pill" style="font-size:.7rem">1re fois</span>' : ''}
            <div class="small muted">${esc(s.status || '')}${s.specialty ? `, ${esc(s.specialty)}` : ''}${s.prefs?.disciplines?.length ? `<br>★ ${s.prefs.disciplines.map(esc).join(', ')}` : ''}${s.prefs?.track === 'evaluateur' && !s.prefs.attestation ? '<br>Sans attestation' : ''}</div>
            <div class="small muted">${esc(s.email)}${s.phone ? `, ${esc(s.phone)}` : ''}</div>${s.note ? `<div class="small">${esc(s.note)}</div>` : ''}</td>
          <td class="small">${s.roles.map((r) => esc(D.roles[r])).join('<br>')}</td>
          ${D.halfdays.map((h) => { const a = D.assignments.find((x) => x.signup_id === s.id && `${x.day}|${x.half}` === h.key);
            const st = a?.station_id && D.stations.find((x) => x.id === a.station_id);
            return `<td class="num small">${a ? `<strong>${st ? esc(st.slot) : 'Log.'}</strong>` : s.halfdays.includes(h.key) ? '<span class="muted">dispo</span>' : ''}</td>`; }).join('')}
          <td class="small">${s.calibration.length ? s.calibration.map((k) => `${pct(k.agreement)}`).join(', ') : '<span class="muted">–</span>'}</td>
          <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="small quiet" data-copy="${esc(s.code)}" title="Copier son lien personnel">Lien</button><button class="small quiet" data-del>Retirer</button></div></td></tr>`).join('')}
      </tbody></table></div><button class="small" id="b-csv" style="margin-top:8px">Exporter en CSV</button>` : `<p class="panel">Personne pour l'instant. Ouvre les inscriptions et partage le lien.</p>`}

      ${D.halfdays.length && D.stations.length ? `<h2>Planning des salles</h2>
      <div class="seg vol-hd" role="tablist">${D.halfdays.map((h) => { const c = coverage(h.key); return `<button type="button" role="tab" data-hd="${h.key}" aria-selected="${h.key === hd}" class="${h.key === hd ? 'on' : ''}">${esc(frDate(h.day))} ${HALF[h.half].toLowerCase()}
        <span class="pill ${c.got === c.need ? 'ok' : c.got ? 'warn' : ''}">${c.got}/${c.need}</span></button>`; }).join('')}</div>
      <div class="row between" style="margin:10px 0"><span class="small muted">${A.length} bénévole${A.length > 1 ? 's' : ''} disponible${A.length > 1 ? 's' : ''}, ${cov.got} poste${cov.got > 1 ? 's' : ''} pourvu${cov.got > 1 ? 's' : ''} sur ${cov.need}.</span>
        <div class="row"><button class="small" id="b-auto">Compléter automatiquement</button><button class="small quiet" id="b-clear">Vider</button><button class="small primary" id="b-save">Enregistrer</button></div></div>
      <div class="table-wrap"><table class="vol-matrix"><thead><tr><th>Salle</th><th>Évaluateurs</th><th>PS / PSS</th><th>Calibration</th></tr></thead><tbody>
        ${D.stations.map((st) => { const N = needs(st, D.per_room); const k = D.calibrations.find((x) => x.station_id === st.id);
          return `<tr><td><div class="row">${plate(st.slot)}<span class="small">${esc(st.title || '')}</span></div></td>
          <td>${N.filter((n) => n.role === 'evaluateur').map((n, i) => `<select data-slot="${st.id}|evaluateur|${i}" aria-label="${esc(st.slot)} ${n.label}">${opt('evaluateur', slotOf(hd, st.id, 'evaluateur', i), st)}</select>`).join('')}</td>
          <td>${N.filter((n) => n.role !== 'evaluateur').map((n) => `<select data-slot="${st.id}|${n.role}|0" aria-label="${esc(st.slot)} ${n.label}">${opt(n.role, slotOf(hd, st.id, n.role, 0))}</select>`).join('') || '<span class="small muted">Pas besoin</span>'}</td>
          <td><a class="small" href="#/calibration/${st.id}">${k ? 'Modifier' : 'Préparer'}</a></td></tr>`; }).join('')}
        <tr><td><strong>Accueil et logistique</strong></td><td colspan="3">${A.filter((s) => s.roles.includes('logistique') && (!U.has(s.id) || plan[hd].logistique.includes(s.id)))
          .map((s) => `<label class="check" style="display:inline-flex;margin:0 12px 0 0"><input type="checkbox" data-log="${s.id}" ${plan[hd].logistique.includes(s.id) ? 'checked' : ''}><span>${esc(s.first_name)} ${esc(s.last_name)}</span></label>`).join('') || '<span class="small muted">Personne de disponible pour ce rôle.</span>'}</td></tr>
      </tbody></table></div>
      ${A.filter((s) => !U.has(s.id)).length ? `<p class="small">Disponibles sans poste : ${A.filter((s) => !U.has(s.id)).map((s) => `${esc(s.first_name)} ${esc(s.last_name)} <span class="muted">(${s.roles.map((r) => r === 'evaluateur' ? 'éval.' : r === 'logistique' ? 'log.' : r.toUpperCase()).join(', ')})</span>`).join(', ')}</p>` : ''}` : ''}
      <p style="margin-top:20px"><a href="#/admin/benevoles">Suivi des bénévoles, toutes sessions confondues</a></p>`;
    bind();
  };
  const bind = () => {
    box.querySelector('#b-open').addEventListener('change', async (e) => { await api(`/exams/${exam.id}/benevoles/settings`, { method: 'PUT', body: { open: e.target.checked } }); D.open = e.target.checked; toast(D.open ? 'Inscriptions ouvertes' : 'Inscriptions fermées'); });
    box.querySelector('#b-per').addEventListener('change', async (e) => { await api(`/exams/${exam.id}/benevoles/settings`, { method: 'PUT', body: { per_room: Number(e.target.value) } }); D.per_room = Number(e.target.value); draw(); });
    box.querySelector('#b-copy').addEventListener('click', async () => { await navigator.clipboard?.writeText(link).catch(() => {}); toast(D.open ? 'Lien copié' : 'Lien copié. Pense à ouvrir les inscriptions.'); });
    box.querySelector('#e-open').addEventListener('change', async (e) => { await api(`/exams/${exam.id}/benevoles/settings`, { method: 'PUT', body: { evaluators_open: e.target.checked } }); D.evaluators_open = e.target.checked; toast(D.evaluators_open ? 'Inscriptions des évaluateurs ouvertes' : 'Inscriptions des évaluateurs fermées'); });
    box.querySelector('#e-copy').addEventListener('click', async () => { await navigator.clipboard?.writeText(linkEval).catch(() => {}); toast(D.evaluators_open ? 'Lien évaluateurs copié' : 'Lien copié. Pense à ouvrir les inscriptions des évaluateurs.'); });
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => { await navigator.clipboard?.writeText(`${location.origin}/#/?role=evaluateur&code=${b.dataset.copy}`).catch(() => {}); toast('Lien personnel copié'); }));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const s = sById[b.closest('tr').dataset.s];
      if (!window.confirm(`Retirer ${s.first_name} ${s.last_name} de cette session ? Ses affectations sont supprimées.`)) return;
      await api(`/signups/${s.id}`, { method: 'DELETE' }); benevolesTab(box, exam);
    }));
    box.querySelector('#b-csv')?.addEventListener('click', () => {
      const rows = [['Nom', 'Prénom', 'E-mail', 'Téléphone', 'Statut', 'Spécialité', 'Inscrit par', 'Disciplines préférées', 'Attestation', 'Rôles', 'Disponibilités', 'Affectations', 'Code']];
      for (const s of D.signups) rows.push([s.last_name, s.first_name, s.email, s.phone, s.status, s.specialty, s.prefs?.track === 'evaluateur' ? 'lien évaluateurs' : 'lien bénévoles', (s.prefs?.disciplines || []).join(', '), s.prefs?.track === 'evaluateur' ? (s.prefs.attestation ? 'oui' : 'non') : '', s.roles.map((r) => D.roles[r]).join(', '), s.halfdays.map(hdLabel).join(', '),
        D.assignments.filter((a) => a.signup_id === s.id).map((a) => `${hdLabel(`${a.day}|${a.half}`)} ${D.stations.find((x) => x.id === a.station_id)?.slot || 'logistique'}`).join(', '), s.code]);
      const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(';')).join('\n')}`], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `benevoles-${exam.id}.csv`; a.click();
    });
    box.querySelectorAll('[data-hd]').forEach((a) => a.addEventListener('click', () => { hd = a.dataset.hd; draw(); }));
    box.querySelectorAll('[data-slot]').forEach((sel) => sel.addEventListener('change', () => {
      const [st, role, i] = sel.dataset.slot.split('|'); setSlot(hd, Number(st), role, Number(i), Number(sel.value) || null); draw();
    }));
    box.querySelectorAll('[data-log]').forEach((cb) => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.log); const L = plan[hd].logistique;
      plan[hd].logistique = cb.checked ? [...L, id] : L.filter((x) => x !== id); draw();
    }));
    box.querySelector('#b-auto')?.addEventListener('click', () => { auto(hd); draw(); toast('Postes complétés. Vérifie, puis enregistre.'); });
    box.querySelector('#b-clear')?.addEventListener('click', () => { plan[hd] = { rooms: {}, logistique: [] }; draw(); });
    box.querySelector('#b-save')?.addEventListener('click', async () => {
      try {
        await save(hd);
        const [day, half] = hd.split('|');
        D.assignments = [...D.assignments.filter((a) => `${a.day}|${a.half}` !== hd), ...itemsOf(hd).map((x) => ({ ...x, day, half }))];
        toast('Planning enregistré'); draw();
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}

// ---------- suivi de l'engagement ----------
export async function engagementView(app) {
  const V = await api('/volunteers');
  setTitle('Bénévoles');
  let q = '';
  const draw = () => {
    const list = V.filter((v) => !q || `${v.name} ${v.email} ${v.specialty || ''}`.toLowerCase().includes(q));
    const fidele = V.filter((v) => v.sessions.length >= 2).length;
    app.innerHTML = `<a class="back" href="#/admin">Sessions</a><h1>Bénévoles</h1>
      <p class="lede">${V.length} personne${V.length > 1 ? 's' : ''} inscrite${V.length > 1 ? 's' : ''} au moins une fois, dont ${fidele} revenue${fidele > 1 ? 's' : ''} sur plusieurs sessions.</p>
      <input id="q" type="search" placeholder="Chercher un nom, une spécialité…" value="${esc(q)}" style="max-width:360px">
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Bénévole</th><th>Sessions</th><th class="num">Demi-journées</th><th class="num">Évaluateur</th><th class="num">PS</th><th class="num">PSS</th><th class="num">Logistique</th><th class="num">Grilles</th><th class="num">Calibrations</th></tr></thead><tbody>
      ${list.sort((a, b) => b.halfdays - a.halfdays || a.name.localeCompare(b.name)).map((v) => `<tr><td><strong>${esc(v.name)}</strong>${v.sessions.length >= 3 ? ' <span class="pill ok">Pilier</span>' : ''}
          <div class="small muted">${esc(v.status || '')}${v.specialty ? `, ${esc(v.specialty)}` : ''}, ${esc(v.email)}</div></td>
        <td class="small">${v.sessions.map((s) => esc(s.name)).join('<br>')}</td>
        <td class="num"><strong>${v.halfdays}</strong></td>${['evaluateur', 'ps', 'pss', 'logistique'].map((r) => `<td class="num">${v.by_role[r] || ''}</td>`).join('')}
        <td class="num">${v.grids || ''}</td><td class="num">${v.calibrations || ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    app.querySelector('#q').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const p = e.target.selectionStart; draw(); const i = app.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); });
  };
  draw();
}
