// Espace du responsable de rédaction : toutes les stations des sessions, la réserve hors session, l'annuaire.
// Les mêmes écrans servent aux organisateurs (base '#/admin') pour la réserve.
import { api, esc, setTitle, frDate } from './ui.js';
import { stationsTab } from './admin.js';

// Les sessions, puis les stations de celle qu'on choisit
export async function leadStations(app, examId) {
  const O = await api('/redaction/overview');
  if (!examId) {
    setTitle('Toutes les stations');
    app.innerHTML = `<h1>Toutes les stations</h1>
      <p class="lede">Choisis une session pour attribuer ses stations, suivre leur circuit et reprendre une station de la banque dans une salle. Les stations écrites hors session sont dans la <a href="#/redaction/reserve">réserve</a>.</p>
      <div class="lead-sessions">${O.sessions.map((e) => `<a class="panel" href="#/redaction/stations/${e.id}" style="text-decoration:none;color:inherit;display:block">
        <strong>${esc(e.name)}</strong><div class="small muted">${e.starts_on ? esc(frDate(e.starts_on)) : 'dates à fixer'}</div>
        <div class="small" style="margin-top:6px">${e.n_ready} / ${e.n_played} stations jouées validées · ${e.n_stations} en tout</div></a>`).join('') || '<p class="panel">Aucune session pour l\'instant.</p>'}</div>`;
    return;
  }
  const exam = O.sessions.find((e) => String(e.id) === String(examId));
  if (!exam) { app.innerHTML = '<p class="alert error">Session introuvable.</p>'; return; }
  setTitle(`Stations, ${exam.name}`);
  app.innerHTML = `<a class="back" href="#/redaction/stations">Toutes les sessions</a><h1>${esc(exam.name)}</h1>
    <p class="muted">${exam.starts_on ? esc(frDate(exam.starts_on)) : 'Dates à fixer'}</p><div id="st-box"></div>`;
  await stationsTab(app.querySelector('#st-box'), exam, { lead: true });
}

// La réserve : des stations écrites hors session, qu'on reprend ensuite dans une salle avec la banque
export async function reserveView(app, base = '#/redaction') {
  const O = await api('/redaction/overview');
  setTitle('Réserve de stations');
  app.innerHTML = `<a class="back" href="${base === '#/admin' ? '#/admin' : '#/redaction'}">${base === '#/admin' ? 'Sessions' : 'Mes stations'}</a>
    <h1>Réserve de stations</h1>
    <p class="lede">Des stations écrites sans attendre une session : elles suivent le même circuit de relecture. Une fois validées, on les reprend dans une salle depuis l'onglet Stations d'une session, bouton « Banque ».</p>
    <div id="st-box"></div>`;
  await stationsTab(app.querySelector('#st-box'), { ...O.reserve, planning: '{}' }, { lead: base !== '#/admin', reserve: true });
}
