// La course des évaluateurs : un cheval par évaluateur, qui avance à chaque grille saisie du jour.
// But : un peu de jeu, et surtout des grilles saisies au fil de l'eau plutôt qu'en fin de journée.
import { esc, plate, longDate } from './ui.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export function raceHtml(R, { me = null, compact = false } = {}) {
  if (!R.day) return '<p class="muted small">La course démarrera avec les premières grilles.</p>';
  const target = Math.max(1, R.target);
  const lanes = R.horses.slice(0, compact ? 12 : 60);
  const leader = R.horses[0];
  const mine = me ? R.horses.findIndex((h) => h.name.toLowerCase() === me.toLowerCase()) : -1;
  const total = R.horses.reduce((a, h) => a + h.n, 0);
  return `<div class="race">
    <div class="race-head"><strong>${esc(longDate(R.day))}</strong>
      <span class="small muted">${R.horses.length} évaluateur${R.horses.length > 1 ? 's' : ''} en piste, ${total} grille${total > 1 ? 's' : ''}, ligne d'arrivée à ${R.target}</span></div>
    ${me ? `<p class="small" style="margin:4px 0 10px">${mine < 0 ? 'Ton cheval partira à ta première grille enregistrée.'
      : mine === 0 ? `Tu mènes la course avec ${R.horses[0].n} grille${R.horses[0].n > 1 ? 's' : ''} !`
        : `Tu es ${mine + 1}<sup>e</sup>, à ${leader.n - R.horses[mine].n} grille${leader.n - R.horses[mine].n > 1 ? 's' : ''} de la tête.`}</p>` : ''}
    <ol class="race-lanes">${lanes.map((h, i) => {
      const pos = Math.min(100, (h.n / target) * 100);
      const done = h.n >= R.target;
      return `<li class="lane ${me && h.name.toLowerCase() === me.toLowerCase() ? 'me' : ''}">
        <span class="lane-who"><span class="lane-rank">${i < 3 && h.n ? MEDALS[i] : i + 1}</span><span class="lane-name">${esc(h.name)}</span>
          <span class="lane-slots">${h.slots.map((s) => plate(s, 'sm')).join('')}</span></span>
        <span class="lane-track"><span class="lane-horse" style="left:calc(${pos}% - ${pos / 100 * 30}px)" aria-hidden="true">${done ? '🏆' : '🏇'}</span><span class="lane-flag" aria-hidden="true">🏁</span></span>
        <span class="lane-n">${h.n}<span class="faint">/${R.target}</span></span></li>`;
    }).join('')}</ol>
    ${R.horses.length > lanes.length ? `<p class="small muted">Et ${R.horses.length - lanes.length} autres.</p>` : ''}
  </div>`;
}
