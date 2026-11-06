import { api, esc, toast, fmt, pct, frDate, setTitle, downloadCsv, parseTable, confirmBox, plate, rail, disc } from './ui.js';
import { DOMAINS, TYPES, STATUSES, domainIcon } from './shared.js';

const link = (role, code) => `${location.origin}/#/?role=${role}&code=${code}`;
const dates = (e) => (!e.starts_on ? 'Dates à fixer' : !e.ends_on || e.ends_on === e.starts_on ? frDate(e.starts_on) : `${frDate(e.starts_on)} au ${frDate(e.ends_on)}`);

// ---------- liste des sessions ----------

export async function examsView(app) {
  setTitle('Sessions');
  const exams = await api('/exams');
  app.innerHTML = `
    <h1>Sessions d'ECOS blancs</h1>
    <p class="lede">Une session regroupe ses 12 stations, ses inscrits et ses résultats.</p>
    ${exams.length ? `<div class="table-wrap" style="margin-top:20px"><table>
      <thead><tr><th>Session</th><th>Dates</th><th class="num">Stations</th><th class="num">Inscrits</th><th class="num">Grilles saisies</th><th>Saisie</th><th></th></tr></thead>
      <tbody>${exams.map((e) => `<tr class="clickable" data-id="${e.id}">
        <td><strong>${esc(e.name)}</strong></td><td>${dates(e)}</td>
        <td class="num">${e.n_stations}</td><td class="num">${e.n_candidates}</td><td class="num">${e.n_evaluations}</td>
        <td>${e.eval_open ? '<span class="pill live ok">Ouverte</span>' : '<span class="pill">Fermée</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="small" data-edit>Modifier</button><button class="small danger" data-del>Supprimer</button></div></td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="alert info">Aucune session pour l\'instant. Crée la première ci-dessous.</p>'}
    <div class="panel">
      <h2>Créer une session</h2>
      <form id="new">
        <div class="grid cols-2">
          <div><label for="n">Nom</label><input id="n" name="name" required placeholder="ECOS blancs 1, janvier 2027"></div>
          <div class="grid cols-2" style="gap:10px">
            <div><label for="d1">Premier jour</label><input id="d1" type="date" name="starts_on"></div>
            <div><label for="d2">Dernier jour</label><input id="d2" type="date" name="ends_on"></div>
          </div>
        </div>
        <label class="check" style="margin-top:16px"><input type="checkbox" name="slots" checked>
          <span>Préparer les 12 stations du guide : A1 à A5, B1 à B5 et deux réserves, avec leurs domaines</span></label>
        <button class="primary" style="margin-top:16px">Créer la session</button>
      </form>
    </div>
    <div id="impbox"></div>
    <div id="jpbox"></div>`;
  (await import('./backup.js')).importPanel(app.querySelector('#impbox'), (id) => { location.hash = `#/admin/session/${id}/analyse`; });
  (await import('./jp.js')).jpSection(app.querySelector('#jpbox'));
  app.querySelector('#new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('/exams', { method: 'POST', body: { name: f.get('name'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on'), create_slots: !!f.get('slots') } });
    location.hash = `#/admin/session/${r.id}`;
  });
  app.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button, input, form')) return;
    location.hash = `#/admin/session/${tr.dataset.id}`;
  }));
  rowActions(app, exams, {
    save: (id, body) => api(`/exams/${id}`, { method: 'PATCH', body }),
    remove: async (e) => {
      if (e.n_evaluations > 0) {
        const typed = prompt(`« ${e.name} » contient ${e.n_evaluations} grilles saisies. Elles seront perdues avec la session, ses stations et ses inscrits.\n\nTape SUPPRIMER pour confirmer.`);
        if (typed !== 'SUPPRIMER') return false;
        await api(`/exams/${e.id}?force=1`, { method: 'DELETE' });
      } else {
        if (!confirmBox(`Supprimer « ${e.name} », ses stations et ses inscrits ?`)) return false;
        await api(`/exams/${e.id}`, { method: 'DELETE' });
      }
      return true;
    },
    reload: () => examsView(app),
  });
}

