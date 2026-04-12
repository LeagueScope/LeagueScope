import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.PG_DSN,
});

async function runQueries() {
  try {
    console.log('Connecting to database...\n');

    // Query 1: All LEC series for 2026
    console.log('=== Query 1: LEC Series 2026 ===');
    const series2026 = await pool.query(
      'SELECT id, full_name, year, season, begin_at FROM series WHERE league_id = 4197 AND year = 2026 ORDER BY begin_at'
    );
    console.log(series2026.rows);
    console.log(`Total: ${series2026.rowCount} rows\n`);

    // Query 2: Tournaments for each LEC 2026 series
    console.log('=== Query 2: Tournaments for LEC 2026 Series ===');
    const tournaments = await pool.query(
      'SELECT t.id, t.name, t.serie_id FROM tournaments t JOIN series s ON s.id = t.serie_id WHERE s.league_id = 4197 AND s.year = 2026 ORDER BY t.serie_id, t.begin_at'
    );
    console.log(tournaments.rows);
    console.log(`Total: ${tournaments.rowCount} rows\n`);

    // Query 3: champion_global_stats for LEC series
    console.log('=== Query 3: Champion Global Stats for LEC 2026 Series ===');
    const champStats = await pool.query(
      'SELECT serie_id, COUNT(*) AS champs, SUM(picks) AS total_picks, SUM(bans) AS total_bans FROM champion_global_stats WHERE serie_id IN (SELECT id FROM series WHERE league_id = 4197 AND year = 2026) GROUP BY serie_id'
    );
    console.log(champStats.rows);
    console.log(`Total: ${champStats.rowCount} rows\n`);

    // Query 4: team_career for LEC series
    console.log('=== Query 4: Team Career for LEC 2026 Series ===');
    const teamCareer = await pool.query(
      'SELECT serie_id, COUNT(*) AS teams, COUNT(*) FILTER (WHERE win_rate IS NOT NULL) AS with_wr FROM team_career WHERE serie_id IN (SELECT id FROM series WHERE league_id = 4197 AND year = 2026) GROUP BY serie_id'
    );
    console.log(teamCareer.rows);
    console.log(`Total: ${teamCareer.rowCount} rows\n`);

    // Query 5: player_career for LEC series
    console.log('=== Query 5: Player Career for LEC 2026 Series ===');
    const playerCareer = await pool.query(
      'SELECT serie_id, COUNT(*) AS players FROM player_career WHERE serie_id IN (SELECT id FROM series WHERE league_id = 4197 AND year = 2026) GROUP BY serie_id'
    );
    console.log(playerCareer.rows);
    console.log(`Total: ${playerCareer.rowCount} rows\n`);

    // Query 6: Check what "versus" might resolve to
    console.log('=== Query 6: Tournaments with "versus" in name ===');
    const versus = await pool.query(
      "SELECT t.id, t.name, s.full_name FROM tournaments t JOIN series s ON s.id = t.serie_id WHERE s.league_id = 4197 AND s.year >= 2025 AND (LOWER(t.name) LIKE '%versus%' OR LOWER(s.full_name) LIKE '%versus%') ORDER BY t.begin_at DESC"
    );
    console.log(versus.rows);
    console.log(`Total: ${versus.rowCount} rows\n`);

    // Query 7: All LEC series (not just 2026)
    console.log('=== Query 7: All Recent LEC Series (2025+) ===');
    const allSeries = await pool.query(
      'SELECT id, full_name, year, season FROM series WHERE league_id = 4197 AND year >= 2025 ORDER BY begin_at DESC LIMIT 10'
    );
    console.log(allSeries.rows);
    console.log(`Total: ${allSeries.rowCount} rows\n`);

    console.log('All queries completed successfully!');
  } catch (error) {
    console.error('Error running queries:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runQueries();
