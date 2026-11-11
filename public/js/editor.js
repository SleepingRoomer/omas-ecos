import { api, esc, nl, toast, setTitle, frDate, plate, atelierPlate, rail, FLOW_ORDER, FLOW_SHORT, dom, disc, uploadStationFile, fileThumb } from './ui.js';
import { state } from './app.js';
import { TYPES, TYPES_SHORT, TYPE_LINE, STATUSES, COM_ATTENDUS, GLOBAL_LEVELS, COM_LEVELS, DISCIPLINES, uid } from './shared.js';
import { SDD, sddLabel } from './sdd.js';

// Qui doit agir à chaque étape
const NEXT = {
  a_attribuer: { who: 'admin', what: 'En attente d\'un rédacteur' },
  redaction: { who: 'author', what: 'Rédaction en cours' },
  relecture_pair: { who: 'peer', what: 'Relecture par un pair' },
  relecture_expert: { who: 'expert', what: 'Relecture experte' },
  test: { who: 'author', what: 'Test au chronomètre avec un PS et un testeur' },
  corrections: { who: 'author', what: 'Intégration des retours' },
  validation: { who: 'admin', what: 'Validation finale par le comité' },
  validee: { who: null, what: 'Station prête à être jouée' },
  refusee: { who: null, what: 'Station remplacée par une réserve' },
};
const ROLE_LABEL = { author: 'Rédaction', peer: 'Relecture pair', expert: 'Relecture expert' };

// ---------- « Mes stations » ----------

export async function myStations(app) {
  setTitle('Mes stations et ateliers');
  const [rows, ats] = await Promise.all([api('/redaction/stations'), api('/redaction/ateliers')]);
  const me = state.me.subject_id;
  const myRoles = (s) => [s.author_id === me && 'author', s.peer_id === me && 'peer', s.expert_id === me && 'expert'].filter(Boolean);
  const mustAct = (s) => myRoles(s).includes(NEXT[s.status]?.who);
  const todo = rows.filter(mustAct);
  const other = rows.filter((s) => !mustAct(s));
  const list = (items, urgent) => items.map((s) => `<a class="panel row" href="#/station/${s.id}" style="text-decoration:none;color:inherit;margin:8px 0;flex-wrap:nowrap;${urgent ? 'border-color:var(--r)' : ''}">
      ${plate(s.slot, 'lg')}
      <div style="flex:1;min-width:0"><strong>${esc(s.title || 'Station sans titre')}</strong>
        <div class="tags small" style="margin-top:2px">${dom(s.domain)}${s.discipline ? `<span>${disc(s.discipline)}</span>` : ''}<span class="faint">${esc(s.exam_name)}</span></div>
        ${rail(s.status, true)}</div>
      <div style="text-align:right"><span class="pill s-${s.status}">${STATUSES[s.status]}</span>
        <div class="small muted" style="margin-top:4px">${myRoles(s).map((r) => ROLE_LABEL[r]).join(', ')}</div>
        ${urgent && s.deadline ? `<div class="small" style="margin-top:4px;${s.deadline.late ? 'color:var(--ko);font-weight:700' : ''}">${s.deadline.late ? `${s.deadline.late} j de retard` : `à rendre avant le ${esc(frDate(s.deadline.date))}`}</div>` : ''}</div></a>`).join('');
  app.innerHTML = `<div class="narrow">
    <h1>Mes stations</h1>
    <p class="lede">Bonjour ${esc(state.me.name.split(' ')[0])}.${todo.length ? ` ${todo.length === 1 ? 'Une station attend' : `${todo.length} stations attendent`} ton passage.` : ' Rien ne t\'attend pour l\'instant.'}</p>
    ${todo.length ? `<h2>À toi de jouer</h2>${list(todo, true)}` : ''}
    ${other.length ? `<h2>${todo.length ? 'Les autres' : 'Tes stations'}</h2>${list(other, false)}` : ''}
    ${ats.length ? `<h2>Mes ateliers de journée procédure</h2>${ats.map((a) => { const urgent = (a.status === 'redaction' && a.author_id === me) || (a.status === 'relecture' && a.reviewer_id === me);
      return `<a class="panel row" href="#/atelier/${a.id}" style="text-decoration:none;color:inherit;margin:8px 0;flex-wrap:nowrap;${urgent ? 'border-color:var(--r)' : ''}">
      ${atelierPlate(a.code, a.emoji, 'lg')}<div style="flex:1;min-width:0"><strong>${esc(a.title || 'Atelier sans titre')}</strong>
        <div class="tags small" style="margin-top:2px">${a.discipline ? `<span>${disc(a.discipline)}</span>` : ''}<span class="faint">${esc(a.jp_name)}</span></div></div>
      <div style="text-align:right"><span class="pill ${a.status === 'validee' ? 'ok' : a.status === 'relecture' ? 'warn' : 's-redaction'}">${{ redaction: 'Rédaction', relecture: 'Relecture', validee: 'Validée' }[a.status]}</span>
        <div class="small muted" style="margin-top:4px">${a.author_id === me ? 'Référent' : 'Relecture'}</div></div></a>`; }).join('')}` : ''}
    ${state.me?.lead ? `<div class="panel"><strong>Responsable de rédaction</strong><p class="small muted" style="margin:4px 0 10px">Tu peux créer, attribuer, relire et valider toutes les stations, sans accès aux candidats ni aux notes.</p>
      <div class="row"><a class="btn small" href="#/redaction/stations">Toutes les stations</a><a class="btn small" href="#/redaction/reserve">Réserve</a><a class="btn small" href="#/redaction/suivi">Suivi des disciplines, domaines et SDD</a></div></div>`
      : rows.length || ats.length ? '' : '<p class="alert info">Rien ne t\'est encore attribué. Les organisateurs s\'en occupent.</p>'}</div>`;
}

