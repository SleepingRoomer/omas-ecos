# Plateforme ECOS blancs OMAS

Une seule application pour les trois temps des ECOS blancs :

1. **Rédaction des stations** : un éditeur structuré en 8 parties (identité, vignette, consignes à l'examinateur, script PS, documents, matériel, grille, fiche pédagogique). La vignette s'imprime au format national (A4 paysage, Arial 14, interligne 1,5). Un circuit de relecture suit chaque station : rédaction, relecture pair, relecture expert, test chronométré, corrections, validation finale. La check-list qualité est vérifiée en direct.
2. **Saisie des grilles le jour J** : l'évaluateur se connecte sur son téléphone avec le code de sa salle et son nom, choisit le candidat et coche la grille. Chaque item se coche « observé » ou « non observé », avec un commentaire possible. La communication se note sur 5 niveaux, de 0 à 1. La performance globale va de 0 à 4. Une grille papier de secours est générée pour chaque station.
3. **Résultats en direct** : chaque étudiant a un code personnel. Il voit sa note par station, son rang par station, sa moyenne et son rang provisoire, recalculés à chaque grille saisie. Le détail des items et les commentaires sont affichés selon les réglages. Les corrections apparaissent quand l'équipe les publie.

Accès : `Étudiant` (code personnel), `Évaluateur` (code de la salle + nom), `Rédaction` (code personnel du rédacteur ou relecteur), `Admin` (mot de passe).

## Calcul des notes

- Note d'une station sur 20 = (points des aptitudes + points de communication) ÷ points maximum × 20.
- La performance globale ne compte pas dans la note. Elle sert à contrôler la qualité des stations.
- Moyenne générale = moyenne des notes des stations passées. Une station où le candidat est absent ne compte pas.
- Rang provisoire : calculé entre les candidats dont toutes les stations jouées sont saisies. Les ex æquo ont le même rang.

## Stack

- Cloudflare Workers (avec fichiers statiques) et base Cloudflare D1, dans l'offre gratuite.
- Serveur : [Hono](https://hono.dev), dans `src/index.js`.
- Interface : HTML, CSS et JavaScript sans étape de compilation, dans `public/`. La logique de calcul est partagée dans `public/js/shared.js`.
- Schéma de la base : `migrations/0001_init.sql`.

## Mise en ligne (une seule fois)

Il faut un compte Cloudflare gratuit et Node.js installé sur l'ordinateur.

```bash
npm install
npx wrangler login                      # ouvre le navigateur pour se connecter à Cloudflare
npx wrangler d1 create omas-ecos        # affiche un "database_id"
```

1. Copier le `database_id` affiché dans `wrangler.jsonc` (déjà fait pour la base actuelle).
2. Créer les tables et choisir le mot de passe admin :

```bash
npm run db:migrate:prod
npx wrangler secret put ADMIN_PASSWORD  # saisir un mot de passe long, différent de celui de l'ancienne plateforme
npm run deploy
```

Le site est alors en ligne à une adresse du type `https://omas-ecos.<compte>.workers.dev`. Pour le brancher sur `ecosblancsomas.com`, aller dans Cloudflare, puis Workers & Pages, puis omas-ecos, puis Settings, puis Domains & Routes. Le domaine doit être géré par Cloudflare.

Pour les mises à jour suivantes, il suffit de lancer `npm run deploy`. On peut aussi relier le dépôt GitHub dans Cloudflare (Workers & Pages, puis Create, puis Import a repository) pour que chaque modification soit déployée automatiquement.

## Développement local

```bash
npm install
echo "ADMIN_PASSWORD=test-admin" > .dev.vars
npm run db:migrate:local
npm run dev        # http://localhost:8787
```

## Déroulé type d'une session

1. **Admin, onglet Sessions** : créer la session. Les 12 emplacements (A1–A5, B1–B5, R1, R2) sont créés avec la répartition du guide.
2. **Admin, onglet Rédacteurs** : ajouter les rédacteurs et relecteurs, puis leur envoyer leur lien personnel (export CSV).
3. **Onglet Stations** : attribuer à chaque station un rédacteur, un relecteur pair et un relecteur expert. La station suit ensuite seule le circuit de relecture.
4. **Onglet Candidats** : importer l'export de la billetterie, associer chaque créneau à un jour et une série, puis cliquer sur « Numéroter ». Les numéros ont la forme `J1-S2-07` : jour 1, série 2, candidat 07. Les candidats 01 à 05 commencent par le circuit A. Exporter ensuite les codes et les liens pour les convocations.
5. **Veille** : imprimer les codes des salles (bouton « Codes des salles ») et les grilles papier de secours.
6. **Jour J** : dans l'onglet Réglages, cocher « Saisie des grilles ouverte ». Les résultats se mettent à jour à chaque grille enregistrée.
7. **Après le dernier week-end** : fermer la saisie, puis cocher « Corrections publiées ».

## Sécurité

- Les codes font 8 caractères, tirés parmi 32 symboles, soit environ mille milliards de combinaisons. Un code régénéré invalide l'ancien.
- Un évaluateur ne voit que sa station. Un rédacteur ne voit que les stations qui lui sont attribuées. Un étudiant ne voit que ses propres résultats.
- Après validation finale, la grille est figée. Une station déjà évaluée ne peut plus être modifiée par un rédacteur.
