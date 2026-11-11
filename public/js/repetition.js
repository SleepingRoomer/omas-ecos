// Panneau « Répétition avec des données fictives » (onglet Réglages) : de quoi dérouler une session de A à Z
// sans un seul vrai étudiant. Tout ce qui est fictif a une adresse en @exemple.org, vers laquelle rien ne part.
import { api, esc, toast, longDate, downloadCsv } from './ui.js';

const FIRST = ['Amina', 'Yanis', 'Sarah', 'Ilyes', 'Inès', 'Rayan', 'Maryam', 'Adam', 'Lina', 'Bilal', 'Nour', 'Sofiane', 'Hajar', 'Mehdi', 'Salma', 'Karim', 'Aïcha', 'Hugo', 'Léa', 'Ismaël'];
const LAST = ['Benali', 'Diallo', 'Haddad', 'Martin', 'Cherif', 'Traoré', 'Bouzid', 'Lefèvre', 'Mansouri', 'Kaci', 'Ndiaye', 'Rahmani', 'Garnier', 'Toumi', 'Fontaine', 'Saidi'];
const FAC = ['Sorbonne Université', 'Université Paris Cité', 'Paris-Saclay', 'UPEC', 'UVSQ', 'Sorbonne Paris Nord'];
const PREPA = ['Aucune', 'Tutorat de la fac', 'Prépa privée', 'Aucune', 'Tutorat de la fac'];
const strip = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

// Export « façon HelloAsso » : participant et payeur, tarif et montant, statut de la commande, questions du formulaire
export function helloassoRows(n = 60, from = 0, refunds = []) {
  const head = ['Référence commande', 'Date de la commande', 'Statut de la commande', 'Nom payeur', 'Prénom payeur', 'Email payeur', 'Tarif', 'Montant tarif',
    'Nom', 'Prénom', 'Email', 'Téléphone', 'Faculté', 'Année d\'études', 'Préparation', 'Besoin particulier', 'Comment as-tu connu les ECOS blancs ?'];
  const rows = [head];
  for (let k = from; k < from + n; k++) {
    const f = FIRST[k % FIRST.length]; const l = LAST[(k * 7) % LAST.length];
    const payerIsOther = k % 9 === 4; // de temps en temps, un parent ou un ami a payé : le payeur n'est pas le participant
    const adh = k % 4 !== 3;
    rows.push([`HA-${String(100000 + k * 37)}`, `0${1 + (k % 9)}/10/2026 ${10 + (k % 12)}:${String((k * 13) % 60).padStart(2, '0')}`,
      refunds.includes(k) ? 'Remboursé' : 'Validé',
      payerIsOther ? LAST[(k + 3) % LAST.length] : l, payerIsOther ? 'Karima' : f,
      payerIsOther ? `parent.${k}@exemple.org` : `${strip(f)}.${strip(l)}.${k}@exemple.org`,
      adh ? 'Adhérent OMAS' : 'Non adhérent', adh ? '15,00' : '25,00',
      l, f, `${strip(f)}.${strip(l)}.${k}@exemple.org`, `06 00 00 ${String(k).padStart(2, '0').slice(-2)} ${String(k * 3).padStart(2, '0').slice(-2)}`,
      FAC[k % FAC.length], ['DFASM1', 'DFASM2', 'DFASM2', 'DFASM3'][k % 4], PREPA[k % PREPA.length],
      k % 23 === 5 ? 'Je me déplace en fauteuil roulant' : k % 7 === 0 ? 'Non' : '', ['Instagram', 'Bouche-à-oreille', 'Tutorat', 'Instagram'][k % 4]]);
  }
  return rows;
}

