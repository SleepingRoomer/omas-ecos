import { api, esc, toast, setTitle, plate } from './ui.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
export const state = { me: null };

const HOME = { admin: '#/admin', auteur: '#/redaction', evaluateur: '#/eval', etudiant: '#/resultats', participant: '#/journee' };

function renderNav() {
  const k = state.me?.kind;
  const links = {
    admin: [['#/admin', 'Sessions'], ['#/admin/personnes', 'Rédacteurs et relecteurs']],
    auteur: [['#/redaction', 'Mes stations et ateliers']],
    evaluateur: [['#/eval', 'Ma salle']],
    etudiant: [['#/resultats', 'Mes résultats']],
    participant: [['#/journee', 'Ma journée']],
  }[k] || [];
  const here = location.hash || '#/';
  nav.innerHTML = links.map(([h, l]) => `<a href="${h}" class="${here === h ? 'active' : ''}">${esc(l)}</a>`).join('')
    + (k ? `<span class="who">${esc(state.me.name || '')}</span><button id="logout">Se déconnecter</button>` : '');
  document.getElementById('logout')?.addEventListener('click', async () => {
    await api('/logout', { method: 'POST' });
    state.me = { kind: null };
    location.hash = '#/';
    route();
  });
}

function loginView() {
  setTitle('Connexion');
  const roles = [
    ['etudiant', 'Étudiant'], ['evaluateur', 'Évaluateur'], ['redaction', 'Rédaction'], ['admin', 'Équipe'],
  ];
  const help = {
    etudiant: 'Entre le code reçu avec ta convocation, pour les ECOS blancs comme pour une journée procédure.',
    evaluateur: 'Entre le code affiché sur la porte de ta salle, puis ton nom.',
    redaction: 'Entre ton code de rédacteur ou de relecteur pour retrouver tes stations.',
    admin: 'Réservé à l\'équipe d\'organisation.',
  };
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let role = params.get('role') || 'etudiant';
  const circuit = (letter) => `<span class="lbl">Circuit ${letter}</span>${[1, 2, 3, 4, 5].map((n) => plate(letter + n, 'lg')).join('')}`;
  const draw = () => {
    app.innerHTML = `
      <div class="login">
        <div class="intro">
          <div class="circuit" aria-hidden="true">${circuit('A')}${circuit('B')}</div>
          <h1>ECOS blancs OMAS</h1>
          <p class="lede">Dix stations, deux circuits, huit minutes chacune. Ici, on rédige les stations et les ateliers, on saisit les grilles le jour J et on suit ses résultats en direct.</p>
        </div>
        <div class="door">
          <h2>Se connecter</h2>
          <div class="seg" role="tablist">${roles.map(([r, l]) => `<button type="button" role="tab" aria-selected="${r === role}" data-r="${r}" class="${r === role ? 'on' : ''}">${l}</button>`).join('')}</div>
          <p class="muted small" style="min-height:3em">${esc(help[role])}</p>
          <form id="f">
            <label for="code">${role === 'admin' ? 'Mot de passe' : role === 'evaluateur' ? 'Code de la salle' : "Code d'accès"}</label>
            <input id="code" ${role === 'admin' ? 'type="password"' : 'type="text" class="code-input" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="12"'}
              value="${esc(params.get('code') || '')}" placeholder="${role === 'admin' ? '' : 'A93K7XPQ'}" required>
            ${role === 'evaluateur' ? '<label for="name">Ton nom</label><input id="name" type="text" required autocomplete="name" placeholder="Prénom Nom">' : ''}
            <button class="primary" style="width:100%;margin-top:18px">${role === 'etudiant' ? 'Accéder à mon espace' : role === 'evaluateur' ? 'Ouvrir ma salle' : role === 'redaction' ? 'Voir mes stations' : 'Entrer'}</button>
          </form>
        </div>
      </div>`;
    app.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { role = b.dataset.r; draw(); app.querySelector('#code').focus(); }));
    app.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/login', { method: 'POST', body: { role, code: app.querySelector('#code').value, name: app.querySelector('#name')?.value } });
        state.me = await api('/me');
        location.hash = HOME[r.kind];
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}

const routes = [
  [/^#\/admin\/session\/(\d+)\/candidat\/(\d+)$/, 'admin', async (m) => (await import('./student.js')).adminReport(app, m[2], m[1])],
  [/^#\/admin\/session\/(\d+)(?:\/(\w+))?$/, 'admin', async (m) => (await import('./admin.js')).examView(app, m[1], m[2] || 'stations')],
  [/^#\/admin\/jp\/(\d+)(?:\/(\w+))?$/, 'admin', async (m) => (await import('./jp.js')).jpView(app, m[1], m[2] || 'ateliers')],
  [/^#\/atelier\/(\d+)$/, ['admin', 'auteur'], async (m) => (await import('./jp.js')).atelierEditor(app, m[1])],
  [/^#\/journee$/, 'participant', async () => (await import('./jp.js')).participantView(app)],
  [/^#\/admin\/personnes$/, 'admin', async () => (await import('./admin.js')).peopleView(app)],
  [/^#\/admin$/, 'admin', async () => (await import('./admin.js')).examsView(app)],
  [/^#\/redaction$/, 'auteur', async () => (await import('./editor.js')).myStations(app)],
  [/^#\/station\/(\d+)$/, ['admin', 'auteur'], async (m) => (await import('./editor.js')).stationEditor(app, m[1])],
  [/^#\/apercu\/(\d+)\/(vignette|dossier|grille)$/, ['admin', 'auteur', 'evaluateur'], async (m) => (await import('./editor.js')).preview(app, m[1], m[2])],
  [/^#\/eval\/candidat\/(\d+)$/, 'evaluateur', async (m) => (await import('./evaluator.js')).gridView(app, m[1])],
  [/^#\/eval$/, 'evaluateur', async () => (await import('./evaluator.js')).roomView(app)],
  [/^#\/resultats$/, 'etudiant', async () => (await import('./student.js')).studentView(app)],
];

export async function route() {
  if (!state.me) {
    try { state.me = await api('/me'); } catch { state.me = { kind: null }; }
  }
  const hash = (location.hash || '#/').split('?')[0];
  renderNav();
  window.scrollTo(0, 0);
  for (const [re, kinds, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const allowed = Array.isArray(kinds) ? kinds : [kinds];
    if (!allowed.includes(state.me.kind)) break;
    try { await fn(m); } catch (err) {
      if (err.status === 401) { state.me = { kind: null }; location.hash = '#/'; return; }
      app.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
    return;
  }
  // Lien direct « #/?role=etudiant&code=XXXX » ou page d'accueil
  if (state.me.kind && hash !== '#/') { location.hash = HOME[state.me.kind]; return; }
  if (state.me.kind && !location.hash.includes('code=')) { location.hash = HOME[state.me.kind]; return; }
  loginView();
}

window.addEventListener('hashchange', route);
route();
