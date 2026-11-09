# INES : consignes pour travailler sur ce dépôt

INES (Interface numérique d'ECOS et de simulation) est la plateforme des ECOS blancs et des journées procédure d'OMAS Externat. Elle est en ligne et sert à de vrais étudiants : toute modification de `main` part en production.

## Conventions
- Réponses en français, tutoiement, style naturel, **jamais de tirets cadratins**.
- Commits avec l'auteur « OMAS » : `git -c user.name="OMAS" -c user.email="omas@users.noreply.github.com" commit`.
- Données personnelles (noms, e-mails, notes, codes) : jamais dans le dépôt, jamais dans une capture partagée. Pour les démonstrations, utiliser `scripts/demo` (données fictives, en local seulement).
- Pour un changement visible ou risqué : une branche, puis une pull request. La fusion dans `main` déploie. Après un push sur `main`, vérifier le déploiement : `gh api repos/SleepingRoomer/omas-ecos/commits/<sha>/check-runs` (contrôle « Workers Builds »).
- GraphQL n'est pas disponible depuis les sessions Claude : créer les pull requests avec `gh api repos/SleepingRoomer/omas-ecos/pulls -f title=… -f head=… -f base=main -F body=@fichier`.

## Technique
- Cloudflare Workers + Hono (`src/`) + D1 (SQLite), interface en modules JS sans compilation (`public/js/`), routes en `#/...`. Logique partagée serveur et navigateur : `public/js/shared.js` (notes, contrôles qualité), `planning-shared.js` (planning, rotation, vœux), `jp-shared.js` (journées procédure).
- Formule gratuite : 50 requêtes D1 et 50 appels sortants par exécution, 100 paramètres par requête (utiliser `multiInsert` et `batch` de `src/index.js`). Les calculs lourds (onglet Analyse) se font dans le navigateur.
- Migrations : `migrations/00xx_*.sql`. En production, elles sont collées à la main dans la console D1 (une instruction par ligne, sans commentaires), donc la table `d1_migrations` de production est vide. Dernière migration : 0014. Le code tolère l'absence des tables récentes (`.catch`).
- Secrets du Worker : `ADMIN_PASSWORD`, `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` (facultatif, par défaut « INES · OMAS Externat »). `keep_vars` est activé dans `wrangler.jsonc`.
- Tâches planifiées : `0 16 * * *` (UTC), soit 17 h l'hiver et 18 h l'été à Paris : rappels de la veille, liste d'attente, puis purge des connexions expirées (`src/system.js`, `nightly`) ; `30 * * * *` : offres de la liste d'attente arrivées à échéance (`hourly`). En local : `npx wrangler dev --test-scheduled`, puis POST sur `/cdn-cgi/local/explorer/api/local/scheduled?worker=omas-ecos` avec `{"cron": "30 * * * *"}`.
- Liste d'attente automatique (`src/waitlist.js`) : une place libérée part au premier de la liste avec un délai (24 h, coupé à 3 h avant la convocation, rien en dessous de 2 h de délai). Le délai est dans `candidates.extra.offer_expires_at`.
- Compte rendu des tâches planifiées dans `settings` (clés `cron_last`, `cron_hourly_last`) et sur la page « État du système » de l'admin, qui vérifie aussi les migrations et Brevo.
- Sauvegarde (`src/backup.js`) : le dimanche soir, chaque session en cours ou récente (format du bouton « Télécharger la sauvegarde », réimportable) et l'annuaire de l'équipe vers R2, huit semaines gardées. Inactive tant que le binding `BACKUP` est commenté dans `wrangler.jsonc` (le bucket `omas-ecos-sauvegardes` doit exister avant de l'activer, sinon le déploiement échoue).
- Relances de rédaction (`src/writing.js`) : échéance par étape dans `planning.writing_deadlines`, e-mail à la personne qui reçoit une station, récapitulatif le lundi (tâche du soir) aux rédacteurs et relecteurs, et à l'adresse de réponse des e-mails pour l'équipe.
- Saisie des grilles : ouverte d'après le planning (une heure avant la première convocation du jour, trois quarts d'heure après le dernier tour), ou forcée par `planning.eval_mode` ('auto', 'open', 'closed'). Détail des grilles retenu jusqu'à la fin de la dernière série (`planning.details_embargo`). Tout passe par `src/state.js` (`examState`, `loadExamState`) : ne plus lire `exams.eval_open` directement.
- E-mails : Brevo, un appel pour 200 destinataires, journal dans `mail_log`. Sans clé, rien ne part et le site fonctionne quand même.
- Hors connexion : `public/sw.js`. Changer le nom du cache (`ines-v17` aujourd'hui) quand les fichiers du front changent beaucoup.
- Sécurité : `public/_headers` (CSP stricte : pas de script ni de police externes, pas de gestionnaire `onclick` en ligne).

## Identité (charte complète dans le projet claude.ai « OMAS », document `claude/INES_charte.md`)
- Bleu OMAS `#2D2F84`, turquoise `#00A09A` (petit texte : `#00807B`), lavande `#ABACCE` pour l'ombre portée, fond blanc. Jetons CSS dans `public/css/style.css` (`--a`, `--b`, `--b-ink`, `--lav`…).
- Police Rethink Sans, servie par le site (`public/fonts/`, licence OFL).
- Logo : « INES » avec le S en dix bandes (cinq bleues, cinq turquoise). Fichiers dans `public/img/`, régénérables avec `scripts/brand/logo.py`.
- Les plaques A1 à B5 restent dans l'application comme signalétique des salles, mais ne sont plus le logo.

## Tests
- `npm test` (node:test, sans dépendance) : notes, rangs, rotation, horaires, heure de Paris et heure d'été, vœux et attribution, fenêtres de saisie, embargo, liste d'attente, et lecture de chaque fichier. Lancés par GitHub (`.github/workflows/tests.yml`) à chaque push et pull request.
- Pour bloquer un déploiement raté : dans Cloudflare, Workers & Pages, omas-ecos, Settings, Build, mettre `npm test` en Build command.
- Toute nouvelle règle qui dépend de l'heure va dans `planning-shared.js`, avec son test.

## Répétition avec des données fictives (en production aussi)
- Panneau en bas de l'onglet Réglages d'une session (`public/js/repetition.js`, routes dans `src/demo.js`) : stations d'exemple (contenu de `scripts/demo/stations.mjs`), export HelloAsso fictif à importer, bénévoles et évaluateurs fictifs, grilles simulées, et « Tout retirer ».
- Règle : tout ce qui est fictif a une adresse en `@exemple.org` (aucun e-mail ne part, grilles simulées seulement pour ces candidats, nettoyage par adresse). Les stations d'exemple ont « (exemple) » à la fin du titre. Ne jamais simuler ni supprimer autre chose.

## Travailler en local
```bash
npm install
echo "ADMIN_PASSWORD=test-admin" > .dev.vars
npx wrangler d1 migrations apply omas-ecos --local
npm run dev                      # http://localhost:8787
node scripts/demo/seed.mjs       # données fictives : session du jour, 80 candidats, 148 grilles
python3 scripts/demo/shots.py    # captures dans scripts/demo/shots/
```
Pour repartir d'une base vide : arrêter le serveur, supprimer `.wrangler/state`, relancer la migration locale.

## Équipe, journal, RGPD, réclamations
- Comptes nominatifs (`src/team.js`, table `team_members`, migration 0014) : un code par membre, gardé sous forme d'empreinte. La session admin porte `subject_id` = id du membre (NULL avec le mot de passe commun, qui reste un accès de secours qu'on peut refuser). Journal des actions sensibles dans `audit_log` (middleware `auditMiddleware`, libellés dans `ACTIONS`) : jamais le contenu des requêtes.
- RGPD (`src/rgpd.js`) : à l'anonymisation, l'empreinte salée de l'e-mail reste dans `candidates.extra.email_hash` pour la progression. Purge chaque soir : bénévoles inactifs depuis N ans, adresses du journal des e-mails, listes d'attente passées. Durées dans `settings` (clé `rgpd`), affichées sur la page publique `#/confidentialite`. Le sel est dans `settings.hash_salt` : ne jamais l'afficher ni le changer.
- Réclamations (`src/claims.js`, table `claims`) : une par station et par candidat, pendant `planning.claims_days` jours après la fin de la dernière série (`claimsWindow`). Une réclamation acceptée peut corriger des items dans toutes les grilles du passage ; la note est recalculée avec `computeScore`.
- Import des inscrits : `guessColumns` (shared.js) reconnaît les exports HelloAsso (participant plutôt que payeur). Réimporter le même fichier ne crée pas de doublon (e-mail + nom) et passe en annulé les billets remboursés.

## Repérer le bon candidat dans la salle
- Les candidats sont anonymes pour les évaluateurs : `/eval/context` ne renvoie ni nom ni prénom, l'écran de salle et les étiquettes n'affichent que le numéro (ou « Série x, place y » s'il n'est pas encore numéroté). Ne pas réintroduire de nom côté évaluateur.
- Étiquettes à coller sur la blouse (`public/js/etiquettes.js`, lien dans l'onglet Accueil) : numéro, prénom, circuit de départ en couleur, QR code vers `#/q/<numéro>` qui ouvre la grille chez l'évaluateur connecté à sa salle.
- Écran de l'évaluateur : « Dans ta salle en ce moment » et « Ensuite » (`roomNow`), et confirmation avant d'enregistrer la grille d'un candidat pas encore passé dans la salle ou convoqué un autre jour (`gridCheck`).
- Émargement vu depuis la salle : `/eval/context` et `/eval/presence` (relu toutes les 30 s) donnent seulement « a émargé » ou non. `presenceHint` (planning-shared.js) ne propose « Noter absent » qu'après `ABSENCE_GRACE_MIN` minutes de tour, avec confirmation ; jamais d'absence automatique. Une vraie grille enregistrée pour un candidat non émargé le marque présent (arrivé à la dernière minute). Noté absent puis émargé : signalé dans la salle et au scan de l'accueil (`absent_in`).
- Onglet En direct : « Grilles à vérifier », enregistrées avant le passage prévu du candidat (`passageInRoom`). Une grille erronée se supprime depuis le bulletin du candidat (vue de l'équipe).

## Chrono de la série
- L'accueil (`#/conduite`, code d'accueil) ou l'équipe (`#/admin/session/:id/conduite`, bouton dans En direct) lance chaque tour : « Lancer le tour N », « Lancer la pause », « Lancer le débrief », « Terminer la série ». État dans `planning.live` (`day`, `series`, `round`, `phase`, `started_at`), route `POST /exams/:id/live`, lecture `GET /live`. Règles `liveClock`, `nextLiveStep`, `liveSeat` dans planning-shared.js (testées).
- Bandeau `#live-clock` en haut des écrans (évaluateurs, accueil, bénévoles, projection, En direct) : relu toutes les 15 s, décompte à la seconde avec l'écart d'horloge du serveur, vibration à la fin d'un tour chez l'évaluateur. Quand un tour est lancé, « Dans ta salle en ce moment » suit le tour lancé et non l'horaire prévu (retards absorbés). Sans chrono lancé, tout suit le planning comme avant.

## Le déroulé dans l'espace de chacun
- `public/js/guide.js` : `guideSection(box, profils, { planning, open })`, un bloc repliable avec le film (mêmes scènes que la page « Une session étape par étape » du dépôt ines-presentation), l'essentiel et la FAQ du profil. Profils : `etudiant` (espace étudiant), `evaluateur` (vouvoiement ; salle et espace bénévole), `ps`, `benevole` et `accueil`. Animations en CSS préfixées `.gd-stage`.

## Accueil, réserve et tableau de bord
- Code d'accueil (onglet Accueil, `planning.accueil_code`) : donné à l'étudiant qui tient l'accueil, onglet « Accueil » de la page de connexion. Session `accueil` (subject_id = id de la session), valable la veille et pendant les jours de la session. Elle ne voit que l'émargement, les étiquettes et le brief des circuits de sa session (`/exams/:id/planning` sans e-mail, téléphone ni vœux ; `/checkin` et `/presence` limités à sa session). Un nouveau code déconnecte l'ancien.
- Brief des circuits (`briefView` dans `public/js/accueil.js`, `#/brief` pour l'accueil, `#/admin/session/:id/brief` pour l'équipe) : par série, circuit et salle de départ de chacun, salle après la pause, consignes.
- PS ou PSS de réserve : poste `reserve` dans `assignments` (`POSTS` de `src/benevoles.js`), au moins un par demi-journée dès qu'une station a un PS ou un PSS ; compté dans la couverture du planning des salles et signalé au tableau de bord.
- Tableau de bord (`src/dashboard.js`, `public/js/dashboard.js`) : premier onglet d'une session. Liste « À faire » calculée côté serveur (stations, créneaux, numéros, convocations, postes à pourvoir, réserve, accueil, code d'accueil, impressions, salles prêtes, réclamations, anonymisation), compteurs, et l'équipe de chaque demi-journée.
- `PUT /exams/:id/planning` ne réécrit jamais `accueil_code`, `materiel_check` ni `materiel_common` (gérés par leurs propres routes).

## Messages aux salles et avis de l'équipe
- Messages aux salles (`src/messages.js`, panneau en haut d'En direct) : gardés dans `planning.broadcasts` (20 derniers), visibles 45 minutes ou jusqu'à « Retirer ». Bandeau `#broadcast` (index.html) relu toutes les 30 secondes par `app.js` chez les évaluateurs (toutes les salles ou la leur), l'accueil, les bénévoles (et leur salle du jour) et l'écran de projection. « Vu » le masque sur l'appareil.
- Avis de l'équipe : dans l'espace bénévole dès la fin de sa première demi-journée (deux notes, « reviendrais-tu ? », un mot libre), gardé dans `volunteer_signups.prefs.feedback`. Résumé sans nom dans Analyse (`/exams/:id/team-feedback`). Merci automatique le lendemain de sa dernière demi-journée (`teamThanks` dans `src/mail.js`, tâche du soir, `mail_log` kind `merci_benevole`), avec ses grilles saisies, sa salle et son rôle.

## Matériel et impressions
- Onglet Matériel d'une session (`public/js/materiel.js`) : en haut « À imprimer » (étiquettes, vignettes, fiches codes, grilles papier de secours, documents, planning, signalétique, attestations, avec les quantités), puis le matériel commun (liste proposée par zone, modifiable, gardée dans `planning.materiel_common`), puis le matériel des stations. Cases à cocher dans `planning.materiel_check` (clés `print|…`, `commun|…`, `<salle>|<article>`).
- Pages d'impression : `#/admin/session/:id/imprimer-vignettes`, `-grilles`, `-documents`, `-signaletique` (`public/js/printables.js`).

## Bénévoles et évaluateurs
- Une même table (`volunteers`, `volunteer_signups`) et deux liens publics : `#/benevole/:id` (externes : PS, PSS, logistique, évaluateur ; une demi-journée par jour) et `#/evaluateur/:id` (médecins et internes : disciplines préférées, attestation, journée entière possible). La piste est dans `volunteer_signups.prefs` (JSON, migration 0013) ; sans la colonne, l'inscription passe quand même.
- Les évaluateurs sont vouvoyés dans les e-mails et le formulaire ; les bénévoles tutoyés.

## Règles métier à ne pas casser
- Grille : chaque item d'aptitude vaut 1 point (observé ou non, jamais de demi-point) ; la communication se note par quart de point (0, 0,25, 0,5, 0,75, 1). L'éditeur ne propose plus de choisir les points, le serveur les remet à 1 tant qu'aucune grille n'est saisie.
- Pas de calibration par station : tout est expliqué au briefing, une heure avant la première série (textes des formulaires et e-mails). La vue de calibration reste dans le code mais n'est plus proposée.
- Note d'une station = (points des aptitudes + communication) ÷ maximum × 20. La performance globale ne compte pas. En binôme, moyenne des grilles. Rang provisoire entre candidats complets, ex aequo au même rang.
- Rotation ECOS : places 1 à 5 sur le circuit A, 6 à 10 sur le B, changement de circuit à la pause (`rotationFor`). Tours de 10 min, pause de 10 min après 5 tours, débrief de 30 min.
- Vœux : idéal, possible, impossible ; au moins 6 possibles, au plus 3 idéaux. Attribution par flot de coût minimal, tirage reproductible.
- Journées procédure : créneaux à 9 h et 14 h, ateliers de 20 min et 5 min de transition, autant de groupes que d'ateliers, le groupe g commence à l'atelier g.

## Prochains chantiers (détail dans `claude/ECOS_feuille_de_route.md` du projet)
Faits : lot 1 (embargo, saisie d'après le planning, État du système, purge), inscription des évaluateurs, liste d'attente automatique, tests, nom d'évaluateur choisi dans une liste, relances de rédaction, sauvegarde hebdomadaire.
Aussi faits : RGPD (progression après anonymisation, durées de conservation, page publique), comptes nominatifs et journal, réclamations, import HelloAsso.
Mis de côté pour l'instant : SMS de rappel, sauvegarde R2 (le code est prêt mais inactif).
