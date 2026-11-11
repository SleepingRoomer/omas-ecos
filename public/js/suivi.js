// Suivi des stations : ce qui a été écrit et joué, par domaine ECOS, par discipline et par situation de départ,
// pour choisir les prochaines stations en connaissance de cause. Tout est calculé ici, à partir de la banque.
import { api, esc, setTitle, frDate, fmt, plate, dom, disc } from './ui.js';
import { DOMAINS, DISCIPLINES, domainIcon, disciplineIcon, STATUSES } from './shared.js';
import { SDD, SDD_FAMILIES, sddNumbers, sddLabel } from './sdd.js';

const months = (a, b = new Date()) => Math.round((new Date(b) - new Date(a)) / (30.44 * 864e5));
const SCOPES = { ecrites: 'Toutes les stations écrites', validees: 'Validées', jouees: 'Déjà jouées' };

// Une « lignée » : une station et ses reprises d'une session à l'autre, comptée une seule fois
export function lineagesOf(rows) {
  const by = new Map();
  for (const r of rows) (by.get(r.lineage) || by.set(r.lineage, []).get(r.lineage)).push(r);
  return [...by.values()].map((v) => {
    v.sort((a, b) => String(b.starts_on || '').localeCompare(String(a.starts_on || '')));
    const best = v.find((x) => x.status === 'validee') || v[0];
    const played = v.filter((x) => x.played && x.n_eval && !x.is_reserve);
    const n = played.reduce((a, x) => a + x.n_eval, 0);
    const mean = n ? played.reduce((a, x) => a + (x.mean || 0) * x.n_eval, 0) / n : null;
    const last = played.map((x) => x.starts_on).filter(Boolean).sort().pop() || null;
    return { best, versions: v, played, n, mean, last, sdd: sddNumbers(best.sdd), valid: best.status === 'validee' };
  });
}

// Statistiques d'un groupe de lignées (un domaine, une discipline, une SDD)
const stats = (L) => {
  const played = L.filter((l) => l.played.length);
  const n = played.reduce((a, l) => a + l.n, 0);
  return {
    total: L.length, valid: L.filter((l) => l.valid).length, played: played.length,
    last: played.map((l) => l.last).filter(Boolean).sort().pop() || null,
    mean: n ? played.reduce((a, l) => a + (l.mean || 0) * l.n, 0) / n : null,
  };
};

const bar = (v, max) => `<span class="cov-bar" role="img" aria-label="${v} sur ${max}"><i style="width:${max ? Math.round((v / max) * 100) : 0}%"></i></span>`;
const lastTag = (d) => (!d ? '<span class="faint">jamais</span>' : `<span style="white-space:nowrap">${esc(new Date(d).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }))}</span>`);

