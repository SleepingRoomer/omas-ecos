// Planning des passages, convocations et échanges de créneaux entre étudiants
import {
  normalizePlanning, candidateSchedule, candidateNumber, seriesStartsAt, rotationFor, DEFAULT_SERIES,
} from '../public/js/planning-shared.js';

const placeKey = (day, series) => `${day}|${series}`;

export function registerPlanning(app, h) {
  const { need, httpError, all, one, run, parse, batch, genCode } = h;

  async function load(db, examId) {
    const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', examId);
    if (!exam) throw httpError(404, 'Session introuvable');
    const planning = normalizePlanning(parse(exam.planning, null), exam);
    const slots = (await all(db, 'SELECT slot FROM stations WHERE exam_id = ? AND played = 1 ORDER BY slot', examId)).map((s) => s.slot);
    return { exam, planning, slots };
  }

  // ---------- équipe ----------

  app.get('/exams/:id/planning', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning, slots } = await load(db, c.req.param('id'));
    const [candidates, swaps, titles] = await Promise.all([
      all(db, `SELECT c.id, c.number, c.last_name, c.first_name, c.email, c.phone, c.day, c.series, c.seat, c.status, c.confirmed_at, c.slot_label,
        (SELECT COUNT(*) FROM evaluations v WHERE v.candidate_id = c.id) AS n_evaluations
        FROM candidates c WHERE c.exam_id = ? ORDER BY c.last_name, c.first_name`, exam.id),
      all(db, `SELECT s.id, s.status, s.from_place, s.to_place, s.created_at, s.done_at, s.wanted,
        a.first_name || ' ' || a.last_name AS who, b.first_name || ' ' || b.last_name AS partner
        FROM swaps s JOIN candidates a ON a.id = s.candidate_id LEFT JOIN candidates b ON b.id = s.partner_id
        WHERE s.exam_id = ? ORDER BY s.id DESC LIMIT 200`, exam.id),
      all(db, 'SELECT slot, title, domain FROM stations WHERE exam_id = ? AND played = 1', exam.id),
    ]);
    return c.json({ exam: { id: exam.id, name: exam.name, starts_on: exam.starts_on, ends_on: exam.ends_on }, planning, slots, stations: titles, candidates, swaps });
  });

  app.put('/exams/:id/planning', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, slots } = await load(db, c.req.param('id'));
    const planning = normalizePlanning((await c.req.json()).planning, exam);
    await run(db, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify(planning), exam.id);
    await refreshNumbers(db, exam.id, planning, slots.length);
    return c.json({ ok: true, planning });
  });

  // Recalcule les numéros (le rang d'un jour peut changer quand on ajoute ou retire un jour)
  async function refreshNumbers(db, examId, planning) {
    const rows = await all(db, "SELECT id, day, series, seat, number FROM candidates WHERE exam_id = ?", examId);
    const stmts = [];
    for (const r of rows) {
      const n = candidateNumber(planning, r.day, r.series, r.seat);
      if (n !== r.number) stmts.push(db.prepare('UPDATE candidates SET number = ? WHERE id = ?').bind(n, r.id));
    }
    await batch(db, stmts);
  }

  // Place les candidats : chacun garde sa place si elle est libre, les autres sont rangés par ordre alphabétique
  app.post('/exams/:id/candidates/renumber', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning, slots } = await load(db, c.req.param('id'));
    const cap = slots.length || 10;
    const rows = await all(db, `SELECT id, day, series, seat, last_name, first_name, status FROM candidates WHERE exam_id = ?
      ORDER BY last_name, first_name`, exam.id);
    // un jour de passage absent du planning y est ajouté
    let changed = false;
    for (const d of new Set(rows.filter((r) => r.day).map((r) => r.day))) {
      if (!planning.days.some((x) => x.date === d)) { planning.days.push({ date: d, series: DEFAULT_SERIES.map((s) => ({ ...s })) }); changed = true; }
    }
    if (changed) {
      planning.days.sort((a, b) => a.date.localeCompare(b.date));
      await run(db, 'UPDATE exams SET planning = ? WHERE id = ?', JSON.stringify(planning), exam.id);
    }
    const groups = new Map();
    for (const r of rows) {
      if (r.status === 'annule' || !r.day || !r.series) { r.seat = null; continue; }
      const k = placeKey(r.day, r.series);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    let overflow = 0;
    for (const list of groups.values()) {
      const used = new Set();
      for (const r of list) {
        if (r.seat >= 1 && r.seat <= cap && !used.has(r.seat)) used.add(r.seat); else r.seat = null;
      }
      for (const r of list.filter((x) => !x.seat)) {
        let s = 1; while (used.has(s)) s++;
        if (s > cap) { overflow++; continue; }
        r.seat = s; used.add(s);
      }
    }
    await batch(db, rows.map((r) => db.prepare('UPDATE candidates SET seat = ?, number = ? WHERE id = ?')
      .bind(r.seat || null, candidateNumber(planning, r.day, r.series, r.seat), r.id)));
    return c.json({ numbered: rows.filter((r) => r.seat).length, overflow });
  });

  // Déplacements faits par l'équipe : une liste de { id, day, series, seat } appliquée d'un coup
  app.post('/exams/:id/seats', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning, slots } = await load(db, c.req.param('id'));
    const { moves = [] } = await c.req.json();
    const rows = await all(db, "SELECT id, day, series, seat FROM candidates WHERE exam_id = ? AND status != 'annule'", exam.id);
    const byId = new Map(rows.map((r) => [r.id, { ...r }]));
    for (const m of moves) {
      const r = byId.get(Number(m.id));
      if (!r) throw httpError(404, 'Candidat introuvable');
      Object.assign(r, { day: m.day || null, series: m.series ? Number(m.series) : null, seat: m.seat ? Number(m.seat) : null });
      if (r.seat && (r.seat < 1 || r.seat > slots.length)) throw httpError(400, 'Place inexistante');
    }
    const seen = new Set();
    for (const r of byId.values()) {
      if (!r.day || !r.series || !r.seat) continue;
      const k = `${r.day}|${r.series}|${r.seat}`;
      if (seen.has(k)) throw httpError(409, 'Deux candidats sur la même place : déplace-les en même temps pour les échanger.');
      seen.add(k);
    }
    await batch(db, moves.map((m) => {
      const r = byId.get(Number(m.id));
      return db.prepare('UPDATE candidates SET day = ?, series = ?, seat = ?, number = ?, confirmed_at = NULL WHERE id = ?')
        .bind(r.day, r.series, r.seat, candidateNumber(planning, r.day, r.series, r.seat), r.id);
    }));
    return c.json({ ok: true });
  });

  // ---------- étudiant ----------

  async function me(c) {
    const db = c.env.DB;
    const cand = await one(db, 'SELECT * FROM candidates WHERE id = ?', c.get('session').subject_id);
    if (!cand) throw httpError(404, 'Inscription introuvable');
    return { db, cand, ...(await load(db, cand.exam_id)) };
  }

  // Les échanges sont possibles si l'équipe les a ouverts, jusqu'à N heures avant la première des deux séries
  function swapWindow(planning, cand, other) {
    if (!planning.swaps_open) return { ok: false, why: 'Les échanges ne sont pas ouverts.' };
    const firstOf = (x) => {
      const d = planning.days.find((y) => y.date === x.day);
      const s = d?.series[x.series - 1];
      return s ? seriesStartsAt(x.day, s.convocation || s.start) : null;
    };
    const times = [firstOf(cand), other && firstOf(other)].filter(Boolean);
    if (!times.length) return { ok: false, why: 'Créneau inconnu.' };
    const limit = new Date(Math.min(...times.map((t) => t.getTime())) - planning.swaps_close_hours * 3600e3);
    return Date.now() < limit.getTime() ? { ok: true, until: limit.toISOString() } : { ok: false, why: 'Le délai pour échanger est passé.', until: limit.toISOString() };
  }

  const describe = (planning, day, series) => {
    const d = planning.days.find((x) => x.date === day);
    const s = d?.series[series - 1];
    return { key: placeKey(day, series), date: day, series, convocation: s?.convocation || null, start: s?.start || null };
  };

  app.get('/me/convocation', need('etudiant'), async (c) => {
    const { db, cand, exam, planning, slots } = await me(c);
    const placed = !!(cand.day && cand.series && cand.seat);
    const schedule = placed ? candidateSchedule(planning, slots, cand.day, cand.series, cand.seat) : null;
    const [mine, offers, counts, history, evals] = await Promise.all([
      one(db, "SELECT code, wanted, created_at FROM swaps WHERE candidate_id = ? AND status = 'open'", cand.id),
      placed ? all(db, `SELECT s.code, s.wanted, c.day, c.series FROM swaps s JOIN candidates c ON c.id = s.candidate_id
        WHERE s.exam_id = ? AND s.status = 'open' AND s.candidate_id != ? AND c.status != 'annule'`, exam.id, cand.id) : [],
      all(db, "SELECT day, series, COUNT(*) AS n FROM candidates WHERE exam_id = ? AND status != 'annule' AND day IS NOT NULL GROUP BY day, series", exam.id),
      all(db, "SELECT from_place, to_place, done_at FROM swaps WHERE status = 'done' AND (candidate_id = ? OR partner_id = ?) ORDER BY id DESC", cand.id, cand.id),
      one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', cand.id),
    ]);
    const myKey = placed ? placeKey(cand.day, cand.series) : null;
    const win = placed ? swapWindow(planning, cand) : { ok: false, why: 'Tu n\'as pas encore de créneau.' };
    if (evals.n) Object.assign(win, { ok: false, why: 'Tu as déjà passé tes stations.' });
    const fill = Object.fromEntries(counts.map((r) => [placeKey(r.day, r.series), r.n]));
    return c.json({
      exam: { name: exam.name },
      candidate: { first_name: cand.first_name, last_name: cand.last_name, number: cand.number, status: cand.status },
      place: planning.place, instructions: planning.instructions, rotation_minutes: planning.rotation_minutes,
      placed, day: cand.day, series: cand.series, seat: cand.seat, schedule,
      confirmed_at: cand.confirmed_at,
      swaps: {
        enabled: !!planning.swaps_open, open: win.ok, why: win.ok ? null : win.why, until: win.until || null,
        close_hours: planning.swaps_close_hours,
        mine: mine ? { code: mine.code, wanted: parse(mine.wanted, []), created_at: mine.created_at } : null,
        options: planning.days.flatMap((d) => d.series.map((s, i) => ({ ...describe(planning, d.date, i + 1), filled: fill[placeKey(d.date, i + 1)] || 0, closed: s.closed })))
          .filter((o) => o.key !== myKey && !o.closed),
        offers: offers.filter((o) => parse(o.wanted, []).includes(myKey) && placeKey(o.day, o.series) !== myKey)
          .map((o) => ({ code: o.code, ...describe(planning, o.day, o.series) })),
        history: history.map((x) => ({ from: x.from_place, to: x.to_place, done_at: x.done_at })),
      },
    });
  });

  app.post('/me/confirm', need('etudiant'), async (c) => {
    const { db, cand } = await me(c);
    const { present } = await c.req.json();
    await run(db, 'UPDATE candidates SET confirmed_at = ? WHERE id = ?', present ? new Date().toISOString() : null, cand.id);
    return c.json({ ok: true });
  });

  app.post('/me/swaps', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    if (!cand.seat) throw httpError(400, 'Tu n\'as pas encore de créneau.');
    const win = swapWindow(planning, cand);
    if (!win.ok) throw httpError(400, win.why);
    const valid = new Set(planning.days.flatMap((d) => d.series.map((_, i) => placeKey(d.date, i + 1))));
    const wanted = [...new Set(((await c.req.json()).wanted || []).filter((k) => valid.has(k) && k !== placeKey(cand.day, cand.series)))];
    let code;
    for (let i = 0; i < 10; i++) { code = genCode(6); if (!await one(db, 'SELECT 1 FROM swaps WHERE code = ?', code)) break; }
    await db.batch([
      db.prepare("UPDATE swaps SET status = 'cancelled' WHERE candidate_id = ? AND status = 'open'").bind(cand.id),
      db.prepare('INSERT INTO swaps (exam_id, candidate_id, wanted, code) VALUES (?,?,?,?)').bind(cand.exam_id, cand.id, JSON.stringify(wanted), code),
    ]);
    return c.json({ code, wanted });
  });

  app.delete('/me/swaps', need('etudiant'), async (c) => {
    const { db, cand } = await me(c);
    await run(db, "UPDATE swaps SET status = 'cancelled' WHERE candidate_id = ? AND status = 'open'", cand.id);
    return c.json({ ok: true });
  });

  async function findOffer(db, cand, code) {
    const offer = await one(db, `SELECT s.*, c.day, c.series, c.seat, c.status AS c_status, c.slot_label FROM swaps s
      JOIN candidates c ON c.id = s.candidate_id WHERE s.code = ? AND s.exam_id = ?`, String(code || '').toUpperCase().trim(), cand.exam_id);
    if (!offer || offer.status !== 'open' || offer.c_status === 'annule') throw httpError(404, 'Cette proposition n\'existe pas ou n\'est plus valable.');
    if (offer.candidate_id === cand.id) throw httpError(400, 'C\'est ta propre proposition.');
    return offer;
  }

  app.get('/me/swaps/:code', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const offer = await findOffer(db, cand, c.req.param('code'));
    return c.json(describe(planning, offer.day, offer.series));
  });

  app.post('/me/swaps/accept', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const offer = await findOffer(db, cand, (await c.req.json()).code);
    if (!cand.seat || !offer.seat) throw httpError(400, 'Créneau manquant.');
    if (cand.status === 'annule') throw httpError(400, 'Inscription annulée.');
    if (offer.day === cand.day && offer.series === cand.series) throw httpError(400, 'Vous êtes déjà dans la même série.');
    const wanted = parse(offer.wanted, []);
    if (wanted.length && !wanted.includes(placeKey(cand.day, cand.series))) throw httpError(400, 'Ton créneau ne fait pas partie de ceux recherchés.');
    const win = swapWindow(planning, cand, offer);
    if (!win.ok) throw httpError(400, win.why);
    const ev = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id IN (?, ?)', cand.id, offer.candidate_id);
    if (ev.n) throw httpError(400, 'L\'un de vous a déjà passé ses stations.');
    const label = (x) => `${x.day}|${x.series}|${x.seat}`;
    const set = (id, x) => db.prepare('UPDATE candidates SET day = ?, series = ?, seat = ?, number = ?, slot_label = ?, confirmed_at = NULL WHERE id = ?')
      .bind(x.day, x.series, x.seat, candidateNumber(planning, x.day, x.series, x.seat), x.slot_label, id);
    await db.batch([
      set(cand.id, offer),
      set(offer.candidate_id, cand),
      db.prepare("UPDATE swaps SET status = 'done', partner_id = ?, from_place = ?, to_place = ?, done_at = datetime('now') WHERE id = ?")
        .bind(cand.id, label(offer), label(cand), offer.id),
      db.prepare("UPDATE swaps SET status = 'cancelled' WHERE status = 'open' AND candidate_id IN (?, ?)").bind(cand.id, offer.candidate_id),
    ]);
    return c.json({ ok: true, now: describe(planning, offer.day, offer.series) });
  });

  // ---------- évaluateur : ordre de passage dans la salle ----------
  app.get('/eval/schedule', need('evaluateur'), async (c) => {
    const db = c.env.DB;
    const st = await one(db, 'SELECT exam_id, slot FROM stations WHERE id = ?', c.get('session').subject_id);
    const { planning, slots } = await load(db, st.exam_id);
    const rot = rotationFor(slots);
    // pour chaque place, le tour où elle passe dans cette salle
    const roundOf = {};
    for (let seat = 1; seat <= rot.seats; seat++) for (let r = 1; r <= rot.seats; r++) if (rot.at(seat, r) === st.slot) roundOf[seat] = r;
    return c.json({ planning, slots, slot: st.slot, roundOf });
  });
}