export async function rehearsalPanel(box, exam, reload) {
  const D = await api(`/exams/${exam.id}/demo`).catch(() => null);
  if (!D) { box.innerHTML = ''; return; }
  let days = [];
  try { days = (JSON.parse(exam.planning || 'null')?.days || []).map((d) => d.date); } catch { /* pas de planning */ }
  const any = D.candidates + D.volunteers + D.people + D.stations;
  box.innerHTML = `<details class="panel" ${any ? 'open' : ''}><summary style="cursor:pointer"><strong>Répétition avec des données fictives</strong>
      <span class="small muted">${any ? `${D.stations} station(s) d'exemple, ${D.candidates} candidat(s), ${D.volunteers} bénévole(s), ${D.grids} grille(s) fictifs` : 'pour tester une session de A à Z'}</span></summary>
    <p class="small muted">Tout ce qui est créé ici porte une adresse en <code>@exemple.org</code> : aucun e-mail ne part vers ces adresses, et un clic suffit pour tout retirer. Le plus simple : faire la répétition dans une session à part (« Répétition décembre »), puis supprimer la session à la fin. Le déroulé pas à pas est dans le guide de répétition.</p>
    <ol class="rep-steps">
      <li><strong>Stations</strong> : remplit les emplacements vides avec dix stations d'exemple (et deux réserves encore dans le circuit de relecture), avec des rédacteurs fictifs.
        <button class="small" data-rep="stations">Ajouter les stations d'exemple</button></li>
      <li><strong>Inscrits</strong> : télécharge un export HelloAsso fictif, puis importe-le dans l'onglet Candidats. Le second fichier sert à tester le réimport (5 nouveaux, 3 remboursés).
        <button class="small" data-csv="1">Export HelloAsso (60 inscrits)</button> <button class="small quiet" data-csv="2">Second export (réimport)</button></li>
      <li><strong>Bénévoles et évaluateurs</strong> : 14 évaluateurs, 8 PS, PSS et bénévoles de logistique, inscrits sur toutes les demi-journées. Ensuite, onglet Bénévoles, « Compléter automatiquement ».
        <button class="small" data-rep="volunteers">Ajouter les bénévoles fictifs</button></li>
      <li><strong>Jour J</strong> : simule les grilles des candidats fictifs d'un jour, avec le nom des évaluateurs affectés aux salles s'il y en a.
        ${days.length ? `<select id="rep-day" style="width:auto" aria-label="Jour">${days.map((d) => `<option value="${d}">${esc(longDate(d))}</option>`).join('')}</select>
        <select id="rep-ser" style="width:auto" aria-label="Série"><option value="">Toutes les séries</option>${[1, 2, 3, 4].map((n) => `<option value="${n}">Série ${n}</option>`).join('')}</select>
        <button class="small" data-rep="grids">Simuler les grilles</button>` : '<span class="small muted">Règle d\'abord les jours de la session.</span>'}</li>
    </ol>
    <div class="row"><button class="small danger" data-rep="clean" ${any || D.grids ? '' : 'disabled'}>Tout retirer (données fictives)</button>
      <span class="small muted">Retire les candidats, bénévoles, rédacteurs et grilles fictifs, et vide les stations d'exemple qui n'ont pas de vraies grilles.</span></div></details>`;
  const go = async (what) => {
    try {
      if (what === 'stations') { const r = await api(`/exams/${exam.id}/demo/stations`, { method: 'POST' }); toast(r.filled ? `${r.filled} station(s) d'exemple ajoutée(s)` : 'Aucun emplacement vide à remplir'); }
      if (what === 'volunteers') { const r = await api(`/exams/${exam.id}/demo/volunteers`, { method: 'POST' }); toast(`${r.added} bénévole(s) fictif(s) inscrit(s)`); }
      if (what === 'grids') {
        const r = await api(`/exams/${exam.id}/demo/grids`, { method: 'POST', body: { day: box.querySelector('#rep-day').value, series: box.querySelector('#rep-ser').value || null } });
        toast(`${r.grids} grille(s) simulée(s) pour ${r.candidates} candidat(s)`);
      }
      if (what === 'clean') {
        if (!window.confirm('Retirer toutes les données fictives de cette session (et les bénévoles et rédacteurs fictifs) ? Les vraies données ne sont pas touchées.')) return;
        await api(`/exams/${exam.id}/demo`, { method: 'DELETE' }); toast('Données fictives retirées');
      }
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  box.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => go(b.dataset.rep)));
  box.querySelectorAll('[data-csv]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.csv === '1') downloadCsv('helloasso-fictif.csv', helloassoRows(60, 0));
    // second export : les 60 mêmes (dont 3 remboursés) et 5 nouveaux, comme un export refait une semaine plus tard
    else downloadCsv('helloasso-fictif-2.csv', helloassoRows(65, 0, [3, 17, 42]));
    toast('Fichier téléchargé : dépose-le dans l\'onglet Candidats, « Importer les inscrits »');
  }));
}
