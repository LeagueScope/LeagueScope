const pg = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = fs.readFileSync(envPath, 'utf8');
const PG_DSN = env.match(/PG_DSN=(.+)/)?.[1]?.trim();
const TOKEN = env.match(/PANDASCORE_TOKEN=(.+)/)?.[1]?.trim();

const pool = new pg.Pool({ connectionString: PG_DSN });

const TRACKED = [293,294,4197,4198,302,5351,4141,2092,1003,5048,5049,4553,4961,5377,4996,4292,4302,5496,4411,5211,4426,5366];

function apiFetch(apiPath) {
  return new Promise((resolve, reject) => {
    const url = `https://api.pandascore.co${apiPath}${apiPath.includes('?') ? '&' : '?'}token=${TOKEN}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function main() {
  // Find ALL finished matches in tracked leagues that have NO real game data
  // (no game_teams, or all games are empty shells)
  const { rows } = await pool.query(`
    SELECT m.id, m.name, m.status, m.winner_id, l.name AS league_name
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE m.status = 'finished'
      AND m.league_id = ANY($1::int[])
      AND (
        -- No games at all
        NOT EXISTS (SELECT 1 FROM games g WHERE g.match_id = m.id)
        -- Or all games are empty shells
        OR NOT EXISTS (
          SELECT 1 FROM games g
          WHERE g.match_id = m.id AND g.finished = true AND g.length > 0
        )
      )
    ORDER BY l.name, m.id
  `, [TRACKED]);

  console.log(`Found ${rows.length} finished matches with no real game data to check against API\n`);

  let fixedCanceled = 0;
  let confirmedFinished = 0;
  let errors = 0;
  let apiCalls = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (i % 50 === 0 && i > 0) {
      console.log(`\n--- Progress: ${i}/${rows.length} (${fixedCanceled} canceled, ${confirmedFinished} legit finished) ---\n`);
    }

    let match;
    try {
      match = await apiFetch(`/lol/matches/${row.id}`);
      apiCalls++;
    } catch (e) {
      console.log(`  [ERR] ${row.id} ${row.name}: API error`);
      errors++;
      continue;
    }

    if (!match || !match.id) {
      console.log(`  [?]   ${row.league_name} — ${row.name} (${row.id}): API returned nothing`);
      errors++;
      continue;
    }

    if (match.status === 'canceled' || match.status === 'postponed') {
      console.log(`  [FIX] ${row.league_name} — ${row.name} (${row.id}): ${match.status}`);
      await pool.query(`UPDATE matches SET status = $2, winner_id = NULL WHERE id = $1`, [row.id, match.status]);
      await pool.query(`UPDATE match_opponents SET result_score = 0 WHERE match_id = $1`, [row.id]);
      fixedCanceled++;
    } else if (match.status === 'not_started') {
      console.log(`  [FIX] ${row.league_name} — ${row.name} (${row.id}): not_started (resetting)`);
      await pool.query(`UPDATE matches SET status = 'not_started', winner_id = NULL, games_ingested_at = NULL WHERE id = $1`, [row.id]);
      await pool.query(`UPDATE match_opponents SET result_score = NULL WHERE match_id = $1`, [row.id]);
      fixedCanceled++;
    } else {
      // Actually finished — PandaScore just doesn't have game details
      confirmedFinished++;
    }

    // Rate limit: 1 req/100ms
    if (apiCalls % 10 === 0) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Done: ${rows.length} checked, ${apiCalls} API calls`);
  console.log(`  ${fixedCanceled} fixed (canceled/postponed/not_started)`);
  console.log(`  ${confirmedFinished} confirmed finished (no detail available)`);
  console.log(`  ${errors} errors`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
