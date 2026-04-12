-- ═══════════════════════════════════════════════════════════════════════════════
-- ingestion_state — Tracks when each league was last ingested
-- Used by auto-ingest.js / Lambda to rotate through leagues
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ingestion_state (
  league_slug    TEXT PRIMARY KEY,
  league_id      INTEGER NOT NULL,
  last_started   TIMESTAMPTZ,
  last_completed TIMESTAMPTZ,
  last_error     TEXT,
  api_calls_used INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
  priority       INTEGER DEFAULT 1,  -- higher = more frequent updates
  retry_count    INTEGER DEFAULT 0   -- consecutive failures, reset on success
);

-- Add retry_count column if upgrading from previous schema
ALTER TABLE ingestion_state ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Seed all leagues with their PandaScore IDs
INSERT INTO ingestion_state (league_slug, league_id, priority) VALUES
  -- Tier 1 (priority 3 — most frequent)
  ('LEC', 4197, 3), ('LCS', 4198, 3), ('LCK', 293, 3), ('LPL', 294, 3),
  ('CBLOL', 302, 3), ('LCP', 5351, 3),
  -- International (priority 3)
  ('WORLDS', 297, 3), ('MSI', 300, 3),
  -- LTA (priority 2)
  ('LTANORTH', 5345, 2), ('LTASOUTH', 5346, 2),
  -- Tier 2 (priority 2)
  ('PCS', 4288, 2), ('LLA', 4199, 2), ('VCS', 4141, 2), ('LCO', 4539, 2),
  ('LCL', 4004, 2), ('TCL', 1003, 2), ('LJL', 2092, 2), ('OPL', 301, 2),
  -- ERLs (priority 1)
  ('EUMASTERS', 4139, 1), ('EMEAMASTERS', 4996, 1),
  ('LFL', 4292, 1), ('PRM', 4302, 1), ('LES', 5496, 1), ('UL', 4300, 1),
  ('LVPSL', 4213, 1), ('NLC', 4411, 1), ('LPLOL', 4407, 1), ('GLL', 4723, 1),
  ('AL', 4962, 1), ('HLL', 5355, 1), ('LIT', 5211, 1), ('PGN', 4405, 1),
  ('EBL', 4426, 1), ('ES', 4722, 1), ('HM', 4433, 1),
  -- Academy / Dev (priority 1)
  ('LDL', 4226, 1), ('LCKCL', 4553, 1), ('CBLOLACAD', 4533, 1),
  ('LCSACAD', 4228, 1), ('NACL', 4961, 1),
  -- Off-season / Other (priority 0)
  ('ALLSTAR', 296, 0), ('DEMACIACUP', 4140, 0), ('KESPACUP', 2711, 0),
  ('EWC', 5262, 0), ('FIRSTSTAND', 5369, 0), ('ROADOFLEGENDS', 5366, 0),
  ('RIFTLEGENDS', 5358, 0),
  -- Historical (priority 0)
  ('EULCS', 290, 0), ('NALCS', 289, 0), ('LMS', 295, 0)
ON CONFLICT (league_slug) DO NOTHING;

-- Index for the "pick most stale" query
CREATE INDEX IF NOT EXISTS idx_ingestion_state_staleness
  ON ingestion_state (status, priority DESC, last_completed ASC NULLS FIRST);
