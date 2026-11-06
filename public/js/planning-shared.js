// Planning des passages : convocations, rotation des candidats dans les salles, horaires.
// Partagé entre le serveur et le navigateur, sans accès au DOM.
//
// Une série = autant de candidats que de stations jouées (10). Chaque candidat a une place (1 à 10).
// Avec deux circuits de même taille (A1 à A5, B1 à B5), les places 1 à 5 commencent par le circuit A,
// les places 6 à 10 par le circuit B ; on change de circuit à la pause. C'est le schéma des plannings OMAS.

export const DEFAULT_SERIES = [
  { start: '08:30', convocation: '08:15' },
  { start: '11:30', convocation: '11:10' },
  { start: '14:30', convocation: '14:15' },
  { start: '17:00', convocation: '16:45' },
];

export function normalizePlanning(p, exam = {}) {
  const out = {
    rotation_minutes: 10, pause_after: 5, pause_minutes: 10, debrief_minutes: 30,
    place: '', instructions: '', rooms: {}, days: [], swaps_open: false, swaps_close_hours: 48,
    // vœux : chaque billet donne droit à un créneau, attribué d'après les vœux de chacun
    wishes_open: false, wishes_until: '', wishes_min: 6, wishes_max_ideal: 3, publish: true,
    ...(p || {}),
  };
  if (!Array.isArray(out.days) || !out.days.length) {
    // par défaut : un jour par date de la session, quatre séries par jour
    const days = [];
    if (exam.starts_on) {
      const d0 = new Date(`${exam.starts_on}T12:00:00Z`);
      const d1 = new Date(`${exam.ends_on || exam.starts_on}T12:00:00Z`);
      for (let d = d0; d <= d1 && days.length < 14; d = new Date(d.getTime() + 864e5)) days.push(d.toISOString().slice(0, 10));
    }
    out.days = days.map((date) => ({ date, series: DEFAULT_SERIES.map((s) => ({ ...s })) }));
  }
  out.days = out.days.filter((d) => d?.date).map((d) => ({
    date: d.date,
    series: (Array.isArray(d.series) && d.series.length ? d.series : DEFAULT_SERIES).map((s) => ({
      start: s.start || '08:30', convocation: s.convocation || shift(s.start || '08:30', -15), closed: !!s.closed, nopause: !!s.nopause,
    })),
  })).sort((a, b) => a.date.localeCompare(b.date));
  for (const k of ['rotation_minutes', 'pause_after', 'pause_minutes', 'debrief_minutes', 'swaps_close_hours', 'wishes_min', 'wishes_max_ideal']) out[k] = Number(out[k]) || 0;
  out.publish = out.publish !== false;
  out.wishes_open = !!out.wishes_open;
  if (!out.rooms || typeof out.rooms !== 'object') out.rooms = {};
  return out;
}

export const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const shift = (hhmm, delta) => toHHMM(toMin(hhmm) + delta);
export const frTime = (hhmm) => (hhmm ? hhmm.replace(/^0(\d)/, '$1').replace(':', ' h ').replace(/ h 00$/, ' h') : '');

// Ordre de passage : à quelle station (index dans `slots`) est la place `seat` au tour `round` (1-indexés)
export function rotationFor(slots) {
  const a = slots.filter((s) => /^A/i.test(s));
  const b = slots.filter((s) => /^B/i.test(s));
  const n = slots.length;
  if (a.length && a.length === b.length && a.length + b.length === n) {
    const h = a.length;
    return {
      seats: n,
      at(seat, round) {
        const firstA = seat <= h;
        const k = firstA ? seat : seat - h;
        const second = round > h;
        const circuit = firstA !== second ? a : b;
        const r = second ? round - h : round;
        return circuit[(k - 1 + r - 1) % h];
      },
    };
  }
  return { seats: n, at: (seat, round) => slots[(seat - 1 + round - 1) % n] };
}

