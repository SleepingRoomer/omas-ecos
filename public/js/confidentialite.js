// Page publique « Données personnelles » : ce qu'INES garde, pourquoi, combien de temps, et comment exercer ses droits
import { api, esc, setTitle } from './ui.js';

export async function privacyView(app) {
  setTitle('Données personnelles');
  const P = await api('/public/privacy').catch(() => ({ volunteer_years: 3, mail_log_months: 12, waitlist_days: 60, anonymize_months: 6, contact: null }));
  const contact = P.contact ? `<a href="mailto:${esc(P.contact)}">${esc(P.contact)}</a> (${esc(P.contact)})` : 'l\'adresse qui envoie les e-mails d\'INES (il suffit de répondre à l\'un d\'eux)';
  app.innerHTML = `<div class="narrow" style="max-width:760px">
    <h1>Données personnelles</h1>
    <p class="lede">INES est la plateforme des ECOS blancs et des journées procédure d'OMAS Externat, association sans but lucratif. Voici ce qu'elle garde sur toi, à quoi ça sert et pendant combien de temps.</p>

    <h2>Qui est responsable</h2>
    <p>OMAS Externat, au sein de l'OMAS (Organisation Musulmane des Acteurs de Santé). Pour toute question ou demande : ${contact}.</p>

    <h2>Ce qu'on garde, et pourquoi</h2>
    <div class="table-wrap"><table><thead><tr><th>Qui</th><th>Données</th><th>À quoi elles servent</th></tr></thead><tbody>
      <tr><td><strong>Étudiants</strong></td><td>Nom, prénom, e-mail, téléphone, faculté, année, tarif, préparation, créneau et vœux, présence le jour J, grilles d'évaluation et notes, réclamations</td>
        <td>Organiser la session (convocation, rappel, échanges de créneau, liste d'attente), noter les stations, te donner tes résultats, ton plan de révision et ta progression d'une session à l'autre</td></tr>
      <tr><td><strong>Évaluateurs et bénévoles</strong></td><td>Nom, prénom, e-mail, téléphone, statut, spécialité, disponibilités, disciplines préférées, affectations, calibration, grilles saisies</td>
        <td>Construire le planning des salles, te rappeler ta venue, te remettre une attestation, te recontacter pour les sessions suivantes</td></tr>
      <tr><td><strong>Rédacteurs et relecteurs</strong></td><td>Nom, e-mail, spécialité, stations suivies</td><td>Le circuit de rédaction et ses relances</td></tr>
    </tbody></table></div>
    <p class="small muted">La base légale est l'exécution de ton inscription (contrat) et, pour les recontacts et les statistiques, l'intérêt légitime de l'association. Aucune donnée n'est vendue ni utilisée pour de la publicité. Aucune donnée de santé n'est demandée, en dehors d'un éventuel besoin d'accès aux salles que tu choisis de signaler.</p>

    <h2>Combien de temps</h2>
    <ul>
      <li><strong>Étudiants</strong> : jusqu'à l'anonymisation de la session, au plus tard ${esc(P.anonymize_months)} mois après sa fin en pratique. Ton nom, ton e-mail, ton téléphone, les commentaires des évaluateurs et tes réclamations sont alors effacés. Les notes restent, sans ton nom, pour les statistiques de l'association. Une empreinte chiffrée de ton e-mail est gardée : elle ne permet pas de retrouver l'adresse, mais elle permet de te montrer ta progression si tu reviens à une autre session avec la même adresse.</li>
      <li><strong>Liste d'attente</strong> : supprimée ${esc(P.waitlist_days)} jours après la fin de la session.</li>
      <li><strong>Évaluateurs et bénévoles</strong> : ${esc(P.volunteer_years)} ans après ta dernière participation. Ensuite, nom et coordonnées sont effacés automatiquement.</li>
      <li><strong>Journal des e-mails envoyés</strong> : les adresses y sont effacées au bout de ${esc(P.mail_log_months)} mois.</li>
      <li><strong>Connexions</strong> : une connexion expire au bout de 30 jours au plus, puis est supprimée.</li>
    </ul>

    <h2>Où sont les données</h2>
    <p>Chez Cloudflare (hébergement et base de données) et Brevo (envoi des e-mails, entreprise française). Seule l'équipe d'organisation a accès à l'espace d'administration, chacun avec son propre code, et les actions sensibles (exports, suppressions, anonymisations) sont journalisées.</p>

    <h2>Tes droits</h2>
    <p>Tu peux demander à consulter, corriger ou effacer tes données, ou t'opposer à ce qu'on te recontacte, en écrivant à ${contact}. On te répond dans le mois. Si la réponse ne te convient pas, tu peux saisir la CNIL (cnil.fr).</p>
    <p class="small muted">Les grilles d'une session en cours ne peuvent pas être effacées avant la publication des résultats : elles servent aussi au classement des autres candidats.</p>
  </div>`;
}
