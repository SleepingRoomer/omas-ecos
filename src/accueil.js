// Jour J et places : émargement par QR code, désistements, liste d'attente, matériel des stations
import { normalizePlanning, candidateNumber, seriesTimes, frTime } from '../public/js/planning-shared.js';
import { normalizeContent } from '../public/js/shared.js';

export function registerAccueil(app, h) {
  const { need, httpError, all, one, run, parse, genCode, freshCodes } = h;
  const ip = (c) => c.req.header('CF-Connecting-IP') || 'local';

  async function planningOf(db, examId) {
    const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', examId);
    if (!exam) throw httpError(404, 'Session introuvable');
    return { exam, planning: normalizePlanning(parse(exam.planning, null), exam) };
  }

  // ---------- émargement ----------
  // Chaque candidat a un jeton d'émargement, distinct de son code d'accès : le QR code de sa convocation
  // ouvre une page réservée à l'équipe, qui note sa présence.
  app.get('/me/checkin', need('etudiant'), async (c) => {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT id, checkin, checked_in_at FROM candidates WHERE id = ?', c.get('session').subject_id);
    let token = cand.checkin;
    if (!token) { token = genCode(12); await run(db, 'UPDATE candidates SET checkin = ? WHERE id = ? AND checkin IS NULL', token, cand.id); }
    return c.json({ token, checked_in_at: cand.checked_in_at });
  });

  async function presence(db, cand, present) {
    await run(db, 'UPDATE candidates SET checked_in_at = ? WHERE id = ?', present ? new Date().toISOString() : null, cand.id);
  }

  app.post('/checkin/:token', need('admin'), async (c) => {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT * FROM candidates WHERE checkin = ?', c.req.param('token'));
    if (!cand) throw httpError(404, 'QR code inconnu');
    const { exam, planning } = await planningOf(db, cand.exam_id);
    const already = !!cand.checked_in_at;
    if (!already && cand.status !== 'annule') await presence(db, cand, true);
    const ser = planning.days.find((d) => d.date === cand.day)?.series[cand.series - 1];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
    return c.json({
      exam: { id: exam.id, name: exam.name }, already, at: cand.checked_in_at,
      candidate: { id: cand.id, number: cand.number, first_name: cand.first_name, last_name: cand.last_name, status: cand.status, day: cand.day, series: cand.series },
      convocation: ser ? frTime(ser.convocation) : null, wrong_day: cand.day && cand.day !== today,
    });
  });

  app.post('/candidates/:id/presence', need('admin'), async (c) => {
    const cand = await one(c.env.DB, 'SELECT * FROM candidates WHERE id = ?', c.req.param('id'));
    if (!cand) throw httpError(404, 'Candidat introuvable');
    await presence(c.env.DB, cand, !!(await c.req.json()).present);
    return c.json({ ok: true });
  });

  // ---------- désistement ----------
  app.post('/me/release', need('etudiant'), async (c) => {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', c.get('session').subject_id);
    if (cand.status === 'annule') throw httpError(400, 'Ta place est déjà libérée.');
    const ev = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', cand.id);
    if (ev.n) throw httpError(400, 'Tu as déjà passé des stations.');
    await db.batch([
      db.prepare(`UPDATE candidates SET status = 'annule', seat = NULL, number = NULL, confirmed_at = NULL,
        extra = json_set(COALESCE(extra, '{}'), '$.released_at', ?, '$.released_from', ?) WHERE id = ?`)
        .bind(new Date().toISOString(), cand.day ? `${cand.day}|${cand.series}|${cand.seat}` : null, cand.id),
      db.prepare("UPDATE swaps SET status = 'cancelled' WHERE candidate_id = ? AND status = 'open'").bind(cand.id),
    ]);
    return c.json({ ok: true });
  });

  // ---------- liste d'attente ----------
  app.get('/public/exams/:id', async (c) => {
    const { exam, planning } = await planningOf(c.env.DB, c.req.param('id'));
    return c.json({ id: exam.id, name: exam.name, days: planning.days.map((d) => d.date), waitlist_open: !!planning.waitlist_open });
  });

  app.post('/public/exams/:id/waitlist', async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await planningOf(db, c.req.param('id'));
    if (!planning.waitlist_open) throw httpError(400, 'La liste d\'attente n\'est pas ouverte pour cette session.');
    const recent = await one(db, "SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND role = 'waitlist' AND at > datetime('now', '-1 hour')", ip(c));
    if (recent.n >= 5) throw httpError(429, 'Trop d\'inscriptions depuis cette connexion : réessaie dans une heure.');
    const b = await c.req.json();
    const t = (v, n = 120) => String(v || '').trim().slice(0, n);
    const email = t(b.email, 160).toLowerCase();
    if (!t(b.last_name) || !t(b.first_name)) throw httpError(400, 'Indique ton nom et ton prénom.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    const dup = await one(db, "SELECT id FROM waitlist WHERE exam_id = ? AND email = ? AND status IN ('waiting', 'offered')", exam.id, email);
    if (dup) throw httpError(400, 'Tu es déjà sur la liste d\'attente de cette session.');
    await db.batch([
      db.prepare('INSERT INTO waitlist (exam_id, last_name, first_name, email, phone, faculty, year, tarif, note) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(exam.id, t(b.last_name), t(b.first_name), email, t(b.phone, 30) || null, t(b.faculty) || null, t(b.year, 30) || null, t(b.tarif, 60) || null, t(b.note, 300) || null),
      db.prepare("INSERT INTO login_failures (ip, role) VALUES (?, 'waitlist')").bind(ip(c)),
    ]);
    const pos = await one(db, "SELECT COUNT(*) AS n FROM waitlist WHERE exam_id = ? AND status = 'waiting'", exam.id);
    return c.json({ ok: true, position: pos.n });
  });

  app.get('/exams/:id/waitlist', need('admin'), async (c) => c.json(await all(c.env.DB, `SELECT w.*, c.code, c.number, c.confirmed_at, c.status AS cand_status
    FROM waitlist w LEFT JOIN candidates c ON c.id = w.candidate_id WHERE w.exam_id = ? ORDER BY w.id`, c.req.param('id'))));

  app.delete('/waitlist/:id', need('admin'), async (c) => {
    await run(c.env.DB, "UPDATE waitlist SET status = 'removed', updated_at = datetime('now') WHERE id = ?", c.req.param('id'));
    return c.json({ ok: true });
  });

  // Proposer une place libre : la personne devient candidate, avec son code, sur la place choisie
  app.post('/waitlist/:id/offer', need('admin'), async (c) => {
    const db = c.env.DB;
    const w = await one(db, 'SELECT * FROM waitlist WHERE id = ?', c.req.param('id'));
    if (!w || w.status !== 'waiting') throw httpError(400, 'Cette personne n\'attend plus de place.');
    const { planning } = await planningOf(db, w.exam_id);
    const { day, series, seat } = await c.req.json();
    const taken = await one(db, "SELECT id FROM candidates WHERE exam_id = ? AND day = ? AND series = ? AND seat = ? AND status != 'annule'", w.exam_id, day, series, seat);
    if (taken) throw httpError(409, 'Cette place vient d\'être prise.');
    const [code] = await freshCodes(db, 1);
    const extra = JSON.stringify({ from_waitlist: true, tarif: w.tarif || undefined });
    const r = await run(db, `INSERT INTO candidates (exam_id, last_name, first_name, email, phone, faculty, year, day, series, seat, number, status, code, extra)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'inscrit',?,?)`, w.exam_id, w.last_name, w.first_name, w.email, w.phone, w.faculty, w.year,
    day, Number(series), Number(seat), candidateNumber(planning, day, Number(series), Number(seat)), code, extra);
    await run(db, "UPDATE waitlist SET status = 'offered', candidate_id = ?, updated_at = datetime('now') WHERE id = ?", r.meta.last_row_id, w.id);
    h.notifier?.(c).waitlist(r.meta.last_row_id);
    return c.json({ ok: true, candidate_id: r.meta.last_row_id, code });
  });

  // ---------- matériel ----------
  app.get('/exams/:id/materiel', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await planningOf(db, c.req.param('id'));
    const [stations, counts] = await Promise.all([
      all(db, 'SELECT id, slot, title, type, content FROM stations WHERE exam_id = ? AND played = 1 ORDER BY slot', exam.id),
      all(db, "SELECT day, COUNT(*) AS n FROM candidates WHERE exam_id = ? AND status != 'annule' GROUP BY day", exam.id),
    ]);
    return c.json({
      days: planning.days.map((d) => d.date), checks: planning.materiel_check || {},
      perDay: Object.fromEntries(counts.map((r) => [r.day || '', r.n])),
      stations: stations.map((s) => {
        const ct = normalizeContent(parse(s.content, {}));
        return { id: s.id, slot: s.slot, title: s.title, type: s.type, liste: ct.materiel.liste.filter((m) => String(m.article || '').trim()), disposition: ct.materiel.disposition };
      }),
    });
  });

  app.put('/exams/:id/materiel-check', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning } = await planningOf(db, c.req.param('id'));
    const { key, done } = await c.req.json();
    const checks = { ...(planning.materiel_check || {}) };
    if (done) checks[String(key).slice(0, 200)] = true; else delete checks[String(key).slice(0, 200)];
    await run(db, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify({ ...planning, materiel_check: checks }), exam.id);
    return c.json({ ok: true });
  });
}