// Boutons Modifier et Supprimer d'une liste de sessions (ECOS ou journées procédure)
export function rowActions(root, items, { save, remove, reload }) {
  root.querySelectorAll('tr[data-id] [data-edit], tr[data-jp] [data-edit]').forEach((b) => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    const id = tr.dataset.id || tr.dataset.jp;
    const it = items.find((x) => String(x.id) === id);
    const cols = tr.children.length;
    tr.classList.remove('clickable');
    tr.innerHTML = `<td colspan="${cols}"><form class="row" style="align-items:flex-end">
      <div style="flex:2;min-width:220px"><label for="en${id}" style="margin-top:0">Nom</label><input id="en${id}" name="name" value="${esc(it.name)}" required></div>
      <div><label for="es${id}" style="margin-top:0">Premier jour</label><input id="es${id}" type="date" name="starts_on" value="${esc(it.starts_on || '')}"></div>
      <div><label for="ee${id}" style="margin-top:0">Dernier jour</label><input id="ee${id}" type="date" name="ends_on" value="${esc(it.ends_on || '')}"></div>
      <button class="primary">Enregistrer</button><button type="button" class="quiet" data-cancel>Annuler</button></form></td>`;
    tr.querySelector('input').focus();
    tr.querySelector('[data-cancel]').addEventListener('click', reload);
    tr.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try { await save(id, { name: f.get('name'), starts_on: f.get('starts_on') || null, ends_on: f.get('ends_on') || null }); toast('Modifications enregistrées'); reload(); } catch (err) { toast(err.message, 'error'); }
    });
  }));
  root.querySelectorAll('tr[data-id] [data-del], tr[data-jp] [data-del]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    const it = items.find((x) => String(x.id) === (tr.dataset.id || tr.dataset.jp));
    try { if (await remove(it)) { toast('Supprimé'); reload(); } } catch (err) { toast(err.message, 'error'); }
  }));
}

// ---------- une session ----------

const TABS = [['stations', 'Stations'], ['candidats', 'Candidats'], ['planning', 'Planning'], ['resultats', 'Résultats'], ['analyse', 'Analyse'], ['reglages', 'Réglages']];

export async function examView(app, id, tab) {
  const exam = await api(`/exams/${id}`);
  if (tab === 'affiches') return signsView(app, exam);
  if (tab === 'planning-imprimer') return (await import('./planning.js')).planningPrint(app, exam);
  setTitle(exam.name);
  app.innerHTML = `
    <a class="back" href="#/admin">Toutes les sessions</a>
    <div class="row between" style="align-items:flex-end">
      <div><h1>${esc(exam.name)}</h1><p class="muted" style="margin:6px 0 0">${dates(exam)}</p></div>
      <div class="row">${exam.eval_open ? '<span class="pill live ok">Saisie ouverte</span>' : '<span class="pill">Saisie fermée</span>'}
      ${exam.corrections_published ? '<span class="pill ink">Corrections publiées</span>' : ''}</div></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/session/${id}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  const box = app.querySelector('#tab');
  if (tab === 'stations') return stationsTab(box, exam);
  if (tab === 'candidats') return candidatesTab(box, exam);
  if (tab === 'resultats') return resultsTab(box, exam);
  if (tab === 'planning') return (await import('./planning.js')).planningTab(box, exam);
  if (tab === 'analyse') return (await import('./analytics.js')).analyticsTab(box, exam);
  if (tab === 'reglages') return settingsTab(box, exam);
  box.innerHTML = '<p>Onglet inconnu.</p>';
}

async function stationsTab(box, exam) {
  const [stations, people] = await Promise.all([api(`/exams/${exam.id}/stations`), api('/people')]);
  const active = people.filter((p) => p.active);
  const sel = (name, value, label) => `<select data-f="${name}" aria-label="${label}"><option value="">Personne</option>${active.map((p) =>
    `<option value="${p.id}" ${p.id === value ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  const played = stations.filter((s) => s.played);
  const ready = played.filter((s) => s.status === 'validee').length;
  const late = stations.filter((s) => s.status === 'a_attribuer').length;
  box.innerHTML = `
    <div class="facts">
      <div><div class="v">${ready}<span class="faint"> / ${played.length}</span></div><div class="l">stations jouées validées</div></div>
      <div><div class="v">${stations.filter((s) => ['relecture_pair', 'relecture_expert', 'test', 'validation'].includes(s.status)).length}</div><div class="l">en relecture ou en test</div></div>
      <div><div class="v">${late}</div><div class="l">sans rédacteur</div></div>
    </div>
    ${active.length ? '' : '<p class="alert warn">Ajoute d\'abord des rédacteurs et des relecteurs dans <a href="#/admin/personnes">Rédacteurs et relecteurs</a> pour attribuer les stations.</p>'}
    <div class="row" style="margin:6px 0 12px"><span class="spacer"></span>
      <button id="codes" class="small">Affiches des salles</button>
      <button id="add" class="small">Ajouter une station</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Station</th><th>Contenu</th><th>Rédaction</th><th>Relecture pair</th><th>Relecture expert</th><th>Étape</th><th></th></tr></thead>
      <tbody>${stations.map((s) => `<tr data-id="${s.id}">
        <td><div class="row" style="flex-wrap:nowrap">${plate(s.slot, 'lg')}
          <label class="check small" style="margin:0;font-weight:400"><input type="checkbox" data-f="played" ${s.played ? 'checked' : ''}> jouée</label></div></td>
        <td style="min-width:240px"><strong>${esc(s.title || 'Sans titre')}</strong>${s.discipline ? `<div class="small muted">${disc(s.discipline)}</div>` : ''}
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
          <select data-f="domain" aria-label="Domaine"><option value="">Domaine</option>${DOMAINS.map((d) => `<option value="${esc(d)}" ${d === s.domain ? 'selected' : ''}>${domainIcon(d)} ${esc(d)}</option>`).join('')}</select>
          <select data-f="type" aria-label="Type">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div></td>
        <td>${sel('author_id', s.author_id, 'Rédacteur')}</td><td>${sel('peer_id', s.peer_id, 'Relecteur pair')}</td><td>${sel('expert_id', s.expert_id, 'Relecteur expert')}</td>
        <td style="min-width:150px"><select data-f="status" aria-label="Étape">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${rail(s.status, true)}
          <div class="small faint">${s.n_evaluations ? `${s.n_evaluations} grille(s) saisie(s)` : s.n_comments ? `${s.n_comments} commentaire(s)` : ''}</div></td>
        <td><a class="btn small" href="#/station/${s.id}">Ouvrir</a></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">Attribuer un rédacteur passe la station en rédaction. Ensuite, elle avance d'elle-même à chaque étape du circuit de relecture ; l'étape ne se change ici qu'en cas de besoin.</p>`;

  box.querySelectorAll('tr[data-id] [data-f]').forEach((input) => input.addEventListener('change', async () => {
    const id = input.closest('tr').dataset.id;
    const f = input.dataset.f;
    const v = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.value;
    try {
      await api(`/stations/${id}`, { method: 'PATCH', body: { [f]: f.endsWith('_id') ? (v ? Number(v) : null) : v } });
      toast('Modification enregistrée');
      if (f === 'author_id' || f === 'status' || f === 'played') stationsTab(box, exam);
    } catch (err) { toast(err.message, 'error'); }
  }));
  box.querySelector('#add').addEventListener('click', async () => {
    const slot = prompt('Nom de la nouvelle station (par exemple R3) :');
    if (!slot) return;
    try { await api(`/exams/${exam.id}/stations`, { method: 'POST', body: { slot } }); stationsTab(box, exam); } catch (err) { toast(err.message, 'error'); }
  });
  box.querySelector('#codes').addEventListener('click', () => window.open(`#/admin/session/${exam.id}/affiches`, '_blank'));
}

async function signsView(app, exam) {
  const stations = (await api(`/exams/${exam.id}/stations`)).filter((s) => s.played);
  setTitle(`Affiches, ${exam.name}`);
  app.innerHTML = `<div class="row no-print" style="margin-bottom:10px"><button class="primary" onclick="window.print()">Imprimer les ${stations.length} affiches</button>
    <span class="small muted">Une affiche par porte. Générer un nouveau code invalide l'ancien.</span></div>
    ${stations.map((s) => `<div class="sheet landscape" style="display:flex;flex-direction:column;justify-content:center;gap:12mm">
      <div class="door-sign" style="border:none">${plate(s.slot, 'xl')}
        <div><div style="font-size:16pt;color:#555">Évaluateur, connecte-toi sur</div>
        <div style="font-size:24pt;font-weight:700">${esc(location.host)}</div>
        <div style="font-size:16pt;color:#555;margin-top:6mm">avec le code de cette salle</div>
        <div class="code" style="font-size:44pt">${esc(s.eval_code)}</div></div></div>
      <div class="no-print"><button class="small quiet" data-regen="${s.id}">Générer un nouveau code pour ${esc(s.slot)}</button></div></div>`).join('')}`;
  app.querySelectorAll('[data-regen]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirmBox('Générer un nouveau code ? L\'ancien ne fonctionnera plus.')) return;
    await api(`/stations/${b.dataset.regen}`, { method: 'PATCH', body: { regen_code: true } });
    signsView(app, exam);
  }));
}

