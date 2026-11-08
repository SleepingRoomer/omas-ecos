// Liste d'attente qui avance seule.
// Une place se libère (désistement, annulation par l'équipe, offre expirée) : elle est proposée au premier de la liste,
// avec un délai pour confirmer. Sans confirmation à temps, la tâche horaire annule l'offre et passe au suivant.
// Le délai est gardé dans candidates.extra (offer_expires_at) : aucune migration.
import { normalizePlanning, freeSeats, offerDeadline, candidateNumber } from '../public/js/planning-shared.js';
import { layout, sendMails, longDate, siteUrl, getSettings } from './mail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const when = (d) => new Date(d).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const studentLink = (url, code) => `${url}/#/?role=etudiant&code=${encodeURIComponent(code)}`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(len = 8) { const b = new Uint8Array(len); crypto.getRandomValues(b); return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join(''); }
async function freshCodes(db, n) {
  const base = `SELECT code AS c FROM candidates UNION ALL SELECT code FROM jp_participants
    UNION ALL SELECT code FROM people UNION ALL SELECT eval_code FROM stations`;
  const rows = (await db.prepare(`${base} UNION ALL SELECT code FROM volunteer_signups`).all().catch(() => db.prepare(base).all())).results;
  const taken = new Set(rows.map((r) => r.c));
  const out = [];
  while (out.length < n) { const c = genCode(); if (!taken.has(c)) { taken.add(c); out.push(c); } }
  return out;
}

export function offerMail(url, exam, planning, cand, deadline) {
  const ser = planning.days.find((d) => d.date === cand.day)?.series[(cand.series || 1) - 1];
  return {
    kind: 'attente', exam_id: exam.id, ref: String(cand.id), to: cand.email, name: `${cand.first_name} ${cand.last_name}`,
    subject: `Une place s'est libérée pour toi aux ${exam.name}`,
    html: layout({
      title: `Bonne nouvelle, ${cand.first_name} !`,
      intro: `Une place s'est libérée et elle est pour toi. ${deadline ? `<b>Confirme ta venue avant le ${esc(when(deadline))}</b> depuis ton espace : sans réponse, elle passe automatiquement à la personne suivante.` : 'Confirme ta venue depuis ton espace.'}`,
      rows: [['Date', esc(longDate(cand.day))], ['Convocation', esc(ser?.convocation || '')], ...(planning.place ? [['Lieu', esc(planning.place)]] : []),
        ...(cand.number ? [['Ton numéro', esc(cand.number)]] : []), ['Ton code d\'accès', `<span style="letter-spacing:2px">${esc(cand.code)}</span>`]],
      button: { url: studentLink(url, cand.code), label: 'Confirmer ma venue' },
      after: 'Tu ne peux finalement pas venir ? Libère la place depuis ton espace : elle part tout de suite à la personne suivante.',
    }),
  };
}

function expiredMail(exam, cand) {
  return {
    kind: 'attente_expiree', exam_id: exam.id, ref: String(cand.id), to: cand.email, name: `${cand.first_name} ${cand.last_name}`,
    subject: `La place proposée aux ${exam.name} est passée à la personne suivante`,
    html: layout({
      title: `Dommage, ${cand.first_name}`,
      intro: 'Tu n\'as pas confirmé ta venue dans le délai : la place a été proposée à la personne suivante de la liste d\'attente. Si c\'est une erreur, réponds à cet e-mail, on regarde ce qu\'on peut faire.',
    }),
  };
}

