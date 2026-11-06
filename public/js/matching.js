// Attribution des créneaux d'après les vœux.
// Chaque billet donne droit à une place : on cherche la répartition qui respecte les « impossible »
// de chacun, donne un créneau idéal au plus grand nombre, et départage les égalités par tirage au sort.
// Technique : flot de coût minimal (étudiants → séries, capacité = places par série).

import { checkWishes, seriesKeys } from './planning-shared.js';

// Générateur pseudo-aléatoire reproductible : le même numéro de tirage redonne la même attribution
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COST = { 2: 0, 1: 10, 0: 1000 };

export function assign(planning, candidates, capacity, seed) {
  const keys = seriesKeys(planning);
  const rand = rng(seed);
  const people = candidates.map((c) => ({ id: c.id, w: checkWishes(planning, c.wishes ? JSON.parse(c.wishes) : null).wishes }));
  // graphe : 0 = source, 1..n = étudiants, n+1..n+k = séries, n+k+1 = puits
  const n = people.length; const k = keys.length; const S = 0; const T = n + k + 1; const N = T + 1;
  const to = []; const cap = []; const cost = []; const head = new Array(N).fill(-1); const next = [];
  const edge = (u, v, c, w) => {
    to.push(v); cap.push(c); cost.push(w); next.push(head[u]); head[u] = to.length - 1;
    to.push(u); cap.push(0); cost.push(-w); next.push(head[v]); head[v] = to.length - 1;
  };
  people.forEach((p, i) => {
    edge(S, 1 + i, 1, 0);
    keys.forEach((key, j) => edge(1 + i, 1 + n + j, 1, COST[p.w[key]] + rand() * 0.9));
  });
  keys.forEach((_, j) => edge(1 + n + j, T, capacity, 0));

  // plus courts chemins successifs (Bellman-Ford avec file), un étudiant placé par itération
  for (let flow = 0; flow < n; flow++) {
    const dist = new Array(N).fill(Infinity); const prev = new Array(N).fill(-1); const inQ = new Array(N).fill(false);
    dist[S] = 0; const q = [S]; inQ[S] = true;
    while (q.length) {
      const u = q.shift(); inQ[u] = false;
      for (let e = head[u]; e !== -1; e = next[e]) {
        if (cap[e] > 0 && dist[u] + cost[e] < dist[to[e]] - 1e-9) {
          dist[to[e]] = dist[u] + cost[e]; prev[to[e]] = e;
          if (!inQ[to[e]]) { q.push(to[e]); inQ[to[e]] = true; }
        }
      }
    }
    if (dist[T] === Infinity) break;
    for (let v = T; v !== S; v = to[prev[v] ^ 1]) { cap[prev[v]] -= 1; cap[prev[v] ^ 1] += 1; }
  }

  const result = new Map();
  people.forEach((p, i) => {
    for (let e = head[1 + i]; e !== -1; e = next[e]) {
      const v = to[e];
      if (v > n && v <= n + k && cap[e] === 0 && cost[e] >= 0) result.set(p.id, keys[v - 1 - n]);
    }
  });
  const levels = people.map((p) => (result.has(p.id) ? p.w[result.get(p.id)] : null));
  return {
    seed, result,
    stats: {
      total: n, placed: result.size,
      ideal: levels.filter((l) => l === 2).length, possible: levels.filter((l) => l === 1).length, impossible: levels.filter((l) => l === 0).length,
      withWishes: candidates.filter((c) => c.wishes).length,
      idealWanted: people.filter((p) => Object.values(p.w).includes(2)).length,
    },
  };
}
