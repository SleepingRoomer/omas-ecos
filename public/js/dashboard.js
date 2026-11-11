// Tableau de bord d'une session : ce qu'il reste à faire, et l'état de chaque chantier en un coup d'œil
import { api, esc, longDate } from './ui.js';

const LINKS = { systeme: '#/admin/systeme' };
const go = (exam, tab) => LINKS[tab] || `#/admin/session/${exam.id}/${tab}`;
const bar = (got, need) => `<span class="db-bar"><i style="width:${need ? Math.round(Math.min(1, got / need) * 100) : 0}%"></i></span>`;

export async function dashboardTab(box, exam) {
  const D = await api(`/exams/${exam.id}/dashboard`);
  const C = D.candidats; const S = D.stations; const M = D.materiel;
  const when = D.phase === 'sans-date' ? 'Pas encore de date'
    : D.phase === 'avant' ? (D.until === 1 ? 'C\'est demain' : `J-${D.until}`)
      : D.phase === 'pendant' ? 'En cours' : 'Terminée';
  const staffNeed = D.benevoles.reduce((a, b) => a + b.need, 0); const staffGot = D.benevoles.reduce((a, b) => a + b.got, 0);
  box.innerHTML = `
    <div class="db-head"><div class="db-when ${D.phase}">${esc(when)}</div>
      <p class="muted" style="margin:0">${D.first ? `${esc(longDate(D.first))}${D.last && D.last !== D.first ? ` au ${esc(longDate(D.last))}` : ''}` : 'Ajoute les jours dans l\'onglet Planning.'}</p></div>

    <div class="db-grid">
      <section class="panel db-todo"><h2 style="margin-top:0">À faire</h2>
        ${D.todo.length ? `<ul>${D.todo.map((t) => `<li class="${t.level}"><a href="${go(exam, t.tab)}">${esc(t.text)}</a></li>`).join('')}</ul>`
          : '<p class="db-done">Rien d\'urgent : tout est en ordre pour l\'instant.</p>'}
      </section>

      <div class="db-tiles">
        <a class="db-tile" href="${go(exam, 'candidats')}"><span class="l">Candidats</span><b>${C.places_occupees}<small> / ${C.places} places</small></b>${bar(C.places_occupees, C.places)}
          <span class="s">${C.inscrits} inscrits${C.sans_creneau ? `, ${C.sans_creneau} sans créneau` : ''}${C.attente ? `, ${C.attente} en attente` : ''}</span></a>
        <a class="db-tile" href="${go(exam, 'planning')}"><span class="l">Venue confirmée</span><b>${C.confirmes}<small> / ${C.places_occupees}</small></b>${bar(C.confirmes, C.places_occupees)}
          <span class="s">${C.convocations_a_envoyer ? `${C.convocations_a_envoyer} convocation${C.convocations_a_envoyer > 1 ? 's' : ''} à envoyer` : 'Convocations envoyées'}</span></a>
        <a class="db-tile" href="${go(exam, 'stations')}"><span class="l">Stations validées</span><b>${S.validees}<small> / ${S.jouees}</small></b>${bar(S.validees, S.jouees)}
          <span class="s">${S.en_retard.length ? `En retard : ${S.en_retard.map(esc).join(', ')}` : 'Aucun retard de rédaction'}</span></a>
        <a class="db-tile" href="${go(exam, 'benevoles')}"><span class="l">Postes pourvus</span><b>${staffGot}<small> / ${staffNeed}</small></b>${bar(staffGot, staffNeed)}
          <span class="s">Évaluateurs, PS et PSS, réserve</span></a>
        <a class="db-tile" href="${go(exam, 'materiel')}"><span class="l">Impressions</span><b>${M.impressions}<small> / ${M.impressions_total}</small></b>${bar(M.impressions, M.impressions_total)}
          <span class="s">Salles prêtes : ${M.salles_pretes} / ${M.salles}</span></a>
        ${D.phase === 'pendant' || D.phase === 'apres' ? `<a class="db-tile" href="${go(exam, 'direct')}"><span class="l">${D.phase === 'pendant' ? 'Présents aujourd\'hui' : 'Grilles saisies'}</span>
          <b>${D.phase === 'pendant' ? `${C.presents_aujourdhui}<small> / ${C.attendus_aujourdhui}</small>` : D.grilles}</b>${D.phase === 'pendant' ? bar(C.presents_aujourdhui, C.attendus_aujourdhui) : ''}
          <span class="s">${D.grilles} grille${D.grilles > 1 ? 's' : ''} saisie${D.grilles > 1 ? 's' : ''}</span></a>` : ''}
      </div>
    </div>

    ${D.benevoles.length ? `<h2>Équipe de chaque demi-journée</h2>
    <div class="table-wrap"><table><thead><tr><th>Demi-journée</th><th>Salles</th><th>PS / PSS de réserve</th><th>Chrono</th><th>Accueil et logistique</th><th class="num">Disponibles</th></tr></thead><tbody>
      ${D.benevoles.map((b) => `<tr><td><strong>${esc(b.label)}</strong></td>
        <td><div class="row" style="gap:8px;flex-wrap:nowrap">${bar(b.got, b.need)}<span class="small">${b.got} / ${b.need}</span></div>${b.missing.length ? `<div class="small" style="color:#b9770e">À pourvoir : ${b.missing.map(esc).join(', ')}</div>` : ''}</td>
        <td>${!b.need_reserve ? '<span class="small muted">Pas de station avec PS</span>' : b.reserve ? `<span class="pill ok">${b.reserve} en réserve</span>` : '<span class="pill warn">Manquant</span>'}</td>
        <td>${b.chrono ? '<span class="pill ok">Oui</span>' : '<span class="pill warn">Personne</span>'}</td>
        <td>${b.accueil ? `<span class="pill ok">${b.accueil}</span>` : '<span class="pill warn">Personne</span>'}</td>
        <td class="num">${b.dispo}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Pour modifier : onglet <a href="${go(exam, 'benevoles')}">Bénévoles</a>, planning des salles.</p>` : ''}`;
}
