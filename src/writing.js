// Relances du circuit de rédaction : un e-mail quand une station arrive chez quelqu'un,
// et le lundi un récapitulatif de ce qui attend chacun, avec les échéances fixées par l'équipe.
import { normalizePlanning } from '../public/js/planning-shared.js';
import { STATUSES, STEP_OWNER, DEADLINE_STEPS, ownerId, stepDeadline } from '../public/js/shared.js';
import { layout, sendMails, siteUrl, getSettings, longDate } from './mail.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const redactionLink = (url, code) => `${url}/#/?role=redaction&code=${encodeURIComponent(code)}`;
const WHAT = {
  redaction: 'la rédiger', relecture_pair: 'la relire (relecture par un pair)', relecture_expert: 'la relire (relecture experte)',
  test: 'la faire tester au chronomètre par un externe, avec un PS', corrections: 'intégrer les retours',
};

export const deadlinesOf = (exam) => normalizePlanning(parse(exam.planning, null), exam).writing_deadlines || {};

// Ajoute à chaque ligne de station son échéance d'étape (et retire le planning de la session)
export function withDeadlines(rows, now = Date.now()) {
  return rows.map(({ exam_planning: p, ...s }) => ({ ...s, deadline: stepDeadline(s, parse(p, {})?.writing_deadlines, now) }));
}

// La station vient d'arriver chez quelqu'un : on le prévient (une fois par station et par étape)
export async function notifyStep(env, db, stationId, url) {
  const S = await getSettings(db);
  if (!S.auto_writing) return;
  const st = await db.prepare(`SELECT s.*, e.name AS exam_name, e.planning, e.starts_on, e.ends_on FROM stations s JOIN exams e ON e.id = s.exam_id WHERE s.id = ?`).bind(stationId).first();
  if (!st || !WHAT[st.status]) return;
  const pid = ownerId(st);
  if (!pid) return;
  const p = await db.prepare('SELECT * FROM people WHERE id = ? AND active = 1').bind(pid).first();
  if (!p?.email) return;
  const ref = `${st.id}|${st.status}|${pid}`;
  const sent = await db.prepare("SELECT 1 AS x FROM mail_log WHERE kind = 'redaction' AND ref = ? AND status = 'sent' AND created_at > datetime('now', '-2 days')").bind(ref).first().catch(() => null);
  if (sent) return;
  const dl = stepDeadline(st, deadlinesOf(st));
  const first = p.name.replace(/^(dr|pr)\.?\s+/i, '').split(' ')[0];
  await sendMails(env, db, [{
    kind: 'redaction', exam_id: st.exam_id, ref, to: p.email, name: p.name,
    subject: `${st.slot}${st.title ? ` « ${st.title} »` : ''} : à toi de jouer`,
    html: layout({
      title: `Bonjour ${first}, une station t'attend`,
      intro: `La station <b>${esc(st.slot)}${st.title ? `, ${esc(st.title)}` : ''}</b> des <b>${esc(st.exam_name)}</b> vient d'arriver chez toi : il s'agit de ${WHAT[st.status]}.`,
      rows: [['Étape', esc(STATUSES[st.status])], ...(dl ? [['À rendre avant le', esc(longDate(dl.date))]] : []), ['Ton code', `<span style="letter-spacing:2px">${esc(p.code)}</span>`]],
      button: { url: redactionLink(url, p.code), label: 'Ouvrir la station' },
      after: 'Une question sur la station ? Laisse un commentaire dans l\'éditeur, le rédacteur et les relecteurs le verront.',
    }),
  }]);
}

export function notifyStepLater(c, stationId) {
  const p = (async () => notifyStep(c.env, c.env.DB, stationId, await siteUrl(c.env, c.env.DB, c)))().catch((e) => console.error('relance', e));
  try { c.executionCtx.waitUntil(p); } catch { return p; }
  return null;
}

// Semaine ISO, pour n'envoyer le récapitulatif qu'une fois par semaine
export function isoWeek(now = Date.now()) {
  const d = new Date(new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const w = 1 + Math.round(((d - Date.UTC(y, 0, 4)) / 864e5 - 3 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7)) / 7);
  return `${y}-S${String(w).padStart(2, '0')}`;
}

