// Fiches procédures dans l'espace membre
import { api, esc, setTitle } from './ui.js';

// Quelle fiche relire après une station : d'après le titre, la situation de départ et la discipline
const KEYS = [
  ['otoscopie', /otoscop|otite|tympan|oreille|otalgie/i],
  ['toucher-rectal', /toucher rectal|prostat|\bTR\b/i],
  ['arret-cardiorespiratoire', /arr[êe]t cardio|\bACR\b|massage cardiaque|\bRCP\b|réanimation cardio|défibrill/i],
  ['palpation-mammaire', /mammaire|\bsein|nodule du sein/i],
  ['injection-intramusculaire', /intramusculaire|injection|\bIM\b|adrénaline|anaphyla|ceftriaxone|purpura|vaccin/i],
  ['suture', /sutur|plaie/i],
  ['gants-steriles', /gants? st[ée]riles?|asepsie|friction|hydroalcoolique/i],
  ['palpation-testiculaire', /testicul|scrot|bourse|varicoc|orchi/i],
];
export function fichesFor(s) {
  const text = `${s.title || ''} ${s.sdd || ''} ${s.discipline || ''}`;
  const out = KEYS.filter(([, re]) => re.test(text)).map(([id]) => id);
  if (s.domain === 'Procédure' && !out.length) out.push('les-reflexes-communs');
  return out;
}

let cache = null;
export async function fichesIndex() { return (cache ||= await api('/fiches')); }

export async function fichesView(app) {
  const F = await fichesIndex();
  setTitle('Fiches procédures');
  app.innerHTML = `<div class="narrow wide">
    <h1>Fiches procédures <span class="faint">ECOS 2026</span></h1>
    <p class="lede">${esc(F.meta.lead)}</p>
    <div class="fiche-grid">${F.fiches.map((f) => `<a class="fiche-card" href="#/fiches/${f.id}"><span class="n">${esc(f.num)}</span>
      <span><strong>${esc(f.title)}</strong><span class="small muted">${esc(f.sub || f.kick)}</span></span></a>`).join('')}</div>
    <div class="alert info" style="margin-top:18px"><strong>À savoir avant de réviser</strong><br>${F.meta.note}</div>
    <p class="small muted">${esc(F.meta.credits)}</p></div>`;
}

export async function ficheView(app, id) {
  const [F, f] = await Promise.all([fichesIndex(), api(`/fiches/${id}`)]);
  setTitle(f.title);
  const name = (x) => F.fiches.find((y) => y.id === x)?.title || '';
  app.innerHTML = `<div class="narrow wide fiche-page">
    <div class="row between no-print"><a class="back" href="#/fiches">Toutes les fiches</a><button class="small" data-print>Imprimer</button></div>
    <div class="fiche-head"><span class="n">${esc(f.num)}</span><div><div class="kick">${esc(f.kick)}</div><h1>${esc(f.title)}</h1></div></div>
    <div class="fiche-body">${f.html}</div>
    <nav class="row between no-print fiche-nav">${f.prev ? `<a href="#/fiches/${f.prev}">← ${esc(name(f.prev))}</a>` : '<span></span>'}${f.next ? `<a href="#/fiches/${f.next}">${esc(name(f.next))} →</a>` : ''}</nav>
    <p class="small muted">${esc(F.meta.credits)}</p></div>`;
  // une image pas encore en ligne : on retire la figure plutôt que d'afficher un cadre vide
  app.querySelectorAll('.fiche-body img').forEach((img) => {
    const drop = () => { const fig = img.closest('figure'); (fig || img).remove(); };
    if (img.complete && !img.naturalWidth) drop(); else img.addEventListener('error', drop);
  });
}
