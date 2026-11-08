// Notes et classement : la règle OMAS (aptitudes + communication) ÷ maximum × 20, performance globale exclue
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, missingAnswers, rankMap } from '../public/js/shared.js';

const grille = {
  apt: [{ id: 'a1', label: 'Se présente', points: 1 }, { id: 'a2', label: 'Signes de gravité', points: 2 }, { id: 'a3', label: '', points: 5 }, { id: 'a4', label: 'Diagnostic', points: 0 }],
  com: [{ id: 'c1', label: 'Écoute' }, { id: 'c2', label: 'Reformule' }],
};

test('note = (aptitudes + communication) ÷ maximum × 20', () => {
  // max : 1 + 2 + 1 (points à 0 comptent pour 1) + 2 items de communication = 6 ; l'item sans libellé ne compte pas
  const r = computeScore(grille, { apt: { a1: { ok: true }, a2: { ok: true }, a4: { ok: false } }, com: { c1: 1, c2: 0.5 } }, false);
  assert.equal(r.max, 6);
  assert.equal(r.points, 4.5);
  assert.equal(r.score, 15);
});

test('la communication est bornée entre 0 et 1', () => {
  const r = computeScore(grille, { apt: {}, com: { c1: 7, c2: -3 } }, false);
  assert.equal(r.points, 1);
});

test('un absent n\'a pas de note', () => {
  assert.deepEqual(computeScore(grille, {}, true), { points: null, max: null, score: null });
});

test('grille vide : pas de note plutôt qu\'une division par zéro', () => {
  assert.equal(computeScore({ apt: [], com: [] }, {}, false).score, null);
});

test('la performance globale est obligatoire à la saisie mais ne change pas la note', () => {
  const ans = { apt: { a1: { ok: true }, a2: { ok: false }, a4: { ok: true } }, com: { c1: 0.5, c2: 0.5 } };
  assert.deepEqual(missingAnswers(grille, ans, null, false), ['global']);
  assert.deepEqual(missingAnswers(grille, ans, 3, false), []);
  assert.deepEqual(missingAnswers(grille, {}, null, true), []);
  assert.equal(computeScore(grille, ans, false).score, computeScore(grille, { ...ans, global: 0 }, false).score);
});

test('items non remplis repérés', () => {
  assert.deepEqual(missingAnswers(grille, { apt: { a1: { ok: true } }, com: { c1: 0 } }, 2, false), ['a2', 'a4', 'c2']);
});

test('rangs à égalité : 1, 2, 2, 4', () => {
  const r = rankMap([{ id: 'a', value: 15 }, { id: 'b', value: 12 }, { id: 'c', value: 12 }, { id: 'd', value: 9 }]);
  assert.deepEqual([...['a', 'b', 'c', 'd']].map((k) => r.get(k)), [1, 2, 2, 4]);
});

import { sameName } from '../public/js/shared.js';
test('nom d\'évaluateur : « Dr Martin », « martin » et « Martin Dupont » désignent la même personne', () => {
  assert.ok(sameName('Martin Dupont', 'Dr Martin'));
  assert.ok(sameName('Martin Dupont', '  martin   DUPONT '));
  assert.ok(sameName('Inès Chabane', 'ines chabane'));
  assert.ok(sameName('Martin Dupont', 'Dupont Martin'));
  assert.ok(!sameName('Martin Dupont', 'Léa Martin'));
  assert.ok(!sameName('Martin Dupont', 'Ma'));
});

import { stepDeadline, ownerId } from '../public/js/shared.js';
test('circuit de rédaction : échéance de l\'étape en cours et retard, à l\'heure de Paris', () => {
  const D = { relecture_pair: '2026-11-10' };
  const st = { status: 'relecture_pair', author_id: 1, peer_id: 2, expert_id: 3 };
  assert.equal(ownerId(st), 2);
  assert.deepEqual(stepDeadline(st, D, Date.parse('2026-11-08T10:00:00Z')), { date: '2026-11-10', late: 0, left: 2 });
  assert.deepEqual(stepDeadline(st, D, Date.parse('2026-11-13T10:00:00Z')), { date: '2026-11-10', late: 3, left: 0 });
  // 23 h 30 UTC le 10 = déjà le 11 à Paris
  assert.equal(stepDeadline(st, D, Date.parse('2026-11-10T23:30:00Z')).late, 1);
  assert.equal(stepDeadline({ ...st, status: 'validee' }, { validee: '2026-11-01' }), null);
  assert.equal(stepDeadline({ ...st, status: 'redaction' }, D), null);
});

import { guessColumns, isCancelled } from '../public/js/shared.js';
test('import HelloAsso : colonnes du participant plutôt que du payeur, tarif plutôt que montant', () => {
  const head = ['Référence commande', 'Date de la commande', 'Statut de la commande', 'Nom payeur', 'Prénom payeur', 'Email payeur', 'Tarif', 'Montant tarif',
    'Nom', 'Prénom', 'Email', 'Téléphone', 'Faculté', 'Année d\'études', 'Préparation', 'Aménagement'];
  const g = guessColumns(head);
  assert.equal(head[g.last_name], 'Nom');
  assert.equal(head[g.first_name], 'Prénom');
  assert.equal(head[g.email], 'Email');
  assert.equal(head[g.tarif], 'Tarif');
  assert.equal(head[g.year], 'Année d\'études');
  assert.equal(head[g.amenagement], 'Aménagement');
  assert.equal(head[g.status], 'Statut de la commande');
  // sans colonne participant, on se rabat sur le payeur
  const g2 = guessColumns(['Nom payeur', 'Prénom payeur', 'Email payeur', 'Formule']);
  assert.deepEqual([g2.last_name, g2.first_name, g2.email, g2.slot_label], [0, 1, 2, 3]);
  assert.ok(isCancelled('Remboursé') && isCancelled('Annulée') && !isCancelled('Validé'));
});

import { helloassoRows } from '../public/js/repetition.js';
test('export HelloAsso fictif : reconnu par l\'import, adresses fictives, remboursements', () => {
  const rows = helloassoRows(65, 0, [3, 17, 42]);
  const g = guessColumns(rows[0]);
  assert.equal(rows[0][g.email], 'Email');
  assert.equal(rows[0][g.amenagement], 'Besoin particulier');
  assert.ok(rows.slice(1).every((r) => /@exemple\.org$/.test(r[g.email])));
  assert.equal(rows.slice(1).filter((r) => isCancelled(r[g.status])).length, 3);
  assert.equal(new Set(rows.slice(1).map((r) => r[g.email])).size, 65);
});
