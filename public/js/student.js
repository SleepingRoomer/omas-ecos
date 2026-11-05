import { api, esc, nl, fmt, setTitle, plate, dom, disc } from './ui.js';
import { COM_LEVELS } from './shared.js';

let timer = null;
const ord = (n) => (n === 1 ? 'er' : 'e');
const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function render(R, opts = {}) {
  const c = R.candidate;
  const S = R.summary;
  const levelName = (v) => COM_LEVELS.find((l) => l.v === v)?.l || fmt(v);
  const scored = R.stations.filter((s) => s.score !== undefined && s.score !== null);
  const gaps = scored.filter((s) => s.mean !== null).map((s) => ({ ...s, gap: s.score - s.mean })).sort((a, b) => b.gap - a.gap);

  const head = `
    ${opts.back ? `<a class="back no-print" href="${opts.back}">Classement de la session</a>` : ''}
    <div class="row between" style="align-items:flex-end">
      <div><h1>${esc(c.first_name)} ${esc(c.last_name)}</h1>
        <div class="muted" style="margin-top:4px">${c.number ? `Candidat <span class="cand-no">${esc(c.number)}</span>, ` : ''}${esc(R.exam.name)}</div></div>
      <span class="live">Mis à jour à ${time(R.updated_at)}</span></div>`;

  if (!S) return `${head}<div class="panel"><p>Tes résultats s'afficheront ici dès que l'équipe les ouvrira.</p></div>`;

  const hero = S.rank
    ? `<div class="rank-hero"><div><div class="rank">${S.rank}<sup>${ord(S.rank)}</sup></div>
        <div class="of">sur ${S.ranked} candidat${S.ranked > 1 ? 's' : ''} classé${S.ranked > 1 ? 's' : ''} pour l'instant</div></div>
        <div class="side"><div><div class="v">${fmt(S.avg)}</div><div class="l">ta moyenne sur 20</div></div>
          <div><div class="v">${fmt(S.cohort_mean)}</div><div class="l">moyenne des classés</div></div></div></div>`
    : `<div class="rank-hero pending"><div><div class="rank">${S.evaluated} / ${S.total_stations}</div>
        <div class="of">stations saisies. Ton rang s'affiche quand les ${S.total_stations} le sont.</div></div>
        <div class="side"><div><div class="v">${fmt(S.avg)}</div><div class="l">moyenne provisoire sur 20</div></div>
          <div><div class="v">${S.ranked}</div><div class="l">candidats déjà classés</div></div></div></div>`;

  return `${head}${hero}
    <p class="small muted">Le classement bouge à chaque série, jusqu'au dernier jour de la session : ${S.registered} candidats sont inscrits. La page se met à jour toute seule chaque minute.</p>
    ${gaps.length >= 4 ? `<div class="duo">
      <div><h3>Tes points forts</h3><ul>${gaps.slice(0, 2).map((s) => `<li><span>${s.domain ? dom(s.domain) : esc(s.title)}</span><b>+${fmt(s.gap, 1)}</b></li>`).join('')}</ul>
        <p class="small faint" style="margin:6px 0 0">Écart avec la moyenne de la station</p></div>
      <div><h3>À travailler en priorité</h3><ul>${gaps.slice(-2).reverse().map((s) => `<li><span>${s.domain ? dom(s.domain) : esc(s.title)}</span><b>${fmt(s.gap, 1)}</b></li>`).join('')}</ul>
        <p class="small faint" style="margin:6px 0 0">Écart avec la moyenne de la station</p></div></div>` : ''}
    <h2>Station par station</h2>
    ${R.stations.map((s) => {
      const has = s.score !== undefined && s.score !== null;
      return `<details class="st-res" ${opts.open ? 'open' : ''}>
        <summary>${plate(s.slot, 'lg')}
          <span class="what"><strong>${dom(s.domain)}</strong><span>${esc(s.title || '')}${s.discipline ? `${s.title ? ', ' : ''}${disc(s.discipline)}` : ''}</span></span>
          <span class="score">${has ? `<b>${fmt(s.score, 1)}</b><small> / 20</small>${s.rank ? `<span class="rk">${s.rank}${ord(s.rank)} sur ${s.n}</span>` : ''}`
            : s.absent ? '<span class="pill warn">Absent</span>' : '<span class="pill">En attente</span>'}</span></summary>
        <div class="body">
          ${has ? `<div class="gauge" role="img" aria-label="${fmt(s.score, 1)} sur 20, moyenne de la station ${fmt(s.mean, 1)}">
              <div class="fill" style="width:${Math.max(0, Math.min(100, s.score * 5))}%"></div>
              ${s.mean !== null ? `<div class="mean" style="left:${Math.max(0, Math.min(100, s.mean * 5))}%"><span>moyenne ${fmt(s.mean, 1)}</span></div>` : ''}</div>
            <p class="small muted" style="margin:0">${fmt(s.points)} points sur ${fmt(s.max_points)}.</p>` : ''}
          ${s.apt ? `<h3>Aptitudes cliniques et techniques</h3>
            ${s.apt.map((i) => `<div class="it ${i.ok ? 'ok' : 'ko'}"><span class="mark" aria-label="${i.ok ? 'observé' : 'non observé'}">${i.ok ? '✓' : '✗'}</span><span class="txt">${esc(i.label)}</span><span class="pts">${i.ok ? i.points : 0} / ${i.points}</span>
              ${i.comment ? `<span class="item-comment">${esc(i.comment)}</span>` : ''}</div>`).join('')}
            <h3>Communication et attitudes</h3>
            ${s.com.map((i) => `<div class="it ${i.value >= 0.5 ? 'ok' : 'ko'}"><span class="mark">${i.value >= 0.5 ? '✓' : '·'}</span><span class="txt">${esc(i.label)}</span><span class="pts">${esc(levelName(i.value))}, ${fmt(i.value)}</span></div>`).join('')}
            ${s.comment ? `<div class="evcomment"><b>Le mot de l'évaluateur</b>${nl(s.comment)}</div>` : ''}` : ''}
          ${s.correction ? `<h3>Correction</h3><div>${nl(s.correction.text) || '<span class="muted">Pas encore rédigée.</span>'}</div>
            ${s.correction.references ? `<p class="small muted">Références : ${nl(s.correction.references)}</p>` : ''}`
            : (has ? '<p class="small faint" style="margin-top:14px">La correction arrive après la fin de la session.</p>' : '')}
        </div></details>`;
    }).join('')}`;
}

export async function studentView(app) {
  setTitle('Mes résultats');
  const load = async () => {
    const open = [...app.querySelectorAll('details.st-res')].map((d) => d.open);
    const R = await api('/me/results');
    app.innerHTML = `<div class="narrow">${render(R)}</div>`;
    app.querySelectorAll('details.st-res').forEach((d, i) => { if (open[i]) d.open = true; });
  };
  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (location.hash.startsWith('#/resultats') && document.visibilityState === 'visible') load().catch(() => {}); }, 60000);
}

export async function adminReport(app, candidateId, examId) {
  const R = await api(`/candidates/${candidateId}/report`);
  setTitle(`${R.candidate.last_name} ${R.candidate.first_name}`);
  app.innerHTML = `<div class="narrow">${render(R, { back: `#/admin/session/${examId}/resultats` })}
    <p class="small muted no-print">Vue de l'équipe : tout est visible, quels que soient les réglages de la session.</p></div>`;
}
