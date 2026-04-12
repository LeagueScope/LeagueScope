-- ═══════════════════════════════════════════════════════════════════════════════
-- LeagueScope — Database Snapshot Query
-- Run this BEFORE and AFTER re-ingestion to compare state.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. ROW COUNTS PER TABLE
SELECT '═══ ROW COUNTS ═══' AS section;
SELECT 'leagues' AS tabla, COUNT(*) AS filas FROM leagues
UNION ALL SELECT 'champions', COUNT(*) FROM champions
UNION ALL SELECT 'champion_aliases', COUNT(*) FROM champion_aliases
UNION ALL SELECT 'teams', COUNT(*) FROM teams
UNION ALL SELECT 'players', COUNT(*) FROM players
UNION ALL SELECT 'items', COUNT(*) FROM items
UNION ALL SELECT 'spells', COUNT(*) FROM spells
UNION ALL SELECT 'runes', COUNT(*) FROM runes
UNION ALL SELECT 'rune_paths', COUNT(*) FROM rune_paths
UNION ALL SELECT 'series', COUNT(*) FROM series
UNION ALL SELECT 'tournaments', COUNT(*) FROM tournaments
UNION ALL SELECT 'tournament_standings', COUNT(*) FROM tournament_standings
UNION ALL SELECT 'tournament_teams', COUNT(*) FROM tournament_teams
UNION ALL SELECT 'tournament_rosters', COUNT(*) FROM tournament_rosters
UNION ALL SELECT 'matches', COUNT(*) FROM matches
UNION ALL SELECT 'match_opponents', COUNT(*) FROM match_opponents
UNION ALL SELECT 'games', COUNT(*) FROM games
UNION ALL SELECT 'game_teams', COUNT(*) FROM game_teams
UNION ALL SELECT 'game_players', COUNT(*) FROM game_players
UNION ALL SELECT 'game_picks_bans', COUNT(*) FROM game_picks_bans
UNION ALL SELECT 'game_player_runes', COUNT(*) FROM game_player_runes
UNION ALL SELECT 'game_frames', COUNT(*) FROM game_frames
UNION ALL SELECT 'game_frame_players', COUNT(*) FROM game_frame_players
UNION ALL SELECT 'game_events', COUNT(*) FROM game_events
UNION ALL SELECT 'game_event_assists', COUNT(*) FROM game_event_assists
UNION ALL SELECT 'team_brands', COUNT(*) FROM team_brands
UNION ALL SELECT '── PRECALCULATED ──', NULL
UNION ALL SELECT 'champion_global_stats', COUNT(*) FROM champion_global_stats
UNION ALL SELECT 'champion_role_stats', COUNT(*) FROM champion_role_stats
UNION ALL SELECT 'champion_top_players', COUNT(*) FROM champion_top_players
UNION ALL SELECT 'champion_matchups', COUNT(*) FROM champion_matchups
UNION ALL SELECT 'champion_items', COUNT(*) FROM champion_items
UNION ALL SELECT 'champion_keystones', COUNT(*) FROM champion_keystones
UNION ALL SELECT 'champion_patch_stats', COUNT(*) FROM champion_patch_stats
UNION ALL SELECT 'player_career', COUNT(*) FROM player_career
UNION ALL SELECT 'player_keystones', COUNT(*) FROM player_keystones
UNION ALL SELECT 'team_career', COUNT(*) FROM team_career
UNION ALL SELECT 'player_champion_stats', COUNT(*) FROM player_champion_stats
ORDER BY tabla;

-- 2. PRECALCULATED TABLES COVERAGE (series with data vs series with matches)
SELECT '═══ COVERAGE ═══' AS section;
WITH total AS (
  SELECT COUNT(DISTINCT serie_id) AS total_series
  FROM matches WHERE games_ingested_at IS NOT NULL AND serie_id IS NOT NULL
)
SELECT
  t.total_series AS series_con_partidas,
  (SELECT COUNT(DISTINCT serie_id) FROM team_career) AS series_en_team_career,
  (SELECT COUNT(DISTINCT serie_id) FROM player_career) AS series_en_player_career,
  (SELECT COUNT(DISTINCT serie_id) FROM champion_global_stats) AS series_en_champion_global,
  (SELECT COUNT(DISTINCT serie_id) FROM player_champion_stats) AS series_en_player_champ
FROM total t;

