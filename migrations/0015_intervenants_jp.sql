-- Intervenants des journées procédure : inscription par un lien public, affectation aux ateliers par créneau
CREATE TABLE jp_intervenants ( id INTEGER PRIMARY KEY AUTOINCREMENT, jp_id INTEGER NOT NULL REFERENCES jp_days(id) ON DELETE CASCADE, email TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT, specialty TEXT, status TEXT, slots TEXT NOT NULL DEFAULT '[]', ateliers TEXT NOT NULL DEFAULT '[]', note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (jp_id, email) );
CREATE INDEX idx_jp_intervenants ON jp_intervenants(jp_id);
ALTER TABLE jp_days ADD COLUMN intervenants_open INTEGER NOT NULL DEFAULT 0;
