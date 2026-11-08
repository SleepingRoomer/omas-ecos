// Liste d'attente : la page publique d'inscription et le suivi par l'équipe
import { api, esc, toast, daysLabel, frDate } from './ui.js';

export async function publicWaitlist(app, examId) {
  let E;
  try { E = await api(`/public/exams/${examId}`); } catch { app.innerHTML = '<p class="alert error">Session introuvable.</p>'; return; }
  document.title = `Liste d'attente, ${E.name}`;
  if (!E.waitlist_open) { app.innerHTML = `<div class="narrow"><h1>${esc(E.name)}</h1><p class="panel">La liste d'attente n'est pas ouverte pour cette session.</p></div>`; return; }
  app.innerHTML = `<div class="narrow" style="max-width:620px">
    <h1>Liste d'attente</h1>
    <p class="lede">${esc(E.name)}, ${esc(daysLabel(E.days))}.</p>
    <p>Toutes les places sont prises, mais il y a souvent des désistements. Inscris-toi : dès qu'une place se libère, elle est proposée au premier de la liste. Tu reçois alors un e-mail avec ton code d'accès et un délai (en général 24 h) pour confirmer ; sans réponse, elle passe au suivant.</p>
    <form id="wl" class="panel">
      <div class="grid cols-2" style="gap:10px"><div><label for="w-ln" style="margin-top:0">Nom</label><input id="w-ln" name="last_name" required autocomplete="family-name"></div>
        <div><label for="w-fn" style="margin-top:0">Prénom</label><input id="w-fn" name="first_name" required autocomplete="given-name"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="w-em">E-mail</label><input id="w-em" name="email" type="email" required autocomplete="email"></div>
        <div><label for="w-ph">Téléphone</label><input id="w-ph" name="phone" autocomplete="tel"></div></div>
      <div class="grid cols-2" style="gap:10px"><div><label for="w-fa">Faculté</label><input id="w-fa" name="faculty"></div>
        <div><label for="w-ye">Année</label><input id="w-ye" name="year" placeholder="DFASM2"></div></div>
      <label for="w-ta">Adhérent de l'OMAS ?</label><select id="w-ta" name="tarif"><option value="Adhérent">Oui</option><option value="Non adhérent">Non</option></select>
      <label for="w-no">Contraintes de date <span class="hint">(facultatif)</span></label><input id="w-no" name="note" placeholder="Pas disponible le samedi matin…">
      <p class="small muted">Tes coordonnées servent uniquement à te proposer une place pour cette session. <a href="#/confidentialite" target="_blank">En savoir plus</a>.</p>
      <button class="primary" style="margin-top:6px">M'inscrire sur la liste d'attente</button>
    </form><div id="wl-out"></div></div>`;
  app.querySelector('#wl').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/public/exams/${examId}/waitlist`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      app.querySelector('#wl').remove();
      app.querySelector('#wl-out').innerHTML = `<div class="alert ok"><strong>C'est noté !</strong> Tu es ${r.position}${r.position === 1 ? 'er' : 'e'} sur la liste d'attente. On te contacte dès qu'une place se libère.</div>`;
    } catch (err) { toast(err.message, 'error'); }
  });
}

