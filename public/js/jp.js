import { api, esc, nl, toast, fmt, frDate, setTitle, downloadCsv, parseTable, confirmBox, plate, atelierPlate, disc } from './ui.js';
import { DISCIPLINES } from './shared.js';
import { JP_STATUSES, ATELIER_EMOJIS, atelierNo } from './jp-shared.js';
import { state } from './app.js';

const link = (code) => `${location.origin}/#/?role=etudiant&code=${code}`;
const dates = (j) => (j.starts_on ? `${frDate(j.starts_on)}${j.ends_on && j.ends_on !== j.starts_on ? ` et ${frDate(j.ends_on)}` : ''}` : 'Dates à fixer');
const hm = (t) => String(t || '').replace(':', ' h ');
const minutesLabel = (n, m, t) => { const tot = n * m + Math.max(0, n - 1) * t; return `${Math.floor(tot / 60)} h ${String(tot % 60).padStart(2, '0')}`; };
const JP_FLOW = ['redaction', 'relecture', 'validee'];
const jpRail = (st) => `<span class="rail mini" aria-hidden="true">${JP_FLOW.map((k, i) => `<i class="${st === 'validee' || i < JP_FLOW.indexOf(st) ? 'done' : k === st ? 'now' : ''}"></i>`).join('')}</span>`;

// ---------- section de la page Sessions ----------

export async function jpSection(box) {
  const list = await api('/jp');
  box.innerHTML = `
    <h1 style="margin-top:44px">Journées procédure</h1>
    <p class="lede">Des ateliers de gestes en petits groupes, avec une rotation calculée pour chaque créneau.</p>
    ${list.length ? `<div class="table-wrap" style="margin-top:20px"><table>
      <thead><tr><th>Journée</th><th>Dates</th><th class="num">Ateliers</th><th class="num">Inscrits</th><th></th></tr></thead>
      <tbody>${list.map((j) => `<tr class="clickable" data-jp="${j.id}"><td><strong>${esc(j.name)}</strong></td><td>${dates(j)}</td>
        <td class="num">${j.n_ateliers}</td><td class="num">${j.n_participants}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="small" data-edit>Modifier</button><button class="small danger" data-del>Supprimer</button></div></td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="panel"><h2>Créer une journée procédure</h2>
      <form id="newjp"><div class="grid cols-2">
        <div><label for="jn">Nom</label><input id="jn" name="name" required placeholder="Journée procédure 1, décembre 2026"></div>
        <div class="grid cols-2" style="gap:10px"><div><label for="j1">Premier jour</label><input id="j1" type="date" name="starts_on"></div>
          <div><label for="j2">Dernier jour</label><input id="j2" type="date" name="ends_on"></div></div></div>
        <label class="check" style="margin-top:16px"><input type="checkbox" name="prefill" checked>
          <span>Préremplir les 7 ateliers de la JP1 (suture, palpation mammaire, toucher rectal, otoscopie, gants stériles et injection IM, palpation testiculaire, arrêt cardio-respiratoire)</span></label>
        <p class="small muted">Deux créneaux par jour sont créés, à 9 h et à 14 h. Tu pourras les changer.</p>
        <button class="primary">Créer la journée</button></form></div>`;
  box.querySelectorAll('[data-jp]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button, input, form')) return;
    location.hash = `#/admin/jp/${tr.dataset.jp}`;
  }));
  (await import('./admin.js')).rowActions(box, list, {
    save: (id, body) => api(`/jp/${id}`, { method: 'PATCH', body }),
    remove: async (j) => {
      if (!confirmBox(`Supprimer « ${j.name} », ses ateliers, ses créneaux et ses ${j.n_participants} inscrits ?`)) return false;
      await api(`/jp/${j.id}`, { method: 'DELETE' });
      return true;
    },
    reload: () => jpSection(box),
  });
  box.querySelector('#newjp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('/jp', { method: 'POST', body: { name: f.get('name'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on'), prefill: !!f.get('prefill') } });
    location.hash = `#/admin/jp/${r.id}`;
  });
}

// ---------- une journée ----------

const TABS = [['ateliers', 'Ateliers'], ['inscrits', 'Créneaux et inscrits'], ['planning', 'Groupes et rotations'], ['materiel', 'Matériel'], ['reglages', 'Réglages']];

