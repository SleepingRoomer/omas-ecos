// Questionnaire de deux minutes, après le passage
import { api, esc, toast, plate } from './ui.js';

const STARS = [1, 2, 3, 4, 5];

export async function feedbackPanel(box) {
  let F;
  try { F = await api('/me/feedback'); } catch { box.innerHTML = ''; return; }
  if (!F.open) { box.innerHTML = ''; return; }
  const draft = { global: null, organisation: null, recommend: null, stations: {}, comment: '', ...(F.mine || {}) };
  let editing = !F.mine;

  const stars = (key, value, label) => `<div class="fb-q"><span class="fb-l">${label}</span>
    <span class="fb-stars" role="radiogroup" aria-label="${esc(label)}">${STARS.map((v) => `<button type="button" role="radio" aria-checked="${value === v}" aria-label="${v} sur 5"
      class="${value !== null && v <= value ? 'on' : ''}" data-k="${key}" data-v="${v}">★</button>`).join('')}</span></div>`;

  const draw = () => {
    if (!editing) {
      box.innerHTML = `<div class="panel fb-done"><strong>Merci pour ton avis !</strong> Il aide l'équipe à améliorer les prochaines sessions.
        <button class="small quiet" id="fb-edit">Modifier</button></div>`;
      box.querySelector('#fb-edit').addEventListener('click', () => { editing = true; draw(); });
      return;
    }
    box.innerHTML = `<h2>Ton avis compte</h2>
      <div class="panel fb">
        <p class="small muted" style="margin-top:0">Deux minutes, anonymes pour l'équipe : tes réponses ne sont jamais affichées avec ton nom.</p>
        ${stars('global', draft.global, 'Dans l\'ensemble, ces ECOS blancs t\'ont été utiles')}
        ${stars('organisation', draft.organisation, 'Accueil, horaires, organisation')}
        <h3>La clarté de chaque station</h3>
        <p class="small muted">Vignette compréhensible, consignes nettes, patient crédible. Laisse vide si tu ne sais plus.</p>
        <div class="fb-stations">${F.slots.map((s) => `<div class="fb-q">${plate(s, 'sm')}
          <span class="fb-stars">${STARS.map((v) => `<button type="button" aria-label="${s}, ${v} sur 5" class="${draft.stations[s] && v <= draft.stations[s] ? 'on' : ''}" data-s="${s}" data-v="${v}">★</button>`).join('')}</span></div>`).join('')}</div>
        <h3>Conseillerais-tu ces ECOS blancs à un ami ?</h3>
        <div class="fb-nps" role="radiogroup" aria-label="De 0 à 10">${Array.from({ length: 11 }, (_, v) => `<button type="button" class="${draft.recommend === v ? 'on' : ''}" data-r="${v}">${v}</button>`).join('')}</div>
        <div class="fb-scale small muted"><span>Pas du tout</span><span>Les yeux fermés</span></div>
        <label for="fb-c">Un mot pour l'équipe</label>
        <textarea id="fb-c" rows="3" placeholder="Ce qui t'a plu, ce qu'on peut améliorer">${esc(draft.comment || '')}</textarea>
        <button class="primary" id="fb-send" style="margin-top:12px">Envoyer mon avis</button>
      </div>`;
    const keep = () => { draft.comment = box.querySelector('#fb-c').value; };
    box.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => { keep(); draft[b.dataset.k] = Number(b.dataset.v); redraw(); }));
    box.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { keep(); draft.stations[b.dataset.s] = Number(b.dataset.v); redraw(); }));
    box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { keep(); draft.recommend = Number(b.dataset.r); redraw(); }));
    box.querySelector('#fb-send').addEventListener('click', async () => {
      keep();
      try { await api('/me/feedback', { method: 'POST', body: draft }); toast('Merci pour ton avis !'); editing = false; draw(); } catch (e) { toast(e.message, 'error'); }
    });
  };
  const redraw = () => { const y = window.scrollY; draw(); window.scrollTo(0, y); };
  draw();
}
