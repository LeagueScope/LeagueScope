#!/usr/bin/env node
/**
 * debug-rune-paths.js — Show what PandaScore sends as primary_path/secondary_path
 * in the games endpoint, and what IDs we're storing in game_players.
 *
 * This reveals if PandaScore rune_paths have their own IDs separate from rune IDs.
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.PANDASCORE_TOKEN;
const PG_DSN = process.env.PG_DSN;
const pool = new pg.Pool({ connectionString: PG_DSN });
const BASE_URL = 'https://api.pandascore.co';

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries({ per_page: 100, ...params })) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`API ${res.status}: ${url.pathname}`);
  return res.json();
}

async function main() {
  // Fetch one game from each match
  const matches = [1350541, 1402258];

  console.log('═══════════════════════════════════════════════');
  console.log('  RUNE PATH STRUCTURE FROM PANDASCORE GAMES API');
  console.log('═══════════════════════════════════════════════\n');

  // Collect all unique path objects
  const pathsSeen = {};

  for (const matchId of matches) {
    const games = await apiGet(`/lol/matches/${matchId}/games`);
    console.log(`Match ${matchId}: ${games.length} games\n`);

    const game = games[0]; // Just check first game
    if (!game.players) { console.log('  No players!\n'); continue; }

    for (const p of game.players.slice(0, 3)) { // First 3 players
      const rr = p.runes_reforged || p.runes;
      if (!rr) { console.log(`  ${p.name}: no runes_reforged`); continue; }

      const pp = rr.primary_path || {};
      const sp = rr.secondary_path || {};

      console.log(`  ${p.name || p.player?.name}:`);
      console.log(`    primary_path: ${JSON.stringify(pp, null, 2).split('\n').join('\n    ')}`);
      console.log(`    secondary_path keys: ${JSON.stringify(Object.keys(sp))}`);
      console.log(`    secondary_path.id=${sp.id} name="${sp.name}"`);
      console.log('');

      if (pp.id) pathsSeen[pp.id] = pp.name;
      if (sp.id) pathsSeen[sp.id] = sp.name;
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ALL UNIQUE PATH IDs SEEN IN API');
  console.log('═══════════════════════════════════════════════');
  for (const [id, name] of Object.entries(pathsSeen)) {
    console.log(`  id=${id}  name="${name}"`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  DISTINCT PATH IDs IN game_players TABLE');
  console.log('═══════════════════════════════════════════════');
  const { rows: dbPaths } = await pool.query(`
    SELECT DISTINCT rune_primary_path_id AS pid FROM game_players WHERE rune_primary_path_id IS NOT NULL
    UNION
    SELECT DISTINCT rune_secondary_path_id FROM game_players WHERE rune_secondary_path_id IS NOT NULL
    ORDER BY pid
  `);
  for (const r of dbPaths) {
    // Lookup in rune_paths
    const { rows: rp } = await pool.query('SELECT name FROM rune_paths WHERE id = $1', [r.pid]);
    // Also check runes table
    const { rows: ru } = await pool.query('SELECT name FROM runes WHERE id = $1', [r.pid]);
    console.log(`  id=${r.pid}  rune_paths="${rp[0]?.name || 'NOT FOUND'}"  runes="${ru[0]?.name || 'NOT FOUND'}"`);
  }

  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
