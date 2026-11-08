// Ouverture de la saisie, embargo du détail des grilles et liste d'attente : tout dépend de l'heure
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlanning, evalState, evalWindows, detailsState, lastRoundEnd, offerDeadline, freeSeats } from '../public/js/planning-shared.js';
import { examState } from '../src/state.js';

const P = normalizePlanning({ days: [{ date: '2026-11-14' }, { date: '2026-11-21' }] });
const at = (s) => new Date(s).getTime();

test('saisie : une heure avant la première convocation, trois quarts d\'heure après le dernier tour', () => {
  const w = evalWindows(P, 10);
  assert.equal(w.length, 2);
  // première convocation 8 h 15 Paris → ouverture 7 h 15 Paris = 6 h 15 UTC ; dernière série 17 h → fin 18 h 50, fermeture 19 h 35
  assert.equal(w[0].from.toISOString(), '2026-11-14T06:15:00.000Z');
  assert.equal(w[0].to.toISOString(), '2026-11-14T18:35:00.000Z');
});

test('saisie fermée la nuit et entre deux week-ends, ouverte pendant les séries', () => {
  assert.equal(evalState(P, 10, at('2026-11-14T05:00:00Z')).open, false);
  assert.equal(evalState(P, 10, at('2026-11-14T05:00:00Z')).opens_at, '2026-11-14T06:15:00.000Z');
  assert.equal(evalState(P, 10, at('2026-11-14T10:00:00Z')).open, true);
  assert.equal(evalState(P, 10, at('2026-11-14T22:00:00Z')).open, false);
  assert.equal(evalState(P, 10, at('2026-11-17T12:00:00Z')).opens_at, '2026-11-21T06:15:00.000Z');
  assert.equal(evalState(P, 10, at('2026-11-22T12:00:00Z')).open, false);
});

test('saisie forcée dans un sens ou dans l\'autre', () => {
  assert.equal(evalState({ ...P, eval_mode: 'open' }, 10, at('2026-11-17T03:00:00Z')).open, true);
  assert.equal(evalState({ ...P, eval_mode: 'closed' }, 10, at('2026-11-14T10:00:00Z')).open, false);
});

test('une série fermée ne compte pas dans la fenêtre', () => {
  const Q = normalizePlanning({ days: [{ date: '2026-11-14', series: [{ start: '08:30', closed: true }, { start: '14:30' }] }] });
  assert.equal(evalWindows(Q, 10)[0].from.toISOString(), '2026-11-14T12:15:00.000Z');
});

test('ancienne session avec la case cochée : reste ouverte tant que l\'équipe n\'a pas choisi', () => {
  const exam = { planning: JSON.stringify({ days: [{ date: '2026-11-14' }] }), eval_open: 1, show_details: 1 };
  assert.equal(examState(exam, 10, at('2026-12-01T03:00:00Z')).eval.mode, 'open');
  const exam2 = { ...exam, planning: JSON.stringify({ days: [{ date: '2026-11-14' }], eval_mode: 'auto' }) };
  assert.equal(examState(exam2, 10, at('2026-12-01T03:00:00Z')).eval.open, false);
});

test('embargo : détail retenu jusqu\'à la fin du dernier tour de la dernière série', () => {
  const end = lastRoundEnd(P, 10);
  assert.equal(end.toISOString(), '2026-11-21T17:50:00.000Z'); // 18 h 50 à Paris
  assert.deepEqual(detailsState(P, 1, 10, at('2026-11-15T10:00:00Z')).visible, false);
  assert.deepEqual(detailsState(P, 1, 10, at('2026-11-21T18:00:00Z')).visible, true);
  assert.equal(detailsState({ ...P, details_embargo: false }, 1, 10, at('2026-11-15T10:00:00Z')).visible, true);
  assert.equal(detailsState(P, 0, 10, at('2026-12-15T10:00:00Z')).visible, false);
});

test('liste d\'attente : 24 h pour confirmer, jamais moins de 3 h avant la convocation', () => {
  // proposée le jeudi midi pour le samedi 8 h 15 : 24 h pleines
  assert.equal(offerDeadline(P, '2026-11-14', 1, at('2026-11-12T11:00:00Z')).toISOString(), '2026-11-13T11:00:00.000Z');
  // proposée le vendredi 20 h pour le samedi 8 h 15 (7 h 15 UTC) : délai coupé à 4 h 15 UTC
  assert.equal(offerDeadline(P, '2026-11-14', 1, at('2026-11-13T19:00:00Z')).toISOString(), '2026-11-14T04:15:00.000Z');
  // proposée le samedi à 3 h UTC : moins de deux heures pour répondre, rien d'automatique
  assert.equal(offerDeadline(P, '2026-11-14', 1, at('2026-11-14T03:00:00Z')), null);
  assert.equal(offerDeadline({ ...P, waitlist_hours: 12 }, '2026-11-14', 1, at('2026-11-12T11:00:00Z')).toISOString(), '2026-11-12T23:00:00.000Z');
});

test('places libres : les occupées et les séries trop proches sont écartées', () => {
  const taken = new Set(Array.from({ length: 10 }, (_, i) => `2026-11-14|1|${i + 1}`).concat(['2026-11-14|2|1']));
  const free = freeSeats(P, 10, taken, at('2026-11-13T19:00:00Z'));
  assert.ok(!free.some((f) => f.day === '2026-11-14' && f.series === 1));
  assert.equal(free[0].series, 2);
  assert.equal(free[0].seat, 2);
  assert.equal(free.length, 8 * 10 - 11);
});

import { claimsWindow } from '../public/js/planning-shared.js';
test('réclamations : ouvertes 7 jours après la fin de la dernière série, et seulement si le détail est visible', () => {
  assert.equal(claimsWindow(P, 1, 10, at('2026-11-15T10:00:00Z')).open, false); // détail encore retenu
  const w = claimsWindow(P, 1, 10, at('2026-11-22T10:00:00Z'));
  assert.equal(w.open, true);
  assert.equal(w.until, '2026-11-28T17:50:00.000Z');
  assert.equal(claimsWindow(P, 1, 10, at('2026-11-29T10:00:00Z')).open, false);
  assert.equal(claimsWindow(P, 0, 10, at('2026-11-22T10:00:00Z')).open, false); // détail fermé par l'équipe
  assert.equal(claimsWindow({ ...P, claims_days: 0 }, 1, 10, at('2026-11-22T10:00:00Z')).enabled, false);
});