// Horaires d'une série : début de chaque tour, fin, débriefing
export function seriesTimes(planning, ser, nRounds) {
  const t0 = toMin(ser.start);
  const rounds = [];
  const pauseAfter = ser.nopause ? 0 : planning.pause_after;
  for (let r = 1; r <= nRounds; r++) {
    const start = t0 + (r - 1) * planning.rotation_minutes + (pauseAfter && r > pauseAfter ? planning.pause_minutes : 0);
    rounds.push({ round: r, start: toHHMM(start), end: toHHMM(start + planning.rotation_minutes) });
  }
  const end = rounds.length ? rounds[rounds.length - 1].end : ser.start;
  return {
    convocation: ser.convocation, start: ser.start, end, rounds,
    pause: pauseAfter && pauseAfter < nRounds && planning.pause_minutes
      ? { start: rounds[pauseAfter - 1].end, end: rounds[pauseAfter].start } : null,
    debrief: planning.debrief_minutes ? { start: end, end: shift(end, planning.debrief_minutes) } : null,
  };
}

// Parcours d'un candidat : une ligne par tour
export function candidateSchedule(planning, slots, day, series, seat) {
  const d = planning.days.find((x) => x.date === day);
  const ser = d?.series[series - 1];
  if (!ser || !seat) return null;
  const rot = rotationFor(slots);
  const T = seriesTimes(planning, ser, slots.length);
  return { ...T, steps: T.rounds.map((r) => ({ ...r, slot: rot.at(seat, r.round), room: planning.rooms[rot.at(seat, r.round)] || '' })) };
}

// Numéro affiché : J<jour>-S<série>-<place>
export const candidateNumber = (planning, day, series, seat) => {
  const i = planning.days.findIndex((d) => d.date === day);
  return i < 0 || !series || !seat ? null : `J${i + 1}-S${series}-${String(seat).padStart(2, '0')}`;
};

// Date et heure absolues d'une série, à l'heure de Paris (pour le délai des échanges)
export function seriesStartsAt(day, hhmm) {
  const guess = new Date(`${day}T${hhmm || '08:00'}:00Z`);
  let off = 1;
  try {
    const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' })
      .formatToParts(guess).find((x) => x.type === 'timeZoneName')?.value || 'GMT+1';
    off = Number(tz.replace('GMT', '')) || 0;
  } catch { /* fuseau inconnu : heure d'hiver */ }
  return new Date(guess.getTime() - off * 3600e3);
}

// Vœux : 2 = idéal, 1 = possible, 0 = impossible. Sans vœux enregistrés, tout est possible.
export const WISH_LEVELS = [
  { v: 2, l: 'Idéal' }, { v: 1, l: 'Possible' }, { v: 0, l: 'Impossible' },
];
export const seriesKeys = (planning) => planning.days.flatMap((d) => d.series.map((_, i) => `${d.date}|${i + 1}`));

export function checkWishes(planning, wishes) {
  const keys = seriesKeys(planning);
  const w = Object.fromEntries(keys.map((k) => [k, [0, 1, 2].includes(wishes?.[k]) ? wishes[k] : 1]));
  const ideal = keys.filter((k) => w[k] === 2).length;
  const ok = keys.filter((k) => w[k] >= 1).length;
  const errors = [];
  const min = Math.min(planning.wishes_min, keys.length);
  if (ok < min) errors.push(`Laisse au moins ${min} créneaux idéaux ou possibles (tu en as ${ok}).`);
  if (planning.wishes_max_ideal && ideal > planning.wishes_max_ideal) errors.push(`Choisis au plus ${planning.wishes_max_ideal} créneaux idéaux (tu en as ${ideal}).`);
  return { wishes: w, ideal, ok, errors };
}

export const wishesOpen = (planning, now = Date.now()) => planning.wishes_open
  && (!planning.wishes_until || now < new Date(planning.wishes_until).getTime());
