// Comptes de l'équipe et journal des actions sensibles
import { api, esc, toast, setTitle } from './ui.js';

const when = (s) => (s ? new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : 'jamais');

export async function teamView(app) {
  setTitle('Équipe et journal');
  const T = await api('/team');
  let q = '';
  const showCode = (name, code) => `<div class="alert ok"><strong>Code de ${esc(name)} : <span class="code" style="font-size:1.25em;letter-spacing:2px">${esc(code)}</span></strong>
    <p class="small" style="margin:6px 0 0">Il ne sera plus jamais affiché : transmets-le maintenant, en main propre ou par message privé. Il se tape dans l'onglet Équipe de la page de connexion, à la place du mot de passe commun.</p>
    <button class="small" data-copycode="${esc(code)}">Copier le code</button></div>`;
  const draw = (flash = '') => {
    const log = T.log.filter((l) => !q || `${l.who} ${l.action}`.toLowerCase().includes(q));
    app.innerHTML = `
      <h1>Équipe et journal</h1>
      <p class="lede">Un code personnel par membre de l'équipe : on sait qui a fait quoi, et un départ se gère en désactivant un compte, sans changer le mot de passe de tout le monde.</p>
      ${T.ready ? '' : '<p class="alert warn">Colle d\'abord la migration 0014 dans la console D1 (voir État du système).</p>'}
      <div id="flash">${flash}</div>
      <div class="panel"><h2 style="margin-top:0">Comptes</h2>
        ${T.members.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
          ${T.members.map((m) => `<tr data-m="${m.id}" ${m.active ? '' : 'style="opacity:.5"'}><td><strong>${esc(m.name)}</strong>${m.id === T.me.member_id ? ' <span class="pill ink" style="font-size:.7rem">toi</span>' : ''}<div class="small muted">${esc(m.email || '')}</div></td>
            <td class="small">${esc(when(m.last_login_at))}</td>
            <td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="small quiet" data-regen>Nouveau code</button>
              ${m.id === T.me.member_id ? '' : `<button class="small quiet" data-active>${m.active ? 'Désactiver' : 'Réactiver'}</button>`}</div></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="small muted">Aucun compte pour l\'instant : tout le monde utilise le mot de passe commun.</p>'}
        <form id="add" class="row" style="margin-top:12px;align-items:flex-end">
          <div style="flex:2;min-width:180px"><label for="t-n" style="margin-top:0">Nom</label><input id="t-n" name="name" required placeholder="Prénom Nom"></div>
          <div style="flex:2;min-width:180px"><label for="t-e" style="margin-top:0">E-mail <span class="hint">(facultatif)</span></label><input id="t-e" name="email"></div>
          <button class="primary">Créer le compte</button></form>
        <label class="check" style="margin-top:16px"><input type="checkbox" id="only" ${T.team_only ? 'checked' : ''} ${T.me.member_id ? '' : 'disabled'}>
          <span><strong>Refuser le mot de passe commun</strong><br><span class="small muted">${T.me.member_id ? 'Seuls les codes personnels ouvrent l\'espace de l\'équipe. Le mot de passe commun redevient valable si tous les comptes sont désactivés.' : 'Connecte-toi avec ton propre code pour pouvoir activer cette option (sinon tu risquerais de t\'enfermer dehors).'}</span></span></label>
        <p class="small muted">Connecté en ce moment : <strong>${esc(T.me.name)}</strong>${T.me.member_id ? '' : ' (mot de passe commun)'}.</p></div>
      <div class="panel"><div class="row between"><h2 style="margin:0">Journal</h2><input id="q" type="search" placeholder="Filtrer par nom ou action" value="${esc(q)}" style="max-width:260px"></div>
        <p class="small muted">Connexions de l'équipe, suppressions, exports, anonymisations, réglages sensibles, réponses aux réclamations. Le contenu des actions n'est pas gardé, seulement qui, quoi et quand.</p>
        ${log.length ? `<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th class="small">Détail</th></tr></thead><tbody>
          ${log.map((l) => `<tr><td class="small" style="white-space:nowrap">${esc(when(l.at))}</td><td>${esc(l.who)}</td><td>${esc(l.action)}</td><td class="small muted"><code>${esc(l.method || '')} ${esc(l.path || '')}</code></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="small muted">Rien pour l\'instant.</p>'}</div>`;
    app.querySelector('#q').addEventListener('input', (e) => { q = e.target.value.toLowerCase(); const p = e.target.selectionStart; draw(app.querySelector('#flash').innerHTML); const i = app.querySelector('#q'); i.focus(); i.setSelectionRange(p, p); });
    app.querySelectorAll('[data-copycode]').forEach((b) => b.addEventListener('click', async () => { await navigator.clipboard?.writeText(b.dataset.copycode).catch(() => {}); toast('Code copié'); }));
    app.querySelector('#add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const r = await api('/team', { method: 'POST', body: { name: f.get('name'), email: f.get('email') } });
        Object.assign(T, await api('/team')); draw(showCode(f.get('name'), r.code));
      } catch (err) { toast(err.message, 'error'); }
    });
    app.querySelectorAll('[data-regen]').forEach((b) => b.addEventListener('click', async () => {
      const m = T.members.find((x) => String(x.id) === b.closest('tr').dataset.m);
      if (!window.confirm(`Nouveau code pour ${m.name} ? L'ancien ne marchera plus et ses connexions en cours sont coupées.`)) return;
      try { const r = await api(`/team/${m.id}`, { method: 'PATCH', body: { regen: true } }); Object.assign(T, await api('/team')); draw(showCode(m.name, r.code)); } catch (err) { toast(err.message, 'error'); }
    }));
    app.querySelectorAll('[data-active]').forEach((b) => b.addEventListener('click', async () => {
      const m = T.members.find((x) => String(x.id) === b.closest('tr').dataset.m);
      try { await api(`/team/${m.id}`, { method: 'PATCH', body: { active: !m.active } }); Object.assign(T, await api('/team')); draw(); toast(m.active ? `${m.name} désactivé(e)` : `${m.name} réactivé(e)`); } catch (err) { toast(err.message, 'error'); }
    }));
    app.querySelector('#only').addEventListener('change', async (e) => {
      try { await api('/team/settings', { method: 'PUT', body: { team_only: e.target.checked } }); T.team_only = e.target.checked; toast(e.target.checked ? 'Mot de passe commun refusé' : 'Mot de passe commun de nouveau accepté'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
    });
  };
  draw();
}
