CREATE TABLE mail_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, kind TEXT NOT NULL, ref TEXT, to_email TEXT NOT NULL DEFAULT '', subject TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE INDEX idx_mail_ref ON mail_log(kind, ref);
CREATE INDEX idx_mail_exam ON mail_log(exam_id);
ALTER TABLE exams ADD COLUMN anonymized_at TEXT;
