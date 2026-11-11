// Tout ce qu'il faut imprimer pour une session, au même endroit : vignettes de porte, grilles papier de secours,
// documents des stations et signalétique, toutes stations d'un coup (les autres impressions ont déjà leur page).
import { api, esc, setTitle, plate } from './ui.js';
import { vignetteHtml, paperGrid } from './editor.js';

const KINDS = {
  vignettes: { title: 'Vignettes de porte', help: 'Deux exemplaires par station : un sur la porte, un sur la table du candidat. Format national : A4 paysage.' },
  grilles: { title: 'Grilles papier de secours', help: 'À garder dans chaque salle si un téléphone tombe en panne. La grille saisie ensuite dans INES fait foi.' },
  documents: { title: 'Documents des stations', help: 'Ce que le PS ou l\'évaluateur remet au candidat (ECG, radio, bilan…). Les PDF joints s\'impriment depuis leur propre fenêtre.' },
  signaletique: { title: 'Signalétique', help: 'Des panneaux A4 pour guider les candidats et les bénévoles dans les locaux.' },
};
const SIGNS = [['Accueil', 'ECOS blancs, émargement et petit déjeuner'], ['Salle d\'attente', 'Téléphones rangés, on ne parle pas des stations'], ['Circuit A', 'Stations A1 à A5'],
  ['Circuit B', 'Stations B1 à B5'], ['Débrief', 'Correction des stations avec les évaluateurs'], ['Organisateurs', 'Une question ? C\'est ici'], ['Silence', 'Station en cours']];

export async function printView(app, exam, kind) {
  const K = KINDS[kind] || KINDS.vignettes;
  setTitle(`${K.title}, ${exam.name}`);
  const bar = (n) => `<div class="no-print" style="margin-bottom:12px"><a class="back" href="#/admin/session/${exam.id}/materiel">Matériel et impressions</a>
    <h1>${esc(K.title)}</h1><p class="lede">${esc(K.help)}</p>
    <div class="row"><button class="primary" data-print>Imprimer${n ? ` (${n} page${n > 1 ? 's' : ''})` : ''}</button></div></div>`;
  if (kind === 'signaletique') {
    app.innerHTML = `${bar(SIGNS.length)}${SIGNS.map(([t, s]) => `<div class="sheet landscape sign-sheet"><div class="sign-big">${esc(t)}</div><div class="sign-sub">${esc(s)}</div>
      <img src="/img/ines-logo-flat.svg" alt="INES" class="sign-logo"></div>`).join('')}`;
    return;
  }
  const list = (await api(`/exams/${exam.id}/stations`)).filter((s) => s.played).sort((a, b) => a.slot.localeCompare(b.slot));
  const full = await Promise.all(list.map((s) => api(`/stations/${s.id}`).then((d) => ({ st: d.station, c: d.content })).catch(() => null)));
  const ok = full.filter(Boolean);
  let pages = '';
  if (kind === 'vignettes') pages = ok.map(({ st, c }) => `<div class="sheet landscape">${vignetteHtml(st, c)}</div><div class="sheet landscape">${vignetteHtml(st, c)}</div>`).join('');
  if (kind === 'grilles') pages = ok.map(({ st, c }) => `<div class="sheet portrait">${paperGrid(st, c)}</div>`).join('');
  if (kind === 'documents') {
    pages = ok.flatMap(({ st, c }) => c.documents.filter((d) => d.nom || d.file_id).map((d) => `<div class="sheet portrait doc-sheet">
      <div class="print-head"><span>Station ${esc(st.slot)}</span><span>${esc(d.remis_par || '')}</span></div><h2>${esc(d.nom || '')}</h2>
      ${d.file_id && /^image\//.test(d.file_mime || '') ? `<img src="/api/files/${d.file_id}" alt="${esc(d.nom || '')}">`
        : d.file_id ? `<p class="no-print"><a href="/api/files/${d.file_id}" target="_blank" rel="noopener">Ouvrir le PDF de ${esc(st.slot)} pour l'imprimer</a></p>` : '<p class="muted">Document décrit, sans fichier joint : à préparer à part.</p>'}</div>`)).join('');
    if (!pages) pages = '<p class="panel">Aucune station n\'a de document à remettre.</p>';
  }
  const n = (pages.match(/class="sheet/g) || []).length;
  app.innerHTML = `${bar(n)}${ok.length < list.length ? `<p class="alert warn no-print">${list.length - ok.length} station(s) n'ont pas pu être chargées.</p>` : ''}
    ${ok.length ? '' : '<p class="panel">Aucune station jouée.</p>'}${pages}`;
  void plate;
}
