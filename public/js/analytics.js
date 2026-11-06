// Onglet Analyse d'une session : qualité de l'examen, des stations, des items et des évaluateurs.
// Tous les calculs se font dans le navigateur à partir du jeu de données brut (/dataset),
// pour ne pas charger le serveur.
import { api, esc, fmt, pct, plate, downloadCsv, dom, longDate, frDate } from './ui.js';
import { normalizeContent, GLOBAL_LEVELS } from './shared.js';

// ---------- statistiques ----------
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const variance = (xs) => { const m = mean(xs); return xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : null; };
const sd = (xs) => { const v = variance(xs); return v === null ? null : Math.sqrt(v); };
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const p = (s.length - 1) * q; const lo = Math.floor(p);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo);
}
// Concordance d'un binôme sur une note (ICC à un facteur, deux évaluateurs interchangeables)
function icc(pairs) {
  const n = pairs.length;
  if (n < 5) return null;
  const gm = mean(pairs.flat());
  const msb = (2 * pairs.reduce((a, [x, y]) => a + ((x + y) / 2 - gm) ** 2, 0)) / (n - 1);
  const msw = pairs.reduce((a, [x, y]) => { const m = (x + y) / 2; return a + (x - m) ** 2 + (y - m) ** 2; }, 0) / n;
  return msb + msw ? (msb - msw) / (msb + msw) : null;
}
// Samedi du week-end d'une date (le dimanche est rattaché à la veille)
function weekendOf(day) {
  if (!day) return null;
  const d = new Date(`${day}T12:00:00Z`);
  const back = d.getUTCDay() === 0 ? 1 : (d.getUTCDay() + 1) % 7;
  return new Date(d.getTime() - back * 864e5).toISOString().slice(0, 10);
}
const circuitColor = (slot) => (/^A/i.test(slot) ? 'var(--viz-a)' : /^B/i.test(slot) ? 'var(--viz-b)' : 'var(--viz-n)');
const tip = (lines) => `data-tip="${esc(lines.join('\n'))}" tabindex="0"`;
const r2 = (x) => (x === null ? '–' : fmt(x, 2));
const signed = (v) => (v === null ? '–' : Math.abs(v) < 0.05 ? fmt(0, 1) : `${v > 0 ? '+' : ''}${fmt(v, 1)}`);
const baseName = (n) => (n || 'Sans nom').replace(/\s*\(\d+e saisie\)$/, '').trim();

