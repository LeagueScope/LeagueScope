import { pgDb, ApiError, rnd, fmtMins } from './pgHelpers.js';

/** Build a clean serie label like "LEC Spring 2025" without duplicating the year */
function serieLabel(leagueName, fullName, season, year) {
  const name = fullName || season || '';
  const hasYear = name.includes(String(year));
  const league = (leagueName || '').replace(/^League of Legends\s*/i, '');
  return `${league} ${name}${hasYear ? '' : ` ${year || ''}`}`.replace(/\s+/g, ' ').trim();
}

/**
 * GET /pg/compare/players?ids=1,2,3,4
 * Compares stats for up to 4 players from their most recent serie.
 * Returns array of player objects with the same shape as getPlayersPg output + region field.
 */
export async function comparePlayersPg(req, res) {
  const { ids } = req.query;

  // Validate ids parameter
  if (!ids || typeof ids !== 'string') {
    return res.json([]);
  }

  // Parse entries: "playerId" or "playerId:serieId"
  const entries = ids.split(',').map(raw => {
    const [pidStr, sidStr] = raw.split(':');
    const playerId = parseInt(pidStr, 10);
    const serieId = sidStr ? parseInt(sidStr, 10) : null;
    return isNaN(playerId) ? null : { playerId, serieId };
  }).filter(Boolean);

  if (entries.length === 0 || entries.length > 4) return res.json([]);

  // Unique player IDs for fetching player info
  const uniquePlayerIds = [...new Set(entries.map(e => e.playerId))];

  // 1. Fetch players
  const { rows: players } = await pgDb.query(
    `SELECT id, name, slug, image_url, nationality FROM players WHERE id = ANY($1::int[])`,
    [uniquePlayerIds]
  );

  if (!players.length) return res.json([]);

  const playerMap = {};
  for (const p of players) playerMap[p.id] = p;

  // 2. For entries without serieId, find most recent serie
  const needAutoSerie = entries.filter(e => !e.serieId).map(e => e.playerId);
  const autoSerieMap = {};
  if (needAutoSerie.length > 0) {
    const uniqueNeedAuto = [...new Set(needAutoSerie)];
    const { rows: recentSeries } = await pgDb.query(`
      SELECT DISTINCT ON (gp.player_id)
        gp.player_id,
        g.serie_id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = ANY($1::int[]) AND g.finished = true AND g.length > 60
      ORDER BY gp.player_id, g.begin_at DESC
    `, [uniqueNeedAuto]);
    for (const rs of recentSeries) autoSerieMap[rs.player_id] = rs.serie_id;
  }

  // Resolve all entries to {playerId, serieId} pairs
  const resolvedEntries = entries.map(e => ({
    playerId: e.playerId,
    serieId: e.serieId || autoSerieMap[e.playerId] || null,
  })).filter(e => e.serieId !== null);

  if (!resolvedEntries.length) return res.json([]);

  // 3. Fetch league info and serie details for all series
  const allSerieIds = [...new Set(resolvedEntries.map(e => e.serieId))];
  const { rows: leagueRows } = await pgDb.query(`
    SELECT s.id, l.slug, s.year, s.season, s.full_name, l.name AS league_name FROM series s
    JOIN leagues l ON l.id = s.league_id
    WHERE s.id = ANY($1::int[])
  `, [allSerieIds]);

  const leagueMap = {};
  const serieInfoMap = {};
  for (const lr of leagueRows) {
    leagueMap[lr.id] = lr.slug;
    serieInfoMap[lr.id] = { year: lr.year, season: lr.season, full_name: lr.full_name, league_name: lr.league_name };
  }

  // 4. For each entry, fetch aggregated stats
  const results = [];

  for (const entry of resolvedEntries) {
    const player = playerMap[entry.playerId];
    if (!player) continue;

    const region = leagueMap[entry.serieId] || null;
    const serieInfo = serieInfoMap[entry.serieId] || {};

    // Fetch aggregated stats from the player's serie using the same logic as pgPlayers.js (stageParam=true branch)
    const { rows: statsRows } = await pgDb.query(`
      SELECT
        gp.player_id,
        gp.team_id,
        p.name, p.slug, p.image_url AS player_image_url, p.nationality,
        COALESCE(tb.display_name, t.name) AS team_name, COALESCE(tb.display_acronym, t.acronym) AS team_abbr,
        COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS team_logo_url,
        MODE() WITHIN GROUP (ORDER BY gp.role) AS role,
        COUNT(*) AS games,
        SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
        COUNT(*) - SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS losses,
        ROUND(SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate,
        SUM(gp.kills) AS total_kills,
        SUM(gp.deaths) AS total_deaths,
        SUM(gp.assists) AS total_assists,
        ROUND(AVG(gp.kills)::numeric, 1) AS kills_avg,
        ROUND(AVG(gp.deaths)::numeric, 1) AS deaths_avg,
        ROUND(AVG(gp.assists)::numeric, 1) AS assists_avg,
        ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0)), 2) AS kda,
        ROUND(AVG(CASE WHEN gt_kills.team_kills > 0 THEN (gp.kills + gp.assists)::numeric / gt_kills.team_kills * 100 ELSE 0 END), 0) AS kill_participation,
        ROUND(AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))::numeric, 0) AS gpm,
        ROUND(AVG(COALESCE(gp.creep_score, gp.minions_killed) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cspm,
        ROUND(AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS dpm,
        ROUND(AVG(gp.total_damage_taken / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_dtaken_pm,
        ROUND(AVG(gp.wards_placed / NULLIF(g.length / 60.0, 0))::numeric, 1) AS avg_wpm,
        ROUND(AVG(gp.kills_wards / NULLIF(g.length / 60.0, 0))::numeric, 1) AS avg_wkpm,
        ROUND(AVG(COALESCE(gp.vision_wards_bought_in_game, 0) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS avg_cwpm,
        ROUND(AVG(gp.magic_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_magic_dpm,
        ROUND(AVG(gp.physical_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_physical_dpm,
        ROUND(AVG(gp.true_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_true_dpm,
        ROUND(AVG(g.length)::numeric, 0) AS avg_duration,
        COUNT(DISTINCT gp.champion_id) AS unique_champions,
        ROUND(AVG(gp.gold_spent / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_gold_spent,
        ROUND(AVG(gp.total_time_crowd_control_dealt / NULLIF(g.length / 60.0, 0))::numeric, 1) AS avg_cc_per_min,
        ROUND(AVG(gp.total_heal / NULLIF(g.length / 60.0, 0))::numeric, 0) AS avg_heal_per_min,
        SUM(COALESCE(gp.double_kills, 0)) AS double_kills,
        SUM(COALESCE(gp.triple_kills, 0)) AS triple_kills,
        SUM(COALESCE(gp.quadra_kills, 0)) AS quadra_kills,
        SUM(COALESCE(gp.penta_kills, 0)) AS penta_kills,
        MAX(gp.kills) AS max_kills,
        SUM(CASE WHEN gt_side.color = 'blue' THEN 1 ELSE 0 END) AS blue_games,
        SUM(CASE WHEN gt_side.color = 'blue' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS blue_wins,
        SUM(CASE WHEN gt_side.color = 'red' THEN 1 ELSE 0 END) AS red_games,
        SUM(CASE WHEN gt_side.color = 'red' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS red_wins,
        NULL AS avg_cs_diff_13,
        NULL AS avg_cs_diff_20,
        NULL AS avg_cs_diff_25,
        NULL AS avg_level_diff_13,
        NULL AS avg_level_diff_20,
        NULL AS avg_level_diff_25,
        NULL AS avg_kills_diff_13,
        NULL AS avg_kills_diff_20,
        NULL AS avg_kills_diff_25,
        ROUND(AVG(CASE WHEN gp.first_blood_kill OR gp.first_blood_assist THEN 1 ELSE 0 END)::numeric * 100, 0) AS fb_rate,
        ROUND(AVG(CASE WHEN gt_side.first_tower THEN 1 ELSE 0 END)::numeric * 100, 0) AS first_tower_rate,
        ROUND(AVG(gp.total_damage_dealt_to_champions_percentage)::numeric, 1) AS dmg_share,
        ROUND(AVG(gp.gold_percentage)::numeric, 1) AS gold_share
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN players p ON p.id = gp.player_id
      LEFT JOIN teams t ON t.id = gp.team_id
      LEFT JOIN team_brands tb ON tb.team_id = gp.team_id AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
      LEFT JOIN game_teams gt_side ON gt_side.game_id = g.id AND gt_side.team_id = gp.team_id
      LEFT JOIN LATERAL (
        SELECT SUM(gp2.kills) AS team_kills FROM game_players gp2 WHERE gp2.game_id = gp.game_id AND gp2.team_id = gp.team_id
      ) gt_kills ON true
      WHERE g.serie_id = $1 AND gp.player_id = $2 AND g.finished = true AND g.length > 60
      GROUP BY gp.player_id, gp.team_id, p.name, p.slug, p.image_url, p.nationality,
               t.name, t.acronym, t.dark_mode_image_url, t.image_url, tb.display_name, tb.display_acronym, tb.display_logo
    `, [entry.serieId, entry.playerId]);

    if (!statsRows.length) continue;

    const pc = statsRows[0];

    // ── Frame diffs @13/@20/@25 ──────────────────────────────────────
    const { rows: diffRows } = await pgDb.query(`
      WITH player_games AS (
        SELECT gp.player_id, gp.game_id, gp.role, gt.color AS side
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
        WHERE gp.player_id = $2 AND g.serie_id = $1
          AND g.finished = true AND g.length > 60 AND gp.role IS NOT NULL
      ),
      target_frames AS (
        SELECT pg2.player_id, pg2.game_id, pg2.role, pg2.side,
               gf.id AS frame_id, t.minute_key,
               ROW_NUMBER() OVER (PARTITION BY pg2.player_id, pg2.game_id, t.minute_key ORDER BY ABS(gf.timestamp - t.target_sec)) AS rn
        FROM player_games pg2
        CROSS JOIN (VALUES (13, 780), (20, 1200), (25, 1500)) AS t(minute_key, target_sec)
        JOIN game_frames gf ON gf.game_id = pg2.game_id AND ABS(gf.timestamp - t.target_sec) <= 90
      ),
      diffs AS (
        SELECT tf.player_id, tf.minute_key,
               my.cs - opp.cs AS cs_diff,
               my.level - opp.level AS lvl_diff,
               my.kills - opp.kills AS kills_diff
        FROM target_frames tf
        JOIN game_frame_players my ON my.frame_id = tf.frame_id AND my.team_color = tf.side::team_color AND my.role = tf.role::player_role
        JOIN game_frame_players opp ON opp.frame_id = tf.frame_id AND opp.team_color != tf.side::team_color AND opp.role = tf.role::player_role
        WHERE tf.rn = 1 AND my.cs IS NOT NULL AND opp.cs IS NOT NULL
      )
      SELECT minute_key,
             ROUND(AVG(cs_diff)::numeric, 1) AS avg_cs_diff,
             ROUND(AVG(lvl_diff)::numeric, 1) AS avg_lvl_diff,
             ROUND(AVG(kills_diff)::numeric, 1) AS avg_kills_diff
      FROM diffs
      GROUP BY minute_key
    `, [entry.serieId, entry.playerId]);

    const frameDiffs = {};
    for (const d of diffRows) frameDiffs[d.minute_key] = d;

    // ── Per-game received damage breakdown ───────────────────────────
    const { rows: perGameDmg } = await pgDb.query(`
      SELECT
        gp.game_id,
        g.length,
        gp.magic_damage_taken,
        gp.physical_damage_taken
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.serie_id = $1 AND gp.player_id = $2
        AND g.finished = true AND g.length > 60
    `, [entry.serieId, entry.playerId]);

    let magicDtakenPmSum = 0, physDtakenPmSum = 0, dmgGameCount = 0;
    for (const row of perGameDmg) {
      const mins = (row.length || 1) / 60;
      magicDtakenPmSum += (row.magic_damage_taken || 0) / mins;
      physDtakenPmSum += (row.physical_damage_taken || 0) / mins;
      dmgGameCount += 1;
    }
    const gc = dmgGameCount || 1;

    // Calculate blue/red WR
    const blueWr = pc.blue_games > 0 ? rnd(pc.blue_wins / pc.blue_games * 100, 0) : null;
    const redWr = pc.red_games > 0 ? rnd((pc.red_wins ?? (pc.red_games - (pc.blue_wins ?? 0))) / pc.red_games * 100, 0) : null;

    // Format avg duration as MM:SS
    const avgDurSec = pc.avg_duration || 0;
    const avgMins = Math.floor(avgDurSec / 60);
    const avgSecs = Math.round(avgDurSec % 60);
    const avgDurFormatted = `${avgMins}:${String(avgSecs).padStart(2, '0')}`;

    results.push({
      // Identity
      id: pc.player_id,
      name: pc.name,
      slug: pc.slug,
      image_url: pc.player_image_url,
      nationality: pc.nationality,
      role: pc.role,
      team_abbr: pc.team_abbr,
      team_name: pc.team_name,
      team_logo_url: pc.team_logo_url,

      // Basic
      games: pc.games,
      wins: pc.wins,
      losses: pc.losses,
      win_rate: rnd(pc.win_rate, 1),

      // KDA
      avg_kills: rnd(pc.kills_avg, 1),
      avg_deaths: rnd(pc.deaths_avg, 1),
      avg_assists: rnd(pc.assists_avg, 1),
      kda: rnd(pc.kda),
      kill_participation: rnd(pc.kill_participation, 0),

      // Per minute
      avg_gpm: rnd(pc.gpm, 0),
      avg_cspm: rnd(pc.cspm, 1),
      avg_dpm: rnd(pc.dpm, 0),
      avg_dtaken_per_min: rnd(pc.avg_dtaken_pm, 0),
      avg_wpm: rnd(pc.avg_wpm, 1),
      avg_wkpm: rnd(pc.avg_wkpm, 1),
      avg_cwpm: rnd(pc.avg_cwpm, 1),

      // Damage breakdown (dealt)
      avg_magic_dpm: rnd(pc.avg_magic_dpm, 0),
      avg_physical_dpm: rnd(pc.avg_physical_dpm, 0),
      avg_true_dpm: rnd(pc.avg_true_dpm, 0),

      // Damage breakdown (received)
      avg_magic_dtaken_pm: rnd(dmgGameCount > 0 ? magicDtakenPmSum / gc : null, 0),
      avg_physical_dtaken_pm: rnd(dmgGameCount > 0 ? physDtakenPmSum / gc : null, 0),

      // Timeline diffs
      avg_cs_diff_13: frameDiffs[13]?.avg_cs_diff ?? null,
      avg_cs_diff_20: frameDiffs[20]?.avg_cs_diff ?? null,
      avg_cs_diff_25: frameDiffs[25]?.avg_cs_diff ?? null,
      avg_level_diff_13: frameDiffs[13]?.avg_lvl_diff ?? null,
      avg_level_diff_20: frameDiffs[20]?.avg_lvl_diff ?? null,
      avg_level_diff_25: frameDiffs[25]?.avg_lvl_diff ?? null,
      avg_kills_diff_13: frameDiffs[13]?.avg_kills_diff ?? null,
      avg_kills_diff_20: frameDiffs[20]?.avg_kills_diff ?? null,
      avg_kills_diff_25: frameDiffs[25]?.avg_kills_diff ?? null,

      // Combat
      double_kills: pc.double_kills,
      triple_kills: pc.triple_kills,
      quadra_kills: pc.quadra_kills,
      penta_kills: pc.penta_kills,
      max_kills: pc.max_kills,

      // Economy
      avg_gold_spent: rnd(pc.avg_gold_spent, 0),
      avg_cc_per_min: rnd(pc.avg_cc_per_min, 1),
      avg_heal_per_min: rnd(pc.avg_heal_per_min, 0),

      // General
      avg_duration: rnd(pc.avg_duration, 1),
      avg_duration_formatted: avgDurFormatted,
      unique_champions: pc.unique_champions,
      fb_rate: rnd(pc.fb_rate, 0),
      first_tower_rate: rnd(pc.first_tower_rate, 0),

      // Side
      blue_games: pc.blue_games,
      blue_wr: blueWr,
      red_games: pc.red_games,
      red_wr: redWr,

      // Shares
      avg_damage_share: rnd(pc.dmg_share, 1),
      avg_gold_share: rnd(pc.gold_share, 1),

      // Region
      region,

      // Serie
      serie_id: entry.serieId,
      serie_label: serieLabel(serieInfo.league_name, serieInfo.full_name, serieInfo.season, serieInfo.year),
    });
  }

  res.json(results);
}

