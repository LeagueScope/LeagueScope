const pg = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = fs.readFileSync(envPath, 'utf8');
const PG_DSN = env.match(/PG_DSN=(.+)/)?.[1]?.trim();

const pool = new pg.Pool({ connectionString: PG_DSN });

async function main() {
  // Only tracked leagues
  const TRACKED = [293,294,4197,4198,302,5351,4141,2092,1003,5048,5049,4553,4961,5377,4996,4292,4302,5496,4411,5211,4426,5366];

  // Find matches where games exist and are finished, but have no game_teams data
  const { rows } = await pool.query(`
    SELECT DISTINCT m.id, m.name, l.name AS league_name
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    JOIN games g ON g.match_id = m.id
    WHERE m.status = 'finished'
      AND m.league_id = ANY($1::int[])
      AND g.finished = true
      AND g.length > 0
      AND m.scheduled_at >= '2024-01-01'
      AND NOT EXISTS (
        SELECT 1 FROM game_teams gt WHERE gt.game_id = g.id
      )
    ORDER BY l.name, m.id
  `, [TRACKED]);

  console.log(`Found ${rows.length} matches with finished games but no game_teams data\n`);

  let fixed = 0;
  for (const row of rows) {
    console.log(`[${row.league_name}] Re-ingesting match ${row.id}: ${row.name}...`);

    // Reset ingestion flag so fetch-to-postgres re-processes
    await pool.query(`UPDATE matches SET games_ingested_at = NULL WHERE id = $1`, [row.id]);

    try {
      execSync(
        `node scripts/fetch-to-postgres.js --match-id ${row.id} --skip-static`,
        {
          cwd: path.join(__dirname, '..'),
          env: { ...process.env, PG_DSN, PANDASCORE_TOKEN: env.match(/PANDASCORE_TOKEN=(.+)/)?.[1]?.trim() },
          stdio: 'pipe',
          timeout: 60000,
        }
      );

      // Mark as ingested again
      await pool.query(`UPDATE matches SET games_ingested_at = NOW() WHERE id = $1`, [row.id]);

      // Verify
      const { rows: [check] } = await pool.query(`
        SELECT COUNT(*)::int AS gt_count
        FROM game_teams gt
        JOIN games g ON g.id = gt.game_id
        WHERE g.match_id = $1
      `, [row.id]);

      if (check.gt_count > 0) {
        console.log(`  ✓ Fixed — ${check.gt_count} game_teams rows now`);
        fixed++;
      } else {
        console.log(`  ✗ Still no game_teams data after re-ingestion`);
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message.slice(0, 200)}`);
    }
  }

  console.log(`\nDone: ${fixed}/${rows.length} matches fixed`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