// ---------- calcul ----------
function compute(D, filter) {
  const stations = D.stations.map((s) => {
    const c = normalizeContent(s.content);
    return { ...s, apt: c.grille.apt.filter((i) => i.label?.trim()), com: c.grille.com.filter((i) => i.label?.trim()) };
  }).filter((s) => s.played);
  const stById = new Map(stations.map((s) => [s.id, s]));
  const cands = D.candidates.map((c) => ({ ...c, prepa: c.extra?.prepa ?? null, weekend: weekendOf(c.day) })).filter((c) => c.status !== 'annule'
    && (!filter.day || c.day === filter.day) && (!filter.series || String(c.series) === filter.series)
    && (!filter.faculty || c.faculty === filter.faculty));
  const candIds = new Set(cands.map((c) => c.id));
  const grids = D.evaluations.filter((e) => stById.has(e.station) && candIds.has(e.candidate));

  // passages : une note par candidat et par station (moyenne du binôme)
  const pass = new Map();
  for (const g of grids) {
    const k = `${g.station}|${g.candidate}`;
    if (!pass.has(k)) pass.set(k, { station: g.station, candidate: g.candidate, grids: [] });
    pass.get(k).grids.push(g);
  }
  for (const p of pass.values()) {
    const sc = p.grids.filter((g) => !g.absent && g.score !== null);
    p.score = sc.length ? mean(sc.map((g) => g.score)) : null;
    p.scored = sc;
  }
  const passages = [...pass.values()];

  // par candidat
  const byCand = new Map(cands.map((c) => [c.id, {}]));
  for (const p of passages) if (p.score !== null) byCand.get(p.candidate)[p.station] = p.score;
  const complete = cands.map((c) => ({ c, s: byCand.get(c.id) })).filter((x) => stations.every((s) => x.s[s.id] !== undefined));
  const avgs = cands.map((c) => mean(Object.values(byCand.get(c.id)))).filter((x) => x !== null);
  const k = stations.length;
  const totals = complete.map((x) => stations.reduce((a, s) => a + x.s[s.id], 0));
  const alpha = complete.length > 10 && k > 1
    ? (k / (k - 1)) * (1 - stations.reduce((a, s) => a + variance(complete.map((x) => x.s[s.id])), 0) / variance(totals)) : null;

  // binômes : les deux premières grilles notées d'un même passage
  const pairs = passages.filter((p) => p.scored.length >= 2).map((p) => ({ ...p, a: p.scored[0], b: p.scored[1] }));

  // stations et items
  const stStats = stations.map((s) => {
    const ps = passages.filter((p) => p.station === s.id && p.score !== null);
    const scores = ps.map((p) => p.score);
    const others = complete.map((x, i) => (totals[i] - x.s[s.id]) / (k - 1));
    const disc = k > 1 ? pearson(complete.map((x) => x.s[s.id]), others) : null;
    const sg = grids.filter((g) => g.station === s.id && !g.absent && g.score !== null);
    const detailed = sg.filter((g) => g.answers && !g.answers.incomplete && g.answers.apt);
    const sp = pairs.filter((p) => p.station === s.id);
    const okDetail = (g) => g.answers && !g.answers.incomplete && g.answers.apt;
    const dp = sp.filter((p) => okDetail(p.a) && okDetail(p.b));
    const items = s.apt.map((it) => {
      const pts = Number(it.points) > 0 ? Number(it.points) : 1;
      const x = detailed.map((g) => (g.answers.apt[it.id]?.ok === true ? 1 : 0));
      const rest = detailed.map((g, i) => (g.points ?? 0) - x[i] * pts);
      const p = x.length ? mean(x) : null;
      let agree = null; let kappa = null;
      if (dp.length >= 5) {
        const a = dp.map((q) => (q.a.answers.apt[it.id]?.ok === true ? 1 : 0));
        const b = dp.map((q) => (q.b.answers.apt[it.id]?.ok === true ? 1 : 0));
        agree = mean(a.map((v, i) => (v === b[i] ? 1 : 0)));
        const pp = mean([...a, ...b]);
        const pe = pp * pp + (1 - pp) * (1 - pp);
        kappa = pe < 1 ? (agree - pe) / (1 - pe) : null;
      }
      const comments = detailed.filter((g) => g.answers.apt[it.id]?.comment).length;
      const flags = [];
      if (p !== null && p < 0.1) flags.push('trop dur');
      if (p !== null && p > 0.95) flags.push('trop facile');
      const r = pearson(x, rest);
      if (r !== null && r < 0.1 && p !== null && p >= 0.1 && p <= 0.95) flags.push('ne départage pas');
      if (agree !== null && agree < 0.75) flags.push('compris différemment');
      return { id: it.id, label: it.label, points: pts, p, r, agree, kappa, comments, flags, n: x.length };
    });
    const com = s.com.map((it) => ({ label: it.label, mean: mean(detailed.map((g) => Number(g.answers.com?.[it.id])).filter((v) => !Number.isNaN(v))) }));
    const diffs = sp.map((p) => Math.abs(p.a.score - p.b.score));
    return {
      ...s, n: scores.length, mean: mean(scores), sd: sd(scores), q1: quantile(scores, 0.25), q3: quantile(scores, 0.75),
      min: scores.length ? Math.min(...scores) : null, max: scores.length ? Math.max(...scores) : null,
      below10: scores.length ? scores.filter((v) => v < 10).length / scores.length : null,
      disc, items, com, pairs: sp.length, gap: mean(diffs), bigGap: diffs.length ? diffs.filter((d) => d > 3).length / diffs.length : null,
      icc: icc(sp.map((p) => [p.a.score, p.b.score])),
      byGlobal: [0, 1, 2, 3, 4].map((l) => { const x = sg.filter((g) => g.global === l); return { l, n: x.length, mean: mean(x.map((g) => g.score)) }; }),
    };
  });
  const stMean = new Map(stStats.map((s) => [s.id, s.mean]));

  // évaluateurs : écart à la moyenne de la station et écart avec le binôme
  const ev = new Map();
  for (const g of grids) {
    if (g.absent || g.score === null) continue;
    const name = baseName(g.evaluator_name);
    if (!ev.has(name)) ev.set(name, { name, dev: [], partner: [], stations: new Set() });
    const e = ev.get(name);
    e.dev.push(g.score - stMean.get(g.station));
    e.stations.add(stById.get(g.station).slot);
  }
  for (const p of pairs) {
    if (baseName(p.a.evaluator_name) === baseName(p.b.evaluator_name)) continue;
    ev.get(baseName(p.a.evaluator_name))?.partner.push(p.a.score - p.b.score);
    ev.get(baseName(p.b.evaluator_name))?.partner.push(p.b.score - p.a.score);
  }
  const evaluators = [...ev.values()].map((e) => ({ name: e.name, n: e.dev.length, dev: mean(e.dev), partner: mean(e.partner), np: e.partner.length, stations: [...e.stations].sort() }))
    .sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev));

  // groupes de candidats (jour, série, faculté) quand l'information existe
  const groupBy = (key, label) => {
    const vals = [...new Set(cands.map((c) => c[key]).filter((v) => v !== null && v !== undefined && v !== ''))].sort();
    if (vals.length < 2) return null;
    return { key, label, rows: vals.map((v) => {
      const xs = cands.filter((c) => c[key] === v).map((c) => mean(Object.values(byCand.get(c.id)))).filter((x) => x !== null);
      return { v, n: xs.length, mean: mean(xs) };
    }) };
  };

  return {
    stations: stStats, cands, grids, passages, complete, avgs, alpha, pairs, evaluators,
    groups: [groupBy('weekend', 'Week-end'), groupBy('day', 'Jour'), groupBy('series', 'Série'), groupBy('faculty', 'Faculté'), groupBy('year', 'Année'), groupBy('prepa', 'Préparation')].filter(Boolean),
    hasGlobal: grids.some((g) => g.global !== null && g.global !== undefined),
  };
}