export async function suiviView(app, base = '#/admin') {
  setTitle('Suivi des stations');
  const [B, O] = await Promise.all([api('/bank'), api('/redaction/overview')]);
  const all = lineagesOf(B.rows);
  const f = { scope: 'ecrites', sddOnlyMissing: false, q: '', famOpen: new Set([1]), session: '' };

  const draw = async () => {
    const L = all.filter((l) => f.scope === 'ecrites' || (f.scope === 'validees' ? l.valid : l.played.length));
    const byDomain = DOMAINS.map((d) => [d, stats(L.filter((l) => l.best.domain === d))]);
    const known = new Set(DISCIPLINES.map(([n]) => n));
    const discNames = [...DISCIPLINES.map(([n]) => n), ...new Set(L.map((l) => l.best.discipline).filter((x) => x && !known.has(x)))];
    const byDisc = discNames.map((d) => [d, stats(L.filter((l) => l.best.discipline === d))]).sort((a, b) => a[1].total - b[1].total || a[0].localeCompare(b[0], 'fr'));
    const bySdd = SDD.map((_, i) => L.filter((l) => l.sdd.includes(i + 1)));
    const covered = bySdd.filter((x) => x.length).length;
    const maxD = Math.max(1, ...byDomain.map(([, s]) => s.total));
    const maxC = Math.max(1, ...byDisc.map(([, s]) => s.total));
    const noSdd = L.filter((l) => !l.sdd.length).length;
    const discUsed = byDisc.filter(([, s]) => s.total);
    // croisement discipline × domaine : où il y a déjà beaucoup, où il n'y a rien
    const cross = (d, dm) => L.filter((l) => l.best.discipline === d && l.best.domain === dm).length;
    const maxX = Math.max(1, ...discUsed.flatMap(([d]) => DOMAINS.map((dm) => cross(d, dm))));
    const q = f.q.toLowerCase();

    app.innerHTML = `
      <a class="back" href="${base === '#/redaction' ? '#/redaction' : '#/admin'}">${base === '#/redaction' ? 'Mes stations' : 'Sessions'}</a>
      <div class="row between"><h1>Suivi des stations</h1>
        <div class="seg small" role="tablist" style="max-width:520px">${Object.entries(SCOPES).map(([k, l]) => `<button type="button" data-scope="${k}" class="${f.scope === k ? 'on' : ''}" aria-selected="${f.scope === k}">${l}</button>`).join('')}</div></div>
      <p class="lede">Chaque station compte une fois, même reprise dans plusieurs sessions. ${f.scope === 'jouees' ? 'Seules les stations déjà passées par des candidats sont comptées.' : f.scope === 'validees' ? 'Seules les stations validées sont comptées : ce qui est prêt à rejouer.' : 'Les stations en cours de rédaction et celles de la réserve sont comptées aussi.'}</p>
      <div class="facts">
        <div><div class="v">${L.length}</div><div class="l">stations</div></div>
        <div><div class="v">${covered}<span class="faint"> / 356</span></div><div class="l">situations de départ traitées</div></div>
        <div><div class="v">${byDomain.filter(([, s]) => s.total).length}<span class="faint"> / ${DOMAINS.length}</span></div><div class="l">domaines ECOS</div></div>
        <div><div class="v">${discUsed.length}</div><div class="l">disciplines</div></div>
        <div><div class="v" style="${noSdd ? 'color:var(--r)' : ''}">${noSdd}</div><div class="l">sans situation de départ renseignée</div></div>
      </div>

      <div class="suivi-grid">
      <section class="panel"><h2>Domaines ECOS</h2>
        <div class="table-wrap" style="box-shadow:none"><table><thead><tr><th>Domaine</th><th>Stations</th><th class="num">Validées</th><th class="num">Jouées</th><th>Dernière fois</th><th class="num">Moyenne</th></tr></thead><tbody>
        ${byDomain.map(([d, s]) => `<tr${s.total ? '' : ' class="cov-zero"'}><td>${domainIcon(d)}&nbsp;${esc(d)}</td><td><div class="row" style="flex-wrap:nowrap;gap:8px">${bar(s.total, maxD)}<b class="num">${s.total}</b></div></td>
          <td class="num">${s.valid}</td><td class="num">${s.played}</td><td class="small">${lastTag(s.last)}</td><td class="num">${s.mean === null ? '' : fmt(s.mean, 1)}</td></tr>`).join('')}
        </tbody></table></div></section>

      <section class="panel"><h2>Disciplines</h2><p class="small muted" style="margin-top:-6px">Les moins représentées d'abord.</p>
        <div class="table-wrap cov-scroll" style="box-shadow:none"><table><thead><tr><th>Discipline</th><th>Stations</th><th class="num">Jouées</th><th>Dernière fois</th></tr></thead><tbody>
        ${byDisc.map(([d, s]) => `<tr${s.total ? '' : ' class="cov-zero"'}><td style="white-space:nowrap">${disciplineIcon(d)} ${esc(d)}</td><td><div class="row" style="flex-wrap:nowrap;gap:8px">${bar(s.total, maxC)}<b class="num">${s.total}</b></div></td>
          <td class="num">${s.played}</td><td class="small">${lastTag(s.last)}</td></tr>`).join('')}
        </tbody></table></div></section>
      </div>

      ${discUsed.length ? `<section class="panel"><h2>Disciplines et domaines croisés</h2>
        <p class="small muted" style="margin-top:-6px">Plus la case est foncée, plus il y a de stations. Une case vide est une idée de station.</p>
        <div class="table-wrap" style="box-shadow:none"><table class="cov-cross"><thead><tr><th>Discipline</th>${DOMAINS.map((dm) => `<th class="num" title="${esc(dm)}">${domainIcon(dm)}</th>`).join('')}</tr></thead><tbody>
        ${discUsed.slice().sort((a, b) => b[1].total - a[1].total).map(([d]) => `<tr><td class="small">${esc(d)}</td>${DOMAINS.map((dm) => { const v = cross(d, dm);
          return `<td class="num" title="${esc(d)}, ${esc(dm)} : ${v}" style="${v ? `background:rgba(45,47,132,${(0.12 + 0.7 * (v / maxX)).toFixed(2)});color:${v / maxX > 0.5 ? '#fff' : 'var(--ink)'}` : ''}">${v || ''}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div>
        <p class="small muted">${DOMAINS.map((dm) => `${domainIcon(dm)} ${esc(dm)}`).join(' · ')}</p></section>` : ''}

      <section class="panel"><h2>Situations de départ</h2>
        <div class="row" style="margin-bottom:10px"><input id="sq" type="search" placeholder="Numéro ou mot : 161, douleur, ECG…" value="${esc(f.q)}" style="max-width:320px" aria-label="Chercher une situation de départ">
          <label class="check" style="margin:0"><input type="checkbox" id="smiss" ${f.sddOnlyMissing ? 'checked' : ''}><span>Seulement celles qui n'ont pas de station</span></label></div>
        ${SDD_FAMILIES.map((fam) => {
          const nums = Array.from({ length: fam.to - fam.from + 1 }, (_, k) => fam.from + k);
          const cov = nums.filter((n) => bySdd[n - 1].length).length;
          const shown = nums.filter((n) => (!f.sddOnlyMissing || !bySdd[n - 1].length) && (!q || String(n) === q || sddLabel(n).toLowerCase().includes(q)));
          const open = f.famOpen.has(fam.id) || !!q;
          return `<details class="cov-fam" data-fam="${fam.id}" ${open ? 'open' : ''}><summary><strong>${esc(fam.name)}</strong>
            <span class="row" style="gap:8px;flex-wrap:nowrap">${bar(cov, nums.length)}<span class="small">${cov} / ${nums.length}</span></span></summary>
            <ul class="cov-sdd">${shown.map((n) => { const st = bySdd[n - 1];
              return `<li class="${st.length ? 'ok' : ''}"><span class="n">${n}</span><span class="t">${esc(SDD[n - 1])}</span>
                <span class="s small">${st.length ? st.map((l) => `<a href="#/station/${l.best.id}" title="${esc(STATUSES[l.best.status] || '')}">${esc(l.best.title)}</a>${l.played.length ? '' : ' <span class="faint">(pas encore jouée)</span>'}`).join(', ') : '<span class="faint">aucune station</span>'}</span></li>`; }).join('') || '<li class="faint">Rien avec ce filtre.</li>'}</ul></details>`; }).join('')}
      </section>

      <section class="panel" id="balance"><h2>Équilibre d'une session</h2>
        <p class="small muted" style="margin-top:-6px">Les stations jouées d'une session, et ce qui se répète ou manque.</p>
        <select id="ses" aria-label="Session" style="max-width:360px"><option value="">Choisir une session</option>${O.sessions.map((e) => `<option value="${e.id}" ${String(e.id) === f.session ? 'selected' : ''}>${esc(e.name)}${e.starts_on ? `, ${esc(frDate(e.starts_on))}` : ''}</option>`).join('')}</select>
        <div id="bal"></div></section>`;

    app.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { f.scope = b.dataset.scope; draw(); }));
    app.querySelector('#smiss').addEventListener('change', (e) => { f.sddOnlyMissing = e.target.checked; draw(); });
    app.querySelector('#sq').addEventListener('input', (e) => { f.q = e.target.value.trim(); const p = e.target.selectionStart; draw().then(() => { const i = app.querySelector('#sq'); i.focus(); i.setSelectionRange(p, p); }); });
    app.querySelectorAll('.cov-fam').forEach((d) => d.addEventListener('toggle', () => { const id = Number(d.dataset.fam); if (d.open) f.famOpen.add(id); else f.famOpen.delete(id); }));
    app.querySelector('#ses').addEventListener('change', (e) => { f.session = e.target.value; balance(); });
    if (f.session) balance();
  };

  // Les stations jouées d'une session : répétitions et manques, et des pistes dans la banque
  const balance = async () => {
    const box = app.querySelector('#bal');
    if (!f.session) { box.innerHTML = ''; return; }
    const st = (await api(`/exams/${f.session}/stations`)).filter((s) => s.played);
    const count = (k) => st.reduce((m, s) => (s[k] ? m.set(s[k], (m.get(s[k]) || 0) + 1) : m), new Map());
    const doms = count('domain'); const discs = count('discipline');
    const sdds = new Map(); st.forEach((s) => sddNumbers(s.sdd).forEach((n) => sdds.set(n, (sdds.get(n) || 0) + 1)));
    const missingDom = DOMAINS.filter((d) => !doms.has(d));
    const rep = [...[...doms].filter(([, n]) => n > 2).map(([d, n]) => `${n} stations en ${esc(d)}`), ...[...discs].filter(([, n]) => n > 1).map(([d, n]) => `${n} stations de ${esc(d)}`),
      ...[...sdds].filter(([, n]) => n > 1).map(([k, n]) => `${n} stations sur la SDD ${esc(sddLabel(k))}`)];
    // pistes : stations validées de la banque, dans un domaine absent, pas jouées depuis au moins un an
    const ids = new Set(st.map((s) => s.id));
    const ideas = all.filter((l) => l.valid && !l.versions.some((v) => ids.has(v.id)) && (!l.last || months(l.last) >= 12) && missingDom.includes(l.best.domain)).slice(0, 8);
    box.innerHTML = `<div class="table-wrap" style="box-shadow:none;margin-top:12px"><table><thead><tr><th>Salle</th><th>Station</th><th>Domaine</th><th>Discipline</th><th>Situation de départ</th></tr></thead><tbody>
      ${st.map((s) => `<tr><td>${plate(s.slot)}</td><td>${esc(s.title || 'Sans titre')}</td><td class="small">${s.domain ? dom(s.domain) : '<span class="faint">à fixer</span>'}</td>
        <td class="small">${s.discipline ? disc(s.discipline) : ''}</td><td class="small">${esc(s.sdd || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Pas encore de station jouée.</td></tr>'}</tbody></table></div>
      ${rep.length ? `<p class="alert warn small">${rep.join(' · ')}.</p>` : st.length ? '<p class="alert ok small">Ni domaine, ni discipline, ni situation de départ en double.</p>' : ''}
      ${st.length && missingDom.length ? `<p class="small"><strong>Domaines absents :</strong> ${missingDom.map((d) => `${domainIcon(d)} ${esc(d)}`).join(', ')}.</p>` : ''}
      ${ideas.length ? `<p class="small"><strong>Dans la banque, validées et pas jouées depuis un an :</strong> ${ideas.map((l) => `<a href="#/apercu/${l.best.id}/dossier" target="_blank">${esc(l.best.title)}</a> <span class="faint">(${esc(l.best.domain)})</span>`).join(', ')}.</p>` : ''}`;
  };
  await draw();
}
