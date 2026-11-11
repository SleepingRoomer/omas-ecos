// Responsable de rédaction et réserve de stations.
// Le responsable est un rédacteur (table people) que les organisateurs désignent : il a leurs droits sur toutes les stations
// (créer, écrire, attribuer, faire avancer le circuit, valider, reprendre dans une session), sans voir candidats, notes ni bénévoles.
// La réserve est une session cachée (settings.reserve_exam) : on y écrit des stations hors session, puis on les reprend
// dans une salle avec la banque. Elle n'apparaît pas dans la liste des sessions.

export async function leadIds(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'redaction_leads'").first().catch(() => null);
  try { return (JSON.parse(r?.value || '[]') || []).map(Number); } catch { return []; }
}

const saveSetting = (db, key, value) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
  .bind(key, value).run();

// La session cachée qui porte la réserve, créée au premier besoin
export async function reserveExamId(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'reserve_exam'").first().catch(() => null);
  const id = Number(r?.value) || null;
  if (id && await db.prepare('SELECT 1 AS ok FROM exams WHERE id = ?').bind(id).first()) return id;
  const ins = await db.prepare("INSERT INTO exams (name, planning, eval_open) VALUES ('Réserve de stations', '{\"reserve\":1}', 0)").run();
  const nid = ins.meta.last_row_id;
  await saveSetting(db, 'reserve_exam', String(nid));
  return nid;
}

export function registerRedaction(app, h) {
  const { need, httpError, all, one, run, uniqueCode } = h;

  // Désigner (ou non) un responsable de rédaction : organisateurs seulement
  app.put('/people/:id/lead', need('admin'), async (c) => {
    const db = c.env.DB; const id = Number(c.req.param('id'));
    if (!await one(db, 'SELECT 1 AS ok FROM people WHERE id = ?', id)) throw httpError(404, 'Personne introuvable');
    const { lead } = await c.req.json();
    const ids = (await leadIds(db)).filter((x) => x !== id);
    if (lead) ids.push(id);
    await saveSetting(db, 'redaction_leads', JSON.stringify(ids));
    return c.json({ ok: true, lead: !!lead });
  });

  // Ce dont le responsable a besoin pour travailler : la réserve et la liste des sessions (sans rien d'autre)
  app.get('/redaction/overview', need('admin', 'lead'), async (c) => {
    const db = c.env.DB;
    const reserve = await reserveExamId(db);
    const sessions = await all(db, `SELECT e.id, e.name, e.starts_on, e.ends_on, e.planning,
      (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id) AS n_stations,
      (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id AND s.played = 1 AND s.status = 'validee') AS n_ready,
      (SELECT COUNT(*) FROM stations s WHERE s.exam_id = e.id AND s.played = 1) AS n_played
      FROM exams e WHERE e.id != ? AND e.anonymized_at IS NULL ORDER BY COALESCE(e.starts_on, '9999') DESC, e.id DESC`, reserve).catch(() => []);
    // le planning ne sert qu'aux échéances de rédaction : on ne renvoie que ça
    return c.json({ reserve: { id: reserve, name: 'Réserve de stations' },
      sessions: sessions.map(({ planning, ...e }) => { let w = {}; try { w = JSON.parse(planning || '{}')?.writing_deadlines || {}; } catch { /* rien */ }
        return { ...e, planning: JSON.stringify({ writing_deadlines: w }) }; }) });
  });

  // Nouvelle station dans la réserve. Créée par le responsable, elle lui est attribuée : il la rédige ou la confie à quelqu'un.
  app.post('/reserve/stations', need('admin', 'lead'), async (c) => {
    const db = c.env.DB; const s = c.get('session');
    const reserve = await reserveExamId(db);
    const b = await c.req.json().catch(() => ({}));
    const used = new Set((await all(db, 'SELECT slot FROM stations WHERE exam_id = ?', reserve)).map((x) => x.slot));
    let n = used.size + 1; while (used.has(`R${n}`)) n++;
    const mine = s.kind === 'auteur' ? Number(s.subject_id) : null;
    const r = await run(db, `INSERT INTO stations (exam_id, slot, played, domain, type, discipline, title, author_id, status, eval_code)
      VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`, reserve, `R${n}`, b.domain || null, b.type || 'SANS', b.discipline || null,
      String(b.title || '').trim().slice(0, 200) || null, mine, mine ? 'redaction' : 'a_attribuer', await uniqueCode(db));
    return c.json({ id: r.meta.last_row_id, slot: `R${n}` });
  });
}
