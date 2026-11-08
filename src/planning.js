// Planning des passages, convocations et échanges de créneaux entre étudiants
import {
  normalizePlanning, candidateSchedule, candidateNumber, seriesStartsAt, rotationFor, DEFAULT_SERIES, checkWishes, wishesOpen, welcomeFor,
} from '../public/js/planning-shared.js';

const placeKey = (day, series) => `${day}|${series}`;

export function registerPlanning(app, h) {
  const { need, httpError, all, one, run, parse, batch, genCode, freshCodes, multiInsert } = h;

  async function load(db, examId) {
    const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', examId);
    if (!exam) throw httpError(404, 'Session introuvable');
    const planning = normalizePlanning(parse(exam.planning, null), exam);
    const slots = (await all(db, 'SELECT slot FROM stations WHERE exam_id = ? AND played = 1 ORDER BY slot', examId)).map((s) => s.slot);
    return { exam, planning, slots };
  }

  // ---------- équipe ----------

  app.get('/exams/:id/planning', need('admin', 'accueil'), async (c) => {
    const db = c.env.DB;
    const s = c.get('session');
    if (s.kind === 'accueil' && Number(s.subject_id) !== Number(c.req.param('id'))) throw httpError(403, 'Accès refusé');
    const { exam, planning, slots } = await load(db, c.req.param('id'));
    if (s.kind === 'accueil') {
      // l'accueil voit les horaires et la liste des candidats, sans adresse, téléphone ni vœux
      const candidates = await all(db, `SELECT id, number, last_name, first_name, day, series, seat, status, confirmed_at, checked_in_at
        FROM candidates WHERE exam_id = ? ORDER BY last_name, first_name`, exam.id);
      const { accueil_code, materiel_check, materiel_common, writing_deadlines, broadcasts, ...pub } = planning;
      return c.json({ exam: { id: exam.id, name: exam.name, starts_on: exam.starts_on, ends_on: exam.ends_on }, planning: pub, slots, stations: [], candidates, swaps: [] });
    }
    const [candidates, swaps, titles] = await Promise.all([
      all(db, `SELECT c.id, c.number, c.last_name, c.first_name, c.email, c.phone, c.day, c.series, c.seat, c.status, c.confirmed_at, c.checked_in_at, c.slot_label, c.wishes, c.wishes_at, c.extra,
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
    // réglages gérés par d'autres onglets : jamais écrasés par une copie ancienne du planning
    const current = await one(db, 'SELECT planning FROM exams WHERE id = ?', exam.id);
    const prev = JSON.parse(current?.planning || '{}') || {};
    for (const k of ['accueil_code', 'materiel_check', 'materiel_common', 'broadcasts']) { if (k in prev) planning[k] = prev[k]; else delete planning[k]; }
    const ds = planning.days.map((d) => d.date);
    await run(db, 'UPDATE exams SET planning = ?, starts_on = ?, ends_on = ? WHERE id = ?', JSON.stringify(planning),
      ds[0] || exam.starts_on, ds[ds.length - 1] || exam.ends_on, exam.id);
    await refreshNumbers(db, exam.id, planning, slots.length);
    return c.json({ ok: true, planning });
  });

  // Jours de la session : on garde les horaires déjà réglés des jours conservés
  app.put('/exams/:id/days', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning, slots } = await load(db, c.req.param('id'));
    const days = [...new Set(((await c.req.json()).days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    if (!days.length) throw httpError(400, 'Choisis au moins un jour.');
    const keep = new Map(planning.days.map((d) => [d.date, d]));
    planning.days = days.map((date) => keep.get(date) || { date, series: DEFAULT_SERIES.map((x) => ({ ...x })) });
    const next = normalizePlanning(planning, exam);
    await run(db, 'UPDATE exams SET planning = ?, starts_on = ?, ends_on = ? WHERE id = ?', JSON.stringify(next), days[0], days[days.length - 1], exam.id);
    await refreshNumbers(db, exam.id, next, slots.length);
    const orphans = await one(db, `SELECT COUNT(*) AS n FROM candidates WHERE exam_id = ? AND status != 'annule' AND day IS NOT NULL
      AND day NOT IN (${days.map(() => '?').join(',')})`, exam.id, ...days);
    return c.json({ ok: true, days, orphans: orphans.n });
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

  // ---------- étudiants fictifs, pour tester les échanges et les vœux ----------
  const FIRST = ['Amina', 'Yanis', 'Sarah', 'Ilyes', 'Inès', 'Rayan', 'Maryam', 'Adam', 'Lina', 'Bilal', 'Nour', 'Sofiane', 'Hajar', 'Mehdi',
    'Yasmine', 'Karim', 'Salma', 'Anis', 'Myriam', 'Ismaël', 'Camille', 'Hugo', 'Léa', 'Moussa', 'Aïcha', 'Samy', 'Rania', 'Walid', 'Fatoumata', 'Elias'];
  const LAST = ['Benali', 'Diallo', 'Haddad', 'Martin', 'Cherif', 'Traoré', 'Bouzid', 'Lefèvre', 'Mansouri', 'Kaci', 'Ndiaye', 'Rahmani',
    'Garcia', 'Belkacem', 'Saidi', 'Toure', 'Amrani', 'Dupont', 'Hamidi', 'Keita', 'Brahimi', 'Moreau', 'Ziani', 'Camara'];

  app.post('/exams/:id/test-candidates', need('admin'), async (c) => {
    const db = c.env.DB;
    const { exam, planning, slots } = await load(db, c.req.param('id'));
    const b = await c.req.json();
    const count = Math.min(200, Math.max(1, Number(b.count) || 30));
    const place = b.place !== false;
    const cap = slots.length || 10;
    const keys = planning.days.flatMap((d) => d.series.map((_, i) => [d.date, i + 1]));
    if (place && !keys.length) throw httpError(400, 'Ajoute d\'abord les jours de passage dans le planning.');
    const taken = new Set((await all(db, "SELECT day, series, seat FROM candidates WHERE exam_id = ? AND status != 'annule' AND seat IS NOT NULL", exam.id))
      .map((r) => `${r.day}|${r.series}|${r.seat}`));
    const n0 = (await one(db, "SELECT COUNT(*) AS n FROM candidates WHERE exam_id = ? AND json_extract(extra, '$.test') = 1", exam.id)).n;
    const codes = await freshCodes(db, count);
    const rows = [];
    let k = 0;
    for (let i = 0; i < count; i++) {
      const j = n0 + i;
      const first = FIRST[j % FIRST.length]; const last = LAST[(j * 7 + Math.floor(j / FIRST.length)) % LAST.length];
      const adherent = j % 5 !== 4;
      let spot = null;
      // réparti série après série, pour qu'il reste des places libres et des créneaux variés
      for (let t = 0; place && t < keys.length && !spot; t++) {
        const [day, series] = keys[(k + t) % keys.length];
        for (let seat = 1; seat <= cap; seat++) if (!taken.has(`${day}|${series}|${seat}`)) { spot = { day, series, seat }; break; }
        if (spot) k = (k + t + 1) % keys.length;
      }
      if (spot) taken.add(`${spot.day}|${spot.series}|${spot.seat}`);
      rows.push({
        exam_id: exam.id, last_name: `${last} (fictif)`, first_name: first, email: `${first}.${last}.${j}@exemple.org`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
        phone: null, faculty: ['Sorbonne Université', 'Université Paris Cité', 'Paris-Saclay', 'UPEC'][j % 4], year: 'DFASM2',
        slot_label: null, day: spot?.day || null, series: spot?.series || null, seat: spot?.seat || null,
        number: spot ? candidateNumber(planning, spot.day, spot.series, spot.seat) : null, status: 'inscrit', code: codes[i],
        extra: JSON.stringify({ test: true, tarif: adherent ? 'Adhérent' : 'Non adhérent', adherent }),
      });
    }
    await batch(db, multiInsert(db, 'candidates', ['exam_id', 'last_name', 'first_name', 'email', 'phone', 'faculty', 'year', 'slot_label',
      'day', 'series', 'seat', 'number', 'status', 'code', 'extra'], rows));
    // quelques demandes d'échange déjà publiées, pour que la bourse ne soit pas vide
    const made = await all(db, "SELECT id, day, series FROM candidates WHERE exam_id = ? AND json_extract(extra, '$.test') = 1 AND seat IS NOT NULL ORDER BY id DESC LIMIT ?", exam.id, count);
    const stmts = [];
    const nReq = b.requests === false ? 0 : Math.min(4, Math.floor(made.length / 6));
    for (let i = 0; i < nReq; i++) {
      const cnd = made[i * 3];
      const others = keys.map(([d, n]) => `${d}|${n}`).filter((x) => x !== `${cnd.day}|${cnd.series}`);
      const wanted = others.filter((_, x) => (x + i) % 3 === 0).slice(0, 3);
      stmts.push(db.prepare('INSERT INTO swaps (exam_id, candidate_id, wanted, code) VALUES (?,?,?,?)').bind(exam.id, cnd.id, JSON.stringify(wanted), genCode(6)));
    }
    await batch(db, stmts);
    return c.json({ created: rows.length, placed: rows.filter((r) => r.seat).length, requests: nReq });
  });

  app.delete('/exams/:id/test-candidates', need('admin'), async (c) => {
    const db = c.env.DB;
    const id = c.req.param('id');
    const n = await one(db, "SELECT COUNT(*) AS n FROM candidates WHERE exam_id = ? AND json_extract(extra, '$.test') = 1", id);
    await db.batch([
      db.prepare(`DELETE FROM auth_sessions WHERE kind = 'etudiant' AND subject_id IN
        (SELECT id FROM candidates WHERE exam_id = ? AND json_extract(extra, '$.test') = 1)`).bind(id),
      db.prepare("DELETE FROM swaps WHERE partner_id IN (SELECT id FROM candidates WHERE exam_id = ? AND json_extract(extra, '$.test') = 1)").bind(id),
      db.prepare("DELETE FROM candidates WHERE exam_id = ? AND json_extract(extra, '$.test') = 1").bind(id),
    ]);
    return c.json({ deleted: n.n });
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
    if (!planning.publish) return { ok: false, why: 'Les créneaux ne sont pas encore publiés.' };
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

  // Une demande d'échange est publique : tous les étudiants de la session la voient.
  // - si ton créneau fait partie de ceux recherchés, tu peux accepter : l'échange se fait tout de suite ;
  // - sinon, tu peux proposer ton créneau : l'auteur de la demande accepte ou refuse depuis son espace ;
  // - dans tous les cas, tu peux refuser (la demande disparaît de ton espace).
  // Une demande sans créneau recherché reste privée : on y accède seulement avec son code.

  const isOpen = (cand, planning) => (cand.day && cand.series && cand.seat ? swapWindow(planning, cand) : { ok: false, why: 'Tu n\'as pas encore de créneau.' });

  app.get('/me/convocation', need('etudiant'), async (c) => {
    const { db, cand, exam, planning, slots } = await me(c);
    const placed = planning.publish && !!(cand.day && cand.series && cand.seat);
    const schedule = placed ? candidateSchedule(planning, slots, cand.day, cand.series, cand.seat) : null;
    const [mine, board, counts, history, evals, myResp] = await Promise.all([
      one(db, "SELECT id, code, wanted, created_at FROM swaps WHERE candidate_id = ? AND status = 'open'", cand.id),
      all(db, `SELECT s.id, s.code, s.wanted, s.created_at, c.day, c.series FROM swaps s JOIN candidates c ON c.id = s.candidate_id
        WHERE s.exam_id = ? AND s.status = 'open' AND s.candidate_id != ? AND c.status != 'annule' AND s.wanted != '[]' ORDER BY s.id DESC`, exam.id, cand.id),
      all(db, "SELECT day, series, COUNT(*) AS n FROM candidates WHERE exam_id = ? AND status != 'annule' AND day IS NOT NULL GROUP BY day, series", exam.id),
      all(db, "SELECT from_place, to_place, done_at FROM swaps WHERE status = 'done' AND (candidate_id = ? OR partner_id = ?) ORDER BY id DESC", cand.id, cand.id),
      one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id = ?', cand.id),
      all(db, 'SELECT r.swap_id, r.kind, r.status FROM swap_responses r WHERE r.candidate_id = ?', cand.id),
    ]);
    // propositions reçues sur ma demande, et bilan des refus
    const received = mine ? await all(db, `SELECT r.id, r.kind, r.status, r.created_at, c.day, c.series FROM swap_responses r
      JOIN candidates c ON c.id = r.candidate_id WHERE r.swap_id = ? AND c.status != 'annule'`, mine.id) : [];
    const myKey = placed ? placeKey(cand.day, cand.series) : null;
    const win = isOpen(cand, planning);
    if (evals.n) Object.assign(win, { ok: false, why: 'Tu as déjà passé tes stations.' });
    const fill = Object.fromEntries(counts.map((r) => [placeKey(r.day, r.series), r.n]));
    const resp = new Map(myResp.map((r) => [r.swap_id, r]));
    const toDesc = (k) => { const [d, n] = k.split('|'); return describe(planning, d, Number(n)); };
    return c.json({
      exam: { name: exam.name },
      candidate: { first_name: cand.first_name, last_name: cand.last_name, number: placed ? cand.number : null, status: cand.status },
      place: planning.place, instructions: planning.instructions, rotation_minutes: planning.rotation_minutes,
      welcome: schedule ? welcomeFor(planning, schedule.start) : '',
      announcement: planning.announcement || null,
      placed, day: placed ? cand.day : null, series: placed ? cand.series : null, seat: placed ? cand.seat : null, schedule,
      published: planning.publish,
      wishes: {
        open: wishesOpen(planning), until: planning.wishes_until || null, min: planning.wishes_min, max_ideal: planning.wishes_max_ideal,
        saved_at: cand.wishes_at, mine: checkWishes(planning, parse(cand.wishes, null)).wishes,
        options: planning.days.flatMap((d) => d.series.map((_, i) => describe(planning, d.date, i + 1))),
      },
      confirmed_at: cand.confirmed_at,
      offer_expires_at: !cand.confirmed_at ? parse(cand.extra, {})?.offer_expires_at || null : null,
      swaps: {
        enabled: !!planning.swaps_open, open: win.ok, why: win.ok ? null : win.why, until: win.until || null,
        close_hours: planning.swaps_close_hours,
        mine: mine ? {
          code: mine.code, created_at: mine.created_at, wanted: parse(mine.wanted, []),
          proposals: received.filter((r) => r.kind === 'proposed' && r.status === 'pending').map((r) => ({ id: r.id, ...describe(planning, r.day, r.series) })),
          declined: received.filter((r) => r.kind === 'declined').length,
          refused: received.filter((r) => r.kind === 'proposed' && r.status === 'refused').length,
        } : null,
        options: planning.days.flatMap((d) => d.series.map((sr, i) => ({ ...describe(planning, d.date, i + 1), filled: fill[placeKey(d.date, i + 1)] || 0, closed: sr.closed })))
          .filter((o) => o.key !== myKey && !o.closed),
        board: board.filter((o) => placeKey(o.day, o.series) !== myKey && resp.get(o.id)?.kind !== 'declined').map((o) => {
          const wanted = parse(o.wanted, []);
          const r = resp.get(o.id);
          return {
            code: o.code, created_at: o.created_at, from: describe(planning, o.day, o.series),
            wanted: wanted.map(toDesc), compatible: wanted.includes(myKey),
            proposed: r?.kind === 'proposed' ? r.status : null,
          };
        }),
        history: history.map((x) => ({ from: x.from_place, to: x.to_place, done_at: x.done_at })),
      },
    });
  });

  app.post('/me/wishes', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    if (!wishesOpen(planning)) throw httpError(400, 'Les vœux sont fermés.');
    if (cand.status === 'annule') throw httpError(400, 'Inscription annulée.');
    const r = checkWishes(planning, (await c.req.json()).wishes);
    if (r.errors.length) throw httpError(400, r.errors.join(' '));
    await run(db, "UPDATE candidates SET wishes = ?, wishes_at = datetime('now') WHERE id = ?", JSON.stringify(r.wishes), cand.id);
    return c.json({ ok: true, ideal: r.ideal, ok_count: r.ok });
  });

  app.post('/me/confirm', need('etudiant'), async (c) => {
    const { db, cand } = await me(c);
    const { present } = await c.req.json();
    await run(db, 'UPDATE candidates SET confirmed_at = ? WHERE id = ?', present ? new Date().toISOString() : null, cand.id);
    return c.json({ ok: true });
  });

  app.post('/me/swaps', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const win = isOpen(cand, planning);
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
    if (!offer || offer.status !== 'open' || offer.c_status === 'annule') throw httpError(404, 'Cette demande n\'existe pas ou n\'est plus valable.');
    if (offer.candidate_id === cand.id) throw httpError(400, 'C\'est ta propre demande.');
    return offer;
  }

  // Vérifie que deux candidats peuvent échanger, puis échange leurs places
  async function doSwap(db, planning, offer, owner, other) {
    if (!owner.seat || !other.seat) throw httpError(400, 'Créneau manquant.');
    if (owner.status === 'annule' || other.status === 'annule') throw httpError(400, 'Inscription annulée.');
    if (owner.day === other.day && owner.series === other.series) throw httpError(400, 'Vous êtes déjà dans la même série.');
    const win = swapWindow(planning, owner, other);
    if (!win.ok) throw httpError(400, win.why);
    const ev = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE candidate_id IN (?, ?)', owner.id, other.id);
    if (ev.n) throw httpError(400, 'L\'un de vous a déjà passé ses stations.');
    const label = (x) => `${x.day}|${x.series}|${x.seat}`;
    const set = (id, x) => db.prepare('UPDATE candidates SET day = ?, series = ?, seat = ?, number = ?, slot_label = ?, confirmed_at = NULL WHERE id = ?')
      .bind(x.day, x.series, x.seat, candidateNumber(planning, x.day, x.series, x.seat), x.slot_label, id);
    await db.batch([
      set(other.id, owner),
      set(owner.id, other),
      db.prepare("UPDATE swaps SET status = 'done', partner_id = ?, from_place = ?, to_place = ?, done_at = datetime('now') WHERE id = ?")
        .bind(other.id, label(owner), label(other), offer.id),
      db.prepare("UPDATE swaps SET status = 'cancelled' WHERE status = 'open' AND candidate_id IN (?, ?)").bind(owner.id, other.id),
      // les propositions encore en attente, sur ces demandes ou faites par ces deux étudiants, tombent
      db.prepare(`UPDATE swap_responses SET status = 'expired', answered_at = datetime('now') WHERE status = 'pending' AND kind = 'proposed'
        AND (candidate_id IN (?, ?) OR swap_id IN (SELECT id FROM swaps WHERE candidate_id IN (?, ?)))`).bind(owner.id, other.id, owner.id, other.id),
      db.prepare("UPDATE swap_responses SET status = 'accepted', answered_at = datetime('now') WHERE swap_id = ? AND candidate_id = ?").bind(offer.id, other.id),
    ]);
  }

  app.get('/me/swaps/:code', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const offer = await findOffer(db, cand, c.req.param('code'));
    return c.json(describe(planning, offer.day, offer.series));
  });

  // Accepter une demande : possible si mon créneau est recherché, ou si j'ai le code d'une demande privée
  app.post('/me/swaps/accept', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const offer = await findOffer(db, cand, (await c.req.json()).code);
    const wanted = parse(offer.wanted, []);
    if (wanted.length && !wanted.includes(placeKey(cand.day, cand.series))) {
      throw httpError(400, 'Ton créneau ne fait pas partie de ceux recherchés : propose-le plutôt, l\'auteur de la demande décidera.');
    }
    const owner = await one(db, 'SELECT * FROM candidates WHERE id = ?', offer.candidate_id);
    const now = describe(planning, owner.day, owner.series);
    await doSwap(db, planning, offer, owner, cand);
    h.notifier?.(c).swap([owner.id, cand.id]);
    return c.json({ ok: true, now });
  });

  // Proposer mon créneau à une demande qui ne le recherchait pas
  app.post('/me/swaps/propose', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const offer = await findOffer(db, cand, (await c.req.json()).code);
    const win = isOpen(cand, planning);
    if (!win.ok) throw httpError(400, win.why);
    if (offer.day === cand.day && offer.series === cand.series) throw httpError(400, 'Vous êtes déjà dans la même série.');
    await run(db, `INSERT INTO swap_responses (swap_id, candidate_id, kind) VALUES (?,?,'proposed')
      ON CONFLICT(swap_id, candidate_id) DO UPDATE SET kind = 'proposed', status = 'pending', created_at = datetime('now'), answered_at = NULL`, offer.id, cand.id);
    return c.json({ ok: true });
  });

  // Refuser une demande : elle disparaît de mon espace
  app.post('/me/swaps/decline', need('etudiant'), async (c) => {
    const { db, cand } = await me(c);
    const offer = await findOffer(db, cand, (await c.req.json()).code);
    await run(db, `INSERT INTO swap_responses (swap_id, candidate_id, kind, status) VALUES (?,?,'declined','done')
      ON CONFLICT(swap_id, candidate_id) DO UPDATE SET kind = 'declined', status = 'done', answered_at = datetime('now')`, offer.id, cand.id);
    return c.json({ ok: true });
  });

  // L'auteur de la demande accepte ou refuse une proposition reçue
  app.post('/me/proposals/:id/:action', need('etudiant'), async (c) => {
    const { db, cand, planning } = await me(c);
    const p = await one(db, `SELECT r.*, s.candidate_id AS owner_id, s.status AS swap_status FROM swap_responses r JOIN swaps s ON s.id = r.swap_id
      WHERE r.id = ? AND r.kind = 'proposed'`, c.req.param('id'));
    if (!p || p.owner_id !== cand.id) throw httpError(404, 'Proposition introuvable.');
    if (p.status !== 'pending' || p.swap_status !== 'open') throw httpError(400, 'Cette proposition n\'est plus valable.');
    if (c.req.param('action') === 'refuse') {
      await run(db, "UPDATE swap_responses SET status = 'refused', answered_at = datetime('now') WHERE id = ?", p.id);
      return c.json({ ok: true });
    }
    if (c.req.param('action') !== 'accept') throw httpError(400, 'Action inconnue');
    const other = await one(db, 'SELECT * FROM candidates WHERE id = ?', p.candidate_id);
    const offer = await one(db, 'SELECT * FROM swaps WHERE id = ?', p.swap_id);
    const before = describe(planning, other.day, other.series);
    await doSwap(db, planning, offer, cand, other);
    h.notifier?.(c).swap([cand.id, other.id]);
    return c.json({ ok: true, now: before });
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
