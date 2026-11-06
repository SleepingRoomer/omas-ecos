ALTER TABLE exams ADD COLUMN planning TEXT;
ALTER TABLE candidates ADD COLUMN seat INTEGER;
ALTER TABLE candidates ADD COLUMN confirmed_at TEXT;
CREATE TABLE swaps ( id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, wanted TEXT NOT NULL DEFAULT '[]', code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'open', partner_id INTEGER, from_place TEXT, to_place TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT );
CREATE INDEX idx_swaps_exam ON swaps(exam_id, status);
CREATE INDEX idx_candidates_place ON candidates(exam_id, day, series, seat);
