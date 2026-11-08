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
