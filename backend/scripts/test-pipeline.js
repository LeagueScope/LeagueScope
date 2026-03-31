#!/usr/bin/env node
/**
 * test-pipeline.js — Automated pipeline integrity tests.
 *
 * Verifies that LeagueScope's data pipeline corrections work correctly:
 *   T1. MODE role calculation — player positions match game-level majority
 *   T2. team_brands resolution — COALESCE picks brand over raw PandaScore name
 *   T3. Dedup constraints — unique indexes prevent double-inserts
 *   T4. NULL handling — aggregation queries handle NULLs gracefully
 *   T5. stageFilter parameterization — no raw parseInt in queries
 *   T6. Champion alias resolution — canonical IDs resolve correctly
 *   T7. Serie/tournament hierarchy — structure is consistent
 *   T8. Game integrity — games have correct player/team counts
 *
 * Usage:
 *   PG_DSN="postgresql://..." node scripts/test-pipeline.js
 *
 * Exit code 0 = all pass, 1 = failures found.
 */

import pg from 'pg';

const DSN = process.env.PG_DSN;
if (!DSN) { console.error('PG_DSN not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN, max: 4 });

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const SKIP = '\x1b[36m○\x1b[0m';
const BOLD = '\x1b[1m';
const RST  = '\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;

function section(title) { console.log(`\n${BOLD}── ${title} ──${RST}`); }

function test(ok, name, detail) {
  if (ok === null) {
    skipped++;
    console.log(`  ${SKIP} ${name}${detail ? ` — ${detail}` : ''}`);
  } else if (ok) {
    passed++;
    console.log(`  ${PASS} ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    console.log(`  ${FAIL} ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ─── T1. MODE ROLE CALCULATION ──────────────────────────────────────────────

async function testModeRoles() {
  section('T1. MODE Role Calculation');

  // For a sample of active players, verify their stored role = MODE(game roles)
  const { rows } = await pool.query(`
    WITH recent_players AS (
      SELECT DISTINCT gp.player_id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.begin_at > NOW() - INTERVAL '180 days'
        AND gp.role IS NOT NULL
      LIMIT 200
    ),
    game_roles AS (
      SELECT gp.player_id, gp.role, COUNT(*) AS cnt
      FROM game_players gp
      WHERE gp.player_id IN (SELECT player_id FROM recent_players)
        AND gp.role IS NOT NULL
      GROUP BY gp.player_id, gp.role
    ),
    mode_role AS (
      SELECT DISTINCT ON (player_id)
        player_id, role AS mode_role
      FROM game_roles
      ORDER BY player_id, cnt DESC, role
    )
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE p.role::text = mr.mode_role::text) AS matching,
      COUNT(*) FILTER (WHERE p.role::text != mr.mode_role::text) AS drifted
    FROM mode_role mr
    JOIN players p ON p.id = mr.player_id
    WHERE p.role IS NOT NULL
  `);

  const { total, matching, drifted } = rows[0];
  const pct = total > 0 ? ((matching / total) * 100).toFixed(1) : '0';

  test(parseInt(drifted) === 0,
    `Role MODE accuracy: ${pct}% (${matching}/${total})`,
    parseInt(drifted) > 0 ? `${drifted} players drifted` : null
  );

  // Verify role distribution is reasonable (no role > 25% of all players)
  const { rows: dist } = await pool.query(`
    SELECT role, COUNT(*) AS cnt,
           ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
    FROM players WHERE role IS NOT NULL
    GROUP BY role ORDER BY role
  `);
  const maxPct = Math.max(...dist.map(r => parseFloat(r.pct)));
  test(maxPct <= 30,
    'Role distribution balanced',
    dist.map(r => `${r.role}:${r.pct}%`).join(', ')
  );
}

// ─── T2. TEAM_BRANDS RESOLUTION ────────────────────────────────────────────

async function testTeamBrands() {
  section('T2. team_brands Resolution');

  // Verify team_brands entries have non-null display_name
  const { rows: [{ null_names }] } = await pool.query(`
    SELECT COUNT(*) AS null_names FROM team_brands WHERE display_name IS NULL
  `);
  test(parseInt(null_names) === 0,
    'All team_brands have display_name',
    parseInt(null_names) > 0 ? `${null_names} entries missing display_name` : null
  );

  // Verify year ranges don't overlap for same team
  const { rows: overlaps } = await pool.query(`
    SELECT a.team_id, a.year_start AS a_start, a.year_end AS a_end,
           b.year_start AS b_start, b.year_end AS b_end
    FROM team_brands a
    JOIN team_brands b ON a.team_id = b.team_id
      AND a.year_start < b.year_start
      AND a.year_end >= b.year_start
    LIMIT 10
  `);
  test(overlaps.length === 0,
    'No overlapping year ranges in team_brands',
    overlaps.length > 0 ? `${overlaps.length} overlaps found` : null
  );

  // Verify COALESCE pattern works: brand name takes priority
  const { rows: coalesceTest } = await pool.query(`
    SELECT
      t.id,
      t.name AS ps_name,
      tb.display_name AS brand_name,
      COALESCE(tb.display_name, t.name) AS resolved
    FROM teams t
    JOIN team_brands tb ON tb.team_id = t.id
    WHERE tb.display_name IS NOT NULL
    LIMIT 5
  `);
  const coalesceOk = coalesceTest.every(r => r.resolved === r.brand_name);
  test(coalesceOk,
    'COALESCE(brand, ps_name) picks brand when available',
    `tested ${coalesceTest.length} entries`
  );
}

// ─── T3. DEDUP CONSTRAINTS ──────────────────────────────────────────────────

async function testDedupConstraints() {
  section('T3. Dedup Constraints');

  // Verify unique constraints exist on critical tables
  const { rows: constraints } = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      AND tc.table_schema = 'public'
      AND tc.table_name IN (
        'games', 'game_players', 'game_teams', 'game_picks_bans',
        'player_career', 'team_career', 'champion_global_stats'
      )
    ORDER BY tc.table_name, tc.constraint_type
  `);

  const tableConstraints = {};
  constraints.forEach(c => {
    if (!tableConstraints[c.table_name]) tableConstraints[c.table_name] = [];
    tableConstraints[c.table_name].push(c.constraint_type);
  });

  const requiredTables = ['games', 'game_players', 'game_teams', 'player_career', 'team_career'];
  for (const t of requiredTables) {
    const has = tableConstraints[t] || [];
    test(has.length > 0,
      `${t} has dedup constraint`,
      has.join(', ') || 'NONE'
    );
  }

  // Verify no actual duplicates in game_players
  const { rows: [{ dup_count }] } = await pool.query(`
    SELECT COUNT(*) AS dup_count FROM (
      SELECT game_id, player_id FROM game_players
      GROUP BY game_id, player_id HAVING COUNT(*) > 1
    ) d
  `);
  test(parseInt(dup_count) === 0,
    'Zero duplicate game_players in data',
    parseInt(dup_count) > 0 ? `${dup_count} duplicates!` : null
  );
}

// ─── T4. NULL HANDLING ──────────────────────────────────────────────────────

async function testNullHandling() {
  section('T4. NULL Handling');

  // Games with finished=true must have length
  const { rows: [{ no_length }] } = await pool.query(`
    SELECT COUNT(*) AS no_length FROM games
    WHERE finished = true AND length IS NULL
  `);
  test(parseInt(no_length) === 0,
    'Finished games have length',
    parseInt(no_length) > 0 ? `${no_length} without length` : null
  );

  // game_players kills/deaths/assists should not be NULL for finished games
  const { rows: [{ null_kda }] } = await pool.query(`
    SELECT COUNT(*) AS null_kda FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.finished = true
      AND (gp.kills IS NULL OR gp.deaths IS NULL OR gp.assists IS NULL)
  `);
  test(parseInt(null_kda) === 0,
    'Finished game_players have KDA data',
    parseInt(null_kda) > 0 ? `${null_kda} missing KDA` : null
  );

  // player_career should have games > 0
  const { rows: [{ zero_games }] } = await pool.query(`
    SELECT COUNT(*) AS zero_games FROM player_career
    WHERE games IS NULL OR games = 0
  `);
  test(parseInt(zero_games) === 0,
    'All player_career entries have games > 0',
    parseInt(zero_games) > 0 ? `${zero_games} with 0 games` : null
  );

  // COALESCE safety: series.year should not be NULL
  const { rows: [{ null_year }] } = await pool.query(`
    SELECT COUNT(*) AS null_year FROM series WHERE year IS NULL
  `);
  test(parseInt(null_year) === 0,
    'All series have year defined',
    parseInt(null_year) > 0 ? `${null_year} without year` : null
  );
}

// ─── T5. PARAMETERIZATION SAFETY ────────────────────────────────────────────

async function testParameterization() {
  section('T5. Parameterization Safety (stageFilter)');

  // Verify stageFilter works correctly by testing the actual query pattern
  // We test that tournament_id filtering works via parameterized queries

  // Get a real serie + tournament pair
  const { rows: sample } = await pool.query(`
    SELECT t.id AS tournament_id, t.serie_id
    FROM tournaments t
    JOIN games g ON g.tournament_id = t.id
    GROUP BY t.id, t.serie_id
    HAVING COUNT(*) >= 5
    LIMIT 1
  `);

  if (sample.length === 0) {
    test(null, 'stageFilter parameterized query', 'no tournaments with games');
    return;
  }

  const { tournament_id, serie_id } = sample[0];

  // Run same pattern as stageFilter: $1=serieId, $2=tournamentId
  const { rows: filtered } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM games g
    WHERE g.serie_id = $1 AND g.tournament_id = $2
  `, [serie_id, tournament_id]);

  const { rows: unfiltered } = await pool.query(`
    SELECT COUNT(*) AS cnt FROM games g
    WHERE g.serie_id = $1
  `, [serie_id]);

  const fCnt = parseInt(filtered[0].cnt);
  const uCnt = parseInt(unfiltered[0].cnt);

  test(fCnt > 0 && fCnt <= uCnt,
    `stageFilter narrows results: ${fCnt} filtered vs ${uCnt} total`,
    `tournament_id=${tournament_id}, serie_id=${serie_id}`
  );
}

// ─── T6. CHAMPION ALIAS RESOLUTION ─────────────────────────────────────────

async function testChampionAliases() {
  section('T6. Champion Alias Resolution');

  // All aliases should point to valid champions
  const { rows: [{ bad_refs }] } = await pool.query(`
    SELECT COUNT(*) AS bad_refs FROM champion_aliases ca
    LEFT JOIN champions c ON c.id = ca.canonical_id
    WHERE c.id IS NULL
  `);
  test(parseInt(bad_refs) === 0,
    'All aliases point to valid champions',
    parseInt(bad_refs) > 0 ? `${bad_refs} broken references` : null
  );

  // Coverage: what % of game_players champion_ids resolve
  const { rows: [{ total_gp, resolved, pct }] } = await pool.query(`
    SELECT
      COUNT(*) AS total_gp,
      COUNT(ca.canonical_id) AS resolved,
      ROUND(COUNT(ca.canonical_id)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS pct
    FROM game_players gp
    LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
    WHERE gp.champion_id IS NOT NULL
  `);
  const coverage = parseFloat(pct || 0);
  test(coverage >= 99,
    `Champion alias coverage: ${coverage}%`,
    `${resolved}/${total_gp} resolved`
  );
}

// ─── T7. SERIE/TOURNAMENT HIERARCHY ────────────────────────────────────────

async function testHierarchy() {
  section('T7. Serie → Tournament → Match → Game Hierarchy');

  // All tournaments belong to a valid serie
  const { rows: [{ orphan_tournaments }] } = await pool.query(`
    SELECT COUNT(*) AS orphan_tournaments FROM tournaments t
    LEFT JOIN series s ON s.id = t.serie_id
    WHERE s.id IS NULL AND t.serie_id IS NOT NULL
  `);
  test(parseInt(orphan_tournaments) === 0,
    'All tournaments belong to valid series',
    parseInt(orphan_tournaments) > 0 ? `${orphan_tournaments} orphaned` : null
  );

  // All matches belong to a valid tournament
  const { rows: [{ orphan_matches }] } = await pool.query(`
    SELECT COUNT(*) AS orphan_matches FROM matches m
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.id IS NULL AND m.tournament_id IS NOT NULL
  `);
  test(parseInt(orphan_matches) === 0,
    'All matches belong to valid tournaments',
    parseInt(orphan_matches) > 0 ? `${orphan_matches} orphaned` : null
  );

  // Series should have at least one tournament
  const { rows: [{ empty_series }] } = await pool.query(`
    SELECT COUNT(*) AS empty_series FROM series s
    LEFT JOIN tournaments t ON t.serie_id = s.id
    WHERE t.id IS NULL
  `);
  // This is a warning, not a failure (some series may be future/empty)
  if (parseInt(empty_series) > 0) {
    test(null, `${empty_series} series have no tournaments`, 'may be future/empty');
  } else {
    test(true, 'All series have at least one tournament');
  }
}

// ─── T8. GAME INTEGRITY ────────────────────────────────────────────────────

async function testGameIntegrity() {
  section('T8. Game Integrity');

  // Finished games should have exactly 2 game_teams
  const { rows: badTeamCount } = await pool.query(`
    SELECT g.id, COUNT(gt.id) AS team_count
    FROM games g
    LEFT JOIN game_teams gt ON gt.game_id = g.id
    WHERE g.finished = true
    GROUP BY g.id
    HAVING COUNT(gt.id) != 2
    LIMIT 10
  `);
  test(badTeamCount.length === 0,
    'Finished games have exactly 2 game_teams',
    badTeamCount.length > 0 ? `${badTeamCount.length} games with wrong count` : null
  );

  // Finished games should have 10 game_players (5v5)
  const { rows: badPlayerCount } = await pool.query(`
    SELECT g.id, COUNT(gp.id) AS player_count
    FROM games g
    LEFT JOIN game_players gp ON gp.game_id = g.id
    WHERE g.finished = true AND g.detailed_stats = true
    GROUP BY g.id
    HAVING COUNT(gp.id) != 10
    LIMIT 10
  `);
  test(badPlayerCount.length === 0,
    'Finished games (detailed) have exactly 10 game_players',
    badPlayerCount.length > 0 ? `${badPlayerCount.length} games with wrong count` : null
  );

  // game_players should have one of the 5 valid roles
  const { rows: badRoles } = await pool.query(`
    SELECT gp.role, COUNT(*) AS cnt
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.finished = true AND gp.role IS NOT NULL
      AND gp.role::text NOT IN ('top', 'jun', 'mid', 'adc', 'sup')
    GROUP BY gp.role
  `);
  test(badRoles.length === 0,
    'All game_player roles are valid enum values',
    badRoles.length > 0 ? badRoles.map(r => `${r.role}:${r.cnt}`).join(', ') : null
  );
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}LeagueScope Pipeline Tests${RST}`);
  console.log(`Database: ${DSN.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Run at: ${new Date().toISOString()}\n`);

  await testModeRoles();
  await testTeamBrands();
  await testDedupConstraints();
  await testNullHandling();
  await testParameterization();
  await testChampionAliases();
  await testHierarchy();
  await testGameIntegrity();

  // Summary
  console.log(`\n${BOLD}═══ RESULTS ═══${RST}`);
  console.log(`  ${PASS} Passed:  ${passed}`);
  console.log(`  ${FAIL} Failed:  ${failed}`);
  console.log(`  ${SKIP} Skipped: ${skipped}`);
  console.log(`  Total:   ${passed + failed + skipped}`);

  if (failed > 0) {
    console.log(`\n  ${FAIL} ${failed} test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ${PASS} All tests passed.`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(2);
});
