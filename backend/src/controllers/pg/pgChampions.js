import { pgDb, ApiError, resolveLeagueId, resolveSerie, getChampMap, getRuneMap, rnd, mapRole, ensureArr, ensureObj, stageFilter } from './pgHelpers.js';

// ── getChampionsPg ────────────────────────────────────────────────────────────
// Returns the same shape as apiController.getChampions for the Pruebas55 page.
// Uses pre-aggregated champion_global_stats table.

export async function getChampionsPg(req, res) {
  const { league = 'LEC', year, split, stage } = req.query;

  // 1. Resolve serie
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json([]);
  const { sf, stageParams: sfParams } = stageFilter(stageParam, 2);

  // 2. Fetch champion stats + ban-only champions + champ map + team map + player-champ stats
  //    When stage filter is active, recalculate from game_players instead of precalculated tables
  const champQuery = stageParam
    ? `
      WITH pick_stats AS (
        SELECT
          ca.name AS champ_name,
          MIN(gp.champion_id) AS champion_id,
          COUNT(*) AS picks,
          SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
          ROUND(AVG(gp.kills)::numeric, 1) AS kills_avg,
          ROUND(AVG(gp.deaths)::numeric, 1) AS deaths_avg,
          ROUND(AVG(gp.assists)::numeric, 1) AS assists_avg,
          SUM(gp.kills) AS total_kills, SUM(gp.deaths) AS total_deaths, SUM(gp.assists) AS total_assists,
          SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_picks,
          SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_picks,
          SUM(CASE WHEN gt.color = 'blue' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS blue_wins,
          SUM(CASE WHEN gt.color = 'red' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS red_wins,
          ROUND(AVG(g.length)::numeric, 0) AS avg_game_duration,
          MODE() WITHIN GROUP (ORDER BY gp.role) AS main_role,
          ROUND(AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS dpm,
          ROUND(AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))::numeric, 0) AS gpm,
          ROUND(AVG(COALESCE(gp.creep_score, gp.minions_killed) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cspm,
          ROUND(AVG(gp.total_damage_taken / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_dtaken_pm,
          ROUND(AVG(CASE WHEN gp.first_blood_kill OR gp.first_blood_assist THEN 1 ELSE 0 END)::numeric * 100, 1) AS fb_rate,
          COUNT(DISTINCT gp.player_id) AS players_count,
          ROUND(AVG(CASE WHEN team_kills.tk > 0 THEN (gp.kills + gp.assists)::numeric / team_kills.tk * 100 ELSE 0 END), 1) AS kill_participation
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
        LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
        LEFT JOIN LATERAL (
          SELECT SUM(gp2.kills) AS tk FROM game_players gp2 WHERE gp2.game_id = gp.game_id AND gp2.team_id = gp.team_id
        ) team_kills ON true
        WHERE g.serie_id = $1 AND g.tournament_id = $2 AND g.finished = true AND g.length > 60
        GROUP BY ca.name
      ),
      ban_stats AS (
        SELECT
          ca.name AS champ_name,
          MIN(pb.champion_id) AS champion_id,
          COUNT(*) AS bans,
          SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS bans_blue,
          SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS bans_red
        FROM game_picks_bans pb
        JOIN games g ON g.id = pb.game_id
        JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = pb.team_id
        LEFT JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
        WHERE g.serie_id = $1 AND g.tournament_id = $2 AND g.finished = true AND pb.type = 'ban'
        GROUP BY ca.name
      ),
      total AS (
        SELECT COUNT(*) AS cnt FROM games WHERE serie_id = $1 AND tournament_id = $2 AND finished = true
      )
      SELECT
        COALESCE(p.champion_id, b.champion_id) AS champion_id,
        COALESCE(p.champ_name, b.champ_name) AS champion_name,
        COALESCE(p.picks, 0) AS picks,
        COALESCE(p.wins, 0) AS wins,
        COALESCE(p.picks, 0) - COALESCE(p.wins, 0) AS losses,
        CASE WHEN COALESCE(p.picks, 0) > 0
          THEN ROUND(p.wins::numeric / p.picks * 100, 1) ELSE 0 END AS win_rate,
        p.kills_avg, p.deaths_avg, p.assists_avg,
        CASE WHEN COALESCE(p.total_deaths, 0) > 0
          THEN ROUND((p.total_kills + p.total_assists)::numeric / p.total_deaths, 2)
          ELSE COALESCE(p.total_kills, 0) + COALESCE(p.total_assists, 0) END AS kda,
        COALESCE(b.bans, 0) AS bans,
        COALESCE(b.bans_blue, 0) AS bans_blue,
        COALESCE(b.bans_red, 0) AS bans_red,
        CASE WHEN t.cnt > 0 THEN ROUND(COALESCE(b.bans_blue, 0)::numeric / t.cnt * 100, 1) ELSE 0 END AS ban_rate_blue,
        CASE WHEN t.cnt > 0 THEN ROUND(COALESCE(b.bans_red, 0)::numeric / t.cnt * 100, 1) ELSE 0 END AS ban_rate_red,
        COALESCE(p.blue_picks, 0) AS blue_picks,
        COALESCE(p.red_picks, 0) AS red_picks,
        COALESCE(p.blue_wins, 0) AS blue_wins,
        COALESCE(p.red_wins, 0) AS red_wins,
        p.avg_game_duration,
        p.main_role,
        p.dpm, p.gpm, p.cspm, p.avg_dtaken_pm, p.fb_rate,
        p.players_count,
        p.kill_participation,
        t.cnt AS total_games_in_serie
      FROM pick_stats p
      FULL OUTER JOIN ban_stats b ON b.champ_name = p.champ_name
      CROSS JOIN total t
      ORDER BY COALESCE(p.picks, 0) DESC
    `
    : `
      SELECT cgs.*
      FROM champion_global_stats cgs
      WHERE cgs.serie_id = $1
      ORDER BY cgs.picks DESC
    `;

  const pcsQuery = stageParam
    ? `
      SELECT MIN(gp.champion_id) AS champion_id, ca.name AS champion_name,
             COUNT(*) AS games,
             SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
             ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0)), 2) AS kda,
             p.name AS player_name,
             MAX(gp.team_id) AS team_id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      JOIN players p ON p.id = gp.player_id
      WHERE g.serie_id = $1 AND g.tournament_id = $2 AND g.finished = true AND g.length > 60
      GROUP BY ca.name, gp.player_id, p.name
    `
    : `
      SELECT pcs.champion_id, pcs.champion_name, pcs.games, pcs.wins, pcs.kda,
             p.name AS player_name,
             COALESCE(
               pc.team_id,
               (SELECT gp.team_id FROM game_players gp
                JOIN games g2 ON g2.id = gp.game_id
                JOIN matches m2 ON m2.id = g2.match_id
                JOIN tournaments t2 ON t2.id = m2.tournament_id
                WHERE gp.player_id = pcs.player_id
                  AND t2.serie_id = pcs.serie_id
                LIMIT 1),
               p.current_team_id
             ) AS team_id
      FROM player_champion_stats pcs
      JOIN players p ON p.id = pcs.player_id
      LEFT JOIN player_career pc ON pc.player_id = pcs.player_id AND pc.serie_id = pcs.serie_id
      WHERE pcs.serie_id = $1
    `;

  const [{ rows: champRows }, { rows: banOnlyRows }, champMap, { rows: teamRows }, { rows: pcsRows }] = await Promise.all([
    pgDb.query(champQuery, [serieId, ...sfParams]),
    // Ban-only champions: banned in games but NOT picked
    pgDb.query(`
      SELECT pb.champion_id, COUNT(*) AS bans,
             ca.name AS champion_name,
             SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS bans_blue,
             SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS bans_red
      FROM game_picks_bans pb
      JOIN games g ON g.id = pb.game_id
      JOIN matches m ON m.id = g.match_id
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = pb.team_id
      JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
      LEFT JOIN champion_global_stats cgs
        ON cgs.champion_id = pb.champion_id AND cgs.serie_id = $1
      WHERE t.serie_id = $1 ${sf}
        AND pb.type = 'ban'
        AND cgs.champion_id IS NULL
      GROUP BY pb.champion_id, ca.name
      ORDER BY bans DESC
    `, [serieId, ...sfParams]),
    getChampMap(),
    pgDb.query(`SELECT id, acronym, image_url FROM teams`),
    pgDb.query(pcsQuery, [serieId, ...sfParams]),
  ]);

  // Build team_id → acronym map for resolving team_id references
  const teamAbbrMap = {};
  for (const t of teamRows) teamAbbrMap[t.id] = { abbr: t.acronym, logo: t.image_url };

  // Build champion_name → played_by[] from player_champion_stats (complete, not top-5)
  // Keyed by champion_name because pandascore_id may differ between pcs and cgs tables
  // Deduplicate by player_name + champion_name to avoid duplicates from team_id splits
  const champPlayedByMap = {};
  const _seenPB = new Set();
  for (const r of pcsRows) {
    const cName = (r.champion_name || '').toLowerCase();
    if (!cName) continue;
    const dedupeKey = `${r.player_name}::${cName}`;
    if (_seenPB.has(dedupeKey)) continue;
    _seenPB.add(dedupeKey);
    if (!champPlayedByMap[cName]) champPlayedByMap[cName] = [];
    const tInfo = teamAbbrMap[r.team_id] || {};
    champPlayedByMap[cName].push({
      name: r.player_name,
      team_abbr: tInfo.abbr || null,
      team_logo_url: tInfo.logo || null,
      games: Number(r.games),
      wins: Number(r.wins) || 0,
      kda: rnd(r.kda),
      win_rate: r.games > 0 ? rnd((r.wins || 0) / r.games * 100, 1) : 0,
    });
  }

  if (!champRows.length && !banOnlyRows.length) return res.json([]);

  // Total games in serie (for ban_rate)
  const totalGames = champRows[0]?.total_games_in_serie || 1;

  // 3. Map picked champions to frontend-expected shape
  const champions = await Promise.all(champRows.map(async c => {
    const tg = c.total_games_in_serie || 1;
    const pickRate = rnd(c.picks / tg * 100, 1);
    const banRate = rnd(c.bans / tg * 100, 1);
    const presence = rnd(pickRate + banRate, 1);

    // avg_duration formatted as MM:SS
    const avgDurSec = (c.avg_game_duration || 0);
    const avgMins = Math.floor(avgDurSec / 60);
    const avgSecs = Math.round(avgDurSec % 60);
    const avgDurFormatted = `${avgMins}:${String(avgSecs).padStart(2, '0')}`;

    // Blue/red WR
    const blueWr = c.blue_picks > 0 ? rnd(c.blue_wins / c.blue_picks * 100, 1) : 0;
    const redWr = c.red_picks > 0 ? rnd(c.red_wins / c.red_picks * 100, 1) : 0;

    // Champion image from cache
    const champ = champMap[c.champion_id] || {};
    const imageUrl = champ.image_url || null;

    // Position breakdown from champion_role_stats table
    const { rows: rolesRows } = await pgDb.query(`
      SELECT role, games FROM champion_role_stats
      WHERE champion_id = $1 AND serie_id = $2
    `, [c.champion_id, c.serie_id]);
    const rolesRaw = {};
    for (const r of rolesRows) {
      rolesRaw[r.role] = r.games;
    }
    const roleTotalGames = Object.values(rolesRaw).reduce((s, v) => s + (Number(v) || 0), 0) || 1;
    const posBreakdown = {};
    for (const [k, v] of Object.entries(rolesRaw)) {
      posBreakdown[mapRole(k)] = rnd((Number(v) || 0) / roleTotalGames * 100, 1);
    }

    return {
      // Identity
      name: c.champion_name || champ.name || `Champion ${c.champion_id}`,
      image_url: imageUrl,
      position: mapRole(c.main_role),
      position_breakdown: posBreakdown,

      // Basic
      games: c.picks,
      wins: c.wins,
      losses: c.losses,
      win_rate: rnd(c.win_rate, 1),

      // Presence
      picks: c.picks,
      pick_rate: pickRate,
      bans: c.bans,
      ban_rate: banRate,
      presence,

      // KDA
      avg_kills: rnd(c.kills_avg, 1),
      avg_deaths: rnd(c.deaths_avg, 1),
      avg_assists: rnd(c.assists_avg, 1),
      kda: rnd(c.kda),
      kill_participation: rnd(c.kill_participation, 1),

      // Per minute
      avg_gpm: rnd(c.gpm, 0),
      avg_cspm: rnd(c.cspm, 1),
      avg_dpm: rnd(c.dpm, 0),
      avg_dtaken_per_min: rnd(c.avg_dtaken_pm, 0),

      // Combat
      fb_rate: rnd(c.fb_rate, 1),

      // Side
      blue_picks: c.blue_picks || 0,
      blue_wins: c.blue_wins || 0,
      blue_wr: blueWr,
      red_picks: c.red_picks || 0,
      red_wins: c.red_wins || 0,
      red_wr: redWr,
      bans_blue: c.bans_blue || 0,
      bans_red: c.bans_red || 0,
      ban_rate_blue: rnd(c.ban_rate_blue, 1),
      ban_rate_red: rnd(c.ban_rate_red, 1),

      // Meta
      avg_game_duration: rnd(c.avg_game_duration, 1),
      avg_duration_formatted: avgDurFormatted,
      players_count: c.players_count,

      // Played by (from player_champion_stats — complete list, not just top 5)
      // Lookup by champion_name (lowercased) to handle pandascore_id mismatches
      played_by: (champPlayedByMap[(c.champion_name || '').toLowerCase()] || [])
        .sort((a, b) => b.games - a.games),
    };
  }));

  // 4. Add ban-only champions (never picked, only banned)
  const pickedNames = new Set(champions.map(c => c.name));
  for (const b of banOnlyRows) {
    const champ = champMap[b.champion_id] || {};
    const name = b.champion_name || champ.name || `Champion ${b.champion_id}`;
    // Safety: skip if already in list (dedup)
    if (pickedNames.has(name)) continue;
    pickedNames.add(name);

    const imageUrl = champ.image_url || null;
    const bans = Number(b.bans) || 0;
    const bansBlue = Number(b.bans_blue) || 0;
    const bansRed = Number(b.bans_red) || 0;
    const banRate = rnd(bans / totalGames * 100, 1);
    const banRateBlue = rnd(bansBlue / totalGames * 100, 1);
    const banRateRed = rnd(bansRed / totalGames * 100, 1);

    champions.push({
      name,
      image_url: imageUrl,
      position: null,
      position_breakdown: {},

      games: 0, wins: 0, losses: 0, win_rate: 0,
      picks: 0, pick_rate: 0,
      bans, ban_rate: banRate,
      bans_blue: bansBlue,
      bans_red: bansRed,
      ban_rate_blue: banRateBlue,
      ban_rate_red: banRateRed,
      presence: banRate,

      avg_kills: 0, avg_deaths: 0, avg_assists: 0, kda: 0, kill_participation: 0,
      avg_gpm: 0, avg_cspm: 0, avg_dpm: 0, avg_dtaken_per_min: 0,
      fb_rate: 0,
      blue_picks: 0, red_picks: 0,
      blue_wins: 0, red_wins: 0,
      blue_wr: null, red_wr: null,
      avg_game_duration: 0, avg_duration_formatted: '0:00', players_count: 0,
      played_by: [],
    });
  }

  res.json(champions);
}

