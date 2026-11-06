// Présentation de l'OMAS et d'OMAS Externat, avec les prochains rendez-vous (espaces étudiant et participant)
import { api, esc, nl, daysLabel } from './ui.js';

const KIND = { ecos: ['🩺', 'ECOS blancs'], jp: ['🧤', 'Journée procédure'], autre: ['📅', 'Événement'] };

const dayChip = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `<span class="ag-day"><b>${d.getDate()}</b>${esc(d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''))}</span>`;
};

export function aboutHtml(A) {
  return `<section class="about">
    <h2>L'OMAS et OMAS Externat</h2>
    <div class="about-grid">
      <div class="panel about-card"><div class="about-kicker">L'association</div><div>${nl(A.omas)}</div></div>
      <div class="panel about-card accent"><div class="about-kicker">OMAS Externat</div><div>${nl(A.externat)}</div></div>
    </div>
    ${A.upcoming.length ? `<h3>Les prochains rendez-vous</h3>
      <ol class="agenda">${A.upcoming.slice(0, 8).map((e) => `<li>
        <span class="ag-days">${e.days.slice(0, 4).map(dayChip).join('')}</span>
        <span class="ag-what"><span class="small muted">${KIND[e.kind][0]} ${KIND[e.kind][1]}</span><strong>${esc(e.title)}</strong>
          <span class="small muted">${esc(daysLabel(e.days))}${e.place ? `, ${esc(e.place)}` : ''}</span>
          ${e.text ? `<span class="small">${esc(e.text)}</span>` : ''}</span>
        ${e.url ? `<a class="btn small" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">En savoir plus</a>` : ''}</li>`).join('')}</ol>` : ''}
    ${A.links.length ? `<div class="row about-links">${A.links.map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join('')}</div>` : ''}
  </section>`;
}

export async function aboutSection(box) {
  try { box.innerHTML = aboutHtml(await api('/about')); } catch { box.innerHTML = ''; }
}
