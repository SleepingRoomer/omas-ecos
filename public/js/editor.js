import { api, esc, nl, toast, setTitle, frDate } from './ui.js';
import { state } from './app.js';
import { TYPES, TYPE_LINE, STATUSES, COM_ATTENDUS, GLOBAL_LEVELS, COM_LEVELS, uid } from './shared.js';

// Qui doit agir à chaque étape
const NEXT = {
  a_attribuer: { who: 'admin', what: 'Attribuer un rédacteur' },
  redaction: { who: 'author', what: 'Rédiger puis envoyer en relecture' },
  relecture_pair: { who: 'peer', what: 'Relecture par un pair' },
  relecture_expert: { who: 'expert', what: 'Relecture experte' },
  test: { who: 'author', what: 'Tester la station au chronomètre et noter le résultat' },
  corrections: { who: 'author', what: 'Intégrer les retours puis envoyer en validation' },
  validation: { who: 'admin', what: 'Validation finale par le comité' },
  validee: { who: null, what: 'Station prête' },
  refusee: { who: null, what: 'Station remplacée par une réserve' },
};
const ROLE_LABEL = { author: 'rédacteur', peer: 'relecteur pair', expert: 'relecteur expert', admin: 'administrateur' };

// ---------- liste « Mes stations » ----------