// ── getChampionHistoryPg ────────────────────────────────────────────────────
// Returns cross-season champion history from PostgreSQL.
// Same JSON shape as the SQLite endpoint: { profile, career, players, roleHistory, matchLog }

export async function getChampionHistoryPg(req, res) {
  const { name } = req.params;
  const champName = decodeURIComponent(name).trim();
  if (!champName) throw new ApiError(400, 'Champion name is required');

  const champMap = await getChampMap();

  // 1. Resolve champion — find canonical champion by name
  const { rows: champRows } = await pgDb.query(`
    SELECT c.id, c.name, c.image_url, c.big_image_url
    FROM champions c
    WHERE LOWER(c.name) = LOWER($1)
    LIMIT 1
  `, [champName]);

  if (!champRows.length) throw new ApiError(404, `Champion "${champName}" not found`);
  const champ = champRows[0];

  // 2. Find all pandascore_ids for this canonical champion
  const { rows: aliasRows } = await pgDb.query(`
    SELECT pandascore_id FROM champion_aliases WHERE canonical_id = $1
  `, [champ.id]);
  const aliasIds = aliasRows.map(r => r.pandascore_id);
  if (!aliasIds.length) throw new ApiError(404, `No alias IDs for champion "${champName}"`);

  // 3. Get all champion_global_stats rows across all series for this champion
  const { rows: cgsRows } = await pgDb.query(`
    SELECT cgs.*,
           s.year, s.season AS split,
           l.slug AS league_slug, l.name AS league_name
    FROM champion_global_stats cgs
    JOIN series s ON s.id = cgs.serie_id
    JOIN leagues l ON l.id = s.league_id
    WHERE cgs.champion_id = ANY($1::int[])
    ORDER BY s.year DESC, s.begin_at DESC
  `, [aliasIds]);

  // 4. Get player stats for this champion across all series
  const { rows: pcsRows } = await pgDb.query(`
    SELECT pcs.player_id, pcs.serie_id,
           pcs.games, pcs.wins, pcs.losses, pcs.win_rate,
           pcs.kills_avg, pcs.deaths_avg, pcs.assists_avg, pcs.kda,
           p.name AS player_name, p.image_url AS player_image,
           p.role AS player_role,
           t.acronym AS team_abbr
    FROM player_champion_stats pcs
    JOIN players p ON p.id = pcs.player_id
    LEFT JOIN teams t ON t.id = p.current_team_id
    WHERE pcs.champion_id = ANY($1::int[])
    ORDER BY pcs.games DESC
  `, [aliasIds]);

  // 5. Get recent match log (last 200 games with this champion)
  const { rows: matchLogRows } = await pgDb.query(`
    SELECT
      gp.game_id,
      g.match_id,
      g.begin_at AS date,
      g.length AS duration,
      l.slug AS league,
      p.name AS player,
      t.acronym AS team_abbr,
      opp_t.acronym AS opponent_abbr,
      gp.kills, gp.deaths, gp.assists,
      CASE WHEN gp.deaths = 0 THEN (gp.kills + gp.assists)::real
           ELSE ROUND(((gp.kills + gp.assists)::numeric / gp.deaths), 2)::real END AS kda,
      CASE WHEN g.winner_id = gp.team_id THEN 'W' ELSE 'L' END AS result,
      gt.color AS side
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
    JOIN players p ON p.id = gp.player_id
    JOIN teams t ON t.id = gp.team_id
    LEFT JOIN leagues l ON l.id = g.league_id
    LEFT JOIN LATERAL (
      SELECT t2.acronym
      FROM game_teams gt2
      JOIN teams t2 ON t2.id = gt2.team_id
      WHERE gt2.game_id = g.id AND gt2.team_id != gp.team_id
      LIMIT 1
    ) opp_t ON true
    WHERE gp.champion_id = ANY($1::int[])
      AND g.finished = true AND g.length > 60
    ORDER BY g.begin_at DESC
    LIMIT 200
  `, [aliasIds]);

  // 6. Bans per patch+serie (not stored in patch_breakdown_json, compute live)
  const { rows: bansByPatchRows } = await pgDb.query(`
    SELECT g.serie_id, g.patch, COUNT(*) AS bans
    FROM game_picks_bans gpb
    JOIN games g ON g.id = gpb.game_id
    WHERE gpb.champion_id = ANY($1::int[])
      AND gpb.type = 'ban'
      AND g.patch IS NOT NULL
    GROUP BY g.serie_id, g.patch
  `, [aliasIds]);
  // Build lookup: { serie_id -> { patch -> bans } }
  const bansPatchMap = {};
  for (const r of bansByPatchRows) {
    if (!bansPatchMap[r.serie_id]) bansPatchMap[r.serie_id] = {};
    bansPatchMap[r.serie_id][r.patch] = Number(r.bans);
  }

  // 7. Total games per patch (globally, for pick/ban rate %)
  const serieIds = cgsRows.map(c => c.serie_id);
  const { rows: gamesPerPatchRows } = await pgDb.query(`
    SELECT patch, COUNT(*) AS total_games
    FROM games
    WHERE serie_id = ANY($1::int[])
      AND finished = true AND length > 60 AND patch IS NOT NULL
    GROUP BY patch
  `, [serieIds]);
  const gamesPerPatch = {};
  for (const r of gamesPerPatchRows) {
    gamesPerPatch[r.patch] = Number(r.total_games);
  }

  // ── Build response ────────────────────────────────────────────────────────

  // Career (per-season stats)
  const career = await Promise.all(cgsRows.map(async c => {
    const serieBans = bansPatchMap[c.serie_id] || {};
    // Query patch stats from champion_patch_stats table
    const { rows: patchStatsRows } = await pgDb.query(`
      SELECT patch, games, wins, bans FROM champion_patch_stats
      WHERE champion_id = $1 AND serie_id = $2
    `, [c.champion_id, c.serie_id]);
    const patchBreakdown = patchStatsRows.map(pb => ({
      patch: pb.patch,
      picks: pb.games ?? 0,
      bans: serieBans[pb.patch] ?? 0,
      wins: pb.wins ?? 0,
      win_rate: pb.picks > 0 ? rnd(pb.wins / pb.picks * 100, 1) : 0,
      total_games: gamesPerPatch[pb.patch] ?? 0,
    }));

    const totalGames = c.total_games_in_serie || 1;
    const picks = c.picks || 0;
    const bans = c.bans || 0;

    return {
      year: c.year,
      split: c.split,
      league: (c.league_slug || '').toUpperCase(),
      serie_id: c.serie_id,
      games: picks,
      picks,
      bans,
      wins: c.wins || 0,
      losses: c.losses || 0,
      win_rate: rnd(c.win_rate, 1),
      ban_rate: rnd(bans / totalGames * 100, 1),
      presence: rnd((picks + bans) / totalGames * 100, 1),
      avg_kills: rnd(c.kills_avg, 1),
      avg_deaths: rnd(c.deaths_avg, 1),
      avg_assists: rnd(c.assists_avg, 1),
      kda: rnd(c.kda, 2),
      avg_cspm: rnd(c.cspm, 1),
      avg_gpm: rnd(c.gpm, 0),
      avg_dpm: rnd(c.dpm, 0),
      avg_game_duration: rnd(c.avg_game_duration, 0),
      blue_wr: c.blue_picks > 0 ? rnd(c.blue_wins / c.blue_picks * 100, 1) : null,
      red_wr: c.red_picks > 0 ? rnd(c.red_wins / c.red_picks * 100, 1) : null,
      fb_rate: rnd(c.fb_rate, 1),
      kill_participation: rnd(c.kill_participation, 1),
      avg_damage_share: rnd(c.dmg_share, 1),
      patch_breakdown: patchBreakdown,
    };
  }));

  // Aggregate profile stats
  const totalGames = career.reduce((s, c) => s + (c.games || 0), 0);
  const totalWins = career.reduce((s, c) => s + (c.wins || 0), 0);
  const totalLosses = career.reduce((s, c) => s + (c.losses || 0), 0);
  const totalBans = career.reduce((s, c) => s + (c.bans || 0), 0);
  const wAvg = (key) => totalGames > 0
    ? career.reduce((s, c) => s + (c[key] ?? 0) * c.games, 0) / totalGames
    : 0;

  // Role distribution from champion_role_stats table
  const { rows: allRolesRows } = await pgDb.query(`
    SELECT role, SUM(games) AS total_games FROM champion_role_stats
    WHERE champion_id = ANY($1::int[])
    GROUP BY role
  `, [aliasIds]);
  const roleAgg = {};
  for (const r of allRolesRows) {
    const mapped = mapRole(r.role);
    roleAgg[mapped] = (roleAgg[mapped] || 0) + (Number(r.total_games) || 0);
  }
  const totalRoleGames = Object.values(roleAgg).reduce((s, v) => s + v, 0) || 1;
  const ROLE_ORDER = { top: 0, jng: 1, mid: 2, bot: 3, sup: 4 };
  const roleHistory = Object.entries(roleAgg)
    .map(([role, games]) => ({ role, games, percentage: rnd(games / totalRoleGames * 100, 1) }))
    .sort((a, b) => b.games - a.games);

  // Primary role = role with most games
  const primaryRole = roleHistory.length > 0 ? roleHistory[0].role : null;

  // Unique players count
  const uniquePlayerIds = new Set(pcsRows.map(r => r.player_id));

  // Unique patches played
  const uniquePatches = new Set();
  for (const c of career) {
    for (const pb of c.patch_breakdown || []) {
      if (pb.patch) uniquePatches.add(pb.patch);
    }
  }

  const profile = {
    name: champ.name,
    image_url: champ.image_url,
    career_games: totalGames,
    career_wins: totalWins,
    career_losses: totalLosses,
    career_bans: totalBans,
    career_wr: totalGames > 0 ? rnd(totalWins / totalGames * 100, 1) : 0,
    career_kda: rnd(wAvg('kda'), 2),
    career_avg_kills: rnd(wAvg('avg_kills'), 1),
    career_avg_deaths: rnd(wAvg('avg_deaths'), 1),
    career_avg_assists: rnd(wAvg('avg_assists'), 1),
    seasons_played: career.length,
    patches_played: uniquePatches.size,
    unique_players: uniquePlayerIds.size,
    primary_role: primaryRole,
    role_distribution: roleHistory,
  };

  // Aggregate players across all series
  const playerMap = {};
  for (const p of pcsRows) {
    if (!playerMap[p.player_id]) {
      playerMap[p.player_id] = {
        name: p.player_name,
        image_url: p.player_image,
        team_abbr: p.team_abbr,
        role: mapRole(p.player_role),
        games: 0, wins: 0,
        kill_sum: 0, death_sum: 0, assist_sum: 0,
        seasons: new Set(),
      };
    }
    const pm = playerMap[p.player_id];
    pm.games += (p.games || 0);
    pm.wins += (p.wins || 0);
    pm.kill_sum += (p.kills_avg || 0) * (p.games || 0);
    pm.death_sum += (p.deaths_avg || 0) * (p.games || 0);
    pm.assist_sum += (p.assists_avg || 0) * (p.games || 0);
    pm.seasons.add(p.serie_id);
  }

  const players = Object.values(playerMap)
    .map(p => ({
      name: p.name,
      image_url: p.image_url,
      team_abbr: p.team_abbr,
      role: p.role,
      games: p.games,
      wins: p.wins,
      win_rate: p.games > 0 ? rnd(p.wins / p.games * 100, 1) : 0,
      kda: p.death_sum > 0 ? rnd((p.kill_sum + p.assist_sum) / p.death_sum, 2) : rnd(p.kill_sum + p.assist_sum, 2),
      avg_kills: p.games > 0 ? rnd(p.kill_sum / p.games, 1) : 0,
      avg_deaths: p.games > 0 ? rnd(p.death_sum / p.games, 1) : 0,
      avg_assists: p.games > 0 ? rnd(p.assist_sum / p.games, 1) : 0,
      seasons_count: p.seasons.size,
    }))
    .sort((a, b) => b.games - a.games);

  // Match log
  const matchLog = matchLogRows.map(m => ({
    game_id: m.game_id,
    match_id: m.match_id,
    date: m.date,
    duration: m.duration,
    league: (m.league || '').toUpperCase(),
    player: m.player,
    team_abbr: m.team_abbr,
    opponent_abbr: m.opponent_abbr,
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    kda: m.kda != null ? parseFloat(m.kda) : null,
    result: m.result,
    side: m.side,
  }));

  res.json({ profile, career, players, roleHistory, matchLog });
}

