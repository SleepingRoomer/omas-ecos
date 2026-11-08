// Page « État du système » : migrations passées, e-mails, tâche planifiée, connexions
import { api, esc, toast, setTitle } from './ui.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '–');
const sqlWhen = (s) => (s ? when(`${s.replace(' ', 'T')}Z`) : '–');
const pill = (ok, yes = 'OK', no = 'À faire') => `<span class="pill ${ok ? 'ok' : 'warn'}">${ok ? yes : no}</span>`;

export async function systemView(app) {
  setTitle('État du système');
  const S = await api('/system/status');
  const M = S.migrations; const C = S.cron; const E = S.mail;
  const last = C.last;
  const ago = last ? (Date.now() - new Date(last.at).getTime()) / 36e5 : null;
  const cronOk = ago !== null && ago < 26;
  app.innerHTML = `
    <h1>État du système</h1>
    <p class="lede">Ce qui doit tourner pour qu'INES fonctionne : la base, les e-mails, la tâche de la nuit. À regarder avant chaque session.</p>

    <div class="sys-grid">
      <div class="panel"><div class="row between"><h2 style="margin:0">Migrations de la base</h2>${pill(M.all_ok, 'Toutes passées', `${M.list.filter((m) => !m.ok).length} manquante(s)`)}</div>
        <p class="small muted">Chaque migration est vérifiée d'après les tables et colonnes qu'elle crée. Une migration manquante se colle dans la console D1 de Cloudflare, une instruction par ligne.</p>
        <table class="sys-table"><tbody>${M.list.map((m) => `<tr><td><code>${esc(m.name)}</code></td><td>${m.ok ? '<span class="pill ok">Passée</span>' : `<span class="pill ko">Manque : ${esc(m.missing.join(', '))}</span>`}</td></tr>`).join('')}</tbody></table>
        <p class="small muted" style="margin-top:10px">${M.tracked_by_wrangler === null ? 'Table d1_migrations absente : wrangler ne suit pas les migrations.'
    : M.tracked_by_wrangler.length ? `${M.tracked_by_wrangler.length} migration(s) suivie(s) par wrangler, jusqu'à ${esc(M.tracked_by_wrangler[M.tracked_by_wrangler.length - 1].name)}.` : 'La table d1_migrations de wrangler est vide : normal, les migrations ont été collées à la main.'}</p></div>

      <div class="panel"><div class="row between"><h2 style="margin:0">E-mails (Brevo)</h2>${pill(E.ready, 'Configurés', 'Non configurés')}</div>
        ${E.ready ? `<p class="small">Expéditeur : <strong>${esc(E.from_name)}</strong> &lt;${esc(E.from)}&gt;${E.reply_to ? `, réponses vers ${esc(E.reply_to)}` : ''}.</p>`
    : `<p class="alert warn">Il manque ${E.missing.map((k) => `<code>${k}</code>`).join(' et ')} dans les variables du Worker (Cloudflare, Paramètres, Variables et secrets). Tant que c'est vide, rien ne part et le site fonctionne quand même.</p>`}
        <p class="small muted">30 derniers jours : ${E.sent_30d ?? '–'} envoyé(s), ${E.failed_30d ?? '–'} en échec. Dernier message : ${E.last ? `${sqlWhen(E.last.created_at)}, ${esc(E.last.status)}${E.last.error ? ` (${esc(E.last.error)})` : ''}` : 'aucun'}.</p>
        ${E.auto ? `<p class="small muted">Envois automatiques : ${Object.entries(E.auto).map(([k, v]) => `${esc(k.replace('auto_', ''))} ${v ? 'oui' : 'non'}`).join(', ')}. Réglages dans <a href="#/admin/communication">Communication</a>.</p>` : ''}
        <h3>Secrets du Worker</h3>
        <table class="sys-table"><tbody>${Object.entries(S.secrets).map(([k, v]) => `<tr><td><code>${k}</code></td><td>${v ? '<span class="pill ok">Présent</span>' : `<span class="pill ${['MAIL_FROM_NAME', 'SITE_URL'].includes(k) ? '' : 'warn'}">Absent${k === 'MAIL_FROM_NAME' ? ' (nom par défaut)' : k === 'SITE_URL' ? ' (adresse mémorisée à la connexion)' : ''}</span>`}</td></tr>`).join('')}</tbody></table></div>

      <div class="panel"><div class="row between"><h2 style="margin:0">Tâche de la nuit</h2>${pill(cronOk, 'Tourne', last ? 'En retard' : 'Jamais vue')}</div>
        <p class="small muted">${esc(C.schedule)}. Elle envoie les rappels de la veille aux étudiants et aux bénévoles, puis purge les connexions expirées.</p>
        ${last ? `<p class="small">Dernière exécution : <strong>${when(last.at)}</strong>${last.ms ? ` (${last.ms} ms)` : ''}.
          ${last.reminders ? `Rappels : ${last.reminders.off ? 'désactivés' : `${last.reminders.sent ?? 0} envoyé(s), ${last.reminders.skipped ?? 0} ignoré(s), ${last.reminders.failed ?? 0} en échec`}.` : ''}
          ${last.purge ? `Purge : ${last.purge.sessions} connexion(s), ${last.purge.failures} tentative(s).` : ''}
          ${last.error ? `<br><span class="pill ko">Erreur</span> ${esc(last.error)}` : ''}</p>`
    : '<p class="alert info">Aucune exécution enregistrée pour l\'instant : la première trace apparaîtra après le prochain passage (ou lance-la à la main ci-dessous).</p>'}
        <p class="small muted">Prochaine exécution prévue : ${when(C.next)}.${C.hourly ? ` Passage horaire de la liste d'attente : ${when(C.hourly.at)}${C.hourly.waitlist?.expired ? `, ${C.hourly.waitlist.expired} offre(s) expirée(s), ${C.hourly.waitlist.offered} reproposée(s)` : ''}${C.hourly.error ? `, erreur : ${esc(C.hourly.error)}` : ''}.` : ''}</p>
        <div class="row"><button class="small" id="run">Lancer maintenant</button><span class="small muted">Les rappels déjà envoyés ne repartent pas : le journal des e-mails fait foi.</span></div></div>

      <div class="panel"><div class="row between"><h2 style="margin:0">Sauvegarde hebdomadaire</h2>${S.backup?.configured ? pill(!!S.backup.last && (Date.now() - Date.parse(`${S.backup.last}T12:00:00Z`)) / 864e5 < 9, 'À jour', S.backup.last ? 'En retard' : 'Jamais faite') : pill(false, '', 'Non branchée')}</div>
        ${S.backup?.configured ? `<p class="small">Dernière sauvegarde : <strong>${S.backup.last ? esc(S.backup.last) : 'aucune'}</strong>${S.backup.last ? `, ${S.backup.files.length} fichier(s), ${Math.round(S.backup.files.reduce((a, f) => a + f.size, 0) / 1024)} Ko` : ''}. ${S.backup.weeks} semaine(s) gardée(s) sur huit.</p>
          <p class="small muted">Chaque dimanche soir : un fichier par session en cours ou récente (réimportable depuis la liste des sessions) et l'annuaire de l'équipe, dans le bucket R2. Les images des stations n'y sont pas.</p>
          <button class="small" id="backup">Sauvegarder maintenant</button>`
    : `<p class="small">Pas encore branchée : il faut créer un espace de stockage R2 dans Cloudflare puis activer la ligne prévue dans <code>wrangler.jsonc</code>. Tant que ce n'est pas fait, pense au bouton « Télécharger la sauvegarde » de chaque session.</p>`}</div>

      <div class="panel"><div class="row between"><h2 style="margin:0">Connexions</h2>${pill(!S.sessions.expired, 'Propre', `${S.sessions.expired} expirée(s)`)}</div>
        <p class="small">${S.sessions.total ?? '–'} connexion(s) en base, dont ${S.sessions.expired ?? '–'} expirée(s). ${S.sessions.failures_24h ?? 0} tentative(s) de connexion ratée(s) depuis 24 h.</p>
        <p class="small muted">Chaque connexion (étudiant, évaluateur, équipe) laisse une ligne qui expire d'elle-même : la tâche de la nuit la supprime ensuite.</p>
        <button class="small" id="purge">Purger maintenant</button></div>
    </div>
    <p class="small muted" style="margin-top:18px">État relevé le ${when(S.now)}.</p>`;
  app.querySelector('#purge').addEventListener('click', async () => {
    try { const r = await api('/system/purge', { method: 'POST' }); toast(`${r.sessions} connexion(s) et ${r.failures} tentative(s) supprimées`); systemView(app); } catch (err) { toast(err.message, 'error'); }
  });
  app.querySelector('#backup')?.addEventListener('click', async () => {
    try { const r = await api('/system/backup', { method: 'POST' }); toast(`${r.files} fichier(s) sauvegardé(s)`); systemView(app); } catch (err) { toast(err.message, 'error'); }
  });
  app.querySelector('#run').addEventListener('click', async () => {
    try { const r = await api('/system/run-nightly', { method: 'POST' }); toast(r.error ? `Terminé avec une erreur : ${r.error}` : 'Tâche exécutée', r.error ? 'error' : 'ok'); systemView(app); } catch (err) { toast(err.message, 'error'); }
  });
}
