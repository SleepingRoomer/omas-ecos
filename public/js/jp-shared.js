// Journées procédure : logique partagée entre le serveur et le navigateur

export const JP_STATUSES = { redaction: 'Rédaction', relecture: 'Relecture', validee: 'Validée' };

export function emptyAtelier() {
  return {
    objectif: '',
    ecos: '',
    deroule: { brief: '', demo: '', pratique: '', debrief: '' },
    postes: 2,
    materiel: [],        // par poste : { article, qte }
    consommables: [],    // par étudiant : { article, qte }
    grille: [],          // gestes observables (chaînes)
    erreurs: [],         // erreurs fréquentes (chaînes)
    points_cles: '',
    references: '',
  };
}

export function normalizeAtelier(c) {
  const base = emptyAtelier();
  const out = { ...base, ...(c || {}) };
  out.deroule = { ...base.deroule, ...((c || {}).deroule || {}) };
  for (const k of ['materiel', 'consommables', 'grille', 'erreurs']) if (!Array.isArray(out[k])) out[k] = [];
  out.postes = Number(out.postes) > 0 ? Number(out.postes) : 1;
  return out;
}

const filled = (s) => typeof s === 'string' && s.trim().length > 0;

export function atelierChecks(a, c) {
  const x = normalizeAtelier(c);
  const out = [];
  const err = (m) => out.push({ level: 'error', msg: m });
  const warn = (m) => out.push({ level: 'warn', msg: m });
  if (!filled(a.title)) err('Donner un titre à l\'atelier.');
  if (!filled(x.objectif)) err('Écrire l\'objectif de l\'atelier.');
  const g = x.grille.filter(filled).length;
  if (g < 4 || g > 8) err(`Mini-grille : ${g} geste(s), il en faut 4 à 8 pour tenir en 11 minutes de pratique.`);
  if (x.materiel.length === 0) err('Lister le matériel d\'un poste.');
  if (!filled(x.points_cles)) err('Rédiger les points clés envoyés aux étudiants.');
  if (!filled(x.ecos)) warn('Dire comment ce geste tombe en station d\'ECOS.');
  if (x.erreurs.filter(filled).length < 2) warn('Noter au moins deux erreurs fréquentes pour le débrief.');
  if (!filled(x.references)) warn('Ajouter les références.');
  return out;
}

// Rotation : le groupe g (1..n) commence à l'atelier g, puis avance d'un atelier à chaque tour
export function rotation(nAteliers, startTime, minutes, transition) {
  const [h, m] = String(startTime || '09:00').split(':').map(Number);
  const t0 = h * 60 + m;
  const fmtT = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const turns = [];
  for (let r = 0; r < nAteliers; r++) {
    const start = t0 + r * (minutes + transition);
    turns.push({ turn: r + 1, start: fmtT(start), end: fmtT(start + minutes) });
  }
  const atelierOf = (group, turn) => ((group - 1 + turn - 1) % nAteliers); // index 0..n-1
  const end = fmtT(t0 + nAteliers * minutes + (nAteliers - 1) * transition);
  return { turns, atelierOf, end, convocation: fmtT(Math.max(0, t0 - 15)) };
}

