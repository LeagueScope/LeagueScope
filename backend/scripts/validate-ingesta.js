#!/usr/bin/env node
/**
 * validate-ingesta.js — Post-ingestion data quality validator.
 *
 * Detects retroactive PandaScore contamination:
 *   1. Role drift    — players whose game-level MODE role ≠ players.role
 *   2. Team renames  — teams missing from team_brands that changed name mid-serie
 *   3. Duplicates    — games/players appearing twice for the same match
 *   4. NULL critical — critical columns that should never be NULL
 *   5. Orphan refs   — foreign-key-like dangling references
 *   6. Champion alias gaps — game_players referencing unknown PandaScore IDs
 *
 * Usage:
 *   PG_DSN="postgresql://..." node scripts/validate-ingesta.js [--fix] [--serie=<id>]
 *
 * --fix   Apply safe auto-fixes (only for role drift, updates players.role)
 * --serie Restrict checks to a specific serie_id (faster for incremental runs)
 */

import pg from 'pg';

const DSN = process.env.PG_DSN;
if (!DSN) { console.error('PG_DSN not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN, max: 4 });
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const SERIE = args.find(a => a.startsWith('--serie='))?.split('=')[1];

// ─── Helpers ────────────────────────────────────────────────────────────────

const PASS = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const BOLD = '\x1b[1m';
const RST  = '\x1b[0m';

let warnCount = 0;
let failCount = 0;
let fixCount  = 0;

function section(title) { console.log(`\n${BOLD}═══ ${title} ═══${RST}`); }

function report(ok, msg, details) {
  if (ok) {
    console.log(`  ${PASS} ${msg}`);
  } else if (details?.severity === 'warn') {
    warnCount++;
    console.log(`  ${WARN} ${msg}`);
  } else {
    failCount++;
    console.log(`  ${FAIL} ${msg}`);
  }
  if (details?.rows?.length) {
    const show = details.rows.slice(0, 10);
    show.forEach(r => console.log(`      ${JSON.stringify(r)}`));
    if (details.rows.length > 10) console.log(`      ... and ${details.rows.length - 10} more`);
  }
}

// ─── 1. ROLE DRIFT ──────────────────────────────────────────────────────────

async function checkRoleDrift() {
  section('1. Role Drift (MODE role vs players.role)');

  // Calculate the MODE role from actual game data per player
  const serieClause = SERIE ? `AND g.serie_id = ${parseInt(SERIE)}` : '';
  const { rows } = await pool.query(`
    WITH game_roles AS (
      SELECT
        gp.player_id,
        gp.role,
        COUNT(*) AS cnt
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.role IS NOT NULL ${serieClause}
      GROUP BY gp.player_id, gp.role
    ),
    mode_role AS (
      SELECT DISTINCT ON (player_id)
        player_id, role AS mode_role, cnt
      FROM game_roles
      ORDER BY player_id, cnt DESC, role
    )
    SELECT
      mr.player_id,
      p.name AS player_name,
      p.role AS stored_role,
      mr.mode_role,
      mr.cnt AS games_with_mode_role
    FROM mode_role mr
    JOIN players p ON p.id = mr.player_id
    WHERE p.role IS NOT NULL
      AND mr.mode_role::text != p.role::text
    ORDER BY mr.cnt DESC
    LIMIT 50
  `);

  report(rows.length === 0,
    rows.length === 0
      ? 'All player roles match their game-level MODE role'
      : `${rows.length} players have role drift (stored ≠ MODE from games)`,
    { rows, severity: 'warn' }
  );

  if (FIX && rows.length > 0) {
    let fixed = 0;
    for (const r of rows) {
      try {
        await pool.query('UPDATE players SET role = $1 WHERE id = $2', [r.mode_role, r.player_id]);
        fixed++;
      } catch (e) {
        console.log(`      Could not fix ${r.player_name}: ${e.message}`);
      }
    }
    fixCount += fixed;
    console.log(`      ${BOLD}Fixed ${fixed}/${rows.length} roles${RST}`);
  }
}

// ─── 2. TEAM RENAME DETECTION ───────────────────────────────────────────────

async function checkTeamRenames() {
  section('2. Team Rename Detection');

  // Find teams whose current PandaScore name differs from what team_brands says
  const { rows } = await pool.query(`
    SELECT
      t.id,
      t.name AS current_ps_name,
      t.acronym AS current_ps_acronym,
      tb.display_name AS brand_name,
      tb.display_acronym AS brand_acronym,
      tb.year_start,
      tb.year_end
    FROM teams t
    JOIN team_brands tb ON tb.team_id = t.id
    WHERE tb.year_end = (SELECT MAX(year_end) FROM team_brands WHERE team_id = t.id)
      AND (
        LOWER(t.name) != LOWER(tb.display_name)
        OR (tb.display_acronym IS NOT NULL AND UPPER(t.acronym) != UPPER(tb.display_acronym))
      )
    ORDER BY t.name
  `);

  report(rows.length === 0,
    rows.length === 0
      ? 'All teams with brands match their latest brand entry'
      : `${rows.length} teams have PandaScore name ≠ latest brand (expected for rebrands)`,
    { rows, severity: 'warn' }
  );

  // Check teams with games but NO brand entry at all
  const { rows: noBrand } = await pool.query(`
    SELECT DISTINCT t.id, t.name, t.acronym, COUNT(DISTINCT g.id) AS game_count
    FROM teams t
    JOIN game_teams gt ON gt.team_id = t.id
    JOIN games g ON g.id = gt.game_id
    LEFT JOIN team_brands tb ON tb.team_id = t.id
    WHERE tb.team_id IS NULL
    GROUP BY t.id, t.name, t.acronym
    HAVING COUNT(DISTINCT g.id) >= 10
    ORDER BY game_count DESC
    LIMIT 20
  `);

  report(noBrand.length === 0,
    noBrand.length === 0
      ? 'All active teams (≥10 games) have team_brands entries'
      : `${noBrand.length} active teams lack team_brands entries`,
    { rows: noBrand, severity: 'warn' }
  );
}

// ─── 3. DUPLICATE DETECTION ─────────────────────────────────────────────────

async function checkDuplicates() {
  section('3. Duplicate Detection');

  // 3a. Duplicate games within the same match
  const { rows: dupGames } = await pool.query(`
    SELECT match_id, position, COUNT(*) AS cnt
    FROM games
    WHERE match_id IS NOT NULL AND position IS NOT NULL
    GROUP BY match_id, position
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  report(dupGames.length === 0,
    dupGames.length === 0
      ? 'No duplicate games per match+position'
      : `${dupGames.length} match/position combos have duplicate games`,
    { rows: dupGames }
  );

  // 3b. Duplicate game_players (same player in same game)
  const { rows: dupGP } = await pool.query(`
    SELECT game_id, player_id, COUNT(*) AS cnt
    FROM game_players
    GROUP BY game_id, player_id
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  report(dupGP.length === 0,
    dupGP.length === 0
      ? 'No duplicate game_players entries'
      : `${dupGP.length} game/player combos have duplicates`,
    { rows: dupGP }
  );

  // 3c. Duplicate game_teams (same team in same game)
  const { rows: dupGT } = await pool.query(`
    SELECT game_id, team_id, COUNT(*) AS cnt
    FROM game_teams
    GROUP BY game_id, team_id
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  report(dupGT.length === 0,
    dupGT.length === 0
      ? 'No duplicate game_teams entries'
      : `${dupGT.length} game/team combos have duplicates`,
    { rows: dupGT }
  );

  // 3d. Duplicate player_career (player+serie)
  const { rows: dupPC } = await pool.query(`
    SELECT player_id, serie_id, COUNT(*) AS cnt
    FROM player_career
    GROUP BY player_id, serie_id
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  report(dupPC.length === 0,
    dupPC.length === 0
      ? 'No duplicate player_career entries'
      : `${dupPC.length} player/serie combos have duplicates`,
    { rows: dupPC }
  );
}

// ─── 4. NULL CRITICAL COLUMNS ───────────────────────────────────────────────

async function checkNulls() {
  section('4. NULL Critical Columns');

  const checks = [
    ['games',        'serie_id',    'Games without serie_id'],
    ['games',        'match_id',    'Games without match_id'],
    ['game_players', 'player_id',   'Game players without player_id'],
    ['game_players', 'team_id',     'Game players without team_id'],
    ['game_players', 'champion_id', 'Game players without champion_id'],
    ['game_teams',   'team_id',     'Game teams without team_id'],
    ['matches',      'tournament_id', 'Matches without tournament_id'],
    ['tournaments',  'serie_id',    'Tournaments without serie_id'],
    ['series',       'league_id',   'Series without league_id'],
    ['player_career','player_id',   'Player career without player_id'],
    ['team_career',  'team_id',     'Team career without team_id'],
  ];

  for (const [table, col, desc] of checks) {
    try {
      const { rows: [{ cnt }] } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${col} IS NULL`
      );
      const n = parseInt(cnt);
      report(n === 0,
        n === 0 ? `${desc}: none` : `${desc}: ${n} rows`,
        n > 0 ? { severity: n > 100 ? undefined : 'warn' } : undefined
      );
    } catch (e) {
      report(true, `${desc}: table/column not found (skipped)`);
    }
  }
}

// ─── 5. ORPHAN REFERENCES ───────────────────────────────────────────────────

async function checkOrphans() {
  section('5. Orphan References');

  // game_players → players
  const { rows: [{ cnt: orphPlayers }] } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM game_players gp
    LEFT JOIN players p ON p.id = gp.player_id
    WHERE p.id IS NULL AND gp.player_id IS NOT NULL
  `);
  report(parseInt(orphPlayers) === 0,
    parseInt(orphPlayers) === 0
      ? 'All game_players reference valid players'
      : `${orphPlayers} game_players reference non-existent players`
  );

  // game_teams → teams
  const { rows: [{ cnt: orphTeams }] } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM game_teams gt
    LEFT JOIN teams t ON t.id = gt.team_id
    WHERE t.id IS NULL AND gt.team_id IS NOT NULL
  `);
  report(parseInt(orphTeams) === 0,
    parseInt(orphTeams) === 0
      ? 'All game_teams reference valid teams'
      : `${orphTeams} game_teams reference non-existent teams`
  );

  // games → matches
  const { rows: [{ cnt: orphMatches }] } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM games g
    LEFT JOIN matches m ON m.id = g.match_id
    WHERE m.id IS NULL AND g.match_id IS NOT NULL
  `);
  report(parseInt(orphMatches) === 0,
    parseInt(orphMatches) === 0
      ? 'All games reference valid matches'
      : `${orphMatches} games reference non-existent matches`
  );
}

// ─── 6. CHAMPION ALIAS GAPS ────────────────────────────────────────────────

async function checkChampionAliases() {
  section('6. Champion Alias Gaps');

  const { rows } = await pool.query(`
    SELECT gp.champion_id, COUNT(*) AS occurrences
    FROM game_players gp
    LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
    WHERE ca.pandascore_id IS NULL AND gp.champion_id IS NOT NULL
    GROUP BY gp.champion_id
    ORDER BY occurrences DESC
    LIMIT 20
  `);

  report(rows.length === 0,
    rows.length === 0
      ? 'All game_player champion_ids have valid aliases'
      : `${rows.length} unknown champion IDs in game_players`,
    { rows, severity: 'warn' }
  );
}

// ─── 7. DATA FRESHNESS ─────────────────────────────────────────────────────

async function checkFreshness() {
  section('7. Data Freshness');

  const { rows: [latest] } = await pool.query(`
    SELECT
      MAX(g.begin_at) AS latest_game,
      NOW() - MAX(g.begin_at) AS age,
      COUNT(*) FILTER (WHERE g.begin_at > NOW() - INTERVAL '7 days') AS games_last_7d
    FROM games g
    WHERE g.finished = true
  `);

  if (latest?.latest_game) {
    const ageDays = latest.age ? Math.floor(parseFloat(latest.age.days || 0)) : '?';
    console.log(`  ℹ Latest finished game: ${latest.latest_game} (${ageDays} days ago)`);
    console.log(`  ℹ Games in last 7 days: ${latest.games_last_7d}`);
  } else {
    console.log(`  ${WARN} No finished games found`);
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}LeagueScope Post-Ingesta Validator${RST}`);
  console.log(`Database: ${DSN.replace(/:[^:@]+@/, ':***@')}`);
  if (SERIE) console.log(`Serie filter: ${SERIE}`);
  if (FIX) console.log(`${WARN} --fix mode: will apply safe auto-corrections`);
  console.log(`Run at: ${new Date().toISOString()}`);

  await checkRoleDrift();
  await checkTeamRenames();
  await checkDuplicates();
  await checkNulls();
  await checkOrphans();
  await checkChampionAliases();
  await checkFreshness();

  // Summary
  section('SUMMARY');
  console.log(`  Warnings: ${warnCount}`);
  console.log(`  Failures: ${failCount}`);
  if (FIX) console.log(`  Auto-fixed: ${fixCount}`);

  if (failCount > 0) {
    console.log(`\n  ${FAIL} ${failCount} critical issue(s) found. Review above.`);
    process.exitCode = 1;
  } else if (warnCount > 0) {
    console.log(`\n  ${WARN} ${warnCount} warning(s). No critical issues.`);
  } else {
    console.log(`\n  ${PASS} All checks passed.`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(2);
});