// ---------- candidats ----------

const FIELDS = [
  ['last_name', 'Nom'], ['first_name', 'Prénom'], ['email', 'E-mail'], ['phone', 'Téléphone'],
  ['faculty', 'Faculté'], ['year', 'Année'], ['slot_label', 'Créneau de la billetterie'], ['tarif', 'Tarif (adhérent ou non)'], ['prepa', 'Préparation (tutorat, prépa…)'],
];
const GUESS = {
  last_name: /^nom( |$)|nom participant|last ?name/i, first_name: /pr[ée]nom/i, email: /e-?mail|courriel/i,
  phone: /t[ée]l[ée]phone|portable|phone/i, faculty: /facult|fac\b|universit/i, year: /ann[ée]e|niveau|promo/i,
  slot_label: /cr[ée]neau|formule|s[ée]ance/i, tarif: /tarif|adh[ée]rent/i, prepa: /pr[ée]pa|tutorat|pr[ée]paration/i,
};

async function candidatesTab(box, exam) {
  const cands = await api(`/exams/${exam.id}/candidates`);
  const labels = {};
  cands.forEach((c) => { if (c.slot_label) { labels[c.slot_label] ??= { n: 0, day: c.day, series: c.series }; labels[c.slot_label].n++; } });
  const active = cands.filter((c) => c.status !== 'annule');
  const unplaced = active.filter((c) => !c.day || !c.series).length;
  const unnumbered = active.filter((c) => !c.number).length;
  const extraOf = (c) => { try { return JSON.parse(c.extra || '{}') || {}; } catch { return {}; } };
  const nFake = cands.filter((c) => extraOf(c).test).length;

  box.innerHTML = `
    <div class="facts">
      <div><div class="v">${active.length}</div><div class="l">inscrits</div></div>
      <div><div class="v">${cands.length - active.length}</div><div class="l">annulés</div></div>
      <div><div class="v">${unplaced}</div><div class="l">sans créneau</div></div>
      <div><div class="v">${active.filter((c) => c.n_evaluations > 0).length}</div><div class="l">déjà évalués</div></div>
    </div>
    <details class="panel" ${cands.length ? '' : 'open'}>
      <summary style="cursor:pointer"><strong>Importer les inscrits</strong> <span class="muted">depuis l'export de la billetterie (CSV) ou un copier-coller du tableur</span></summary>
      <label for="file">Fichier CSV</label><input type="file" id="file" accept=".csv,.txt,.tsv">
      <label for="paste">Ou colle les lignes, en-têtes compris</label>
      <textarea id="paste" placeholder="Nom	Prénom	E-mail	Tarif…"></textarea>
      <div id="mapping"></div>
    </details>
    ${Object.keys(labels).length ? `<div class="panel"><h2>Créneaux de la billetterie</h2>
      <p class="muted small">Associe chaque créneau à un jour et une série, puis numérote. Dans une série, les candidats 01 à 05 commencent par le circuit A et 06 à 10 par le circuit B.</p>
      <div class="table-wrap"><table><thead><tr><th>Créneau</th><th class="num">Inscrits</th><th>Jour</th><th>Série</th><th></th></tr></thead><tbody>
      ${Object.entries(labels).map(([l, v]) => `<tr data-label="${esc(l)}"><td>${esc(l)}</td><td class="num">${v.n}</td>
        <td><input type="date" value="${esc(v.day || '')}" aria-label="Jour"></td>
        <td><select aria-label="Série">${['', 1, 2, 3, 4].map((s) => `<option value="${s}" ${String(s) === String(v.series ?? '') ? 'selected' : ''}>${s ? `Série ${s}` : 'Choisir'}</option>`).join('')}</select></td>
        <td><button class="small" data-assign>Appliquer</button></td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="row" style="margin:18px 0 12px">
      <button id="renumber" class="${unnumbered ? 'primary' : ''}">Numéroter les candidats${unnumbered ? ` (${unnumbered} sans numéro)` : ''}</button>
      <button id="export">Exporter codes et liens</button>
      <button id="add" class="quiet">Ajouter un candidat</button>
      <button id="fake" class="quiet">Ajouter des étudiants fictifs</button>
      ${nFake ? `<button id="unfake" class="quiet danger">Supprimer les ${nFake} fictifs</button>` : ''}
      <span class="spacer"></span>
      <input id="q" type="text" placeholder="Chercher un nom ou un numéro" style="max-width:260px" aria-label="Chercher">
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Numéro</th><th>Candidat</th><th>Créneau</th><th>Code</th><th>Statut</th><th class="num">Grilles</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table></div>`;

  const drawRows = (q = '') => {
    const qq = q.toLowerCase();
    box.querySelector('#rows').innerHTML = cands.filter((c) => !qq || `${c.number} ${c.last_name} ${c.first_name} ${c.email}`.toLowerCase().includes(qq))
      .map((c) => `<tr data-id="${c.id}" ${c.status === 'annule' ? 'style="opacity:.5"' : ''}>
        <td><span class="cand-no" style="font-size:1.1rem">${esc(c.number || '')}</span></td>
        <td><strong>${esc(c.last_name)}</strong> ${esc(c.first_name)}
          <div class="small muted">${esc(c.email || '')}${c.faculty ? `, ${esc(c.faculty)}` : ''}${extraOf(c).tarif ? `, ${esc(extraOf(c).tarif)}` : ''}</div></td>
        <td>${c.day ? `${frDate(c.day)}, série ${c.series ?? '?'}` : '<span class="pill warn">À placer</span>'}<div class="small faint">${esc(c.slot_label || '')}</div></td>
        <td><span class="code">${esc(c.code)}</span></td>
        <td><select data-status aria-label="Statut"><option value="inscrit" ${c.status === 'inscrit' ? 'selected' : ''}>Inscrit</option>
          <option value="annule" ${c.status === 'annule' ? 'selected' : ''}>Annulé</option></select></td>
        <td class="num">${c.n_evaluations}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px">
          <a class="btn small" href="#/admin/session/${exam.id}/candidat/${c.id}">Résultats</a>
          <button class="small" data-copy>Copier le lien</button>
          <button class="small" data-edit>Modifier</button>
          <button class="small danger" data-del>Supprimer</button></div></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">Aucun candidat.</td></tr>';
    box.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
      await api(`/candidates/${s.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: s.value } });
      toast('Statut modifié. Pense à renuméroter.');
    }));
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const c = cands.find((x) => String(x.id) === b.closest('tr').dataset.id);
      await navigator.clipboard?.writeText(link('etudiant', c.code));
      toast('Lien copié');
    }));
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      const c = cands.find((x) => String(x.id) === tr.dataset.id);
      const f = (name, label, value, type = 'text') => `<div><label for="e-${name}-${c.id}" style="margin-top:0">${label}</label><input id="e-${name}-${c.id}" name="${name}" type="${type}" value="${esc(value || '')}"></div>`;
      tr.innerHTML = `<td colspan="7"><form class="cand-edit">
        <div class="grid cols-4" style="gap:10px">${f('last_name', 'Nom', c.last_name)}${f('first_name', 'Prénom', c.first_name)}${f('email', 'E-mail', c.email, 'email')}${f('phone', 'Téléphone', c.phone)}
          ${f('faculty', 'Faculté', c.faculty)}${f('year', 'Année', c.year)}${f('tarif', 'Tarif', extraOf(c).tarif)}</div>
        <div class="row" style="margin-top:12px"><button class="primary">Enregistrer</button><button type="button" class="quiet" data-cancel>Annuler</button>
          <span class="spacer"></span><button type="button" class="small quiet" data-regen>Nouveau code d'accès</button></div>
        <p class="small muted" style="margin-bottom:0">Pour changer son créneau, passe par l'onglet Planning.</p></form></td>`;
      tr.querySelector('input').focus();
      tr.querySelector('[data-cancel]').addEventListener('click', () => drawRows(box.querySelector('#q').value));
      tr.querySelector('[data-regen]').addEventListener('click', async () => {
        if (!confirmBox(`Générer un nouveau code pour ${c.first_name} ${c.last_name} ? L'ancien code ne fonctionnera plus.`)) return;
        await api(`/candidates/${c.id}`, { method: 'PATCH', body: { regen_code: true } });
        toast('Nouveau code généré'); candidatesTab(box, exam);
      });
      tr.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        if (!body.last_name.trim() && !body.first_name.trim()) { toast('Indique au moins un nom', 'error'); return; }
        try { await api(`/candidates/${c.id}`, { method: 'PATCH', body }); toast('Candidat modifié'); candidatesTab(box, exam); } catch (err) { toast(err.message, 'error'); }
      });
    }));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const c = cands.find((x) => String(x.id) === b.closest('tr').dataset.id);
      try {
        if (c.n_evaluations > 0) {
          const typed = prompt(`${c.first_name} ${c.last_name} a ${c.n_evaluations} grille(s) saisie(s), qui seront perdues. Pour garder ses notes, passe-le plutôt en « Annulé ».\n\nTape SUPPRIMER pour confirmer.`);
          if (typed !== 'SUPPRIMER') return;
          await api(`/candidates/${c.id}?force=1`, { method: 'DELETE' });
        } else {
          if (!confirmBox(`Supprimer ${c.first_name} ${c.last_name} ? Sa place se libère et son code ne fonctionnera plus.`)) return;
          await api(`/candidates/${c.id}`, { method: 'DELETE' });
        }
        toast('Candidat supprimé'); candidatesTab(box, exam);
      } catch (err) { toast(err.message, 'error'); }
    }));
  };
  drawRows();
  box.querySelector('#q').addEventListener('input', (e) => drawRows(e.target.value));

  box.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr');
    await api(`/exams/${exam.id}/candidates/assign-slot`, { method: 'POST', body: {
      slot_label: tr.dataset.label, day: tr.querySelector('input').value, series: tr.querySelector('select').value } });
    toast('Créneau appliqué');
    candidatesTab(box, exam);
  }));
  box.querySelector('#renumber').addEventListener('click', async () => {
    const r = await api(`/exams/${exam.id}/candidates/renumber`, { method: 'POST' });
    toast(`${r.numbered} candidats numérotés`);
    candidatesTab(box, exam);
  });
  box.querySelector('#export').addEventListener('click', () => {
    downloadCsv(`codes-${exam.id}.csv`, [['Numéro', 'Nom', 'Prénom', 'E-mail', 'Téléphone', 'Jour', 'Série', 'Code', 'Lien personnel'],
      ...active.map((c) => [c.number, c.last_name, c.first_name, c.email, c.phone, c.day, c.series, c.code, link('etudiant', c.code)])]);
  });
  box.querySelector('#fake').addEventListener('click', async () => {
    const n = prompt('Combien d\'étudiants fictifs ? Ils sont répartis dans les séries du planning, avec quelques demandes d\'échange déjà publiées. Ils se suppriment ensuite en un clic.', '30');
    if (!n) return;
    try { const r = await api(`/exams/${exam.id}/test-candidates`, { method: 'POST', body: { count: Number(n) } }); toast(`${r.created} étudiants fictifs, ${r.placed} placés, ${r.requests} demandes d'échange`); candidatesTab(box, exam); } catch (err) { toast(err.message, 'error'); }
  });
  box.querySelector('#unfake')?.addEventListener('click', async () => {
    if (!confirmBox(`Supprimer les ${nFake} étudiants fictifs, leurs demandes d'échange et leurs grilles éventuelles ?`)) return;
    const r = await api(`/exams/${exam.id}/test-candidates`, { method: 'DELETE' });
    toast(`${r.deleted} étudiants fictifs supprimés`); candidatesTab(box, exam);
  });
  box.querySelector('#add').addEventListener('click', async () => {
    const last = prompt('Nom :'); if (!last) return;
    const first = prompt('Prénom :') || '';
    const email = prompt('E-mail :') || '';
    await api(`/exams/${exam.id}/candidates`, { method: 'POST', body: { last_name: last, first_name: first, email } });
    candidatesTab(box, exam);
  });

  const onText = (text) => {
    const rows = parseTable(text);
    if (rows.length < 2) { box.querySelector('#mapping').innerHTML = '<p class="alert warn">Aucune ligne lue : vérifie que la première ligne contient les en-têtes.</p>'; return; }
    const head = rows[0];
    const guess = (f) => head.findIndex((h) => GUESS[f].test(h.trim()));
    box.querySelector('#mapping').innerHTML = `
      <p class="alert info">${rows.length - 1} ligne(s) lues. Vérifie à quelle colonne correspond chaque information.</p>
      <div class="grid cols-4" style="gap:10px">${FIELDS.map(([f, l]) => `<div><label for="m-${f}">${l}</label><select id="m-${f}" data-map="${f}"><option value="-1">Aucune colonne</option>
        ${head.map((h, i) => `<option value="${i}" ${i === guess(f) ? 'selected' : ''}>${esc(h || `Colonne ${i + 1}`)}</option>`).join('')}</select></div>`).join('')}</div>
      <p class="small muted">Les lignes sans nom sont ignorées. Les annulations se gèrent ensuite avec la colonne Statut.</p>
      <button class="primary" id="doimport">Importer ${rows.length - 1} inscrits</button>`;
    box.querySelector('#doimport').addEventListener('click', async () => {
      const map = {};
      box.querySelectorAll('[data-map]').forEach((s) => { map[s.dataset.map] = Number(s.value); });
      if (map.last_name < 0) { toast('Choisis au moins la colonne du nom', 'error'); return; }
      const out = rows.slice(1).map((r) => Object.fromEntries(FIELDS.map(([f]) => [f, map[f] >= 0 ? (r[map[f]] || '').trim() : ''])));
      const res = await api(`/exams/${exam.id}/candidates`, { method: 'POST', body: { rows: out } });
      toast(`${res.imported} inscrits importés`);
      candidatesTab(box, exam);
    });
  };
  box.querySelector('#file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) onText(await f.text()); });
  box.querySelector('#paste').addEventListener('input', (e) => { if (e.target.value.trim()) onText(e.target.value); });
}