/**
 * GET /pg/compare/teams?ids=1,2,3,4
 * Compares stats for up to 4 teams from their most recent serie.
 * Returns array of team objects with the same shape as getTeamsPg output + region field.
 */
export async function compareTeamsPg(req, res) {
  const { ids } = req.query;

  // Validate ids parameter
  if (!ids || typeof ids !== 'string') {
    return res.json([]);
  }

  // Parse entries: "teamId" or "teamId:serieId"
  const entries = ids.split(',').map(raw => {
    const [tidStr, sidStr] = raw.split(':');
    const teamId = parseInt(tidStr, 10);
    const serieId = sidStr ? parseInt(sidStr, 10) : null;
    return isNaN(teamId) ? null : { teamId, serieId };
  }).filter(Boolean);

  if (entries.length === 0 || entries.length > 4) return res.json([]);

  // Unique team IDs for fetching team info
  const uniqueTeamIds = [...new Set(entries.map(e => e.teamId))];

  // 1. Fetch teams
  const { rows: teams } = await pgDb.query(
    `SELECT id, name, acronym, image_url FROM teams WHERE id = ANY($1::int[])`,
    [uniqueTeamIds]
  );

  if (!teams.length) return res.json([]);

  // 2. For entries without serieId, find most recent serie
  const needAutoSerie = entries.filter(e => !e.serieId).map(e => e.teamId);
  const autoSerieMap = {};
  if (needAutoSerie.length > 0) {
    const uniqueNeedAuto = [...new Set(needAutoSerie)];
    const { rows: recentSeries } = await pgDb.query(`
      SELECT DISTINCT ON (gt.team_id)
        gt.team_id,
        g.serie_id
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE gt.team_id = ANY($1::int[]) AND g.finished = true AND g.length > 60
      ORDER BY gt.team_id, g.begin_at DESC
    `, [uniqueNeedAuto]);
    for (const rs of recentSeries) autoSerieMap[rs.team_id] = rs.serie_id;
  }

  // Resolve all entries to {teamId, serieId} pairs
  const resolvedEntries = entries.map(e => ({
    teamId: e.teamId,
    serieId: e.serieId || autoSerieMap[e.teamId] || null,
  })).filter(e => e.serieId !== null);

  if (!resolvedEntries.length) return res.json([]);

  // 3. Fetch league info and serie details for all series
  const allSerieIds = [...new Set(resolvedEntries.map(e => e.serieId))];
  const { rows: leagueRows } = await pgDb.query(`
    SELECT s.id, l.slug, s.year, s.season, s.full_name, l.name AS league_name FROM series s
    JOIN leagues l ON l.id = s.league_id
    WHERE s.id = ANY($1::int[])
  `, [allSerieIds]);

  const leagueMap = {};
  const serieInfoMap = {};
  for (const lr of leagueRows) {
    leagueMap[lr.id] = lr.slug;
    serieInfoMap[lr.id] = { year: lr.year, season: lr.season, full_name: lr.full_name, league_name: lr.league_name };
  }

  // 4. For each entry, fetch aggregated stats
  const results = [];

  for (const entry of resolvedEntries) {
    const team = teams.find(t => t.id === entry.teamId);
    if (!team) continue;

    const region = leagueMap[entry.serieId] || null;
    const serieInfo = serieInfoMap[entry.serieId] || {};

    // Fetch team-level stats from game_teams
    const { rows: teamStats } = await pgDb.query(`
      SELECT
        gt.team_id,
        COALESCE(tb.display_name, t.name) AS brand_name,
        COALESCE(tb.display_acronym, t.acronym) AS brand_acronym,
        t.slug,
        COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS image_url,

        COUNT(*)                                         AS games,
        SUM(CASE WHEN g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN g.winner_id != gt.team_id THEN 1 ELSE 0 END) AS losses,

        -- Duration
        ROUND(AVG(g.length / 60.0)::numeric, 1)         AS avg_duration_min,

        -- Objectives
        ROUND(AVG(gt.kills)::numeric, 1)                AS avg_kills,
        ROUND(AVG(gt.tower_kills)::numeric, 1)          AS avg_towers,
        ROUND(AVG(gt.dragon_kills)::numeric, 1)         AS avg_dragons,
        ROUND(AVG(gt.baron_kills)::numeric, 1)          AS avg_barons,
        ROUND(AVG(gt.herald_kills)::numeric, 1)         AS avg_heralds,
        ROUND(AVG(gt.inhibitor_kills)::numeric, 1)      AS avg_inhibitors,
        ROUND(AVG(COALESCE(gt.voidgrub_kills, 0))::numeric, 1) AS avg_voidgrubs,
        ROUND(AVG(COALESCE(gt.atakhan_kills, 0))::numeric, 1)  AS avg_atakhans,

        -- First objectives
        SUM(CASE WHEN gt.first_blood = true THEN 1 ELSE 0 END)     AS fb_count,
        SUM(CASE WHEN gt.first_tower = true THEN 1 ELSE 0 END)     AS ft_count,
        SUM(CASE WHEN gt.first_dragon = true THEN 1 ELSE 0 END)    AS fd_count,
        SUM(CASE WHEN gt.first_baron = true THEN 1 ELSE 0 END)     AS fba_count,
        SUM(CASE WHEN gt.first_herald = true THEN 1 ELSE 0 END)    AS fh_count,
        SUM(CASE WHEN gt.first_inhibitor = true THEN 1 ELSE 0 END) AS fi_count,
        SUM(CASE WHEN gt.first_voidgrub = true THEN 1 ELSE 0 END)  AS fvg_count,
        SUM(CASE WHEN gt.first_atakhan = true THEN 1 ELSE 0 END)   AS fat_count,

        -- Side stats
        SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_games,
        SUM(CASE WHEN gt.color = 'blue' AND g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS blue_wins,
        SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_games,
        SUM(CASE WHEN gt.color = 'red' AND g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS red_wins

      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      JOIN teams t ON t.id = gt.team_id
      LEFT JOIN team_brands tb ON tb.team_id = gt.team_id AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
      WHERE g.serie_id = $1 AND gt.team_id = $2 AND g.finished = true AND g.length > 60
      GROUP BY gt.team_id, t.slug, t.image_url, t.dark_mode_image_url, tb.display_name, tb.display_acronym, tb.display_logo, t.name, t.acronym
    `, [entry.serieId, entry.teamId]);

    if (!teamStats.length) continue;

    const t = teamStats[0];

    // 5. Player-level aggregation per team (damage, wards, CS, gold, etc.)
    const { rows: playerAgg } = await pgDb.query(`
      WITH per_game AS (
        SELECT
          gp.team_id,
          gp.game_id,
          g.length,
          SUM(gp.gold_earned)                                                AS gold,
          SUM(gp.gold_spent)                                                 AS gold_spent,
          SUM(COALESCE(gp.creep_score, gp.minions_killed))                   AS cs,
          SUM(gp.assists)                                                    AS assists,
          SUM(gp.total_damage_dealt_to_champions)                            AS dmg,
          SUM(gp.magic_damage_dealt_to_champions)                            AS magic_dmg,
          SUM(gp.physical_damage_dealt_to_champions)                         AS physical_dmg,
          SUM(gp.true_damage_dealt_to_champions)                             AS true_dmg,
          SUM(gp.total_damage_taken)                                         AS dmg_taken,
          SUM(gp.magic_damage_taken)                                         AS magic_dmg_taken,
          SUM(gp.physical_damage_taken)                                      AS physical_dmg_taken,
          SUM(gp.wards_placed)                                               AS wards,
          SUM(gp.kills_wards)                                                AS ward_kills,
          SUM(COALESCE(gp.vision_wards_bought_in_game, 0))                  AS control_wards,
          SUM(gp.total_time_crowd_control_dealt)                             AS cc,
          SUM(gp.total_heal)                                                 AS heal,
          SUM(COALESCE(gp.kills_neutral_minions_enemy_jungle, 0))           AS neutral_enemy,
          SUM(COALESCE(gp.kills_neutral_minions_team_jungle, 0))            AS neutral_team
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
          AND gp.team_id = $2
        GROUP BY gp.team_id, gp.game_id, g.length
      )
      SELECT
        team_id,
        SUM(gold)::bigint                   AS total_gold,
        SUM(gold_spent)::bigint             AS total_gold_spent,
        SUM(cs)::bigint                     AS total_cs,
        SUM(assists)::bigint                AS total_assists,
        SUM(dmg)::bigint                    AS total_dmg,
        SUM(magic_dmg)::bigint              AS total_magic_dmg,
        SUM(physical_dmg)::bigint           AS total_physical_dmg,
        SUM(true_dmg)::bigint               AS total_true_dmg,
        SUM(dmg_taken)::bigint              AS total_dmg_taken,
        SUM(magic_dmg_taken)::bigint        AS total_magic_dmg_taken,
        SUM(physical_dmg_taken)::bigint     AS total_physical_dmg_taken,
        SUM(wards)::bigint                  AS total_wards,
        SUM(ward_kills)::bigint             AS total_ward_kills,
        SUM(control_wards)::bigint          AS total_control_wards,
        SUM(cc)::bigint                     AS total_cc,
        SUM(heal)::bigint                   AS total_heal,
        SUM(neutral_enemy)::bigint          AS total_neutral_enemy,
        SUM(neutral_team)::bigint           AS total_neutral_team,
        COUNT(*)                            AS player_games,
        SUM(length)::bigint                 AS total_duration_sec
      FROM per_game
      GROUP BY team_id
    `, [entry.serieId, entry.teamId]);

    const pa = playerAgg.length > 0 ? playerAgg[0] : {};

    // 6. Unique champions via champion_aliases
    const { rows: champCounts } = await pgDb.query(`
      SELECT gp.team_id, COUNT(DISTINCT ca.canonical_id) AS unique_champions
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
        AND gp.team_id = $2
      GROUP BY gp.team_id
    `, [entry.serieId, entry.teamId]);

    const uc = champCounts.length > 0 ? Number(champCounts[0].unique_champions) : 0;

    // 7. Rival deaths (opponent kills = our deaths) per team
    const { rows: rivalKills } = await pgDb.query(`
      SELECT
        rival.team_id AS our_team_id,
        ROUND(AVG(gt.kills)::numeric, 1) AS avg_deaths,
        ROUND(AVG(gt.tower_kills)::numeric, 1) AS avg_towers_lost
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      JOIN game_teams rival ON rival.game_id = gt.game_id AND rival.team_id != gt.team_id
      WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
        AND rival.team_id = $2
      GROUP BY rival.team_id
    `, [entry.serieId, entry.teamId]);

    const rv = rivalKills.length > 0 ? rivalKills[0] : {};

    // 8. Per-game gold/CS differential vs opponent
    const { rows: diffs } = await pgDb.query(`
      WITH team_game AS (
        SELECT gp.team_id, gp.game_id, g.length,
          SUM(gp.gold_earned) AS gold,
          SUM(COALESCE(gp.creep_score, gp.minions_killed)) AS cs
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
          AND gp.team_id = $2
        GROUP BY gp.team_id, gp.game_id, g.length
      )
      SELECT
        a.team_id,
        ROUND(AVG((a.gold - b.gold)::numeric / GREATEST(a.length / 60.0, 1)), 1) AS delta_gpm,
        ROUND(AVG((a.cs - b.cs)::numeric / GREATEST(a.length / 60.0, 1)), 1)     AS delta_cspm
      FROM team_game a
      JOIN team_game b ON a.game_id = b.game_id AND a.team_id != b.team_id
      GROUP BY a.team_id
    `, [entry.serieId, entry.teamId]);

    const df = diffs.length > 0 ? diffs[0] : {};

    // 9. Timeline diffs @13, @20, @25
    const { rows: tlDiffs } = await pgDb.query(`
      WITH snapshots AS (
        SELECT
          gf.id AS frame_id,
          gf.game_id,
          gf.blue_team_id, gf.red_team_id,
          gf.timestamp AS ts,
          gf.blue_gold, gf.red_gold,
          gf.blue_kills, gf.red_kills,
          gf.blue_towers, gf.red_towers,
          ROW_NUMBER() OVER (PARTITION BY gf.game_id, CASE
            WHEN gf.timestamp BETWEEN 720 AND 840 THEN 13
            WHEN gf.timestamp BETWEEN 1140 AND 1260 THEN 20
            WHEN gf.timestamp BETWEEN 1440 AND 1560 THEN 25
          END ORDER BY ABS(gf.timestamp - CASE
            WHEN gf.timestamp BETWEEN 720 AND 840 THEN 780
            WHEN gf.timestamp BETWEEN 1140 AND 1260 THEN 1200
            WHEN gf.timestamp BETWEEN 1440 AND 1560 THEN 1500
            ELSE 0 END)) AS rn,
          CASE
            WHEN gf.timestamp BETWEEN 720 AND 840 THEN 13
            WHEN gf.timestamp BETWEEN 1140 AND 1260 THEN 20
            WHEN gf.timestamp BETWEEN 1440 AND 1560 THEN 25
          END AS minute_bucket
        FROM game_frames gf
        JOIN games g ON g.id = gf.game_id
        WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
          AND (gf.blue_team_id = $2 OR gf.red_team_id = $2)
          AND (gf.timestamp BETWEEN 720 AND 840
            OR gf.timestamp BETWEEN 1140 AND 1260
            OR gf.timestamp BETWEEN 1440 AND 1560)
      ),
      frame_cs AS (
        SELECT s.frame_id,
          COALESCE(SUM(CASE WHEN fp.team_color = 'blue' THEN fp.cs ELSE 0 END), 0) AS blue_cs,
          COALESCE(SUM(CASE WHEN fp.team_color = 'red'  THEN fp.cs ELSE 0 END), 0) AS red_cs
        FROM snapshots s
        JOIN game_frame_players fp ON fp.frame_id = s.frame_id
        WHERE s.rn = 1 AND s.minute_bucket IS NOT NULL
        GROUP BY s.frame_id
      )
      SELECT
        team_id,
        minute_bucket,
        ROUND(AVG(gold_diff)::numeric) AS avg_gold_diff,
        ROUND(AVG(kills_diff)::numeric, 1) AS avg_kills_diff,
        ROUND(AVG(tower_diff)::numeric, 1) AS avg_tower_diff,
        ROUND(AVG(cs_diff)::numeric, 1) AS avg_cs_diff
      FROM (
        SELECT s.blue_team_id AS team_id, s.minute_bucket,
          (s.blue_gold - s.red_gold) AS gold_diff,
          (s.blue_kills - s.red_kills) AS kills_diff,
          (s.blue_towers - s.red_towers) AS tower_diff,
          (fc.blue_cs - fc.red_cs) AS cs_diff
        FROM snapshots s
        LEFT JOIN frame_cs fc ON fc.frame_id = s.frame_id
        WHERE s.rn = 1 AND s.minute_bucket IS NOT NULL AND s.blue_team_id = $2
        UNION ALL
        SELECT s.red_team_id AS team_id, s.minute_bucket,
          (s.red_gold - s.blue_gold) AS gold_diff,
          (s.red_kills - s.blue_kills) AS kills_diff,
          (s.red_towers - s.blue_towers) AS tower_diff,
          (fc.red_cs - fc.blue_cs) AS cs_diff
        FROM snapshots s
        LEFT JOIN frame_cs fc ON fc.frame_id = s.frame_id
        WHERE s.rn = 1 AND s.minute_bucket IS NOT NULL AND s.red_team_id = $2
      ) sub
      GROUP BY team_id, minute_bucket
    `, [entry.serieId, entry.teamId]);

    const tlMap = {};
    for (const r of tlDiffs) {
      if (!tlMap[r.team_id]) tlMap[r.team_id] = {};
      const mb = r.minute_bucket;
      tlMap[r.team_id][`avg_gold_diff_${mb}`] = Number(r.avg_gold_diff);
      tlMap[r.team_id][`avg_kills_diff_${mb}`] = Number(r.avg_kills_diff);
      tlMap[r.team_id][`avg_tower_diff_${mb}`] = Number(r.avg_tower_diff);
      if (r.avg_cs_diff != null) tlMap[r.team_id][`avg_cs_diff_${mb}`] = Number(r.avg_cs_diff);
    }
    const tl = tlMap[t.team_id] || {};

    // 10. CS diff @14 from game_players (fallback for @13)
    const { rows: csDiffs } = await pgDb.query(`
      WITH per_game AS (
        SELECT gp.team_id, gp.game_id, AVG(gp.cs_diff_at_14) AS cs_diff_14
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
          AND gp.team_id = $2 AND gp.cs_diff_at_14 IS NOT NULL
        GROUP BY gp.team_id, gp.game_id
      )
      SELECT team_id, ROUND(AVG(cs_diff_14)::numeric, 1) AS avg_cs_diff_13
      FROM per_game GROUP BY team_id
    `, [entry.serieId, entry.teamId]);

    const csDiffVal = csDiffs.length > 0 ? Number(csDiffs[0].avg_cs_diff_13) : null;

    // ── Build result object ────────────────────────────────────────────────────
    const n = Number(t.games);
    const wins = Number(t.wins);
    const losses = Number(t.losses);
    const totalDurSec = Number(pa.total_duration_sec || 0);
    const totalDurMin = totalDurSec / 60;
    const avgDurMin = Number(t.avg_duration_min) || 0;

    // Per-minute rates
    const pmRate = (total) => totalDurMin > 0 ? rnd(Number(total || 0) / totalDurMin) : null;

    const avgKills = Number(t.avg_kills);
    const avgDeaths = Number(rv.avg_deaths || 0);
    const avgAssists = n > 0 ? rnd(Number(pa.total_assists || 0) / n, 1) : null;
    const kda = avgDeaths > 0 ? rnd((avgKills + (avgAssists || 0)) / avgDeaths) : null;

    const blueGames = Number(t.blue_games);
    const blueWins = Number(t.blue_wins);
    const redGames = Number(t.red_games);
    const redWins = Number(t.red_wins);

    const pct = (num, denom) => denom > 0 ? parseFloat((num / denom * 100).toFixed(1)) : 0;

    results.push({
      id: t.team_id,
      name: t.brand_name,
      abbr: t.brand_acronym,
      logo_url: t.image_url,
      games: n,
      wins,
      losses,
      win_rate: pct(wins, n),

      avg_duration: avgDurMin,
      avg_duration_formatted: fmtMins(avgDurMin),
      unique_champions: uc,

      first_blood_rate: pct(Number(t.fb_count), n),
      first_tower_rate: pct(Number(t.ft_count), n),
      first_dragon_rate: pct(Number(t.fd_count), n),
      first_baron_rate: pct(Number(t.fba_count), n),
      first_herald_rate: pct(Number(t.fh_count), n),
      first_inhibitor_rate: pct(Number(t.fi_count), n),
      first_voidgrub_rate: pct(Number(t.fvg_count), n),
      first_atakhan_rate: pct(Number(t.fat_count), n),

      avg_kills: avgKills,
      avg_deaths: avgDeaths,
      avg_assists: avgAssists,
      kda,
      avg_towers: Number(t.avg_towers),
      avg_towers_lost: Number(rv.avg_towers_lost || 0),
      avg_dragons: Number(t.avg_dragons),
      avg_barons: Number(t.avg_barons),
      avg_heralds: Number(t.avg_heralds),
      avg_voidgrubs: Number(t.avg_voidgrubs),
      avg_inhibitors: Number(t.avg_inhibitors),
      avg_atakhans: Number(t.avg_atakhans),

      avg_gpm: pmRate(pa.total_gold),
      avg_cspm: pmRate(pa.total_cs),
      avg_dpm: pmRate(pa.total_dmg),
      avg_magic_dpm: pmRate(pa.total_magic_dmg),
      avg_physical_dpm: pmRate(pa.total_physical_dmg),
      avg_true_dpm: pmRate(pa.total_true_dmg),
      avg_dtaken_per_min: pmRate(pa.total_dmg_taken),
      avg_magic_dtaken_pm: pmRate(pa.total_magic_dmg_taken),
      avg_physical_dtaken_pm: pmRate(pa.total_physical_dmg_taken),
      avg_wpm: pmRate(pa.total_wards),
      avg_wkpm: pmRate(pa.total_ward_kills),
      avg_cwpm: pmRate(pa.total_control_wards),
      avg_cc_per_min: pmRate(pa.total_cc),
      avg_heal_per_min: pmRate(pa.total_heal),

      delta_gpm: Number(df.delta_gpm || 0),
      delta_cspm: Number(df.delta_cspm || 0),

      avg_gold_spent: n > 0 ? rnd(Number(pa.total_gold_spent || 0) / n) : null,
      avg_neutral_minions_enemy: n > 0 ? rnd(Number(pa.total_neutral_enemy || 0) / n, 1) : null,
      avg_neutral_minions_team: n > 0 ? rnd(Number(pa.total_neutral_team || 0) / n, 1) : null,

      avg_gold_diff_13: tl.avg_gold_diff_13 ?? null,
      avg_cs_diff_13: tl.avg_cs_diff_13 ?? csDiffVal ?? null,
      avg_kills_diff_13: tl.avg_kills_diff_13 ?? null,
      avg_tower_diff_13: tl.avg_tower_diff_13 ?? null,
      avg_gold_diff_20: tl.avg_gold_diff_20 ?? null,
      avg_cs_diff_20: tl.avg_cs_diff_20 ?? null,
      avg_kills_diff_20: tl.avg_kills_diff_20 ?? null,
      avg_tower_diff_20: tl.avg_tower_diff_20 ?? null,
      avg_gold_diff_25: tl.avg_gold_diff_25 ?? null,
      avg_cs_diff_25: tl.avg_cs_diff_25 ?? null,
      avg_kills_diff_25: tl.avg_kills_diff_25 ?? null,
      avg_tower_diff_25: tl.avg_tower_diff_25 ?? null,

      blue_games: blueGames,
      blue_wr: pct(blueWins, blueGames),
      red_games: redGames,
      red_wr: pct(redWins, redGames),

      // Region
      region,

      // Serie
      serie_id: entry.serieId,
      serie_label: serieLabel(serieInfo.league_name, serieInfo.full_name, serieInfo.season, serieInfo.year),
    });
  }

  res.json(results);
}

