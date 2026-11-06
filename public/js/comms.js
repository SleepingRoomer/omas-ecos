// Page « Communication » : la présentation de l'OMAS et d'OMAS Externat, les liens et l'agenda,
// tels que les voient les étudiants et les participants dans leur espace
import { api, esc, toast, setTitle } from './ui.js';
import { aboutHtml } from './about.js';

export async function commsView(app) {
  setTitle('Communication');
  const A = await api('/about');
  const st = { links: A.links.map((l) => ({ ...l })), events: A.events.map((e) => ({ ...e })) };
  app.innerHTML = '<div id="cm-main"></div><div id="mails" style="margin-top:28px"></div>';
  const root = app.querySelector('#cm-main');
  import('./emails.js').then((m) => m.emailsPanel(app.querySelector('#mails'))).catch(() => {});

  const draw = (preview = A) => {
    root.innerHTML = `
      <h1>Communication</h1>
      <p class="lede">Ce que les étudiants et les participants lisent en bas de leur espace : qui nous sommes, ce que propose OMAS Externat, et les prochains rendez-vous.</p>
      <div class="comms">
        <form id="f" class="panel">
          <label for="c-omas" style="margin-top:0">L'association</label>
          <textarea id="c-omas" rows="7">${esc(A.omas)}</textarea>
          <label for="c-ext">OMAS Externat</label>
          <textarea id="c-ext" rows="7">${esc(A.externat)}</textarea>
          <h3>Liens</h3>
          <p class="small muted">Instagram, site de l'OMAS, adhésion… Adresses en https:// uniquement.</p>
          <div id="links">${st.links.map((l, i) => `<div class="row cm-row" data-i="${i}"><input data-f="label" placeholder="Instagram" value="${esc(l.label)}" style="max-width:180px" aria-label="Libellé">
            <input data-f="url" placeholder="https://…" value="${esc(l.url)}" aria-label="Adresse"><button type="button" class="small quiet" data-rm-link="${i}">Retirer</button></div>`).join('')}</div>
          <button type="button" class="small" id="add-link">Ajouter un lien</button>
          <h3>Autres rendez-vous</h3>
          <p class="small muted">Les sessions d'ECOS blancs et les journées procédure à venir s'affichent d'elles-mêmes. Ajoute ici le reste : conférence, tutorat, soirée d'intégration…</p>
          <div id="events">${st.events.map((e, i) => `<div class="cm-ev" data-i="${i}">
            <div class="grid cols-2" style="gap:8px"><input data-f="title" placeholder="Intitulé" value="${esc(e.title)}" aria-label="Intitulé">
              <div class="row" style="flex-wrap:nowrap"><input type="date" data-f="date" value="${esc(e.date)}" aria-label="Date"><input data-f="place" placeholder="Lieu" value="${esc(e.place || '')}" aria-label="Lieu"></div></div>
            <div class="grid cols-2" style="gap:8px;margin-top:6px"><input data-f="text" placeholder="Une phrase de présentation" value="${esc(e.text || '')}" aria-label="Présentation">
              <div class="row" style="flex-wrap:nowrap"><input data-f="url" placeholder="Lien d'inscription (https://…)" value="${esc(e.url || '')}" aria-label="Lien"><button type="button" class="small quiet" data-rm-ev="${i}">Retirer</button></div></div></div>`).join('')}</div>
          <button type="button" class="small" id="add-ev">Ajouter un rendez-vous</button>
          <div><button class="primary" style="margin-top:18px">Enregistrer</button></div>
        </form>
        <div><div class="small muted" style="margin:4px 0 -20px">Aperçu</div>${aboutHtml(preview)}</div>
      </div>`;
    const read = () => {
      A.omas = app.querySelector('#c-omas').value; A.externat = app.querySelector('#c-ext').value;
      st.links = [...app.querySelectorAll('#links .cm-row')].map((r) => ({ label: r.querySelector('[data-f=label]').value, url: r.querySelector('[data-f=url]').value }));
      st.events = [...app.querySelectorAll('#events .cm-ev')].map((r) => Object.fromEntries(['title', 'date', 'place', 'text', 'url'].map((f) => [f, r.querySelector(`[data-f=${f}]`).value])));
    };
    app.querySelector('#add-link').addEventListener('click', () => { read(); st.links.push({ label: '', url: '' }); draw(preview); });
    app.querySelector('#add-ev').addEventListener('click', () => { read(); st.events.push({ title: '', date: '', place: '', text: '', url: '' }); draw(preview); });
    app.querySelectorAll('[data-rm-link]').forEach((b) => b.addEventListener('click', () => { read(); st.links.splice(+b.dataset.rmLink, 1); draw(preview); }));
    app.querySelectorAll('[data-rm-ev]').forEach((b) => b.addEventListener('click', () => { read(); st.events.splice(+b.dataset.rmEv, 1); draw(preview); }));
    app.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault(); read();
      try {
        const r = await api('/about', { method: 'PUT', body: { omas: A.omas, externat: A.externat, links: st.links, events: st.events } });
        toast(r.ignored_links ? `Enregistré. ${r.ignored_links} lien(s) ignoré(s) : l'adresse doit commencer par https://` : 'Enregistré', r.ignored_links ? 'error' : 'ok');
        const fresh = await api('/about');
        st.links = fresh.links.map((l) => ({ ...l })); st.events = fresh.events.map((x) => ({ ...x }));
        draw(fresh);
      } catch (err) { toast(err.message, 'error'); }
    });
  };
  draw();
}
