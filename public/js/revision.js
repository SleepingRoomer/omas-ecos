// Plan de révision personnalisé (d'après les grilles) et progression d'une session à l'autre
import { api, esc, fmt, dom, plate, frDate } from './ui.js';
import { fichesFor, fichesIndex } from './fiches.js';

const DKEY = 'omas_plan_done';
const readDone = () => { try { return JSON.parse(localStorage.getItem(DKEY) || '{}'); } catch { return {}; } };

export async function revisionPlan(box, R) {
  const scored = R.stations.filter((s) => s.score !== undefined && s.score !== null && s.mean !== null);
  if (scored.length < 3) { box.innerHTML = ''; return; }
  let F = null;
  try { F = await fichesIndex(); } catch { F = null; }
  const title = (id) => F?.fiches.find((f) => f.id === id)?.title;
  const withGap = scored.map((s) => ({ ...s, gap: s.score - s.mean })).sort((a, b) => a.gap - b.gap);
  let prio = withGap.filter((s) => s.gap < -0.5 || s.score < 10).slice(0, 4);
  const allGood = !prio.length;
  if (allGood) prio = withGap.slice(0, 2);
  // les domaines : ta moyenne et celle des candidats, station par station
  const byDom = {};
  for (const s of scored) { if (!s.domain) continue; const d = (byDom[s.domain] ||= { me: 0, mean: 0, n: 0 }); d.me += s.score; d.mean += s.mean; d.n += 1; }
  const doms = Object.entries(byDom).map(([k, d]) => ({ k, me: d.me / d.n, gap: (d.me - d.mean) / d.n, n: d.n })).sort((a, b) => a.gap - b.gap);
  const key = (s) => `${R.exam.name}|${s.slot}`;
  const draw = () => {
    const done = readDone();
    box.innerHTML = `<h2>Ton plan de révision</h2>
      <p class="small muted">${allGood ? 'Tu es au-dessus de la moyenne partout : voici les deux stations où tu as le plus de marge.' : `Les ${prio.length} stations où tu as perdu le plus de points par rapport aux autres candidats, avec ce qui a manqué et la fiche à relire.`}
        Coche au fur et à mesure : c'est gardé sur cet appareil.</p>
      <div class="plan">${prio.map((s) => {
        const missed = (s.apt || []).filter((i) => i.share < 1).sort((a, b) => b.points - a.points || a.share - b.share);
        const weakCom = (s.com || []).filter((i) => i.value < 0.5);
        const fiches = fichesFor(s).filter(title);
        const k = key(s);
        return `<div class="plan-item ${done[k] ? 'done' : ''}"><div class="row between" style="align-items:flex-start">
            <div class="row" style="flex-wrap:nowrap">${plate(s.slot)}<div><h3>${esc(s.title || s.domain || '')}</h3>
              <div class="small muted">${s.domain ? dom(s.domain) : ''} · ${fmt(s.score, 1)} pour une moyenne de ${fmt(s.mean, 1)}</div></div></div>
            <label class="check small" style="margin:0"><input type="checkbox" data-done="${esc(k)}" ${done[k] ? 'checked' : ''}><span>Revu</span></label></div>
          ${s.item || s.sdd ? `<p class="small" style="margin:8px 0 0">À reprendre dans le programme : ${s.item ? `<strong>item ${esc(s.item)}</strong>` : ''}${s.item && s.sdd ? ', ' : ''}${s.sdd ? `situation de départ « ${esc(s.sdd)} »` : ''}.</p>` : ''}
          ${missed.length ? `<p class="small" style="margin:8px 0 0"><strong>Ce qui a manqué</strong></p><ul class="small">${missed.slice(0, 5).map((i) => `<li>${esc(i.label)}${i.share > 0 ? ' <span class="muted">(vu par un évaluateur sur deux)</span>' : ''}</li>`).join('')}${missed.length > 5 ? `<li class="muted">et ${missed.length - 5} autre${missed.length > 6 ? 's' : ''}, dans le détail de la station</li>` : ''}</ul>` : ''}
          ${weakCom.length ? `<p class="small" style="margin:6px 0 0">Communication à soigner : ${weakCom.map((i) => esc(i.label)).join(', ')}.</p>` : ''}
          ${s.correction?.text ? '<p class="small" style="margin:6px 0 0">La correction de la station est publiée : relis-la dans le détail plus bas.</p>' : ''}
          ${fiches.length ? `<p class="small fiche-links" style="margin:8px 0 0">Fiche à relire : ${fiches.map((id) => `<a href="#/fiches/${id}">${esc(title(id))}</a>`).join('')}</p>` : ''}</div>`;
      }).join('')}</div>
      ${doms.length >= 3 ? `<h3 style="margin-top:18px">Par domaine de compétence</h3><div class="table-wrap"><table class="small"><thead><tr><th>Domaine</th><th class="num">Ta moyenne</th><th class="num">Écart aux autres</th></tr></thead><tbody>
        ${doms.map((d) => `<tr><td>${dom(d.k)}${d.n > 1 ? ` <span class="faint">(${d.n} stations)</span>` : ''}</td><td class="num">${fmt(d.me, 1)}</td>
          <td class="num" style="color:${d.gap < 0 ? 'var(--ko)' : 'var(--ok)'};font-weight:700">${d.gap > 0 ? '+' : ''}${fmt(d.gap, 1)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${F ? '<p class="small"><a href="#/fiches">Toutes les fiches procédures</a></p>' : ''}`;
    box.querySelectorAll('[data-done]').forEach((cb) => cb.addEventListener('change', () => {
      const d = readDone(); if (cb.checked) d[cb.dataset.done] = 1; else delete d[cb.dataset.done];
      try { localStorage.setItem(DKEY, JSON.stringify(d)); } catch { /* stockage indisponible */ }
      draw();
    }));
  };
  draw();
}

export async function progression(box) {
  let P;
  try { P = await api('/me/progression'); } catch { box.innerHTML = ''; return; }
  const S = P.sessions;
  if (!S.length) { box.innerHTML = ''; return; }
  if (S.length < 2) {
    box.innerHTML = '<h2>Ta progression</h2><p class="small muted">Elle s\'affichera ici dès ta prochaine session d\'ECOS blancs, si tu t\'inscris avec la même adresse e-mail.</p>';
    return;
  }
  // courbe : ta moyenne et celle des candidats, session après session
  const W = 620; const H = 220; const pad = { l: 34, r: 16, t: 16, b: 40 };
  const vals = S.flatMap((s) => [s.avg, s.cohort]).filter((v) => v !== null);
  const lo = Math.max(0, Math.floor(Math.min(...vals) - 1)); const hi = Math.min(20, Math.ceil(Math.max(...vals) + 1));
  const x = (i) => pad.l + (S.length === 1 ? 0 : i * (W - pad.l - pad.r) / (S.length - 1));
  const y = (v) => pad.t + (hi - v) * (H - pad.t - pad.b) / (hi - lo || 1);
  const line = (k) => S.map((s, i) => (s[k] === null ? '' : `${i && S[i - 1][k] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[k]).toFixed(1)}`)).join('');
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const domains = [...new Set(S.flatMap((s) => Object.keys(s.domains)))].sort();
  const first = S[0]; const last = S[S.length - 1];
  const delta = last.avg - first.avg;
  box.innerHTML = `<h2>Ta progression</h2>
    <p>${S.length} sessions. ${delta >= 0 ? `Tu as gagné <strong>${fmt(delta, 1)} point${Math.abs(delta) >= 2 ? 's' : ''}</strong>` : `Tu as perdu ${fmt(-delta, 1)} point${Math.abs(delta) >= 2 ? 's' : ''}`} de moyenne depuis ${esc(first.name)}${first.rank && last.rank ? `, et ton rang est passé de ${first.rank}${first.rank === 1 ? 'er' : 'e'} sur ${first.ranked} à ${last.rank}${last.rank === 1 ? 'er' : 'e'} sur ${last.ranked}` : ''}.</p>
    <svg class="prog-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ta moyenne et celle des candidats à chaque session">
      ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
      <path d="${line('cohort')}" fill="none" stroke="var(--ink-2)" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${line('avg')}" fill="none" stroke="var(--a)" stroke-width="3"/>
      ${S.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.avg)}" r="5" fill="var(--a)"/><text x="${x(i)}" y="${y(s.avg) - 10}" text-anchor="middle" style="font-weight:700;fill:var(--ink)">${fmt(s.avg, 1)}</text>
        <text x="${x(i)}" y="${H - 14}" text-anchor="${i === 0 ? 'start' : i === S.length - 1 ? 'end' : 'middle'}">${esc(s.name.length > 22 ? `${s.name.slice(0, 21)}…` : s.name)}</text>`).join('')}
    </svg>
    <p class="small muted"><span style="color:var(--a);font-weight:700">━</span> ta moyenne · <span>╌</span> moyenne des candidats classés</p>
    ${domains.length ? `<div class="table-wrap"><table class="small"><thead><tr><th>Domaine</th>${S.map((s) => `<th class="num">${esc(s.starts_on ? frDate(s.starts_on) : s.name)}</th>`).join('')}</tr></thead><tbody>
      ${domains.map((d) => `<tr><td>${dom(d)}</td>${S.map((s) => { const v = s.domains[d]; return `<td class="num">${v ? `${fmt(v.score, 1)} <span style="color:${v.score >= v.mean ? 'var(--ok)' : 'var(--ko)'}">${v.score >= v.mean ? '▲' : '▼'}</span>` : '<span class="faint">–</span>'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div><p class="small faint">▲ au-dessus de la moyenne des candidats sur ces stations, ▼ en dessous.</p>` : ''}`;
}
