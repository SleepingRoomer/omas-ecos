-- Plateforme ECOS OMAS : schéma initial

CREATE TABLE exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  eval_open INTEGER NOT NULL DEFAULT 0,          -- saisie des grilles ouverte
  show_results INTEGER NOT NULL DEFAULT 1,       -- les étudiants voient leurs notes et leur rang
  show_details INTEGER NOT NULL DEFAULT 1,       -- items manqués et commentaires visibles
  corrections_published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rédacteurs, relecteurs (un même compte peut être l'un ou l'autre selon la station)
CREATE TABLE people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  specialty TEXT,
  code TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,                 -- A1..A5, B1..B5, R1, R2
  played INTEGER NOT NULL DEFAULT 1,  -- 0 pour une réserve non jouée
  domain TEXT,
  type TEXT,                          -- PS, PSS, SANS, MANNEQUIN
  discipline TEXT,
  title TEXT,
  author_id INTEGER REFERENCES people(id),
  peer_id INTEGER REFERENCES people(id),
  expert_id INTEGER REFERENCES people(id),
  status TEXT NOT NULL DEFAULT 'a_attribuer',
  content TEXT NOT NULL DEFAULT '{}',
  eval_code TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exam_id, slot)
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  stage TEXT,
  action TEXT NOT NULL,               -- comment, submit, approve, revise, refuse, status
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  number TEXT,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  faculty TEXT,
  year TEXT,
  slot_label TEXT,                    -- créneau tel qu'il vient de la billetterie
  day TEXT,                           -- AAAA-MM-JJ
  series INTEGER,
  status TEXT NOT NULL DEFAULT 'inscrit',
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  evaluator_name TEXT,
  absent INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '{}', -- {apt:{id:{ok,comment}}, com:{id:valeur}}
  global INTEGER,
  comment TEXT,
  points REAL,
  max_points REAL,
  score REAL,                         -- sur 20
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (station_id, candidate_id)
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- admin, auteur, evaluateur, etudiant
  subject_id INTEGER,
  name TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_stations_exam ON stations(exam_id);
CREATE INDEX idx_candidates_exam ON candidates(exam_id);
CREATE INDEX idx_eval_exam ON evaluations(exam_id);
CREATE INDEX idx_eval_candidate ON evaluations(candidate_id);
CREATE INDEX idx_reviews_station ON reviews(station_id);