// ---------- résultats ----------

async function resultsTab(box, exam) {
  const R = await api(`/exams/${exam.id}/results`);
  const played = R.stations.filter((s) => s.played);
  const cohort = R.rows.filter((r) => r.avg !== null);
  const meanAll = cohort.length ? cohort.reduce((a, r) => a + r.avg, 0) / cohort.length : null;
  box.innerHTML = `
    <div class="facts">
      <div><div class="v">${R.completed}<span class="faint"> / ${R.total}</span></div><div class="l">candidats classés (toutes leurs stations saisies)</div></div>
      <div><div class="v">${fmt(meanAll)}</div><div class="l">moyenne générale sur 20</div></div>
      <div><div class="v">${R.grids}</div><div class="l">grilles saisies</div></div>
    </div>
    <div class="row" style="margin:0 0 12px"><button id="refresh">Actualiser</button>
      <a class="btn" href="/api/exams/${exam.id}/results.csv">Exporter en CSV</a>
      <span class="small muted">Un candidat n'a un rang qu'une fois ses ${played.length} stations saisies.</span></div>
    <h2>Classement</h2>
    <div class="table-wrap"><table>
      <thead><tr><th class="num">Rang</th><th>Numéro</th><th>Candidat</th><th class="num">Moyenne</th>
        ${played.map((s) => `<th class="num" title="${esc(s.title || s.domain || '')}">${plate(s.slot, 'sm')}</th>`).join('')}</tr></thead>
      <tbody>${R.rows.map((r) => `<tr class="clickable" data-id="${r.id}">
        <td class="num">${r.rank ? `<strong class="cand-no" style="font-size:1.15rem">${r.rank}</strong>` : `<span class="small faint">${r.n} / ${played.length}</span>`}</td>
        <td><span class="cand-no">${esc(r.number || '')}</span></td>
        <td>${esc(r.name)}</td><td class="num"><strong>${fmt(r.avg)}</strong></td>
        ${played.map((s) => `<td class="num">${r.scores[s.id] === 'abs' ? '<span class="faint">abs.</span>' : fmt(r.scores[s.id], 1)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">Les indicateurs de qualité (items, évaluateurs, discrimination) sont dans l'onglet <a href="#/admin/session/${exam.id}/analyse">Analyse</a>.</p>`;
  box.querySelector('#refresh').addEventListener('click', () => resultsTab(box, exam));
  box.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => {
    location.hash = `#/admin/session/${exam.id}/candidat/${tr.dataset.id}`;
  }));
}