// ---------- graphiques ----------
function histogram(avgs) {
  if (!avgs.length) return '';
  const lo = Math.max(0, Math.floor(Math.min(...avgs))); const hi = Math.min(20, Math.ceil(Math.max(...avgs)));
  const wd = avgs.length >= 60 ? 0.5 : 1;
  const bins = []; for (let x = lo; x < Math.max(hi, lo + 1) - 1e-9; x += wd) bins.push({ x, n: 0 });
  for (const a of avgs) { const b = bins[Math.min(bins.length - 1, Math.max(0, Math.floor((a - lo) / wd)))]; b.n++; }
  const W = 720; const H = 200; const L = 34; const B = 30; const T = 14;
  const max = Math.max(...bins.map((b) => b.n));
  const step = max > 20 ? 10 : max > 8 ? 5 : 2;
  const y = (v) => T + (H - T - B) * (1 - v / (Math.ceil(max / step) * step));
  const bw = (W - L - 8) / bins.length;
  const m = mean(avgs);
  const mx = L + ((m - lo) / (bins.length * wd)) * (W - L - 8);
  const ticks = []; for (let v = 0; v <= Math.ceil(max / step) * step; v += step) ticks.push(v);
  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="Répartition des moyennes des candidats">
    ${ticks.map((v) => `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="viz-tick" text-anchor="end">${v}</text>`).join('')}
    ${bins.map((b, i) => {
      const x0 = L + i * bw + 1; const w = bw - 2; const yt = y(b.n); const h = y(0) - yt;
      const r = Math.min(4, w / 2, h);
      const path = b.n ? `M${x0},${y(0)} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x0 + w - r} Q${x0 + w},${yt} ${x0 + w},${yt + r} V${y(0)} Z` : '';
      return `<g class="viz-hit" ${tip([`${b.n} candidat${b.n > 1 ? 's' : ''}`, `moyenne de ${fmt(b.x, wd < 1 ? 1 : 0)} à ${fmt(b.x + wd, wd < 1 ? 1 : 0)}`])}>
        <rect x="${x0 - 1}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>
        ${path ? `<path d="${path}" fill="var(--viz-a)" class="viz-mark"/>` : ''}
        ${Number.isInteger(b.x) ? `<text x="${x0 - 1}" y="${H - 10}" class="viz-tick" text-anchor="middle">${b.x}</text>` : ''}</g>`;
    }).join('')}
    <line x1="${mx}" x2="${mx}" y1="${T - 4}" y2="${y(0)}" class="viz-ref"/>
    <text x="${mx + 6}" y="${T + 6}" class="viz-label">moyenne ${fmt(m, 1)}</text>
  </svg>`;
}

// Une ligne par station : boîte de la moitié centrale des notes, point à la moyenne
function stationRanges(S) {
  const x = (v) => `${(v / 20) * 100}%`;
  return `<div class="viz-rows">
    <div class="viz-row viz-axis"><span></span><div class="viz-track bare">${[0, 5, 10, 15, 20].map((v) => `<span style="left:${x(v)}">${v}</span>`).join('')}</div><span></span></div>
    ${S.filter((s) => s.n).map((s) => `<div class="viz-row" ${tip([`${fmt(s.mean, 1)} de moyenne`, `${s.slot} ${s.title || ''}`, `la moitié des candidats entre ${fmt(s.q1, 1)} et ${fmt(s.q3, 1)}`, `de ${fmt(s.min, 1)} à ${fmt(s.max, 1)}, ${s.n} candidats`])}>
      <span class="viz-name">${plate(s.slot, 'sm')} <span>${esc(s.title || s.domain || '')}</span></span>
      <div class="viz-track">
        <i class="viz-ten" style="left:${x(10)}"></i>
        <i class="viz-whisk" style="left:${x(s.min)};width:calc(${x(s.max)} - ${x(s.min)})"></i>
        <i class="viz-box" style="left:${x(s.q1)};width:calc(${x(s.q3)} - ${x(s.q1)});background:${circuitColor(s.slot)}"></i>
        <i class="viz-dot" style="left:${x(s.mean)}"></i></div>
      <span class="viz-val">${fmt(s.mean, 1)}</span></div>`).join('')}
  </div>`;
}

// Barres horizontales simples (une valeur par ligne)
function bars(rows, { max, format, color = 'var(--viz-a)', ref } = {}) {
  const m = max ?? Math.max(...rows.map((r) => r.value ?? 0), 1e-9);
  return `<div class="viz-rows">${rows.map((r) => `<div class="viz-row" ${tip([format(r.value), r.label.replace(/<[^>]+>/g, ''), ...(r.extra || [])])}>
    <span class="viz-name">${r.html ?? esc(r.label)}</span>
    <div class="viz-track">${ref !== undefined ? `<i class="viz-ten" style="left:${(ref / m) * 100}%"></i>` : ''}
      ${r.value !== null ? `<i class="viz-bar" style="width:${Math.max(0.5, (r.value / m) * 100)}%;background:${r.color || color}"></i>` : ''}</div>
    <span class="viz-val">${r.value === null ? '–' : format(r.value)}</span></div>`).join('')}</div>`;
}

// Écart signé autour de zéro (sévérité d'un évaluateur)
function diverging(v, lim = 4) {
  if (v === null) return '';
  const w = Math.min(Math.abs(v), lim) / lim * 50;
  return `<span class="viz-div"><i class="viz-zero"></i><i class="viz-bar" style="left:${v < 0 ? 50 - w : 50}%;width:${w}%"></i></span>`;
}

function setupTooltips(root) {
  let t = document.getElementById('viz-tip');
  if (!t) { t = document.createElement('div'); t.id = 'viz-tip'; t.setAttribute('role', 'tooltip'); document.body.append(t); }
  const show = (el, x, y) => {
    const [head, ...rest] = el.dataset.tip.split('\n');
    t.replaceChildren();
    const b = document.createElement('strong'); b.textContent = head; t.append(b);
    for (const line of rest) { const d = document.createElement('div'); d.textContent = line; t.append(d); }
    t.style.display = 'block';
    const r = t.getBoundingClientRect();
    t.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 14)}px`;
    t.style.top = `${Math.max(8, y - r.height - 10)}px`;
  };
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => { t.style.display = 'none'; });
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    el.addEventListener('blur', () => { t.style.display = 'none'; });
  });
}

