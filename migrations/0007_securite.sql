CREATE TABLE login_failures ( id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, role TEXT, at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE INDEX idx_login_failures ON login_failures(ip, at);
ALTER TABLE evaluations ADD COLUMN ip TEXT;
