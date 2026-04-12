#!/usr/bin/env node
/**
 * backfill-patches.js
 *
 * Finds all games with patch = NULL and fetches the patch from
 * PandaScore /lol/games/{id} endpoint, then updates the DB.
 *
 * Usage:
 *   node scripts/backfill-patches.js              # all NULL patches
 *   node scripts/backfill-patches.js --majors     # only LEC/LCS/LCK/LPL
 *   node scripts/backfill-patches.js --limit 50   # process max 50 games
 */

import 'dotenv/config';
import pg from 'pg';
import https from 'https';

const PG_DSN = process.env.PG_DSN;
const TOKEN = process.env.PANDASCORE_TOKEN;

if (!PG_DSN) { console.error('ERROR: PG_DSN not set'); process.exit(1); }
if (!TOKEN) { console.error('ERROR: PANDASCORE_TOKEN not set'); process.exit(1); }

const args = process.argv.slice(2);
const majorsOnly = args.includes('--majors');
const limitIdx = args.indexOf('--limit');
const maxGames = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 9999;

const poolCfg = { connectionString: PG_DSN, max: 2 };
if (PG_DSN.includes('rds.amazonaws.com')) poolCfg.ssl = { rejectUnauthorized: false };
const pool = new pg.Pool(poolCfg);

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.pandascore.co${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const leagueFilter = majorsOnly
    ? `AND UPPER(l.name) IN ('LEC','LCS','LCK','LPL')`
    : '';

  const { rows } = await pool.query(`
    SELECT g.id, g.begin_at::date AS date, l.name AS league
    FROM games g
    JOIN series s ON s.id = g.serie_id
    JOIN leagues l ON l.id = s.league_id
    WHERE g.patch IS NULL AND g.finished = true ${leagueFilter}
    ORDER BY g.begin_at DESC
    LIMIT $1
  `, [maxGames]);

  console.log(`Found ${rows.length} games with NULL patch`);
  if (!rows.length) { await pool.end(); return; }

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const game = rows[i];
    process.stdout.write(`[${i + 1}/${rows.length}] Game ${game.id} (${game.league} ${game.date})... `);

    try {
      const data = await apiGet(`/lol/games/${game.id}`);

      // Debug: log all keys and version-related fields for the first 3 games
      if (i < 3) {
        console.log(`\n  DEBUG match keys: ${Object.keys(data?.match || {}).join(', ')}`);
        console.log(`  DEBUG match.videogame_version: ${JSON.stringify(data?.match?.videogame_version)}`);
        console.log(`  DEBUG match.video_game_version: ${JSON.stringify(data?.match?.video_game_version)}`);
        console.log(`  DEBUG match.videogame: ${JSON.stringify(data?.match?.videogame)}`);
      }

      const patch = data?.videogame_version?.name || data?.videogame_version || data?.match?.videogame_version?.name || data?.patch || data?.version || null;

      if (patch) {
        await pool.query(`UPDATE games SET patch = $1 WHERE id = $2`, [patch, game.id]);
        console.log(`→ ${patch}`);
        updated++;
      } else {
        console.log('→ no patch in API');
        failed++;
      }
    } catch (e) {
      console.log(`→ ERROR: ${e.message}`);
      failed++;
    }

    // Rate limit: ~1.5 req/sec to be safe
    if (i < rows.length - 1) await sleep(700);
  }

  console.log(`\nDone: ${updated} updated, ${failed} failed/no-data`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
