#!/usr/bin/env node
/**
 * Debug: check match scores for minor leagues (NLC, LIT, EBL)
 * Usage: node scripts/debug-scores.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.PG_DSN });

async function main() {
  // NLC=4411, LIT=5211, EBL=4426
  const leagues = [
    { name: 'NLC', id: 4411 },
    { name: 'LIT', id: 5211 },
    { name: 'EBL', id: 4426 },
  ];

  for (const lg of leagues) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${lg.name} (league_id: ${lg.id})`);
    console.log('='.repeat(60));

    // Last 5 finished matches
    const { rows: matches } = await pool.query(`
      SELECT m.id, m.name, m.status, m.winner_id, m.games_ingested_at,
             m.end_at, m.number_of_games
      FROM matches m
      WHERE m.league_id = $1 AND m.status = 'finished'
      ORDER BY m.end_at DESC NULLS LAST
      LIMIT 5
    `, [lg.id]);

    if (!matches.length) {
      console.log('  No finished matches found.');
      continue;
    }

    for (const m of matches) {
      console.log(`\n  Match ${m.id}: ${m.name}`);
      console.log(`    status: ${m.status}, winner_id: ${m.winner_id}`);
      console.log(`    games_ingested_at: ${m.games_ingested_at}`);
      console.log(`    number_of_games: ${m.number_of_games}`);

      // Check opponents/scores
      const { rows: opps } = await pool.query(`
        SELECT mo.team_id, mo.side, mo.result_score,
               COALESCE(tb.display_name, t.name) AS team_name
        FROM match_opponents mo
        JOIN teams t ON t.id = mo.team_id
        LEFT JOIN team_brands tb ON tb.team_id = t.id AND tb.current = true
        WHERE mo.match_id = $1
        ORDER BY mo.side
      `, [m.id]);

      for (const o of opps) {
        console.log(`    Team ${o.team_name} (${o.team_id}): score=${o.result_score}`);
      }

      // Check games
      const { rows: games } = await pool.query(`
        SELECT g.id, g.finished, g.winner_id, g.length
        FROM games g
        WHERE g.match_id = $1
        ORDER BY g.position
      `, [m.id]);

      if (games.length === 0) {
        console.log(`    ⚠ NO GAMES in games table!`);
      } else {
        console.log(`    Games (${games.length}):`);
        for (const g of games) {
          console.log(`      game ${g.id}: finished=${g.finished}, winner=${g.winner_id}, length=${g.length}`);
        }
      }
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