// ---------- rendu ----------
const alphaWord = (a) => (a === null ? '' : a >= 0.8 ? 'bonne' : a >= 0.7 ? 'correcte' : a >= 0.6 ? 'limite' : 'faible');
const iccWord = (v) => (v === null ? '' : v >= 0.75 ? 'bon accord' : v >= 0.5 ? 'accord moyen' : 'accord faible');
const FLAG_HELP = {
  'trop dur': 'réussi par moins de 10 % des candidats',
  'trop facile': 'réussi par plus de 95 % des candidats',
  'ne départage pas': 'le réussir ne va pas avec une meilleure note sur le reste de la station',
  'compris différemment': 'les deux évaluateurs du binôme sont en désaccord plus d\'une fois sur quatre',
};

function render(box, D, A, filter, exam) {
  const S = A.stations;
  const items = S.flatMap((s) => s.items.map((i) => ({ ...i, slot: s.slot, title: s.title })));
  const toReview = items.filter((i) => i.flags.length).sort((a, b) => b.flags.length - a.flags.length || (a.agree ?? 1) - (b.agree ?? 1));
  const m = mean(A.avgs); const s = sd(A.avgs);
  const binomeShare = A.passages.length ? A.pairs.length / A.passages.length : 0;
  const gapAll = mean(A.pairs.map((p) => Math.abs(p.a.score - p.b.score)));
  const iccAll = icc(A.pairs.map((p) => [p.a.score, p.b.score]));
  const evFlag = A.evaluators.filter((e) => e.n >= 5 && Math.abs(e.dev) >= 2);
  const opts = (key) => [...new Set(D.candidates.map((c) => c[key]).filter((v) => v !== null && v !== '' && v !== undefined))].sort();
  const sel = (key, label, fmtv = (v) => v) => { const o = opts(key); return o.length > 1 ? `<label class="viz-filter">${label}
    <select data-filter="${key}"><option value="">Tous</option>${o.map((v) => `<option value="${esc(v)}" ${String(filter[key] ?? '') === String(v) ? 'selected' : ''}>${esc(fmtv(v))}</option>`).join('')}</select></label>` : ''; };
  const filters = sel('day', 'Jour') + sel('series', 'Série', (v) => `Série ${v}`) + sel('faculty', 'Faculté');

  const missing = [];
  if (!D.candidates.some((c) => c.day)) missing.push(['Le jour et la série de passage', 'pour voir si les candidats du deuxième week-end font mieux que ceux du premier, ou si une série du matin est pénalisée.']);
  if (!D.candidates.some((c) => c.faculty || c.year)) missing.push(['La faculté et l\'année', 'pour comparer les profils et repérer qui a le plus besoin d\'entraînement. L\'export de la billetterie les contient souvent.']);
  if (!D.candidates.some((c) => c.extra?.prepa)) missing.push(['La préparation suivie (tutorat, prépa privée, rien)', 'une question à ajouter dans le formulaire de la billetterie ; l\'import des inscrits a une colonne prévue pour elle.']);
  if (!A.hasGlobal) missing.push(['La performance globale', 'notée par la plateforme à chaque grille : elle permet de vérifier que la note de la grille colle à l\'impression de l\'évaluateur.']);

  box.innerHTML = `
    ${filters ? `<div class="row viz-filters">${filters}</div>` : ''}
    <div class="facts">
      <div><div class="v">${A.avgs.length}</div><div class="l">candidats évalués, ${A.complete.length} sur toutes les stations</div></div>
      <div><div class="v">${fmt(m, 1)}<span class="faint" style="font-size:1rem"> ± ${fmt(s, 1)}</span></div><div class="l">moyenne générale et écart-type</div></div>
      <div><div class="v">${r2(A.alpha)}</div><div class="l">fiabilité de l'examen (alpha), ${alphaWord(A.alpha) || 'trop peu de données'}</div></div>
      <div><div class="v">${pct(binomeShare)}</div><div class="l">des passages notés en binôme</div></div>
      <div><div class="v">${gapAll === null ? '–' : fmt(gapAll, 1)}</div><div class="l">points d'écart moyen dans un binôme, sur 20</div></div>
    </div>

    <h2>Ce qu'il faut retenir</h2>
    <ul class="viz-take">
      ${A.alpha !== null ? `<li>L'examen classe les candidats de façon <strong>${alphaWord(A.alpha)}</strong> (alpha ${r2(A.alpha)} sur ${S.length} stations). Au-dessus de 0,70, le classement est assez stable pour être communiqué ; en dessous, une station mal calibrée pèse trop.</li>` : ''}
      ${S.filter((x) => x.mean !== null && (x.mean < 8 || x.mean > 15)).map((x) => `<li>${plate(x.slot, 'sm')} ${esc(x.title || '')} a une moyenne de <strong>${fmt(x.mean, 1)}</strong>, hors de la fourchette 8 à 15 visée par le guide.</li>`).join('')}
      ${S.filter((x) => x.disc !== null && x.disc < 0.2).map((x) => `<li>${plate(x.slot, 'sm')} ${esc(x.title || '')} départage peu (r = ${r2(x.disc)}) : bien la réussir ne va pas avec une bonne note ailleurs. À relire en priorité.</li>`).join('')}
      ${toReview.length ? `<li><strong>${toReview.length} items</strong> sur ${items.length} sont à revoir (liste plus bas)${(() => { const n = toReview.filter((i) => i.flags.includes('compris différemment')).length; return n ? `, dont ${n} que les binômes n'ont pas compris de la même façon` : ''; })()}.</li>` : ''}
      ${iccAll !== null ? `<li>Les binômes s'accordent sur la note avec un ICC de ${r2(iccAll)} (${iccWord(iccAll)}) ; ${pct(mean(A.pairs.map((p) => (Math.abs(p.a.score - p.b.score) > 3 ? 1 : 0))))} des binômes ont plus de 3 points d'écart.</li>` : ''}
      ${evFlag.length ? `<li>${evFlag.length} évaluateur${evFlag.length > 1 ? 's notent' : ' note'} à plus de 2 points de la moyenne de leur station. Le double regard en binôme corrige en partie cet effet.</li>` : ''}
    </ul>

    <h2>Répartition des moyennes</h2>
    <div class="panel">${histogram(A.avgs)}
      <p class="small muted" style="margin:6px 0 0">${A.avgs.filter((x) => x < 10).length} candidats sous 10, ${A.avgs.filter((x) => x >= 15).length} à 15 ou plus. Médiane ${fmt(quantile(A.avgs, 0.5), 1)}.</p></div>

    <h2>Les stations</h2>
    <div class="panel">${stationRanges(S)}
      <p class="small muted viz-legend"><span><i style="background:var(--viz-a)"></i>circuit A</span><span><i style="background:var(--viz-b)"></i>circuit B</span>
        <span><i class="dot"></i>moyenne</span> La barre couvre la moitié centrale des candidats, le trait fin va de la plus basse à la plus haute note, le repère vertical marque 10.</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Station</th><th class="num">Moyenne</th><th class="num">Écart-type</th><th class="num">Sous 10</th>
        <th class="num" title="Corrélation entre la note de la station et la moyenne des autres stations">Départage</th>
        <th class="num">Binômes</th><th class="num" title="Écart moyen entre les deux évaluateurs d'un binôme">Écart binôme</th><th class="num" title="Concordance des notes du binôme">ICC</th><th>À voir</th></tr></thead>
      <tbody>${S.map((x) => {
        const f = [];
        if (x.mean !== null && (x.mean < 8 || x.mean > 15)) f.push('moyenne hors de 8 à 15');
        if (x.disc !== null && x.disc < 0.2) f.push('départage peu');
        if (x.icc !== null && x.icc < 0.5) f.push('binômes peu d\'accord');
        const n = x.items.filter((i) => i.flags.length).length; if (n) f.push(`${n} item${n > 1 ? 's' : ''}`);
        return `<tr><td><div class="row" style="flex-wrap:nowrap">${plate(x.slot)}<div><strong>${esc(x.title || '')}</strong><div class="small muted">${dom(x.domain)}</div></div></div></td>
          <td class="num"><strong>${fmt(x.mean, 1)}</strong></td><td class="num">${fmt(x.sd, 1)}</td><td class="num">${pct(x.below10)}</td>
          <td class="num">${r2(x.disc)}</td><td class="num">${x.pairs}</td><td class="num">${x.gap === null ? '–' : fmt(x.gap, 1)}</td><td class="num">${r2(x.icc)}</td>
          <td>${f.map((t) => `<span class="pill warn">${esc(t)}</span>`).join(' ')}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted">Départage : au-dessus de 0,30 la station distingue bien les candidats solides, sous 0,20 elle mesure autre chose que le reste de l'examen (ou elle est trop dure, trop facile, ou notée de façon instable).</p>

    <h2>Items à revoir</h2>
    <p class="muted small">${Object.entries(FLAG_HELP).map(([k, v]) => `<strong>${k}</strong> : ${v}`).join('. ')}.</p>
    ${toReview.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Station</th><th>Item</th><th class="num">Réussite</th><th class="num" title="Corrélation entre l'item et le reste de la grille">Départage</th><th class="num">Accord binôme</th><th>Pourquoi</th></tr></thead>
      <tbody>${toReview.map((i) => `<tr><td>${plate(i.slot, 'sm')}</td><td style="min-width:280px">${esc(i.label)}</td>
        <td class="num">${pct(i.p)}</td><td class="num">${r2(i.r)}</td><td class="num">${i.agree === null ? '–' : pct(i.agree)}</td>
        <td>${i.flags.map((f) => `<span class="pill warn" title="${esc(FLAG_HELP[f])}">${esc(f)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="alert info">Aucun item ne sort des seuils.</p>'}
    <div class="row" style="margin-top:10px"><button class="small" id="csv-items">Exporter tous les items (CSV)</button></div>

    <h3>Détail par station</h3>
    ${S.map((x) => `<details class="panel" style="margin:8px 0;padding:14px 18px"><summary class="row" style="cursor:pointer">${plate(x.slot)} <strong>${esc(x.title || '')}</strong>
        <span class="spacer"></span><span class="pill">${x.items.length} items</span>${x.items.some((i) => i.flags.length) ? `<span class="pill warn">${x.items.filter((i) => i.flags.length).length} à revoir</span>` : ''}</summary>
      ${bars(x.items.map((i, n) => ({ label: `${n + 1}. ${i.label}`, html: `<span class="viz-item">${n + 1}. ${esc(i.label)}</span>`, value: i.p,
        color: i.flags.length ? 'var(--viz-warn)' : circuitColor(x.slot),
        extra: [`départage ${r2(i.r)}`, i.agree !== null ? `accord binôme ${pct(i.agree)}` : '', i.comments ? `${i.comments} commentaire(s)` : ''].filter(Boolean) })), { max: 1, format: (v) => pct(v) })}
      ${x.com.length ? `<h3>Communication</h3>${bars(x.com.map((c) => ({ label: c.label, value: c.mean })), { max: 1, format: (v) => `${fmt(v, 2)} sur 1`, color: 'var(--viz-n)' })}` : ''}
    </details>`).join('')}

    <h2>Les binômes d'évaluateurs</h2>
    ${A.pairs.length ? `<p class="muted small">${A.pairs.length} passages notés par deux évaluateurs. Un écart moyen sous 1,5 point est très bon ; au-dessus de 3, la grille laisse trop de place à l'interprétation.</p>
      <div class="panel">${bars(S.filter((x) => x.pairs).map((x) => ({ label: `${x.slot} ${x.title || ''}`, html: `${plate(x.slot, 'sm')} <span>${esc(x.title || '')}</span>`, value: x.gap, color: circuitColor(x.slot),
        extra: [`${x.pairs} binômes`, `${pct(x.bigGap)} avec plus de 3 points d'écart`, `ICC ${r2(x.icc)}`] })), { format: (v) => `${fmt(v, 1)} pt`, ref: 3, max: Math.max(4, ...S.map((x) => x.gap ?? 0)) })}
        <p class="small muted" style="margin:6px 0 0">Écart moyen entre les deux notes d'un même passage, sur 20. Le repère vertical marque 3 points.</p></div>`
    : '<p class="alert info">Aucun passage noté en binôme dans cette sélection.</p>'}

    <h2>Les évaluateurs</h2>
    <p class="muted small">Écart moyen de chaque évaluateur à la moyenne de sa station : négatif, il note plus sévèrement que les autres ; positif, plus généreusement. Une différence de niveau entre candidats joue aussi, donc on ne regarde que les écarts nets sur au moins 5 grilles. Ces chiffres servent à mieux former, pas à juger.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Évaluateur</th><th>Stations</th><th class="num">Grilles</th><th class="num">Écart à la station</th><th style="width:180px"><span class="sr-only">Écart</span></th><th class="num">Écart avec son binôme</th><th></th></tr></thead>
      <tbody>${A.evaluators.map((e, i) => `<tr ${i >= 15 ? 'class="ev-more" hidden' : ''}><td>${esc(e.name)}</td><td>${e.stations.map((x) => plate(x, 'sm')).join(' ')}</td><td class="num">${e.n}</td>
        <td class="num">${signed(e.dev)}</td><td>${diverging(e.dev)}</td>
        <td class="num">${e.np ? `${signed(e.partner)} <span class="small faint">(${e.np})</span>` : '–'}</td>
        <td>${e.n >= 5 && e.dev <= -2 ? '<span class="pill">plus sévère</span>' : e.n >= 5 && e.dev >= 2 ? '<span class="pill">plus généreux</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
    ${A.evaluators.length > 15 ? `<div class="row" style="margin-top:10px"><button class="small" id="ev-all">Voir les ${A.evaluators.length} évaluateurs</button><span class="small muted">Classés du plus grand écart au plus petit.</span></div>` : ''}

    ${A.hasGlobal ? `<h2>Note de la grille et performance globale</h2>
      <p class="muted small">Si la grille est bien construite, la note monte avec l'impression globale de l'évaluateur.</p>
      <div class="panel">${bars([0, 1, 2, 3, 4].map((l) => { const xs = A.grids.filter((g) => g.global === l && !g.absent); return { label: GLOBAL_LEVELS[l], value: mean(xs.map((g) => g.score)), extra: [`${xs.length} grilles`] }; }), { max: 20, format: (v) => `${fmt(v, 1)} / 20` })}</div>` : ''}

    ${A.groups.length ? `<h2>Selon le moment du passage et le profil</h2><p class="muted small">Moyenne sur 20 des candidats de chaque groupe. Un écart de moins d'un point entre groupes de cette taille relève du hasard.</p>` : ''}
    ${A.groups.map((g) => `<h3>Par ${g.label.toLowerCase()}</h3><div class="panel">${bars(g.rows.map((r) => ({
      label: g.key === 'series' ? `Série ${r.v}` : g.key === 'day' ? longDate(r.v) : g.key === 'weekend' ? `Week-end du ${frDate(r.v)}` : String(r.v),
      value: r.mean, extra: [`${r.n} candidats`] })), { max: 20, format: (v) => fmt(v, 1) })}</div>`).join('')}

    ${missing.length ? `<div class="panel"><h2>Pour aller plus loin</h2><p class="small muted">Ces informations manquent dans cette session. Avec elles, l'analyse s'enrichit d'elle-même.</p>
      <ul>${missing.map(([a, b]) => `<li><strong>${a}</strong>, ${b}</li>`).join('')}</ul></div>` : ''}`;

  box.querySelectorAll('[data-filter]').forEach((s) => s.addEventListener('change', () => {
    filter[s.dataset.filter] = s.value || null;
    render(box, D, compute(D, filter), filter, exam);
  }));
  box.querySelector('#ev-all')?.addEventListener('click', (e) => { box.querySelectorAll('.ev-more').forEach((r) => { r.hidden = false; }); e.target.remove(); });
  box.querySelector('#csv-items').addEventListener('click', () => downloadCsv(`items-${exam.id}.csv`, [
    ['Station', 'Titre', 'Item', 'Points', 'Grilles', 'Réussite', 'Départage', 'Accord binôme', 'Kappa binôme', 'Commentaires', 'À revoir'],
    ...items.map((i) => [i.slot, i.title, i.label, i.points, i.n, i.p === null ? '' : i.p.toFixed(3).replace('.', ','),
      i.r === null ? '' : i.r.toFixed(3).replace('.', ','), i.agree === null ? '' : i.agree.toFixed(3).replace('.', ','),
      i.kappa === null ? '' : i.kappa.toFixed(3).replace('.', ','), i.comments, i.flags.join(', ')]),
  ]));
  setupTooltips(box);
}

export async function analyticsTab(box, exam) {
  box.innerHTML = '<p class="muted">Chargement des grilles…</p>';
  const D = await (await fetch(`/api/exams/${exam.id}/dataset`, { credentials: 'same-origin' })).json();
  if (!D.evaluations?.length) { box.innerHTML = '<p class="alert info">Aucune grille saisie : l\'analyse apparaîtra avec les premières grilles.</p>'; return; }
  const filter = {};
  render(box, D, compute(D, filter), filter, exam);
}