// ── getChampionByNamePg ─────────────────────────────────────────────────────
// Returns single-champion profile for a given serie (league + filters).
// Same JSON shape as the SQLite endpoint: flat object with stats, matchups, items, etc.

export async function getChampionByNamePg(req, res) {
  const { name } = req.params;
  const { league = 'LEC', year, split, stage } = req.query;
  const champName = decodeURIComponent(name).trim();
  if (!champName) throw new ApiError(400, 'Champion name is required');

  // 1. Resolve serie
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) throw new ApiError(404, 'Serie not found');
  const { sf, stageParams: sfParams } = stageFilter(stageParam, 3);

  // 2. Find the champion — use champion_global_stats (precalculated) or recalculate from games when stage active
  const [champMap, runeMap] = await Promise.all([getChampMap(), getRuneMap()]);

  // Always get the precalculated row first (needed for JSON fields like matchups, keystones, patches)
  const { rows: cgsRows } = await pgDb.query(`
    SELECT cgs.*
    FROM champion_global_stats cgs
    JOIN champion_aliases ca ON ca.pandascore_id = cgs.champion_id
    JOIN champions ch ON ch.id = ca.canonical_id
    WHERE cgs.serie_id = $1 AND LOWER(ch.name) = LOWER($2)
    LIMIT 1
  `, [serieId, champName]);

  if (!cgsRows.length) throw new ApiError(404, `Champion "${champName}" not found in this serie`);
  let c = cgsRows[0];

  // When stage is active, override numeric stats with live calculation from game_players
  if (stageParam) {
    const { rows: liveRows } = await pgDb.query(`
      SELECT
        MIN(gp.champion_id) AS champion_id,
        ca.name AS champion_name,
        COUNT(*) AS picks,
        SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
        COUNT(*) - SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS losses,
        ROUND(SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate,
        ROUND(AVG(gp.kills)::numeric, 1) AS kills_avg,
        ROUND(AVG(gp.deaths)::numeric, 1) AS deaths_avg,
        ROUND(AVG(gp.assists)::numeric, 1) AS assists_avg,
        CASE WHEN SUM(gp.deaths) > 0
          THEN ROUND((SUM(gp.kills) + SUM(gp.assists))::numeric / SUM(gp.deaths), 2)
          ELSE SUM(gp.kills) + SUM(gp.assists) END AS kda,
        ROUND(AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS dpm,
        ROUND(AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))::numeric, 0) AS gpm,
        ROUND(AVG(COALESCE(gp.creep_score, gp.minions_killed) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cspm,
        ROUND(AVG(g.length)::numeric, 0) AS avg_game_duration,
        SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_picks,
        SUM(CASE WHEN gt.color = 'blue' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS blue_wins,
        SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_picks,
        SUM(CASE WHEN gt.color = 'red' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS red_wins,
        (SELECT COUNT(*) FROM games g2 WHERE g2.serie_id = $1 AND g2.tournament_id = $3 AND g2.finished = true) AS total_games_in_serie
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE gp.champion_id = ANY(
        SELECT ca2.pandascore_id FROM champion_aliases ca2
        JOIN champions ch2 ON ch2.id = ca2.canonical_id
        WHERE LOWER(ch2.name) = LOWER($2)
      )
        AND g.serie_id = $1 AND g.tournament_id = $3
        AND g.finished = true AND g.length > 60
      GROUP BY ca.name
    `, [serieId, champName, ...sfParams]);

    // Get bans for this champion in this stage
    const { rows: banRows } = await pgDb.query(`
      SELECT COUNT(*) AS bans,
             SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS bans_blue,
             SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS bans_red
      FROM game_picks_bans pb
      JOIN games g ON g.id = pb.game_id
      JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = pb.team_id
      WHERE pb.champion_id = ANY(
        SELECT ca2.pandascore_id FROM champion_aliases ca2
        JOIN champions ch2 ON ch2.id = ca2.canonical_id
        WHERE LOWER(ch2.name) = LOWER($2)
      )
        AND g.serie_id = $1 AND g.tournament_id = $3
        AND g.finished = true AND pb.type = 'ban'
    `, [serieId, champName, ...sfParams]);

    // Also recalculate secondary stats: multikills, dtaken, shares, matchups, keystones, patches, top_players
    const champIds = `(SELECT ca2.pandascore_id FROM champion_aliases ca2 JOIN champions ch2 ON ch2.id = ca2.canonical_id WHERE LOWER(ch2.name) = LOWER($2))`;
    const [{ rows: extraRows }, { rows: matchupRows }, { rows: keystoneRows }, { rows: patchRows }, { rows: tpRows }] = await Promise.all([
      // Extra stats: multikills, dtaken, shares, kill_participation
      pgDb.query(`
        SELECT
          SUM(COALESCE(gp.double_kills, 0)) AS double_kills,
          SUM(COALESCE(gp.triple_kills, 0)) AS triple_kills,
          SUM(COALESCE(gp.quadra_kills, 0)) AS quadra_kills,
          SUM(COALESCE(gp.penta_kills, 0)) AS penta_kills,
          ROUND(AVG(gp.total_damage_taken / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_dtaken_pm,
          ROUND(AVG(gp.total_damage_dealt_to_champions_percentage)::numeric, 1) AS dmg_share,
          ROUND(AVG(gp.gold_percentage)::numeric, 1) AS gold_share,
          ROUND(AVG(gp.physical_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_physical_dpm,
          ROUND(AVG(gp.magic_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_magic_dpm,
          ROUND(AVG(gp.true_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_true_dpm,
          ROUND(AVG(gp.wards_placed / NULLIF(g.length / 60.0, 0))::numeric, 2) AS avg_wpm,
          ROUND(AVG(gp.kills_wards / NULLIF(g.length / 60.0, 0))::numeric, 2) AS avg_wcpm
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE gp.champion_id = ANY${champIds} AND g.serie_id = $1 AND g.tournament_id = $3
          AND g.finished = true AND g.length > 60
      `, [serieId, champName, ...sfParams]),
      // Matchups: opponent champion stats
      pgDb.query(`
        SELECT ca_opp.name AS champion, COUNT(*) AS games,
               ROUND(SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_players opp ON opp.game_id = g.id AND opp.team_id != gp.team_id AND opp.role = gp.role
        LEFT JOIN champion_aliases ca_opp ON ca_opp.pandascore_id = opp.champion_id
        WHERE gp.champion_id = ANY${champIds} AND g.serie_id = $1 AND g.tournament_id = $3
          AND g.finished = true AND g.length > 60
        GROUP BY ca_opp.name
        HAVING COUNT(*) >= 1
      `, [serieId, champName, ...sfParams]),
      // Keystones
      pgDb.query(`
        SELECT r.name, r.image_url, COUNT(*) AS count
        FROM game_player_runes gpr
        JOIN game_players gp ON gp.id = gpr.game_player_id
        JOIN games g ON g.id = gp.game_id
        JOIN runes r ON r.id = gpr.rune_id
        WHERE gp.champion_id = ANY${champIds} AND g.serie_id = $1 AND g.tournament_id = $3
          AND g.finished = true AND gpr.tree = 'primary' AND gpr.slot = 0
        GROUP BY r.name, r.image_url
        ORDER BY count DESC
      `, [serieId, champName, ...sfParams]),
      // Patches
      pgDb.query(`
        SELECT g.patch, COUNT(*) AS picks,
               SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE gp.champion_id = ANY${champIds} AND g.serie_id = $1 AND g.tournament_id = $3
          AND g.finished = true AND g.length > 60
        GROUP BY g.patch ORDER BY g.patch
      `, [serieId, champName, ...sfParams]),
      // Top players
      pgDb.query(`
        SELECT p.name, p.image_url AS player_image, gp.team_id,
               t.acronym AS team_abbr,
               COALESCE(t.dark_mode_image_url, t.image_url) AS team_logo_url,
               COUNT(*) AS games,
               SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
               ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0)), 2) AS kda
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN players p ON p.id = gp.player_id
        LEFT JOIN teams t ON t.id = gp.team_id
        WHERE gp.champion_id = ANY${champIds} AND g.serie_id = $1 AND g.tournament_id = $3
          AND g.finished = true AND g.length > 60
        GROUP BY p.name, p.image_url, gp.team_id, t.acronym, t.dark_mode_image_url, t.image_url
        ORDER BY COUNT(*) DESC
      `, [serieId, champName, ...sfParams]),
    ]);

    const ex = extraRows[0] || {};

    if (liveRows.length) {
      const live = liveRows[0];
      const ban = banRows[0] || {};
      c = {
        ...c,
        champion_id: live.champion_id || c.champion_id,
        picks: Number(live.picks),
        wins: Number(live.wins),
        losses: Number(live.losses),
        win_rate: Number(live.win_rate),
        kills_avg: Number(live.kills_avg),
        deaths_avg: Number(live.deaths_avg),
        assists_avg: Number(live.assists_avg),
        kda: Number(live.kda),
        dpm: Number(live.dpm),
        gpm: Number(live.gpm),
        cspm: Number(live.cspm),
        avg_game_duration: Number(live.avg_game_duration),
        blue_picks: Number(live.blue_picks),
        blue_wins: Number(live.blue_wins),
        red_picks: Number(live.red_picks),
        red_wins: Number(live.red_wins),
        total_games_in_serie: Number(live.total_games_in_serie),
        bans: Number(ban.bans || 0),
        bans_blue: Number(ban.bans_blue || 0),
        bans_red: Number(ban.bans_red || 0),
        ban_rate_blue: live.total_games_in_serie > 0 ? rnd((ban.bans_blue || 0) / live.total_games_in_serie * 100, 1) : 0,
        ban_rate_red: live.total_games_in_serie > 0 ? rnd((ban.bans_red || 0) / live.total_games_in_serie * 100, 1) : 0,
        // Extra stats from live query
        double_kills: Number(ex.double_kills || 0),
        triple_kills: Number(ex.triple_kills || 0),
        quadra_kills: Number(ex.quadra_kills || 0),
        penta_kills: Number(ex.penta_kills || 0),
        avg_dtaken_pm: Number(ex.avg_dtaken_pm || 0),
        dmg_share: Number(ex.dmg_share || 0),
        gold_share: Number(ex.gold_share || 0),
        avg_physical_dpm: Number(ex.avg_physical_dpm || 0),
        avg_magic_dpm: Number(ex.avg_magic_dpm || 0),
        avg_true_dpm: Number(ex.avg_true_dpm || 0),
        avg_wpm: Number(ex.avg_wpm || 0),
        avg_wcpm: Number(ex.avg_wcpm || 0),
        players_count: tpRows.length,
        // Override JSON fields with live data
        matchups_json: matchupRows,
        keystones_json: keystoneRows.map(k => ({ name: k.name, image_url: k.image_url, count: Number(k.count), pct: live.picks > 0 ? rnd(Number(k.count) / live.picks * 100, 1) : 0 })),
        patch_breakdown_json: patchRows.map(p => ({ patch: p.patch, picks: Number(p.picks), bans: 0, wins: Number(p.wins), win_rate: p.picks > 0 ? rnd(p.wins / p.picks * 100, 1) : 0 })),
        top_players_json: tpRows.map(tp => ({
          name: tp.name, team_abbr: tp.team_abbr, team_logo_url: tp.team_logo_url, team_id: tp.team_id, games: Number(tp.games), wins: Number(tp.wins),
          kda: Number(tp.kda), win_rate: tp.games > 0 ? rnd(tp.wins / tp.games * 100, 1) : 0,
        })),
      };
    } else {
      // Champion was NOT picked in this specific stage — zero out all stats
      // (ban-only presence is still possible via the ban query above)
      const ban = banRows[0] || {};
      const totalGamesStage = await pgDb.query(
        `SELECT COUNT(*) AS cnt FROM games WHERE serie_id = $1 AND tournament_id = $2 AND finished = true`,
        [serieId, sfParams[0]]
      ).then(r => Number(r.rows[0]?.cnt || 0));

      c = {
        ...c,
        picks: 0, wins: 0, losses: 0, win_rate: 0,
        kills_avg: 0, deaths_avg: 0, assists_avg: 0, kda: 0,
        dpm: 0, gpm: 0, cspm: 0, avg_game_duration: 0,
        blue_picks: 0, blue_wins: 0, red_picks: 0, red_wins: 0,
        total_games_in_serie: totalGamesStage,
        bans: Number(ban.bans || 0),
        bans_blue: Number(ban.bans_blue || 0),
        bans_red: Number(ban.bans_red || 0),
        ban_rate_blue: totalGamesStage > 0 ? rnd((ban.bans_blue || 0) / totalGamesStage * 100, 1) : 0,
        ban_rate_red: totalGamesStage > 0 ? rnd((ban.bans_red || 0) / totalGamesStage * 100, 1) : 0,
        double_kills: 0, triple_kills: 0, quadra_kills: 0, penta_kills: 0,
        avg_dtaken_pm: 0, dmg_share: 0, gold_share: 0,
        avg_physical_dpm: 0, avg_magic_dpm: 0, avg_true_dpm: 0,
        avg_wpm: 0, avg_wcpm: 0, players_count: 0,
        kill_participation: 0, fb_rate: 0,
        matchups_json: [], keystones_json: [], patch_breakdown_json: [], top_players_json: [],
        roles_json: {},
      };
    }
  }

  // Resolve ALL pandascore_ids for this champion (handles aliases)
  const champIds = `(SELECT ca2.pandascore_id FROM champion_aliases ca2 JOIN champions ch2 ON ch2.id = ca2.canonical_id WHERE LOWER(ch2.name) = LOWER($2))`;

  // 3. Get match log for this champion in this serie
  const { rows: matchLogRows } = await pgDb.query(`
    SELECT
      gp.game_id,
      g.begin_at AS date,
      g.length AS duration,
      p.name AS player,
      gp.team_id,
      t.acronym AS team_abbr,
      COALESCE(t.dark_mode_image_url, t.image_url) AS team_logo,
      opp_t.team_id AS opponent_team_id,
      opp_t.acronym AS opponent_abbr,
      opp_t.logo AS opponent_logo,
      gp.kills, gp.deaths, gp.assists,
      CASE WHEN g.winner_id = gp.team_id THEN 'W' ELSE 'L' END AS result,
      gt.color AS side
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
    JOIN players p ON p.id = gp.player_id
    JOIN teams t ON t.id = gp.team_id
    LEFT JOIN LATERAL (
      SELECT t2.id AS team_id, t2.acronym, COALESCE(t2.dark_mode_image_url, t2.image_url) AS logo
      FROM game_teams gt2
      JOIN teams t2 ON t2.id = gt2.team_id
      WHERE gt2.game_id = g.id AND gt2.team_id != gp.team_id
      LIMIT 1
    ) opp_t ON true
    WHERE gp.champion_id = ANY${champIds}
      AND g.serie_id = $1 ${sf}
      AND g.finished = true AND g.length > 60
    ORDER BY g.begin_at DESC
    LIMIT 200
  `, [serieId, champName, ...sfParams]);

  // 3b. Compute per-game ward stats + FB stats from game_players (not in pre-aggregated table)
  const { rows: wardRows } = await pgDb.query(`
    SELECT
      ROUND(AVG(gp.wards_placed)::numeric, 1) AS avg_wards_placed,
      ROUND(AVG(gp.kills_wards)::numeric, 1) AS avg_wards_destroyed,
      ROUND(AVG(gp.vision_wards_bought_in_game)::numeric, 1) AS avg_ctrl_wards,
      SUM(CASE WHEN gp.first_blood_kill = true THEN 1 ELSE 0 END) AS fb_kills,
      SUM(CASE WHEN gp.first_blood_assist = true THEN 1 ELSE 0 END) AS fb_assists
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.champion_id = ANY${champIds}
      AND g.serie_id = $1 ${sf}
      AND g.finished = true AND g.length > 60
  `, [serieId, champName, ...sfParams]);
  const ws = wardRows[0] || {};

  // 4. Build response
  const totalGames = c.total_games_in_serie || 1;
  const pickRate = rnd(c.picks / totalGames * 100, 1);
  const banRate = rnd(c.bans / totalGames * 100, 1);
  const presence = rnd(pickRate + banRate, 1);

  const avgDurSec = c.avg_game_duration || 0;
  const avgMins = Math.floor(avgDurSec / 60);
  const avgSecs = Math.round(avgDurSec % 60);
  const avgDurFormatted = `${avgMins}:${String(avgSecs).padStart(2, '0')}`;

  const blueWr = c.blue_picks > 0 ? rnd(c.blue_wins / c.blue_picks * 100, 1) : null;
  const redWr = c.red_picks > 0 ? rnd(c.red_wins / c.red_picks * 100, 1) : null;

  const champ = champMap[c.champion_id] || {};
  const imageUrl = champ.image_url || null;

  // roles_json — query from champion_role_stats table
  const { rows: champRolesRows } = await pgDb.query(`
    SELECT role, games FROM champion_role_stats
    WHERE champion_id = $1 AND serie_id = $2
  `, [c.champion_id, c.serie_id]);
  const rolesRaw = {};
  for (const r of champRolesRows) {
    rolesRaw[r.role] = r.games;
  }
  const roleTotalGames = Object.values(rolesRaw).reduce((s, v) => s + (Number(v) || 0), 0) || 1;
  const posBreakdown = {};
  for (const [k, v] of Object.entries(rolesRaw)) {
    posBreakdown[mapRole(k)] = rnd((Number(v) || 0) / roleTotalGames * 100, 1);
  }

  // Top players from champion_top_players table — resolve team info via player_career
  const { rows: topPlayersRows } = await pgDb.query(`
    SELECT ctp.player_id, ctp.player_name, ctp.games, ctp.wins, ctp.kda,
           p.image_url AS player_image_url,
           COALESCE(tb.display_acronym, t.acronym) AS team_abbr,
           COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS team_logo_url
    FROM champion_top_players ctp
    LEFT JOIN players p ON p.id = ctp.player_id
    LEFT JOIN player_career pc ON pc.player_id = ctp.player_id AND pc.serie_id = ctp.serie_id
    LEFT JOIN teams t ON t.id = pc.team_id
    LEFT JOIN team_brands tb ON tb.team_id = pc.team_id
      AND (SELECT year FROM series WHERE id = ctp.serie_id) BETWEEN tb.year_start AND tb.year_end
    WHERE ctp.champion_id = $1 AND ctp.serie_id = $2
    ORDER BY ctp.games DESC
  `, [c.champion_id, c.serie_id]);
  const playedBy = topPlayersRows.map(tp => {
    return {
      name: tp.player_name,
      player_image_url: tp.player_image_url || null,
      team_abbr: tp.team_abbr || null,
      team_logo_url: tp.team_logo_url || null,
      games: tp.games,
      wins: tp.wins,
      losses: tp.games - (tp.wins || 0),
      kda: rnd(tp.kda),
      win_rate: tp.games > 0 ? rnd((tp.wins || 0) / tp.games * 100, 1) : null,
    };
  });

  // Matchups from champion_matchups table
  const champByName = {};
  for (const v of Object.values(champMap)) if (v.name) champByName[v.name.toLowerCase()] = v;

  const { rows: matchupsRows } = await pgDb.query(`
    SELECT opponent_champion_id, opponent_name, games, wins
    FROM champion_matchups
    WHERE champion_id = $1 AND serie_id = $2
  `, [c.champion_id, c.serie_id]);
  const mapMatchup = (m) => {
    const mName = m.opponent_name;
    const info = champByName[mName?.toLowerCase()] || {};
    const winRate = m.games > 0 ? rnd(m.wins / m.games * 100, 1) : 0;
    return {
      champion: mName,
      image_url: info.image_url || null,
      games: m.games,
      win_rate: winRate,
    };
  };
  const allMatchups = matchupsRows.map(mapMatchup);
  const minGames = stageParam ? 1 : 2;
  const bestMatchups = allMatchups
    .filter(m => m.games >= minGames && m.win_rate >= 50)
    .sort((a, b) => b.win_rate - a.win_rate || b.games - a.games)
    .slice(0, 5);
  const worstMatchups = allMatchups
    .filter(m => m.games >= minGames && m.win_rate < 50)
    .sort((a, b) => a.win_rate - b.win_rate || b.games - a.games)
    .slice(0, 5);

  // Items: aggregate in SQL to avoid huge unnest result sets in Node
  const champIds2 = `(SELECT ca2.pandascore_id FROM champion_aliases ca2 JOIN champions ch2 ON ch2.id = ca2.canonical_id WHERE LOWER(ch2.name) = LOWER($2))`;
  const { rows: itemAggRows } = await pgDb.query(`
    SELECT sub.item_id, i.name, i.image_url,
           COUNT(*) AS count,
           SUM(CASE WHEN sub.won THEN 1 ELSE 0 END) AS wins
    FROM (
      SELECT unnest(gp.items) AS item_id,
             g.winner_id = gp.team_id AS won
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.champion_id = ANY${champIds2}
        AND g.serie_id = $1 ${sf}
        AND g.finished = true AND g.length > 60
        AND gp.items IS NOT NULL
    ) sub
    JOIN items i ON i.id = sub.item_id AND i.is_trinket = false
    GROUP BY sub.item_id, i.name, i.image_url
    ORDER BY count DESC
  `, [serieId, champName, ...sfParams]);

  const nPicks = c.picks || 1;
  const allItemsSorted = itemAggRows.map(r => ({
    id: r.item_id,
    name: r.name,
    image_url: r.image_url || null,
    count: Number(r.count),
    frequency: rnd(Number(r.count) / nPicks * 100, 0),
    win_rate: r.count > 0 ? rnd(Number(r.wins) / Number(r.count) * 100, 1) : 0,
  }));

  const topItems = allItemsSorted.slice(0, 6);
  const bottomItems = allItemsSorted.length > 6
    ? allItemsSorted.slice(-3).reverse()
    : [];

  // Keystones from champion_keystones table — enrich with rune images from runeMap
  const { rows: keystoneRows } = await pgDb.query(`
    SELECT rune_name, games, wins FROM champion_keystones
    WHERE champion_id = $1 AND serie_id = $2
    ORDER BY games DESC
  `, [c.champion_id, c.serie_id]);
  const runeByName = {};
  for (const [, rv] of Object.entries(runeMap)) {
    runeByName[rv.name?.toLowerCase()] = rv;
  }
  const keystones = keystoneRows.map(k => {
    const ri = runeByName[k.rune_name?.toLowerCase()];
    return {
      name: k.rune_name,
      image_url: ri?.image_url || null,
      count: Number(k.games),
      pct: rnd(Number(k.games) / (c.picks || 1) * 100, 1),
    };
  });

  // Patch breakdown from champion_patch_stats table
  const { rows: patchStatsRows } = await pgDb.query(`
    SELECT patch, games, wins, bans FROM champion_patch_stats
    WHERE champion_id = $1 AND serie_id = $2
    ORDER BY patch DESC
  `, [c.champion_id, c.serie_id]);
  const patchBreakdown = patchStatsRows.map(pb => ({
    patch: pb.patch,
    picks: pb.games ?? 0,
    bans: pb.bans ?? 0,
    wins: pb.wins ?? 0,
    win_rate: pb.games > 0 ? rnd(pb.wins / pb.games * 100, 1) : 0,
  }));

  // FB stats from live query
  const fbKills = ws.fb_kills != null ? Number(ws.fb_kills) : null;
  const fbAssists = ws.fb_assists != null ? Number(ws.fb_assists) : null;

  // Match log
  const matchLog = matchLogRows.map(m => ({
    game_id: m.game_id,
    date: m.date,
    duration: m.duration ? m.duration / 60 : null, // convert seconds to minutes for frontend
    player: m.player,
    team_abbr: m.team_abbr,
    team_logo: m.team_logo,
    opponent_abbr: m.opponent_abbr,
    opponent_logo: m.opponent_logo,
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    result: m.result,
    side: m.side,
  }));

  res.json({
    name: c.champion_name || champ.name || champName,
    image_url: imageUrl,
    position: mapRole(c.main_role),
    position_breakdown: posBreakdown,

    games: c.picks,
    wins: c.wins,
    losses: c.losses,
    win_rate: rnd(c.win_rate, 1),

    picks: c.picks,
    pick_rate: pickRate,
    bans: c.bans,
    ban_rate: banRate,
    bans_blue: c.bans_blue,
    bans_red: c.bans_red,
    ban_rate_blue: rnd(c.ban_rate_blue, 1),
    ban_rate_red: rnd(c.ban_rate_red, 1),
    ban_turn_avg: rnd(c.ban_turn_avg, 1),
    presence,

    avg_kills: rnd(c.kills_avg, 1),
    avg_deaths: rnd(c.deaths_avg, 1),
    avg_assists: rnd(c.assists_avg, 1),
    kda: rnd(c.kda),
    kill_participation: rnd(c.kill_participation != null && c.kill_participation > 0 && c.kill_participation <= 1 ? c.kill_participation * 100 : c.kill_participation, 1),
    fb_rate: rnd(c.fb_rate != null && c.fb_rate > 0 && c.fb_rate <= 1 ? c.fb_rate * 100 : c.fb_rate, 1),
    fb_kills: fbKills,
    fb_assists: fbAssists,

    double_kills: c.double_kills,
    triple_kills: c.triple_kills,
    quadra_kills: c.quadra_kills,
    penta_kills: c.penta_kills,

    avg_gpm: rnd(c.gpm, 0),
    avg_cspm: rnd(c.cspm, 1),
    avg_dpm: rnd(c.dpm, 0),
    avg_dtaken_per_min: rnd(c.avg_dtaken_pm, 0),
    avg_damage_share: rnd(c.dmg_share, 1),
    avg_gold_share: rnd(c.gold_share, 1),

    avg_physical_dpm: rnd(c.avg_physical_dpm, 0),
    avg_magic_dpm: rnd(c.avg_magic_dpm, 0),
    avg_true_dpm: rnd(c.avg_true_dpm, 0),

    avg_wpm: rnd(c.avg_wpm, 2),
    avg_wcpm: rnd(c.avg_wcpm, 2),
    avg_wards_placed: ws.avg_wards_placed != null ? Number(ws.avg_wards_placed) : null,
    avg_wards_destroyed: ws.avg_wards_destroyed != null ? Number(ws.avg_wards_destroyed) : null,
    avg_ctrl_wards: ws.avg_ctrl_wards != null ? Number(ws.avg_ctrl_wards) : null,

    blue_picks: c.blue_picks,
    blue_wins: c.blue_wins,
    red_picks: c.red_picks,
    red_wins: c.red_wins,
    blue_wr: blueWr,
    red_wr: redWr,

    avg_game_duration: rnd(c.avg_game_duration, 1),
    avg_duration_formatted: avgDurFormatted,
    players_count: c.players_count,

    played_by: playedBy,
    best_matchups: bestMatchups,
    worst_matchups: worstMatchups,
    top_items: topItems,
    bottom_items: bottomItems,
    keystones,
    patch_breakdown: patchBreakdown,
    match_log: matchLog,
  });
}
