import { api, esc, toast, setTitle } from './ui.js';

const app = document.getElementById('app');
// copie locale de l'application pour la saisie hors connexion
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// boutons d'impression (pas de gestionnaire en ligne : la politique de sécurité du site les interdit)
document.addEventListener('click', (e) => { if (e.target.closest('[data-print]')) window.print(); });
const nav = document.getElementById('nav');
export const state = { me: null };

const HOME = { admin: '#/admin', auteur: '#/redaction', evaluateur: '#/eval', etudiant: '#/resultats', participant: '#/journee', benevole: '#/benevole' };

function renderNav() {
  const k = state.me?.kind;
  const links = {
    admin: [['#/admin', 'Sessions'], ['#/admin/personnes', 'Rédacteurs et relecteurs'], ['#/admin/communication', 'Communication'], ['#/admin/benevoles', 'Bénévoles']],
    auteur: [['#/redaction', 'Mes stations et ateliers']],
    evaluateur: [['#/eval', 'Ma salle']],
    etudiant: [['#/resultats', 'Mon espace'], ['#/fiches', 'Fiches procédures']],
    participant: [['#/journee', 'Ma journée'], ['#/fiches', 'Fiches procédures']],
    benevole: [['#/benevole', 'Mon espace bénévole']],
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
    evaluateur: 'Entre le code affiché sur la porte de ta salle, puis ton nom. Inscrit comme bénévole ? Ton code personnel suffit.',
    redaction: 'Entre ton code de rédacteur ou de relecteur pour retrouver tes stations.',
    admin: 'Réservé à l\'équipe d\'organisation.',
  };
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let role = params.get('role') || 'etudiant';
  const draw = () => {
    app.innerHTML = `
      <div class="login">
        <div class="intro">
          <img class="login-logo" src="/img/ines-logo.svg" alt="INES" width="420" height="159">
          <p class="by">Interface numérique d’ECOS et de simulation, par <b>OMAS <span>EXTERNAT</span></b></p>
          <h1>Prépare tes ECOS comme le jour J.</h1>
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
            ${role === 'evaluateur' ? '<label for="name">Ton nom <span class="hint">(pas besoin avec un code personnel)</span></label><input id="name" type="text" autocomplete="name" placeholder="Prénom Nom">' : ''}
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
        const back = sessionStorage.getItem('after_login'); sessionStorage.removeItem('after_login');
        const target = back && back !== '#/' ? back : HOME[r.kind];
        if (location.hash === target) route(); else location.hash = target;
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}

const routes = [
  [/^#\/accueil\/([A-Z0-9]+)$/, 'admin', async (m) => (await import('./accueil.js')).scanView(app, m[1])],
  [/^#\/attente\/(\d+)$/, [null, 'admin', 'etudiant', 'evaluateur', 'auteur', 'participant'], async (m) => (await import('./waitlist.js')).publicWaitlist(app, m[1])],
  [/^#\/benevole\/(\d+)$/, [null, 'admin', 'etudiant', 'evaluateur', 'auteur', 'participant', 'benevole'], async (m) => (await import('./benevoles.js')).publicSignup(app, m[1])],
  [/^#\/benevole$/, 'benevole', async () => (await import('./benevoles.js')).volunteerSpace(app)],
  [/^#\/calibration\/(\d+)$/, ['admin', 'benevole'], async (m) => (await import('./benevoles.js')).calibrationView(app, m[1], state.me.kind)],
  [/^#\/fiches$/, ['etudiant', 'participant', 'admin', 'benevole', 'auteur'], async () => (await import('./fiches.js')).fichesView(app)],
  [/^#\/fiches\/([\w-]+)$/, ['etudiant', 'participant', 'admin', 'benevole', 'auteur'], async (m) => (await import('./fiches.js')).ficheView(app, m[1])],
  [/^#\/admin\/banque(?:\/(\d+))?$/, 'admin', async (m) => (await import('./bank.js')).bankView(app, m[1])],
  [/^#\/admin\/benevoles$/, 'admin', async () => (await import('./benevoles.js')).engagementView(app)],
  [/^#\/admin\/communication$/, 'admin', async () => (await import('./comms.js')).commsView(app)],
  [/^#\/admin\/session\/(\d+)\/candidat\/(\d+)$/, 'admin', async (m) => (await import('./student.js')).adminReport(app, m[2], m[1])],
  [/^#\/admin\/session\/(\d+)(?:\/([\w-]+))?$/, 'admin', async (m) => (await import('./admin.js')).examView(app, m[1], m[2] || 'stations')],
  [/^#\/admin\/jp\/(\d+)(?:\/(\w+))?$/, 'admin', async (m) => (await import('./jp.js')).jpView(app, m[1], m[2] || 'ateliers')],
  [/^#\/atelier\/(\d+)$/, ['admin', 'auteur'], async (m) => (await import('./jp.js')).atelierEditor(app, m[1])],
  [/^#\/journee$/, 'participant', async () => (await import('./jp.js')).participantView(app)],
  [/^#\/admin\/personnes$/, 'admin', async () => (await import('./admin.js')).peopleView(app)],
  [/^#\/admin$/, 'admin', async () => (await import('./admin.js')).examsView(app)],
  [/^#\/redaction$/, 'auteur', async () => (await import('./editor.js')).myStations(app)],
  [/^#\/station\/(\d+)$/, ['admin', 'auteur'], async (m) => (await import('./editor.js')).stationEditor(app, m[1])],
  [/^#\/apercu\/(\d+)\/(vignette|dossier|grille|documents)$/, ['admin', 'auteur', 'evaluateur'], async (m) => (await import('./editor.js')).preview(app, m[1], m[2])],
  [/^#\/eval\/candidat\/(\d+)$/, 'evaluateur', async (m) => (await import('./evaluator.js')).gridView(app, m[1])],
  [/^#\/eval$/, 'evaluateur', async () => (await import('./evaluator.js')).roomView(app)],
  [/^#\/resultats$/, 'etudiant', async () => (await import('./student.js')).studentView(app)],
];

export async function route() {
  if (!location.hash.endsWith('/projection')) document.body.classList.remove('kiosk');
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
    if (!allowed.includes(state.me.kind)) { if (!state.me.kind) sessionStorage.setItem('after_login', location.hash); break; }
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
