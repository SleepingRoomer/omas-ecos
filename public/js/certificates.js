// Attestations de participation des évaluateurs, une page A4 chacune
import { api, esc, setTitle, daysLabel } from './ui.js';

export async function certificatesView(app, exam) {
  setTitle(`Attestations, ${exam.name}`);
  const list = await api(`/exams/${exam.id}/evaluators`);
  const off = new Set();
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const draw = () => {
    app.innerHTML = `<div class="no-print" style="margin-bottom:14px">
      <h1>Attestations des évaluateurs</h1>
      <p class="muted">${list.length} évaluateur${list.length > 1 ? 's' : ''}. Décoche ceux qui n'en ont pas besoin (comptes partagés, saisies de test), puis imprime ou enregistre en PDF.</p>
      <div class="cert-pick">${list.map((e, i) => `<label class="check"><input type="checkbox" data-i="${i}" ${off.has(i) ? '' : 'checked'}><span>${esc(e.name)} <span class="small muted">(${e.n} grilles)</span></span></label>`).join('')}</div>
      <button class="primary" data-print style="margin-top:12px">Imprimer ${list.length - off.size} attestation${list.length - off.size > 1 ? 's' : ''}</button></div>
      ${list.map((e, i) => (off.has(i) ? '' : `<div class="sheet portrait cert">
        <div class="cert-brand"><span class="brand-mark">OMAS</span> OMAS Externat</div>
        <h1>Attestation de participation</h1>
        <p class="cert-body">L'équipe d'OMAS Externat atteste que</p>
        <p class="cert-name">${esc(e.name)}</p>
        <p class="cert-body">a participé en tant qu'évaluateur aux ECOS blancs <strong>«&nbsp;${esc(exam.name)}&nbsp;»</strong>${e.days.length ? `, ${esc(daysLabel(e.days))}` : ''}.</p>
        <p class="cert-body">${e.n > 1 ? `${e.n} passages évalués` : 'Un passage évalué'}, ${e.slots.length > 1 ? 'aux stations' : 'à la station'} ${e.slots.map(esc).join(', ')}.</p>
        <p class="cert-thanks">Merci pour ton temps et ton exigence : c'est grâce à des bénévoles comme toi que l'entraînement aux ECOS reste accessible à tous les externes.</p>
        <div class="cert-sign"><div>Fait le ${today}</div><div>Pour l'équipe OMAS Externat<div class="cert-line"></div></div></div>
      </div>`)).join('')}`;
    app.querySelectorAll('[data-i]').forEach((cb) => cb.addEventListener('change', () => { const i = +cb.dataset.i; if (cb.checked) off.delete(i); else off.add(i); draw(); }));
  };
  draw();
}
