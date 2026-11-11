// Banque de stations (reprendre une station déjà écrite) et fichiers attachés aux stations (images, PDF)
import { loadExamState } from './state.js';
const MIMES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46], 'application/pdf': [0x25, 0x50, 0x44, 0x46] };
const MAX = 1900000; // une ligne D1 ne dépasse pas 2 Mo

export function registerBanque(app, h) {
  const { need, httpError, all, one, run, parse, stationRights, STATION_LIST_SQL } = h;

  // ---------- banque ----------
  // Chaque station reprise garde la trace de son origine : une « lignée » regroupe toutes ses versions jouées.
  app.get('/bank', need('admin', 'lead'), async (c) => {
    const db = c.env.DB;
    const target = Number(c.req.query('target')) || null;
    const rows = await all(db, `SELECT s.id, s.exam_id, s.slot, s.played, s.domain, s.type, s.discipline, s.title, s.status, s.origin_id,
        COALESCE(s.origin_id, s.id) AS lineage, e.name AS exam_name, e.starts_on,
        (e.id = COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'reserve_exam'), 0)) AS is_reserve,
        json_extract(s.content, '$.identite.item') AS item, json_extract(s.content, '$.identite.sdd') AS sdd,
        json_array_length(json_extract(s.content, '$.grille.apt')) AS n_apt,
        (SELECT COUNT(*) FROM station_files f WHERE f.station_id = s.id) AS n_files,
        (SELECT COUNT(*) FROM evaluations v WHERE v.station_id = s.id AND v.absent = 0) AS n_eval,
        (SELECT AVG(v.score) FROM evaluations v WHERE v.station_id = s.id AND v.absent = 0) AS mean
      FROM stations s JOIN exams e ON e.id = s.exam_id
      WHERE COALESCE(s.title, '') != '' ORDER BY e.starts_on DESC, s.slot`);
    let overlap = {}; let targetExam = null;
    if (target) {
      const t = await one(db, 'SELECT s.exam_id, e.starts_on FROM stations s JOIN exams e ON e.id = s.exam_id WHERE s.id = ?', target);
      if (t) {
        targetExam = t;
        // candidats de la session cible déjà inscrits à une autre session : ils ont passé ses stations
        const o = await all(db, `SELECT c2.exam_id, COUNT(DISTINCT lower(c2.email)) AS n FROM candidates c1
          JOIN candidates c2 ON lower(c2.email) = lower(c1.email) AND c2.exam_id != c1.exam_id AND c2.status != 'annule'
          WHERE c1.exam_id = ? AND c1.status != 'annule' AND COALESCE(c1.email, '') != '' GROUP BY c2.exam_id`, t.exam_id);
        overlap = Object.fromEntries(o.map((r) => [r.exam_id, r.n]));
      }
    }
    return c.json({ rows, overlap, target_exam: targetExam });
  });

  // Reprendre une station de la banque dans un emplacement d'une session : contenu, grille et fichiers sont copiés.
  app.post('/stations/:id/copy-from', need('admin', 'lead'), async (c) => {
    const db = c.env.DB;
    const target = await one(db, 'SELECT * FROM stations WHERE id = ?', c.req.param('id'));
    const { source_id } = await c.req.json();
    const src = await one(db, 'SELECT s.*, e.name AS exam_name FROM stations s JOIN exams e ON e.id = s.exam_id WHERE s.id = ?', source_id);
    if (!target || !src) throw httpError(404, 'Station introuvable');
    if (src.id === target.id) throw httpError(400, 'C\'est la même station.');
    const n = await one(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE station_id = ?', target.id);
    if (n.n) throw httpError(400, 'Des grilles ont déjà été saisies dans cette salle : on ne remplace pas une station déjà jouée.');
    const before = await all(db, 'SELECT id FROM station_files WHERE station_id = ? ORDER BY id', src.id);
    await db.batch([
      db.prepare('DELETE FROM station_files WHERE station_id = ?').bind(target.id),
      db.prepare(`INSERT INTO station_files (station_id, name, mime, size, data) SELECT ?, name, mime, size, data FROM station_files WHERE station_id = ? ORDER BY id`).bind(target.id, src.id),
    ]);
    const after = await all(db, 'SELECT id FROM station_files WHERE station_id = ? ORDER BY id', target.id);
    const map = Object.fromEntries(before.map((f, i) => [f.id, after[i]?.id]));
    const content = parse(src.content, {});
    if (Array.isArray(content.documents)) content.documents = content.documents.map((d) => (d?.file_id ? { ...d, file_id: map[d.file_id] || null } : d));
    const status = src.status === 'validee' ? 'validee' : 'redaction';
    await db.batch([
      db.prepare(`UPDATE stations SET content = ?, title = ?, domain = ?, type = ?, discipline = ?, status = ?, origin_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(JSON.stringify(content), src.title, src.domain, src.type, src.discipline, status, src.origin_id || src.id, target.id),
      db.prepare("INSERT INTO reviews (station_id, author_name, stage, action, comment) VALUES (?, 'Organisateurs', ?, 'comment', ?)")
        .bind(target.id, status, `Station reprise de la banque : ${src.slot}, ${src.exam_name}.`),
    ]);
    return c.json({ ok: true, status });
  });

  // ---------- fichiers des stations ----------
  async function stationFor(c, id) {
    const st = await one(c.env.DB, `${STATION_LIST_SQL} WHERE s.id = ?`, id);
    if (st) delete st.exam_planning;
    if (!st) throw httpError(404, 'Station introuvable');
    return { st, rights: stationRights(c.get('session'), st) };
  }

  app.get('/stations/:id/files', need('admin', 'auteur', 'evaluateur'), async (c) => {
    const { st, rights } = await stationFor(c, c.req.param('id'));
    if (!rights.read) throw httpError(403, 'Accès refusé');
    return c.json(await all(c.env.DB, 'SELECT id, name, mime, size, created_at FROM station_files WHERE station_id = ? ORDER BY id', st.id));
  });

  app.post('/stations/:id/files', need('admin', 'auteur'), async (c) => {
    const { st, rights } = await stationFor(c, c.req.param('id'));
    if (!rights.editable) throw httpError(403, 'La station n\'est pas modifiable à cette étape.');
    const mime = (c.req.header('Content-Type') || '').split(';')[0].trim();
    if (!MIMES[mime]) throw httpError(400, 'Formats acceptés : JPEG, PNG, WebP ou PDF.');
    const buf = await c.req.arrayBuffer();
    if (!buf.byteLength) throw httpError(400, 'Fichier vide');
    if (buf.byteLength > MAX) throw httpError(400, 'Fichier trop lourd (1,9 Mo au plus). Pour un PDF, réduis-le ; les images sont réduites automatiquement.');
    const head = new Uint8Array(buf.slice(0, 12));
    if (!MIMES[mime].every((b, i) => head[i] === b) || (mime === 'image/webp' && String.fromCharCode(...head.slice(8, 12)) !== 'WEBP')) throw httpError(400, 'Le contenu du fichier ne correspond pas à son type.');
    const count = await one(c.env.DB, 'SELECT COUNT(*) AS n FROM station_files WHERE station_id = ?', st.id);
    if (count.n >= 20) throw httpError(400, '20 fichiers au plus par station.');
    let name = 'document';
    try { name = decodeURIComponent(c.req.header('X-Filename') || 'document'); } catch { /* nom illisible */ }
    name = name.replace(/[\\/\r\n"]/g, '_').slice(0, 120) || 'document';
    const r = await c.env.DB.prepare('INSERT INTO station_files (station_id, name, mime, size, data) VALUES (?,?,?,?,?)').bind(st.id, name, mime, buf.byteLength, buf).run();
    return c.json({ id: r.meta.last_row_id, name, mime, size: buf.byteLength });
  });

  app.delete('/files/:id', need('admin', 'auteur'), async (c) => {
    const f = await one(c.env.DB, 'SELECT id, station_id FROM station_files WHERE id = ?', c.req.param('id'));
    if (!f) throw httpError(404, 'Fichier introuvable');
    const { rights } = await stationFor(c, f.station_id);
    if (!rights.editable) throw httpError(403, 'La station n\'est pas modifiable à cette étape.');
    await run(c.env.DB, 'DELETE FROM station_files WHERE id = ?', f.id);
    return c.json({ ok: true });
  });

  // Lecture : l'équipe de la station, l'évaluateur de la salle (saisie ouverte), et les candidats une fois les corrections publiées
  app.get('/files/:id', need('admin', 'auteur', 'evaluateur', 'etudiant'), async (c) => {
    const db = c.env.DB;
    const f = await one(db, 'SELECT * FROM station_files WHERE id = ?', c.req.param('id'));
    if (!f) throw httpError(404, 'Fichier introuvable');
    const s = c.get('session');
    if (s.kind === 'etudiant') {
      const ok = await one(db, `SELECT 1 AS ok FROM candidates c JOIN exams e ON e.id = c.exam_id JOIN stations st ON st.exam_id = e.id
        WHERE c.id = ? AND st.id = ? AND e.corrections_published = 1`, s.subject_id, f.station_id);
      if (!ok) throw httpError(403, 'Accès refusé');
    } else {
      const { st, rights } = await stationFor(c, f.station_id);
      if (!rights.read) throw httpError(403, 'Accès refusé');
      if (rights.isEval && !rights.involved) {
        const E = await loadExamState(db, st.exam_id);
        if (!E?.eval.open) throw httpError(403, 'La saisie est fermée.');
      }
    }
    const bytes = f.data instanceof ArrayBuffer ? f.data : new Uint8Array(f.data);
    return new Response(bytes, { headers: {
      'Content-Type': f.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  });
}
