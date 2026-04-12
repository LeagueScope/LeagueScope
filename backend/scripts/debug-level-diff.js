import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.PG_DSN });

// Get the player name from command line, or default
const targetName = process.argv[2] || null;

const { rows: [serie] } = await pool.query(`
  SELECT s.id FROM series s
  JOIN leagues l ON l.id = s.league_id
  WHERE l.slug LIKE '%lec%'
  ORDER BY s.year DESC, s.begin_at DESC LIMIT 1
`);
const serieId = serie.id;
console.log('Serie ID:', serieId);

// Pick the player
let playerQuery;
if (targetName) {
  playerQuery = await pool.query(`
    SELECT pc.player_id, p.name FROM player_career pc JOIN players p ON p.id = pc.player_id
    WHERE pc.serie_id = $1 AND LOWER(p.name) = LOWER($2) LIMIT 1
  `, [serieId, targetName]);
} else {
  // Pick a solo laner (top/mid) for better test
  playerQuery = await pool.query(`
    SELECT pc.player_id, p.name FROM player_career pc JOIN players p ON p.id = pc.player_id
    WHERE pc.serie_id = $1 AND pc.role IN ('top', 'mid') LIMIT 1
  `, [serieId]);
}
const player = playerQuery.rows[0];
if (!player) { console.log('Player not found'); process.exit(1); }
console.log(`Player: ${player.name} (${player.player_id})\n`);

// Get the raw frame diffs
const { rows: diffs } = await pool.query(`
  WITH player_games AS (
    SELECT gp.game_id, gp.role, gt.color AS side
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
    WHERE gp.player_id = $1 AND g.serie_id = $2
      AND g.finished = true AND g.length > 60 AND gp.role IS NOT NULL
  ),
  target_frames AS (
    SELECT pg.game_id, pg.role, pg.side,
           gf.id AS frame_id, gf.timestamp AS ts, t.minute_key,
           ROW_NUMBER() OVER (PARTITION BY pg.game_id, t.minute_key ORDER BY ABS(gf.timestamp - t.target_sec)) AS rn
    FROM player_games pg
    CROSS JOIN (VALUES (13, 780), (20, 1200), (25, 1500)) AS t(minute_key, target_sec)
    JOIN game_frames gf ON gf.game_id = pg.game_id AND ABS(gf.timestamp - t.target_sec) <= 90
  )
  SELECT tf.minute_key, tf.game_id,
         my.cs AS my_cs, opp.cs AS opp_cs, (my.cs - opp.cs) AS cs_diff,
         my.level AS my_level, opp.level AS opp_level,
         CASE WHEN my.level IS NOT NULL AND opp.level IS NOT NULL THEN my.level - opp.level END AS lvl_diff
  FROM target_frames tf
  JOIN game_frame_players my ON my.frame_id = tf.frame_id
    AND my.team_color = tf.side::team_color AND my.role = tf.role::player_role
  JOIN game_frame_players opp ON opp.frame_id = tf.frame_id
    AND opp.team_color != tf.side::team_color AND opp.role = tf.role::player_role
  WHERE tf.rn = 1 AND my.cs IS NOT NULL AND opp.cs IS NOT NULL
  ORDER BY tf.minute_key, tf.game_id
`, [player.player_id, serieId]);

// Group by minute and show each game + averages
const byMin = {};
for (const r of diffs) {
  if (!byMin[r.minute_key]) byMin[r.minute_key] = [];
  byMin[r.minute_key].push(r);
}

for (const [mk, rows] of Object.entries(byMin)) {
  console.log(`=== @${mk} (${rows.length} games) ===`);
  for (const r of rows) {
    console.log(`  game ${r.game_id}: cs_diff=${r.cs_diff}, lvl=${r.my_level}v${r.opp_level} → lvl_diff=${r.lvl_diff}`);
  }
  const csAvg = rows.reduce((s, r) => s + Number(r.cs_diff), 0) / rows.length;
  const lvlRows = rows.filter(r => r.lvl_diff != null);
  const lvlAvg = lvlRows.length > 0 ? lvlRows.reduce((s, r) => s + Number(r.lvl_diff), 0) / lvlRows.length : null;
  console.log(`  → CS AVG: ${csAvg.toFixed(1)}, LEVEL AVG: ${lvlAvg?.toFixed(2) ?? 'null'} (${lvlRows.length}/${rows.length} with level)\n`);
}

await pool.end();
