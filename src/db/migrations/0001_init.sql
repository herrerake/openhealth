-- OpenHealth initial schema (SPEC §5). Timestamps are ISO-8601 UTC text; JSON is text.

CREATE TABLE athletes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  primary_sport TEXT,
  tz TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,          -- connected|syncing|error|disconnected
  mode TEXT NOT NULL,            -- demo|live|file
  credentials TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  UNIQUE (athlete_id, provider)
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,           -- one row per provider per run: <runId>:<provider>
  run_id TEXT NOT NULL,
  athlete_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,          -- running|done|error
  accepted INT NOT NULL DEFAULT 0,
  duplicates INT NOT NULL DEFAULT 0,
  rejected INT NOT NULL DEFAULT 0,
  duration_ms INT,
  detail TEXT
);

CREATE TABLE source_records (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,            -- visit|training_session|result|workout|daily_metric|hr_aggregate
  natural_key TEXT NOT NULL,
  payload TEXT,
  payload_r2_key TEXT,
  payload_hash TEXT NOT NULL,
  start_utc TEXT,
  end_utc TEXT,
  local_date TEXT,
  tz TEXT,
  sync_run_id TEXT,
  updated_at TEXT,
  UNIQUE (athlete_id, source, natural_key)
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  local_date TEXT NOT NULL,
  kind TEXT NOT NULL,            -- class|open_gym|run|other
  category TEXT NOT NULL,        -- strength|metcon|run|row|mixed
  start_utc TEXT,
  end_utc TEXT,
  status TEXT NOT NULL,          -- auto_match|review_required|confirmed
  flags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE session_sources (
  session_id INT NOT NULL,
  source_record_id INT NOT NULL,
  role TEXT NOT NULL,            -- anchor|supporting|duplicate
  PRIMARY KEY (session_id, source_record_id)
);

CREATE TABLE results (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  session_id INT,
  source_record_id INT NOT NULL,
  benchmark TEXT,
  movement TEXT,
  scaling TEXT,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  local_date TEXT NOT NULL
);

CREATE TABLE measurements (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  session_id INT,
  source_record_id INT NOT NULL,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  start_utc TEXT,
  end_utc TEXT,
  local_date TEXT NOT NULL
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  session_id INT,
  source_record_id INT NOT NULL,
  local_date TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE conflicts (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  session_id INT NOT NULL,
  field TEXT NOT NULL,
  values_json TEXT NOT NULL,
  chosen TEXT NOT NULL,
  resolved_by TEXT NOT NULL      -- rule|athlete
);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  action TEXT NOT NULL,          -- merge|split|pick|confirm
  payload TEXT NOT NULL DEFAULT '{}',
  decided_at TEXT NOT NULL
);

CREATE TABLE dashboards (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  origin TEXT NOT NULL,          -- default|chat
  created_at TEXT NOT NULL
);

CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  athlete_id TEXT NOT NULL,
  angle TEXT,
  status TEXT NOT NULL,          -- draft|approved|invalidated
  fact_sheet TEXT,
  script TEXT,
  check_report TEXT,
  draft_key TEXT,
  final_key TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE INDEX ix_source_records_date ON source_records (athlete_id, local_date);
CREATE INDEX ix_sessions_date ON sessions (athlete_id, local_date);
CREATE INDEX ix_results_bench ON results (athlete_id, benchmark, local_date);
CREATE INDEX ix_meas_type ON measurements (athlete_id, type, local_date);
CREATE INDEX ix_sync_runs_run ON sync_runs (athlete_id, run_id);