// Le lundi : à chacun ce qui l'attend (en retard ou à rendre dans les sept jours), et à l'équipe le tableau des retards
export async function weeklyRecap(env, { now = Date.now(), force = false } = {}) {
  const db = env.DB;
  const weekday = new Date(now).toLocaleDateString('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
  if (!force && weekday !== 'Mon') return { skipped: 'pas lundi' };
  const S = await getSettings(db);
  if (!S.auto_writing) return { off: true };
  const week = isoWeek(now);
  const [stations, people, done] = await Promise.all([
    db.prepare(`SELECT s.id, s.slot, s.title, s.status, s.author_id, s.peer_id, s.expert_id, s.updated_at, e.id AS exam_id, e.name AS exam_name, e.planning
      FROM stations s JOIN exams e ON e.id = s.exam_id WHERE e.anonymized_at IS NULL AND s.status IN (${DEADLINE_STEPS.map(() => '?').join(',')})`).bind(...DEADLINE_STEPS).all(),
    db.prepare('SELECT id, name, email, code FROM people WHERE active = 1').all(),
    db.prepare("SELECT ref FROM mail_log WHERE kind = 'relance' AND ref LIKE ? AND status = 'sent'").bind(`%|${week}`).all().catch(() => ({ results: [] })),
  ]);
  const already = new Set(done.results.map((r) => r.ref));
  const rows = stations.results.map((s) => ({ ...s, dl: stepDeadline(s, parse(s.planning, {})?.writing_deadlines, now) }));
  const urgent = (r) => r.dl && (r.dl.late > 0 || r.dl.left <= 7);
  const url = await siteUrl(env, db);
  const msgs = [];
  for (const p of people.results) {
    if (!p.email || already.has(`${p.id}|${week}`)) continue;
    const mine = rows.filter((r) => STEP_OWNER[r.status] !== 'admin' && ownerId(r) === p.id && urgent(r));
    if (!mine.length) continue;
    const late = mine.filter((r) => r.dl.late > 0);
    const first = p.name.replace(/^(dr|pr)\.?\s+/i, '').split(' ')[0];
    msgs.push({
      kind: 'relance', ref: `${p.id}|${week}`, to: p.email, name: p.name,
      subject: late.length ? `${late.length} station${late.length > 1 ? 's' : ''} en retard dans le circuit de rédaction` : 'Tes stations de la semaine',
      html: layout({
        title: `Bonjour ${first}`,
        intro: late.length ? 'Quelques stations attendent ton passage, et certaines ont dépassé leur échéance. Si tu es bloqué ou débordé, réponds à cet e-mail : on réorganise.' : 'Petit point du lundi sur les stations qui arrivent à échéance cette semaine.',
        rows: mine.map((r) => [`${r.slot}${r.title ? `, ${r.title}` : ''}`, `${esc(STATUSES[r.status])} · ${r.dl.late ? `<span style="color:#b03a2e">${r.dl.late} j de retard</span>` : `avant le ${esc(longDate(r.dl.date))}`}`]),
        button: { url: redactionLink(url, p.code), label: 'Voir mes stations' },
      }),
    });
  }
  // l'équipe : à l'adresse de réponse des e-mails, si elle est réglée
  const lateAll = rows.filter((r) => r.dl?.late > 0);
  if (S.reply_to && lateAll.length && !already.has(`equipe|${week}`)) {
    const name = (id) => people.results.find((p) => p.id === id)?.name || 'personne';
    msgs.push({
      kind: 'relance', ref: `equipe|${week}`, to: S.reply_to,
      subject: `Circuit de rédaction : ${lateAll.length} station${lateAll.length > 1 ? 's' : ''} en retard`,
      html: layout({
        title: 'Point du lundi sur la rédaction',
        intro: `${lateAll.length} station${lateAll.length > 1 ? 's ont' : ' a'} dépassé l'échéance de son étape. Les personnes concernées ont reçu leur récapitulatif.`,
        rows: lateAll.sort((a, b) => b.dl.late - a.dl.late).map((r) => [`${r.exam_name}, ${r.slot}`, `${esc(STATUSES[r.status])} · ${esc(STEP_OWNER[r.status] === 'admin' ? 'organisateurs' : name(ownerId(r)))} · ${r.dl.late} j`]),
        button: { url: `${url}/#/admin`, label: 'Ouvrir INES' },
      }),
    });
  }
  return msgs.length ? { ...(await sendMails(env, db, msgs)), week } : { sent: 0, week };
}