/**
 * GET /pg/compare/player-series?id=123
 * Returns all series a player has participated in, ordered most recent first.
 */
export async function getPlayerSeriesPg(req, res) {
  const id = parseInt(req.query.id, 10);
  if (!id) return res.json([]);

  const { rows } = await pgDb.query(`
    SELECT
      s.id,
      s.year,
      s.season,
      s.full_name,
      l.slug AS league_slug,
      l.name AS league_name
    FROM series s
    JOIN leagues l ON l.id = s.league_id
    WHERE s.id IN (
      SELECT DISTINCT g.serie_id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = $1 AND g.finished = true AND g.length > 60
    )
    ORDER BY s.begin_at DESC
  `, [id]);

  res.json(rows.map(r => ({
    id: r.id,
    year: r.year,
    season: r.season,
    full_name: r.full_name,
    league_slug: r.league_slug,
    league_name: r.league_name,
    label: serieLabel(r.league_name || r.league_slug, r.full_name, r.season, r.year),
  })));
}

/**
 * GET /pg/compare/team-series?id=123
 * Returns all series a team has participated in, ordered most recent first.
 */
export async function getTeamSeriesPg(req, res) {
  const id = parseInt(req.query.id, 10);
  if (!id) return res.json([]);

  const { rows } = await pgDb.query(`
    SELECT
      s.id,
      s.year,
      s.season,
      s.full_name,
      l.slug AS league_slug,
      l.name AS league_name
    FROM series s
    JOIN leagues l ON l.id = s.league_id
    WHERE s.id IN (
      SELECT DISTINCT g.serie_id
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE gt.team_id = $1 AND g.finished = true AND g.length > 60
    )
    ORDER BY s.begin_at DESC
  `, [id]);

  res.json(rows.map(r => ({
    id: r.id,
    year: r.year,
    season: r.season,
    full_name: r.full_name,
    league_slug: r.league_slug,
    league_name: r.league_name,
    label: serieLabel(r.league_name || r.league_slug, r.full_name, r.season, r.year),
  })));
}

