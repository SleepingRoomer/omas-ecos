// Export complet d'une session (stations, candidats, grilles), pour l'onglet Analyse, le bouton Sauvegarde et la sauvegarde hebdomadaire.
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// SQLite assemble lui-même le JSON des grilles : le Worker ne fait que concaténer, ce qui reste rapide
// même avec plusieurs milliers de grilles.
async function jsonRows(db, sql, ...args) {
  const rows = await all(db, sql, ...args);
  return `[${rows.map((r) => r.j).join(',')}]`;
}

export async function examDataset(db, examId, full) {
  const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', examId);
  if (!exam) return null;
  const candCols = full
    ? "'key', id, 'number', number, 'last_name', last_name, 'first_name', first_name, 'email', email, 'phone', phone, 'faculty', faculty, 'year', year, 'slot_label', slot_label, 'day', day, 'series', series, 'seat', seat, 'status', status, 'code', code, 'confirmed_at', confirmed_at, 'extra', json(COALESCE(extra, 'null'))"
    : "'id', id, 'number', number, 'faculty', faculty, 'year', year, 'day', day, 'series', series, 'seat', seat, 'status', status, 'extra', json(COALESCE(extra, 'null'))";
  const [stations, candidates, evaluations] = await Promise.all([
    jsonRows(db, `SELECT json_object('${full ? 'key' : 'id'}', id, 'slot', slot, 'played', played, 'domain', domain, 'type', type, 'discipline', discipline,
      'title', title, 'status', status, 'content', json(content)) AS j FROM stations WHERE exam_id = ? ORDER BY slot`, examId),
    jsonRows(db, `SELECT json_object(${candCols}) AS j FROM candidates WHERE exam_id = ? ORDER BY id`, examId),
    jsonRows(db, `SELECT json_object('station', station_id, 'candidate', candidate_id, 'evaluator_name', evaluator_name, 'absent', absent,
      'answers', json(answers), 'global', global, 'comment', comment, 'points', points, 'max_points', max_points, 'score', score,
      'created_at', created_at) AS j FROM evaluations WHERE exam_id = ? ORDER BY id`, examId),
  ]);
  const head = full
    ? { format: 'omas-ecos-session', version: 1, exported_at: new Date().toISOString(),
      exam: { name: exam.name, starts_on: exam.starts_on, ends_on: exam.ends_on, planning: parse(exam.planning, null) } }
    : { exam };
  return `${JSON.stringify(head).slice(0, -1)},"stations":${stations},"candidates":${candidates},"evaluations":${evaluations}}`;
}
