// Intervenants des journées procédure : le formulaire public (à la place du Google Form) et l'onglet des organisateurs,
// où l'on place chacun sur un atelier, créneau par créneau.
import { api, esc, toast, setTitle, downloadCsv, confirmBox, atelierPlate } from './ui.js';
import { atelierNo } from './jp-shared.js';
import { SPECIALTIES } from './shared.js';

const longDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const slotLabel = (s) => `${shortDay(s.day)} ${s.half}`;

// ---------- formulaire public ----------
export async function publicIntervenantForm(app, jpId) {
  let J;
  try { J = await api(`/public/jp/${jpId}/intervenants`); } catch { app.innerHTML = '<p class="alert error">Journée introuvable.</p>'; return; }
  setTitle(`Intervenants, ${J.name}`);
  if (!J.open) { app.innerHTML = `<div class="narrow"><h1>${esc(J.name)}</h1><p class="panel">Les inscriptions des intervenants ne sont pas ouvertes pour l'instant.</p></div>`; return; }
  const byDay = {}; for (const s of J.slots) (byDay[s.day] ||= []).push(s);
  app.innerHTML = `<div class="narrow" style="max-width:680px">
    <h1>Intervenir aux journées procédure</h1>
    <p class="lede">${esc(J.name)}</p>
    <div class="panel ev-why">
      <p>Chaque année, l'OMAS organise des journées procédure pour les externes : ils s'entraînent aux gestes des ECOS en petits groupes, atelier après atelier. On cherche des intervenants de toutes spécialités et de tous niveaux pour animer un atelier, sur la demi-journée de ton choix.</p>
      <div class="ev-steps">
        <div><b>Avant</b><span>Tu nous dis tes demi-journées et les gestes que tu aimerais montrer. On te confirme ton atelier par e-mail.</span></div>
        <div><b>Sur place</b><span>Des groupes de quelques étudiants tournent d'atelier en atelier : tu montres le geste, puis tu les fais pratiquer. La fiche de l'atelier et le matériel t'attendent.</span></div>
      </div>
    </div>
    <form id="if" class="panel">
      <div class="grid cols-2" style="gap:10px"><div><label for="i-ln" style="margin-top:0">Nom</label><input id="i-ln" name="last_name" required autocomplete="family-name"></div>
        <div><label for="i-fn" style="margin-top:0">Prénom</label><input id="i-fn" name="first_name" required autocomplete="given-name"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="i-em">E-mail</label><input id="i-em" name="email" type="email" required autocomplete="email"></div>
        <div><label for="i-ph">Téléphone <span class="hint">(facultatif)</span></label><input id="i-ph" name="phone" autocomplete="tel"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="i-sp">Ta spécialité</label><select id="i-sp" name="specialty" required><option value="">Choisir</option>${SPECIALTIES.map((x) => `<option>${esc(x)}</option>`).join('')}<option value="_autre">Autre</option></select>
          <input id="i-sp2" name="specialty_other" placeholder="Laquelle ?" aria-label="Autre spécialité" hidden style="margin-top:6px"></div>
        <div><label for="i-st">Tu es</label><select id="i-st" name="status" required><option value="">Choisir</option>${J.statuses.map((x) => `<option>${esc(x)}</option>`).join('')}<option value="_autre">Autre</option></select>
          <input id="i-st2" name="status_other" placeholder="Précise (FFI, assistant, PH…)" aria-label="Autre statut" hidden style="margin-top:6px"></div></div>
      <fieldset><legend>Tes demi-journées</legend>
        <div class="vol-days">${Object.keys(byDay).map((d) => `<div class="vol-day"><strong>${esc(longDay(d))}</strong>
          <div class="seg small">${byDay[d].map((s) => `<label class="pick"><input type="checkbox" name="slots" value="${s.id}"><span>${s.half === 'matin' ? 'Matin' : 'Après-midi'}</span></label>`).join('')}</div></div>`).join('')}</div></fieldset>
      <fieldset class="vol-roles"><legend>Les gestes que tu aimerais montrer</legend>
        <div class="ev-disc">${J.ateliers.map((a) => `<label class="pick"><input type="checkbox" name="ateliers" value="${esc(a.code)}"><span>${esc(a.emoji)} ${esc(a.title || a.code)}</span></label>`).join('')}
          <label class="pick"><input type="checkbox" name="ateliers" value="any"><span>Peu importe</span></label></div></fieldset>
      <label for="i-no">Des remarques ou des questions ? <span class="hint">(facultatif)</span></label><textarea id="i-no" name="note" rows="3" placeholder="Je ne peux venir qu'à partir de 10 h…"></textarea>
      <p class="small muted">Tes coordonnées servent uniquement à organiser les journées procédure d'OMAS Externat et à te recontacter pour les prochaines. <a href="#/confidentialite" target="_blank">En savoir plus</a>.</p>
      <div class="form-send"><button class="primary">Je propose d'intervenir</button></div>
    </form><div id="if-out"></div></div>`;
  const sp = app.querySelector('#i-sp'); const sp2 = app.querySelector('#i-sp2');
  sp.addEventListener('change', () => { sp2.hidden = sp.value !== '_autre'; sp2.required = !sp2.hidden; if (!sp2.hidden) sp2.focus(); });
  const st = app.querySelector('#i-st'); const st2 = app.querySelector('#i-st2');
  st.addEventListener('change', () => { st2.hidden = st.value !== '_autre'; st2.required = !st2.hidden; if (!st2.hidden) st2.focus(); });
  app.querySelector('#if').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd); body.slots = fd.getAll('slots').map(Number); body.ateliers = fd.getAll('ateliers');
    if (body.specialty === '_autre') body.specialty = (body.specialty_other || '').trim();
    if (body.status === '_autre') body.status = (body.status_other || '').trim();
    delete body.specialty_other; delete body.status_other;
    if (!body.slots.length) { toast('Coche au moins une demi-journée.', 'error'); return; }
    if (!body.ateliers.length) { toast('Coche au moins un geste, ou « Peu importe ».', 'error'); return; }
    try {
      const r = await api(`/public/jp/${jpId}/intervenants`, { method: 'POST', body });
      app.querySelector('#if').remove();
      app.querySelector('#if-out').innerHTML = `<div class="alert ok"><strong>Merci, c'est noté${r.updated ? ' (ta réponse est mise à jour)' : ''} !</strong>
        <p>Tu reçois un e-mail de confirmation. On te recontacte pour te dire sur quel atelier et à quelle heure tu interviens.</p></div>`;
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- onglet des organisateurs ----------
export async function intervenantsTab(box, jp) {
  const [R, slotsRaw, ats] = await Promise.all([api(`/jp/${jp.id}/intervenants`), api(`/jp/${jp.id}/slots`), api(`/jp/${jp.id}/ateliers`)]);
  if (R.missing_migration) { box.innerHTML = '<p class="alert warn">La table des intervenants n\'existe pas encore : il faut appliquer la migration 0015 dans la console D1 (voir État du système).</p>'; return; }
  const people = R.rows;
  const ateliers = ats.filter((a) => a.active);
  const slots = slotsRaw.map((s) => ({ ...s, half: String(s.start_time) < '12:00' ? 'matin' : 'après-midi', animators: (() => { try { return typeof s.animators === 'string' ? JSON.parse(s.animators || '{}') : (s.animators || {}); } catch { return {}; } })() }));
  const link = `${location.origin}/#/intervenant/${jp.id}`;
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const name = (p) => `${p.first_name} ${p.last_name}`;
  // affectations en cours d'édition : créneau → { code: id }
  const plan = Object.fromEntries(slots.map((s) => [s.id, { ...(s.animators._ids || {}) }]));
  const loadOf = (pid) => Object.values(plan).reduce((n, m) => n + Object.values(m).filter((x) => Number(x) === pid).length, 0);
  const wants = (p, code) => p.ateliers.includes(code);
  let open = slots[0]?.id || null;

  const auto = (sid) => {
    const m = plan[sid];
    const free = () => people.filter((p) => p.slots.includes(sid) && !Object.values(m).some((x) => Number(x) === p.id));
    for (const a of ateliers) {
      if (m[a.code]) continue;
      const c = free().sort((x, y) => (wants(y, a.code) - wants(x, a.code)) || (y.ateliers.includes('any') - x.ateliers.includes('any')) || loadOf(x.id) - loadOf(y.id))[0];
      if (c && (wants(c, a.code) || c.ateliers.includes('any'))) m[a.code] = c.id;
    }
    // ceux qui ne voulaient que d'autres gestes restent libres : on les propose seulement s'il reste des ateliers vides
    for (const a of ateliers) { if (!m[a.code]) { const c = free()[0]; if (c) m[a.code] = c.id; } }
  };
  const save = async (sid) => {
    const s = slots.find((x) => x.id === sid);
    const ids = Object.fromEntries(Object.entries(plan[sid]).filter(([, v]) => v));
    // les noms vont aussi dans les animateurs du créneau : planning imprimé et affiches les reprennent
    const names = Object.fromEntries(ateliers.map((a) => [a.code, ids[a.code] ? name(byId[ids[a.code]]) : (s.animators._ids?.[a.code] ? '' : s.animators[a.code] || '')]));
    s.animators = { ...names, _ids: ids };
    await api(`/slots/${sid}`, { method: 'PATCH', body: { animators: s.animators } });
  };

  const draw = () => {
    const s = slots.find((x) => x.id === open);
    const avail = s ? people.filter((p) => p.slots.includes(s.id)) : [];
    const used = s ? new Set(Object.values(plan[s.id]).map(Number)) : new Set();
    const filled = (sid) => ateliers.filter((a) => plan[sid][a.code]).length;
    box.innerHTML = `
      <div class="panel"><div class="row between"><div><strong>Lien de recrutement des intervenants</strong>
        <div class="small muted">À la place du Google Form : chacun indique ses demi-journées et les gestes qu'il aimerait montrer, et reçoit une confirmation par e-mail.</div></div>
        <label class="check" style="margin:0"><input type="checkbox" id="iv-open" ${jp.intervenants_open ? 'checked' : ''}><span>Inscriptions ouvertes</span></label></div>
        <div class="row" style="margin-top:10px"><input type="text" readonly value="${esc(link)}" style="max-width:420px" aria-label="Lien"><button class="small" id="iv-copy">Copier le lien</button><a class="btn small quiet" href="${esc(link)}" target="_blank">Voir le formulaire</a></div></div>

      <div class="facts"><div><div class="v">${people.length}</div><div class="l">intervenants inscrits</div></div>
        ${slots.map((x) => `<div><div class="v">${filled(x.id)}<span class="faint"> / ${ateliers.length}</span></div><div class="l">${esc(slotLabel(x))}</div></div>`).join('')}</div>

      ${slots.length && ateliers.length ? `<h2>Qui anime quel atelier</h2>
      <div class="seg vol-hd" role="tablist">${slots.map((x) => `<button type="button" data-slot="${x.id}" class="${x.id === open ? 'on' : ''}" aria-selected="${x.id === open}">${esc(slotLabel(x))}
        <span class="pill ${filled(x.id) === ateliers.length ? 'ok' : filled(x.id) ? 'warn' : ''}">${filled(x.id)}/${ateliers.length}</span></button>`).join('')}</div>
      <div class="row between" style="margin:10px 0"><span class="small muted">${avail.length} intervenant${avail.length > 1 ? 's' : ''} disponible${avail.length > 1 ? 's' : ''} sur ce créneau. ★ : a demandé ce geste.</span>
        <div class="row"><button class="small" id="iv-auto">Compléter automatiquement</button><button class="small quiet" id="iv-clear">Vider</button><button class="small primary" id="iv-save">Enregistrer</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Atelier</th><th>Intervenant</th></tr></thead><tbody>
        ${ateliers.map((a) => { const cur = Number(plan[s.id][a.code]) || null;
          const opts = avail.filter((p) => p.id === cur || !used.has(p.id)).sort((x, y) => wants(y, a.code) - wants(x, a.code) || name(x).localeCompare(name(y), 'fr'));
          const freeText = !cur && s.animators[a.code] ? s.animators[a.code] : '';
          return `<tr><td><div class="row" style="flex-wrap:nowrap">${atelierPlate(a.code, a.emoji)}<span>${esc(a.title || atelierNo(a.code))}</span></div></td>
          <td><select data-at="${esc(a.code)}" aria-label="Intervenant ${esc(a.title || a.code)}"><option value="">${freeText ? esc(`${freeText} (saisi à la main)`) : 'Personne'}</option>
            ${opts.map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${wants(p, a.code) ? '★ ' : ''}${esc(name(p))} (${esc(p.status || '')}${p.specialty ? `, ${esc(p.specialty)}` : ''})</option>`).join('')}</select></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="small" id="iv-notify">Prévenir les intervenants placés</button>
        <span class="small muted">Un e-mail à chacun : son ou ses ateliers, le jour et l'heure.</span></div>`
      : '<p class="alert info">Ajoute d\'abord les jours (Réglages) et les ateliers pour placer les intervenants.</p>'}

      <h2>Inscrits</h2>
      ${people.length ? `<div class="row" style="margin-bottom:8px"><span class="spacer"></span><button class="small" id="iv-csv">Exporter (CSV)</button></div>
      <div class="table-wrap"><table><thead><tr><th>Intervenant</th><th>Demi-journées</th><th>Gestes souhaités</th><th>Placé</th><th></th></tr></thead><tbody>
        ${people.map((p) => `<tr data-p="${p.id}"><td><strong>${esc(name(p))}</strong><div class="small muted">${esc(p.status || '')}${p.specialty ? `, ${esc(p.specialty)}` : ''}</div>
          <div class="small muted">${esc(p.email)}${p.phone ? `, ${esc(p.phone)}` : ''}</div>${p.note ? `<div class="small">${esc(p.note)}</div>` : ''}</td>
          <td class="small">${p.slots.map((id) => slots.find((x) => x.id === id)).filter(Boolean).map((x) => esc(slotLabel(x))).join('<br>')}</td>
          <td class="small">${p.ateliers.map((c) => (c === 'any' ? 'Peu importe' : esc(ateliers.find((a) => a.code === c)?.title || c))).join(', ')}</td>
          <td class="small">${slots.flatMap((x) => Object.entries(plan[x.id]).filter(([, v]) => Number(v) === p.id).map(([c]) => `${esc(slotLabel(x))} : ${esc(ateliers.find((a) => a.code === c)?.title || c)}`)).join('<br>') || '<span class="faint">non</span>'}</td>
          <td><button class="small quiet danger" data-del>Retirer</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="panel">Personne pour l\'instant. Ouvre les inscriptions et partage le lien.</p>'}`;
    bind();
  };

  const bind = () => {
    box.querySelector('#iv-open').addEventListener('change', async (e) => {
      try { await api(`/jp/${jp.id}`, { method: 'PATCH', body: { intervenants_open: e.target.checked ? 1 : 0 } }); jp.intervenants_open = e.target.checked ? 1 : 0; toast(e.target.checked ? 'Inscriptions des intervenants ouvertes' : 'Inscriptions des intervenants fermées'); }
      catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
    });
    box.querySelector('#iv-copy').addEventListener('click', async () => { await navigator.clipboard?.writeText(link).catch(() => {}); toast(jp.intervenants_open ? 'Lien copié' : 'Lien copié. Pense à ouvrir les inscriptions.'); });
    box.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => { open = Number(b.dataset.slot); draw(); }));
    box.querySelectorAll('[data-at]').forEach((sel) => sel.addEventListener('change', () => { plan[open][sel.dataset.at] = Number(sel.value) || null; draw(); }));
    box.querySelector('#iv-auto')?.addEventListener('click', () => { auto(open); draw(); toast('Ateliers complétés. Vérifie, puis enregistre.'); });
    box.querySelector('#iv-clear')?.addEventListener('click', () => { plan[open] = {}; draw(); });
    box.querySelector('#iv-save')?.addEventListener('click', async () => { try { await save(open); toast('Créneau enregistré'); draw(); } catch (err) { toast(err.message, 'error'); } });
    box.querySelector('#iv-notify')?.addEventListener('click', async () => {
      if (!confirmBox('Envoyer à chaque intervenant placé un e-mail avec son atelier, le jour et l\'heure ? Pense à enregistrer chaque créneau avant.')) return;
      try { const r = await api(`/jp/${jp.id}/intervenants/notify`, { method: 'POST' }); toast(r.ready ? `${r.sent} e-mail(s) envoyé(s) sur ${r.total}` : `E-mails non configurés : rien n'est parti (${r.total} prévu(s))`, r.ready && r.sent === r.total ? 'ok' : 'error'); } catch (err) { toast(err.message, 'error'); }
    });
    box.querySelector('#iv-csv')?.addEventListener('click', () => downloadCsv(`intervenants-${jp.id}.csv`, [['Nom', 'Prénom', 'E-mail', 'Téléphone', 'Statut', 'Spécialité', 'Demi-journées', 'Gestes souhaités', 'Remarque'],
      ...people.map((p) => [p.last_name, p.first_name, p.email, p.phone, p.status, p.specialty, p.slots.map((id) => slots.find((x) => x.id === id)).filter(Boolean).map(slotLabel).join(', '),
        p.ateliers.map((c) => (c === 'any' ? 'Peu importe' : ateliers.find((a) => a.code === c)?.title || c)).join(', '), p.note])]));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = byId[b.closest('tr').dataset.p];
      if (!confirmBox(`Retirer ${name(p)} des intervenants ? Ses affectations restent jusqu'à ce que tu les changes.`)) return;
      try { await api(`/intervenants/${p.id}`, { method: 'DELETE' }); intervenantsTab(box, jp); } catch (err) { toast(err.message, 'error'); }
    }));
  };
  draw();
}
