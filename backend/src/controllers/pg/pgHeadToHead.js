import { pgDb, resolveSerie, stageFilter } from './pgHelpers.js';

export async function getHeadToHeadPg(req, res) {
  const { league = 'LEC', year, split, stage, teamA, teamB } = req.query;
  if (!teamA || !teamB) {
    return res.status(400).json({ error: 'teamA and teamB query parameters are required' });
  }

  // 1. Resolve serie + stage
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json({ matchupHistory: [] });
  const { sf, stageParams } = stageFilter(stageParam, 4);

  // 2. Resolve team IDs from abbreviations
  const { rows: teamRows } = await pgDb.query(`
    SELECT DISTINCT t.id, t.acronym, t.name,
           COALESCE(t.dark_mode_image_url, t.image_url) AS image_url
    FROM teams t
    JOIN game_teams gt ON gt.team_id = t.id
    JOIN games g ON g.id = gt.game_id
    WHERE g.serie_id = $1 ${sf}
      AND UPPER(t.acronym) IN ($2, $3)
  `, [serieId, teamA.toUpperCase(), teamB.toUpperCase(), ...stageParams]);

  const tA = teamRows.find(t => t.acronym?.toUpperCase() === teamA.toUpperCase());
  const tB = teamRows.find(t => t.acronym?.toUpperCase() === teamB.toUpperCase());
  if (!tA || !tB) return res.json({ matchupHistory: [] });

  // 3. Find all games where both teams played each other
  const { rows: h2hGames } = await pgDb.query(`
    SELECT
      g.id AS game_id,
      g.begin_at,
      g.winner_id,
      g.length,
      g.match_id,
      gtA.color AS team_a_side,
      gtA.kills AS team_a_kills,
      gtB.color AS team_b_side,
      gtB.kills AS team_b_kills
    FROM games g
    JOIN game_teams gtA ON gtA.game_id = g.id AND gtA.team_id = $2
    JOIN game_teams gtB ON gtB.game_id = g.id AND gtB.team_id = $3
    WHERE g.serie_id = $1 ${sf} AND g.finished = true
    ORDER BY g.begin_at DESC NULLS LAST
  `, [serieId, tA.id, tB.id, ...stageParams]);

  const matchupHistory = h2hGames.map(g => ({
    gameid: g.game_id,
    match_id: g.match_id,
    date: g.begin_at,
    duration: g.length ? Math.round(g.length / 60) : null,
    team_a_win: g.winner_id === tA.id,
    team_b_win: g.winner_id === tB.id,
    team_a_side: g.team_a_side,
    team_b_side: g.team_b_side,
    team_a_kills: g.team_a_kills,
    team_b_kills: g.team_b_kills,
  }));

  res.json({
    teamA: { id: tA.id, abbr: tA.acronym, name: tA.name, logo_url: tA.image_url || null },
    teamB: { id: tB.id, abbr: tB.acronym, name: tB.name, logo_url: tB.image_url || null },
    matchupHistory,
    summary: {
      total: matchupHistory.length,
      team_a_wins: matchupHistory.filter(g => g.team_a_win).length,
      team_b_wins: matchupHistory.filter(g => g.team_b_win).length,
    },
  });
}
