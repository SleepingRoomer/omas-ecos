// E-mails automatiques : réglages et journal (page Communication), envois d'une session et anonymisation (Réglages)
import { api, esc, toast } from './ui.js';

const KINDS = { convocation: 'Convocation', rappel: 'Rappel de la veille', resultats: 'Résultats en ligne', echange: 'Échange de créneau', attente: 'Place libérée (liste d\'attente)', benevole: 'Inscription bénévole', rappel_benevole: 'Rappel bénévole', test: 'Test' };
const STATUS = { sent: ['ok', 'envoyé'], skipped: ['', 'non envoyé'], failed: ['warn', 'échec'] };
const when = (s) => new Date(`${s}Z`).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function emailsPanel(box) {
  const M = await api('/mail/status');
  const S = M.settings;
  const tog = (k, l, d) => `<label class="check" style="margin:8px 0"><input type="checkbox" data-s="${k}" ${S[k] ? 'checked' : ''}><span><strong>${l}</strong><br><span class="small muted">${d}</span></span></label>`;
  box.innerHTML = `<div class="panel"><h2 style="margin-top:0">E-mails automatiques</h2>
    ${M.ready ? `<p class="alert ok small">Branchés sur Brevo, expéditeur <strong>${esc(M.from)}</strong>. ${M.counts.sent || 0} envoyés ces 30 derniers jours${M.counts.failed ? `, <strong>${M.counts.failed} en échec</strong>` : ''}.</p>`
    : `<div class="alert warn small"><strong>Pas encore branchés.</strong> Rien ne part tant que la clé n'est pas en place : les messages sont seulement notés dans le journal.
      <ol style="margin:6px 0 0;padding-left:18px"><li>Crée un compte gratuit sur brevo.com (300 e-mails par jour) et valide l'adresse d'expédition (par exemple ecos@omas…).</li>
      <li>Dans Brevo : SMTP et API, puis Clés API, crée une clé.</li>
      <li>Dans Cloudflare : le Worker omas-ecos, Paramètres, Variables et secrets. Ajoute <code>BREVO_API_KEY</code> (secret) et <code>MAIL_FROM</code> (l'adresse validée), et si tu veux <code>MAIL_FROM_NAME</code>.</li></ol></div>`}
    ${tog('auto_reminder', 'Rappel la veille', 'Chaque jour vers 17 h, les candidats et les bénévoles du lendemain reçoivent un rappel avec l\'heure et le lien vers leur espace.')}
    ${tog('auto_swap', 'Échanges de créneaux', 'Les deux étudiants reçoivent leur nouvel horaire dès que l\'échange est fait.')}
    ${tog('auto_waitlist', 'Liste d\'attente', 'Quand tu proposes une place, la personne reçoit son code et le lien pour confirmer.')}
    ${tog('auto_volunteer', 'Bénévoles', 'Chaque bénévole reçoit son code personnel juste après son inscription.')}
    <div class="grid cols-2" style="gap:10px;margin-top:8px"><div><label for="rt">Adresse de réponse <span class="hint">(facultatif)</span></label><input id="rt" type="email" value="${esc(S.reply_to)}" placeholder="omas.externat@…"></div>
      <div><label for="tt">Envoyer un e-mail de test à</label><div class="row" style="flex-wrap:nowrap"><input id="tt" type="email" placeholder="toi@…"><button class="small" id="test">Tester</button></div></div></div>
    <details style="margin-top:14px"><summary style="cursor:pointer"><strong>Journal</strong> <span class="small muted">(60 derniers)</span></summary>
      ${M.log.length ? `<div class="table-wrap"><table class="small"><thead><tr><th>Quand</th><th>Type</th><th>Session</th><th>À</th><th>État</th></tr></thead><tbody>
        ${M.log.map((l) => `<tr><td>${esc(when(l.created_at))}</td><td>${esc(KINDS[l.kind] || l.kind)}</td><td>${esc(l.exam_name || '')}</td><td>${esc(l.to_email || '(effacé)')}</td>
          <td><span class="pill ${STATUS[l.status]?.[0] || ''}">${STATUS[l.status]?.[1] || esc(l.status)}</span>${l.error ? `<div class="faint">${esc(l.error)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Rien pour l\'instant.</p>'}</details></div>`;
  const save = async (body) => { await api('/mail/settings', { method: 'PUT', body }); toast('Réglage enregistré'); };
  box.querySelectorAll('[data-s]').forEach((cb) => cb.addEventListener('change', () => save({ [cb.dataset.s]: cb.checked })));
  box.querySelector('#rt').addEventListener('change', (e) => save({ reply_to: e.target.value }));
  box.querySelector('#test').addEventListener('click', async () => {
    try { await api('/mail/test', { method: 'POST', body: { to: box.querySelector('#tt').value } }); toast('E-mail de test envoyé'); } catch (err) { toast(err.message, 'error'); }
    emailsPanel(box);
  });
}

// Dans les réglages d'une session : convocations, résultats, et anonymisation
export async function sessionMails(box, exam) {
  if (exam.anonymized_at) {
    box.innerHTML = `<div class="panel"><h2>Session anonymisée</h2><p class="small muted">Depuis le ${esc(when(exam.anonymized_at))}. Les noms, adresses et codes d'accès des candidats sont effacés, les évaluateurs sont devenus « Évaluateur 1, 2… ». Les notes, les grilles et les statistiques restent.</p></div>`;
    return;
  }
  const M = await api(`/exams/${exam.id}/mail`);
  const n = (k, st = 'sent') => M.rows.filter((r) => r.kind === k && r.status === st).reduce((a, r) => a + r.n, 0);
  box.innerHTML = `<div class="panel"><h2>E-mails de la session</h2>
    ${M.ready ? '' : '<p class="small alert warn">Les e-mails ne sont pas encore branchés (voir la page Communication) : les envois sont seulement notés.</p>'}
    <div class="row between"><div><strong>Convocations</strong><div class="small muted">${n('convocation')} envoyée${n('convocation') > 1 ? 's' : ''}, ${M.convocations_pending} à envoyer (inscrits avec un créneau et une adresse).</div></div>
      <div class="row"><button class="small primary" id="m-conv" ${M.convocations_pending ? '' : 'disabled'}>Envoyer les ${M.convocations_pending || ''} convocations</button><button class="small quiet" id="m-conv-all">Renvoyer à tous</button></div></div>
    <div class="row between" style="margin-top:12px"><div><strong>Résultats en ligne</strong><div class="small muted">${n('resultats')} prévenu${n('resultats') > 1 ? 's' : ''}. Pour les candidats qui ont passé leurs stations et n'ont pas encore reçu le message.</div></div>
      <button class="small" id="m-res" ${exam.show_results ? '' : 'disabled title="Ouvre d\'abord les résultats"'}>Prévenir les candidats</button></div>
    <p class="small muted" style="margin:12px 0 0">Les rappels de la veille partent tout seuls : ${n('rappel')} envoyé${n('rappel') > 1 ? 's' : ''} pour cette session.</p></div>
    <div class="panel danger-zone"><h2>Anonymiser la session</h2>
      <p class="small">Pour le RGPD, une fois la session finie et les résultats consultés. <strong>Les statistiques restent, les identités sont effacées</strong> :</p>
      <ul class="small"><li>noms, prénoms, e-mails, téléphones et codes d'accès des candidats (ils ne peuvent plus se connecter) ;</li>
        <li>noms des évaluateurs, remplacés par « Évaluateur 1, 2… » (les statistiques de binômes restent justes) ;</li>
        <li>commentaires libres des évaluateurs, demandes d'échange, liste d'attente, adresses du journal des e-mails.</li></ul>
      <p class="small muted">Restent : numéros de passage, grilles et notes, rang, faculté et année, tarif, avis anonymes. Pense à télécharger les attestations des évaluateurs avant : elles ne pourront plus être nominatives. C'est définitif.</p>
      <button class="danger" id="anon" ${exam.eval_open ? 'disabled title="Ferme d\'abord la saisie"' : ''}>Anonymiser…</button></div>`;
  const send = async (path, body, label) => {
    try {
      const r = await api(`/exams/${exam.id}/mail/${path}`, { method: 'POST', body });
      toast(r.none ? 'Personne à prévenir' : r.ready ? `${label} : ${r.sent} envoyé${r.sent > 1 ? 's' : ''}${r.failed ? `, ${r.failed} en échec` : ''}${r.skipped ? `, ${r.skipped} ignoré${r.skipped > 1 ? 's' : ''} (adresse manquante ou fictive)` : ''}`
        : `${label} : ${r.skipped} noté${r.skipped > 1 ? 's' : ''} dans le journal, rien n'est parti (e-mails non branchés)`, r.failed ? 'error' : 'ok');
      sessionMails(box, exam);
    } catch (err) { toast(err.message, 'error'); }
  };
  box.querySelector('#m-conv').addEventListener('click', () => { if (window.confirm(`Envoyer leur convocation à ${M.convocations_pending} candidat(s) ?`)) send('convocations', {}, 'Convocations'); });
  box.querySelector('#m-conv-all').addEventListener('click', () => { if (window.confirm('Renvoyer la convocation à tous les inscrits, même à ceux qui l\'ont déjà reçue ?')) send('convocations', { all: true }, 'Convocations'); });
  box.querySelector('#m-res').addEventListener('click', () => { if (window.confirm('Prévenir les candidats que leurs résultats sont en ligne ?')) send('resultats', {}, 'Résultats'); });
  box.querySelector('#anon').addEventListener('click', async () => {
    const typed = window.prompt(`Anonymiser définitivement « ${exam.name} » ?\n\nRecopie le nom exact de la session pour confirmer.`);
    if (typed === null) return;
    try {
      const r = await api(`/exams/${exam.id}/anonymize`, { method: 'POST', body: { confirm: typed } });
      toast(`Session anonymisée : ${r.candidates} candidats, ${r.evaluators} évaluateurs`);
      exam.anonymized_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      sessionMails(box, exam);
    } catch (err) { toast(err.message, 'error'); }
  });
}
