const https = require('https');
const fs = require('fs');
const pg = require('pg');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = fs.readFileSync(envPath, 'utf8');
const TOKEN = env.match(/PANDASCORE_TOKEN=(.+)/)?.[1]?.trim();
const PG_DSN = env.match(/PG_DSN=(.+)/)?.[1]?.trim();

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
  // Find LIT matches with "WIN" issue (finished, no kills)
  const { rows } = await pool.query(`
    SELECT m.id, m.name, m.status, m.winner_id, m.number_of_games, l.name AS league_name
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE l.name ILIKE '%LIT%'
      AND m.status = 'finished'
    ORDER BY m.begin_at DESC NULLS LAST
    LIMIT 10
  `);

  for (const row of rows) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[${row.league_name}] Match ${row.id}: ${row.name} | BO${row.number_of_games} | DB winner=${row.winner_id}`);

    // DB state
    const { rows: dbGames } = await pool.query(`
      SELECT g.id, g.finished, g.winner_id, g.length FROM games g WHERE g.match_id = $1
    `, [row.id]);
    const { rows: dbKills } = await pool.query(`
      SELECT gt.game_id, gt.team_id, gt.kills, t.acronym
      FROM game_teams gt
      JOIN teams t ON t.id = gt.team_id
      JOIN games g ON g.id = gt.game_id
      WHERE g.match_id = $1
    `, [row.id]);
    console.log(`  DB: ${dbGames.length} games, ${dbKills.length} game_teams rows`);
    for (const g of dbGames) {
      const kills = dbKills.filter(k => k.game_id === g.id);
      const killStr = kills.map(k => `${k.acronym}=${k.kills}`).join(', ');
      console.log(`    game ${g.id}: finished=${g.finished} winner=${g.winner_id} length=${g.length}s | kills: ${killStr || 'NONE'}`);
    }

    // API state
    const match = await apiFetch(`/lol/matches/${row.id}`);
    console.log(`  API: status=${match?.status} winner=${match?.winner_id}`);
    if (match?.results) {
      for (const r of match.results) console.log(`    Result: team ${r.team_id} score=${r.score}`);
    }

    const games = await apiFetch(`/lol/matches/${row.id}/games`);
    if (Array.isArray(games) && games.length > 0) {
      for (const g of games) {
        const hasTeams = g.teams && g.teams.length > 0;
        const hasPlayers = g.players && g.players.length > 0;
        console.log(`    API game ${g.id}: finished=${g.finished} winner=${g.winner?.id || null} length=${g.length}s teams=${hasTeams} players=${hasPlayers}`);
      }
    }
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
