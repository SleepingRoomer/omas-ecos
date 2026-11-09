// Matériel des ECOS : par station, et la liste totale à préparer, avec une check-list pour l'installation de la veille
import { api, esc, plate, longDate, downloadCsv, toast } from './ui.js';

const MARGE = 1.1; // 10 % de consommables en plus, pour les gants déchirés et les imprévus

// Matériel commun proposé par défaut : à adapter, il s'enregistre avec la session
export const COMMON = [
  ['Accueil', 'Table et chaises pour l\'émargement', '1'], ['Accueil', 'Téléphone des organisateurs connecté à INES (scan des QR codes)', '2'],
  ['Accueil', 'Étiquettes des candidats, rangées par série', '1 planche par série'], ['Accueil', 'Planning des séries imprimé (secours)', '1 par série'],
  ['Accueil', 'Stylos', '10'], ['Accueil', 'Petit déjeuner : café, thé, eau, jus, viennoiseries', 'selon les inscrits du matin'],
  ['Accueil', 'Gobelets, serviettes, sacs poubelle', ''], ['Accueil', 'Signalétique (Accueil, Salle d\'attente, Circuits, Débrief)', '1 jeu'],
  ['Salles', 'Vignette sur la porte et sur la table', '2 par salle'], ['Salles', 'Fiche « code de salle » remise à l\'évaluateur', '1 par salle'],
  ['Salles', 'Grilles papier de secours', '10 par salle et par demi-journée'], ['Salles', 'Stylos', '2 par salle'],
  ['Salles', 'Solution hydroalcoolique', '1 par salle'], ['Salles', 'Boîte de gants (S, M, L)', '1 par salle d\'examen ou de procédure'],
  ['Salles', 'Mouchoirs et bouteille d\'eau pour le PS', '1 par salle avec PS'], ['Salles', 'Patafix ou scotch pour les vignettes', '1'],
  ['Salles', 'Tablette chargée (vidéo ou imagerie à montrer)', '1 par station qui en a besoin'], ['Salles', 'Boîte de gâteaux pour l\'évaluateur', '1 par salle et par demi-journée'],
  ['Organisateurs', 'Chronomètre ou sonnerie commune audible dans les salles', '1'], ['Organisateurs', 'Multiprises et chargeurs de téléphone', '3'],
  ['Organisateurs', 'Ordinateur avec INES ouvert (En direct)', '1'], ['Organisateurs', 'Trousse de premiers secours', '1'],
  ['Organisateurs', 'Codes des salles de rechange et liste des téléphones des bénévoles', '1'], ['Organisateurs', 'Écran à l\'accueil (mode projection d\'INES)', '1'], ['Débrief', 'Vidéoprojecteur', 'si besoin'],
];

