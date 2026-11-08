// Contenu de démonstration (fictif) pour les captures d'écran d'INES
const COM = [
  'Se présente, explique le déroulé et obtient l\'accord',
  'Reformule et vérifie la compréhension',
  'Langage adapté, attitude empathique, sans jargon',
];
const GLOBAL = ['Insuffisant, mise en danger possible', 'Limite, plusieurs oublis importants', 'Correct, oublis mineurs', 'Bon, raisonnement structuré', 'Excellent, autonome et fluide'];

export const STATIONS = {
  A1: { title: 'Douleur thoracique chez un homme de 58 ans', discipline: 'Cardiologie', sdd: 'Douleur thoracique', item: '334',
    vignette: { role: 'Interne aux urgences', lieu: 'Box des urgences', contexte: 'M. Bernard, 58 ans, consulte pour une douleur thoracique apparue il y a deux heures au repos. Il est fumeur et traité pour une hypertension.', infos: 'Constantes : PA 152/88 mmHg, FC 96/min, SpO2 97 % en air ambiant.', doit: ['Mener l\'interrogatoire', 'Annoncer au patient les examens que vous demandez'], nedoitpas: ['Examiner le patient'] },
    script: { personnage: 'Homme de 58 ans, inquiet, mains sur la poitrine', histoire: 'Douleur en barre, constrictive, depuis deux heures, irradiant au bras gauche et à la mâchoire. Sueurs. Pas de fièvre.', demarrage: 'J\'ai mal dans la poitrine depuis ce matin, ça serre.', neutres: ['Je ne sais pas, docteur.'] },
    apt: ['Caractérise le siège et le type de la douleur', 'Recherche une irradiation au bras ou à la mâchoire', 'Précise l\'heure de début et la durée', 'Recherche les signes associés (sueurs, dyspnée, malaise)', 'Recherche une douleur à l\'effort les jours précédents', 'Recherche les facteurs de risque cardiovasculaire', 'Recherche les traitements en cours et les allergies', 'Évoque un syndrome coronarien aigu', 'Évoque au moins deux diagnostics graves différentiels', 'Annonce un ECG dans les dix minutes', 'Annonce le dosage de la troponine', 'Explique la surveillance et l\'appel au cardiologue'] },
  A2: { title: 'Radiographie de thorax d\'une toux fébrile', discipline: 'Pneumologie',
    apt: ['Vérifie l\'identité et la date du cliché', 'Juge la qualité technique', 'Décrit une opacité alvéolaire du lobe inférieur droit', 'Note le bronchogramme aérien', 'Recherche un épanchement pleural', 'Analyse la silhouette cardiaque', 'Conclut à une pneumopathie franche lobaire aiguë', 'Cherche des signes de gravité cliniques', 'Propose une antibiothérapie adaptée', 'Prévoit une réévaluation à 48 heures'] },
  A3: { title: 'Pose d\'une voie veineuse périphérique', discipline: 'Médecine d\'urgence',
    apt: ['Vérifie la prescription et l\'identité', 'Prépare le matériel sur un plan propre', 'Réalise une friction hydroalcoolique', 'Pose le garrot à distance du point de ponction', 'Choisit une veine de l\'avant-bras', 'Désinfecte en un temps large', 'Ponctionne biseau vers le haut', 'Recule le mandrin et avance le cathéter', 'Retire le garrot avant le mandrin', 'Élimine le mandrin dans le collecteur', 'Fixe le cathéter et date le pansement'] },
  A4: { title: 'Annonce d\'un diabète de type 1', discipline: 'Endocrinologie',
    apt: ['Vérifie ce que sait la patiente', 'Annonce le diagnostic avec des mots simples', 'Laisse un temps de silence', 'Explique le rôle de l\'insuline', 'Rassure sur une vie normale avec le traitement', 'Explique les signes d\'hypoglycémie', 'Explique la conduite à tenir en cas d\'hypoglycémie', 'Propose l\'éducation thérapeutique', 'Planifie le suivi', 'Vérifie les questions restantes'] },
  A5: { title: 'Anémie chez une femme de 34 ans', discipline: 'Hématologie',
    apt: ['Confirme l\'anémie sur l\'hémoglobine', 'Analyse le VGM', 'Conclut à une anémie microcytaire', 'Demande la ferritine', 'Recherche des ménorragies', 'Recherche un saignement digestif', 'Recherche une carence d\'apport', 'Propose une supplémentation en fer', 'Prévoit un contrôle de la NFS', 'Hiérarchise les examens complémentaires'] },
  B1: { title: 'Transmission SBAR d\'un patient fébrile', discipline: 'Médecine interne',
    apt: ['Se présente à l\'interlocuteur', 'Situation : motif clair en une phrase', 'Background : antécédents utiles', 'Donne les constantes', 'Assessment : hypothèse principale', 'Signale la gravité potentielle', 'Recommendation : demande précise', 'Propose un délai d\'action', 'Fait reformuler la demande', 'Trace la transmission'] },
  B2: { title: 'Examen neurologique d\'un déficit brutal', discipline: 'Neurologie',
    apt: ['Se lave les mains et explique l\'examen', 'Évalue la vigilance', 'Teste la motricité des quatre membres', 'Recherche une asymétrie faciale', 'Teste la sensibilité', 'Recherche une aphasie', 'Teste les réflexes ostéotendineux', 'Recherche un signe de Babinski', 'Calcule le score NIHSS', 'Évoque un AVC et l\'alerte thrombolyse'] },
  B3: { title: 'Éducation à l\'inhalateur chez un asthmatique', discipline: 'Pneumologie',
    apt: ['Évalue la technique actuelle', 'Explique le rôle du traitement de fond', 'Fait expirer avant l\'inhalation', 'Coordonne pression et inspiration', 'Fait tenir une apnée de dix secondes', 'Fait rincer la bouche', 'Explique la chambre d\'inhalation', 'Fait une démonstration', 'Fait refaire le geste au patient', 'Remet un plan d\'action écrit'] },
  B4: { title: 'Interpréter un bilan hépatique perturbé', discipline: 'Hépato-gastro-entérologie',
    apt: ['Identifie une cytolyse', 'Calcule le rapport ASAT/ALAT', 'Identifie une cholestase', 'Évalue la fonction hépatique (TP, albumine)', 'Recherche une consommation d\'alcool', 'Recherche une hépatite virale', 'Demande une échographie abdominale', 'Recherche des médicaments hépatotoxiques', 'Hiérarchise les hypothèses', 'Explique la suite au patient'] },
  B5: { title: 'Choc anaphylactique au cabinet', discipline: 'Médecine d\'urgence',
    apt: ['Reconnaît une anaphylaxie', 'Appelle à l\'aide et le 15', 'Allonge le patient jambes surélevées', 'Injecte l\'adrénaline en IM', 'Choisit la bonne dose', 'Choisit le bon site d\'injection', 'Met l\'oxygène', 'Surveille pouls, PA et SpO2', 'Prévoit une deuxième injection si besoin', 'Explique la trousse d\'urgence à la sortie'] },
  R1: { title: 'Prise en charge d\'une colique néphrétique', discipline: 'Urologie', apt: [] },
  R2: { title: 'Céphalée inhabituelle chez une femme de 42 ans', discipline: 'Neurologie', apt: [] },
};

