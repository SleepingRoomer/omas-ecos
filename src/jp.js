// Journées procédure : routes de l'API
import { normalizeAtelier, atelierChecks, rotation, JP1_DRAFTS, JP_STATUSES } from '../public/js/jp-shared.js';

export function registerJp(app, h) {
  const { need, httpError, all, one, run, freshCodes, multiInsert, batch, parse } = h;

  const jpOr404 = async (db, id) => {
    const jp = await one(db, 'SELECT * FROM jp_days WHERE id = ?', id);
    if (!jp) throw httpError(404, 'Journée introuvable');
    return jp;
  };

  // ---------- journées ----------
  app.get('/jp', need('admin'), async (c) => c.json(await all(c.env.DB, `SELECT j.*,
    (SELECT COUNT(*) FROM jp_ateliers WHERE jp_id = j.id AND active = 1) AS n_ateliers,
    (SELECT COUNT(*) FROM jp_participants WHERE jp_id = j.id AND status != 'annule') AS n_participants,
    (SELECT group_concat(day) FROM (SELECT DISTINCT day FROM jp_slots WHERE jp_id = j.id ORDER BY day)) AS days
    FROM jp_days j ORDER BY j.id DESC`)));

  app.post('/jp', need('admin'), async (c) => {
    const b = await c.req.json();
    if (!String(b.name || '').trim()) throw httpError(400, 'Nom requis');
    const db = c.env.DB;
    const picked = [...new Set((Array.isArray(b.days) ? b.days : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    const r = await run(db, 'INSERT INTO jp_days (name, starts_on, ends_on) VALUES (?,?,?)', b.name.trim(),
      picked[0] || b.starts_on || null, picked[picked.length - 1] || b.ends_on || null);
    const id = r.meta.last_row_id;
    const stmts = [];
    if (b.prefill) {
      stmts.push(...multiInsert(db, 'jp_ateliers', ['jp_id', 'code', 'position', 'title', 'discipline', 'content'],
        JP1_DRAFTS.map((a, i) => ({ jp_id: id, code: a.code, position: i, title: a.title, discipline: a.discipline,
          content: JSON.stringify(normalizeAtelier({ ...a.content, emoji: a.emoji })) }))));
    }
    // deux créneaux par jour, à 9 h et à 14 h
    const days = [...picked];
    if (!days.length && b.starts_on) {
      const d0 = new Date(`${b.starts_on}T12:00:00Z`);
      const d1 = new Date(`${b.ends_on || b.starts_on}T12:00:00Z`);
      for (let d = d0; d <= d1 && days.length < 7; d = new Date(d.getTime() + 864e5)) days.push(d.toISOString().slice(0, 10));
    }
    stmts.push(...multiInsert(db, 'jp_slots', ['jp_id', 'day', 'start_time'],
      days.flatMap((day) => ['09:00', '14:00'].map((t) => ({ jp_id: id, day, start_time: t })))));
    await batch(db, stmts);
    return c.json({ id });
  });

  app.get('/jp/:id', need('admin'), async (c) => {
    const jp = await jpOr404(c.env.DB, c.req.param('id'));
    const ds = await all(c.env.DB, 'SELECT DISTINCT day FROM jp_slots WHERE jp_id = ? ORDER BY day', jp.id);
    return c.json({ ...jp, days: ds.map((d) => d.day) });
  });

  // Jours de la journée procédure : un jour ajouté reçoit deux créneaux (9 h et 14 h), un jour retiré perd les siens
  app.put('/jp/:id/days', need('admin'), async (c) => {
    const db = c.env.DB;
    const jp = await jpOr404(db, c.req.param('id'));
    const days = [...new Set(((await c.req.json()).days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    if (!days.length) throw httpError(400, 'Choisis au moins un jour.');
    const had = new Set((await all(db, 'SELECT DISTINCT day FROM jp_slots WHERE jp_id = ?', jp.id)).map((d) => d.day));
    const gone = [...had].filter((d) => !days.includes(d));
    const added = days.filter((d) => !had.has(d));
    const stmts = [db.prepare('UPDATE jp_days SET starts_on = ?, ends_on = ? WHERE id = ?').bind(days[0], days[days.length - 1], jp.id)];
    for (const d of gone) {
      stmts.push(db.prepare('UPDATE jp_participants SET slot_id = NULL, group_no = NULL WHERE slot_id IN (SELECT id FROM jp_slots WHERE jp_id = ? AND day = ?)').bind(jp.id, d));
      stmts.push(db.prepare('DELETE FROM jp_slots WHERE jp_id = ? AND day = ?').bind(jp.id, d));
    }
    stmts.push(...multiInsert(db, 'jp_slots', ['jp_id', 'day', 'start_time'], added.flatMap((day) => ['09:00', '14:00'].map((t) => ({ jp_id: jp.id, day, start_time: t })))));
    await batch(db, stmts);
    return c.json({ ok: true, added: added.length, removed: gone.length });
  });

  app.patch('/jp/:id', need('admin'), async (c) => {
    const b = await c.req.json();
    const sets = []; const vals = [];
    for (const f of ['name', 'starts_on', 'ends_on', 'atelier_minutes', 'transition_minutes', 'show_planning', 'keypoints_published']) {
      if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]); }
    }
    if (sets.length) await run(c.env.DB, `UPDATE jp_days SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.delete('/jp/:id', need('admin'), async (c) => {
    await run(c.env.DB, 'DELETE FROM jp_days WHERE id = ?', c.req.param('id'));
    return c.json({ ok: true });
  });

  // ---------- ateliers ----------
  const ATELIER_LIST = `SELECT a.id, a.jp_id, a.code, a.position, a.active, a.title, a.discipline, a.author_id, a.reviewer_id, a.status, a.updated_at,
    json_extract(a.content, '$.emoji') AS emoji,
    p.name AS author_name, r.name AS reviewer_name, j.name AS jp_name,
    (SELECT COUNT(*) FROM jp_reviews x WHERE x.atelier_id = a.id AND x.action = 'comment') AS n_comments
    FROM jp_ateliers a JOIN jp_days j ON j.id = a.jp_id
    LEFT JOIN people p ON p.id = a.author_id LEFT JOIN people r ON r.id = a.reviewer_id`;

  app.get('/jp/:id/ateliers', need('admin'), async (c) => c.json(await all(c.env.DB, `${ATELIER_LIST} WHERE a.jp_id = ? ORDER BY a.position, a.code`, c.req.param('id'))));

  app.post('/jp/:id/ateliers', need('admin'), async (c) => {
    const b = await c.req.json();
    const db = c.env.DB;
    const n = await one(db, 'SELECT COUNT(*) AS n FROM jp_ateliers WHERE jp_id = ?', c.req.param('id'));
    const code = String(b.code || `P${n.n + 1}`).trim().toUpperCase();
    const r = await run(db, 'INSERT INTO jp_ateliers (jp_id, code, position, title, content) VALUES (?,?,?,?,?)',
      c.req.param('id'), code, n.n, b.title || null, JSON.stringify(normalizeAtelier({})));
    return c.json({ id: r.meta.last_row_id });
  });

  app.patch('/ateliers/:id', need('admin'), async (c) => {
    const b = await c.req.json();
    if (b.status && !JP_STATUSES[b.status]) throw httpError(400, 'Statut inconnu');
    const sets = []; const vals = [];
    for (const f of ['code', 'position', 'active', 'title', 'discipline', 'author_id', 'reviewer_id', 'status']) {
      if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] === '' ? null : b[f]); }
    }
    if ('emoji' in b) { sets.push("content = json_set(content, '$.emoji', ?)"); vals.push(String(b.emoji || '').trim()); }
    if (sets.length) await run(c.env.DB, `UPDATE jp_ateliers SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...vals, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.delete('/ateliers/:id', need('admin'), async (c) => {
    await run(c.env.DB, 'DELETE FROM jp_ateliers WHERE id = ?', c.req.param('id'));
    return c.json({ ok: true });
  });

  const rightsOf = (s, a) => {
    const isAdmin = s.kind === 'admin';
    const isAuthor = s.kind === 'auteur' && a.author_id === s.subject_id;
    const isReviewer = s.kind === 'auteur' && a.reviewer_id === s.subject_id;
    return { isAdmin, isAuthor, isReviewer, read: isAdmin || isAuthor || isReviewer,
      editable: isAdmin ? a.status !== 'validee' : isAuthor && a.status === 'redaction' };
  };

  app.get('/redaction/ateliers', need('auteur'), async (c) => {
    const id = c.get('session').subject_id;
    return c.json(await all(c.env.DB, `${ATELIER_LIST} WHERE a.author_id = ? OR a.reviewer_id = ? ORDER BY j.id DESC, a.position`, id, id));
  });

  app.get('/ateliers/:id', need('admin', 'auteur'), async (c) => {
    const db = c.env.DB;
    const a = await one(db, `${ATELIER_LIST} WHERE a.id = ?`, c.req.param('id'));
    if (!a) throw httpError(404, 'Atelier introuvable');
    const rights = rightsOf(c.get('session'), a);
    if (!rights.read) throw httpError(403, 'Accès refusé');
    const raw = await one(db, 'SELECT content FROM jp_ateliers WHERE id = ?', a.id);
    const content = normalizeAtelier(parse(raw.content, {}));
    const jp = await one(db, 'SELECT * FROM jp_days WHERE id = ?', a.jp_id);
    const nPart = await one(db, "SELECT COUNT(*) AS n FROM jp_participants WHERE jp_id = ? AND status != 'annule'", a.jp_id);
    const reviews = await all(db, 'SELECT * FROM jp_reviews WHERE atelier_id = ? ORDER BY id DESC', a.id);
    return c.json({ atelier: a, content, rights, reviews, checks: atelierChecks(a, content), jp, participants: nPart.n });
  });

  app.put('/ateliers/:id/content', need('admin', 'auteur'), async (c) => {
    const db = c.env.DB;
    const a = await one(db, 'SELECT * FROM jp_ateliers WHERE id = ?', c.req.param('id'));
    if (!a) throw httpError(404, 'Atelier introuvable');
    if (!rightsOf(c.get('session'), a).editable) throw httpError(403, 'Atelier non modifiable à cette étape');
    const b = await c.req.json();
    const content = normalizeAtelier(b.content);
    await run(db, "UPDATE jp_ateliers SET content = ?, title = ?, discipline = ?, updated_at = datetime('now') WHERE id = ?",
      JSON.stringify(content), b.title ?? a.title, b.discipline ?? a.discipline, a.id);
    return c.json({ ok: true, checks: atelierChecks({ ...a, title: b.title ?? a.title }, content) });
  });

  const FLOW = {
    redaction: { submit: { who: ['author', 'admin'], to: 'relecture' } },
    relecture: { approve: { who: ['reviewer', 'admin'], to: 'validee' }, revise: { who: ['reviewer', 'admin'], to: 'redaction' } },
    validee: { revise: { who: ['admin'], to: 'redaction' } },
  };
  app.post('/ateliers/:id/review', need('admin', 'auteur'), async (c) => {
    const db = c.env.DB;
    const s = c.get('session');
    const a = await one(db, 'SELECT * FROM jp_ateliers WHERE id = ?', c.req.param('id'));
    if (!a) throw httpError(404, 'Atelier introuvable');
    const r = rightsOf(s, a);
    if (!r.read) throw httpError(403, 'Accès refusé');
    const { action, comment } = await c.req.json();
    const text = String(comment || '').trim();
    if (action === 'comment') { if (!text) throw httpError(400, 'Message vide'); } else {
      const step = FLOW[a.status]?.[action];
      if (!step) throw httpError(400, 'Action impossible à cette étape');
      const roles = [r.isAdmin && 'admin', r.isAuthor && 'author', r.isReviewer && 'reviewer'].filter(Boolean);
      if (!step.who.some((w) => roles.includes(w))) throw httpError(403, "Cette étape revient à quelqu'un d'autre");
      if (action === 'revise' && !text) throw httpError(400, 'Explique ce qui est à reprendre');
      if (step.to === 'validee') {
        const errors = atelierChecks(a, parse(a.content, {})).filter((x) => x.level === 'error');
        if (errors.length) throw httpError(400, `Validation impossible : ${errors.length} point(s) bloquant(s).`);
      }
      await run(db, "UPDATE jp_ateliers SET status = ?, updated_at = datetime('now') WHERE id = ?", step.to, a.id);
    }
    await run(db, 'INSERT INTO jp_reviews (atelier_id, author_name, stage, action, comment) VALUES (?,?,?,?,?)', a.id, s.name || 'Administrateur', a.status, action, text || null);
    return c.json({ ok: true });
  });

  // ---------- créneaux ----------
  app.get('/jp/:id/slots', need('admin'), async (c) => c.json(await all(c.env.DB, `SELECT s.*,
    (SELECT COUNT(*) FROM jp_participants p WHERE p.slot_id = s.id AND p.status != 'annule') AS n
    FROM jp_slots s WHERE s.jp_id = ? ORDER BY s.day, s.start_time`, c.req.param('id'))));

  app.post('/jp/:id/slots', need('admin'), async (c) => {
    const b = await c.req.json();
    if (!b.day || !/^\d\d:\d\d$/.test(b.start_time || '')) throw httpError(400, 'Jour et heure de début requis (HH:MM)');
    const r = await run(c.env.DB, 'INSERT INTO jp_slots (jp_id, day, start_time) VALUES (?,?,?)', c.req.param('id'), b.day, b.start_time);
    return c.json({ id: r.meta.last_row_id });
  });

  app.patch('/slots/:id', need('admin'), async (c) => {
    const b = await c.req.json();
    const sets = []; const vals = [];
    for (const f of ['day', 'start_time']) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]); }
    if ('animators' in b) { sets.push('animators = ?'); vals.push(JSON.stringify(b.animators || {})); }
    if (sets.length) await run(c.env.DB, `UPDATE jp_slots SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.delete('/slots/:id', need('admin'), async (c) => {
    const db = c.env.DB;
    await db.batch([
      db.prepare('UPDATE jp_participants SET slot_id = NULL, group_no = NULL WHERE slot_id = ?').bind(c.req.param('id')),
      db.prepare('DELETE FROM jp_slots WHERE id = ?').bind(c.req.param('id')),
    ]);
    return c.json({ ok: true });
  });

  // ---------- inscrits ----------
  app.get('/jp/:id/participants', need('admin'), async (c) => c.json(await all(c.env.DB,
    'SELECT * FROM jp_participants WHERE jp_id = ? ORDER BY slot_id, group_no, last_name, first_name', c.req.param('id'))));

  app.post('/jp/:id/participants', need('admin'), async (c) => {
    const b = await c.req.json();
    const list = (Array.isArray(b.rows) ? b.rows : [b])
      .filter((r) => String(r.last_name || '').trim() || String(r.first_name || '').trim());
    const codes = await freshCodes(c.env.DB, list.length);
    await batch(c.env.DB, multiInsert(c.env.DB, 'jp_participants',
      ['jp_id', 'last_name', 'first_name', 'email', 'phone', 'faculty', 'year', 'slot_label', 'code'],
      list.map((r, i) => ({ jp_id: Number(c.req.param('id')), last_name: String(r.last_name || '').trim(), first_name: String(r.first_name || '').trim(),
        email: r.email || null, phone: r.phone || null, faculty: r.faculty || null, year: r.year || null, slot_label: r.slot_label || null, code: codes[i] }))));
    return c.json({ imported: list.length });
  });

  app.patch('/participants/:id', need('admin'), async (c) => {
    const b = await c.req.json();
    const sets = []; const vals = [];
    for (const f of ['last_name', 'first_name', 'email', 'phone', 'status', 'slot_id', 'group_no']) {
      if (f in b) { sets.push(`${f} = ?`); vals.push(b[f] === '' ? null : b[f]); }
    }
    if ('slot_id' in b && !('group_no' in b)) sets.push('group_no = NULL');
    if (sets.length) await run(c.env.DB, `UPDATE jp_participants SET ${sets.join(', ')} WHERE id = ?`, ...vals, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.delete('/participants/:id', need('admin'), async (c) => {
    await run(c.env.DB, 'DELETE FROM jp_participants WHERE id = ?', c.req.param('id'));
    return c.json({ ok: true });
  });

  // associe un libellé de billetterie à un créneau
  app.post('/jp/:id/participants/map-slot', need('admin'), async (c) => {
    const { slot_label, slot_id } = await c.req.json();
    await run(c.env.DB, 'UPDATE jp_participants SET slot_id = ?, group_no = NULL WHERE jp_id = ? AND slot_label = ?', slot_id || null, c.req.param('id'), slot_label);
    return c.json({ ok: true });
  });

  // déplace les derniers inscrits d'un créneau vers un autre
  app.post('/jp/:id/participants/move', need('admin'), async (c) => {
    const { from, to, count } = await c.req.json();
    const n = Math.max(0, Number(count) || 0);
    const rows = await all(c.env.DB, "SELECT id FROM jp_participants WHERE jp_id = ? AND slot_id = ? AND status != 'annule' ORDER BY id DESC LIMIT ?", c.req.param('id'), from, n);
    if (rows.length) await c.env.DB.batch(rows.map((r) => c.env.DB.prepare('UPDATE jp_participants SET slot_id = ?, group_no = NULL WHERE id = ?').bind(to, r.id)));
    return c.json({ moved: rows.length });
  });

  // forme les groupes de chaque créneau : autant de groupes que d'ateliers, effectifs équilibrés
  app.post('/jp/:id/groups', need('admin'), async (c) => {
    const db = c.env.DB;
    const id = c.req.param('id');
    const nAt = (await one(db, 'SELECT COUNT(*) AS n FROM jp_ateliers WHERE jp_id = ? AND active = 1', id)).n;
    if (!nAt) throw httpError(400, 'Ajoute d\'abord les ateliers');
    const ps = await all(db, "SELECT id, slot_id FROM jp_participants WHERE jp_id = ? AND slot_id IS NOT NULL AND status != 'annule' ORDER BY slot_id, last_name, first_name", id);
    const stmts = [];
    const count = {};
    for (const p of ps) {
      const i = (count[p.slot_id] = (count[p.slot_id] ?? -1) + 1);
      stmts.push(db.prepare('UPDATE jp_participants SET group_no = ? WHERE id = ?').bind((i % nAt) + 1, p.id));
    }
    stmts.push(db.prepare("UPDATE jp_participants SET group_no = NULL WHERE jp_id = ? AND (status = 'annule' OR slot_id IS NULL)").bind(id));
    await batch(db, stmts);
    return c.json({ ok: true });
  });

  // ---------- plan de la journée et matériel ----------
  async function plan(db, jpId) {
    const jp = await jpOr404(db, jpId);
    const ateliers = (await all(db, 'SELECT id, code, title, discipline, content, status FROM jp_ateliers WHERE jp_id = ? AND active = 1 ORDER BY position, code', jpId))
      .map((a) => ({ ...a, content: normalizeAtelier(parse(a.content, {})) }));
    const slots = await all(db, 'SELECT * FROM jp_slots WHERE jp_id = ? ORDER BY day, start_time', jpId);
    const parts = await all(db, "SELECT id, last_name, first_name, slot_id, group_no FROM jp_participants WHERE jp_id = ? AND status != 'annule'", jpId);
    const n = ateliers.length;
    const out = slots.map((s) => {
      const rot = rotation(n, s.start_time, jp.atelier_minutes, jp.transition_minutes);
      const groups = Array.from({ length: n }, (_, g) => ({
        group: g + 1,
        members: parts.filter((p) => p.slot_id === s.id && p.group_no === g + 1).map((p) => `${p.first_name} ${p.last_name}`),
      }));
      return { ...s, animators: parse(s.animators, {}), end: rot.end, convocation: rot.convocation, turns: rot.turns.map((t) => ({
        ...t, by_group: groups.map((g) => rot.atelierOf(g.group, t.turn)),
      })), groups, unassigned: parts.filter((p) => p.slot_id === s.id && !p.group_no).length };
    });
    // matériel : postes fixes + consommables × inscrits × 1,2
    const total = parts.filter((p) => p.slot_id).length;
    const material = ateliers.map((a) => ({
      code: a.code, emoji: a.content.emoji, title: a.title, postes: a.content.postes,
      fixe: a.content.materiel.filter((m) => m.article).map((m) => ({ article: m.article, qte: (Number(m.qte) || 0) * a.content.postes })),
      conso: a.content.consommables.filter((m) => m.article).map((m) => ({ article: m.article, par_etudiant: Number(m.qte) || 0, qte: Math.ceil((Number(m.qte) || 0) * total * 1.2) })),
    }));
    return { jp, ateliers: ateliers.map(({ content, ...a }) => ({ ...a, emoji: content.emoji })), slots: out, material, participants: total };
  }

  app.get('/jp/:id/plan', need('admin'), async (c) => c.json(await plan(c.env.DB, c.req.param('id'))));

  // ---------- espace participant ----------
  app.get('/me/journee', need('participant'), async (c) => {
    const db = c.env.DB;
    const p = await one(db, 'SELECT * FROM jp_participants WHERE id = ?', c.get('session').subject_id);
    if (!p) throw httpError(404, 'Inscription introuvable');
    const P = await plan(db, p.jp_id);
    const slot = P.slots.find((s) => s.id === p.slot_id);
    const full = (await all(db, 'SELECT code, title, discipline, content FROM jp_ateliers WHERE jp_id = ? AND active = 1 ORDER BY position, code', p.jp_id))
      .map((a) => ({ ...a, content: normalizeAtelier(parse(a.content, {})) }));
    const showPlan = !!P.jp.show_planning && slot && p.group_no;
    return c.json({
      participant: { first_name: p.first_name, last_name: p.last_name, group: p.group_no },
      jp: { name: P.jp.name, keypoints_published: !!P.jp.keypoints_published, atelier_minutes: P.jp.atelier_minutes },
      slot: slot ? { day: slot.day, start_time: slot.start_time, end: slot.end, convocation: slot.convocation } : null,
      parcours: showPlan ? slot.turns.map((t) => { const a = full[t.by_group[p.group_no - 1]]; return { start: t.start, end: t.end, code: a.code, emoji: a.content.emoji, title: a.title, discipline: a.discipline }; }) : null,
      ateliers: full.map((a) => ({ code: a.code, emoji: a.content.emoji, title: a.title, discipline: a.discipline, objectif: a.content.objectif,
        ...(P.jp.keypoints_published ? { points_cles: a.content.points_cles, grille: a.content.grille.filter(Boolean), references: a.content.references } : {}) })),
    });
  });
}
