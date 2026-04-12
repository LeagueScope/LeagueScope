const pg = require('pg');
const https = require('https');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = fs.readFileSync(envPath, 'utf8');
const PG_DSN = env.match(/PG_DSN=(.+)/)?.[1]?.trim();
const TOKEN = env.match(/PANDASCORE_TOKEN=(.+)/)?.[1]?.trim();

const pool = new pg.Pool({ connectionString: PG_DSN });

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
  // Find finished matches with empty games (likely canceled)
  const { rows } = await pool.query(`
    SELECT m.id, m.name, m.status, m.league_id, l.name AS league_name
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE m.status = 'finished'
      AND m.games_ingested_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM games g
        WHERE g.match_id = m.id AND g.finished = true AND g.length > 0
      )
      AND EXISTS (
        SELECT 1 FROM games g WHERE g.match_id = m.id
      )
    ORDER BY m.league_id, m.id
  `);

  console.log(`Found ${rows.length} finished matches with empty games to check\n`);

  let fixed = 0;
  let apiCalls = 0;

  for (const row of rows) {
    // Check API for real status
    const match = await apiFetch(`/lol/matches/${row.id}`);
    apiCalls++;

    if (!match || !match.id) {
      console.log(`  [?] Match ${row.id} (${row.name}) — API returned nothing`);
      continue;
    }

    if (match.status === 'canceled' || match.status === 'postponed') {
      console.log(`  [FIX] ${row.league_name} — ${row.name} (${row.id}): DB=finished, API=${match.status}`);

      // Update match status
      await pool.query(
        `UPDATE matches SET status = $2, winner_id = NULL WHERE id = $1`,
        [row.id, match.status]
      );

      // Reset bogus scores
      await pool.query(
        `UPDATE match_opponents SET result_score = 0 WHERE match_id = $1`,
        [row.id]
      );

      fixed++;
    } else if (match.status === 'finished') {
      // Really finished but games are empty — PandaScore just doesn't have detailed data
      console.log(`  [OK]  ${row.league_name} — ${row.name} (${row.id}): API=finished (no game detail available)`);
    } else {
      console.log(`  [??]  ${row.league_name} — ${row.name} (${row.id}): API=${match.status}`);
    }

    // Rate limit
    if (apiCalls % 10 === 0) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${fixed} matches fixed to canceled/postponed, ${apiCalls} API calls`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
