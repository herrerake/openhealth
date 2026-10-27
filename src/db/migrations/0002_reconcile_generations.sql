-- Reconciliation writes a whole new generation of rows, then switches the athlete's pointer
-- and removes older generations in one atomic batch. Readers use the current generation only.

ALTER TABLE sessions ADD COLUMN generation TEXT NOT NULL DEFAULT '';
ALTER TABLE results ADD COLUMN generation TEXT NOT NULL DEFAULT '';
ALTER TABLE measurements ADD COLUMN generation TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN generation TEXT NOT NULL DEFAULT '';
ALTER TABLE conflicts ADD COLUMN generation TEXT NOT NULL DEFAULT '';

CREATE TABLE reconcile_generations (
  athlete_id TEXT PRIMARY KEY,
  generation TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX ix_sessions_generation_key ON sessions (athlete_id, generation, session_key);