export function contentFor(slot) {
  const s = STATIONS[slot];
  const id = (p, i) => `${p}${i + 1}`;
  return {
    identite: { sdd: s.sdd || '', item: s.item || '', age: '', references_ok: true },
    vignette: { role: '', lieu: '', contexte: '', infos: '', doit: [''], nedoitpas: [''], documents: '', ...(s.vignette || {}) },
    examinateur: { scenario: 'Le candidat dispose de 8 minutes.', consignes: 'Cocher chaque item observé. Ne pas relancer le candidat.' },
    script: { personnage: '', installation: '', histoire: '', demarrage: '', relances: [''], reactions: [{ q: '', r: '' }], attitude: '', neutres: [''], ...(s.script || {}) },
    documents: [],
    materiel: { liste: slot === 'A3' || slot === 'B2' ? [{ article: 'Mannequin', qte: 1 }] : [], disposition: '' },
    grille: {
      apt: s.apt.map((label, i) => ({ id: id('a', i), label, points: 1 })),
      com: s.apt.length ? COM.map((label, i) => ({ id: id('c', i), label })) : [],
      global: GLOBAL,
    },
    pedago: { correction: s.apt.length ? 'Correction détaillée de la station, avec les points clés à retenir.' : '', references: 'Référentiel du collège de la spécialité.' },
  };
}
