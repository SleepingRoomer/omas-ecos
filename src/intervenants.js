// Intervenants des journées procédure : le lien public remplace le Google Form d'avant.
// Chacun indique ses demi-journées et les gestes qu'il aimerait montrer ; les organisateurs le placent ensuite
// sur un atelier par créneau (onglet Intervenants). L'affectation est gardée dans jp_slots.animators :
// { <code de l'atelier>: "Prénom Nom", _ids: { <code>: id de l'intervenant } }, ce qui garde les impressions telles quelles.
import { layout, sendMails } from './mail.js';

// 5e et 6e années d'internat : docteur junior (DJ1, DJ2). « Autre » est précisé à la main dans le formulaire.
export const INTERVENANT_STATUS = ['1re année d\'internat', '2e année d\'internat', '3e année d\'internat', '4e année d\'internat', 'Docteur junior (DJ1, 5e année)', 'Docteur junior (DJ2, 6e année)', 'Chef'];
const half = (t) => (String(t || '') < '12:00' ? 'matin' : 'après-midi');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });

export function registerIntervenants(app, h) {
  const { need, httpError, all, one, run, parse } = h;
  const ip = (c) => c.req.header('CF-Connecting-IP') || 'local';

  async function context(db, id) {
    const jp = await one(db, 'SELECT * FROM jp_days WHERE id = ?', id);
    if (!jp) throw httpError(404, 'Journée introuvable');
    const [slots, ateliers] = await Promise.all([
      all(db, 'SELECT id, day, start_time, animators FROM jp_slots WHERE jp_id = ? ORDER BY day, start_time', jp.id),
      all(db, "SELECT code, title, position, json_extract(content, '$.emoji') AS emoji FROM jp_ateliers WHERE jp_id = ? AND active = 1 ORDER BY position, code", jp.id),
    ]);
    return { jp, slots: slots.map((s) => ({ id: s.id, day: s.day, start_time: s.start_time, half: half(s.start_time), animators: parse(s.animators, {}) })), ateliers };
  }

  // ---------- public ----------
  app.get('/public/jp/:id/intervenants', async (c) => {
    const { jp, slots, ateliers } = await context(c.env.DB, c.req.param('id'));
    return c.json({ id: jp.id, name: jp.name, open: !!jp.intervenants_open, statuses: INTERVENANT_STATUS,
      slots: slots.map(({ animators, ...s }) => s), ateliers: ateliers.map((a) => ({ code: a.code, title: a.title || '', emoji: a.emoji || '' })) });
  });

  app.post('/public/jp/:id/intervenants', async (c) => {
    const db = c.env.DB;
    const { jp, slots, ateliers } = await context(db, c.req.param('id'));
    if (!jp.intervenants_open) throw httpError(400, 'Les inscriptions des intervenants ne sont pas ouvertes.');
    const recent = await one(db, "SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND role = 'intervenant' AND at > datetime('now', '-1 hour')", ip(c));
    if (recent.n >= 20) throw httpError(429, 'Trop d\'inscriptions depuis cette connexion : réessaie dans une heure.');
    const b = await c.req.json();
    const t = (v, n = 120) => String(v || '').trim().slice(0, n);
    const email = t(b.email, 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    if (!t(b.first_name) || !t(b.last_name)) throw httpError(400, 'Indique ton nom et ton prénom.');
    if (!t(b.specialty)) throw httpError(400, 'Indique ta spécialité.');
    const status = t(b.status, 60);
    if (!status) throw httpError(400, 'Indique où tu en es (année d\'internat, docteur junior, chef ou autre).');
    const okSlots = new Set(slots.map((s) => s.id));
    const chosen = [...new Set((Array.isArray(b.slots) ? b.slots : []).map(Number).filter((x) => okSlots.has(x)))];
    if (!chosen.length) throw httpError(400, 'Coche au moins une demi-journée.');
    const okCodes = new Set([...ateliers.map((a) => a.code), 'any']);
    const gestes = [...new Set((Array.isArray(b.ateliers) ? b.ateliers : []).map(String).filter((x) => okCodes.has(x)))];
    if (!gestes.length) throw httpError(400, 'Coche au moins un geste, ou « Peu importe ».');
    const prev = await one(db, 'SELECT id FROM jp_intervenants WHERE jp_id = ? AND email = ?', jp.id, email).catch(() => null);
    await db.batch([
      db.prepare(`INSERT INTO jp_intervenants (jp_id, email, first_name, last_name, phone, specialty, status, slots, ateliers, note) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(jp_id, email) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, phone = COALESCE(excluded.phone, phone),
        specialty = excluded.specialty, status = excluded.status, slots = excluded.slots, ateliers = excluded.ateliers, note = excluded.note, updated_at = datetime('now')`)
        .bind(jp.id, email, t(b.first_name), t(b.last_name), t(b.phone, 30) || null, t(b.specialty, 80), status, JSON.stringify(chosen), JSON.stringify(gestes), t(b.note, 600) || null),
      db.prepare("INSERT INTO login_failures (ip, role) VALUES (?, 'intervenant')").bind(ip(c)),
    ]);
    // confirmation par e-mail, sans attendre
    const slotLabel = (id) => { const s = slots.find((x) => x.id === id); return `${longDay(s.day)}, ${s.half}`; };
    const atLabel = (code) => (code === 'any' ? 'Peu importe' : ateliers.find((a) => a.code === code)?.title || code);
    const msg = {
      kind: 'intervenant_inscription', ref: `jp${jp.id}`, to: email, name: `${t(b.first_name)} ${t(b.last_name)}`,
      subject: `${prev ? 'Ta réponse est mise à jour' : 'Merci'} : ${jp.name}`,
      html: layout({ title: prev ? 'Ta réponse est mise à jour' : `Merci ${t(b.first_name)} !`,
        intro: `On a bien noté ta proposition d'intervenir aux <b>${esc(jp.name)}</b>. On te recontacte pour te dire sur quel atelier et à quelle heure tu interviens.`,
        rows: [['Demi-journées', chosen.map((x) => esc(slotLabel(x))).join('<br>')], ['Gestes', gestes.map((x) => esc(atLabel(x))).join(', ')]],
        after: 'Pour changer tes disponibilités, il suffit de renvoyer le formulaire avec la même adresse e-mail.' }),
    };
    const send = sendMails(c.env, db, [msg]).catch(() => {});
    try { c.executionCtx.waitUntil(send); } catch { await send; }
    return c.json({ ok: true, updated: !!prev });
  });

  // ---------- organisateurs ----------
  app.get('/jp/:id/intervenants', need('admin'), async (c) => {
    const rows = await all(c.env.DB, 'SELECT * FROM jp_intervenants WHERE jp_id = ? ORDER BY last_name, first_name', c.req.param('id')).catch(() => null);
    if (rows === null) return c.json({ rows: [], missing_migration: true });
    return c.json({ rows: rows.map((r) => ({ ...r, slots: parse(r.slots, []), ateliers: parse(r.ateliers, []) })) });
  });

  app.delete('/intervenants/:id', need('admin'), async (c) => {
    await run(c.env.DB, 'DELETE FROM jp_intervenants WHERE id = ?', c.req.param('id'));
    return c.json({ ok: true });
  });

  // Prévenir chaque intervenant placé : son ou ses ateliers, le jour et l'heure
  app.post('/jp/:id/intervenants/notify', need('admin'), async (c) => {
    const db = c.env.DB;
    const { jp, slots, ateliers } = await context(db, c.req.param('id'));
    const people = await all(db, 'SELECT * FROM jp_intervenants WHERE jp_id = ?', jp.id);
    const msgs = [];
    for (const p of people) {
      const mine = slots.flatMap((s) => Object.entries(s.animators?._ids || {}).filter(([, id]) => Number(id) === p.id).map(([code]) => ({ s, a: ateliers.find((x) => x.code === code) })));
      if (!mine.length) continue;
      msgs.push({ kind: 'intervenant_planning', ref: `jp${jp.id}`, to: p.email, name: `${p.first_name} ${p.last_name}`,
        subject: `Ton atelier aux ${jp.name}`,
        html: layout({ title: `Bonjour ${p.first_name}`, intro: `Merci de venir aux <b>${esc(jp.name)}</b>. Voici où tu interviens :`,
          rows: mine.map(({ s, a }) => [`${longDay(s.day)}, ${s.half}`, `${esc(a?.emoji || '')} ${esc(a?.title || 'Atelier')}<br><span style="font-weight:normal;font-size:13px">début à ${esc(s.start_time.replace(':', ' h '))}</span>`]),
          after: 'Arrive un quart d\'heure avant le début : on te remet la fiche de l\'atelier et le matériel sur place.' }) });
    }
    if (!msgs.length) throw httpError(400, 'Personne n\'est encore placé sur un atelier.');
    const r = await sendMails(c.env, db, msgs);
    return c.json({ ...r, total: msgs.length });
  });
}