// ---------- réglages ----------

async function settingsTab(box, exam) {
  const flag = (k, title, desc, warn = '') => `<label class="panel check" style="margin:10px 0">
    <input type="checkbox" data-k="${k}" ${exam[k] ? 'checked' : ''} style="margin-top:3px">
    <span><strong>${title}</strong><br><span class="small muted">${desc}</span>${warn ? `<br><span class="small" style="color:#8a5a00">${warn}</span>` : ''}</span></label>`;
  box.innerHTML = `
    <h2 style="margin-top:0">Pendant la session</h2>
    ${flag('eval_open', 'Saisie des grilles ouverte', 'À cocher le matin du premier jour, à décocher après la dernière série. Fermée, aucun évaluateur ne peut enregistrer.')}
    ${flag('show_results', 'Les étudiants voient leurs notes et leur rang', 'Notes par station et rang provisoire, mis à jour à chaque grille saisie.')}
    ${flag('show_details', 'Les étudiants voient le détail des grilles', 'Items réussis et manqués, niveaux de communication, commentaires des évaluateurs.',
      'Visible dès le premier week-end : les candidats du deuxième peuvent en avoir écho.')}
    <h2>Après la session</h2>
    ${flag('corrections_published', 'Corrections publiées', 'Les fiches pédagogiques deviennent visibles par les étudiants. À cocher après le dernier jour.')}
    <form id="f" class="panel">
      <h2>Informations</h2>
      <div class="grid cols-2"><div><label for="nm">Nom</label><input id="nm" name="name" value="${esc(exam.name)}"></div>
        <div class="grid cols-2" style="gap:10px"><div><label for="s1">Premier jour</label><input id="s1" type="date" name="starts_on" value="${esc(exam.starts_on || '')}"></div>
        <div><label for="s2">Dernier jour</label><input id="s2" type="date" name="ends_on" value="${esc(exam.ends_on || '')}"></div></div></div>
      <button class="primary" style="margin-top:14px">Enregistrer</button>
    </form>
    <div class="panel"><h2>Sauvegarde</h2><p class="small muted">Un fichier avec les stations, les candidats et toutes les grilles. Il se réimporte depuis la liste des sessions. Il contient des données personnelles : garde-le dans un dossier partagé restreint.</p>
      <a class="btn" href="/api/exams/${exam.id}/export">Télécharger la sauvegarde</a></div>
    <div class="panel"><h2>Supprimer la session</h2><p class="small muted">Les stations, les inscrits et les grilles saisies sont supprimés avec elle.</p>
      <button class="danger" id="del">Supprimer la session</button></div>`;
  box.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api(`/exams/${exam.id}`, { method: 'PATCH', body: { name: f.get('name'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on') } });
    toast('Informations enregistrées');
  });
  box.querySelectorAll('[data-k]').forEach((cb) => cb.addEventListener('change', async () => {
    await api(`/exams/${exam.id}`, { method: 'PATCH', body: { [cb.dataset.k]: cb.checked ? 1 : 0 } });
    exam[cb.dataset.k] = cb.checked ? 1 : 0;
    toast(cb.checked ? 'Activé' : 'Désactivé');
  }));
  box.querySelector('#del').addEventListener('click', async () => {
    const typed = prompt(`Supprimer définitivement « ${exam.name} », ses stations, ses inscrits et ses grilles ?\n\nTape SUPPRIMER pour confirmer.`);
    if (typed !== 'SUPPRIMER') return;
    try { await api(`/exams/${exam.id}?force=1`, { method: 'DELETE' }); location.hash = '#/admin'; } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- rédacteurs et relecteurs ----------

export async function peopleView(app) {
  setTitle('Rédacteurs et relecteurs');
  const people = await api('/people');
  app.innerHTML = `
    <h1>Rédacteurs et relecteurs</h1>
    <p class="lede">Chacun reçoit un code personnel et ne voit que les stations qu'il rédige ou relit.</p>
    <div class="row" style="margin:18px 0 12px"><button id="exp">Exporter codes et liens</button></div>
    ${people.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Nom</th><th>Spécialité</th><th>Code</th><th class="num">Rédige</th><th class="num">Relit</th><th></th></tr></thead>
      <tbody>${people.map((p) => `<tr data-id="${p.id}" ${p.active ? '' : 'style="opacity:.5"'}>
        <td><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.email || '')}</div></td><td>${esc(p.specialty || '')}</td>
        <td><span class="code">${esc(p.code)}</span></td><td class="num">${p.n_author}</td><td class="num">${p.n_review}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="small" data-copy>Copier le lien</button>
          <button class="small" data-pedit>Modifier</button>
          <button class="small quiet" data-regen>Nouveau code</button>
          <button class="small quiet" data-active>${p.active ? 'Désactiver' : 'Réactiver'}</button>
          <button class="small danger" data-pdel>Supprimer</button></div></td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="alert info">Personne pour l\'instant. Ajoute l\'équipe ci-dessous.</p>'}
    <div class="panel"><h2>Ajouter des personnes</h2>
      <p class="small muted">Une personne par ligne : nom ; e-mail ; spécialité. L'e-mail et la spécialité sont facultatifs.</p>
      <textarea id="bulk" aria-label="Personnes à ajouter" placeholder="Yasmine Benali ; yasmine@exemple.fr ; Cardiologie"></textarea>
      <button class="primary" id="addp" style="margin-top:10px">Ajouter</button></div>`;
  app.querySelector('#addp').addEventListener('click', async () => {
    const list = app.querySelector('#bulk').value.split('\n').map((l) => l.split(/[;\t]/).map((x) => x.trim()))
      .filter((p) => p[0]).map(([name, email, specialty]) => ({ name, email, specialty }));
    if (!list.length) return;
    await api('/people', { method: 'POST', body: list });
    toast(`${list.length} personne(s) ajoutée(s)`);
    peopleView(app);
  });
  app.querySelector('#exp').addEventListener('click', () => downloadCsv('redacteurs.csv', [['Nom', 'E-mail', 'Spécialité', 'Code', 'Lien'],
    ...people.filter((p) => p.active).map((p) => [p.name, p.email, p.specialty, p.code, link('redaction', p.code)])]));
  const byRow = (b) => people.find((p) => String(p.id) === b.closest('tr').dataset.id);
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(link('redaction', byRow(b).code)); toast('Lien copié');
  }));
  app.querySelectorAll('[data-regen]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirmBox('Générer un nouveau code ? L\'ancien ne fonctionnera plus.')) return;
    await api(`/people/${byRow(b).id}`, { method: 'PATCH', body: { regen_code: true } }); peopleView(app);
  }));
  app.querySelectorAll('[data-active]').forEach((b) => b.addEventListener('click', async () => {
    const p = byRow(b);
    await api(`/people/${p.id}`, { method: 'PATCH', body: { active: p.active ? 0 : 1 } }); peopleView(app);
  }));
  app.querySelectorAll('[data-pedit]').forEach((b) => b.addEventListener('click', () => {
    const p = byRow(b);
    const tr = b.closest('tr');
    tr.innerHTML = `<td colspan="${tr.children.length}"><form class="row" style="align-items:flex-end">
      <div style="flex:2;min-width:200px"><label for="pn${p.id}" style="margin-top:0">Nom</label><input id="pn${p.id}" name="name" value="${esc(p.name)}" required></div>
      <div style="flex:2;min-width:200px"><label for="pe${p.id}" style="margin-top:0">E-mail</label><input id="pe${p.id}" name="email" type="text" value="${esc(p.email || '')}"></div>
      <div style="flex:1;min-width:160px"><label for="pt${p.id}" style="margin-top:0">Téléphone</label><input id="pt${p.id}" name="phone" value="${esc(p.phone || '')}"></div>
      <div style="flex:1.5;min-width:180px"><label for="ps${p.id}" style="margin-top:0">Spécialité</label><input id="ps${p.id}" name="specialty" value="${esc(p.specialty || '')}"></div>
      <button class="primary">Enregistrer</button><button type="button" class="quiet" data-cancel>Annuler</button></form></td>`;
    tr.querySelector('input').focus();
    tr.querySelector('[data-cancel]').addEventListener('click', () => peopleView(app));
    tr.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      try {
        await api(`/people/${p.id}`, { method: 'PATCH', body: { name: f.get('name').trim(), email: f.get('email').trim() || null, phone: f.get('phone').trim() || null, specialty: f.get('specialty').trim() || null } });
        toast('Modifications enregistrées'); peopleView(app);
      } catch (err) { toast(err.message, 'error'); }
    });
  }));
  app.querySelectorAll('[data-pdel]').forEach((b) => b.addEventListener('click', async () => {
    const p = byRow(b);
    const n = p.n_author + p.n_review;
    const msg = n ? `Supprimer ${p.name} ? Il ou elle suit ${n} station(s) ou atelier(s), qui repasseront « à attribuer » pour son rôle. Son code ne fonctionnera plus.`
      : `Supprimer ${p.name} ? Son code ne fonctionnera plus.`;
    if (!confirmBox(msg)) return;
    try { await api(`/people/${p.id}`, { method: 'DELETE' }); toast(`${p.name} supprimé(e)`); peopleView(app); } catch (err) { toast(err.message, 'error'); }
  }));
}
