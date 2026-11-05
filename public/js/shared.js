// Logique partagée entre le serveur (Worker) et le navigateur.
// Aucun accès au DOM ici.

export const DOMAINS = [
  'Annonce',
  'Communication interprofessionnelle',
  'Éducation / prévention',
  'Entretien / interrogatoire',
  'Examen clinique',
  'Iconographie',
  'Procédure',
  'Stratégie diagnostique',
  'Stratégie pertinente de prise en charge',
  'Synthèse des résultats paracliniques',
  'Urgence',
];

export const TYPES = {
  PS: 'Avec PS',
  PSS: 'Avec PSS',
  SANS: 'Sans PS ni PSS',
  MANNEQUIN: 'Mannequin / matériel',
};

export const TYPES_SHORT = {
  PS: 'avec PS',
  PSS: 'avec PSS',
  SANS: 'sans PS ni PSS',
  MANNEQUIN: 'sur mannequin',
};

export const TYPE_LINE = {
  PS: "Il s'agit d'une station AVEC PS",
  PSS: "Il s'agit d'une station AVEC PSS",
  SANS: "Il s'agit d'une station SANS PS ni PSS",
  MANNEQUIN: "Il s'agit d'une station SANS PS ni PSS",
};

// Circuit de validation (ordre d'affichage)
export const STATUSES = {
  a_attribuer: 'À attribuer',
  redaction: 'Rédaction',
  relecture_pair: 'Relecture pair',
  relecture_expert: 'Relecture expert',
  test: 'Test chronométré',
  corrections: 'Corrections',
  validation: 'Validation finale',
  validee: 'Validée',
  refusee: 'Remplacée',
};

export const COM_ATTENDUS = [
  'Aptitude à questionner',
  'Aptitude à écouter',
  'Communication non verbale',
  "Aptitude à structurer/mener l'entrevue",
  'Aptitude à fournir les renseignements au patient/aux aidants',
  'Aptitude à coopérer avec les pairs',
  'Aptitude à proposer une prise en charge (situations aiguës/chroniques)',
  'Aptitude à faire la synthèse des données',
  'Aptitude à réaliser le geste technique/la procédure',
  "Aptitude à mener l'examen clinique",
  "Aptitude à structurer l'examen clinique",
  'Aptitude à exposer oralement son analyse',
];

export const COM_LEVELS = [
  { v: 0, l: 'Insuffisant' },
  { v: 0.25, l: 'Limite' },
  { v: 0.5, l: 'Satisfaisant' },
  { v: 0.75, l: 'Très satisfaisant' },
  { v: 1, l: 'Remarquable' },
];

export const GLOBAL_LEVELS = ['Insuffisante', 'Limite', 'Satisfaisante', 'Très satisfaisante', 'Remarquable'];

// Répartition proposée dans le guide d'organisation
export const DEFAULT_SLOTS = [
  { slot: 'A1', domain: 'Entretien / interrogatoire', type: 'PS', played: 1 },
  { slot: 'A2', domain: 'Iconographie', type: 'SANS', played: 1 },
  { slot: 'A3', domain: 'Procédure', type: 'MANNEQUIN', played: 1 },
  { slot: 'A4', domain: 'Annonce', type: 'PS', played: 1 },
  { slot: 'A5', domain: 'Stratégie diagnostique', type: 'SANS', played: 1 },
  { slot: 'B1', domain: 'Communication interprofessionnelle', type: 'PSS', played: 1 },
  { slot: 'B2', domain: 'Examen clinique', type: 'MANNEQUIN', played: 1 },
  { slot: 'B3', domain: 'Éducation / prévention', type: 'PS', played: 1 },
  { slot: 'B4', domain: 'Synthèse des résultats paracliniques', type: 'SANS', played: 1 },
  { slot: 'B5', domain: 'Urgence', type: 'SANS', played: 1 },
  { slot: 'R1', domain: 'Stratégie pertinente de prise en charge', type: 'SANS', played: 0 },
  { slot: 'R2', domain: 'Entretien / interrogatoire', type: 'PS', played: 0 },
];

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function emptyContent() {
  return {
    identite: { sdd: '', item: '', age: '', references_ok: false },
    vignette: { role: '', lieu: '', contexte: '', infos: '', doit: [''], nedoitpas: [''], documents: '' },
    examinateur: { scenario: '', consignes: '' },
    script: {
      personnage: '', installation: '', histoire: '', demarrage: '',
      relances: [''], reactions: [{ q: '', r: '' }], attitude: '', neutres: [''],
    },
    documents: [],
    materiel: { liste: [], disposition: '' },
    grille: { apt: [], com: [], global: ['', '', '', '', ''] },
    pedago: { correction: '', references: '' },
  };
}