// Panneau de l'équipe, dans l'onglet Candidats
export async function waitlistPanel(box, exam) {
  const [W, D] = await Promise.all([api(`/exams/${exam.id}/waitlist`), api(`/exams/${exam.id}/planning`)]);
  const P = D.planning;
  const cap = D.slots.length;
  const taken = new Set(D.candidates.filter((c) => c.status !== 'annule' && c.seat).map((c) => `${c.day}|${c.series}|${c.seat}`));
  const free = [];
  for (const d of P.days) d.series.forEach((_, i) => { for (let s = 1; s <= cap; s++) if (!taken.has(`${d.date}|${i + 1}|${s}`)) free.push({ day: d.date, series: i + 1, seat: s }); });
  const waiting = W.filter((w) => w.status === 'waiting');
  const offered = W.filter((w) => w.status === 'offered');
  const gone = W.filter((w) => ['expired', 'declined'].includes(w.status));
  const auto = P.waitlist_auto !== false;
  const dl = (w) => { try { return JSON.parse(w.extra || 'null')?.offer_expires_at; } catch { return null; } };
  const when = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const link = `${location.origin}/#/attente/${exam.id}`;
  box.innerHTML = `<details class="panel" ${waiting.length || offered.length ? 'open' : ''}><summary style="cursor:pointer"><strong>Liste d'attente</strong>
      <span class="muted">${waiting.length} en attente, ${free.length} place${free.length > 1 ? 's' : ''} libre${free.length > 1 ? 's' : ''}</span></summary>
    <div class="row" style="margin:10px 0">
      <label class="check" style="margin:0"><input type="checkbox" id="wl-open" ${P.waitlist_open ? 'checked' : ''}><span>Inscriptions ouvertes</span></label>
      <button class="small" id="wl-copy" ${P.waitlist_open ? '' : 'disabled'}>Copier le lien d'inscription</button>
      <span class="small muted">À partager une fois la billetterie complète.</span></div>
    <div class="row" style="margin:0 0 10px">
      <label class="check" style="margin:0"><input type="checkbox" id="wl-auto" ${auto ? 'checked' : ''}><span><strong>Proposer automatiquement</strong> chaque place libérée au premier de la liste</span></label>
      <label for="wl-h" class="small" style="margin:0">Délai pour confirmer</label>
      <select id="wl-h" style="width:auto">${[12, 24, 48].map((n) => `<option value="${n}" ${n === (Number(P.waitlist_hours) || 24) ? 'selected' : ''}>${n} h</option>`).join('')}</select></div>
    <p class="small muted" style="margin:0 0 10px">Désistement, annulation ou délai dépassé : la place part au suivant tout seul, avec un e-mail. Le délai s'arrête trois heures avant la convocation ; à moins de cinq heures de la série, plus rien ne part automatiquement, c'est l'accueil qui gère.</p>
    ${waiting.length ? `<div class="table-wrap"><table><thead><tr><th class="num">#</th><th>Personne</th><th>Inscrit le</th><th>Place à proposer</th><th></th></tr></thead><tbody>
      ${waiting.map((w, i) => `<tr data-w="${w.id}"><td class="num">${i + 1}</td><td><strong>${esc(w.last_name)}</strong> ${esc(w.first_name)}
          <div class="small muted">${esc(w.email)}${w.phone ? `, ${esc(w.phone)}` : ''}${w.tarif ? `, ${esc(w.tarif)}` : ''}</div>${w.note ? `<div class="small">${esc(w.note)}</div>` : ''}</td>
        <td class="small">${esc(frDate(w.created_at.slice(0, 10)))}</td>
        <td>${free.length ? `<select data-seat aria-label="Place">${free.map((f) => `<option value="${f.day}|${f.series}|${f.seat}">${esc(frDate(f.day))}, série ${f.series}, place ${f.seat}</option>`).join('')}</select>` : '<span class="small muted">Aucune place libre</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:4px">${free.length ? '<button class="small primary" data-offer>Proposer</button>' : ''}<button class="small quiet" data-rm>Retirer</button></div></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="small muted">Personne en attente.</p>'}
    ${offered.length ? `<h3>Places proposées</h3><ul class="small">${offered.map((w) => `<li>${esc(w.first_name)} ${esc(w.last_name)}, ${esc(w.number || '')}, code <span class="code">${esc(w.code || '')}</span> :
      ${w.cand_status === 'annule' ? 'a libéré la place' : w.confirmed_at ? '<strong>venue confirmée</strong>' : `en attente de confirmation${dl(w) ? `, jusqu'au ${esc(when(dl(w)))}` : ''}`}</li>`).join('')}</ul>` : ''}
    ${gone.length ? `<p class="small muted">Passées au suivant : ${gone.map((w) => `${esc(w.first_name)} ${esc(w.last_name)} (${w.status === 'expired' ? 'délai dépassé' : 'a décliné'})`).join(', ')}.</p>` : ''}
  </details>`;
  box.querySelector('#wl-open').addEventListener('change', async (e) => {
    await api(`/exams/${exam.id}/planning`, { method: 'PUT', body: { planning: { ...P, waitlist_open: e.target.checked } } });
    toast(e.target.checked ? 'Liste d\'attente ouverte' : 'Liste d\'attente fermée'); waitlistPanel(box, exam);
  });
  const saveAuto = async (body, msg) => { await api(`/exams/${exam.id}/waitlist/settings`, { method: 'PUT', body }); toast(msg); setTimeout(() => waitlistPanel(box, exam), 800); };
  box.querySelector('#wl-auto').addEventListener('change', (e) => saveAuto({ auto: e.target.checked }, e.target.checked ? 'Les places libres partent toutes seules' : 'Les places se proposent à la main'));
  box.querySelector('#wl-h').addEventListener('change', (e) => saveAuto({ hours: Number(e.target.value) }, `Délai de ${e.target.value} h`));
  box.querySelector('#wl-copy').addEventListener('click', async () => { await navigator.clipboard?.writeText(link); toast('Lien copié'); });
  box.querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr'); const w = waiting.find((x) => String(x.id) === tr.dataset.w);
    const [day, series, seat] = tr.querySelector('[data-seat]').value.split('|');
    if (!window.confirm(`Proposer ${frDate(day)}, série ${series} à ${w.first_name} ${w.last_name} ? Il ou elle devient candidat avec son propre code.`)) return;
    try {
      const r = await api(`/waitlist/${w.id}/offer`, { method: 'POST', body: { day, series: Number(series), seat: Number(seat) } });
      await navigator.clipboard?.writeText(`${location.origin}/#/?role=etudiant&code=${r.code}`).catch(() => {});
      toast('Place proposée. Son lien personnel est copié : envoie-le lui (ou l\'e-mail part tout seul si les e-mails sont branchés).');
      waitlistPanel(box, exam);
    } catch (err) { toast(err.message, 'error'); }
  }));
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    if (!window.confirm('Retirer cette personne de la liste d\'attente ?')) return;
    await api(`/waitlist/${b.closest('tr').dataset.w}`, { method: 'DELETE' }); waitlistPanel(box, exam);
  }));
}
