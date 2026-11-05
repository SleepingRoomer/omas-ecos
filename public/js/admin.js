import { api, esc, toast, fmt, pct, frDate, setTitle, downloadCsv, parseTable, confirmBox } from './ui.js';
import { DOMAINS, TYPES, STATUSES } from './shared.js';

const link = (role, code) => `${location.origin}/#/?role=${role}&code=${code}`;

// ---------- liste des sessions ----------

export async function examsView(app) {
  setTitle('Sessions');
  const exams = await api('/exams');
  app.innerHTML = `
    <div class="row between"><h1>Sessions d'ECOS blancs</h1></div>
    <div class="card">
      <h3>Nouvelle session</h3>
      <form id="new" class="grid grid-2">
        <div><label>Nom</label><input name="name" required placeholder="ECOS blancs 1 – janvier 2027"></div>
        <div class="grid grid-2">
          <div><label>Premier jour</label><input type="date" name="starts_on"></div>
          <div><label>Dernier jour</label><input type="date" name="ends_on"></div>
        </div>
        <div class="row"><label class="row" style="font-weight:400"><input type="checkbox" name="slots" checked style="width:auto">
          Créer les 12 emplacements de stations (A1–A5, B1–B5, R1, R2)</label></div>
        <div><button class="primary">Créer la session</button></div>
      </form>
    </div>
    ${exams.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Session</th><th>Dates</th><th class="num">Stations</th><th class="num">Inscrits</th><th class="num">Grilles saisies</th><th>Saisie</th></tr></thead>
      <tbody>${exams.map((e) => `<tr class="clickable" data-id="${e.id}">
        <td><strong>${esc(e.name)}</strong></td>
        <td>${e.starts_on ? `${frDate(e.starts_on)} → ${frDate(e.ends_on)}` : '–'}</td>
        <td class="num">${e.n_stations}</td><td class="num">${e.n_candidates}</td><td class="num">${e.n_evaluations}</td>
        <td>${e.eval_open ? '<span class="badge ok">ouverte</span>' : '<span class="badge">fermée</span>'}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">Aucune session pour l\'instant.</p>'}`;
  app.querySelector('#new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const r = await api('/exams', { method: 'POST', body: { name: f.get('name'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on'), create_slots: !!f.get('slots') } });
    location.hash = `#/admin/session/${r.id}`;
  });
  app.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/admin/session/${tr.dataset.id}`; }));
}

// ---------- une session ----------

const TABS = [['stations', 'Stations'], ['candidats', 'Candidats'], ['resultats', 'Résultats'], ['reglages', 'Réglages']];

export async function examView(app, id, tab) {
  const exam = await api(`/exams/${id}`);
  setTitle(exam.name);
  app.innerHTML = `
    <p class="small"><a href="#/admin">← Sessions</a></p>
    <div class="row between"><h1>${esc(exam.name)}</h1>
      <span>${exam.eval_open ? '<span class="badge ok">Saisie ouverte</span>' : '<span class="badge">Saisie fermée</span>'}
      ${exam.corrections_published ? '<span class="badge dark">Corrections publiées</span>' : ''}</span></div>
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/admin/session/${id}/${k}" class="${k === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div id="tab"></div>`;
  const box = app.querySelector('#tab');
  if (tab === 'stations') return stationsTab(box, exam);
  if (tab === 'candidats') return candidatesTab(box, exam);
  if (tab === 'resultats') return resultsTab(box, exam);
  if (tab === 'reglages') return settingsTab(box, exam);
  box.innerHTML = '<p>Onglet inconnu.</p>';
}

async function stationsTab(box, exam) {
  const [stations, people] = await Promise.all([api(`/exams/${exam.id}/stations`), api('/people')]);
  const active = people.filter((p) => p.active);
  const sel = (name, value) => `<select data-f="${name}"><option value="">—</option>${active.map((p) =>
    `<option value="${p.id}" ${p.id === value ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  const counts = {};
  stations.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; });
  box.innerHTML = `
    <div class="row">${Object.entries(STATUSES).filter(([k]) => counts[k]).map(([k, l]) =>
      `<span class="badge s-${k}">${l} : ${counts[k]}</span>`).join(' ')}
      <span class="spacer"></span>
      <button id="codes" class="small">Codes des salles</button>
      <button id="add" class="small">Ajouter une station</button></div>
    ${active.length ? '' : '<p class="alert warn">Ajoute d\'abord des rédacteurs et relecteurs dans l\'onglet <a href="#/admin/personnes">Rédacteurs</a> pour pouvoir attribuer les stations.</p>'}
    <div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th>Station</th><th>Domaine et type</th><th>Titre</th><th>Rédacteur</th><th>Relecteur pair</th><th>Relecteur expert</th><th>Statut</th><th></th></tr></thead>
      <tbody>${stations.map((s) => `<tr data-id="${s.id}">
        <td><strong>${esc(s.slot)}</strong><br><label class="small row" style="font-weight:400;margin:2px 0">
          <input type="checkbox" data-f="played" ${s.played ? 'checked' : ''} style="width:auto"> jouée</label></td>
        <td><select data-f="domain"><option value="">—</option>${DOMAINS.map((d) => `<option ${d === s.domain ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
          <select data-f="type" style="margin-top:4px">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${esc(s.title || '')}<div class="small muted">${esc(s.discipline || '')}</div>
          ${s.n_comments ? `<div class="small muted">${s.n_comments} commentaire(s)</div>` : ''}</td>
        <td>${sel('author_id', s.author_id)}</td><td>${sel('peer_id', s.peer_id)}</td><td>${sel('expert_id', s.expert_id)}</td>
        <td><select data-f="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${s.n_evaluations ? `<div class="small muted">${s.n_evaluations} grille(s)</div>` : ''}</td>
        <td><a class="btn small" href="#/station/${s.id}">Ouvrir</a></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted">Attribuer un rédacteur fait passer la station en « Rédaction ». Le statut se modifie ici à la main si besoin ; sinon il avance avec le circuit de relecture.</p>
    <div id="codesbox"></div>`;

  box.querySelectorAll('tr[data-id] [data-f]').forEach((input) => input.addEventListener('change', async () => {
    const id = input.closest('tr').dataset.id;
    const f = input.dataset.f;
    const v = input.type === 'checkbox' ? (input.checked ? 1 : 0) : input.value;
    try {
      await api(`/stations/${id}`, { method: 'PATCH', body: { [f]: f.endsWith('_id') ? (v ? Number(v) : null) : v } });
      toast('Enregistré');
      if (f === 'author_id' || f === 'status') stationsTab(box, exam);
    } catch (err) { toast(err.message, 'error'); }
  }));
  box.querySelector('#add').addEventListener('click', async () => {
    const slot = prompt('Emplacement de la nouvelle station (ex. R3) :');
    if (!slot) return;
    try { await api(`/exams/${exam.id}/stations`, { method: 'POST', body: { slot } }); stationsTab(box, exam); } catch (err) { toast(err.message, 'error'); }
  });
  box.querySelector('#codes').addEventListener('click', () => {
    const played = stations.filter((s) => s.played);
    box.querySelector('#codesbox').innerHTML = `<div class="card">
      <div class="row between"><h3>Codes à afficher dans chaque salle</h3><button class="small" onclick="window.print()">Imprimer</button></div>
      <p class="small muted">L'évaluateur se connecte avec le code de sa salle et son nom, sur <strong>${esc(location.origin)}</strong> (onglet Évaluateur).
      Un code régénéré invalide l'ancien.</p>
      <table><thead><tr><th>Salle</th><th>Station</th><th>Code évaluateur</th><th class="no-print"></th></tr></thead><tbody>
      ${played.map((s) => `<tr><td><strong>${esc(s.slot)}</strong></td><td>${esc(s.title || s.domain || '')}</td>
        <td><span class="code" style="font-size:1.2rem">${esc(s.eval_code)}</span></td>
        <td class="no-print"><button class="small" data-regen="${s.id}">Nouveau code</button></td></tr>`).join('')}
      </tbody></table></div>`;
    box.querySelectorAll('[data-regen]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirmBox('Générer un nouveau code ? L\'ancien ne fonctionnera plus.')) return;
      await api(`/stations/${b.dataset.regen}`, { method: 'PATCH', body: { regen_code: true } });
      await stationsTab(box, exam);
      box.querySelector('#codes').click();
    }));
  });
}

// ---------- candidats ----------

const FIELDS = [
  ['last_name', 'Nom'], ['first_name', 'Prénom'], ['email', 'E-mail'], ['phone', 'Téléphone'],
  ['faculty', 'Faculté'], ['year', 'Année'], ['slot_label', 'Créneau (billetterie)'],
];
const GUESS = {
  last_name: /^nom( |$)|nom participant|last ?name/i, first_name: /pr[ée]nom/i, email: /e-?mail|courriel/i,
  phone: /t[ée]l[ée]phone|portable|phone/i, faculty: /facult|fac\b|universit/i, year: /ann[ée]e|niveau|promo/i,
  slot_label: /tarif|cr[ée]neau|formule|billet/i,
};

async function candidatesTab(box, exam) {
  const cands = await api(`/exams/${exam.id}/candidates`);
  const labels = {};
  cands.forEach((c) => { if (c.slot_label) { labels[c.slot_label] ??= { n: 0, day: c.day, series: c.series }; labels[c.slot_label].n++; } });
  const active = cands.filter((c) => c.status !== 'annule');
  const unplaced = active.filter((c) => !c.day || !c.series).length;

  box.innerHTML = `
    <div class="grid grid-4">
      <div class="stat"><div class="v">${active.length}</div><div class="l">inscrits</div></div>
      <div class="stat"><div class="v">${cands.length - active.length}</div><div class="l">annulés</div></div>
      <div class="stat"><div class="v">${unplaced}</div><div class="l">sans créneau</div></div>
      <div class="stat"><div class="v">${active.filter((c) => c.n_evaluations > 0).length}</div><div class="l">déjà évalués</div></div>
    </div>
    <details class="card" ${cands.length ? '' : 'open'}>
      <summary><strong>Importer les inscrits</strong> <span class="muted small">(export de la billetterie en CSV, ou copier-coller depuis un tableur)</span></summary>
      <input type="file" id="file" accept=".csv,.txt,.tsv" style="margin:10px 0">
      <textarea id="paste" placeholder="…ou colle ici les lignes du tableur, en-têtes compris" style="min-height:90px"></textarea>
      <div id="mapping"></div>
    </details>
    ${Object.keys(labels).length ? `<div class="card"><h3>Créneaux de la billetterie</h3>
      <p class="small muted">Associe chaque créneau à un jour et à une série, puis numérote. Les candidats d'une série sont numérotés de 01 à 10 :
      01 à 05 commencent par le circuit A, 06 à 10 par le circuit B.</p>
      <table><thead><tr><th>Créneau</th><th class="num">Inscrits</th><th>Jour</th><th>Série</th><th></th></tr></thead><tbody>
      ${Object.entries(labels).map(([l, v]) => `<tr data-label="${esc(l)}"><td>${esc(l)}</td><td class="num">${v.n}</td>
        <td><input type="date" value="${esc(v.day || '')}"></td>
        <td><select>${['', 1, 2, 3, 4].map((s) => `<option ${String(s) === String(v.series ?? '') ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="small" data-assign>Appliquer</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
    <div class="row" style="margin:12px 0">
      <button id="renumber">Numéroter les candidats</button>
      <button id="export">Exporter codes et liens (CSV)</button>
      <button id="add">Ajouter un candidat</button>
      <span class="spacer"></span>
      <input id="q" type="text" placeholder="Rechercher…" style="max-width:220px">
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>N°</th><th>Nom</th><th>Créneau</th><th>Contact</th><th>Code</th><th>Statut</th><th class="num">Grilles</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table></div>`;

  const drawRows = (q = '') => {
    const qq = q.toLowerCase();
    box.querySelector('#rows').innerHTML = cands.filter((c) => !qq || `${c.number} ${c.last_name} ${c.first_name} ${c.email}`.toLowerCase().includes(qq))
      .map((c) => `<tr data-id="${c.id}" ${c.status === 'annule' ? 'style="opacity:.55"' : ''}>
        <td><span class="code">${esc(c.number || '–')}</span></td>
        <td><strong>${esc(c.last_name)}</strong> ${esc(c.first_name)}<div class="small muted">${esc([c.faculty, c.year].filter(Boolean).join(' · '))}</div></td>
        <td>${c.day ? `${frDate(c.day)} · S${c.series ?? '?'}` : '<span class="badge warn">à placer</span>'}<div class="small muted">${esc(c.slot_label || '')}</div></td>
        <td class="small">${esc(c.email || '')}<br>${esc(c.phone || '')}</td>
        <td><span class="code">${esc(c.code)}</span></td>
        <td><select data-status><option value="inscrit" ${c.status === 'inscrit' ? 'selected' : ''}>Inscrit</option>
          <option value="annule" ${c.status === 'annule' ? 'selected' : ''}>Annulé</option></select></td>
        <td class="num">${c.n_evaluations}</td>
        <td class="row" style="gap:4px;flex-wrap:nowrap">
          <a class="btn small" href="#/admin/session/${exam.id}/candidat/${c.id}">Bulletin</a>
          <button class="small" data-copy title="Copier le lien personnel">Lien</button>
          <button class="small" data-edit title="Modifier le créneau">Créneau</button></td></tr>`).join('');
    box.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
      await api(`/candidates/${s.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: s.value } });
      toast('Statut enregistré. Pense à renuméroter.');
    }));
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const c = cands.find((x) => String(x.id) === b.closest('tr').dataset.id);
      await navigator.clipboard?.writeText(link('etudiant', c.code));
      toast('Lien copié');
    }));
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const c = cands.find((x) => String(x.id) === b.closest('tr').dataset.id);
      const day = prompt('Jour (AAAA-MM-JJ) :', c.day || exam.starts_on || '');
      if (day === null) return;
      const series = prompt('Série (1 à 4) :', c.series || '');
      if (series === null) return;
      await api(`/candidates/${c.id}`, { method: 'PATCH', body: { day, series: series ? Number(series) : null } });
      candidatesTab(box, exam);
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
    toast(`${r.numbered} candidat(s) numéroté(s)`);
    candidatesTab(box, exam);
  });
  box.querySelector('#export').addEventListener('click', () => {
    downloadCsv(`codes-${exam.id}.csv`, [['Numéro', 'Nom', 'Prénom', 'E-mail', 'Téléphone', 'Jour', 'Série', 'Code', 'Lien personnel'],
      ...active.map((c) => [c.number, c.last_name, c.first_name, c.email, c.phone, c.day, c.series, c.code, link('etudiant', c.code)])]);
  });
  box.querySelector('#add').addEventListener('click', async () => {
    const last = prompt('Nom :'); if (!last) return;
    const first = prompt('Prénom :') || '';
    const email = prompt('E-mail :') || '';
    await api(`/exams/${exam.id}/candidates`, { method: 'POST', body: { last_name: last, first_name: first, email } });
    candidatesTab(box, exam);
  });

  // Import : lecture puis correspondance des colonnes
  const onText = (text) => {
    const rows = parseTable(text);
    if (rows.length < 2) { box.querySelector('#mapping').innerHTML = '<p class="alert warn">Aucune ligne lue.</p>'; return; }
    const head = rows[0];
    const guess = (f) => head.findIndex((h) => GUESS[f].test(h.trim()));
    box.querySelector('#mapping').innerHTML = `
      <p class="small">${rows.length - 1} ligne(s) lue(s). Vérifie la correspondance des colonnes :</p>
      <div class="grid grid-4">${FIELDS.map(([f, l]) => `<div><label>${l}</label><select data-map="${f}"><option value="-1">—</option>
        ${head.map((h, i) => `<option value="${i}" ${i === guess(f) ? 'selected' : ''}>${esc(h || `Colonne ${i + 1}`)}</option>`).join('')}</select></div>`).join('')}</div>
      <p class="small muted">Les lignes dont le nom est vide sont ignorées. Les annulations se gèrent ensuite dans la colonne Statut.</p>
      <button class="primary" id="doimport">Importer ${rows.length - 1} inscrit(s)</button>`;
    box.querySelector('#doimport').addEventListener('click', async () => {
      const map = {};
      box.querySelectorAll('[data-map]').forEach((s) => { map[s.dataset.map] = Number(s.value); });
      if (map.last_name < 0) { toast('Choisis au moins la colonne du nom', 'error'); return; }
      const out = rows.slice(1).map((r) => Object.fromEntries(FIELDS.map(([f]) => [f, map[f] >= 0 ? (r[map[f]] || '').trim() : ''])));
      const res = await api(`/exams/${exam.id}/candidates`, { method: 'POST', body: { rows: out } });
      toast(`${res.imported} inscrit(s) importé(s)`);
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
    <div class="grid grid-4">
      <div class="stat"><div class="v">${R.completed}</div><div class="l">candidats classés (10 stations saisies)</div></div>
      <div class="stat"><div class="v">${R.total}</div><div class="l">inscrits</div></div>
      <div class="stat"><div class="v">${fmt(meanAll)}</div><div class="l">moyenne générale /20</div></div>
      <div class="stat"><div class="v">${R.stations.reduce((a, s) => a + s.n, 0)}</div><div class="l">grilles saisies</div></div>
    </div>
    <div class="row" style="margin:12px 0"><button id="refresh">Actualiser</button>
      <a class="btn" href="/api/exams/${exam.id}/results.csv">Exporter (CSV)</a>
      <span class="small muted">Le rang n'est calculé que pour les candidats dont les ${played.length} stations sont saisies.</span></div>
    <h2>Classement</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Rang</th><th>N°</th><th>Candidat</th><th class="num">Moyenne</th>
        ${played.map((s) => `<th class="num" title="${esc(s.title || '')}">${esc(s.slot)}</th>`).join('')}</tr></thead>
      <tbody>${R.rows.map((r) => `<tr class="clickable" data-id="${r.id}">
        <td>${r.rank ?? `<span class="small muted">${r.n}/${played.length}</span>`}</td><td><span class="code">${esc(r.number || '–')}</span></td>
        <td>${esc(r.name)}</td><td class="num"><strong>${fmt(r.avg)}</strong></td>
        ${played.map((s) => `<td class="num">${r.scores[s.id] === 'abs' ? 'abs' : fmt(r.scores[s.id], 1)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <h2>Qualité des stations</h2>
    <p class="small muted">Seuils d'alerte du guide : item réussi par moins de 10 % ou plus de 95 % des candidats, moyenne hors de 8 à 15, plus de 3 points d'écart entre évaluateurs.</p>
    ${R.stations.filter((s) => s.n > 0).map((s) => {
      const flag = s.mean !== null && (s.mean < 8 || s.mean > 15);
      const ev = s.evaluators.filter((e) => e.mean !== null);
      const gap = ev.length > 1 ? Math.max(...ev.map((e) => e.mean)) - Math.min(...ev.map((e) => e.mean)) : 0;
      return `<details class="card"><summary class="row"><strong>${esc(s.slot)} · ${esc(s.title || s.domain || '')}</strong>
        <span class="badge ${flag ? 'warn' : ''}">moyenne ${fmt(s.mean)}</span><span class="badge">n = ${s.n}</span>
        ${gap > 3 ? `<span class="badge warn">écart évaluateurs ${fmt(gap, 1)} pts</span>` : ''}</summary>
        <p class="small">Écart-type ${fmt(s.sd)} · min ${fmt(s.min)} · max ${fmt(s.max)}</p>
        <table><thead><tr><th>Indicateur</th><th class="num">Réussite</th></tr></thead><tbody>
        ${s.items.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${i.rate !== null && (i.rate < 0.1 || i.rate > 0.95) ? `<span class="badge warn">${pct(i.rate)}</span>` : pct(i.rate)}</td></tr>`).join('')}
        ${s.com.map((i) => `<tr><td><em>${esc(i.label)}</em></td><td class="num">${fmt(i.mean)} / 1</td></tr>`).join('')}
        </tbody></table>
        <h3>Note moyenne selon la performance globale</h3>
        <p class="small">${s.byGlobal.map((g) => `${g.level} : ${g.n ? `${fmt(g.mean, 1)} (n=${g.n})` : '–'}`).join(' · ')}</p>
        <h3>Par évaluateur</h3><p class="small">${ev.map((e) => `${esc(e.name)} : ${fmt(e.mean, 1)} (n=${e.n})`).join(' · ') || '–'}</p>
      </details>`;
    }).join('') || '<p class="muted">Aucune grille saisie pour l\'instant.</p>'}`;
  box.querySelector('#refresh').addEventListener('click', () => resultsTab(box, exam));
  box.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => {
    location.hash = `#/admin/session/${exam.id}/candidat/${tr.dataset.id}`;
  }));
}

// ---------- réglages ----------

async function settingsTab(box, exam) {
  const flag = (k, title, desc) => `<label class="card row" style="font-weight:400;align-items:flex-start;gap:12px;cursor:pointer">
    <input type="checkbox" data-k="${k}" ${exam[k] ? 'checked' : ''} style="width:auto;margin-top:4px">
    <span><strong>${title}</strong><br><span class="small muted">${desc}</span></span></label>`;
  box.innerHTML = `
    <form id="f" class="card grid grid-2">
      <div><label>Nom</label><input name="name" value="${esc(exam.name)}"></div>
      <div class="grid grid-2"><div><label>Premier jour</label><input type="date" name="starts_on" value="${esc(exam.starts_on || '')}"></div>
        <div><label>Dernier jour</label><input type="date" name="ends_on" value="${esc(exam.ends_on || '')}"></div></div>
      <div><button class="primary">Enregistrer</button></div>
    </form>
    ${flag('eval_open', 'Saisie des grilles ouverte', 'À ouvrir le matin du premier jour et à fermer après la dernière série. Fermée, aucun évaluateur ne peut enregistrer.')}
    ${flag('show_results', 'Les étudiants voient leurs notes et leur rang', 'Notes par station et rang provisoire, mis à jour en direct.')}
    ${flag('show_details', 'Les étudiants voient le détail des grilles', 'Items manqués, niveaux de communication et commentaires des évaluateurs. Attention : visible dès le premier week-end, donc avant que l\'autre moitié des candidats passe.')}
    ${flag('corrections_published', 'Corrections publiées', 'Fiches pédagogiques visibles par les étudiants. À activer après le dernier week-end.')}
    <div class="card"><h3>Supprimer la session</h3><p class="small muted">Possible seulement tant qu'aucune grille n'a été saisie.</p>
      <button class="danger" id="del">Supprimer</button></div>`;
  box.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api(`/exams/${exam.id}`, { method: 'PATCH', body: { name: f.get('name'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on') } });
    toast('Enregistré');
  });
  box.querySelectorAll('[data-k]').forEach((cb) => cb.addEventListener('change', async () => {
    await api(`/exams/${exam.id}`, { method: 'PATCH', body: { [cb.dataset.k]: cb.checked ? 1 : 0 } });
    exam[cb.dataset.k] = cb.checked ? 1 : 0;
    toast('Réglage enregistré');
  }));
  box.querySelector('#del').addEventListener('click', async () => {
    if (!confirmBox('Supprimer définitivement cette session, ses stations et ses inscrits ?')) return;
    try { await api(`/exams/${exam.id}`, { method: 'DELETE' }); location.hash = '#/admin'; } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------- rédacteurs et relecteurs ----------

export async function peopleView(app) {
  setTitle('Rédacteurs');
  const people = await api('/people');
  app.innerHTML = `
    <h1>Rédacteurs et relecteurs</h1>
    <p class="muted">Chaque personne reçoit un code personnel. Avec ce code, elle voit les stations qu'elle rédige ou relit, et seulement celles-là.</p>
    <div class="card"><h3>Ajouter des personnes</h3>
      <p class="small muted">Une personne par ligne : Nom ; e-mail ; spécialité (e-mail et spécialité facultatifs).</p>
      <textarea id="bulk" placeholder="Yasmine Benali ; yasmine@exemple.fr ; Cardiologie"></textarea>
      <button class="primary" id="addp" style="margin-top:8px">Ajouter</button></div>
    <div class="row"><button id="exp">Exporter codes et liens (CSV)</button></div>
    <div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th>Nom</th><th>Spécialité</th><th>Contact</th><th>Code</th><th class="num">Rédige</th><th class="num">Relit</th><th></th></tr></thead>
      <tbody>${people.map((p) => `<tr data-id="${p.id}" ${p.active ? '' : 'style="opacity:.5"'}>
        <td><strong>${esc(p.name)}</strong></td><td>${esc(p.specialty || '')}</td><td class="small">${esc(p.email || '')}</td>
        <td><span class="code">${esc(p.code)}</span></td><td class="num">${p.n_author}</td><td class="num">${p.n_review}</td>
        <td class="row" style="gap:4px;flex-wrap:nowrap"><button class="small" data-copy>Lien</button>
          <button class="small" data-regen>Nouveau code</button>
          <button class="small" data-active>${p.active ? 'Désactiver' : 'Réactiver'}</button></td></tr>`).join('')}</tbody>
    </table></div>`;
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
}