export async function myStations(app) {
  setTitle('Mes stations');
  const rows = await api('/redaction/stations');
  const me = state.me.subject_id;
  const myRoles = (s) => [s.author_id === me && 'author', s.peer_id === me && 'peer', s.expert_id === me && 'expert'].filter(Boolean);
  const mustAct = (s) => myRoles(s).includes(NEXT[s.status]?.who);
  const todo = rows.filter(mustAct);
  const other = rows.filter((s) => !mustAct(s));
  const table = (list) => `<div class="table-wrap"><table>
    <thead><tr><th>Session</th><th>Station</th><th>Titre</th><th>Mon rôle</th><th>Étape</th></tr></thead>
    <tbody>${list.map((s) => `<tr class="clickable" data-id="${s.id}">
      <td class="small">${esc(s.exam_name)}</td>
      <td><strong>${esc(s.slot)}</strong><div class="small muted">${esc(s.domain || '')} · ${esc(TYPES[s.type] || '')}</div></td>
      <td>${esc(s.title || 'Sans titre')}</td>
      <td class="small">${myRoles(s).map((r) => ROLE_LABEL[r]).join(', ')}</td>
      <td><span class="badge s-${s.status}">${STATUSES[s.status]}</span></td></tr>`).join('')}</tbody></table></div>`;
  app.innerHTML = `
    <h1>Mes stations</h1>
    <p class="muted">Bonjour ${esc(state.me.name)}. Voici les stations que tu rédiges ou que tu relis.</p>
    <h2>À faire maintenant (${todo.length})</h2>
    ${todo.length ? table(todo) : '<p class="muted">Rien en attente de ta part.</p>'}
    ${other.length ? `<h2>Mes autres stations</h2>${table(other)}` : ''}
    ${rows.length ? '' : '<p class="alert info">Aucune station ne t\'est encore attribuée. L\'équipe d\'organisation t\'en attribuera une bientôt.</p>'}`;
  app.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/station/${tr.dataset.id}`; }));
}

// ---------- éditeur ----------

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o, path, v) {
  const ks = path.split('.');
  const last = ks.pop();
  const target = ks.reduce((a, k) => a[k], o);
  target[last] = v;
}

export async function stationEditor(app, id) {
  const data = await api(`/stations/${id}`);
  const { station: st, rights } = data;
  let content = data.content;
  let checks = data.checks;
  let meta = { title: st.title || '', discipline: st.discipline || '' };
  const ro = !rights.editable;
  setTitle(`${st.slot} · ${st.title || 'Station'}`);

  const myRoles = [rights.isAdmin && 'admin', rights.isAuthor && 'author', rights.isPeer && 'peer', rights.isExpert && 'expert'].filter(Boolean);
  const back = rights.isAdmin ? `#/admin/session/${st.exam_id}/stations` : '#/redaction';

  const field = (path, label, opts = {}) => {
    const v = get(content, path) ?? '';
    const dis = ro ? 'disabled' : '';
    const hint = opts.hint ? ` <span class="hint">${esc(opts.hint)}</span>` : '';
    return `<label>${esc(label)}${hint}</label>${opts.area
      ? `<textarea data-path="${path}" ${dis} rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(v)}</textarea>`
      : `<input type="text" data-path="${path}" ${dis} value="${esc(v)}" placeholder="${esc(opts.ph || '')}">`}`;
  };
  const strList = (path, label, ph) => {
    const arr = get(content, path) || [];
    return `<label>${esc(label)}</label>${arr.map((v, i) => `<div class="listed">
      <input type="text" data-path="${path}.${i}" value="${esc(v)}" placeholder="${esc(ph)}" ${ro ? 'disabled' : ''}>
      ${ro ? '' : `<button type="button" class="small" data-del="${path}" data-i="${i}" title="Supprimer">✕</button>`}</div>`).join('')}
      ${ro ? '' : `<button type="button" class="small" data-add="${path}" data-kind="str">+ Ajouter</button>`}`;
  };

  const sections = () => {
    const c = content;
    const isPS = st.type === 'PS' || st.type === 'PSS';
    const aptN = c.grille.apt.filter((i) => i.label?.trim()).length;
    const comN = c.grille.com.filter((i) => i.label?.trim()).length;
    return `
    <section id="sec-identite" class="card"><h2>1. Identité de la station</h2>
      <div class="grid grid-2">
        <div><label>Titre <span class="hint">(interne, jamais affiché au candidat)</span></label>
          <input type="text" data-meta="title" value="${esc(meta.title)}" ${ro ? 'disabled' : ''} placeholder="Ex. : Hémoptysie de grande abondance"></div>
        <div><label>Discipline</label><input type="text" data-meta="discipline" value="${esc(meta.discipline)}" ${ro ? 'disabled' : ''} placeholder="Pneumologie"></div>
      </div>
      <p class="small">Domaine : <strong>${esc(st.domain || '—')}</strong> · Type : <strong>${esc(TYPES[st.type] || '—')}</strong>
        <span class="muted">(fixés par l'équipe d'organisation)</span></p>
      <div class="grid grid-2">
        <div>${field('identite.sdd', 'Situation de départ (SDD)', { ph: 'Ex. : 178 – Hémoptysie' })}</div>
        <div>${field('identite.item', 'Item de connaissance', { ph: 'Ex. : 204' })}</div>
      </div>
      ${isPS ? field('identite.age', 'Tranche d\'âge du personnage', { ph: '18-30, 30-50, 50-65, > 65 ans' }) : ''}
    </section>

    <section id="sec-vignette" class="card"><h2>2. Vignette du candidat</h2>
      <p class="small muted">Affichée sur la porte et sur la table. Elle doit se lire en 1 minute environ. Le candidat est toujours interne.</p>
      <div class="grid grid-2"><div>${field('vignette.role', 'Rôle', { ph: 'Vous êtes interne aux urgences' })}</div>
        <div>${field('vignette.lieu', 'Lieu', { ph: "Service d'accueil des urgences" })}</div></div>
      ${field('vignette.contexte', 'Contexte', { area: true, ph: 'Mme D., 64 ans, consulte pour…' })}
      ${field('vignette.infos', 'Informations utiles', { area: true, rows: 2, hint: '(facultatif)', ph: 'Constantes, antécédents…' })}
      ${strList('vignette.doit', 'Vous devez :', 'Une consigne par ligne')}
      ${strList('vignette.nedoitpas', 'Vous ne devez pas :', 'Une consigne par ligne')}
      ${field('vignette.documents', 'Documents à disposition', { hint: '(facultatif)', ph: 'ECG, radiographie de thorax' })}
      <p class="small">Dernière ligne, ajoutée automatiquement : <em>${esc(TYPE_LINE[st.type] || '')}</em></p>
    </section>

    <section id="sec-examinateur" class="card"><h2>3. Consignes à l'examinateur</h2>
      ${field('examinateur.scenario', 'Explication du scénario', { area: true })}
      ${field('examinateur.consignes', 'Consignes', { area: true, ph: 'Ce que l\'examinateur remet et à quel moment. Rappel : aucune interaction avec le candidat.' })}
    </section>

    <section id="sec-script" class="card"><h2>4. Script ${st.type === 'PSS' ? 'du PSS' : 'du PS'}</h2>
      ${isPS ? `
      ${field('script.personnage', 'Personnage', { ph: 'Âge, profession, situation familiale, tenue' })}
      ${field('script.installation', 'Installation en début de station', { area: true, rows: 2 })}
      ${field('script.histoire', 'Histoire à raconter', { area: true, rows: 5, ph: 'Motif, symptômes, chronologie : uniquement ce qui est nécessaire au rôle' })}
      ${field('script.demarrage', 'Phrase de démarrage')}
      ${strList('script.relances', 'Relances prévues', 'Si le candidat… le PS dit…')}
      <label>Réactions aux questions et actions du candidat</label>
      ${c.script.reactions.map((r, i) => `<div class="item-row"><div class="grid grid-2">
        <input type="text" data-path="script.reactions.${i}.q" value="${esc(r.q)}" placeholder="Si le candidat demande…" ${ro ? 'disabled' : ''}>
        <input type="text" data-path="script.reactions.${i}.r" value="${esc(r.r)}" placeholder="Le PS répond…" ${ro ? 'disabled' : ''}></div>
        ${ro ? '' : `<button type="button" class="small" data-del="script.reactions" data-i="${i}">Supprimer</button>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="script.reactions" data-kind="qr">+ Ajouter une réaction</button>'}
      ${field('script.attitude', 'Attitude et état d\'esprit', { area: true, rows: 2 })}
      ${strList('script.neutres', 'Réponses neutres aux questions imprévues', 'Je ne sais pas, docteur.')}` : '<p class="muted">Pas de PS ni de PSS dans cette station.</p>'}
    </section>

    <section id="sec-documents" class="card"><h2>5. Documents</h2>
      <p class="small muted">Imprimés recto et plastifiés. Le lien peut pointer vers un fichier du Drive de l'équipe.</p>
      ${c.documents.map((d, i) => `<div class="item-row"><div class="grid grid-2">
        <input type="text" data-path="documents.${i}.nom" value="${esc(d.nom)}" placeholder="Nom du document" ${ro ? 'disabled' : ''}>
        <select data-path="documents.${i}.remis_par" ${ro ? 'disabled' : ''}>${['Sur la table', "Remis par l'examinateur", 'Remis par le PS ou le PSS'].map((o) =>
          `<option ${o === d.remis_par ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input type="text" data-path="documents.${i}.description" value="${esc(d.description)}" placeholder="Description, moment de remise" ${ro ? 'disabled' : ''}>
        <input type="text" data-path="documents.${i}.lien" value="${esc(d.lien)}" placeholder="Lien vers le fichier" ${ro ? 'disabled' : ''}></div>
        ${ro ? '' : `<button type="button" class="small" data-del="documents" data-i="${i}">Supprimer</button>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="documents" data-kind="doc">+ Ajouter un document</button>'}
    </section>

    <section id="sec-materiel" class="card"><h2>6. Matériel</h2>
      <p class="small muted">« Par candidat » sert à calculer les quantités pour toute la session.</p>
      ${c.materiel.liste.length ? `<table><thead><tr><th>Article</th><th class="num">Installé</th><th class="num">Par candidat</th><th></th></tr></thead><tbody>
      ${c.materiel.liste.map((m, i) => `<tr><td><input type="text" data-path="materiel.liste.${i}.article" value="${esc(m.article)}" ${ro ? 'disabled' : ''}></td>
        <td><input type="number" min="0" data-num data-path="materiel.liste.${i}.installe" value="${esc(m.installe)}" ${ro ? 'disabled' : ''} style="width:80px"></td>
        <td><input type="number" min="0" step="0.5" data-num data-path="materiel.liste.${i}.par_candidat" value="${esc(m.par_candidat)}" ${ro ? 'disabled' : ''} style="width:80px"></td>
        <td>${ro ? '' : `<button type="button" class="small" data-del="materiel.liste" data-i="${i}">✕</button>`}</td></tr>`).join('')}</tbody></table>` : ''}
      ${ro ? '' : '<button type="button" class="small" data-add="materiel.liste" data-kind="mat">+ Ajouter un article</button>'}
      ${field('materiel.disposition', 'Disposition de la salle', { area: true, rows: 2, ph: 'Table face à la porte, PS assis sur le brancard…' })}
    </section>

    <section id="sec-grille" class="card"><h2>7. Grille d'évaluation</h2>
      <h3>Aptitudes cliniques et techniques <span class="badge ${aptN >= 10 && aptN <= 15 ? 'ok' : 'warn'}">${aptN} / 10 à 15</span></h3>
      <p class="small muted">Un indicateur = une action observable. Quand plusieurs réponses sont acceptées, précise le seuil (« cite au moins 2 des 4… »).</p>
      ${c.grille.apt.map((it, i) => `<div class="item-row"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">
        <strong style="width:24px;padding-top:8px">${i + 1}.</strong>
        <textarea data-path="grille.apt.${i}.label" rows="2" style="min-height:44px" ${ro ? 'disabled' : ''} placeholder="${i === 0 ? 'Recherche les signes de mauvaise tolérance : FC, FR, PA, SpO2 (point si 3/4)' : ''}">${esc(it.label)}</textarea>
        <input type="number" min="0.5" step="0.5" data-num data-path="grille.apt.${i}.points" value="${esc(it.points ?? 1)}" title="Points" style="width:64px" ${ro ? 'disabled' : ''}>
        ${ro ? '' : `<span class="row" style="flex-direction:column;gap:2px"><button type="button" class="small" data-up="grille.apt" data-i="${i}" title="Monter">↑</button>
          <button type="button" class="small" data-down="grille.apt" data-i="${i}" title="Descendre">↓</button>
          <button type="button" class="small" data-del="grille.apt" data-i="${i}" title="Supprimer">✕</button></span>`}</div></div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="grille.apt" data-kind="apt">+ Ajouter un indicateur</button>'}

      <h3>Communication et attitudes <span class="badge ${comN >= 2 && comN <= 5 ? 'ok' : 'warn'}">${comN} / 2 à 5</span></h3>
      <p class="small muted">Chaque attendu est coté ${COM_LEVELS.map((l) => `${l.l.toLowerCase()} (${String(l.v).replace('.', ',')})`).join(', ')}.</p>
      ${c.grille.com.map((it, i) => `<div class="item-row"><div class="row" style="flex-wrap:nowrap">
        <select data-path="grille.com.${i}.label" ${ro ? 'disabled' : ''}><option value="">— Choisir un attendu —</option>
          ${[...new Set([...COM_ATTENDUS, it.label].filter(Boolean))].map((a) => `<option ${a === it.label ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        ${ro ? '' : `<button type="button" class="small" data-del="grille.com" data-i="${i}">✕</button>`}</div></div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="grille.com" data-kind="com">+ Ajouter un attendu</button>'}

      <h3>Performance globale (0 à 4, ne compte pas dans la note)</h3>
      <p class="small muted">Décris ce qu'on attend à chaque niveau pour cette station : c'est ce qui aligne les évaluateurs.</p>
      ${GLOBAL_LEVELS.map((l, i) => `<label>${i} – ${l}</label><input type="text" data-path="grille.global.${i}" value="${esc(c.grille.global[i])}" ${ro ? 'disabled' : ''}>`).join('')}
    </section>

    <section id="sec-pedago" class="card"><h2>8. Fiche pédagogique</h2>
      <p class="small muted">Envoyée aux candidats avec leur bulletin quand les corrections sont publiées.</p>
      ${field('pedago.correction', 'Correction commentée', { area: true, rows: 8, ph: 'Ce qui était attendu, les pièges, les points clés à retenir' })}
      ${field('pedago.references', 'Références', { area: true, rows: 2, ph: 'Recommandations, référentiel du collège…' })}
    </section>`;
  };

  const actionsFor = () => {
    const step = NEXT[st.status];
    const acts = [];
    const can = (who) => myRoles.includes(who) || myRoles.includes('admin');
    if (st.status === 'redaction' && can('author')) acts.push(['submit', 'Envoyer en relecture pair', 'primary']);
    if (st.status === 'relecture_pair' && can('peer')) acts.push(['approve', 'Relecture OK : passer à l\'expert', 'primary'], ['revise', 'À revoir : renvoyer au rédacteur', 'danger']);
    if (st.status === 'relecture_expert' && can('expert')) acts.push(['approve', 'Relecture OK : passer au test', 'primary'], ['revise', 'À revoir : renvoyer au rédacteur', 'danger']);
    if (st.status === 'test' && can('author')) acts.push(['approve', 'Test concluant : passer aux corrections', 'primary'], ['revise', 'Test à refaire : repasser en rédaction', 'danger']);
    if (st.status === 'corrections' && can('author')) acts.push(['submit', 'Envoyer en validation finale', 'primary']);
    if (st.status === 'validation' && myRoles.includes('admin')) acts.push(['approve', 'Valider la station', 'primary'], ['revise', 'Renvoyer en corrections', ''], ['refuse', 'Remplacer par une réserve', 'danger']);
    return { step, acts };
  };

  const workflow = () => {
    const { step, acts } = actionsFor();
    const errors = checks.filter((x) => x.level === 'error');
    return `<div class="card">
      <div class="row between"><div><span class="badge s-${st.status}">${STATUSES[st.status]}</span>
        <span class="small">${esc(step.what)}${step.who && step.who !== 'admin' ? ` · ${esc({ author: st.author_name, peer: st.peer_name, expert: st.expert_name }[step.who] || 'à attribuer')}` : ''}</span></div>
        <span class="small muted">Rédacteur : ${esc(st.author_name || '—')} · Pair : ${esc(st.peer_name || '—')} · Expert : ${esc(st.expert_name || '—')}</span></div>
      ${acts.length ? `<textarea id="wf-comment" rows="2" placeholder="Commentaire (obligatoire pour renvoyer ou remplacer)" style="margin-top:10px"></textarea>
        <div class="row" style="margin-top:8px">${acts.map(([a, l, cls]) => `<button class="${cls}" data-act="${a}">${esc(l)}</button>`).join('')}</div>` : ''}
      <details ${errors.length ? 'open' : ''} style="margin-top:10px"><summary class="small"><strong>Check-list qualité</strong> :
        ${errors.length ? `${errors.length} point(s) bloquant(s)` : 'aucun point bloquant'}${checks.length - errors.length ? `, ${checks.length - errors.length} conseil(s)` : ''}</summary>
        ${checks.length ? `<ul class="checks small">${checks.map((x) => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}</ul>` : '<p class="small alert ok">Tout est complet.</p>'}
      </details></div>`;
  };

  const history = () => `<section id="sec-echanges" class="card"><h2>Échanges et historique</h2>
    <textarea id="new-comment" rows="2" placeholder="Laisser un commentaire pour l'équipe de la station"></textarea>
    <button class="small" id="send-comment" style="margin:6px 0 12px">Commenter</button>
    <ul class="timeline">${data.reviews.map((r) => `<li class="${r.action}"><div class="small"><strong>${esc(r.author_name)}</strong>
      <span class="muted">· ${esc({ comment: 'commentaire', submit: 'envoi', approve: 'validé', revise: 'à revoir', refuse: 'remplacée', status: 'statut' }[r.action] || r.action)}
      · ${esc(STATUSES[r.stage] || '')} · ${new Date(`${r.created_at}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      ${r.comment ? `<div>${nl(r.comment)}</div>` : ''}</li>`).join('') || '<li class="muted small">Aucun échange pour l\'instant.</li>'}</ul></section>`;

  const draw = () => {
    const y = window.scrollY;
    app.innerHTML = `
      <p class="small no-print"><a href="${back}">← Retour</a></p>
      <div class="row between"><div><h1>${esc(st.slot)} · ${esc(meta.title || 'Station sans titre')}</h1>
        <div class="muted small">${esc(st.exam_name)} · ${esc(st.domain || '')} · ${esc(TYPES[st.type] || '')}</div></div>
        <div class="row"><span class="save-state" id="save-state">${ro ? 'Lecture seule à cette étape' : 'Enregistrement automatique'}</span>
          <a class="btn small" href="#/apercu/${st.id}/vignette" target="_blank">Vignette</a>
          <a class="btn small" href="#/apercu/${st.id}/dossier" target="_blank">Dossier complet</a>
          <a class="btn small" href="#/apercu/${st.id}/grille" target="_blank">Grille papier</a></div></div>
      ${workflow()}
      <div class="editor-layout">
        <nav class="editor-nav card">${[['identite', 'Identité'], ['vignette', 'Vignette'], ['examinateur', 'Examinateur'], ['script', 'Script PS'],
          ['documents', 'Documents'], ['materiel', 'Matériel'], ['grille', 'Grille'], ['pedago', 'Fiche pédagogique'], ['echanges', 'Échanges']]
          .map(([k, l]) => `<a href="javascript:void(0)" data-go="sec-${k}">${l}</a>`).join('')}</nav>
        <div id="form">${sections()}${history()}</div>
      </div>`;
    window.scrollTo(0, y);
    bind();
  };

  let timer = null;
  const setState = (t) => { const el = document.getElementById('save-state'); if (el) el.textContent = t; };
  const save = async () => {
    try {
      const r = await api(`/stations/${st.id}/content`, { method: 'PUT', body: { content, ...meta } });
      checks = r.checks;
      st.title = meta.title;
      setState(`Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) { setState('Erreur d\'enregistrement'); toast(err.message, 'error'); }
  };
  const schedule = () => { setState('Modifications en cours…'); clearTimeout(timer); timer = setTimeout(save, 1200); };
  const flush = async () => { if (timer) { clearTimeout(timer); timer = null; await save(); } };

  const NEW = {
    str: () => '', qr: () => ({ q: '', r: '' }), doc: () => ({ nom: '', remis_par: 'Sur la table', description: '', lien: '' }),
    mat: () => ({ article: '', installe: 1, par_candidat: 0 }), apt: () => ({ id: uid(), label: '', points: 1 }), com: () => ({ id: uid(), label: '' }),
  };

  function bind() {
    const form = app.querySelector('#form');
    app.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => document.getElementById(a.dataset.go)?.scrollIntoView({ behavior: 'smooth' })));
    if (!ro) {
      form.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.meta) { meta[t.dataset.meta] = t.value; schedule(); return; }
        if (!t.dataset.path) return;
        set(content, t.dataset.path, t.dataset.num !== undefined ? (t.value === '' ? '' : Number(t.value)) : t.value);
        schedule();
      });
      form.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' && e.target.dataset.path?.startsWith('grille.com')) { flush().then(draw); } });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const i = Number(b.dataset.i);
        if (b.dataset.add) { get(content, b.dataset.add).push(NEW[b.dataset.kind]()); }
        else if (b.dataset.del) { get(content, b.dataset.del).splice(i, 1); }
        else if (b.dataset.up && i > 0) { const a = get(content, b.dataset.up); [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
        else if (b.dataset.down) { const a = get(content, b.dataset.down); if (i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]]; }
        else return;
        schedule(); draw();
      });
    }
    app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      await flush();
      try {
        await api(`/stations/${st.id}/review`, { method: 'POST', body: { action: b.dataset.act, comment: app.querySelector('#wf-comment')?.value } });
        toast('Étape enregistrée');
        stationEditor(app, id);
      } catch (err) { toast(err.message, 'error'); }
    }));
    app.querySelector('#send-comment')?.addEventListener('click', async () => {
      const t = app.querySelector('#new-comment').value.trim();
      if (!t) return;
      await flush();
      try { await api(`/stations/${st.id}/review`, { method: 'POST', body: { action: 'comment', comment: t } }); stationEditor(app, id); } catch (err) { toast(err.message, 'error'); }
    });
  }

  window.addEventListener('hashchange', flush, { once: true });
  draw();
}

