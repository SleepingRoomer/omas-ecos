// Planning : rotation des candidats, horaires d'une série, numéros, vœux et attribution
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlanning, rotationFor, seriesTimes, candidateNumber, checkWishes, seriesStartsAt } from '../public/js/planning-shared.js';
import { assign } from '../public/js/matching.js';

const SLOTS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'];

test('places 1 à 5 sur le circuit A, 6 à 10 sur le B, changement à la pause', () => {
  const rot = rotationFor(SLOTS);
  assert.equal(rot.at(1, 1), 'A1');
  assert.equal(rot.at(6, 1), 'B1');
  assert.equal(rot.at(1, 5), 'A5');
  assert.equal(rot.at(1, 6), 'B1');
  assert.equal(rot.at(6, 6), 'A1');
  assert.equal(rot.at(3, 4), 'A1'); // A3, A4, A5, puis retour à A1
});

test('chaque candidat passe une fois par chaque salle, et deux candidats ne sont jamais dans la même salle', () => {
  const rot = rotationFor(SLOTS);
  for (let seat = 1; seat <= 10; seat++) assert.equal(new Set(Array.from({ length: 10 }, (_, r) => rot.at(seat, r + 1))).size, 10);
  for (let r = 1; r <= 10; r++) assert.equal(new Set(Array.from({ length: 10 }, (_, s) => rot.at(s + 1, r))).size, 10);
});

test('horaires d\'une série : tours de 10 min, pause de 10 min après 5 tours, débrief de 30 min', () => {
  const P = normalizePlanning({ days: [{ date: '2026-11-14' }] });
  const T = seriesTimes(P, P.days[0].series[0], 10);
  assert.equal(T.start, '08:30');
  assert.equal(T.rounds[4].end, '09:20');
  assert.deepEqual(T.pause, { start: '09:20', end: '09:30' });
  assert.equal(T.rounds[5].start, '09:30');
  assert.equal(T.end, '10:20');
  assert.deepEqual(T.debrief, { start: '10:20', end: '10:50' });
});

test('numéro J<jour>-S<série>-<place>', () => {
  const P = normalizePlanning({ days: [{ date: '2026-11-14' }, { date: '2026-11-15' }] });
  assert.equal(candidateNumber(P, '2026-11-15', 3, 4), 'J2-S3-04');
  assert.equal(candidateNumber(P, '2026-12-01', 1, 1), null);
});

test('heure de Paris : hiver UTC+1, été UTC+2, jour du changement compris', () => {
  assert.equal(seriesStartsAt('2026-11-14', '08:30').toISOString(), '2026-11-14T07:30:00.000Z');
  assert.equal(seriesStartsAt('2026-06-13', '08:30').toISOString(), '2026-06-13T06:30:00.000Z');
  assert.equal(seriesStartsAt('2027-03-28', '08:30').toISOString(), '2027-03-28T06:30:00.000Z'); // passage à l'heure d'été cette nuit-là
  assert.equal(seriesStartsAt('2026-10-25', '08:30').toISOString(), '2026-10-25T07:30:00.000Z'); // retour à l'heure d'hiver
});

test('vœux : au moins 6 possibles, au plus 3 idéaux', () => {
  const P = normalizePlanning({ days: [{ date: '2026-11-14' }, { date: '2026-11-15' }] }); // 8 séries
  const keys = P.days.flatMap((d) => d.series.map((_, i) => `${d.date}|${i + 1}`));
  const w = Object.fromEntries(keys.map((k, i) => [k, i < 4 ? 2 : 1]));
  assert.match(checkWishes(P, w).errors.join(), /au plus 3/);
  const w2 = Object.fromEntries(keys.map((k, i) => [k, i < 3 ? 0 : 1]));
  assert.match(checkWishes(P, w2).errors.join(), /au moins 6/);
  assert.deepEqual(checkWishes(P, Object.fromEntries(keys.map((k, i) => [k, i < 2 ? 0 : i < 4 ? 2 : 1]))).errors, []);
});

test('attribution des vœux : capacités respectées, aucun « impossible », tirage reproductible', () => {
  const P = normalizePlanning({ days: [{ date: '2026-11-14' }] }); // 4 séries
  const keys = P.days[0].series.map((_, i) => `2026-11-14|${i + 1}`);
  const cands = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, wishes: JSON.stringify({ [keys[0]]: 2, [keys[1]]: i % 2 ? 0 : 1, [keys[2]]: 1, [keys[3]]: 1 }) }));
  const P2 = { ...P, wishes_min: 2 };
  const a = assign(P2, cands, 3, 42);
  assert.equal(a.stats.placed, 12);
  assert.equal(a.stats.impossible, 0);
  const per = {}; for (const k of a.result.values()) per[k] = (per[k] || 0) + 1;
  assert.ok(Object.values(per).every((n) => n <= 3));
  assert.equal(a.stats.ideal, 3); // la première série est pleine d'idéaux
  const b = assign(P2, cands, 3, 42);
  assert.deepEqual([...a.result], [...b.result]);
});