// Propose les places libres de la session aux premiers de la liste. Renvoie le nombre d'offres faites.
// Limité à `max` offres par appel pour rester sous les limites de D1 et des appels sortants.
export async function autoOffer(env, examId, { max = 10, url = null, now = Date.now() } = {}) {
  const db = env.DB;
  const exam = await db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id AND s.played = 1) AS n_played FROM exams e WHERE e.id = ?`).bind(examId).first();
  if (!exam || exam.anonymized_at) return { offered: 0 };
  const planning = normalizePlanning(parse(exam.planning, null), exam);
  if (planning.waitlist_auto === false) return { offered: 0, off: true };
  const [cands, waiting] = await Promise.all([
    db.prepare("SELECT day, series, seat FROM candidates WHERE exam_id = ? AND status != 'annule' AND seat IS NOT NULL").bind(exam.id).all(),
    db.prepare("SELECT * FROM waitlist WHERE exam_id = ? AND status = 'waiting' ORDER BY id LIMIT ?").bind(exam.id, max).all(),
  ]);
  if (!waiting.results.length) return { offered: 0 };
  const taken = new Set(cands.results.map((r) => `${r.day}|${r.series}|${r.seat}`));
  const seats = freeSeats(planning, exam.n_played || 10, taken, now);
  const pairs = waiting.results.slice(0, Math.min(max, seats.length)).map((w, i) => ({ w, seat: seats[i] }));
  if (!pairs.length) return { offered: 0 };
  const codes = await freshCodes(db, pairs.length);
  const rows = pairs.map(({ w, seat }, i) => ({
    w, seat, code: codes[i], number: candidateNumber(planning, seat.day, seat.series, seat.seat),
    extra: JSON.stringify({ from_waitlist: true, waitlist_id: w.id, tarif: w.tarif || undefined, offer_expires_at: seat.deadline.toISOString(), offered_at: new Date(now).toISOString() }),
  }));
  await db.batch(rows.map((r) => db.prepare(`INSERT INTO candidates (exam_id, last_name, first_name, email, phone, faculty, year, day, series, seat, number, status, code, extra)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'inscrit',?,?)`).bind(exam.id, r.w.last_name, r.w.first_name, r.w.email, r.w.phone, r.w.faculty, r.w.year,
    r.seat.day, r.seat.series, r.seat.seat, r.number, r.code, r.extra)));
  const ids = (await db.prepare(`SELECT id, code FROM candidates WHERE exam_id = ? AND code IN (${rows.map(() => '?').join(',')})`).bind(exam.id, ...rows.map((r) => r.code)).all()).results;
  const idOf = Object.fromEntries(ids.map((x) => [x.code, x.id]));
  await db.batch(rows.map((r) => db.prepare("UPDATE waitlist SET status = 'offered', candidate_id = ?, updated_at = datetime('now') WHERE id = ?").bind(idOf[r.code], r.w.id)));
  const S = await getSettings(db);
  if (S.auto_waitlist) {
    const site = url || await siteUrl(env, db);
    await sendMails(env, db, rows.map((r) => offerMail(site, exam, planning,
      { id: idOf[r.code], email: r.w.email, first_name: r.w.first_name, last_name: r.w.last_name, day: r.seat.day, series: r.seat.series, number: r.number, code: r.code }, r.seat.deadline)));
  }
  return { offered: rows.length };
}

// Offres arrivées à échéance sans confirmation : la place est libérée et repart au suivant
export async function expireOffers(env, { now = Date.now(), max = 15 } = {}) {
  const db = env.DB;
  const iso = new Date(now).toISOString();
  const rows = (await db.prepare(`SELECT c.*, e.name AS exam_name FROM candidates c JOIN exams e ON e.id = c.exam_id
    WHERE c.status != 'annule' AND c.confirmed_at IS NULL AND e.anonymized_at IS NULL
    AND json_extract(c.extra, '$.offer_expires_at') IS NOT NULL AND json_extract(c.extra, '$.offer_expires_at') < ?
    AND NOT EXISTS (SELECT 1 FROM evaluations v WHERE v.candidate_id = c.id) LIMIT ?`).bind(iso, max).all().catch(() => ({ results: [] }))).results;
  if (!rows.length) return { expired: 0, offered: 0 };
  await db.batch(rows.flatMap((c) => [
    db.prepare(`UPDATE candidates SET status = 'annule', seat = NULL, number = NULL,
      extra = json_set(COALESCE(extra, '{}'), '$.expired_at', ?, '$.released_from', ?) WHERE id = ?`).bind(iso, `${c.day}|${c.series}|${c.seat}`, c.id),
    db.prepare("UPDATE waitlist SET status = 'expired', updated_at = datetime('now') WHERE candidate_id = ?").bind(c.id),
    db.prepare("DELETE FROM auth_sessions WHERE kind = 'etudiant' AND subject_id = ?").bind(c.id),
  ]));
  const S = await getSettings(db);
  if (S.auto_waitlist) await sendMails(env, db, rows.map((c) => expiredMail({ id: c.exam_id, name: c.exam_name }, c)));
  let offered = 0;
  for (const examId of [...new Set(rows.map((c) => c.exam_id))].slice(0, 3)) offered += (await autoOffer(env, examId, { now, max: 8 })).offered;
  return { expired: rows.length, offered };
}

// Après un désistement ou une annulation, sans faire attendre la personne
export function offerLater(c, examId) {
  const p = autoOffer(c.env, examId, { url: new URL(c.req.url).origin }).catch((e) => console.error('liste d\'attente', e));
  try { c.executionCtx.waitUntil(p); } catch { return p; }
  return null;
}

// Délai d'une offre faite à la main par l'équipe (même règle que l'automatique)
export const manualDeadline = (planning, day, series) => offerDeadline(planning, day, series);
