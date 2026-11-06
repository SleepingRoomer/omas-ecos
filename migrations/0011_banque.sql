CREATE TABLE station_files ( id INTEGER PRIMARY KEY AUTOINCREMENT, station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE INDEX idx_files_station ON station_files(station_id);
ALTER TABLE stations ADD COLUMN origin_id INTEGER;
