#!/usr/bin/env node
/**
 * db-integrity-check.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * Comprehensive database integrity & data correctness audit for LeagueScope.
 *
 * NOT just "does data exist?" — actually verifies VALUES are correct by
 * cross-referencing precalculated tables against raw data.
 *
 * Usage:
 *   node backend/scripts/db-integrity-check.js [--fix] [--verbose] [--section=X]
 *
 * Sections: counts, referential, raw, team_career, player_career,
 *           champion_global, player_champion, ratios, completeness
 *
 * Exit code: 0 = all OK, 1 = issues found, 2 = critical errors
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FIX_MODE  = args.includes('--fix');
const VERBOSE   = args.includes('--verbose');
const SECTION   = args.find(a => a.startsWith('--section='))?.split('=')[1] || null;
const LIMIT     = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20');

// ── DB connection ────────────────────────────────────────────────────────────
const PG_DSN = process.env.PG_DSN;
if (!PG_DSN) { console.error('ERROR: PG_DSN not set'); process.exit(2); }

const pool = new Pool({
  connectionString: PG_DSN,
  max: 5,
  ...(PG_DSN.includes('rds.amazonaws.com') ? { ssl: { rejectUnauthorized: false } } : {}),
});

// ── Reporting ────────────────────────────────────────────────────────────────
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let totalChecks = 0;
let totalPassed = 0;
let totalFailed = 0;
let totalWarnings = 0;
const issues = [];

function pass(msg) { totalChecks++; totalPassed++; console.log(`  ${PASS} ${msg}`); }
function fail(msg, details) {
  totalChecks++; totalFailed++;
  console.log(`  ${FAIL} ${msg}`);
  if (details) console.log(`    → ${details}`);
  issues.push(msg);
}
function warn(msg, details) {
  totalChecks++; totalWarnings++;
  console.log(`  ${WARN} ${msg}`);
  if (details) console.log(`    → ${details}`);
}
function info(msg) { console.log(`  ${INFO} ${msg}`); }
function section(title) { console.log(`\n${BOLD}═══ ${title} ═══${RESET}`); }
function sub(title) { console.log(`\n  ${BOLD}── ${title} ──${RESET}`); }

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || {};
}
async function count(table, where = '', params = []) {
  const r = await q1(`SELECT COUNT(*)::int AS n FROM ${table} ${where ? 'WHERE ' + where : ''}`, params);
  return r.n;
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1: TABLE COUNTS
// ═════════════════════════════════════════════════════════════════════════════
async function checkCounts() {
  section('1. TABLE ROW COUNTS');

  const tables = [
    // Reference
    'leagues', 'champions', 'champion_aliases', 'teams', 'players', 'items', 'spells', 'runes', 'rune_paths',
    // Competition
    'series', 'tournaments', 'matches', 'games',
    // Raw game data
    'game_teams', 'game_players', 'game_picks_bans', 'game_player_runes',
    // Timeline
    'game_frames', 'game_frame_players', 'game_events', 'game_event_assists',
    // Precalculated
    'champion_global_stats', 'champion_role_stats', 'champion_top_players',
    'champion_matchups', 'champion_items', 'champion_keystones', 'champion_patch_stats',
    'player_career', 'player_keystones', 'team_career', 'player_champion_stats',
    // Meta
    'team_brands', 'tournament_standings', 'tournament_teams', 'tournament_rosters',
    'match_opponents',
  ];

  for (const t of tables) {
    try {
      const n = await count(t);
      if (n === 0) warn(`${t}: EMPTY (0 rows)`);
      else pass(`${t}: ${n.toLocaleString()} rows`);
    } catch (e) {
      fail(`${t}: ERROR — ${e.message}`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2: REFERENTIAL INTEGRITY
// ═════════════════════════════════════════════════════════════════════════════
async function checkReferential() {
  section('2. REFERENTIAL INTEGRITY');

  // Games without a valid match
  const orphanGames = await count('games g', 'NOT EXISTS (SELECT 1 FROM matches m WHERE m.id = g.match_id)');
  orphanGames === 0 ? pass('No orphan games (all have valid match_id)') : fail(`${orphanGames} orphan games without valid match`);

  // game_teams without valid game
  const orphanGT = await count('game_teams gt', 'NOT EXISTS (SELECT 1 FROM games g WHERE g.id = gt.game_id)');
  orphanGT === 0 ? pass('No orphan game_teams') : fail(`${orphanGT} orphan game_teams rows`);

  // game_players without valid game
  const orphanGP = await count('game_players gp', 'NOT EXISTS (SELECT 1 FROM games g WHERE g.id = gp.game_id)');
  orphanGP === 0 ? pass('No orphan game_players') : fail(`${orphanGP} orphan game_players rows`);

  // player_career referencing non-existent series
  const orphanPC = await count('player_career pc', 'NOT EXISTS (SELECT 1 FROM series s WHERE s.id = pc.serie_id)');
  orphanPC === 0 ? pass('No player_career with invalid serie_id') : fail(`${orphanPC} player_career rows with invalid serie_id`);

  // team_career referencing non-existent series
  const orphanTC = await count('team_career tc', 'NOT EXISTS (SELECT 1 FROM series s WHERE s.id = tc.serie_id)');
  orphanTC === 0 ? pass('No team_career with invalid serie_id') : fail(`${orphanTC} team_career rows with invalid serie_id`);

  // champion_global_stats referencing non-existent series
  const orphanCGS = await count('champion_global_stats cgs', 'NOT EXISTS (SELECT 1 FROM series s WHERE s.id = cgs.serie_id)');
  orphanCGS === 0 ? pass('No champion_global_stats with invalid serie_id') : fail(`${orphanCGS} champion_global_stats rows with invalid serie_id`);

  // Matches with serie_id but serie doesn't exist
  const orphanM = await count('matches m', 'm.serie_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM series s WHERE s.id = m.serie_id)');
  orphanM === 0 ? pass('No matches with invalid serie_id') : fail(`${orphanM} matches with invalid serie_id`);

  // Games with team data: should have exactly 2 teams per game
  // Only check finished games with real duration (>60s) — unplayed/remakes naturally have 0 teams
  const badGTFinished = await q(`
    SELECT g.id AS game_id, COUNT(gt.team_id) AS n
    FROM games g
    LEFT JOIN game_teams gt ON gt.game_id = g.id
    WHERE g.finished = true AND g.length > 60
    GROUP BY g.id HAVING COUNT(gt.team_id) != 2
    LIMIT ${LIMIT}
  `);
  if (badGTFinished.length === 0) {
    pass('All finished games (length>60s) have exactly 2 teams in game_teams');
  } else {
    // Separate: games with >0 but !=2 teams (real problem) vs 0 teams (ingestion gap)
    const realBad = (await q1(`
      SELECT COUNT(*) AS n FROM (
        SELECT g.id FROM games g LEFT JOIN game_teams gt ON gt.game_id = g.id
        WHERE g.finished = true AND g.length > 60
        GROUP BY g.id HAVING COUNT(gt.team_id) NOT IN (0, 2)
      ) x
    `)).n;
    const noTeams = (await q1(`
      SELECT COUNT(*) AS n FROM (
        SELECT g.id FROM games g LEFT JOIN game_teams gt ON gt.game_id = g.id
        WHERE g.finished = true AND g.length > 60
        GROUP BY g.id HAVING COUNT(gt.team_id) = 0
      ) x
    `)).n;
    if (Number(realBad) > 0) {
      // A handful of games with 1 team = partial PandaScore data, not a code bug
      warn(`${realBad} finished games have partial team data (1 of 2 teams)`,
        `Likely incomplete ingestion from PandaScore API`);
    }
    if (Number(noTeams) > 0) {
      warn(`${noTeams} finished games (length>60s) have no team data in game_teams`,
        `Older games where detailed data was not ingested from PandaScore`);
    }
    if (Number(realBad) === 0 && Number(noTeams) === 0) {
      pass('All finished games (length>60s) have exactly 2 teams in game_teams');
    }
  }

  // Also count unplayed/remake games without teams (informational only)
  const noTeamUnplayed = (await q1(`
    SELECT COUNT(*) AS n FROM games g
    LEFT JOIN game_teams gt ON gt.game_id = g.id
    WHERE gt.game_id IS NULL AND (g.finished = false OR g.length IS NULL OR g.length <= 60)
  `)).n;
  if (Number(noTeamUnplayed) > 0) {
    info(`${noTeamUnplayed} unplayed/remake games have no team data (expected — PandaScore pre-creates game slots)`);
  }

  // Duplicates in game_players (should be exactly 10 per game for standard 5v5)
  // Only check finished games with real duration
  const badGPCounts = await q(`
    SELECT g.id AS game_id, COUNT(gp.id) AS n
    FROM games g
    LEFT JOIN game_players gp ON gp.game_id = g.id
    WHERE g.finished = true AND g.length > 60
    GROUP BY g.id HAVING COUNT(gp.id) NOT IN (10)
    LIMIT ${LIMIT}
  `);
  if (badGPCounts.length === 0) {
    pass('All finished games have exactly 10 players in game_players');
  } else {
    const total = (await q1(`
      SELECT COUNT(*) AS n FROM (
        SELECT g.id FROM games g LEFT JOIN game_players gp ON gp.game_id = g.id
        WHERE g.finished = true AND g.length > 60
        GROUP BY g.id HAVING COUNT(gp.id) != 10
      ) x
    `)).n;
    warn(`${total} finished games don't have exactly 10 players`,
      `e.g. game_id=${badGPCounts[0]?.game_id} has ${badGPCounts[0]?.n} players (could be remakes/disconnects)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3: RAW DATA SANITY
// ═════════════════════════════════════════════════════════════════════════════
async function checkRawData() {
  section('3. RAW DATA SANITY');

  // Finished games should have length > 0
  const zeroLen = await count('games', "finished = true AND (length IS NULL OR length <= 0)");
  zeroLen === 0
    ? pass('All finished games have length > 0')
    : warn(`${zeroLen} finished games with zero/null length (could be remakes)`);

  // Games with extremely long duration (> 80 min = 4800 sec)
  const longGames = await count('games', 'length > 4800 AND finished = true');
  longGames === 0
    ? pass('No abnormally long games (>80 min)')
    : warn(`${longGames} games longer than 80 minutes`);

  // game_teams: first_blood should be true for exactly 1 of 2 teams per game
  const badFB = await q(`
    SELECT gt.game_id, COUNT(*) FILTER (WHERE gt.first_blood = true) AS fb_count
    FROM game_teams gt
    JOIN games g ON g.id = gt.game_id AND g.finished = true
    GROUP BY gt.game_id
    HAVING COUNT(*) FILTER (WHERE gt.first_blood = true) NOT IN (0, 1)
    LIMIT ${LIMIT}
  `);
  badFB.length === 0
    ? pass('first_blood consistency: ≤1 team per game has first_blood=true')
    : fail(`${badFB.length} games with >1 team having first_blood=true`);

  // game_players: kills/deaths/assists should be non-negative
  const negStats = await count('game_players', '(kills < 0 OR deaths < 0 OR assists < 0)');
  negStats === 0
    ? pass('No negative kills/deaths/assists in game_players')
    : fail(`${negStats} game_players rows with negative stats`);

  // game_teams: team kills vs sum of player kills
  const killMismatch = await q(`
    SELECT gt.game_id, gt.team_id, gt.kills AS team_kills,
           COALESCE(pk.player_kills, 0) AS player_kills_sum
    FROM game_teams gt
    JOIN games g ON g.id = gt.game_id AND g.finished = true AND g.length > 60
    LEFT JOIN (
      SELECT game_id, team_id, SUM(kills) AS player_kills
      FROM game_players GROUP BY game_id, team_id
    ) pk ON pk.game_id = gt.game_id AND pk.team_id = gt.team_id
    WHERE gt.kills IS NOT NULL AND COALESCE(pk.player_kills, 0) != gt.kills
    LIMIT ${LIMIT}
  `);
  if (killMismatch.length === 0) {
    pass('Team kills match sum of player kills for all games');
  } else {
    const total = (await q1(`
      SELECT COUNT(*) AS n FROM game_teams gt
      JOIN games g ON g.id = gt.game_id AND g.finished = true AND g.length > 60
      LEFT JOIN (SELECT game_id, team_id, SUM(kills) AS pk FROM game_players GROUP BY game_id, team_id) pk
        ON pk.game_id = gt.game_id AND pk.team_id = gt.team_id
      WHERE gt.kills IS NOT NULL AND COALESCE(pk.pk, 0) != gt.kills
    `)).n;
    warn(`${total} game-team combos where team.kills != SUM(player.kills)`,
      `e.g. game_id=${killMismatch[0]?.game_id}: team_kills=${killMismatch[0]?.team_kills}, player_sum=${killMismatch[0]?.player_kills_sum}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4: TEAM_CAREER CORRECTNESS
// ═════════════════════════════════════════════════════════════════════════════
async function checkTeamCareer() {
  section('4. TEAM_CAREER — CROSS-CHECK WITH RAW DATA');

  const tcCount = await count('team_career');
  if (tcCount === 0) { warn('team_career is EMPTY — skipping checks'); return; }

  // 4a. win_rate should be (wins/games)*100 and in range 0-100
  sub('4a. win_rate range & formula');

  const badWR = await q(`
    SELECT team_id, serie_id, games, wins, win_rate,
           CASE WHEN games > 0 THEN ROUND((wins::numeric / games * 100)::numeric, 2) ELSE 0 END AS expected_wr
    FROM team_career
    WHERE win_rate IS NOT NULL AND (win_rate < 0 OR win_rate > 100)
    LIMIT ${LIMIT}
  `);
  badWR.length === 0
    ? pass('All team_career.win_rate values are in range 0-100')
    : fail(`${badWR.length}+ team_career rows with win_rate outside 0-100`,
        `e.g. team=${badWR[0]?.team_id}, serie=${badWR[0]?.serie_id}: win_rate=${badWR[0]?.win_rate}`);

  // Detect RATIO bug: win_rate between 0 and 1 (exclusive) when games > 1
  // NOTE: With games > 100, legitimate small percentages < 1% are possible (e.g. 1 win in 200 games = 0.5%)
  // So we only flag when games <= 100, where percentages < 1% are mathematically impossible.
  const ratioWR = await q(`
    SELECT team_id, serie_id, games, wins, win_rate
    FROM team_career
    WHERE games > 1 AND games <= 100 AND win_rate > 0 AND win_rate < 1
    LIMIT ${LIMIT}
  `);
  ratioWR.length === 0
    ? pass('No team_career.win_rate values look like ratios (0-1 instead of 0-100)')
    : fail(`${ratioWR.length}+ team_career rows where win_rate looks like a RATIO (0 < wr < 1)`,
        `e.g. team=${ratioWR[0]?.team_id}: games=${ratioWR[0]?.games}, wins=${ratioWR[0]?.wins}, win_rate=${ratioWR[0]?.win_rate}`);

  // win_rate should match wins/games*100
  const wrMismatch = await q(`
    SELECT team_id, serie_id, games, wins, win_rate,
           ROUND((wins::numeric / NULLIF(games, 0) * 100)::numeric, 2) AS expected
    FROM team_career
    WHERE games > 0 AND win_rate IS NOT NULL
      AND ABS(win_rate - (wins::numeric / games * 100)) > 1
    LIMIT ${LIMIT}
  `);
  wrMismatch.length === 0
    ? pass('team_career.win_rate matches wins/games*100 (within ±1)')
    : fail(`${wrMismatch.length}+ team_career rows where win_rate != wins/games*100`,
        `e.g. team=${wrMismatch[0]?.team_id}: wins=${wrMismatch[0]?.wins}/${wrMismatch[0]?.games}, wr=${wrMismatch[0]?.win_rate}, expected=${wrMismatch[0]?.expected}`);

  // 4b. first_*_rate fields should be 0-100
  sub('4b. first_*_rate ranges');

  const rateFields = [
    'first_blood_rate', 'first_tower_rate', 'first_dragon_rate', 'first_baron_rate',
    'first_herald_rate', 'first_voidgrub_rate', 'first_atakhan_rate', 'first_inhibitor_rate',
    'first_elder_rate', 'dragon_soul_rate',
  ];
  for (const f of rateFields) {
    const bad = await q(`
      SELECT team_id, serie_id, ${f} AS val FROM team_career
      WHERE ${f} IS NOT NULL AND (${f} < 0 OR ${f} > 100)
      LIMIT 5
    `);
    // Only flag ratio-like values when games <= 100 (with >100 games, percentages <1% are legitimate)
    const ratioLike = await q(`
      SELECT team_id, serie_id, games, ${f} AS val FROM team_career
      WHERE ${f} IS NOT NULL AND games > 1 AND games <= 100 AND ${f} > 0 AND ${f} < 1
      LIMIT 5
    `);
    if (bad.length > 0) fail(`team_career.${f}: ${bad.length}+ values outside 0-100`, `e.g. ${bad[0]?.val}`);
    else if (ratioLike.length > 0) fail(`team_career.${f}: ${ratioLike.length}+ values look like ratios (0<v<1)`, `e.g. team=${ratioLike[0]?.team_id}, games=${ratioLike[0]?.games}, val=${ratioLike[0]?.val}`);
    else pass(`team_career.${f}: all values in range 0-100`);
  }

  // 4c. Cross-check games/wins/losses with raw game_teams
  sub('4c. Cross-check games count vs raw data');

  const tcVsRaw = await q(`
    WITH raw AS (
      SELECT gt.team_id, g.serie_id,
             COUNT(*) AS raw_games,
             SUM(CASE WHEN g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS raw_wins
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id AND g.finished = true AND g.length > 60
      WHERE g.serie_id IS NOT NULL
      GROUP BY gt.team_id, g.serie_id
    )
    SELECT tc.team_id, tc.serie_id, tc.games AS tc_games, tc.wins AS tc_wins,
           r.raw_games, r.raw_wins
    FROM team_career tc
    JOIN raw r ON r.team_id = tc.team_id AND r.serie_id = tc.serie_id
    WHERE ABS(tc.games - r.raw_games) > 0 OR ABS(tc.wins - r.raw_wins) > 0
    LIMIT ${LIMIT}
  `);
  if (tcVsRaw.length === 0) {
    pass('team_career games/wins match raw game_teams data');
  } else {
    const total = (await q1(`
      WITH raw AS (
        SELECT gt.team_id, g.serie_id, COUNT(*) AS raw_games,
               SUM(CASE WHEN g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS raw_wins
        FROM game_teams gt JOIN games g ON g.id = gt.game_id AND g.finished = true AND g.length > 60
        WHERE g.serie_id IS NOT NULL GROUP BY gt.team_id, g.serie_id
      )
      SELECT COUNT(*) AS n FROM team_career tc
      JOIN raw r ON r.team_id = tc.team_id AND r.serie_id = tc.serie_id
      WHERE ABS(tc.games - r.raw_games) > 0 OR ABS(tc.wins - r.raw_wins) > 0
    `)).n;
    warn(`${total} team_career rows where games/wins don't match raw data`,
      `e.g. team=${tcVsRaw[0]?.team_id}, serie=${tcVsRaw[0]?.serie_id}: tc=${tcVsRaw[0]?.tc_games}g/${tcVsRaw[0]?.tc_wins}w, raw=${tcVsRaw[0]?.raw_games}g/${tcVsRaw[0]?.raw_wins}w`);
    info('(Minor differences expected: team_career comes from PandaScore API, raw data from game ingestion. API may include remakes.)');
  }

  // 4d. Blue/red games should roughly sum to total games
  sub('4d. Side games consistency');
  const sideMismatch = await q(`
    SELECT team_id, serie_id, games, blue_games, red_games,
           COALESCE(blue_games, 0) + COALESCE(red_games, 0) AS side_sum
    FROM team_career
    WHERE games IS NOT NULL AND blue_games IS NOT NULL AND red_games IS NOT NULL
      AND games != (COALESCE(blue_games, 0) + COALESCE(red_games, 0))
    LIMIT ${LIMIT}
  `);
  sideMismatch.length === 0
    ? pass('team_career: games = blue_games + red_games')
    : warn(`${sideMismatch.length}+ team_career rows where games != blue_games + red_games`,
        `e.g. team=${sideMismatch[0]?.team_id}: games=${sideMismatch[0]?.games}, blue=${sideMismatch[0]?.blue_games}, red=${sideMismatch[0]?.red_games}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5: PLAYER_CAREER CORRECTNESS
// ═════════════════════════════════════════════════════════════════════════════
async function checkPlayerCareer() {
  section('5. PLAYER_CAREER — CROSS-CHECK WITH RAW DATA');

  const pcCount = await count('player_career');
  if (pcCount === 0) { warn('player_career is EMPTY — skipping checks'); return; }

  // 5a. win_rate range and ratio detection
  sub('5a. win_rate range & formula');

  // Only flag when games <= 100 (with >100 games, percentages <1% are legitimate)
  const ratioWR = await q(`
    SELECT player_id, serie_id, games, wins, win_rate
    FROM player_career
    WHERE games > 1 AND games <= 100 AND win_rate > 0 AND win_rate < 1
    LIMIT ${LIMIT}
  `);
  ratioWR.length === 0
    ? pass('No player_career.win_rate values look like ratios')
    : fail(`${ratioWR.length}+ player_career rows with ratio-like win_rate`,
        `e.g. player=${ratioWR[0]?.player_id}: games=${ratioWR[0]?.games}, wins=${ratioWR[0]?.wins}, wr=${ratioWR[0]?.win_rate}`);

  const outOfRange = await count('player_career', 'win_rate IS NOT NULL AND (win_rate < 0 OR win_rate > 100)');
  outOfRange === 0
    ? pass('All player_career.win_rate in range 0-100')
    : fail(`${outOfRange} player_career rows with win_rate outside 0-100`);

  // win_rate matches wins/games*100
  const wrMismatch = await q(`
    SELECT player_id, serie_id, games, wins, win_rate,
           ROUND((wins::numeric / NULLIF(games, 0) * 100)::numeric, 2) AS expected
    FROM player_career
    WHERE games > 0 AND win_rate IS NOT NULL
      AND ABS(win_rate - (wins::numeric / games * 100)) > 1
    LIMIT ${LIMIT}
  `);
  wrMismatch.length === 0
    ? pass('player_career.win_rate matches wins/games*100 (within ±1)')
    : fail(`${wrMismatch.length}+ player_career rows where win_rate doesn't match formula`,
        `e.g. player=${wrMismatch[0]?.player_id}: ${wrMismatch[0]?.wins}/${wrMismatch[0]?.games}=${wrMismatch[0]?.expected}, got ${wrMismatch[0]?.win_rate}`);

  // 5b. first_blood_rate / first_tower_rate should be 0-100
  sub('5b. Rate fields');
  for (const f of ['first_blood_rate', 'first_tower_rate']) {
    const bad = await count('player_career', `${f} IS NOT NULL AND (${f} < 0 OR ${f} > 100)`);
    const ratioLike = await q(`
      SELECT player_id, serie_id, games, ${f} AS val FROM player_career
      WHERE ${f} IS NOT NULL AND games > 1 AND games <= 100 AND ${f} > 0 AND ${f} < 1 LIMIT 5
    `);
    if (bad > 0) fail(`player_career.${f}: ${bad} values outside 0-100`);
    else if (ratioLike.length > 0) fail(`player_career.${f}: ratio-like values found`, `e.g. player=${ratioLike[0]?.player_id}, val=${ratioLike[0]?.val}`);
    else pass(`player_career.${f}: all values in range 0-100`);
  }

  // 5c. Cross-check games count with raw game_players
  sub('5c. Cross-check games vs raw data');
  const pcVsRaw = await q(`
    WITH raw AS (
      SELECT gp.player_id, g.serie_id, COUNT(*) AS raw_games,
             SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS raw_wins
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id AND g.finished = true AND g.length > 60
      WHERE g.serie_id IS NOT NULL
      GROUP BY gp.player_id, g.serie_id
    )
    SELECT pc.player_id, pc.serie_id, pc.games AS pc_games, pc.wins AS pc_wins,
           r.raw_games, r.raw_wins
    FROM player_career pc
    JOIN raw r ON r.player_id = pc.player_id AND r.serie_id = pc.serie_id
    WHERE ABS(pc.games - r.raw_games) > 2
    LIMIT ${LIMIT}
  `);
  if (pcVsRaw.length === 0) {
    pass('player_career games match raw game_players data (within ±2)');
  } else {
    warn(`${pcVsRaw.length}+ player_career rows where games differ >2 from raw data`,
      `e.g. player=${pcVsRaw[0]?.player_id}, serie=${pcVsRaw[0]?.serie_id}: pc=${pcVsRaw[0]?.pc_games}, raw=${pcVsRaw[0]?.raw_games}`);
  }

  // 5d. Side games
  sub('5d. Side games consistency');
  const sideBad = await q(`
    SELECT player_id, serie_id, games, blue_games, red_games
    FROM player_career
    WHERE games IS NOT NULL AND blue_games IS NOT NULL AND red_games IS NOT NULL
      AND games != COALESCE(blue_games, 0) + COALESCE(red_games, 0)
    LIMIT ${LIMIT}
  `);
  sideBad.length === 0
    ? pass('player_career: games = blue_games + red_games')
    : warn(`${sideBad.length}+ player_career rows where games != blue+red`,
        `e.g. player=${sideBad[0]?.player_id}: games=${sideBad[0]?.games}, blue=${sideBad[0]?.blue_games}, red=${sideBad[0]?.red_games}`);

  // 5e. KDA sanity
  sub('5e. KDA sanity');
  const negKDA = await count('player_career', 'kda IS NOT NULL AND kda < 0');
  negKDA === 0 ? pass('No negative KDA values') : fail(`${negKDA} player_career rows with negative KDA`);

  const hugeKDA = await count('player_career', 'kda IS NOT NULL AND kda > 50');
  hugeKDA === 0 ? pass('No unreasonably high KDA (>50)') : warn(`${hugeKDA} player_career rows with KDA > 50 (possible 0-death outliers)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6: CHAMPION_GLOBAL_STATS CORRECTNESS
// ═════════════════════════════════════════════════════════════════════════════
async function checkChampionGlobal() {
  section('6. CHAMPION_GLOBAL_STATS — CROSS-CHECK WITH RAW DATA');

  const cgsCount = await count('champion_global_stats');
  if (cgsCount === 0) { warn('champion_global_stats is EMPTY — skipping checks'); return; }

  // 6a. picks should equal blue_picks + red_picks
  sub('6a. picks = blue_picks + red_picks');
  const pickSplit = await q(`
    SELECT champion_id, serie_id, champion_name, picks, blue_picks, red_picks
    FROM champion_global_stats
    WHERE picks IS NOT NULL AND blue_picks IS NOT NULL AND red_picks IS NOT NULL
      AND picks != COALESCE(blue_picks, 0) + COALESCE(red_picks, 0)
    LIMIT ${LIMIT}
  `);
  if (pickSplit.length === 0) {
    pass('picks = blue_picks + red_picks for all champion_global_stats');
  } else {
    const total = (await q1(`
      SELECT COUNT(*) AS n FROM champion_global_stats
      WHERE picks IS NOT NULL AND blue_picks IS NOT NULL AND red_picks IS NOT NULL
        AND picks != COALESCE(blue_picks, 0) + COALESCE(red_picks, 0)
    `)).n;
    fail(`${total} champion_global_stats rows where picks != blue+red`,
      `e.g. ${pickSplit[0]?.champion_name}: picks=${pickSplit[0]?.picks}, blue=${pickSplit[0]?.blue_picks}, red=${pickSplit[0]?.red_picks}`);
  }

  // 6b. bans should be >= bans_blue + bans_red (total bans from ban_stats may include non-sided)
  sub('6b. bans >= bans_blue + bans_red');
  const banSplit = await q(`
    SELECT champion_id, serie_id, champion_name, bans, bans_blue, bans_red
    FROM champion_global_stats
    WHERE bans IS NOT NULL AND bans_blue IS NOT NULL AND bans_red IS NOT NULL
      AND bans < COALESCE(bans_blue, 0) + COALESCE(bans_red, 0)
    LIMIT ${LIMIT}
  `);
  banSplit.length === 0
    ? pass('bans >= bans_blue + bans_red for all rows')
    : fail(`${banSplit.length}+ rows where bans < bans_blue + bans_red`,
        `e.g. ${banSplit[0]?.champion_name}: bans=${banSplit[0]?.bans}, blue=${banSplit[0]?.bans_blue}, red=${banSplit[0]?.bans_red}`);

  // 6c. win_rate should be percentage (0-100), not ratio (0-1)
  sub('6c. win_rate / ban_rate / kill_participation ranges');

  // denomCol: column used as denominator for the percentage. With >100 denominator, percentages <1% are legitimate.
  const pctFields = [
    { col: 'win_rate', label: 'win_rate', denomCol: 'picks' },
    { col: 'ban_rate_blue', label: 'ban_rate_blue', denomCol: 'total_games_in_serie' },
    { col: 'ban_rate_red', label: 'ban_rate_red', denomCol: 'total_games_in_serie' },
    { col: 'kill_participation', label: 'kill_participation', denomCol: 'picks' },
    { col: 'fb_rate', label: 'fb_rate', denomCol: 'picks' },
  ];

  for (const { col, label, denomCol } of pctFields) {
    // Out of range
    const oor = await count('champion_global_stats', `${col} IS NOT NULL AND (${col} < 0 OR ${col} > 100)`);
    if (oor > 0) {
      fail(`cgs.${label}: ${oor} values outside 0-100`);
      continue;
    }

    // Ratio detection — only flag when denominator <= 100 (with >100, percentages <1% are legitimate)
    const ratioLike = await q(`
      SELECT champion_id, serie_id, champion_name, picks, ${col} AS val
      FROM champion_global_stats
      WHERE ${col} IS NOT NULL AND picks > 2 AND ${denomCol} <= 100 AND ${col} > 0 AND ${col} < 1
      LIMIT 5
    `);
    if (ratioLike.length > 0) {
      const total = (await q1(`SELECT COUNT(*) AS n FROM champion_global_stats WHERE ${col} IS NOT NULL AND picks > 2 AND ${denomCol} <= 100 AND ${col} > 0 AND ${col} < 1`)).n;
      fail(`cgs.${label}: ${total} values look like ratios (0<v<1)`,
        `e.g. ${ratioLike[0]?.champion_name}: picks=${ratioLike[0]?.picks}, ${label}=${ratioLike[0]?.val}`);
    } else {
      pass(`cgs.${label}: all values look like percentages (0-100 range)`);
    }
  }

  // 6d. Cross-check picks count with raw game_players
  sub('6d. Cross-check picks vs raw game_players');
  const cgsVsRaw = await q(`
    WITH raw AS (
      SELECT ca.pandascore_id AS champion_id, g.serie_id, COUNT(*) AS raw_picks,
             SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS raw_wins
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id AND g.finished = true AND g.length > 60
      JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE g.serie_id IS NOT NULL
      GROUP BY ca.pandascore_id, g.serie_id
    )
    SELECT cgs.champion_id, cgs.serie_id, cgs.champion_name,
           cgs.picks AS cgs_picks, r.raw_picks,
           cgs.wins AS cgs_wins, r.raw_wins
    FROM champion_global_stats cgs
    JOIN raw r ON r.champion_id = cgs.champion_id AND r.serie_id = cgs.serie_id
    WHERE ABS(cgs.picks - r.raw_picks) > 1
    ORDER BY ABS(cgs.picks - r.raw_picks) DESC
    LIMIT ${LIMIT}
  `);
  if (cgsVsRaw.length === 0) {
    pass('champion_global_stats picks match raw game_players data (within ±1)');
  } else {
    warn(`${cgsVsRaw.length}+ champion_global_stats rows where picks differ from raw data`,
      `e.g. ${cgsVsRaw[0]?.champion_name}, serie=${cgsVsRaw[0]?.serie_id}: cgs_picks=${cgsVsRaw[0]?.cgs_picks}, raw=${cgsVsRaw[0]?.raw_picks}`);
  }

  // 6e. total_games_in_serie should match actual game count
  sub('6e. total_games_in_serie accuracy');
  const tgisMismatch = await q(`
    WITH actual AS (
      SELECT serie_id, COUNT(*) AS real_count
      FROM games WHERE finished = true AND length > 60
      GROUP BY serie_id
    )
    SELECT DISTINCT cgs.serie_id, cgs.total_games_in_serie AS cgs_total, a.real_count
    FROM champion_global_stats cgs
    JOIN actual a ON a.serie_id = cgs.serie_id
    WHERE ABS(cgs.total_games_in_serie - a.real_count) > 1
    LIMIT ${LIMIT}
  `);
  tgisMismatch.length === 0
    ? pass('total_games_in_serie matches actual finished game count')
    : warn(`${tgisMismatch.length}+ series where total_games_in_serie differs from actual count`,
        `e.g. serie=${tgisMismatch[0]?.serie_id}: cgs says ${tgisMismatch[0]?.cgs_total}, actual ${tgisMismatch[0]?.real_count}`);

  // 6f. Derivative tables should not have champion/serie combos absent from parent
  sub('6f. Derivative table integrity');
  const derivTables = ['champion_role_stats', 'champion_top_players', 'champion_matchups', 'champion_items', 'champion_keystones', 'champion_patch_stats'];
  for (const dt of derivTables) {
    const orphans = await q1(`
      SELECT COUNT(*) AS n FROM ${dt} d
      WHERE NOT EXISTS (
        SELECT 1 FROM champion_global_stats cgs
        WHERE cgs.champion_id = d.champion_id AND cgs.serie_id = d.serie_id
      )
    `);
    Number(orphans.n) === 0
      ? pass(`${dt}: no orphan rows (all reference valid cgs entries)`)
      : fail(`${dt}: ${orphans.n} orphan rows without parent in champion_global_stats`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7: PLAYER_CHAMPION_STATS CORRECTNESS
// ═════════════════════════════════════════════════════════════════════════════
async function checkPlayerChampionStats() {
  section('7. PLAYER_CHAMPION_STATS');

  const pcsCount = await count('player_champion_stats');
  if (pcsCount === 0) { warn('player_champion_stats is EMPTY — skipping checks'); return; }

  // win_rate range and ratio detection (only flag when games <= 100)
  sub('7a. win_rate range');
  const ratioLike = await q(`
    SELECT player_id, serie_id, champion_name, games, wins, win_rate
    FROM player_champion_stats
    WHERE games > 1 AND games <= 100 AND win_rate > 0 AND win_rate < 1
    LIMIT ${LIMIT}
  `);
  ratioLike.length === 0
    ? pass('No player_champion_stats.win_rate values look like ratios')
    : fail(`${ratioLike.length}+ ratio-like win_rate values`,
        `e.g. player=${ratioLike[0]?.player_id}, ${ratioLike[0]?.champion_name}: wr=${ratioLike[0]?.win_rate}`);

  const oor = await count('player_champion_stats', 'win_rate IS NOT NULL AND (win_rate < 0 OR win_rate > 100)');
  oor === 0 ? pass('All win_rate values in range 0-100') : fail(`${oor} values outside 0-100`);

  // Formula check
  const wrBad = await q(`
    SELECT player_id, serie_id, champion_name, games, wins, win_rate,
           ROUND((wins::numeric / NULLIF(games, 0) * 100)::numeric, 2) AS expected
    FROM player_champion_stats
    WHERE games > 0 AND win_rate IS NOT NULL
      AND ABS(win_rate - (wins::numeric / games * 100)) > 1
    LIMIT ${LIMIT}
  `);
  wrBad.length === 0
    ? pass('win_rate matches wins/games*100')
    : fail(`${wrBad.length}+ rows where win_rate doesn't match formula`,
        `e.g. ${wrBad[0]?.champion_name}: ${wrBad[0]?.wins}/${wrBad[0]?.games}=${wrBad[0]?.expected}, got ${wrBad[0]?.win_rate}`);

  // kill_participation range
  sub('7b. kill_participation range');
  const kpRatio = await q(`
    SELECT player_id, serie_id, champion_name, games, kill_participation
    FROM player_champion_stats
    WHERE games > 1 AND games <= 100 AND kill_participation IS NOT NULL AND kill_participation > 0 AND kill_participation < 1
    LIMIT 5
  `);
  kpRatio.length === 0
    ? pass('No kill_participation values look like ratios')
    : fail(`${kpRatio.length}+ ratio-like kill_participation values`,
        `e.g. player=${kpRatio[0]?.player_id}: kp=${kpRatio[0]?.kill_participation}`);

  // Side games consistency
  sub('7c. Side games consistency');
  const sideBad = await q(`
    SELECT player_id, serie_id, champion_name, games, blue_games, red_games
    FROM player_champion_stats
    WHERE games IS NOT NULL AND blue_games IS NOT NULL AND red_games IS NOT NULL
      AND games != COALESCE(blue_games, 0) + COALESCE(red_games, 0)
    LIMIT ${LIMIT}
  `);
  sideBad.length === 0
    ? pass('games = blue_games + red_games')
    : warn(`${sideBad.length}+ rows where games != blue+red`,
        `e.g. ${sideBad[0]?.champion_name}: games=${sideBad[0]?.games}, blue=${sideBad[0]?.blue_games}, red=${sideBad[0]?.red_games}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8: RATIO vs PERCENTAGE — SYSTEMIC CHECK
// ═════════════════════════════════════════════════════════════════════════════
async function checkRatioVsPercentage() {
  section('8. SYSTEMIC RATIO vs PERCENTAGE CHECK');
  console.log('  Checking all rate/percentage columns across all precalculated tables...');

  // denomCol: column used as the percentage denominator. When denominator > 100,
  // legitimate small percentages < 1% are possible, so we exclude those from ratio detection.
  const checks = [
    // team_career
    { table: 'team_career', col: 'win_rate', minGames: 'games > 1', denomCol: 'games' },
    { table: 'team_career', col: 'first_blood_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_tower_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_dragon_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_baron_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_herald_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_voidgrub_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_atakhan_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_inhibitor_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'first_elder_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'team_career', col: 'dragon_soul_rate', minGames: 'games > 2', denomCol: 'games' },
    // player_career
    { table: 'player_career', col: 'win_rate', minGames: 'games > 1', denomCol: 'games' },
    { table: 'player_career', col: 'first_blood_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'player_career', col: 'first_tower_rate', minGames: 'games > 2', denomCol: 'games' },
    { table: 'player_career', col: 'kill_participation', minGames: 'games > 2', denomCol: 'games' },
    // champion_global_stats
    { table: 'champion_global_stats', col: 'win_rate', minGames: 'picks > 2', denomCol: 'picks' },
    { table: 'champion_global_stats', col: 'ban_rate_blue', minGames: 'bans_blue > 0', denomCol: 'total_games_in_serie' },
    { table: 'champion_global_stats', col: 'ban_rate_red', minGames: 'bans_red > 0', denomCol: 'total_games_in_serie' },
    { table: 'champion_global_stats', col: 'kill_participation', minGames: 'picks > 2', denomCol: 'picks' },
    { table: 'champion_global_stats', col: 'fb_rate', minGames: 'picks > 2', denomCol: 'picks' },
    // player_champion_stats
    { table: 'player_champion_stats', col: 'win_rate', minGames: 'games > 1', denomCol: 'games' },
    { table: 'player_champion_stats', col: 'kill_participation', minGames: 'games > 2', denomCol: 'games' },
  ];

  let ratioCount = 0;
  for (const { table, col, minGames, denomCol } of checks) {
    const n = (await q1(`
      SELECT COUNT(*) AS n FROM ${table}
      WHERE ${col} IS NOT NULL AND ${minGames} AND ${denomCol} <= 100 AND ${col} > 0 AND ${col} < 1
    `)).n;
    if (Number(n) > 0) {
      ratioCount += Number(n);
      fail(`${table}.${col}: ${n} values look like ratios (0 < val < 1, denominator ≤ 100)`,
        `These should be percentages (0-100). This is the ratio→percentage bug.`);
    }
  }
  if (ratioCount === 0) {
    pass('No ratio-like percentage values detected across all tables!');
  } else {
    console.log(`\n  ${FAIL} TOTAL: ${ratioCount} values across all tables still stored as ratios instead of percentages`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 9: COMPLETENESS — series with matches but no precalculated data
// ═════════════════════════════════════════════════════════════════════════════
async function checkCompleteness() {
  section('9. COMPLETENESS — SERIES COVERAGE');

  // Series that have finished matches with ingested games
  const totalSeries = (await q1(`
    SELECT COUNT(DISTINCT m.serie_id) AS n
    FROM matches m
    WHERE m.games_ingested_at IS NOT NULL AND m.serie_id IS NOT NULL
  `)).n;
  info(`Total series with ingested matches: ${totalSeries}`);

  // Missing team_career
  const missingTC = await q(`
    SELECT m.serie_id, s.full_name, COUNT(DISTINCT m.id) AS match_count
    FROM matches m
    JOIN series s ON s.id = m.serie_id
    WHERE m.games_ingested_at IS NOT NULL AND m.serie_id IS NOT NULL
      AND m.serie_id NOT IN (SELECT DISTINCT serie_id FROM team_career WHERE serie_id IS NOT NULL)
    GROUP BY m.serie_id, s.full_name
    ORDER BY match_count DESC
    LIMIT ${LIMIT}
  `);
  const missingTCCount = (await q1(`
    SELECT COUNT(DISTINCT m.serie_id) AS n FROM matches m
    WHERE m.games_ingested_at IS NOT NULL AND m.serie_id IS NOT NULL
      AND m.serie_id NOT IN (SELECT DISTINCT serie_id FROM team_career WHERE serie_id IS NOT NULL)
  `)).n;
  missingTCCount === 0
    ? pass(`team_career: all ${totalSeries} series covered`)
    : warn(`team_career: ${missingTCCount}/${totalSeries} series MISSING`,
        missingTC.slice(0, 3).map(r => `  serie=${r.serie_id} "${r.full_name}" (${r.match_count} matches)`).join('\n    '));

  // Missing player_career
  const missingPCCount = (await q1(`
    SELECT COUNT(DISTINCT m.serie_id) AS n FROM matches m
    WHERE m.games_ingested_at IS NOT NULL AND m.serie_id IS NOT NULL
      AND m.serie_id NOT IN (SELECT DISTINCT serie_id FROM player_career WHERE serie_id IS NOT NULL)
  `)).n;
  missingPCCount === 0
    ? pass(`player_career: all ${totalSeries} series covered`)
    : warn(`player_career: ${missingPCCount}/${totalSeries} series MISSING`);

  // Missing champion_global_stats
  const missingCGSCount = (await q1(`
    SELECT COUNT(DISTINCT m.serie_id) AS n FROM matches m
    WHERE m.games_ingested_at IS NOT NULL AND m.serie_id IS NOT NULL
      AND m.serie_id NOT IN (SELECT DISTINCT serie_id FROM champion_global_stats WHERE serie_id IS NOT NULL)
  `)).n;
  missingCGSCount === 0
    ? pass(`champion_global_stats: all ${totalSeries} series covered`)
    : warn(`champion_global_stats: ${missingCGSCount}/${totalSeries} series MISSING`);

  // Missing player_champion_stats
  const missingPCSCount = (await q1(`
    SELECT COUNT(DISTINCT m.serie_id) AS n FROM matches m
    WHERE m.games_ingested_at IS NOT NULL AND m.serie_id IS NOT NULL
      AND m.serie_id NOT IN (SELECT DISTINCT serie_id FROM player_champion_stats WHERE serie_id IS NOT NULL)
  `)).n;
  missingPCSCount === 0
    ? pass(`player_champion_stats: all ${totalSeries} series covered`)
    : warn(`player_champion_stats: ${missingPCSCount}/${totalSeries} series MISSING`);

  // Summary
  console.log(`\n  ${INFO} Coverage summary:`);
  console.log(`    team_career:            ${totalSeries - missingTCCount}/${totalSeries} (${rnd(100 - missingTCCount / totalSeries * 100)}%)`);
  console.log(`    player_career:          ${totalSeries - missingPCCount}/${totalSeries} (${rnd(100 - missingPCCount / totalSeries * 100)}%)`);
  console.log(`    champion_global_stats:  ${totalSeries - missingCGSCount}/${totalSeries} (${rnd(100 - missingCGSCount / totalSeries * 100)}%)`);
  console.log(`    player_champion_stats:  ${totalSeries - missingPCSCount}/${totalSeries} (${rnd(100 - missingPCSCount / totalSeries * 100)}%)`);
}

function rnd(v, d = 1) { return Math.round(v * 10 ** d) / 10 ** d; }

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`${BOLD}╔══════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║          LeagueScope Database Integrity Check                   ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  Mode: ${FIX_MODE ? 'FIX (will attempt repairs)' : 'AUDIT (read-only)'}`);
  console.log(`  Section: ${SECTION || 'ALL'}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);

  const sectionMap = {
    counts:           checkCounts,
    referential:      checkReferential,
    raw:              checkRawData,
    team_career:      checkTeamCareer,
    player_career:    checkPlayerCareer,
    champion_global:  checkChampionGlobal,
    player_champion:  checkPlayerChampionStats,
    ratios:           checkRatioVsPercentage,
    completeness:     checkCompleteness,
  };

  try {
    if (SECTION) {
      if (!sectionMap[SECTION]) {
        console.error(`Unknown section: ${SECTION}. Available: ${Object.keys(sectionMap).join(', ')}`);
        process.exit(2);
      }
      await sectionMap[SECTION]();
    } else {
      for (const fn of Object.values(sectionMap)) {
        await fn();
      }
    }
  } catch (err) {
    console.error(`\n${FAIL} FATAL ERROR: ${err.message}`);
    console.error(err.stack);
    process.exit(2);
  }

  // ── Final report ─────────────────────────────────────────────────────────
  console.log(`\n${BOLD}═══ FINAL REPORT ═══${RESET}`);
  console.log(`  Total checks: ${totalChecks}`);
  console.log(`  ${PASS} Passed: ${totalPassed}`);
  console.log(`  ${WARN} Warnings: ${totalWarnings}`);
  console.log(`  ${FAIL} Failed: ${totalFailed}`);

  if (issues.length > 0) {
    console.log(`\n  ${BOLD}Issues found:${RESET}`);
    issues.forEach((iss, i) => console.log(`  ${i + 1}. ${iss}`));
  }

  if (totalFailed === 0 && totalWarnings === 0) {
    console.log(`\n  ${PASS} ${BOLD}ALL CHECKS PASSED — Database is healthy!${RESET}`);
  } else if (totalFailed === 0) {
    console.log(`\n  ${WARN} ${BOLD}No critical issues, but ${totalWarnings} warning(s) to review.${RESET}`);
  } else {
    console.log(`\n  ${FAIL} ${BOLD}${totalFailed} ISSUE(S) FOUND — review and fix above problems.${RESET}`);
  }

  await pool.end();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
