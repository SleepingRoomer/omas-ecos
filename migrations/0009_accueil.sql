ALTER TABLE candidates ADD COLUMN checkin TEXT;
ALTER TABLE candidates ADD COLUMN checked_in_at TEXT;
CREATE UNIQUE INDEX idx_cand_checkin ON candidates(checkin);
CREATE TABLE waitlist ( id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, last_name TEXT NOT NULL, first_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, faculty TEXT, year TEXT, tarif TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'waiting', candidate_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE INDEX idx_waitlist_exam ON waitlist(exam_id, status);
