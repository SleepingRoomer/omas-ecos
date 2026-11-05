import { api, esc, nl, fmt, setTitle } from './ui.js';
import { COM_LEVELS } from './shared.js';

let timer = null;

function render(R, opts = {}) {
  const c = R.candidate;
  const S = R.summary;
  const levelName = (v) => COM_LEVELS.find((l) => l.v === v)?.l || fmt(v);
  const evaluated = R.stations.filter((s) => s.score !== undefined);
  const gaps = evaluated.filter((s) => s.mean !== null).map((s) => ({ ...s, gap: s.score - s.mean })).sort((a, b) => b.gap - a.gap);

  const head = `
    ${opts.back ? `<p class="small no-print"><a href="${opts.back}">← Retour</a></p>` : ''}
    <div class="row between"><div><h1>${esc(c.first_name)} ${esc(c.last_name)}</h1>
      <div class="muted small">${esc(R.exam.name)}${c.number ? ` · candidat <span class="code">${esc(c.number)}</span>` : ''}</div></div>
      <button id="refresh" class="small no-print">Actualiser</button></div>`;

  if (!S) {
    return `${head}<div class="card"><p>Tes résultats apparaîtront ici dès que l'équipe les ouvrira.</p></div>`;
  }

  const rankBlock = S.rank
    ? `<div class="v">${S.rank}<span class="small muted"> / ${S.ranked}</span></div><div class="l">rang provisoire</div>`
    : `<div class="v">–</div><div class="l">rang : dès tes ${S.total_stations} stations saisies</div>`;

  return `${head}
    <div class="grid grid-4" style="margin-top:12px">
      <div class="stat hl">${rankBlock}</div>
      <div class="stat"><div class="v">${fmt(S.avg)}</div><div class="l">moyenne /20</div></div>
      <div class="stat"><div class="v">${fmt(S.cohort_mean)}</div><div class="l">moyenne des candidats classés</div></div>
      <div class="stat"><div class="v">${S.evaluated}<span class="small muted"> / ${S.total_stations}</span></div><div class="l">stations saisies</div></div>
    </div>
    <p class="small muted">Classement provisoire entre les ${S.ranked} candidats dont toutes les stations sont saisies, sur ${S.registered} inscrits.
      Il évolue à chaque série jusqu'au dernier jour de la session. Mis à jour à ${new Date(R.updated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.</p>
    ${gaps.length >= 3 ? `<div class="grid grid-2">
      <div class="card"><h3>Tes points forts</h3><ul>${gaps.slice(0, 2).map((s) => `<li>${esc(s.domain || s.title)} : ${fmt(s.score, 1)} (moyenne ${fmt(s.mean, 1)})</li>`).join('')}</ul></div>
      <div class="card"><h3>À travailler en priorité</h3><ul>${gaps.slice(-2).reverse().map((s) => `<li>${esc(s.domain || s.title)} : ${fmt(s.score, 1)} (moyenne ${fmt(s.mean, 1)})</li>`).join('')}</ul></div>
    </div>` : ''}
    <h2>Détail par station</h2>
    ${R.stations.map((s) => {
      const has = s.score !== undefined;
      return `<details class="st-res" ${opts.open ? 'open' : ''}>
        <summary>${has && s.rank ? `<span class="badge">Rang ${s.rank} / ${s.n}</span>` : ''}
          <span><strong>${esc(s.domain || '')}</strong>${s.title ? `<span class="muted"> · ${esc(s.title)}</span>` : ''}</span>
          <span class="spacer"></span>
          ${has ? `<span class="badge dark">${fmt(s.score)} / 20</span>` : s.absent ? '<span class="badge warn">absent</span>' : '<span class="badge">pas encore saisie</span>'}</summary>
        <div class="body">
          ${has ? `<div class="row between small"><span>${fmt(s.points)} / ${fmt(s.max_points)} points</span><span class="muted">moyenne de la station : ${fmt(s.mean)} / 20</span></div>
            <div class="bar"><span style="width:${Math.max(0, Math.min(100, s.score * 5))}%"></span></div>` : ''}
          ${s.apt ? `<h3>Aptitudes cliniques et techniques</h3>
            ${s.apt.map((i) => `<div class="it ${i.ok ? 'ok' : 'ko'}"><span class="mark">${i.ok ? '✓' : '✗'}</span><span>${esc(i.label)}</span><span class="pts">${i.ok ? i.points : 0} / ${i.points}</span></div>
              ${i.comment ? `<div class="item-comment">${esc(i.comment)}</div>` : ''}`).join('')}
            <h3>Communication et attitudes</h3>
            ${s.com.map((i) => `<div class="it ${i.value >= 0.5 ? 'ok' : 'ko'}"><span class="mark">${i.value >= 0.5 ? '✓' : '·'}</span><span>${esc(i.label)}</span><span class="pts">${esc(levelName(i.value))} · ${fmt(i.value)}</span></div>`).join('')}
            ${s.comment ? `<div class="alert warn" style="margin-top:10px"><strong>Commentaire de l'évaluateur</strong><br>${nl(s.comment)}</div>` : ''}` : ''}
          ${s.correction ? `<h3>Correction</h3><div>${nl(s.correction.text) || '<span class="muted">Pas encore rédigée.</span>'}</div>
            ${s.correction.references ? `<p class="small muted">Références : ${nl(s.correction.references)}</p>` : ''}`
            : (has ? '<p class="small muted">La correction sera publiée après la fin de la session.</p>' : '')}
        </div></details>`;
    }).join('')}`;
}

export async function studentView(app) {
  setTitle('Mes résultats');
  const load = async () => {
    const open = [...app.querySelectorAll('details.st-res')].map((d) => d.open);
    const R = await api('/me/results');
    app.innerHTML = `<div class="narrow" style="margin:0 auto">${render(R)}</div>`;
    app.querySelectorAll('details.st-res').forEach((d, i) => { if (open[i]) d.open = true; });
    app.querySelector('#refresh')?.addEventListener('click', load);
  };
  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (location.hash.startsWith('#/resultats') && document.visibilityState === 'visible') load().catch(() => {}); }, 60000);
}

export async function adminReport(app, candidateId, examId) {
  const R = await api(`/candidates/${candidateId}/report`);
  setTitle(`${R.candidate.last_name} ${R.candidate.first_name}`);
  app.innerHTML = `<div class="narrow" style="margin:0 auto">${render(R, { back: `#/admin/session/${examId}/resultats` })}
    <p class="small muted no-print">Vue administrateur : tout est visible, quels que soient les réglages de la session.</p></div>`;
  app.querySelector('#refresh')?.addEventListener('click', () => adminReport(app, candidateId, examId));
}
