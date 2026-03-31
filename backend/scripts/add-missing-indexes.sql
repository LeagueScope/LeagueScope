-- ============================================================================
-- LeagueScope — Additional indexes for query performance
-- Run once: psql -U postgres -d leaguescope -f add-missing-indexes.sql
-- Safe to re-run (IF NOT EXISTS on all)
-- ============================================================================

-- ── game_players: most JOINed table ─────────────────────────────────────────
-- Used in: overview, champions, player-history, record, home
-- Current: game_id, player_id, team_id, champion_id (individual)
-- Missing: composite for the most common JOIN pattern (game + team)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gp_game_team
  ON game_players(game_id, team_id);

-- game_players(game_id, player_id) — used in record detail
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gp_game_player
  ON game_players(game_id, player_id);

-- game_players(player_id, champion_id) — used in player champion stats recalc
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gp_player_champion
  ON game_players(player_id, champion_id);

-- ── games: most filtered table ──────────────────────────────────────────────
-- Current: serie_id + begin_at composite, individual serie/tournament/league
-- Missing: composite for the ubiquitous (serie_id, tournament_id, finished) pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_serie_tournament_finished
  ON games(serie_id, tournament_id) WHERE finished = true;

-- ── game_teams: frequently JOINed with games ────────────────────────────────
-- Current: game_id (PK part), team_id
-- Missing: composite covering the common game+team lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gt_game_team
  ON game_teams(game_id, team_id);

-- ── champion_aliases: hot path for every champ lookup ───────────────────────
-- Current: canonical_id
-- Missing: pandascore_id (most lookups go pandascore_id → canonical)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ca_pandascore
  ON champion_aliases(pandascore_id);

-- ── player_champion_stats: used in champion profile, home ───────────────────
-- Current: serie_id, champion_id (individual)
-- Missing: composite for the common (serie_id, player_id) pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pcs_serie_player
  ON player_champion_stats(serie_id, player_id);

-- ── champion_global_stats: used in champion profile ─────────────────────────
-- Current: serie_id
-- Missing: composite (serie_id, champion_id) for direct lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cgs_serie_champion
  ON champion_global_stats(serie_id, champion_id);

-- ── player_career: used in player profile, overview ─────────────────────────
-- Current: serie_id, team_id (individual)
-- Missing: composite (serie_id, player_id) for direct lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pc_serie_player
  ON player_career(serie_id, player_id);

-- ── team_career: used in team profile ───────────────────────────────────────
-- Current: serie_id
-- Missing: composite (serie_id, team_id) for direct lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tc_serie_team
  ON team_career(serie_id, team_id);

-- ── team_brands: used everywhere via TB_JOIN ────────────────────────────────
-- Current: year_start, year_end composite
-- Missing: team_id for the JOIN condition
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tb_team
  ON team_brands(team_id);

-- ── players: name search (ILIKE in search endpoint) ─────────────────────────
-- pg_trgm extension needed for ILIKE performance
-- Run: CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Then:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_players_name_trgm
--   ON players USING GIN (name gin_trgm_ops);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_name_trgm
--   ON teams USING GIN (name gin_trgm_ops);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_teams_acronym_trgm
--   ON teams USING GIN (acronym gin_trgm_ops);

-- ── Verify ──────────────────────────────────────────────────────────────────
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