// ---------- aperçus imprimables ----------

function vignetteHtml(st, c) {
  const v = c.vignette;
  const list = (a) => a.filter((x) => x?.trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  return `<div class="vignette-nat">
    <p>${esc(v.role)}${v.role && v.lieu ? ' – ' : ''}${esc(v.lieu)}</p>
    ${v.contexte ? `<p>${nl(v.contexte)}</p>` : ''}
    ${v.infos ? `<p>${nl(v.infos)}</p>` : ''}
    ${list(v.doit) ? `<p><strong>Vous devez :</strong></p><ul>${list(v.doit)}</ul>` : ''}
    ${list(v.nedoitpas) ? `<p><strong>Vous ne devez pas :</strong></p><ul>${list(v.nedoitpas)}</ul>` : ''}
    ${v.documents ? `<p>Documents à disposition : ${esc(v.documents)}</p>` : ''}
    <p><strong>${esc(TYPE_LINE[st.type] || '')}</strong></p></div>`;
}

function paperGrid(st, c, header = true) {
  const apt = c.grille.apt.filter((i) => i.label?.trim());
  const com = c.grille.com.filter((i) => i.label?.trim());
  return `${header ? `<div class="print-head"><span>ECOS blancs OMAS · ${esc(st.exam_name || '')}</span><span>Station ${esc(st.slot)}</span></div>
    <h2 style="margin-top:0">Grille de secours · Station ${esc(st.slot)}</h2>
    <p>N° candidat : ______________ &nbsp;&nbsp; Évaluateur : ______________________ &nbsp;&nbsp; □ Absent</p>` : ''}
    <table class="paper-grid"><thead><tr><th>#</th><th>Aptitudes cliniques et techniques</th><th>Pts</th><th>Observé</th><th>Non obs.</th></tr></thead><tbody>
    ${apt.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.label)}</td><td>${i.points || 1}</td><td><span class="box"></span></td><td><span class="box"></span></td></tr>`).join('')}
    </tbody></table>
    <table class="paper-grid" style="margin-top:8px"><thead><tr><th>Communication et attitudes</th>${COM_LEVELS.map((l) => `<th>${esc(l.l)}<br>${String(l.v).replace('.', ',')}</th>`).join('')}</tr></thead><tbody>
    ${com.map((i) => `<tr><td>${esc(i.label)}</td>${COM_LEVELS.map(() => '<td><span class="box"></span></td>').join('')}</tr>`).join('')}</tbody></table>
    <table class="paper-grid" style="margin-top:8px"><thead><tr><th>Performance globale</th>${GLOBAL_LEVELS.map((l, k) => `<th>${k} – ${esc(l)}</th>`).join('')}</tr></thead>
    <tbody><tr><td></td>${GLOBAL_LEVELS.map(() => '<td><span class="box"></span></td>').join('')}</tr>
    <tr><td class="small">Descripteurs</td>${c.grille.global.map((d) => `<td class="small">${esc(d)}</td>`).join('')}</tr></tbody></table>
    <p style="margin-top:10px">Commentaire (une force, un point à travailler) :</p>
    <div style="border-bottom:1px solid #999;height:22px"></div><div style="border-bottom:1px solid #999;height:22px"></div>`;
}

export async function preview(app, id, kind) {
  const data = await api(`/stations/${id}`);
  const st = data.station;
  const c = data.content;
  setTitle(`${kind === 'vignette' ? 'Vignette' : kind === 'grille' ? 'Grille' : 'Dossier'} ${st.slot}`);
  const bar = `<div class="row no-print" style="margin-bottom:8px"><button class="primary" onclick="window.print()">Imprimer</button>
    <span class="small muted">${kind === 'vignette' ? 'Format national : A4 paysage, Arial 14, interligne 1,5, texte non justifié.' : ''}</span></div>`;
  if (kind === 'vignette') {
    app.innerHTML = `${bar}<div class="sheet landscape">${vignetteHtml(st, c)}</div><div class="sheet landscape">${vignetteHtml(st, c)}</div>`;
    return;
  }
  if (kind === 'grille') {
    app.innerHTML = `${bar}<div class="sheet portrait">${paperGrid(st, c)}</div>`;
    return;
  }
  if (data.rights.isEval) { app.innerHTML = '<p class="alert error">Accès réservé à l\'équipe de rédaction.</p>'; return; }
  const s = c.script;
  const li = (a) => a.filter((x) => x?.trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  app.innerHTML = `${bar}<div class="sheet portrait">
    <div class="print-head"><span>ECOS blancs OMAS · ${esc(st.exam_name)}</span><span>Station ${esc(st.slot)} · ${esc(STATUSES[st.status])}</span></div>
    <h1>${esc(st.slot)} · ${esc(st.title || '')}</h1>
    <p>${esc(st.domain || '')} · ${esc(TYPES[st.type] || '')} · ${esc(st.discipline || '')}<br>
      SDD : ${esc(c.identite.sdd)} · Item : ${esc(c.identite.item)}<br>
      Rédaction : ${esc(st.author_name || '—')} · Relecture : ${esc(st.peer_name || '—')}, ${esc(st.expert_name || '—')}</p>
    <h2>Vignette</h2><div style="border:1px solid #ccc;padding:10px">${vignetteHtml(st, c)}</div>
    <h2>Consignes à l'examinateur</h2><p>${nl(c.examinateur.scenario)}</p><p>${nl(c.examinateur.consignes)}</p>
    ${st.type === 'PS' || st.type === 'PSS' ? `<h2>Script ${st.type}</h2>
      <p><strong>Personnage :</strong> ${esc(s.personnage)} ${c.identite.age ? `(${esc(c.identite.age)})` : ''}</p>
      <p><strong>Installation :</strong> ${nl(s.installation)}</p><p><strong>Histoire :</strong><br>${nl(s.histoire)}</p>
      <p><strong>Phrase de démarrage :</strong> « ${esc(s.demarrage)} »</p>
      ${li(s.relances) ? `<p><strong>Relances :</strong></p><ul>${li(s.relances)}</ul>` : ''}
      ${s.reactions.filter((r) => r.q || r.r).length ? `<table class="paper-grid"><thead><tr><th>Si le candidat…</th><th>Le PS…</th></tr></thead><tbody>
        ${s.reactions.filter((r) => r.q || r.r).map((r) => `<tr><td>${esc(r.q)}</td><td>${esc(r.r)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p><strong>Attitude :</strong> ${nl(s.attitude)}</p>
      ${li(s.neutres) ? `<p><strong>Réponses neutres :</strong></p><ul>${li(s.neutres)}</ul>` : ''}` : ''}
    ${c.documents.length ? `<h2>Documents</h2><ul>${c.documents.map((d) => `<li><strong>${esc(d.nom)}</strong> – ${esc(d.remis_par)}${d.description ? ` : ${esc(d.description)}` : ''}${d.lien ? ` (<a href="${esc(d.lien)}">lien</a>)` : ''}</li>`).join('')}</ul>` : ''}
    ${c.materiel.liste.length ? `<h2>Matériel</h2><table class="paper-grid"><thead><tr><th>Article</th><th>Installé</th><th>Par candidat</th></tr></thead><tbody>
      ${c.materiel.liste.map((m) => `<tr><td>${esc(m.article)}</td><td>${esc(m.installe)}</td><td>${esc(m.par_candidat)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${c.materiel.disposition ? `<p><strong>Disposition :</strong> ${nl(c.materiel.disposition)}</p>` : ''}
    <h2>Grille</h2>${paperGrid(st, c, false)}
    <h2>Fiche pédagogique</h2><p>${nl(c.pedago.correction)}</p><p class="small"><strong>Références :</strong> ${nl(c.pedago.references)}</p>
  </div>`;
}

export { frDate };