// ---------- éditeur ----------

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o, path, v) {
  const ks = path.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
}
// Rattache chaque alerte de la check-list à sa section
const CHECK_SECTION = [[/^Vignette/, 'vignette'], [/^Script/, 'script'], [/^Grille/, 'grille'], [/^Fiche/, 'pedago'], [/^Matériel/, 'materiel'],
  [/examinateur/, 'examinateur'], [/titre|domaine|SDD/i, 'identite']];
const sectionOf = (msg) => (CHECK_SECTION.find(([re]) => re.test(msg)) || [null, 'identite'])[1];

const SECTIONS = [['identite', 'Identité'], ['vignette', 'Vignette'], ['examinateur', 'Examinateur'], ['script', 'Script'],
  ['documents', 'Documents'], ['materiel', 'Matériel'], ['grille', 'Grille'], ['pedago', 'Correction']];

export async function stationEditor(app, id) {
  const data = await api(`/stations/${id}`);
  const { station: st, rights } = data;
  const content = data.content;
  let checks = data.checks;
  const meta = { title: st.title || '', discipline: st.discipline || '' };
  let otherDisc = !!meta.discipline && !DISCIPLINES.some(([n]) => n === meta.discipline);
  const ro = !rights.editable;
  setTitle(`${st.slot}, ${st.title || 'station'}`);

  const myRoles = [rights.isAdmin && 'admin', rights.isAuthor && 'author', rights.isPeer && 'peer', rights.isExpert && 'expert'].filter(Boolean);
  // le responsable de rédaction a les droits des organisateurs, mais revient dans son espace
  const back = state.me?.lead ? `#/redaction/stations/${st.exam_id}` : rights.isAdmin ? `#/admin/session/${st.exam_id}/stations` : '#/redaction';
  const dis = ro ? 'disabled' : '';

  const field = (path, label, opts = {}) => {
    const v = get(content, path) ?? '';
    const fid = `f-${path.replace(/\./g, '-')}`;
    const hint = opts.hint ? ` <span class="hint">${esc(opts.hint)}</span>` : '';
    return `<label for="${fid}">${esc(label)}${hint}</label>${opts.area
      ? `<textarea id="${fid}" data-path="${path}" ${dis} rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(v)}</textarea>`
      : `<input id="${fid}" type="text" data-path="${path}" ${dis} value="${esc(v)}" placeholder="${esc(opts.ph || '')}" ${opts.list ? `list="${opts.list}" autocomplete="off"` : ''}>`}`;
  };
  const strList = (path, label, ph, addLabel) => {
    const arr = get(content, path) || [];
    return `<label>${esc(label)}</label>${arr.map((v, i) => `<div class="listed">
      <input type="text" data-path="${path}.${i}" value="${esc(v)}" placeholder="${i === 0 ? esc(ph) : ''}" ${dis} aria-label="${esc(label)} ${i + 1}">
      ${ro ? '' : `<button type="button" class="small quiet" data-del="${path}" data-i="${i}" aria-label="Retirer">Retirer</button>`}</div>`).join('')}
      ${ro ? '' : `<button type="button" class="small quiet" data-add="${path}" data-kind="str">${esc(addLabel)}</button>`}`;
  };
  const head = (k, n, title, help) => `<div class="sec-title"><span class="n">${n}</span><h2 style="margin:0">${title}</h2></div>${help ? `<p class="sec-help">${help}</p>` : ''}`;

  const sections = () => {
    const c = content;
    const isPS = st.type === 'PS' || st.type === 'PSS';
    const aptN = c.grille.apt.filter((i) => i.label?.trim()).length;
    const comN = c.grille.com.filter((i) => i.label?.trim()).length;
    return `
    <section id="sec-identite" class="panel">${head('identite', 1, 'Identité de la station')}
      <div class="grid cols-2">
        <div><label for="m-title">Titre <span class="hint">(interne, jamais montré au candidat)</span></label>
          <input id="m-title" type="text" data-meta="title" value="${esc(meta.title)}" ${dis} placeholder="Hémoptysie de grande abondance"></div>
        <div><label for="m-disc-sel">Discipline</label>
          <select id="m-disc-sel" ${dis}><option value="">Choisir une discipline</option>
            ${DISCIPLINES.map(([n, e]) => `<option value="${esc(n)}" ${n === meta.discipline && !otherDisc ? 'selected' : ''}>${e}  ${esc(n)}</option>`).join('')}
            <option value="__autre" ${otherDisc ? 'selected' : ''}>➕  Autre discipline</option></select>
          ${otherDisc ? `<input id="m-disc" type="text" data-meta="discipline" value="${esc(meta.discipline)}" ${dis} placeholder="Nom de la discipline" style="margin-top:6px" aria-label="Autre discipline">` : ''}</div>
      </div>
      <div class="grid cols-2">
        <div>${field('identite.sdd', 'Situation de départ', { ph: '161. Douleur thoracique', list: 'sdd-list', hint: '(liste nationale ; plusieurs : 161, 162)' })}
          <datalist id="sdd-list">${SDD.map((l, i) => `<option value="${esc(sddLabel(i + 1))}">`).join('')}</datalist></div>
        <div>${field('identite.item', 'Item de connaissance', { ph: '204' })}</div>
      </div>
      ${isPS ? field('identite.age', 'Tranche d\'âge du personnage', { ph: '50 à 65 ans' }) : ''}
      <p class="small muted" style="margin-top:14px">Domaine et type sont fixés par les organisateurs : <strong>${st.domain ? dom(st.domain) : 'non défini'}</strong>, ${esc(TYPES_SHORT[st.type] || '')}.</p>
    </section>

    <section id="sec-vignette" class="panel">${head('vignette', 2, 'Vignette du candidat', 'Affichée sur la porte et posée sur la table. Elle doit se lire en une minute environ. Le candidat y est toujours interne.')}
      <div class="grid cols-2"><div>${field('vignette.role', 'Rôle', { ph: 'Vous êtes interne aux urgences' })}</div>
        <div>${field('vignette.lieu', 'Lieu', { ph: "Service d'accueil des urgences" })}</div></div>
      ${field('vignette.contexte', 'Contexte', { area: true, ph: 'Mme D., 64 ans, consulte pour…' })}
      ${field('vignette.infos', 'Informations utiles', { area: true, rows: 2, hint: 'facultatif', ph: 'Constantes, antécédents' })}
      ${strList('vignette.doit', 'Vous devez :', 'Mener l\'interrogatoire', 'Ajouter une consigne')}
      ${strList('vignette.nedoitpas', 'Vous ne devez pas :', 'Examiner le patient', 'Ajouter une interdiction')}
      ${field('vignette.documents', 'Documents à disposition', { hint: 'facultatif', ph: 'ECG, radiographie de thorax' })}
      <p class="small muted" style="margin-top:14px">La dernière ligne s'ajoute toute seule : <em>${esc(TYPE_LINE[st.type] || '')}</em>.
        <a href="#/apercu/${st.id}/vignette" target="_blank">Voir la vignette imprimée</a></p>
    </section>

    <section id="sec-examinateur" class="panel">${head('examinateur', 3, "Consignes à l'examinateur")}
      ${field('examinateur.scenario', 'Le scénario en deux phrases', { area: true })}
      ${field('examinateur.consignes', 'Consignes', { area: true, ph: "Ce que l'examinateur remet, et à quel moment. Il n'interagit jamais avec le candidat." })}
    </section>

    <section id="sec-script" class="panel">${head('script', 4, st.type === 'PSS' ? 'Script du PSS' : 'Script du PS', isPS ? 'Seulement ce qui est utile au rôle : le PS ne doit rien inventer, ni retenir une information qu\'on lui demande.' : '')}
      ${isPS ? `
      ${field('script.personnage', 'Personnage', { ph: 'Âge, profession, situation familiale, tenue' })}
      ${field('script.installation', 'Installation en début de station', { area: true, rows: 2 })}
      ${field('script.histoire', 'Histoire à raconter', { area: true, rows: 5, ph: 'Motif, symptômes, chronologie' })}
      ${field('script.demarrage', 'Phrase de démarrage', { ph: 'Docteur, je crache du sang depuis ce matin.' })}
      ${strList('script.relances', 'Relances prévues', 'Si le candidat se tait, le PS demande si c\'est grave', 'Ajouter une relance')}
      <label>Réactions aux questions et gestes du candidat</label>
      ${c.script.reactions.map((r, i) => `<div class="item-row"><div class="grid cols-2" style="gap:8px">
        <input type="text" data-path="script.reactions.${i}.q" value="${esc(r.q)}" placeholder="${i === 0 ? 'Si le candidat demande les traitements…' : ''}" ${dis} aria-label="Question">
        <input type="text" data-path="script.reactions.${i}.r" value="${esc(r.r)}" placeholder="${i === 0 ? 'Le PS répond : « du Kardégic »' : ''}" ${dis} aria-label="Réponse"></div>
        ${ro ? '' : `<button type="button" class="small quiet" data-del="script.reactions" data-i="${i}" style="margin-top:6px">Retirer</button>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="small quiet" data-add="script.reactions" data-kind="qr">Ajouter une réaction</button>'}
      ${field('script.attitude', 'Attitude et état d\'esprit', { area: true, rows: 2 })}
      ${strList('script.neutres', 'Réponses neutres aux questions imprévues', 'Je ne sais pas, docteur.', 'Ajouter une réponse')}` : '<p class="muted">Pas de PS ni de PSS dans cette station.</p>'}
    </section>

    <section id="sec-documents" class="panel">${head('documents', 5, 'Documents', 'Imprimés recto et plastifiés. Le lien peut pointer vers le Drive des organisateurs.')}
      ${c.documents.map((d, i) => `<div class="item-row"><div class="grid cols-2" style="gap:8px">
        <input type="text" data-path="documents.${i}.nom" value="${esc(d.nom)}" placeholder="Nom du document" ${dis} aria-label="Nom du document">
        <select data-path="documents.${i}.remis_par" ${dis} aria-label="Remis par">${['Sur la table', "Remis par l'examinateur", 'Remis par le PS ou le PSS'].map((o) =>
          `<option ${o === d.remis_par ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input type="text" data-path="documents.${i}.description" value="${esc(d.description)}" placeholder="Quand et comment il est remis" ${dis} aria-label="Description">
        <input type="text" data-path="documents.${i}.lien" value="${esc(d.lien)}" placeholder="Lien (facultatif)" ${dis} aria-label="Lien"></div>
        <div class="doc-file">${d.file_id ? `${fileThumb(d)}<span class="small muted">${esc(d.file_name || '')}</span>${ro ? '' : `<button type="button" class="small quiet" data-unfile="${i}">Retirer le fichier</button>`}`
          : ro ? '' : `<label class="btn small" style="cursor:pointer">Joindre une image ou un PDF<input type="file" accept="image/*,application/pdf" data-upload="${i}" hidden></label>
            <span class="small muted">Photo d'ECG, radio, compte rendu… Imprimé en grand avec le dossier.</span>`}</div>
        ${ro ? '' : `<button type="button" class="small quiet" data-del="documents" data-i="${i}" style="margin-top:6px">Retirer</button>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="documents" data-kind="doc">Ajouter un document</button>'}
    </section>

    <section id="sec-materiel" class="panel">${head('materiel', 6, 'Matériel', 'La quantité consommée par candidat sert à calculer les commandes de toute la session.')}
      ${c.materiel.liste.length ? `<div class="table-wrap" style="margin:10px 0"><table><thead><tr><th>Article</th><th class="num">Installé</th><th class="num">Par candidat</th><th></th></tr></thead><tbody>
      ${c.materiel.liste.map((m, i) => `<tr><td><input type="text" data-path="materiel.liste.${i}.article" value="${esc(m.article)}" ${dis} aria-label="Article"></td>
        <td><input type="number" min="0" data-num data-path="materiel.liste.${i}.installe" value="${esc(m.installe)}" ${dis} style="width:86px" aria-label="Quantité installée"></td>
        <td><input type="number" min="0" step="0.5" data-num data-path="materiel.liste.${i}.par_candidat" value="${esc(m.par_candidat)}" ${dis} style="width:86px" aria-label="Quantité par candidat"></td>
        <td>${ro ? '' : `<button type="button" class="small quiet" data-del="materiel.liste" data-i="${i}">Retirer</button>`}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${ro ? '' : '<button type="button" class="small" data-add="materiel.liste" data-kind="mat">Ajouter un article</button>'}
      ${field('materiel.disposition', 'Disposition de la salle', { area: true, rows: 2, ph: 'Table face à la porte, PS assis sur le brancard' })}
    </section>

    <section id="sec-grille" class="panel">${head('grille', 7, "Grille d'évaluation")}
      <div class="row between" style="margin-top:18px"><h3 style="margin:0">Aptitudes cliniques et techniques</h3>
        <span class="counter ${aptN >= 10 && aptN <= 15 ? '' : 'off'}">${aptN} sur 10 à 15</span></div>
      <p class="sec-help">Chaque indicateur vaut 1 point : observé ou non, jamais de demi-point. Un indicateur = une action que l'évaluateur voit ou entend. Quand plusieurs réponses sont acceptées, écris le seuil : « cite au moins 2 des 4 signes ».</p>
      ${c.grille.apt.map((it, i) => `<div class="apt-row" style="margin:8px 0">
        <span class="idx">${i + 1}</span>
        <textarea data-path="grille.apt.${i}.label" rows="2" style="min-height:44px" ${dis} aria-label="Indicateur ${i + 1}"
          placeholder="${i === 0 ? 'Recherche des signes de mauvaise tolérance : FC, FR, PA, SpO2 (point si 3 sur 4)' : ''}">${esc(it.label)}</textarea>
        <div class="pts-in small muted" style="line-height:42px;text-align:center" title="Chaque item vaut 1 point : observé ou non">1 pt</div>
        ${ro ? '' : `<div class="tools"><button type="button" data-up="grille.apt" data-i="${i}" aria-label="Monter">↑</button>
          <button type="button" data-down="grille.apt" data-i="${i}" aria-label="Descendre">↓</button>
          <button type="button" data-del="grille.apt" data-i="${i}" aria-label="Retirer">✕</button></div>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="grille.apt" data-kind="apt">Ajouter un indicateur</button>'}

      <div class="row between" style="margin-top:26px"><h3 style="margin:0">Communication et attitudes</h3>
        <span class="counter ${comN >= 2 && comN <= 5 ? '' : 'off'}">${comN} sur 2 à 5</span></div>
      <p class="sec-help">Chaque attendu se note ${COM_LEVELS.map((l) => `${l.l.toLowerCase()} (${String(l.v).replace('.', ',')})`).join(', ')}.</p>
      ${c.grille.com.map((it, i) => `<div class="listed">
        <select data-path="grille.com.${i}.label" ${dis} aria-label="Attendu ${i + 1}"><option value="">Choisir un attendu</option>
          ${[...new Set([...COM_ATTENDUS, it.label].filter(Boolean))].map((a) => `<option ${a === it.label ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        ${ro ? '' : `<button type="button" class="small quiet" data-del="grille.com" data-i="${i}">Retirer</button>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="small" data-add="grille.com" data-kind="com">Ajouter un attendu</button>'}

      <h3 style="margin-top:26px">Performance globale</h3>
      <p class="sec-help">Notée de 0 à 4, elle ne compte pas dans la note. Décris ce qu'on attend à chaque niveau pour cette station : c'est ce qui aligne les évaluateurs.</p>
      ${GLOBAL_LEVELS.map((l, i) => `<label for="g${i}">${i}. ${l}</label><input id="g${i}" type="text" data-path="grille.global.${i}" value="${esc(c.grille.global[i])}" ${dis}>`).join('')}
    </section>

    <section id="sec-pedago" class="panel">${head('pedago', 8, 'Fiche pédagogique', 'Visible par les candidats quand les organisateurs publient les corrections.')}
      ${field('pedago.correction', 'Correction commentée', { area: true, rows: 9, ph: 'Ce qui était attendu, les pièges, les points à retenir' })}
      ${field('pedago.references', 'Références', { area: true, rows: 2, ph: 'Recommandations, référentiel du collège' })}
    </section>`;
  };

  const actionsFor = () => {
    const acts = [];
    const can = (who) => myRoles.includes(who) || myRoles.includes('admin');
    if (st.status === 'redaction' && can('author')) acts.push(['submit', 'Envoyer en relecture', 'primary']);
    if (st.status === 'relecture_pair' && can('peer')) acts.push(['approve', 'Valider ma relecture', 'primary'], ['revise', 'Renvoyer au rédacteur', 'danger']);
    if (st.status === 'relecture_expert' && can('expert')) acts.push(['approve', 'Valider ma relecture', 'primary'], ['revise', 'Renvoyer au rédacteur', 'danger']);
    if (st.status === 'test' && can('author')) acts.push(['approve', 'Le test est concluant', 'primary'], ['revise', 'Revoir la station', 'danger']);
    if (st.status === 'corrections' && can('author')) acts.push(['submit', 'Envoyer en validation finale', 'primary']);
    if (st.status === 'validation' && myRoles.includes('admin')) acts.push(['approve', 'Valider la station', 'primary'], ['revise', 'Renvoyer en corrections', ''], ['refuse', 'Remplacer par une réserve', 'danger']);
    return acts;
  };

  const workflow = () => {
    const acts = actionsFor();
    const errors = checks.filter((x) => x.level === 'error');
    const step = NEXT[st.status];
    const idx = FLOW_ORDER.indexOf(st.status);
    const whoName = { author: st.author_name, peer: st.peer_name, expert: st.expert_name }[step.who];
    return `<div class="panel">
      <div class="steps">${FLOW_SHORT.map((l, k) => `<div class="st ${st.status === 'validee' || k < idx ? 'done' : k === idx ? 'now' : ''}">${l}</div>`).join('')}</div>
      <p style="margin:14px 0 0"><strong>${esc(step.what)}</strong>${whoName ? `, par ${esc(whoName)}` : step.who === 'admin' ? ", par les organisateurs" : ''}.
        <span class="muted small">${st.author_name ? `Rédaction : ${esc(st.author_name)}.` : 'Rédacteur à attribuer.'}
        ${st.peer_name || st.expert_name ? `Relecture : ${esc(st.peer_name || 'pair à attribuer')}, puis ${esc(st.expert_name || 'expert à attribuer')}.` : 'Relecteurs à attribuer.'}</span></p>
      ${acts.length ? `<label for="wf-comment">Commentaire <span class="hint">(obligatoire pour renvoyer)</span></label>
        <textarea id="wf-comment" rows="2" placeholder="Ce qui va, ce qui est à reprendre"></textarea>
        <div class="row" style="margin-top:10px">${acts.map(([a, l, cls]) => `<button class="${cls}" data-act="${a}">${esc(l)}</button>`).join('')}</div>` : ''}
      <details ${errors.length && !ro ? 'open' : ''} style="margin-top:14px"><summary style="cursor:pointer"><strong>Check-list qualité</strong>
        <span class="${errors.length ? 'pill warn' : 'pill ok'}" style="margin-left:6px">${errors.length ? `${errors.length} point(s) bloquant(s)` : 'Rien de bloquant'}</span>
        ${checks.length - errors.length ? `<span class="pill">${checks.length - errors.length} conseil(s)</span>` : ''}</summary>
        ${checks.length ? `<ul class="checks">${checks.map((x) => `<li class="${x.level}"><a href="javascript:void(0)" data-go="sec-${sectionOf(x.msg)}" style="color:inherit">${esc(x.msg)}</a></li>`).join('')}</ul>` : '<p class="small muted">La station est complète.</p>'}
      </details></div>`;
  };

  const history = () => `<section id="sec-echanges" class="panel"><h2 style="margin:0">Échanges</h2>
    <label for="new-comment">Laisser un message à l'équipe de la station</label>
    <textarea id="new-comment" rows="2"></textarea>
    <button class="small" id="send-comment" style="margin-top:8px">Publier le message</button>
    <ul class="timeline">${data.reviews.map((r) => `<li class="${r.action}"><div><span class="who">${esc(r.author_name)}</span>
      <span class="muted">${esc({ comment: 'a écrit', submit: 'a envoyé la station', approve: 'a validé', revise: 'demande des corrections', refuse: 'a remplacé la station', status: 'a changé l\'étape' }[r.action] || r.action)}</span>
      <span class="when">le ${new Date(`${r.created_at}Z`).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      ${r.comment ? `<div style="margin-top:2px">${nl(r.comment)}</div>` : ''}</li>`).join('') || '<li class="muted small">Pas encore d\'échange.</li>'}</ul></section>`;

  const draw = () => {
    const y = window.scrollY;
    const errSections = new Set(checks.filter((x) => x.level === 'error').map((x) => sectionOf(x.msg)));
    app.innerHTML = `
      <a class="back no-print" href="${back}">${rights.isAdmin ? 'Stations de la session' : 'Mes stations'}</a>
      <div class="page-head">${plate(st.slot, 'xl')}
        <div style="flex:1;min-width:240px"><h1>${esc(meta.title || 'Station sans titre')}</h1>
          <div class="tags" style="margin-top:6px">${dom(st.domain)}${meta.discipline ? `<span>${disc(meta.discipline)}</span>` : ''}<span>${esc(TYPES_SHORT[st.type] || '')}</span><span class="faint">${esc(st.exam_name)}</span></div></div>
        <div style="text-align:right"><div class="save-state" id="save-state">${ro ? 'Lecture seule à cette étape' : 'Enregistrement automatique'}</div>
          <div class="row" style="margin-top:8px;justify-content:flex-end">
          <a class="btn small" href="#/apercu/${st.id}/vignette" target="_blank">Vignette</a>
          <a class="btn small" href="#/apercu/${st.id}/grille" target="_blank">Grille papier</a>
          <a class="btn small" href="#/apercu/${st.id}/dossier" target="_blank">Dossier complet</a>
          ${content.documents.some((d) => d.file_id) ? `<a class="btn small" href="#/apercu/${st.id}/documents" target="_blank">Documents</a>` : ''}</div></div></div>
      ${workflow()}
      <div class="editor-layout">
        <nav class="editor-nav" aria-label="Parties de la station">${SECTIONS.map(([k, l], i) =>
          `<a href="javascript:void(0)" data-go="sec-${k}"><b>${i + 1}</b>${l}${errSections.has(k) ? '<span class="warn-dot" title="À compléter"></span>' : ''}</a>`).join('')}
          <a href="javascript:void(0)" data-go="sec-echanges"><b></b>Échanges${data.reviews.filter((r) => r.action === 'comment').length ? ` (${data.reviews.filter((r) => r.action === 'comment').length})` : ''}</a></nav>
        <div id="form">${sections()}${history()}</div>
      </div>`;
    window.scrollTo(0, y);
    bind();
  };

  let timer = null;
  const setState = (t, dirty = false) => { const el = document.getElementById('save-state'); if (el) { el.textContent = t; el.classList.toggle('dirty', dirty); } };
  const save = async () => {
    try {
      const r = await api(`/stations/${st.id}/content`, { method: 'PUT', body: { content, ...meta } });
      checks = r.checks;
      st.title = meta.title;
      setState(`Enregistré à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) { setState('Échec de l\'enregistrement', true); toast(err.message, 'error'); }
  };
  const schedule = () => { setState('Modifications non enregistrées', true); clearTimeout(timer); timer = setTimeout(save, 1200); };
  const flush = async () => { if (timer) { clearTimeout(timer); timer = null; await save(); } };

  const NEW = {
    str: () => '', qr: () => ({ q: '', r: '' }), doc: () => ({ nom: '', remis_par: 'Sur la table', description: '', lien: '' }),
    mat: () => ({ article: '', installe: 1, par_candidat: 0 }), apt: () => ({ id: uid(), label: '', points: 1 }), com: () => ({ id: uid(), label: '' }),
  };

  function bind() {
    const form = app.querySelector('#form');
    app.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', () => document.getElementById(a.dataset.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
    if (!ro) {
      form.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.meta) { meta[t.dataset.meta] = t.value; schedule(); return; }
        if (!t.dataset.path) return;
        set(content, t.dataset.path, t.dataset.num !== undefined ? (t.value === '' ? '' : Number(t.value)) : t.value);
        schedule();
      });
      form.addEventListener('change', (e) => {
        if (e.target.id === 'm-disc-sel') {
          otherDisc = e.target.value === '__autre';
          meta.discipline = otherDisc ? '' : e.target.value;
          schedule(); draw();
          if (otherDisc) app.querySelector('#m-disc')?.focus();
          return;
        }
        if (e.target.tagName === 'SELECT' && e.target.dataset.path?.startsWith('grille.com')) flush().then(draw);
      });
      form.addEventListener('change', async (e) => {
        const inp = e.target.closest('[data-upload]');
        if (!inp || !inp.files[0]) return;
        const i = Number(inp.dataset.upload);
        setState('Envoi du fichier…', true);
        try {
          const f = await uploadStationFile(st.id, inp.files[0]);
          Object.assign(content.documents[i], { file_id: f.id, file_mime: f.mime, file_name: f.name });
          if (!content.documents[i].nom) content.documents[i].nom = f.name.replace(/\.[a-z0-9]+$/i, '');
          await save(); draw();
        } catch (err) { setState('Fichier non envoyé', true); toast(err.message, 'error'); }
      });
      form.addEventListener('click', async (e) => {
        const u = e.target.closest('[data-unfile]');
        if (u) {
          const d = content.documents[Number(u.dataset.unfile)];
          await api(`/files/${d.file_id}`, { method: 'DELETE' }).catch(() => {});
          delete d.file_id; delete d.file_mime; delete d.file_name;
          await save(); draw(); return;
        }
      });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.dataset.unfile !== undefined) return;
        const i = Number(b.dataset.i);
        let focusPath = null;
        if (b.dataset.add) { const arr = get(content, b.dataset.add); arr.push(NEW[b.dataset.kind]()); focusPath = `${b.dataset.add}.${arr.length - 1}`; }
        else if (b.dataset.del) {
          const gone = get(content, b.dataset.del)[i];
          if (b.dataset.del === 'documents' && gone?.file_id) api(`/files/${gone.file_id}`, { method: 'DELETE' }).catch(() => {});
          get(content, b.dataset.del).splice(i, 1);
        }
        else if (b.dataset.up && i > 0) { const a = get(content, b.dataset.up); [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
        else if (b.dataset.down) { const a = get(content, b.dataset.down); if (i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]]; }
        else return;
        schedule(); draw();
        if (focusPath) app.querySelector(`[data-path^="${focusPath}"]`)?.focus();
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

export function vignetteHtml(st, c) {
  const v = c.vignette;
  const list = (a) => a.filter((x) => x?.trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  return `<div class="vignette-nat">
    <p>${esc(v.role)}${v.role && v.lieu ? ', ' : ''}${esc(v.lieu)}</p>
    ${v.contexte ? `<p>${nl(v.contexte)}</p>` : ''}
    ${v.infos ? `<p>${nl(v.infos)}</p>` : ''}
    ${list(v.doit) ? `<p><strong>Vous devez :</strong></p><ul>${list(v.doit)}</ul>` : ''}
    ${list(v.nedoitpas) ? `<p><strong>Vous ne devez pas :</strong></p><ul>${list(v.nedoitpas)}</ul>` : ''}
    ${v.documents ? `<p>Documents à disposition : ${esc(v.documents)}</p>` : ''}
    <p><strong>${esc(TYPE_LINE[st.type] || '')}</strong></p></div>`;
}

export function paperGrid(st, c, header = true) {
  const apt = c.grille.apt.filter((i) => i.label?.trim());
  const com = c.grille.com.filter((i) => i.label?.trim());
  return `${header ? `<div class="print-head"><span>INES · ECOS blancs OMAS Externat, ${esc(st.exam_name || '')}</span><span>Station ${esc(st.slot)}</span></div>
    <h1 style="margin:0 0 6pt">Grille de secours, station ${esc(st.slot)}</h1>
    <p>Numéro du candidat : ______________ &nbsp;&nbsp; Évaluateur : ______________________ &nbsp;&nbsp; <span class="box"></span> Absent</p>` : ''}
    <table class="paper-grid" style="width:100%"><thead><tr><th></th><th>Aptitudes cliniques et techniques</th><th>Pts</th><th>Observé</th><th>Non observé</th></tr></thead><tbody>
    ${apt.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.label)}</td><td>${i.points || 1}</td><td style="text-align:center"><span class="box"></span></td><td style="text-align:center"><span class="box"></span></td></tr>`).join('')}
    </tbody></table>
    <table class="paper-grid" style="width:100%;margin-top:8px"><thead><tr><th>Communication et attitudes</th>${COM_LEVELS.map((l) => `<th>${esc(l.l)} (${String(l.v).replace('.', ',')})</th>`).join('')}</tr></thead><tbody>
    ${com.map((i) => `<tr><td>${esc(i.label)}</td>${COM_LEVELS.map(() => '<td style="text-align:center"><span class="box"></span></td>').join('')}</tr>`).join('')}</tbody></table>
    <table class="paper-grid" style="width:100%;margin-top:8px"><thead><tr><th>Performance globale</th>${GLOBAL_LEVELS.map((l, k) => `<th>${k}. ${esc(l)}</th>`).join('')}</tr></thead>
    <tbody><tr><td></td>${GLOBAL_LEVELS.map(() => '<td style="text-align:center"><span class="box"></span></td>').join('')}</tr>
    <tr><td>Repères</td>${c.grille.global.map((d) => `<td>${esc(d)}</td>`).join('')}</tr></tbody></table>
    <p style="margin-top:10px">Commentaire pour le candidat (une force, un point à travailler) :</p>
    <div style="border-bottom:1px solid #999;height:22px"></div><div style="border-bottom:1px solid #999;height:22px"></div>`;
}

export async function preview(app, id, kind) {
  const data = await api(`/stations/${id}`);
  const st = data.station;
  const c = data.content;
  setTitle(`${kind === 'vignette' ? 'Vignette' : kind === 'grille' ? 'Grille' : 'Dossier'} ${st.slot}`);
  const bar = `<div class="row no-print" style="margin-bottom:8px">${plate(st.slot)}<button class="primary" data-print>Imprimer</button>
    <span class="small muted">${kind === 'vignette' ? 'Format national : A4 paysage, Arial 14, interligne 1,5, texte non justifié. Deux exemplaires : porte et table.' : ''}</span></div>`;
  if (kind === 'vignette') {
    app.innerHTML = `${bar}<div class="sheet landscape">${vignetteHtml(st, c)}</div><div class="sheet landscape">${vignetteHtml(st, c)}</div>`;
    return;
  }
  if (kind === 'grille') {
    app.innerHTML = `${bar}<div class="sheet portrait">${paperGrid(st, c)}</div>`;
    return;
  }
  if (kind === 'documents') {
    const docs = c.documents.filter((d) => d.nom || d.file_id);
    app.innerHTML = `${bar}${docs.length ? docs.map((d) => `<div class="sheet portrait doc-sheet">
      <div class="print-head"><span>Station ${esc(st.slot)}</span><span>${esc(d.remis_par || '')}</span></div>
      <h2>${esc(d.nom || '')}</h2>${d.description ? `<p class="no-print small muted">${esc(d.description)}</p>` : ''}
      ${d.file_id && /^image\//.test(d.file_mime || '') ? `<img src="/api/files/${d.file_id}" alt="${esc(d.nom || '')}">`
        : d.file_id ? `<p class="no-print">${fileThumb(d)} <span class="small muted">Les PDF s'impriment depuis leur propre fenêtre.</span></p>`
        : d.lien ? `<p class="no-print"><a href="${esc(d.lien)}" target="_blank" rel="noopener noreferrer">Ouvrir le lien</a></p>` : '<p class="muted">Pas de fichier joint.</p>'}
    </div>`).join('') : '<p class="panel">Pas de document pour cette station.</p>'}`;
    return;
  }
  if (data.rights.isEval) { app.innerHTML = '<p class="alert error">Le dossier complet est réservé à l\'équipe de rédaction.</p>'; return; }
  const s = c.script;
  const li = (a) => a.filter((x) => x?.trim()).map((x) => `<li>${esc(x)}</li>`).join('');
  app.innerHTML = `${bar}<div class="sheet portrait">
    <div class="print-head"><span>INES · ECOS blancs OMAS Externat, ${esc(st.exam_name)}</span><span>Station ${esc(st.slot)}, ${esc(STATUSES[st.status].toLowerCase())}</span></div>
    <h1>${esc(st.slot)}. ${esc(st.title || '')}</h1>
    <p>${esc(st.domain || '')}, ${esc(TYPES_SHORT[st.type] || '')}${st.discipline ? `, ${esc(st.discipline)}` : ''}.<br>
      Situation de départ : ${esc(c.identite.sdd)}. Item : ${esc(c.identite.item)}.<br>
      Rédaction : ${esc(st.author_name || 'non attribuée')}. Relecture : ${esc(st.peer_name || 'non attribuée')}, ${esc(st.expert_name || 'non attribuée')}.</p>
    <h2>Vignette</h2><div style="border:1px solid #ccc;padding:10px">${vignetteHtml(st, c)}</div>
    <h2>Consignes à l'examinateur</h2><p>${nl(c.examinateur.scenario)}</p><p>${nl(c.examinateur.consignes)}</p>
    ${st.type === 'PS' || st.type === 'PSS' ? `<h2>Script ${st.type}</h2>
      <p><strong>Personnage :</strong> ${esc(s.personnage)} ${c.identite.age ? `(${esc(c.identite.age)})` : ''}</p>
      <p><strong>Installation :</strong> ${nl(s.installation)}</p><p><strong>Histoire :</strong><br>${nl(s.histoire)}</p>
      <p><strong>Phrase de démarrage :</strong> « ${esc(s.demarrage)} »</p>
      ${li(s.relances) ? `<p><strong>Relances :</strong></p><ul>${li(s.relances)}</ul>` : ''}
      ${s.reactions.filter((r) => r.q || r.r).length ? `<table class="paper-grid" style="width:100%"><thead><tr><th>Si le candidat…</th><th>Le PS…</th></tr></thead><tbody>
        ${s.reactions.filter((r) => r.q || r.r).map((r) => `<tr><td>${esc(r.q)}</td><td>${esc(r.r)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p><strong>Attitude :</strong> ${nl(s.attitude)}</p>
      ${li(s.neutres) ? `<p><strong>Réponses neutres :</strong></p><ul>${li(s.neutres)}</ul>` : ''}` : ''}
    ${c.documents.length ? `<h2>Documents</h2><ul>${c.documents.map((d) => `<li><strong>${esc(d.nom)}</strong>, ${esc(d.remis_par.toLowerCase())}${d.description ? ` : ${esc(d.description)}` : ''}${d.lien ? ` (<a href="${esc(d.lien)}">lien</a>)` : ''}${d.file_id ? ` (<a href="#/apercu/${st.id}/documents">fichier joint, voir les documents à imprimer</a>)` : ''}</li>`).join('')}</ul>` : ''}
    ${c.materiel.liste.length ? `<h2>Matériel</h2><table class="paper-grid" style="width:100%"><thead><tr><th>Article</th><th>Installé</th><th>Par candidat</th></tr></thead><tbody>
      ${c.materiel.liste.map((m) => `<tr><td>${esc(m.article)}</td><td>${esc(m.installe)}</td><td>${esc(m.par_candidat)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${c.materiel.disposition ? `<p><strong>Disposition :</strong> ${nl(c.materiel.disposition)}</p>` : ''}
    <h2>Grille</h2>${paperGrid(st, c, false)}
    <h2>Fiche pédagogique</h2><p>${nl(c.pedago.correction)}</p><p><strong>Références :</strong> ${nl(c.pedago.references)}</p>
  </div>`;
}
