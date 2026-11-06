CREATE TABLE evaluations_new ( id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, evaluator_name TEXT NOT NULL DEFAULT '' COLLATE NOCASE, absent INTEGER NOT NULL DEFAULT 0, answers TEXT NOT NULL DEFAULT '{}', global INTEGER, comment TEXT, points REAL, max_points REAL, score REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (station_id, candidate_id, evaluator_name) );
INSERT INTO evaluations_new (id, exam_id, station_id, candidate_id, evaluator_name, absent, answers, global, comment, points, max_points, score, created_at, updated_at) SELECT id, exam_id, station_id, candidate_id, COALESCE(evaluator_name, ''), absent, answers, global, comment, points, max_points, score, created_at, updated_at FROM evaluations;
DROP TABLE evaluations;
ALTER TABLE evaluations_new RENAME TO evaluations;
CREATE INDEX idx_eval_exam ON evaluations(exam_id);
CREATE INDEX idx_eval_candidate ON evaluations(candidate_id);
CREATE INDEX idx_eval_station ON evaluations(station_id);
ALTER TABLE candidates ADD COLUMN extra TEXT;