-- 3. RATIO vs PERCENTAGE QUICK CHECK (should return 0 rows if all fixed)
-- NOTE: Only flags values < 1 when denominator <= 100, since with >100 games
-- legitimate small percentages < 1% are possible (e.g. 1 event in 108 games = 0.926%)
SELECT '═══ RATIO BUG CHECK ═══' AS section;
SELECT 'team_career.win_rate' AS campo, COUNT(*) AS ratios_detectados
FROM team_career WHERE games > 1 AND games <= 100 AND win_rate > 0 AND win_rate < 1
UNION ALL
SELECT 'team_career.first_blood_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_blood_rate > 0 AND first_blood_rate < 1
UNION ALL
SELECT 'team_career.first_dragon_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_dragon_rate > 0 AND first_dragon_rate < 1
UNION ALL
SELECT 'team_career.first_tower_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_tower_rate > 0 AND first_tower_rate < 1
UNION ALL
SELECT 'team_career.first_baron_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_baron_rate > 0 AND first_baron_rate < 1
UNION ALL
SELECT 'team_career.first_herald_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_herald_rate > 0 AND first_herald_rate < 1
UNION ALL
SELECT 'team_career.first_voidgrub_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_voidgrub_rate > 0 AND first_voidgrub_rate < 1
UNION ALL
SELECT 'team_career.first_atakhan_rate', COUNT(*)
FROM team_career WHERE games > 2 AND games <= 100 AND first_atakhan_rate > 0 AND first_atakhan_rate < 1
UNION ALL
SELECT 'player_career.win_rate', COUNT(*)
FROM player_career WHERE games > 1 AND games <= 100 AND win_rate > 0 AND win_rate < 1
UNION ALL
SELECT 'player_career.first_blood_rate', COUNT(*)
FROM player_career WHERE games > 2 AND games <= 100 AND first_blood_rate > 0 AND first_blood_rate < 1
UNION ALL
SELECT 'player_career.kill_participation', COUNT(*)
FROM player_career WHERE games > 2 AND games <= 100 AND kill_participation > 0 AND kill_participation < 1
UNION ALL
SELECT 'champion_global_stats.win_rate', COUNT(*)
FROM champion_global_stats WHERE picks > 2 AND picks <= 100 AND win_rate > 0 AND win_rate < 1
UNION ALL
SELECT 'champion_global_stats.ban_rate_blue', COUNT(*)
FROM champion_global_stats WHERE bans_blue > 0 AND total_games_in_serie <= 100 AND ban_rate_blue > 0 AND ban_rate_blue < 1
UNION ALL
SELECT 'champion_global_stats.ban_rate_red', COUNT(*)
FROM champion_global_stats WHERE bans_red > 0 AND total_games_in_serie <= 100 AND ban_rate_red > 0 AND ban_rate_red < 1
UNION ALL
SELECT 'champion_global_stats.kill_participation', COUNT(*)
FROM champion_global_stats WHERE picks > 2 AND picks <= 100 AND kill_participation > 0 AND kill_participation < 1
UNION ALL
SELECT 'champion_global_stats.fb_rate', COUNT(*)
FROM champion_global_stats WHERE picks > 2 AND picks <= 100 AND fb_rate > 0 AND fb_rate < 1
UNION ALL
SELECT 'player_champion_stats.win_rate', COUNT(*)
FROM player_champion_stats WHERE games > 1 AND games <= 100 AND win_rate > 0 AND win_rate < 1
UNION ALL
SELECT 'player_champion_stats.kill_participation', COUNT(*)
FROM player_champion_stats WHERE games > 2 AND games <= 100 AND kill_participation > 0 AND kill_participation < 1;

-- 4. SAMPLE DATA SPOT CHECK — LEC latest serie
SELECT '═══ LEC SPOT CHECK ═══' AS section;
WITH lec_serie AS (
  SELECT s.id, s.full_name, s.year, s.season
  FROM series s JOIN leagues l ON l.id = s.league_id
  WHERE l.slug = 'lec' ORDER BY s.begin_at DESC LIMIT 1
)
SELECT
  ls.id AS serie_id, ls.full_name,
  (SELECT COUNT(*) FROM games WHERE serie_id = ls.id AND finished = true) AS games_raw,
  (SELECT COUNT(*) FROM team_career WHERE serie_id = ls.id) AS teams_en_tc,
  (SELECT COUNT(*) FROM player_career WHERE serie_id = ls.id) AS players_en_pc,
  (SELECT COUNT(*) FROM champion_global_stats WHERE serie_id = ls.id) AS champs_en_cgs,
  (SELECT COUNT(*) FROM player_champion_stats WHERE serie_id = ls.id) AS pcs_rows
FROM lec_serie ls;

-- 5. SAMPLE: team_career values for LEC top team (verify percentages not ratios)
SELECT '═══ LEC TOP TEAM SAMPLE ═══' AS section;
SELECT tc.team_id, t.acronym, tc.games, tc.wins, tc.losses,
       tc.win_rate, tc.first_blood_rate, tc.first_tower_rate,
       tc.first_dragon_rate, tc.first_baron_rate, tc.first_herald_rate
FROM team_career tc
JOIN teams t ON t.id = tc.team_id
WHERE tc.serie_id = (
  SELECT s.id FROM series s JOIN leagues l ON l.id = s.league_id
  WHERE l.slug = 'lec' ORDER BY s.begin_at DESC LIMIT 1
)
ORDER BY tc.wins DESC
LIMIT 5;

-- 6. SAMPLE: champion_global_stats for LEC (verify picks = blue+red, percentages)
SELECT '═══ LEC CHAMPION SAMPLE ═══' AS section;
SELECT champion_name, picks, blue_picks, red_picks,
       (blue_picks + red_picks) AS picks_check,
       wins, win_rate, bans, bans_blue, bans_red,
       ban_rate_blue, ban_rate_red, kill_participation, fb_rate
FROM champion_global_stats
WHERE serie_id = (
  SELECT s.id FROM series s JOIN leagues l ON l.id = s.league_id
  WHERE l.slug = 'lec' ORDER BY s.begin_at DESC LIMIT 1
)
ORDER BY picks DESC
LIMIT 10;
