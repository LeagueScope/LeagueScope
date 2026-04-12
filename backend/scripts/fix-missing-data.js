#!/usr/bin/env node
/**
 * fix-missing-data.js
 * Fixes three missing data issues:
 * 1. game_players.opponent_champion_id — compute from same-game opponent by role
 * 2. player_keystones — populate from game_player_runes
 * 3. champion_matchups — re-run after opponent_champion_id is populated
 *
 * Usage: node scripts/fix-missing-data.js [--step=1|2|3|all]
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const PG_DSN = process.env.PG_DSN;
if (!PG_DSN) { console.error('ERROR: PG_DSN not set'); process.exit(1); }

const pool = new Pool({
  connectionString: PG_DSN,
  max: 5,
  ...(PG_DSN.includes('rds.amazonaws.com') ? { ssl: { rejectUnauthorized: false } } : {}),
});

const BOLD = '\x1b[1m';
const RST = '\x1b[0m';
const OK = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

const args = process.argv.slice(2);
const stepArg = args.find(a => a.startsWith('--step='))?.split('=')[1] || 'all';

async function step1_opponentChampionId() {
  console.log(`\n${BOLD}═══ STEP 1: Populate opponent_champion_id ═══${RST}`);
  console.log('Computing opponent champion for each player by matching role in same game...');

  // Count current NULLs
  const { rows: [{ n: nullCount }] } = await pool.query(
    `SELECT COUNT(*) AS n FROM game_players WHERE opponent_champion_id IS NULL`
  );
  console.log(`  Currently NULL: ${Number(nullCount).toLocaleString()} rows`);

  if (Number(nullCount) === 0) {
    console.log(`  ${OK} Already populated — skipping`);
    return;
  }

  // For each player, find the opponent = player on the OTHER team with the SAME role in the same game
  // Process in batches by serie to avoid memory issues
  const { rows: series } = await pool.query(
    `SELECT DISTINCT serie_id FROM games WHERE serie_id IS NOT NULL ORDER BY serie_id`
  );
  console.log(`  Processing ${series.length} series...`);

  let totalUpdated = 0;
  for (let i = 0; i < series.length; i++) {
    const sid = series[i].serie_id;
    const { rowCount } = await pool.query(`
      UPDATE game_players gp
      SET opponent_champion_id = opp.champion_id
      FROM game_players opp
      WHERE opp.game_id = gp.game_id
        AND opp.team_id != gp.team_id
        AND opp.role = gp.role
        AND gp.role IS NOT NULL
        AND gp.opponent_champion_id IS NULL
        AND gp.game_id IN (SELECT id FROM games WHERE serie_id = $1)
    `, [sid]);
    totalUpdated += rowCount;
    if (i % 50 === 0 || i === series.length - 1) {
      console.log(`  [${i + 1}/${series.length}] Updated ${totalUpdated.toLocaleString()} so far...`);
    }
  }

  console.log(`  ${OK} Updated ${totalUpdated.toLocaleString()} rows with opponent_champion_id`);

  // Check remaining NULLs (games where roles don't match or are NULL)
  const { rows: [{ n: remaining }] } = await pool.query(
    `SELECT COUNT(*) AS n FROM game_players WHERE opponent_champion_id IS NULL`
  );
  if (Number(remaining) > 0) {
    console.log(`  ${WARN} ${Number(remaining).toLocaleString()} rows still NULL (no matching role opponent)`);
  }
}

async function step2_playerKeystones() {
  console.log(`\n${BOLD}═══ STEP 2: Populate player_keystones ═══${RST}`);

  const { rows: [{ n: current }] } = await pool.query(`SELECT COUNT(*) AS n FROM player_keystones`);
  console.log(`  Currently: ${Number(current).toLocaleString()} rows`);

  // Get all series that have game_player_runes data but no player_keystones
  const { rows: series } = await pool.query(`
    SELECT DISTINCT g.serie_id
    FROM games g
    JOIN game_players gp ON gp.game_id = g.id
    JOIN game_player_runes gpr ON gpr.game_player_id = gp.id AND gpr.slot = 0
    WHERE g.serie_id IS NOT NULL
      AND g.serie_id NOT IN (SELECT DISTINCT serie_id FROM player_keystones WHERE serie_id IS NOT NULL)
    ORDER BY g.serie_id
  `);
  console.log(`  Series missing player_keystones: ${series.length}`);

  if (series.length === 0) {
    console.log(`  ${OK} Already populated — skipping`);
    return;
  }

  let totalInserted = 0;
  for (let i = 0; i < series.length; i++) {
    const sid = series[i].serie_id;
    const { rowCount } = await pool.query(`
      INSERT INTO player_keystones (player_id, serie_id, rune_id, rune_name, games, wins)
      SELECT gp.player_id, $1, gpr.rune_id, r.name, COUNT(*),
             SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END)
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_player_runes gpr ON gpr.game_player_id = gp.id AND gpr.slot = 0
      JOIN runes r ON r.id = gpr.rune_id
      WHERE g.serie_id = $1 AND g.finished = true
      GROUP BY gp.player_id, gpr.rune_id, r.name
      ON CONFLICT (player_id, serie_id, rune_id) DO UPDATE SET
        games = EXCLUDED.games, wins = EXCLUDED.wins, rune_name = EXCLUDED.rune_name
    `, [sid]);
    totalInserted += rowCount;
    if (i % 50 === 0 || i === series.length - 1) {
      console.log(`  [${i + 1}/${series.length}] Inserted ${totalInserted.toLocaleString()} so far...`);
    }
  }

  console.log(`  ${OK} Inserted ${totalInserted.toLocaleString()} player_keystones rows`);
}

async function step3_championMatchups() {
  console.log(`\n${BOLD}═══ STEP 3: Populate champion_matchups ═══${RST}`);

  // Check if opponent_champion_id is populated
  const { rows: [{ n: withOpp }] } = await pool.query(
    `SELECT COUNT(*) AS n FROM game_players WHERE opponent_champion_id IS NOT NULL`
  );
  if (Number(withOpp) === 0) {
    console.log(`  ${WARN} opponent_champion_id is all NULL — run step 1 first!`);
    return;
  }
  console.log(`  game_players with opponent_champion_id: ${Number(withOpp).toLocaleString()}`);

  // Get all series that have champion_global_stats but no champion_matchups
  const { rows: series } = await pool.query(`
    SELECT DISTINCT cgs.serie_id
    FROM champion_global_stats cgs
    WHERE cgs.serie_id NOT IN (SELECT DISTINCT serie_id FROM champion_matchups WHERE serie_id IS NOT NULL)
    ORDER BY cgs.serie_id
  `);
  console.log(`  Series missing champion_matchups: ${series.length}`);

  if (series.length === 0) {
    console.log(`  ${OK} Already populated — skipping`);
    return;
  }

  let totalInserted = 0;
  for (let i = 0; i < series.length; i++) {
    const sid = series[i].serie_id;
    const { rowCount } = await pool.query(`
      INSERT INTO champion_matchups (champion_id, serie_id, opponent_champion_id, opponent_name, games, wins)
      SELECT gp.champion_id, $1, gp.opponent_champion_id,
             ca.name, COUNT(*),
             SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END)
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.opponent_champion_id
      WHERE g.serie_id = $1 AND g.finished = true AND gp.opponent_champion_id IS NOT NULL
      GROUP BY gp.champion_id, gp.opponent_champion_id, ca.name
      ON CONFLICT (champion_id, serie_id, opponent_champion_id) DO UPDATE SET
        opponent_name = EXCLUDED.opponent_name, games = EXCLUDED.games, wins = EXCLUDED.wins
    `, [sid]);
    totalInserted += rowCount;
    if (i % 50 === 0 || i === series.length - 1) {
      console.log(`  [${i + 1}/${series.length}] Inserted ${totalInserted.toLocaleString()} so far...`);
    }
  }

  console.log(`  ${OK} Inserted ${totalInserted.toLocaleString()} champion_matchups rows`);
}

async function main() {
  console.log(`${BOLD}╔══════════════════════════════════════════════════════════════════╗${RST}`);
  console.log(`${BOLD}║          LeagueScope — Fix Missing Data                         ║${RST}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════════════════╝${RST}`);
  console.log(`  Step: ${stepArg}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);

  try {
    if (stepArg === 'all' || stepArg === '1') await step1_opponentChampionId();
    if (stepArg === 'all' || stepArg === '2') await step2_playerKeystones();
    if (stepArg === 'all' || stepArg === '3') await step3_championMatchups();

    console.log(`\n${OK} ${BOLD}DONE${RST}`);
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    console.error(err.stack);
  }

  await pool.end();
}

main();