/**
 * GET /pg/compare/teams-h2h?ids=A,B&limit=5
 * Returns the last N finished SERIES (matches in our schema, BO1/BO3/BO5)
 * between two teams, ordered most recent first.
 *
 * Each row includes: match id, BO, score from each team's perspective,
 * winner side, league info, date.
 */
export async function getTeamsH2HPg(req, res) {
  const idsParam = (req.query.ids || '').toString();
  const ids = idsParam.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  if (ids.length !== 2) return res.json([]);
  const [a, b] = ids;
  // Mismo equipo contra sí mismo: no tiene sentido un H2H
  if (a === b) return res.json([]);
  const limit = Math.max(1, Math.min(20, parseInt(req.query.limit, 10) || 5));

  // Find the last N finished matches where BOTH teams played as opponents
  const { rows: matches } = await pgDb.query(`
    SELECT m.id, m.number_of_games, m.begin_at, m.scheduled_at, m.winner_id,
           m.name AS match_name,
           s.id AS serie_id, s.year, s.season, s.full_name AS serie_full_name,
           l.slug AS league_slug, l.name AS league_name
    FROM matches m
    JOIN series s ON s.id = m.serie_id
    JOIN leagues l ON l.id = s.league_id
    WHERE m.status = 'finished'
      AND EXISTS (SELECT 1 FROM match_opponents mo WHERE mo.match_id = m.id AND mo.team_id = $1)
      AND EXISTS (SELECT 1 FROM match_opponents mo WHERE mo.match_id = m.id AND mo.team_id = $2)
    ORDER BY COALESCE(m.begin_at, m.scheduled_at) DESC NULLS LAST
    LIMIT $3
  `, [a, b, limit]);

  if (!matches.length) return res.json([]);
  const matchIds = matches.map(m => m.id);

  // Pull opponents (branded) for those matches in one shot
  const { rows: opps } = await pgDb.query(`
    SELECT mo.match_id, mo.team_id, mo.result_score AS score, mo.side,
           COALESCE(tb.display_name, t.name) AS name,
           COALESCE(tb.display_acronym, t.acronym) AS acronym,
           COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS image_url
    FROM match_opponents mo
    JOIN teams t ON t.id = mo.team_id
    JOIN matches m ON m.id = mo.match_id
    JOIN series _s ON _s.id = m.serie_id
    LEFT JOIN team_brands tb ON tb.team_id = mo.team_id AND _s.year BETWEEN tb.year_start AND tb.year_end
    WHERE mo.match_id = ANY($1::int[])
    ORDER BY mo.match_id, mo.side
  `, [matchIds]);

  const oppsByMatch = {};
  for (const o of opps) (oppsByMatch[o.match_id] ||= []).push(o);

  // Build response: always team A first (the first id in the request), team B second
  res.json(matches.map(m => {
    const ms = oppsByMatch[m.id] || [];
    const tA = ms.find(o => o.team_id === a) || ms[0];
    const tB = ms.find(o => o.team_id === b) || ms[1];
    const aWon = m.winner_id === a;
    const bWon = m.winner_id === b;
    return {
      match_id: m.id,
      best_of: m.number_of_games || 1,
      date: m.begin_at || m.scheduled_at,
      match_name: m.match_name,
      league_slug: m.league_slug,
      league_name: m.league_name,
      serie_id: m.serie_id,
      serie_label: serieLabel(m.league_name || m.league_slug, m.serie_full_name, m.season, m.year),
      year: m.year,
      season: m.season,
      teamA: tA ? { id: tA.team_id, name: tA.name, abbr: tA.acronym, logo_url: tA.image_url, score: tA.score, winner: aWon } : null,
      teamB: tB ? { id: tB.team_id, name: tB.name, abbr: tB.acronym, logo_url: tB.image_url, score: tB.score, winner: bWon } : null,
    };
  }));
}

