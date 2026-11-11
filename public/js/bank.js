// Banque de stations : toutes les stations écrites, session après session, pour en reprendre une
import { api, esc, toast, setTitle, plate, frDate, fmt, dom, disc, rail } from './ui.js';
import { DOMAINS, TYPES, TYPES_SHORT, STATUSES } from './shared.js';

const months = (a, b) => Math.round((new Date(b) - new Date(a)) / (30.44 * 864e5));

// base : '#/admin' pour les organisateurs, '#/redaction' pour le responsable de rédaction
export async function bankView(app, targetId, base = '#/admin') {
  const [B, T] = await Promise.all([api(`/bank${targetId ? `?target=${targetId}` : ''}`), targetId ? api(`/stations/${targetId}`) : null]);
  const target = T?.station || null;
  setTitle(target ? `Banque, salle ${target.slot}` : 'Banque de stations');
  const f = { q: '', domain: target?.domain || '', type: '', valid: true };
  // une lignée = une station et toutes ses reprises ; on montre la version la plus récente
  const byLine = new Map();
  for (const r of B.rows) {
    if (target && r.exam_id === target.exam_id) continue;
    (byLine.get(r.lineage) || byLine.set(r.lineage, []).get(r.lineage)).push(r);
  }
  const lines = [...byLine.values()].map((v) => {
    v.sort((a, b) => String(b.starts_on || '').localeCompare(String(a.starts_on || '')));
    const best = v.find((x) => x.status === 'validee') || v[0];
    const played = v.filter((x) => x.played && x.n_eval);
    const ref = B.target_exam?.starts_on || new Date().toISOString().slice(0, 10);
    const recent = played.filter((x) => x.starts_on && months(x.starts_on, ref) < 12);
    const seen = played.reduce((a, x) => a + (B.overlap[x.exam_id] || 0), 0);
    const n = played.reduce((a, x) => a + x.n_eval, 0);
    const mean = n ? played.reduce((a, x) => a + (x.mean || 0) * x.n_eval, 0) / n : null;
    return { best, versions: v, played, recent, seen, n, mean, text: `${best.title} ${best.item || ''} ${best.sdd || ''} ${best.discipline || ''}`.toLowerCase() };
  });

  const draw = () => {
    const list = lines.filter((l) => (!f.q || l.text.includes(f.q)) && (!f.domain || l.best.domain === f.domain) && (!f.type || l.best.type === f.type) && (!f.valid || l.best.status === 'validee'))
      .sort((a, b) => (a.recent.length > 0) - (b.recent.length > 0) || a.seen - b.seen || b.n - a.n);
    app.innerHTML = `
      <a class="back" href="${target ? (base === '#/redaction' ? `#/redaction/stations/${target.exam_id}` : `#/admin/session/${target.exam_id}/stations`) : (base === '#/redaction' ? '#/redaction/stations' : '#/admin')}">${target ? 'Stations de la session' : 'Sessions'}</a>
      <h1>Banque de stations</h1>
      ${target ? `<div class="panel row">${plate(target.slot, 'lg')}<div><strong>Pour la salle ${esc(target.slot)} de ${esc(target.exam_name)}</strong>
        <div class="small muted">La station choisie remplace le contenu actuel de la salle (vignette, script, grille, documents). Les stations sans conflit passent en premier.</div></div></div>`
      : `<p class="lede">${lines.length} stations écrites depuis le début, avec leurs reprises. Pour en reprendre une, passe par l'onglet Stations d'une session.</p>`}
      <div class="row bank-filters">
        <input id="bq" type="search" placeholder="Titre, item, situation de départ…" value="${esc(f.q)}" style="max-width:300px">
        <select id="bd" aria-label="Domaine"><option value="">Tous les domaines</option>${DOMAINS.map((d) => `<option ${d === f.domain ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        <select id="bt" aria-label="Type"><option value="">Tous les types</option>${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="check" style="margin:0"><input type="checkbox" id="bv" ${f.valid ? 'checked' : ''}><span>Validées seulement</span></label>
        <span class="small muted">${list.length} résultat${list.length > 1 ? 's' : ''}</span></div>
      <div class="bank-list">${list.map((l) => { const s = l.best; return `<article class="bank-card ${l.recent.length || l.seen ? 'warn' : ''}">
        <div class="row between" style="align-items:flex-start"><div><h3 style="margin:0">${esc(s.title)}</h3>
          <div class="tags" style="margin-top:6px">${dom(s.domain)}${s.discipline ? `<span>${disc(s.discipline)}</span>` : ''}<span>${esc(TYPES_SHORT[s.type] || '')}</span>${s.item ? `<span>Item ${esc(s.item)}</span>` : ''}</div></div>
          <div style="text-align:right">${rail(s.status, true)}<div class="small faint">${esc(STATUSES[s.status] || '')}</div></div></div>
        ${s.sdd ? `<p class="small" style="margin:8px 0 0">Situation de départ : ${esc(s.sdd)}</p>` : ''}
        ${l.versions.some((x) => x.is_reserve) && !l.played.length ? '<p class="small" style="margin:8px 0 0"><span class="pill">Réserve</span> écrite hors session</p>' : ''}
        <p class="small muted" style="margin:8px 0 0">${l.played.length ? `Jouée ${l.played.map((x) => `${esc(x.exam_name)} (${esc(x.slot)})`).join(', ')}. ${l.n} passages, moyenne ${fmt(l.mean, 1)} sur 20.` : 'Jamais jouée.'}
          ${s.n_apt ? `${s.n_apt} items de grille.` : ''}${s.n_files ? ` ${s.n_files} fichier${s.n_files > 1 ? 's' : ''} joint${s.n_files > 1 ? 's' : ''}.` : ''}</p>
        ${l.recent.length ? `<p class="small warn-text">Jouée il y a ${months(l.recent[0].starts_on, B.target_exam?.starts_on || new Date())} mois : les candidats en ont peut-être parlé.</p>` : ''}
        ${l.seen ? `<p class="small warn-text"><strong>${l.seen} inscrit${l.seen > 1 ? 's' : ''} de cette session l'${l.seen > 1 ? 'ont' : 'a'} déjà passée.</strong></p>` : ''}
        <div class="row" style="margin-top:10px"><a class="btn small" href="#/apercu/${s.id}/dossier" target="_blank">Dossier complet</a>
          ${target ? `<button class="small primary" data-take="${s.id}">Reprendre dans ${esc(target.slot)}</button>` : ''}</div></article>`; }).join('') || '<p class="panel">Aucune station ne correspond. Essaie sans filtre de domaine ou en incluant les stations non validées.</p>'}</div>`;
    const keep = (id, fn) => app.querySelector(id).addEventListener('input', fn);
    keep('#bq', (e) => { f.q = e.target.value.toLowerCase(); const p = e.target.selectionStart; draw(); const i = app.querySelector('#bq'); i.focus(); i.setSelectionRange(p, p); });
    app.querySelector('#bd').addEventListener('change', (e) => { f.domain = e.target.value; draw(); });
    app.querySelector('#bt').addEventListener('change', (e) => { f.type = e.target.value; draw(); });
    app.querySelector('#bv').addEventListener('change', (e) => { f.valid = e.target.checked; draw(); });
    app.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => {
      const l = lines.find((x) => String(x.best.id) === b.dataset.take);
      const warn = l.seen ? `\n\nAttention : ${l.seen} inscrit(s) l'ont déjà passée.` : '';
      if (!window.confirm(`Reprendre « ${l.best.title} » dans la salle ${target.slot} ? Le contenu actuel de la salle est remplacé.${warn}`)) return;
      try {
        const r = await api(`/stations/${target.id}/copy-from`, { method: 'POST', body: { source_id: l.best.id } });
        toast(r.status === 'validee' ? 'Station reprise, déjà validée' : 'Station reprise, à relire avant validation');
        location.hash = `#/station/${target.id}`;
      } catch (err) { toast(err.message, 'error'); }
    }));
  };
  draw();
}