export async function materielTab(box, exam) {
  const M = await api(`/exams/${exam.id}/materiel`);
  const total = Object.values(M.perDay).reduce((a, b) => a + b, 0);
  const days = M.days.length ? M.days : Object.keys(M.perDay).filter(Boolean);
  // liste consolidée : un article installé dans plusieurs salles s'additionne
  const agg = new Map();
  for (const s of M.stations) for (const m of s.liste) {
    const k = m.article.trim().toLowerCase();
    const a = agg.get(k) || { article: m.article.trim(), installe: 0, conso: 0, slots: [] };
    a.installe += Number(m.installe) || 0;
    a.conso += (Number(m.par_candidat) || 0);
    a.slots.push(s.slot);
    agg.set(k, a);
  }
  const rows = [...agg.values()].sort((a, b) => a.article.localeCompare(b.article, 'fr'));
  const need = (a, n) => Math.ceil(a.conso * n * MARGE);
  const check = (key, label) => `<label class="check mat-check"><input type="checkbox" data-key="${esc(key)}" ${M.checks[key] ? 'checked' : ''}><span>${label}</span></label>`;
  const empty = M.stations.filter((s) => !s.liste.length);
  let common = (M.common || COMMON.map(([zone, article, qte]) => ({ zone, article, qte })));
  const prints = [
    ['Étiquettes des candidats', `${M.n_candidates} étiquettes, une planche par série`, 'etiquettes'],
    ['Vignettes de porte', `${M.n_stations * 2} pages : porte et table de chaque salle`, 'imprimer-vignettes'],
    ['Fiches « code de salle »', `${M.n_stations} fiches, remises aux évaluateurs (jamais sur la porte)`, 'affiches'],
    ['Grilles papier de secours', `1 par station, à photocopier : 10 par salle et par demi-journée`, 'imprimer-grilles'],
    ['Documents des stations', 'ECG, radios, bilans remis aux candidats', 'imprimer-documents'],
    ['Planning des séries', `${M.n_series} pages, à afficher à l'accueil et dans le couloir`, 'planning-imprimer'],
    ['Signalétique', '7 panneaux A4 : accueil, salle d\'attente, circuits, débrief', 'imprimer-signaletique'],
  ];
  const draw = () => {
    const zones = [...new Set(common.map((x) => x.zone))];
    box.innerHTML = `
      <h2 style="margin-top:0">À imprimer</h2>
      <p class="small muted">Tout ce qu'il faut imprimer pour la session, avec les quantités. Chaque lien ouvre une page prête à imprimer ; coche quand c'est fait.</p>
      <div class="table-wrap"><table><thead><tr><th>Quoi</th><th>Combien</th><th></th><th>Fait</th></tr></thead><tbody>
        ${prints.map(([t, q, tab]) => `<tr><td><strong>${esc(t)}</strong></td><td class="small">${esc(q)}</td><td><a class="btn small" href="#/admin/session/${exam.id}/${tab}" target="_blank">Ouvrir</a></td>
          <td>${check(`print|${tab}`, '')}</td></tr>`).join('')}</tbody></table></div>
      <h2>Matériel commun</h2>
      <p class="small muted">Ce qui ne dépend pas des stations : accueil, salles, organisateurs, débrief. Une proposition à adapter : modifie, ajoute, puis enregistre.</p>
      <div class="mat-zones">${zones.map((z) => `<div class="panel"><strong>${esc(z)}</strong>
        ${common.map((x, i) => (x.zone === z ? `<div class="mat-common">${check(`commun|${x.article.toLowerCase()}`, '')}<input data-ci="${i}" data-f="article" value="${esc(x.article)}" aria-label="Article">
          <input data-ci="${i}" data-f="qte" value="${esc(x.qte)}" placeholder="Quantité" aria-label="Quantité"><button class="small quiet" data-crm="${i}" aria-label="Retirer">✕</button></div>` : '')).join('')}
        <button class="small quiet" data-cadd="${esc(z)}">Ajouter</button></div>`).join('')}</div>
      <div class="row" style="margin:6px 0 24px"><button class="small primary" id="c-save">Enregistrer le matériel commun</button>
        ${M.common ? '<button class="small quiet" id="c-reset">Revenir à la liste proposée</button>' : '<span class="small muted">Liste proposée, pas encore enregistrée pour cette session.</span>'}</div>
      <h2>Matériel des stations</h2>`;
    box.insertAdjacentHTML('beforeend', `
      <div class="facts"><div><div class="v">${rows.length}</div><div class="l">articles différents</div></div>
        <div><div class="v">${total}</div><div class="l">candidats sur la session</div></div>
        <div><div class="v">${Object.keys(M.checks).length}</div><div class="l">cases cochées</div></div></div>
      ${empty.length ? `<p class="alert warn">${empty.map((s) => plate(s.slot, 'sm')).join(' ')} ${empty.length > 1 ? 'n\'ont' : 'n\'a'} pas encore de liste de matériel : à compléter dans la fiche de la station.</p>` : ''}
      <div class="row" style="margin:0 0 10px"><button class="small" id="mat-csv">Exporter la liste totale</button><button class="small quiet" data-print>Imprimer</button>
        <span class="small muted">Consommables : quantité par candidat × nombre de candidats, plus 10 %.</span></div>
      <h2>À commander ou à rassembler</h2>
      <div class="table-wrap"><table><thead><tr><th>Article</th><th class="num">Installé</th><th class="num">Consommé, total</th>
        ${days.map((d) => `<th class="num">${esc(longDate(d).split(' ').slice(0, 2).join(' '))}</th>`).join('')}<th>Stations</th><th>Prêt</th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td><strong>${esc(a.article)}</strong></td><td class="num">${a.installe || ''}</td><td class="num">${a.conso ? need(a, total) : ''}</td>
          ${days.map((d) => `<td class="num">${a.conso ? need(a, M.perDay[d] || 0) : ''}</td>`).join('')}
          <td>${[...new Set(a.slots)].map((s) => plate(s, 'sm')).join(' ')}</td><td>${check(`total|${a.article.toLowerCase()}`, '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun matériel renseigné.</td></tr>'}
      </tbody></table></div>
      <h2>Installation de la veille, salle par salle</h2>
      <div class="mat-rooms">${M.stations.map((s) => `<div class="panel mat-room"><div class="row" style="margin-bottom:6px">${plate(s.slot)}<strong>${esc(s.title || '')}</strong></div>
        ${s.liste.map((m) => check(`${s.slot}|${m.article.toLowerCase()}`, `${esc(m.article)}${Number(m.installe) ? ` <span class="muted">× ${m.installe}</span>` : ''}`)).join('') || '<p class="small muted">Rien de renseigné.</p>'}
        ${s.disposition ? `<p class="small muted" style="margin-bottom:0">${esc(s.disposition)}</p>` : ''}
        ${check(`${s.slot}|__salle`, '<strong>Salle prête</strong>')}</div>`).join('')}</div>`);
    const readCommon = () => { box.querySelectorAll('[data-ci]').forEach((inp) => { common[Number(inp.dataset.ci)][inp.dataset.f] = inp.value; }); };
    box.querySelectorAll('[data-crm]').forEach((b) => b.addEventListener('click', () => { readCommon(); common.splice(Number(b.dataset.crm), 1); draw(); }));
    box.querySelectorAll('[data-cadd]').forEach((b) => b.addEventListener('click', () => { readCommon(); common.push({ zone: b.dataset.cadd, article: '', qte: '' }); draw(); box.querySelector(`[data-ci="${common.length - 1}"]`)?.focus(); }));
    box.querySelector('#c-save').addEventListener('click', async () => {
      readCommon();
      try { await api(`/exams/${exam.id}/materiel-common`, { method: 'PUT', body: { items: common } }); M.common = common.filter((x) => x.article.trim()); common = [...M.common]; draw(); toast('Matériel commun enregistré'); } catch (err) { toast(err.message, 'error'); }
    });
    box.querySelector('#c-reset')?.addEventListener('click', () => { common = COMMON.map(([zone, article, qte]) => ({ zone, article, qte })); draw(); toast('Liste proposée rétablie : enregistre pour la garder'); });
    box.querySelectorAll('[data-key]').forEach((cb) => cb.addEventListener('change', async () => {
      try { await api(`/exams/${exam.id}/materiel-check`, { method: 'PUT', body: { key: cb.dataset.key, done: cb.checked } }); if (cb.checked) M.checks[cb.dataset.key] = true; else delete M.checks[cb.dataset.key]; }
      catch { cb.checked = !cb.checked; }
    }));
    box.querySelector('#mat-csv').addEventListener('click', () => downloadCsv(`materiel-${exam.id}.csv`, [
      ['Article', 'Installé', 'Consommé, total', ...days, 'Stations'],
      ...rows.map((a) => [a.article, a.installe, a.conso ? need(a, total) : '', ...days.map((d) => (a.conso ? need(a, M.perDay[d] || 0) : '')), [...new Set(a.slots)].join(' ')]),
    ]));
  };
  draw();
}
