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
- Migrations : `migrations/00xx_*.sql`. En production, elles sont collées à la main dans la console D1 (une instruction par ligne, sans commentaires), donc la table `d1_migrations` de production est vide. Dernière migration : 0012. Le code tolère l'absence des tables récentes (`.catch`).
- Secrets du Worker : `ADMIN_PASSWORD`, `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` (facultatif, par défaut « INES · OMAS Externat »). `keep_vars` est activé dans `wrangler.jsonc`.
- Tâche planifiée `0 16 * * *` (UTC) : rappels de la veille, soit 17 h l'hiver et 18 h l'été à Paris.
- E-mails : Brevo, un appel pour 200 destinataires, journal dans `mail_log`. Sans clé, rien ne part et le site fonctionne quand même.
- Hors connexion : `public/sw.js`. Changer le nom du cache (`ines-v7` aujourd'hui) quand les fichiers du front changent beaucoup.
- Sécurité : `public/_headers` (CSP stricte : pas de script ni de police externes, pas de gestionnaire `onclick` en ligne).

## Identité (charte complète dans le projet claude.ai « OMAS », document `claude/INES_charte.md`)
- Bleu OMAS `#2D2F84`, turquoise `#00A09A` (petit texte : `#00807B`), lavande `#ABACCE` pour l'ombre portée, fond blanc. Jetons CSS dans `public/css/style.css` (`--a`, `--b`, `--b-ink`, `--lav`…).
- Police Rethink Sans, servie par le site (`public/fonts/`, licence OFL).
- Logo : « INES » avec le S en dix bandes (cinq bleues, cinq turquoise). Fichiers dans `public/img/`, régénérables avec `scripts/brand/logo.py`.
- Les plaques A1 à B5 restent dans l'application comme signalétique des salles, mais ne sont plus le logo.

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

## Règles métier à ne pas casser
- Note d'une station = (points des aptitudes + communication) ÷ maximum × 20. La performance globale ne compte pas. En binôme, moyenne des grilles. Rang provisoire entre candidats complets, ex aequo au même rang.
- Rotation ECOS : places 1 à 5 sur le circuit A, 6 à 10 sur le B, changement de circuit à la pause (`rotationFor`). Tours de 10 min, pause de 10 min après 5 tours, débrief de 30 min.
- Vœux : idéal, possible, impossible ; au moins 6 possibles, au plus 3 idéaux. Attribution par flot de coût minimal, tirage reproductible.
- Journées procédure : créneaux à 9 h et 14 h, ateliers de 20 min et 5 min de transition, autant de groupes que d'ateliers, le groupe g commence à l'atelier g.

## Prochains chantiers (détail dans `claude/ECOS_feuille_de_route.md` du projet)
1. N'afficher le détail des grilles qu'après le dernier passage.
2. Ouvrir et fermer la saisie d'après les horaires du planning.
3. Page « État du système » (migrations, Brevo, tâche planifiée).
4. Purger les connexions expirées dans la tâche planifiée.
Puis : relances des rédacteurs, liste d'attente automatique, nom d'évaluateur choisi dans une liste, SMS de rappel, tests automatiques.