// Brouillons des ateliers de la JP1 : à relire et valider par les animateurs
export const JP1_DRAFTS = [
  {
    code: 'P1', title: 'Suture cutanée', discipline: 'Médecine d\'urgence',
    content: {
      objectif: 'Réaliser une suture cutanée par points simples sur un carré de suture, en verbalisant chaque étape comme dans une station sans PS.',
      ecos: 'Station « procédure » sur matériel de simulation : la suture figure dans la liste du matériel des ECOS-N 2025.',
      deroule: { brief: 'Objectif, matériel du poste, règles d\'asepsie.', demo: 'Un point simple complet, commenté à voix haute.', pratique: 'Chaque étudiant réalise au moins deux points en verbalisant.', debrief: 'Les erreurs les plus fréquentes et les points clés.' },
      postes: 3,
      materiel: [{ article: 'Carré de suture (peau synthétique)', qte: 1 }, { article: 'Porte-aiguille', qte: 1 }, { article: 'Pince à disséquer à griffes', qte: 1 }, { article: 'Ciseaux', qte: 1 }, { article: 'Collecteur à aiguilles', qte: 1 }],
      consommables: [{ article: 'Fil monofilament 3/0 serti', qte: 1 }, { article: 'Paire de gants stériles', qte: 1 }, { article: 'Compresses stériles', qte: 2 }],
      grille: ['Explique le geste et verbalise l\'anesthésie locale après avoir vérifié les allergies', 'Enfile les gants stériles sans faute d\'asepsie', 'Verbalise le nettoyage de la plaie et la recherche d\'un corps étranger', 'Monte l\'aiguille au tiers postérieur dans le porte-aiguille', 'Pique perpendiculairement à la peau, à égale distance des deux berges', 'Réalise un nœud à la pince sans chevauchement des berges', 'Coupe les fils à bonne longueur et jette l\'aiguille dans le collecteur', 'Explique les soins locaux et la date d\'ablation des fils'],
      erreurs: ['Contamination des gants en les enfilant', 'Aiguille tenue trop près de la pointe', 'Traction excessive qui fait chevaucher les berges'],
      points_cles: 'Asepsie tout au long du geste. Aiguille montée au tiers postérieur, entrée perpendiculaire à la peau, sortie symétrique. Nœud serré sans ischémier les berges. Toujours annoncer les soins et le délai d\'ablation des fils, qui dépend de la localisation.',
      references: 'À compléter par l\'animateur.',
    },
  },
  {
    code: 'P2', title: 'Palpation mammaire', discipline: 'Gynécologie-obstétrique',
    content: {
      objectif: 'Conduire un examen des seins complet et méthodique sur buste de simulation, et décrire une anomalie.',
      ecos: 'Station « examen clinique » sur matériel de simulation : la palpation mammaire figure dans la liste des ECOS-N 2025.',
      deroule: { brief: 'Objectif, principe du buste, consentement et présence d\'un tiers.', demo: 'Examen complet commenté.', pratique: 'Chaque étudiant examine le buste et décrit ce qu\'il trouve.', debrief: 'Méthode, description d\'une masse, conduite à tenir.' },
      postes: 2,
      materiel: [{ article: 'Buste de palpation mammaire', qte: 1 }],
      consommables: [],
      grille: ['Explique l\'examen, recueille le consentement et propose la présence d\'un tiers', 'Inspecte les seins bras le long du corps puis bras levés', 'Palpe les deux seins à plat, quadrant par quadrant, sillon sous-mammaire compris', 'Recherche un écoulement mamelonnaire', 'Palpe les aires axillaires et sus-claviculaires des deux côtés', 'Décrit une masse : siège, taille, consistance, mobilité, limites', 'Annonce la suite : imagerie adaptée à l\'âge'],
      erreurs: ['Examen d\'un seul sein', 'Oubli des aires ganglionnaires', 'Description incomplète de la masse (siège en rayon horaire oublié)'],
      points_cles: 'Toujours bilatéral et comparatif. Inspection avant palpation. Une masse se décrit par son siège (quadrant ou rayon horaire et distance au mamelon), sa taille, sa consistance, sa mobilité et ses limites. On termine par les aires ganglionnaires et la suite à donner.',
      references: 'À compléter par l\'animateur.',
    },
  },
  {
    code: 'P3', title: 'Toucher rectal', discipline: 'Urologie',
    content: {
      objectif: 'Réaliser un toucher rectal sur mannequin en respectant la pudeur et l\'information du patient, et décrire la prostate.',
      ecos: 'Station « examen clinique » sur matériel de simulation : le toucher rectal masculin figure dans la liste des ECOS-N 2025.',
      deroule: { brief: 'Objectif, information, consentement, présence d\'un tiers.', demo: 'Examen commenté sur le mannequin.', pratique: 'Chaque étudiant réalise l\'examen et décrit la prostate.', debrief: 'Description normale et pathologique.' },
      postes: 2,
      materiel: [{ article: 'Mannequin de toucher rectal', qte: 1 }],
      consommables: [{ article: 'Paire de gants non stériles', qte: 1 }, { article: 'Dose de lubrifiant', qte: 1 }],
      grille: ['Explique l\'examen, recueille le consentement et propose un tiers', 'Installe le patient et verbalise la position', 'Inspecte la marge anale', 'Introduit l\'index ganté et lubrifié en douceur', 'Évalue le tonus du sphincter', 'Décrit la prostate : taille, consistance, sillon médian, nodule, douleur', 'Inspecte le doigtier et conclut'],
      erreurs: ['Information et consentement oubliés', 'Pas d\'inspection de la marge anale', 'Description de la prostate incomplète'],
      points_cles: 'Information, consentement et pudeur avant tout. Inspection de la marge anale, puis palpation douce. La prostate se décrit par sa taille, sa consistance, son sillon médian, la présence d\'un nodule et la douleur. On regarde toujours le doigtier.',
      references: 'À compléter par l\'animateur.',
    },
  },
  {
    code: 'P4', title: 'Otoscopie', discipline: 'ORL',
    content: {
      objectif: 'Manipuler l\'otoscope correctement, reconnaître un tympan normal et les principales anomalies.',
      ecos: 'Station « examen clinique » ou « iconographie » : l\'examen de l\'oreille figure dans la liste des ECOS-N 2025.',
      deroule: { brief: 'Objectif et matériel.', demo: 'Otoscopie commentée, puis lecture de photos.', pratique: 'Manipulation sur modèle, puis lecture de photos de tympans.', debrief: 'Repères du tympan normal, otite moyenne aiguë, otite séromuqueuse, perforation.' },
      postes: 2,
      materiel: [{ article: 'Otoscope', qte: 1 }, { article: 'Modèle d\'oreille ou photos de tympans', qte: 1 }],
      consommables: [{ article: 'Spéculum à usage unique', qte: 1 }],
      grille: ['Choisit un spéculum adapté au conduit', 'Tire le pavillon en haut et en arrière chez l\'adulte', 'Tient l\'otoscope avec la main en appui sur la joue', 'Examine le conduit puis le tympan', 'Nomme les repères : manche du marteau, triangle lumineux', 'Décrit l\'anomalie d\'une photo et propose le diagnostic', 'Examine l\'autre oreille'],
      erreurs: ['Otoscope tenu sans appui', 'Traction du pavillon dans le mauvais sens', 'Description sans repères anatomiques'],
      points_cles: 'Appui de la main sur la joue pour ne pas blesser le conduit. Pavillon tiré en haut et en arrière chez l\'adulte. On décrit le conduit puis le tympan, avec ses repères, avant de conclure. Toujours les deux oreilles.',
      references: 'À compléter par l\'animateur.',
    },
  },
  {
    code: 'P5', title: 'Gants stériles et injection IM', discipline: 'Médecine générale',
    content: {
      objectif: 'Enfiler des gants stériles sans faute et réaliser une injection intramusculaire sur pad, en sécurité.',
      ecos: 'Station « procédure » : gants stériles et matériel d\'injection IM figurent dans la liste des ECOS-N 2025.',
      deroule: { brief: 'Objectif, règles de sécurité, produits étiquetés « simulation ».', demo: 'Enfilage des gants puis injection commentée.', pratique: 'Chaque étudiant enfile les gants puis réalise une injection.', debrief: 'Vérifications avant l\'injection, sécurité des aiguilles.' },
      postes: 3,
      materiel: [{ article: 'Pad d\'injection IM', qte: 1 }, { article: 'Collecteur à aiguilles', qte: 1 }],
      consommables: [{ article: 'Paire de gants stériles', qte: 1 }, { article: 'Seringue 5 mL', qte: 1 }, { article: 'Aiguille de prélèvement', qte: 1 }, { article: 'Aiguille IM', qte: 1 }, { article: 'Ampoule de sérum physiologique étiquetée « simulation »', qte: 1 }, { article: 'Compresses', qte: 2 }],
      grille: ['Vérifie la prescription : patient, produit, dose, voie, horaire', 'Recherche une contre-indication : anticoagulant, trouble de l\'hémostase', 'Réalise une friction hydroalcoolique et enfile les gants sans contaminer leur face externe', 'Prépare la seringue et change d\'aiguille', 'Repère le site d\'injection et désinfecte', 'Pique perpendiculairement, injecte lentement, retire et comprime', 'Jette l\'aiguille dans le collecteur sans la recapuchonner', 'Trace l\'injection'],
      erreurs: ['Face externe des gants touchée', 'Contre-indications non recherchées', 'Aiguille recapuchonnée'],
      points_cles: 'On vérifie la prescription et les contre-indications avant de préparer quoi que ce soit. Gants stériles : on ne touche que la face interne du premier gant. Aiguille jetée immédiatement dans le collecteur, jamais recapuchonnée. On trace l\'injection.',
      references: 'À compléter par l\'animateur.',
    },
  },
  {
    code: 'P6', title: 'Palpation testiculaire', discipline: 'Urologie',
    content: {
      objectif: 'Examiner les bourses de façon méthodique sur mannequin et décrire une anomalie.',
      ecos: 'Station « examen clinique » : examen des organes génitaux externes sur matériel de simulation.',
      deroule: { brief: 'Objectif, information, consentement, tiers.', demo: 'Examen commenté.', pratique: 'Chaque étudiant examine et décrit.', debrief: 'Masse testiculaire, varicocèle, hydrocèle, hernie.' },
      postes: 2,
      materiel: [{ article: 'Mannequin d\'examen testiculaire', qte: 1 }],
      consommables: [{ article: 'Paire de gants non stériles', qte: 1 }],
      grille: ['Explique l\'examen, recueille le consentement et propose un tiers', 'Inspecte les bourses debout et couché', 'Palpe chaque testicule entre le pouce et deux doigts, en comparant', 'Palpe l\'épididyme et le cordon spermatique', 'Recherche une varicocèle ou une hernie à la manœuvre de Valsalva', 'Décrit une anomalie et verbalise la transillumination', 'Explique l\'autopalpation'],
      erreurs: ['Examen non comparatif', 'Épididyme et cordon oubliés', 'Examen uniquement couché'],
      points_cles: 'Examen comparatif, debout puis couché. On palpe le testicule, l\'épididyme puis le cordon. Une masse dure du testicule fait évoquer un cancer jusqu\'à preuve du contraire. On termine en expliquant l\'autopalpation.',
      references: 'À compléter par l\'animateur.',
    },
  },
  {
    code: 'P7', title: 'Arrêt cardio-respiratoire', discipline: 'Médecine d\'urgence',
    content: {
      objectif: 'Reconnaître un arrêt cardiaque, alerter et réaliser une réanimation de base de qualité avec un défibrillateur.',
      ecos: 'Station « urgence » ou « procédure » : le mannequin de massage cardiaque figure dans la liste des ECOS-N 2025.',
      deroule: { brief: 'Objectif, mannequin et défibrillateur de formation.', demo: 'Séquence complète commentée.', pratique: 'Chaque étudiant enchaîne reconnaissance, alerte, compressions et défibrillateur, avec relais.', debrief: 'Qualité des compressions, minimiser les interruptions.' },
      postes: 2,
      materiel: [{ article: 'Mannequin de réanimation adulte', qte: 1 }, { article: 'Défibrillateur de formation', qte: 1 }],
      consommables: [{ article: 'Lingette désinfectante', qte: 1 }],
      grille: ['Vérifie la sécurité et évalue la conscience', 'Libère les voies aériennes et vérifie la respiration en 10 secondes au plus', 'Alerte le 15 ou le 112 et demande un défibrillateur', 'Place les mains au centre du thorax', 'Comprime de 5 à 6 cm, à 100 à 120 par minute, avec relâchement complet', 'Pose le défibrillateur dès qu\'il arrive et suit ses consignes', 'Reprend les compressions aussitôt après le choc'],
      erreurs: ['Vérification de la respiration trop longue', 'Compressions trop superficielles ou trop rapides', 'Interruptions trop longues autour du choc'],
      points_cles: 'Inconscient et ne respire pas normalement : c\'est un arrêt. On alerte, on comprime tout de suite et on fait chercher un défibrillateur. Compressions de 5 à 6 cm, 100 à 120 par minute, relâchement complet, interruptions minimales. On reprend les compressions dès le choc délivré.',
      references: 'À compléter par l\'animateur.',
    },
  },
];
