// Matériel des ECOS : par station, et la liste totale à préparer, avec une check-list pour l'installation de la veille
import { api, esc, plate, longDate, downloadCsv } from './ui.js';

const MARGE = 1.1; // 10 % de consommables en plus, pour les gants déchirés et les imprévus

export async function materielTab(box, exam) {
  const M = await api(`/exams/${exam.id}/materiel`);
  const total = Object.values(M.perDay).reduce((a, b) => a + b, 0);
  const days = M.days.length ? M.days : Object.keys(M.perDay).filter(Boolean);
  // liste consolidée : un article installé dans plusieurs salles s'additionne
  const agg = new Map();
  for (const s of M.stations) for (const m of s.liste) {
    const k = m.article.trim().toLowerCase();
    const a = agg.get(k) || { article: m.article.trim(), installe: 0, conso: 0, slots: [] };
    a.installe += Number(m.installe) || 0;
    a.conso += (Number(m.par_candidat) || 0);
    a.slots.push(s.slot);
    agg.set(k, a);
  }
  const rows = [...agg.values()].sort((a, b) => a.article.localeCompare(b.article, 'fr'));
  const need = (a, n) => Math.ceil(a.conso * n * MARGE);
  const check = (key, label) => `<label class="check mat-check"><input type="checkbox" data-key="${esc(key)}" ${M.checks[key] ? 'checked' : ''}><span>${label}</span></label>`;
  const empty = M.stations.filter((s) => !s.liste.length);
  const draw = () => {
    box.innerHTML = `
      <div class="facts"><div><div class="v">${rows.length}</div><div class="l">articles différents</div></div>
        <div><div class="v">${total}</div><div class="l">candidats sur la session</div></div>
        <div><div class="v">${Object.keys(M.checks).length}</div><div class="l">cases cochées</div></div></div>
      ${empty.length ? `<p class="alert warn">${empty.map((s) => plate(s.slot, 'sm')).join(' ')} ${empty.length > 1 ? 'n\'ont' : 'n\'a'} pas encore de liste de matériel : à compléter dans la fiche de la station.</p>` : ''}
      <div class="row" style="margin:0 0 10px"><button class="small" id="mat-csv">Exporter la liste totale</button><button class="small quiet" data-print>Imprimer</button>
        <span class="small muted">Consommables : quantité par candidat × nombre de candidats, plus 10 %.</span></div>
      <h2>À commander ou à rassembler</h2>
      <div class="table-wrap"><table><thead><tr><th>Article</th><th class="num">Installé</th><th class="num">Consommé, total</th>
        ${days.map((d) => `<th class="num">${esc(longDate(d).split(' ').slice(0, 2).join(' '))}</th>`).join('')}<th>Stations</th><th>Prêt</th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td><strong>${esc(a.article)}</strong></td><td class="num">${a.installe || ''}</td><td class="num">${a.conso ? need(a, total) : ''}</td>
          ${days.map((d) => `<td class="num">${a.conso ? need(a, M.perDay[d] || 0) : ''}</td>`).join('')}
          <td>${[...new Set(a.slots)].map((s) => plate(s, 'sm')).join(' ')}</td><td>${check(`total|${a.article.toLowerCase()}`, '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun matériel renseigné.</td></tr>'}
      </tbody></table></div>
      <h2>Installation de la veille, salle par salle</h2>
      <div class="mat-rooms">${M.stations.map((s) => `<div class="panel mat-room"><div class="row" style="margin-bottom:6px">${plate(s.slot)}<strong>${esc(s.title || '')}</strong></div>
        ${s.liste.map((m) => check(`${s.slot}|${m.article.toLowerCase()}`, `${esc(m.article)}${Number(m.installe) ? ` <span class="muted">× ${m.installe}</span>` : ''}`)).join('') || '<p class="small muted">Rien de renseigné.</p>'}
        ${s.disposition ? `<p class="small muted" style="margin-bottom:0">${esc(s.disposition)}</p>` : ''}
        ${check(`${s.slot}|__salle`, '<strong>Salle prête</strong>')}</div>`).join('')}</div>`;
    box.querySelectorAll('[data-key]').forEach((cb) => cb.addEventListener('change', async () => {
      try { await api(`/exams/${exam.id}/materiel-check`, { method: 'PUT', body: { key: cb.dataset.key, done: cb.checked } }); if (cb.checked) M.checks[cb.dataset.key] = true; else delete M.checks[cb.dataset.key]; }
      catch { cb.checked = !cb.checked; }
    }));
    box.querySelector('#mat-csv').addEventListener('click', () => downloadCsv(`materiel-${exam.id}.csv`, [
      ['Article', 'Installé', 'Consommé, total', ...days, 'Stations'],
      ...rows.map((a) => [a.article, a.installe, a.conso ? need(a, total) : '', ...days.map((d) => (a.conso ? need(a, M.perDay[d] || 0) : '')), [...new Set(a.slots)].join(' ')]),
    ]));
  };
  draw();
}
