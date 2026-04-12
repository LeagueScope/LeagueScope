const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgresql://leaguescope_user:AuronPlayHonorMagic8Pro@localhost:5432/leaguescope' });

async function debug() {
  // Find EBL recent matches
  const { rows: matches } = await pool.query(`
    SELECT m.id, m.name, m.status, m.winner_id, m.number_of_games, m.games_ingested_at,
           m.begin_at, m.end_at
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE l.name ILIKE '%EBL%'
      AND m.status = 'finished'
    ORDER BY m.begin_at DESC
    LIMIT 10
  `);

  for (const m of matches) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Match ${m.id}: ${m.name} | BO${m.number_of_games} | winner_id=${m.winner_id}`);
    console.log(`  status=${m.status} | ingested=${m.games_ingested_at ? 'YES' : 'NO'}`);
    console.log(`  begin=${m.begin_at} | end=${m.end_at}`);

    // Opponents
    const { rows: opps } = await pool.query(`
      SELECT mo.team_id, mo.side, mo.result_score, t.acronym, t.name
      FROM match_opponents mo
      JOIN teams t ON t.id = mo.team_id
      WHERE mo.match_id = $1
      ORDER BY mo.side
    `, [m.id]);
    for (const o of opps) {
      const isWinner = o.team_id === m.winner_id;
      console.log(`  [side ${o.side}] ${o.acronym} (${o.name}) id=${o.team_id} score=${o.result_score} ${isWinner ? '← WINNER' : ''}`);
    }

    // Games
    const { rows: games } = await pool.query(`
      SELECT g.id, g.finished, g.winner_id, g.length, g.patch
      FROM games g
      WHERE g.match_id = $1
      ORDER BY g.begin_at
    `, [m.id]);
    console.log(`  Games: ${games.length}`);
    for (const g of games) {
      console.log(`    game ${g.id}: finished=${g.finished} winner=${g.winner_id} length=${g.length}s patch=${g.patch}`);

      // Game teams (kills)
      const { rows: gts } = await pool.query(`
        SELECT gt.team_id, gt.color, gt.kills, gt.tower_kills, gt.dragon_kills, t.acronym
        FROM game_teams gt
        JOIN teams t ON t.id = gt.team_id
        WHERE gt.game_id = $1
      `, [g.id]);
      for (const gt of gts) {
        console.log(`      ${gt.acronym} (${gt.color}): kills=${gt.kills} towers=${gt.tower_kills} dragons=${gt.dragon_kills}`);
      }

      // Game players count
      const { rows: [{ count: playerCount }] } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM game_players WHERE game_id = $1', [g.id]
      );
      console.log(`      players: ${playerCount}`);
    }
  }

  await pool.end();
}

debug().catch(e => { console.error(e); process.exit(1); });