export async function jpView(app, id, tab) {
  const jp = await api(`/jp/${id}`);
  if (tab === 'imprimer') return printPlanning(app, jp);
  if (tab === 'affiches') return printPosters(app, jp);
  setTitle(jp.name);
  app.innerHTML = `
    <a class="back" href="#/admin">Toutes les sessions</a>
    <div class="row between" style="align-items:flex-end"><div><h1>${esc(jp.name)}</h1><p class="muted" style="margin:6px 0 0">${dates(jp)}</p></div>
      <div class="row">${jp.keypoints_published ? '<span class="pill ink">Points clés publiés</span>' : ''}</div></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/jp/${id}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  const box = app.querySelector('#tab');
  ({ ateliers: ateliersTab, inscrits: inscritsTab, planning: planningTab, materiel: materielTab, reglages: reglagesTab }[tab] || ateliersTab)(box, jp);
}

async function ateliersTab(box, jp) {
  const [ats, people] = await Promise.all([api(`/jp/${jp.id}/ateliers`), api('/people')]);
  const active = people.filter((p) => p.active);
  const sel = (f, v, l) => `<select data-f="${f}" aria-label="${l}"><option value="">Personne</option>${active.map((p) => `<option value="${p.id}" ${p.id === v ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  const n = ats.filter((a) => a.active).length;
  box.innerHTML = `
    <div class="facts">
      <div><div class="v">${ats.filter((a) => a.active && a.status === 'validee').length}<span class="faint"> / ${n}</span></div><div class="l">fiches validées</div></div>
      <div><div class="v">${minutesLabel(n, jp.atelier_minutes, jp.transition_minutes)}</div><div class="l">par créneau : ${n} ateliers de ${jp.atelier_minutes} min, ${jp.transition_minutes} min pour changer</div></div>
    </div>
    <div class="row" style="margin:0 0 12px"><span class="spacer"></span><button id="add" class="small">Ajouter un atelier</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Atelier</th><th>Pictogramme</th><th>Fiche</th><th>Référent</th><th>Relecture</th><th>Étape</th><th></th></tr></thead>
      <tbody>${ats.map((a) => `<tr data-id="${a.id}" ${a.active ? '' : 'style="opacity:.5"'}>
        <td><div class="row" style="flex-wrap:nowrap">${atelierPlate(a.code, a.emoji, 'lg')}<label class="check small" style="margin:0;font-weight:400"><input type="checkbox" data-f="active" ${a.active ? 'checked' : ''}> actif</label></div></td>
        <td><input type="text" data-f="emoji" value="${esc(a.emoji || '')}" maxlength="8" style="width:64px;font-size:1.3rem;text-align:center" aria-label="Pictogramme de l'atelier ${esc(atelierNo(a.code))}"></td>
        <td style="min-width:220px"><strong>${esc(a.title || 'Sans titre')}</strong>${a.discipline ? `<div class="small muted">${disc(a.discipline)}</div>` : ''}</td>
        <td>${sel('author_id', a.author_id, 'Référent')}</td><td>${sel('reviewer_id', a.reviewer_id, 'Relecteur')}</td>
        <td style="min-width:140px"><select data-f="status" aria-label="Étape">${Object.entries(JP_STATUSES).map(([k, l]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${l}</option>`).join('')}</select>${jpRail(a.status)}</td>
        <td><a class="btn small" href="#/atelier/${a.id}">Ouvrir</a></td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:12px"><a class="btn" href="#/admin/jp/${jp.id}/affiches" target="_blank">Imprimer les affiches des ateliers</a></div>
    <p class="small muted">Le pictogramme s'affiche partout à la place du code, avec le numéro de l'atelier. Le référent est l'un des animateurs de l'atelier : il prépare la fiche avec les autres, puis l'envoie en relecture. Un atelier inactif sort de la rotation.</p>`;
  box.querySelectorAll('tr[data-id] [data-f]').forEach((i) => i.addEventListener('change', async () => {
    const f = i.dataset.f;
    const v = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value;
    try { await api(`/ateliers/${i.closest('tr').dataset.id}`, { method: 'PATCH', body: { [f]: f.endsWith('_id') ? (v ? Number(v) : null) : v } }); toast('Modification enregistrée'); if (!['author_id', 'reviewer_id'].includes(f)) ateliersTab(box, jp); } catch (err) { toast(err.message, 'error'); }
  }));
  box.querySelector('#add').addEventListener('click', async () => {
    const title = prompt('Titre du nouvel atelier :'); if (!title) return;
    await api(`/jp/${jp.id}/ateliers`, { method: 'POST', body: { title } }); ateliersTab(box, jp);
  });
}

const FIELDS = [['last_name', 'Nom'], ['first_name', 'Prénom'], ['email', 'E-mail'], ['phone', 'Téléphone'], ['faculty', 'Faculté'], ['year', 'Année'], ['slot_label', 'Créneau de la billetterie']];
const GUESS = { last_name: /^nom( |$)|nom participant|last ?name/i, first_name: /pr[ée]nom/i, email: /e-?mail|courriel/i, phone: /t[ée]l[ée]phone|portable|phone/i, faculty: /facult|universit/i, year: /ann[ée]e|niveau|promo/i, slot_label: /tarif|cr[ée]neau|formule|billet/i };
const slotName = (s) => `${frDate(s.day)}, ${hm(s.start_time)}`;

async function inscritsTab(box, jp) {
  const [slots, parts] = await Promise.all([api(`/jp/${jp.id}/slots`), api(`/jp/${jp.id}/participants`)]);
  const active = parts.filter((p) => p.status !== 'annule');
  const labels = {};
  parts.forEach((p) => { if (p.slot_label) { labels[p.slot_label] ??= { n: 0, slot: p.slot_id }; labels[p.slot_label].n++; } });
  const slotOpts = (v) => `<option value="">Sans créneau</option>${slots.map((s) => `<option value="${s.id}" ${s.id === v ? 'selected' : ''}>${slotName(s)}</option>`).join('')}`;
  box.innerHTML = `
    <div class="facts">
      <div><div class="v">${active.length}</div><div class="l">inscrits</div></div>
      ${slots.map((s) => `<div><div class="v">${s.n}</div><div class="l">${slotName(s)}</div></div>`).join('')}
      <div><div class="v">${active.filter((p) => !p.slot_id).length}</div><div class="l">sans créneau</div></div>
    </div>
    <div class="panel"><h2>Créneaux</h2>
      <p class="small muted">Chaque créneau dure le temps de faire passer chaque groupe par tous les ateliers. La convocation est fixée 15 minutes avant le début.</p>
      <div class="table-wrap"><table><thead><tr><th>Jour</th><th>Début</th><th class="num">Inscrits</th><th></th></tr></thead><tbody>
      ${slots.map((s) => `<tr data-slot="${s.id}"><td><input type="date" data-sf="day" value="${esc(s.day)}" aria-label="Jour"></td>
        <td><input type="text" data-sf="start_time" value="${esc(s.start_time)}" style="max-width:100px" aria-label="Heure de début"></td>
        <td class="num">${s.n}</td><td><button class="small quiet" data-delslot>Supprimer</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><input type="date" id="nday" style="max-width:180px" aria-label="Jour du nouveau créneau" value="${esc(jp.starts_on || '')}">
        <input type="text" id="ntime" placeholder="09:00" style="max-width:100px" aria-label="Heure du nouveau créneau"><button class="small" id="addslot">Ajouter un créneau</button></div>
      ${slots.length > 1 ? `<h3>Rééquilibrer</h3><div class="row"><span>Déplacer</span><input type="number" id="mvn" min="1" value="5" style="max-width:80px" aria-label="Nombre">
        <span>inscrits de</span><select id="mvfrom" style="max-width:220px">${slots.map((s) => `<option value="${s.id}">${slotName(s)} (${s.n})</option>`).join('')}</select>
        <span>vers</span><select id="mvto" style="max-width:220px">${slots.map((s, i) => `<option value="${s.id}" ${i === 1 ? 'selected' : ''}>${slotName(s)} (${s.n})</option>`).join('')}</select>
        <button class="small" id="mv">Déplacer</button></div>
        <p class="small muted">Ce sont les derniers inscrits du créneau qui sont déplacés. Pense à les prévenir dans leur convocation.</p>` : ''}
    </div>
    <details class="panel" ${parts.length ? '' : 'open'}><summary style="cursor:pointer"><strong>Importer les inscrits</strong> <span class="muted">depuis la billetterie (CSV) ou un copier-coller</span></summary>
      <label for="jfile">Fichier CSV</label><input type="file" id="jfile" accept=".csv,.txt,.tsv">
      <label for="jpaste">Ou colle les lignes, en-têtes compris</label><textarea id="jpaste"></textarea><div id="jmap"></div></details>
    ${Object.keys(labels).length ? `<div class="panel"><h2>Créneaux de la billetterie</h2>
      <div class="table-wrap"><table><thead><tr><th>Libellé</th><th class="num">Inscrits</th><th>Créneau</th></tr></thead><tbody>
      ${Object.entries(labels).map(([l, v]) => `<tr data-label="${esc(l)}"><td>${esc(l)}</td><td class="num">${v.n}</td><td><select data-maplabel aria-label="Créneau">${slotOpts(v.slot)}</select></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="row" style="margin:18px 0 12px"><button id="jexp">Exporter codes et liens</button><span class="spacer"></span>
      <input id="jq" type="text" placeholder="Chercher un nom" style="max-width:240px" aria-label="Chercher"></div>
    <div class="table-wrap"><table><thead><tr><th>Inscrit</th><th>Créneau</th><th class="num">Groupe</th><th>Code</th><th>Statut</th><th></th></tr></thead><tbody id="jrows"></tbody></table></div>`;

  const drawRows = (q = '') => {
    box.querySelector('#jrows').innerHTML = parts.filter((p) => !q || `${p.last_name} ${p.first_name} ${p.email}`.toLowerCase().includes(q.toLowerCase())).map((p) => `<tr data-id="${p.id}" ${p.status === 'annule' ? 'style="opacity:.5"' : ''}>
      <td><strong>${esc(p.last_name)}</strong> ${esc(p.first_name)}<div class="small muted">${esc(p.email || '')}</div></td>
      <td><select data-pslot aria-label="Créneau">${slotOpts(p.slot_id)}</select><div class="small faint">${esc(p.slot_label || '')}</div></td>
      <td class="num">${p.group_no ? `<strong>${p.group_no}</strong>` : '<span class="faint">à former</span>'}</td>
      <td><span class="code">${esc(p.code)}</span></td>
      <td><select data-pstatus aria-label="Statut"><option value="inscrit" ${p.status === 'inscrit' ? 'selected' : ''}>Inscrit</option><option value="annule" ${p.status === 'annule' ? 'selected' : ''}>Annulé</option></select></td>
      <td><button class="small" data-copy>Copier le lien</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun inscrit.</td></tr>';
    box.querySelectorAll('[data-pslot]').forEach((s) => s.addEventListener('change', async () => { await api(`/participants/${s.closest('tr').dataset.id}`, { method: 'PATCH', body: { slot_id: s.value ? Number(s.value) : null } }); toast('Créneau modifié. Pense à reformer les groupes.'); }));
    box.querySelectorAll('[data-pstatus]').forEach((s) => s.addEventListener('change', async () => { await api(`/participants/${s.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: s.value } }); toast('Statut modifié'); }));
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => { const p = parts.find((x) => String(x.id) === b.closest('tr').dataset.id); await navigator.clipboard?.writeText(link(p.code)); toast('Lien copié'); }));
  };
  drawRows();
  box.querySelector('#jq').addEventListener('input', (e) => drawRows(e.target.value));
  const reload = () => inscritsTab(box, jp);
  box.querySelectorAll('[data-sf]').forEach((i) => i.addEventListener('change', async () => { await api(`/slots/${i.closest('tr').dataset.slot}`, { method: 'PATCH', body: { [i.dataset.sf]: i.value } }); toast('Créneau modifié'); }));
  box.querySelectorAll('[data-delslot]').forEach((b) => b.addEventListener('click', async () => { if (!confirmBox('Supprimer ce créneau ? Ses inscrits devront être replacés.')) return; await api(`/slots/${b.closest('tr').dataset.slot}`, { method: 'DELETE' }); reload(); }));
  box.querySelector('#addslot').addEventListener('click', async () => { try { await api(`/jp/${jp.id}/slots`, { method: 'POST', body: { day: box.querySelector('#nday').value, start_time: box.querySelector('#ntime').value } }); reload(); } catch (err) { toast(err.message, 'error'); } });
  box.querySelector('#mv')?.addEventListener('click', async () => {
    const r = await api(`/jp/${jp.id}/participants/move`, { method: 'POST', body: { from: Number(box.querySelector('#mvfrom').value), to: Number(box.querySelector('#mvto').value), count: Number(box.querySelector('#mvn').value) } });
    toast(`${r.moved} inscrits déplacés`); reload();
  });
  box.querySelectorAll('[data-maplabel]').forEach((s) => s.addEventListener('change', async () => {
    await api(`/jp/${jp.id}/participants/map-slot`, { method: 'POST', body: { slot_label: s.closest('tr').dataset.label, slot_id: s.value ? Number(s.value) : null } });
    toast('Créneau appliqué'); reload();
  }));
  box.querySelector('#jexp').addEventListener('click', () => downloadCsv(`journee-${jp.id}-codes.csv`, [['Nom', 'Prénom', 'E-mail', 'Téléphone', 'Créneau', 'Groupe', 'Code', 'Lien personnel'],
    ...active.map((p) => { const s = slots.find((x) => x.id === p.slot_id); return [p.last_name, p.first_name, p.email, p.phone, s ? slotName(s) : '', p.group_no, p.code, link(p.code)]; })]));
  const onText = (text) => {
    const rows = parseTable(text);
    if (rows.length < 2) { box.querySelector('#jmap').innerHTML = '<p class="alert warn">Aucune ligne lue : vérifie que la première ligne contient les en-têtes.</p>'; return; }
    const head = rows[0];
    box.querySelector('#jmap').innerHTML = `<p class="alert info">${rows.length - 1} ligne(s) lues. Vérifie la correspondance des colonnes.</p>
      <div class="grid cols-4" style="gap:10px">${FIELDS.map(([f, l]) => `<div><label for="jm-${f}">${l}</label><select id="jm-${f}" data-map="${f}"><option value="-1">Aucune colonne</option>
        ${head.map((h, i) => `<option value="${i}" ${i === head.findIndex((x) => GUESS[f].test(x.trim())) ? 'selected' : ''}>${esc(h || `Colonne ${i + 1}`)}</option>`).join('')}</select></div>`).join('')}</div>
      <button class="primary" id="jdo" style="margin-top:12px">Importer ${rows.length - 1} inscrits</button>`;
    box.querySelector('#jdo').addEventListener('click', async () => {
      const map = {}; box.querySelectorAll('[data-map]').forEach((s) => { map[s.dataset.map] = Number(s.value); });
      if (map.last_name < 0) { toast('Choisis au moins la colonne du nom', 'error'); return; }
      const out = rows.slice(1).map((r) => Object.fromEntries(FIELDS.map(([f]) => [f, map[f] >= 0 ? (r[map[f]] || '').trim() : ''])));
      const res = await api(`/jp/${jp.id}/participants`, { method: 'POST', body: { rows: out } });
      toast(`${res.imported} inscrits importés`); reload();
    });
  };
  box.querySelector('#jfile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) onText(await f.text()); });
  box.querySelector('#jpaste').addEventListener('input', (e) => { if (e.target.value.trim()) onText(e.target.value); });
}

function rotationTable(P, s) {
  return `<div class="table-wrap"><table class="rot"><thead><tr><th>Horaire</th>${s.groups.map((g) => `<th class="num">Groupe ${g.group}</th>`).join('')}</tr></thead><tbody>
    ${s.turns.map((t) => `<tr><td class="num"><strong>${hm(t.start)}</strong><span class="faint"> à ${hm(t.end)}</span></td>
      ${t.by_group.map((ai) => `<td class="num">${atelierPlate(P.ateliers[ai]?.code || '?', P.ateliers[ai]?.emoji)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

async function planningTab(box, jp) {
  const P = await api(`/jp/${jp.id}/plan`);
  const missing = P.slots.reduce((a, s) => a + s.unassigned, 0);
  box.innerHTML = `
    <div class="row" style="margin-bottom:12px">
      <button class="${missing ? 'primary' : ''}" id="form">${missing ? `Former les groupes (${missing} inscrits sans groupe)` : 'Reformer les groupes'}</button>
      <a class="btn" href="#/admin/jp/${jp.id}/imprimer" target="_blank">Imprimer les plannings</a>
      <span class="small muted">${P.ateliers.length} groupes par créneau, répartis par ordre alphabétique et à effectifs égaux.</span></div>
    <div class="panel" style="padding:14px 18px"><div class="tags">${P.ateliers.map((a) => `<span class="row" style="gap:10px;flex-wrap:nowrap">${atelierPlate(a.code, a.emoji, 'sm')}${esc(a.title || '')}</span>`).join('')}</div></div>
    ${P.slots.map((s) => `<section class="panel">
      <div class="row between"><h2 style="margin:0">${frDate(s.day)}, ${hm(s.start_time)} à ${hm(s.end)}</h2>
        <span class="muted">Convocation à ${hm(s.convocation)}, ${s.groups.reduce((a, g) => a + g.members.length, 0)} inscrits</span></div>
      ${s.unassigned ? `<p class="alert warn">${s.unassigned} inscrits de ce créneau n'ont pas encore de groupe.</p>` : ''}
      <h3>Rotation</h3>${rotationTable(P, s)}
      <h3>Animateurs</h3>
      <div class="grid cols-4" style="gap:8px">${P.ateliers.map((a) => `<div><label class="row" style="gap:10px;margin:6px 0;flex-wrap:nowrap">${atelierPlate(a.code, a.emoji, 'sm')}${esc(a.title || '')}</label>
        <input type="text" data-anim="${esc(a.code)}" data-slot="${s.id}" value="${esc(s.animators[a.code] || '')}" placeholder="Nom de l'animateur" aria-label="Animateur ${esc(a.code)}"></div>`).join('')}</div>
      <details style="margin-top:14px"><summary style="cursor:pointer"><strong>Composition des groupes</strong></summary>
        <div class="grid cols-4" style="margin-top:10px">${s.groups.map((g) => `<div><strong>Groupe ${g.group}</strong> <span class="faint">(${g.members.length})</span>
          <ul class="small" style="margin:4px 0 0;padding-left:18px">${g.members.map((m) => `<li>${esc(m)}</li>`).join('') || '<li class="faint">vide</li>'}</ul></div>`).join('')}</div></details>
    </section>`).join('') || '<p class="alert info">Aucun créneau. Ajoute-les dans l\'onglet Créneaux et inscrits.</p>'}`;
  box.querySelector('#form').addEventListener('click', async () => {
    try { await api(`/jp/${jp.id}/groups`, { method: 'POST' }); toast('Groupes formés'); planningTab(box, jp); } catch (err) { toast(err.message, 'error'); }
  });
  box.querySelectorAll('[data-anim]').forEach((i) => i.addEventListener('change', async () => {
    const s = P.slots.find((x) => String(x.id) === i.dataset.slot);
    s.animators[i.dataset.anim] = i.value.trim();
    await api(`/slots/${s.id}`, { method: 'PATCH', body: { animators: s.animators } });
    toast('Animateur enregistré');
  }));
}

async function printPlanning(app, jp) {
  const P = await api(`/jp/${jp.id}/plan`);
  setTitle(`Plannings, ${jp.name}`);
  app.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><button class="primary" onclick="window.print()">Imprimer</button>
    <span class="small muted">Une page par créneau : la rotation, les animateurs et les groupes.</span></div>
    ${P.slots.map((s) => `<div class="sheet landscape">
      <div class="print-head"><span>${esc(jp.name)}</span><span>${frDate(s.day)}, ${hm(s.start_time)} à ${hm(s.end)}, convocation ${hm(s.convocation)}</span></div>
      <table class="paper-grid" style="width:100%"><thead><tr><th>Horaire</th>${s.groups.map((g) => `<th>Groupe ${g.group}</th>`).join('')}</tr></thead><tbody>
      ${s.turns.map((t) => `<tr><td><strong>${hm(t.start)}</strong> à ${hm(t.end)}</td>${t.by_group.map((ai) => `<td>${esc(P.ateliers[ai]?.emoji || '')} <strong>${esc(atelierNo(P.ateliers[ai]?.code))}</strong> ${esc(P.ateliers[ai]?.title || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <h2>Animateurs</h2><p>${P.ateliers.map((a) => `<strong>${esc(a.emoji || '')} ${esc(atelierNo(a.code))}.</strong> ${esc(a.title || '')} : ${esc(s.animators[a.code] || '…………')}`).join('<br>')}</p>
      <h2>Groupes</h2><table class="paper-grid" style="width:100%"><tr>${s.groups.map((g) => `<td style="vertical-align:top"><strong>Groupe ${g.group}</strong><br>${g.members.map(esc).join('<br>')}</td>`).join('')}</tr></table>
    </div>`).join('')}`;
}

async function printPosters(app, jp) {
  const ats = (await api(`/jp/${jp.id}/ateliers`)).filter((a) => a.active);
  setTitle(`Affiches, ${jp.name}`);
  app.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><button class="primary" onclick="window.print()">Imprimer les ${ats.length} affiches</button>
    <span class="small muted">Une affiche A4 paysage par atelier, à coller sur la porte ou sur la table.</span></div>
    ${ats.map((a) => `<div class="sheet landscape poster">
      ${a.emoji ? `<div class="big-emo">${esc(a.emoji)}</div>` : ''}
      <div class="big-no">Atelier ${esc(atelierNo(a.code))}</div>
      <div class="big-title">${esc(a.title || '')}</div>
      <div class="big-sub">${esc(jp.name)}</div></div>`).join('')}`;
}

async function materielTab(box, jp) {
  const P = await api(`/jp/${jp.id}/plan`);
  const totals = {};
  P.material.forEach((a) => {
    a.fixe.forEach((m) => { const k = m.article.toLowerCase(); totals[k] ??= { article: m.article, fixe: 0, conso: 0 }; totals[k].fixe += m.qte; });
    a.conso.forEach((m) => { const k = m.article.toLowerCase(); totals[k] ??= { article: m.article, fixe: 0, conso: 0 }; totals[k].conso += m.qte; });
  });
  box.innerHTML = `
    <p class="lede">Calculé à partir des fiches et des ${P.participants} inscrits placés dans un créneau, avec 20 % de marge sur les consommables.</p>
    <div class="row no-print" style="margin:12px 0"><button onclick="window.print()">Imprimer</button>
      <button id="mexp">Exporter en CSV</button></div>
    <h2>Liste de courses</h2>
    <div class="table-wrap"><table><thead><tr><th>Article</th><th class="num">À installer</th><th class="num">Consommables</th></tr></thead><tbody>
    ${Object.values(totals).sort((a, b) => a.article.localeCompare(b.article, 'fr')).map((t) => `<tr><td>${esc(t.article)}</td><td class="num">${t.fixe || ''}</td><td class="num">${t.conso || ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Les fiches ne listent pas encore de matériel.</td></tr>'}</tbody></table></div>
    <h2>Par atelier</h2>
    ${P.material.map((a) => `<div class="panel" style="padding:14px 18px"><div class="row">${atelierPlate(a.code, a.emoji)}<strong>${esc(a.title || '')}</strong><span class="muted small">${a.postes} poste(s)</span></div>
      <div class="grid cols-2" style="margin-top:8px"><div><h3 style="margin-top:4px">À installer</h3><ul class="small">${a.fixe.map((m) => `<li>${m.qte} × ${esc(m.article)}</li>`).join('') || '<li class="faint">rien</li>'}</ul></div>
      <div><h3 style="margin-top:4px">Consommables</h3><ul class="small">${a.conso.map((m) => `<li>${m.qte} × ${esc(m.article)} <span class="faint">(${fmt(m.par_etudiant, 0)} par étudiant)</span></li>`).join('') || '<li class="faint">aucun</li>'}</ul></div></div></div>`).join('')}`;
  box.querySelector('#mexp').addEventListener('click', () => downloadCsv(`materiel-${jp.id}.csv`, [['Article', 'À installer', 'Consommables'], ...Object.values(totals).map((t) => [t.article, t.fixe, t.conso])]));
}

async function reglagesTab(box, jp) {
  const flag = (k, t, d) => `<label class="panel check" style="margin:10px 0"><input type="checkbox" data-k="${k}" ${jp[k] ? 'checked' : ''} style="margin-top:3px">
    <span><strong>${t}</strong><br><span class="small muted">${d}</span></span></label>`;
  box.innerHTML = `
    ${flag('show_planning', 'Les inscrits voient leur groupe et leur parcours', 'Avec leur code, ils voient leur créneau, leur groupe et l\'ordre de passage dans les ateliers.')}
    ${flag('keypoints_published', 'Points clés publiés', 'Les fiches points clés et les mini-grilles deviennent visibles. À cocher le soir de la journée.')}
    <form id="f" class="panel"><h2>Informations et durées</h2>
      <div class="grid cols-2"><div><label for="nm">Nom</label><input id="nm" name="name" value="${esc(jp.name)}"></div>
        <div class="grid cols-2" style="gap:10px"><div><label for="s1">Premier jour</label><input id="s1" type="date" name="starts_on" value="${esc(jp.starts_on || '')}"></div>
          <div><label for="s2">Dernier jour</label><input id="s2" type="date" name="ends_on" value="${esc(jp.ends_on || '')}"></div></div>
        <div><label for="am">Durée d'un atelier (minutes)</label><input id="am" type="number" min="5" name="atelier_minutes" value="${jp.atelier_minutes}"></div>
        <div><label for="tm">Temps pour changer d'atelier (minutes)</label><input id="tm" type="number" min="0" name="transition_minutes" value="${jp.transition_minutes}"></div></div>
      <button class="primary" style="margin-top:14px">Enregistrer</button></form>
    <div class="panel"><h2>Supprimer la journée</h2><p class="small muted">Les ateliers, créneaux et inscrits sont supprimés avec elle.</p><button class="danger" id="del">Supprimer la journée</button></div>`;
  box.querySelectorAll('[data-k]').forEach((cb) => cb.addEventListener('change', async () => { await api(`/jp/${jp.id}`, { method: 'PATCH', body: { [cb.dataset.k]: cb.checked ? 1 : 0 } }); jp[cb.dataset.k] = cb.checked ? 1 : 0; toast(cb.checked ? 'Activé' : 'Désactivé'); }));
  box.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    await api(`/jp/${jp.id}`, { method: 'PATCH', body: { name: f.get('name'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on'), atelier_minutes: Number(f.get('atelier_minutes')), transition_minutes: Number(f.get('transition_minutes')) } });
    toast('Enregistré');
  });
  box.querySelector('#del').addEventListener('click', async () => { if (!confirmBox('Supprimer définitivement cette journée ?')) return; await api(`/jp/${jp.id}`, { method: 'DELETE' }); location.hash = '#/admin'; });
}

// ---------- éditeur de fiche atelier ----------

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };

export async function atelierEditor(app, id) {
  const data = await api(`/ateliers/${id}`);
  const { atelier: a, rights, jp } = data;
  const content = data.content;
  let checks = data.checks;
  const meta = { title: a.title || '', discipline: a.discipline || '' };
  let otherDisc = !!meta.discipline && !DISCIPLINES.some(([n]) => n === meta.discipline);
  const ro = !rights.editable;
  const dis = ro ? 'disabled' : '';
  setTitle(`${a.code}, ${a.title || 'atelier'}`);
  const back = rights.isAdmin ? `#/admin/jp/${a.jp_id}/ateliers` : '#/redaction';

  const field = (path, label, o = {}) => {
    const v = get(content, path) ?? '';
    const fid = `a-${path.replace(/\./g, '-')}`;
    return `<label for="${fid}">${esc(label)}${o.hint ? ` <span class="hint">${esc(o.hint)}</span>` : ''}</label>${o.area
      ? `<textarea id="${fid}" data-path="${path}" rows="${o.rows || 3}" ${dis} placeholder="${esc(o.ph || '')}">${esc(v)}</textarea>`
      : `<input id="${fid}" type="text" data-path="${path}" value="${esc(v)}" ${dis} placeholder="${esc(o.ph || '')}">`}`;
  };
  const strList = (path, label, ph, add) => `<label>${esc(label)}</label>${get(content, path).map((v, i) => `<div class="listed">
    <input type="text" data-path="${path}.${i}" value="${esc(v)}" ${dis} placeholder="${i === 0 ? esc(ph) : ''}" aria-label="${esc(label)} ${i + 1}">
    ${ro ? '' : `<button type="button" class="small quiet" data-del="${path}" data-i="${i}">Retirer</button>`}</div>`).join('')}
    ${ro ? '' : `<button type="button" class="small quiet" data-add="${path}" data-kind="str">${esc(add)}</button>`}`;
  const qtyList = (path, label, unit) => `<label>${esc(label)}</label>${get(content, path).map((m, i) => `<div class="listed">
    <input type="text" data-path="${path}.${i}.article" value="${esc(m.article)}" ${dis} aria-label="Article">
    <input type="number" min="0" step="0.5" data-num data-path="${path}.${i}.qte" value="${esc(m.qte)}" ${dis} style="max-width:90px" aria-label="Quantité ${unit}">
    ${ro ? '' : `<button type="button" class="small quiet" data-del="${path}" data-i="${i}">Retirer</button>`}</div>`).join('')}
    ${ro ? '' : `<button type="button" class="small quiet" data-add="${path}" data-kind="qty">Ajouter un article</button>`}`;
  const head = (n, t, h) => `<div class="sec-title"><span class="n">${n}</span><h2 style="margin:0">${t}</h2></div>${h ? `<p class="sec-help">${h}</p>` : ''}`;

  const sections = () => {
    const g = content.grille.filter((x) => x.trim()).length;
    const m = jp.atelier_minutes;
    return `
    <section id="s-id" class="panel">${head(1, 'Identité de l\'atelier')}
      <div class="grid cols-2"><div><label for="m-title">Titre</label><input id="m-title" type="text" data-meta="title" value="${esc(meta.title)}" ${dis}></div>
      <div><label for="m-disc-sel">Discipline</label><select id="m-disc-sel" ${dis}><option value="">Choisir une discipline</option>
        ${DISCIPLINES.map(([n, e]) => `<option value="${esc(n)}" ${n === meta.discipline && !otherDisc ? 'selected' : ''}>${e}  ${esc(n)}</option>`).join('')}
        <option value="__autre" ${otherDisc ? 'selected' : ''}>➕  Autre discipline</option></select>
        ${otherDisc ? `<input id="m-disc" type="text" data-meta="discipline" value="${esc(meta.discipline)}" ${dis} placeholder="Nom de la discipline" style="margin-top:6px" aria-label="Autre discipline">` : ''}</div></div>
      <label for="a-emoji">Pictogramme <span class="hint">(affiché à la place du code, avec le numéro de l'atelier)</span></label>
      <div class="row"><input id="a-emoji" type="text" data-path="emoji" value="${esc(content.emoji || '')}" ${dis} maxlength="8" style="width:72px;font-size:1.5rem;text-align:center"></div>
      ${ro ? '' : `<div class="emoji-pick">${ATELIER_EMOJIS.map((e) => `<button type="button" data-emo="${e}" class="${e === content.emoji ? 'on' : ''}" aria-label="Choisir ${e}">${e}</button>`).join('')}</div>`}
      ${field('objectif', 'Objectif', { area: true, rows: 2, ph: 'Ce que l\'étudiant saura faire en sortant' })}
      ${field('ecos', 'Comment ce geste tombe en ECOS', { area: true, rows: 2 })}
    </section>
    <section id="s-deroule" class="panel">${head(2, `Déroulé des ${m} minutes`, 'Repère pour 20 minutes : 2 de brief, 5 de démonstration commentée, 11 de pratique, 2 de débrief.')}
      ${field('deroule.brief', 'Brief')}${field('deroule.demo', 'Démonstration')}${field('deroule.pratique', 'Pratique', { area: true, rows: 2 })}${field('deroule.debrief', 'Débrief')}
    </section>
    <section id="s-materiel" class="panel">${head(3, 'Matériel', `Il faut assez de postes pour que chacun pratique. Avec ${data.participants} inscrits, les consommables sont calculés dans l'onglet Matériel de la journée.`)}
      <label for="postes">Nombre de postes</label><input id="postes" type="number" min="1" data-num data-path="postes" value="${esc(content.postes)}" ${dis} style="max-width:120px">
      ${qtyList('materiel', 'Matériel installé sur chaque poste', 'par poste')}
      ${qtyList('consommables', 'Consommables par étudiant', 'par étudiant')}
    </section>
    <section id="s-grille" class="panel">${head(4, 'Mini-grille')}
      <div class="row between"><p class="sec-help" style="margin:0">Les gestes que l'animateur regarde pendant la pratique. Elle est remise aux étudiants avec les points clés.</p>
        <span class="counter ${g >= 4 && g <= 8 ? '' : 'off'}">${g} sur 4 à 8</span></div>
      ${strList('grille', 'Gestes observables', 'Enfile les gants stériles sans faute d\'asepsie', 'Ajouter un geste')}
    </section>
    <section id="s-debrief" class="panel">${head(5, 'Débrief')}
      ${strList('erreurs', 'Erreurs fréquentes à montrer', 'Aiguille tenue trop près de la pointe', 'Ajouter une erreur')}
    </section>
    <section id="s-points" class="panel">${head(6, 'Points clés', 'Envoyés aux étudiants le soir de la journée, avec la mini-grille.')}
      ${field('points_cles', 'Points clés', { area: true, rows: 6 })}${field('references', 'Références', { area: true, rows: 2 })}
    </section>`;
  };

  const actions = () => {
    const acts = [];
    if (a.status === 'redaction' && (rights.isAuthor || rights.isAdmin)) acts.push(['submit', 'Envoyer en relecture', 'primary']);
    if (a.status === 'relecture' && (rights.isReviewer || rights.isAdmin)) acts.push(['approve', 'Valider la fiche', 'primary'], ['revise', 'Renvoyer au référent', 'danger']);
    if (a.status === 'validee' && rights.isAdmin) acts.push(['revise', 'Rouvrir la fiche', '']);
    return acts;
  };

  const draw = () => {
    const y = window.scrollY;
    const errors = checks.filter((x) => x.level === 'error');
    const acts = actions();
    const idx = JP_FLOW.indexOf(a.status);
    app.innerHTML = `
      <a class="back" href="${back}">${rights.isAdmin ? 'Ateliers de la journée' : 'Mes stations et ateliers'}</a>
      <div class="page-head">${atelierPlate(a.code, content.emoji, 'xl')}<div style="flex:1;min-width:240px"><h1>${esc(meta.title || 'Atelier sans titre')}</h1>
        <div class="tags" style="margin-top:6px">${meta.discipline ? `<span>${disc(meta.discipline)}</span>` : ''}<span class="faint">${esc(a.jp_name)}</span></div></div>
        <div class="save-state" id="ss">${ro ? 'Lecture seule à cette étape' : 'Enregistrement automatique'}</div></div>
      <div class="panel">
        <div class="steps" style="grid-template-columns:repeat(3,1fr)">${['Rédaction', 'Relecture', 'Validée'].map((l, k) => `<div class="st ${a.status === 'validee' || k < idx ? 'done' : k === idx ? 'now' : ''}">${l}</div>`).join('')}</div>
        <p class="small muted" style="margin:12px 0 0">Référent : ${esc(a.author_name || 'à attribuer')}. Relecture : ${esc(a.reviewer_name || 'à attribuer')}.</p>
        ${acts.length ? `<label for="wf">Commentaire <span class="hint">(obligatoire pour renvoyer)</span></label><textarea id="wf" rows="2"></textarea>
          <div class="row" style="margin-top:10px">${acts.map(([k, l, c]) => `<button class="${c}" data-act="${k}">${l}</button>`).join('')}</div>` : ''}
        <details ${errors.length && !ro ? 'open' : ''} style="margin-top:12px"><summary style="cursor:pointer"><strong>Check-list</strong>
          <span class="pill ${errors.length ? 'warn' : 'ok'}" style="margin-left:6px">${errors.length ? `${errors.length} point(s) bloquant(s)` : 'Rien de bloquant'}</span></summary>
          <ul class="checks">${checks.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}</ul></details></div>
      ${sections()}
      <section class="panel"><h2 style="margin:0">Échanges</h2>
        <label for="nc">Laisser un message</label><textarea id="nc" rows="2"></textarea><button class="small" id="sc" style="margin-top:8px">Publier le message</button>
        <ul class="timeline">${data.reviews.map((r) => `<li class="${r.action}"><span class="who">${esc(r.author_name)}</span>
          <span class="muted">${{ comment: 'a écrit', submit: 'a envoyé la fiche', approve: 'a validé', revise: 'demande des corrections' }[r.action] || r.action}</span>
          <span class="when">le ${new Date(`${r.created_at}Z`).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          ${r.comment ? `<div>${nl(r.comment)}</div>` : ''}</li>`).join('') || '<li class="muted small">Pas encore d\'échange.</li>'}</ul></section>`;
    window.scrollTo(0, y);
    bind();
  };

  let timer = null;
  const ss = (t, d) => { const el = document.getElementById('ss'); if (el) { el.textContent = t; el.classList.toggle('dirty', !!d); } };
  const save = async () => {
    try { const r = await api(`/ateliers/${a.id}/content`, { method: 'PUT', body: { content, ...meta } }); checks = r.checks; a.title = meta.title; ss(`Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`); } catch (err) { ss('Échec de l\'enregistrement', true); toast(err.message, 'error'); }
  };
  const schedule = () => { ss('Modifications non enregistrées', true); clearTimeout(timer); timer = setTimeout(save, 1200); };
  const flush = async () => { if (timer) { clearTimeout(timer); timer = null; await save(); } };
  const NEW = { str: () => '', qty: () => ({ article: '', qte: 1 }) };

  function bind() {
    if (!ro) {
      app.addEventListener('input', onInput);
      app.querySelectorAll('[data-add],[data-del]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.add) get(content, b.dataset.add).push(NEW[b.dataset.kind]()); else get(content, b.dataset.del).splice(Number(b.dataset.i), 1);
        schedule(); app.removeEventListener('input', onInput); draw();
      }));
      app.querySelectorAll('[data-emo]').forEach((b) => b.addEventListener('click', () => {
        content.emoji = b.dataset.emo; schedule(); app.removeEventListener('input', onInput); draw();
      }));
      app.querySelector('#m-disc-sel')?.addEventListener('change', (e) => {
        otherDisc = e.target.value === '__autre'; meta.discipline = otherDisc ? '' : e.target.value;
        schedule(); app.removeEventListener('input', onInput); draw();
      });
    }
    app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      await flush();
      try { await api(`/ateliers/${a.id}/review`, { method: 'POST', body: { action: b.dataset.act, comment: app.querySelector('#wf')?.value } }); toast('Étape enregistrée'); app.removeEventListener('input', onInput); atelierEditor(app, id); } catch (err) { toast(err.message, 'error'); }
    }));
    app.querySelector('#sc').addEventListener('click', async () => {
      const t = app.querySelector('#nc').value.trim(); if (!t) return; await flush();
      await api(`/ateliers/${a.id}/review`, { method: 'POST', body: { action: 'comment', comment: t } }); app.removeEventListener('input', onInput); atelierEditor(app, id);
    });
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset.meta) { meta[t.dataset.meta] = t.value; schedule(); return; }
    if (!t.dataset.path) return;
    set(content, t.dataset.path, t.dataset.num !== undefined ? (t.value === '' ? '' : Number(t.value)) : t.value);
    schedule();
  }
  window.addEventListener('hashchange', () => { app.removeEventListener('input', onInput); flush(); }, { once: true });
  draw();
}

// ---------- espace de l'inscrit ----------

export async function participantView(app) {
  setTitle('Ma journée procédure');
  const R = await api('/me/journee');
  const p = R.participant;
  app.innerHTML = `<div class="narrow">
    <div class="row between" style="align-items:flex-end"><div><h1>${esc(p.first_name)} ${esc(p.last_name)}</h1>
      <div class="muted" style="margin-top:4px">${esc(R.jp.name)}</div></div></div>
    ${R.slot ? `<div class="rank-hero">
      <div><div class="rank">${p.group ? `G${p.group}` : '…'}</div><div class="of">${p.group ? 'ton groupe' : 'groupe bientôt attribué'}</div></div>
      <div class="side"><div><div class="v">${frDate(R.slot.day)}</div><div class="l">jour de passage</div></div>
        <div><div class="v">${hm(R.slot.convocation)}</div><div class="l">convocation, début à ${hm(R.slot.start_time)}</div></div></div></div>`
      : '<div class="panel"><p>Ton créneau n\'est pas encore fixé. Tu le verras ici dès que l\'équipe l\'aura attribué.</p></div>'}
    ${R.parcours ? `<h2>Ton parcours</h2>
      <p class="small muted">Chaque atelier dure ${R.jp.atelier_minutes} minutes. Entre deux ateliers, tu as quelques minutes pour changer de salle.</p>
      ${R.parcours.map((t) => `<div class="st-res" style="margin:8px 0"><div style="display:grid;grid-template-columns:90px auto minmax(0,1fr);gap:14px;align-items:center;padding:12px 14px">
        <span class="num"><strong>${hm(t.start)}</strong><br><span class="faint small">à ${hm(t.end)}</span></span>${atelierPlate(t.code, t.emoji, 'lg')}
        <span class="what"><strong>${esc(t.title || '')}</strong>${t.discipline ? `<span>${disc(t.discipline)}</span>` : ''}</span></div></div>`).join('')}` : ''}
    <h2>${R.jp.keypoints_published ? 'Les points clés de chaque atelier' : 'Les ateliers'}</h2>
    ${R.ateliers.map((a) => `<details class="st-res" ${R.jp.keypoints_published ? '' : ''}><summary>${atelierPlate(a.code, a.emoji, 'lg')}<span class="what"><strong>${esc(a.title || '')}</strong>${a.discipline ? `<span>${disc(a.discipline)}</span>` : ''}</span><span></span></summary>
      <div class="body"><p>${nl(a.objectif)}</p>
        ${a.points_cles ? `<h3>Points clés</h3><p>${nl(a.points_cles)}</p>` : ''}
        ${a.grille?.length ? `<h3>Les gestes à maîtriser</h3><ul>${a.grille.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
        ${a.references ? `<p class="small muted">Références : ${nl(a.references)}</p>` : ''}
        ${!R.jp.keypoints_published ? '<p class="small faint">Les points clés arrivent le soir de la journée.</p>' : ''}</div></details>`).join('')}
  </div>`;
}

export { state };