// Complète un contenu partiel avec la structure par défaut
export function normalizeContent(c) {
  const base = emptyContent();
  const out = { ...base, ...(c || {}) };
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = { ...base[k], ...((c || {})[k] || {}) };
    }
  }
  if (!Array.isArray(out.documents)) out.documents = [];
  if (!Array.isArray(out.grille.apt)) out.grille.apt = [];
  if (!Array.isArray(out.grille.com)) out.grille.com = [];
  if (!Array.isArray(out.grille.global) || out.grille.global.length !== 5) out.grille.global = ['', '', '', '', ''];
  if (!Array.isArray(out.materiel.liste)) out.materiel.liste = [];
  return out;
}

const filled = (s) => typeof s === 'string' && s.trim().length > 0;
const filledList = (a) => Array.isArray(a) ? a.filter(filled) : [];

// Contrôles qualité affichés dans l'éditeur et exigés à la validation finale
export function qualityChecks(station, content) {
  const c = normalizeContent(content);
  const out = [];
  const err = (m) => out.push({ level: 'error', msg: m });
  const warn = (m) => out.push({ level: 'warn', msg: m });

  if (!filled(station.title)) err('Donner un titre à la station.');
  if (!station.domain) err('Choisir le domaine évalué.');
  if (!filled(c.identite.sdd)) warn('Préciser la situation de départ (SDD).');

  if (!filled(c.vignette.role) || !filled(c.vignette.lieu)) err('Vignette : préciser le rôle du candidat et le lieu.');
  if (!filled(c.vignette.contexte)) err('Vignette : décrire le contexte.');
  if (filledList(c.vignette.doit).length === 0) err('Vignette : au moins une consigne « Vous devez ».');
  const words = [c.vignette.contexte, c.vignette.infos, ...filledList(c.vignette.doit), ...filledList(c.vignette.nedoitpas)]
    .join(' ').split(/\s+/).filter(Boolean).length;
  if (words > 160) warn(`Vignette longue (${words} mots) : elle doit pouvoir se lire en 1 minute environ.`);

  if (!filled(c.examinateur.consignes) && !filled(c.examinateur.scenario)) warn("Ajouter les consignes à l'examinateur.");

  if (station.type === 'PS' || station.type === 'PSS') {
    if (!filled(c.script.histoire)) err('Script : écrire l\'histoire que raconte le PS.');
    if (!filled(c.script.demarrage)) err('Script : donner la phrase de démarrage.');
    if (filledList(c.script.neutres).length === 0) warn('Script : prévoir des réponses neutres aux questions imprévues.');
  }
  if (station.type === 'MANNEQUIN' && c.materiel.liste.length === 0) err('Matériel : lister le mannequin et le matériel.');

  const apt = c.grille.apt.filter((i) => filled(i.label));
  if (apt.length < 10 || apt.length > 15) err(`Grille : ${apt.length} indicateur(s) d'aptitudes cliniques, il en faut 10 à 15.`);
  const com = c.grille.com.filter((i) => filled(i.label));
  if (com.length < 2 || com.length > 5) err(`Grille : ${com.length} attendu(s) de communication, il en faut 2 à 5.`);
  if (c.grille.global.filter(filled).length < 5) warn('Grille : décrire les 5 niveaux de performance globale.');

  if (!filled(c.pedago.correction)) err('Fiche pédagogique : rédiger la correction.');
  if (!filled(c.pedago.references)) warn('Fiche pédagogique : ajouter les références.');
  return out;
}

// Calcul de la note d'une évaluation (convention OMAS)
export function computeScore(grille, answers, absent) {
  if (absent) return { points: null, max: null, score: null };
  const apt = (grille.apt || []).filter((i) => filled(i.label));
  const com = (grille.com || []).filter((i) => filled(i.label));
  let points = 0;
  let max = 0;
  for (const i of apt) {
    const p = Number(i.points) > 0 ? Number(i.points) : 1;
    max += p;
    if (answers?.apt?.[i.id]?.ok === true) points += p;
  }
  for (const i of com) {
    max += 1;
    const v = Number(answers?.com?.[i.id]);
    if (!Number.isNaN(v)) points += Math.min(1, Math.max(0, v));
  }
  const score = max > 0 ? Math.round((points / max) * 20 * 100) / 100 : null;
  return { points, max, score };
}

// Liste des champs non remplis dans une grille saisie
export function missingAnswers(grille, answers, global, absent) {
  if (absent) return [];
  const miss = [];
  for (const i of (grille.apt || []).filter((x) => filled(x.label))) {
    const a = answers?.apt?.[i.id];
    if (!a || typeof a.ok !== 'boolean') miss.push(i.id);
  }
  for (const i of (grille.com || []).filter((x) => filled(x.label))) {
    if (answers?.com?.[i.id] === undefined || answers?.com?.[i.id] === null) miss.push(i.id);
  }
  if (global === null || global === undefined || global === '') miss.push('global');
  return miss;
}

// Rangs « à égalité » : 1, 2, 2, 4
export function rankMap(entries) {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const ranks = new Map();
  let prev = null;
  let prevRank = 0;
  sorted.forEach((e, i) => {
    const r = prev !== null && Math.abs(e.value - prev) < 1e-9 ? prevRank : i + 1;
    ranks.set(e.id, r);
    prev = e.value;
    prevRank = r;
  });
  return ranks;
}
