-- ═══════════════════════════════════════════════════════════════════════════════
-- match_ingestion_tracking — Tracks which finished matches have been fully ingested
-- Used by match-poller.js to know which matches need game data dump
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add ingestion tracking to matches table
ALTER TABLE matches ADD COLUMN IF NOT EXISTS games_ingested_at TIMESTAMPTZ;

-- Index for quickly finding finished-but-not-ingested matches
CREATE INDEX IF NOT EXISTS idx_matches_pending_ingestion
  ON matches (status, games_ingested_at)
  WHERE status = 'finished' AND games_ingested_at IS NULL;

-- Index for finding running/upcoming matches to poll
CREATE INDEX IF NOT EXISTS idx_matches_status_live
  ON matches (status)
  WHERE status IN ('not_started', 'running');

-- Backfill: mark existing finished matches as already ingested
-- (they were processed by the original fetch-to-postgres.js)
UPDATE matches
SET games_ingested_at = COALESCE(end_at, NOW())
WHERE status = 'finished' AND games_ingested_at IS NULL
  AND id IN (SELECT DISTINCT match_id FROM games);