/**
 * GET /pg/compare/player-role-baseline?role=X&serieId=Y
 * Returns averaged stats across all players of a given role in a given serie.
 * Used as the "league average" baseline for the radar chart in H2H comparisons.
 */
export async function getPlayerRoleBaselinePg(req, res) {
  const role = (req.query.role || '').toString().toLowerCase();
  const serieId = parseInt(req.query.serieId, 10);
  if (!role || isNaN(serieId)) return res.json(null);

  // Validar role: top, jungle, mid, adc, support
  const validRoles = ['top', 'jungle', 'mid', 'adc', 'support'];
  if (!validRoles.includes(role)) return res.json(null);

  const { rows } = await pgDb.query(`
    WITH per_player AS (
      SELECT
        gp.player_id,
        ROUND((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0), 2) AS kda,
        ROUND(AVG(CASE WHEN gt_kills.team_kills > 0 THEN (gp.kills + gp.assists)::numeric / gt_kills.team_kills * 100 ELSE 0 END), 0) AS kp,
        ROUND(AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))::numeric, 0) AS gpm,
        ROUND(AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS dpm,
        ROUND(AVG(COALESCE(gp.creep_score, gp.minions_killed) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cspm,
        ROUND(AVG(gp.total_damage_dealt_to_champions_percentage)::numeric, 1) AS dmg_share,
        ROUND(AVG(gp.gold_percentage)::numeric, 1) AS gold_share,
        ROUND(AVG(CASE WHEN gp.first_blood_kill OR gp.first_blood_assist THEN 1 ELSE 0 END)::numeric * 100, 0) AS fb_rate,
        ROUND(AVG(gp.wards_placed / NULLIF(g.length / 60.0, 0))::numeric, 1) AS wpm,
        ROUND(AVG(gp.kills_wards / NULLIF(g.length / 60.0, 0))::numeric, 1) AS wkpm,
        ROUND(AVG(COALESCE(gp.vision_wards_bought_in_game, 0) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cwpm,
        ROUND(AVG(gp.total_time_crowd_control_dealt / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cc_per_min
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      LEFT JOIN LATERAL (
        SELECT SUM(gp2.kills) AS team_kills FROM game_players gp2 WHERE gp2.game_id = gp.game_id AND gp2.team_id = gp.team_id
      ) gt_kills ON true
      WHERE g.serie_id = $1 AND gp.role = $2 AND g.finished = true AND g.length > 60
      GROUP BY gp.player_id
      HAVING COUNT(*) >= 3
    )
    SELECT
      ROUND(AVG(kda)::numeric, 2) AS kda,
      ROUND(AVG(kp)::numeric, 0) AS kill_participation,
      ROUND(AVG(gpm)::numeric, 0) AS avg_gpm,
      ROUND(AVG(dpm)::numeric, 0) AS avg_dpm,
      ROUND(AVG(cspm)::numeric, 1) AS avg_cspm,
      ROUND(AVG(dmg_share)::numeric, 1) AS avg_damage_share,
      ROUND(AVG(gold_share)::numeric, 1) AS avg_gold_share,
      ROUND(AVG(fb_rate)::numeric, 0) AS fb_rate,
      ROUND(AVG(wpm)::numeric, 1) AS avg_wpm,
      ROUND(AVG(wkpm)::numeric, 1) AS avg_wkpm,
      ROUND(AVG(cwpm)::numeric, 1) AS avg_cwpm,
      ROUND(AVG(cc_per_min)::numeric, 1) AS avg_cc_per_min,
      COUNT(*) AS sample_size
    FROM per_player
  `, [serieId, role]);

  if (!rows.length || !rows[0].kda) return res.json(null);
  const r = rows[0];
  res.json({
    role,
    serie_id: serieId,
    sample_size: parseInt(r.sample_size, 10) || 0,
    kda: r.kda != null ? Number(r.kda) : null,
    kill_participation: r.kill_participation != null ? Number(r.kill_participation) : null,
    avg_gpm: r.avg_gpm != null ? Number(r.avg_gpm) : null,
    avg_dpm: r.avg_dpm != null ? Number(r.avg_dpm) : null,
    avg_cspm: r.avg_cspm != null ? Number(r.avg_cspm) : null,
    avg_damage_share: r.avg_damage_share != null ? Number(r.avg_damage_share) : null,
    avg_gold_share: r.avg_gold_share != null ? Number(r.avg_gold_share) : null,
    fb_rate: r.fb_rate != null ? Number(r.fb_rate) : null,
    avg_wpm: r.avg_wpm != null ? Number(r.avg_wpm) : null,
    avg_wkpm: r.avg_wkpm != null ? Number(r.avg_wkpm) : null,
    avg_cwpm: r.avg_cwpm != null ? Number(r.avg_cwpm) : null,
    avg_cc_per_min: r.avg_cc_per_min != null ? Number(r.avg_cc_per_min) : null,
  });
}
