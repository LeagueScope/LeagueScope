import { pgDb, ApiError, resolveLeagueId, resolveSerie, getChampMap, getRuneMap, getSpellMap, getRunePathMap, rnd, mapRole, ensureArr, stageFilter } from './pgHelpers.js';

export async function getPlayersPg(req, res) {
  const { league = 'LEC', year, split, stage, position } = req.query;

  // 1. Resolve serie
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json([]);
  const { sf, stageParams } = stageFilter(stageParam, 2);

  // 2. Fetch player stats — use player_career (precalculated) when no stage filter,
  //    or recalculate from game_players when filtering by stage/tournament
  const careerQuery = stageParam
    ? `
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
        ROUND(AVG((gp.minions_killed + COALESCE(gp.kills_neutral_minions, 0)) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS cspm,
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
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
      GROUP BY gp.player_id, gp.team_id, p.name, p.slug, p.image_url, p.nationality,
               t.name, t.acronym, t.dark_mode_image_url, t.image_url, tb.display_name, tb.display_acronym, tb.display_logo
      ORDER BY SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) DESC,
               ((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0)) DESC
    `
    : `
      SELECT
        pc.*,
        p.name, p.slug, p.image_url AS player_image_url, p.nationality,
        COALESCE(tb.display_name, t.name) AS team_name, COALESCE(tb.display_acronym, t.acronym) AS team_abbr,
        COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS team_logo_url
      FROM player_career pc
      JOIN players p ON p.id = pc.player_id
      LEFT JOIN teams t ON t.id = pc.team_id
      LEFT JOIN team_brands tb ON tb.team_id = pc.team_id AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
      WHERE pc.serie_id = $1
      ORDER BY pc.wins DESC, pc.kda DESC
    `;
  const { rows: careerRows } = await pgDb.query(careerQuery, [serieId, ...stageParams]);

  if (!careerRows.length) return res.json([]);

  // 2b. If stage filter active, calculate frame diffs @13/20/25 from game_frame_players
  if (stageParam) {
    const playerIds = careerRows.map(r => r.player_id);
    const { rows: diffRows } = await pgDb.query(`
      WITH player_games AS (
        SELECT gp.player_id, gp.game_id, gp.role, gt.color AS side
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
        WHERE gp.player_id = ANY($1::int[]) AND g.serie_id = $2
          AND g.tournament_id = $3
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
      SELECT player_id, minute_key,
             ROUND(AVG(cs_diff)::numeric, 1) AS avg_cs_diff,
             ROUND(AVG(lvl_diff)::numeric, 1) AS avg_lvl_diff,
             ROUND(AVG(kills_diff)::numeric, 1) AS avg_kills_diff
      FROM diffs
      GROUP BY player_id, minute_key
    `, [playerIds, serieId, ...stageParams]);

    // Apply diffs to careerRows
    const diffMap = {};
    for (const d of diffRows) {
      if (!diffMap[d.player_id]) diffMap[d.player_id] = {};
      diffMap[d.player_id][d.minute_key] = d;
    }
    for (const pc of careerRows) {
      const pd = diffMap[pc.player_id] || {};
      pc.avg_cs_diff_13 = pd[13]?.avg_cs_diff ?? null;
      pc.avg_cs_diff_20 = pd[20]?.avg_cs_diff ?? null;
      pc.avg_cs_diff_25 = pd[25]?.avg_cs_diff ?? null;
      pc.avg_level_diff_13 = pd[13]?.avg_lvl_diff ?? null;
      pc.avg_level_diff_20 = pd[20]?.avg_lvl_diff ?? null;
      pc.avg_level_diff_25 = pd[25]?.avg_lvl_diff ?? null;
      pc.avg_kills_diff_13 = pd[13]?.avg_kills_diff ?? null;
      pc.avg_kills_diff_20 = pd[20]?.avg_kills_diff ?? null;
      pc.avg_kills_diff_25 = pd[25]?.avg_kills_diff ?? null;
    }
  }

  // 3. Get all player IDs to batch-fetch match_log for streaks
  const playerIds = careerRows.map(r => r.player_id);

  // 4. Batch-fetch recent games for all players (for match_log / streak)
  const { rows: recentGames } = await pgDb.query(`
    SELECT
      gp.player_id,
      g.id AS game_id,
      g.winner_id,
      gp.team_id,
      g.begin_at
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.serie_id = $1 ${sf}
      AND gp.player_id = ANY($${stageParams.length + 2}::int[])
      AND g.finished = true AND g.length > 60
    ORDER BY g.begin_at DESC
  `, [serieId, ...stageParams, playerIds]);

  // Index recent games by player_id
  const gamesByPlayer = {};
  for (const g of recentGames) {
    (gamesByPlayer[g.player_id] ||= []).push(g);
  }

  // 5. Also batch-fetch per-game stats for avg_damage_share, avg_gold_share, etc.
  const { rows: perGameStats } = await pgDb.query(`
    SELECT
      gp.player_id,
      gp.game_id,
      g.length,
      gp.gold_earned,
      gp.total_damage_dealt_to_champions,
      gp.total_damage_taken,
      gp.magic_damage_taken,
      gp.physical_damage_taken,
      gp.wards_placed,
      gp.kills_wards,
      COALESCE(gp.vision_wards_bought_in_game, 0) AS vision_wards,
      -- team totals from game_teams for share calculations
      gt_team.gold    AS team_gold,
      gt_team.dmg     AS team_dmg
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    LEFT JOIN LATERAL (
      SELECT
        SUM(gp2.gold_earned) AS gold,
        SUM(gp2.total_damage_dealt_to_champions) AS dmg
      FROM game_players gp2
      WHERE gp2.game_id = gp.game_id AND gp2.team_id = gp.team_id
    ) gt_team ON true
    WHERE g.serie_id = $1 ${sf}
      AND gp.player_id = ANY($${stageParams.length + 2}::int[])
      AND g.finished = true AND g.length > 60
  `, [serieId, ...stageParams, playerIds]);

  // Aggregate per-player extra stats
  const extraByPlayer = {};
  for (const row of perGameStats) {
    const e = extraByPlayer[row.player_id] ||= {
      totalDuration: 0,
      gameCount: 0,
      dmgShareSum: 0, goldShareSum: 0,
      dtakenPmSum: 0, magicDtakenPmSum: 0, physDtakenPmSum: 0,
      vspmSum: 0,
    };
    const mins = (row.length || 1) / 60;
    e.totalDuration += row.length || 0;
    e.gameCount += 1;
    if (row.team_dmg > 0) e.dmgShareSum += (row.total_damage_dealt_to_champions || 0) / row.team_dmg * 100;
    if (row.team_gold > 0) e.goldShareSum += (row.gold_earned || 0) / row.team_gold * 100;
    e.dtakenPmSum += (row.total_damage_taken || 0) / mins;
    e.magicDtakenPmSum += (row.magic_damage_taken || 0) / mins;
    e.physDtakenPmSum += (row.physical_damage_taken || 0) / mins;
    e.vspmSum += ((row.wards_placed || 0) + (row.kills_wards || 0) + (row.vision_wards || 0)) / mins;
  }

  // 6. Build player objects matching the frontend expected shape
  const players = careerRows.map(pc => {
    const games = gamesByPlayer[pc.player_id] || [];
    const extra = extraByPlayer[pc.player_id] || { gameCount: 0 };
    const gc = extra.gameCount || 1;

    // Compute streak from recent games
    const matchLog = games.map(g => ({
      result: g.winner_id === g.team_id ? 'W' : 'L',
    }));

    // Format avg duration as MM:SS
    const avgDurSec = extra.gameCount > 0 ? extra.totalDuration / extra.gameCount : 0;
    const avgMins = Math.floor(avgDurSec / 60);
    const avgSecs = Math.round(avgDurSec % 60);
    const avgDurFormatted = `${avgMins}:${String(avgSecs).padStart(2, '0')}`;

    // blue/red WR
    const blueWr = pc.blue_games > 0 ? rnd(pc.blue_wins / pc.blue_games * 100, 0) : null;
    const redWr = pc.red_games > 0 ? rnd((pc.red_wins ?? (pc.red_games - (pc.blue_wins ?? 0))) / pc.red_games * 100, 0) : null;

    return {
      // Identity
      id: pc.player_id,
      name: pc.name,
      slug: pc.slug,
      image_url: pc.player_image_url,
      nationality: pc.nationality,
      role: mapRole(pc.role),
      position: mapRole(pc.role),
      team_abbr: pc.team_abbr,
      team_name: pc.team_name,
      team_logo_url: pc.team_logo_url,

      // Basic
      games: pc.games,
      wins: pc.wins,
      losses: pc.losses,
      win_rate: rnd(pc.win_rate, 1),

      // KDA
      total_kills: pc.total_kills,
      total_deaths: pc.total_deaths,
      total_assists: pc.total_assists,
      avg_kills: rnd(pc.kills_avg, 1),
      avg_deaths: rnd(pc.deaths_avg, 1),
      avg_assists: rnd(pc.assists_avg, 1),
      kda: rnd(pc.kda),
      kill_participation: rnd(pc.kill_participation, 0),

      // Per minute
      avg_gpm: rnd(pc.gpm, 0),
      avg_cspm: rnd(pc.cspm, 1),
      avg_dpm: rnd(pc.dpm, 0),
      avg_dtaken_per_min: rnd(extra.gameCount > 0 ? extra.dtakenPmSum / gc : pc.avg_dtaken_pm, 0),
      avg_wpm: rnd(pc.avg_wpm, 1),
      avg_wkpm: rnd(pc.avg_wkpm, 1),
      avg_cwpm: rnd(pc.avg_cwpm, 1),

      // Shares
      avg_damage_share: rnd(extra.gameCount > 0 ? extra.dmgShareSum / gc : pc.dmg_share, 1),
      avg_gold_share: rnd(extra.gameCount > 0 ? extra.goldShareSum / gc : pc.gold_share, 1),

      // Damage breakdown
      avg_magic_dpm: rnd(pc.avg_magic_dpm, 0),
      avg_physical_dpm: rnd(pc.avg_physical_dpm, 0),
      avg_true_dpm: rnd(pc.avg_true_dpm, 0),
      avg_magic_dtaken_pm: rnd(extra.gameCount > 0 ? extra.magicDtakenPmSum / gc : null, 0),
      avg_physical_dtaken_pm: rnd(extra.gameCount > 0 ? extra.physDtakenPmSum / gc : null, 0),

      // Timeline diffs
      avg_cs_diff_13: rnd(pc.avg_cs_diff_13, 1),
      avg_cs_diff_20: rnd(pc.avg_cs_diff_20, 1),
      avg_cs_diff_25: rnd(pc.avg_cs_diff_25, 1),
      avg_level_diff_13: rnd(pc.avg_level_diff_13, 1),
      avg_level_diff_20: rnd(pc.avg_level_diff_20, 1),
      avg_level_diff_25: rnd(pc.avg_level_diff_25, 1),
      avg_kills_diff_13: rnd(pc.avg_kills_diff_13, 1),
      avg_kills_diff_20: rnd(pc.avg_kills_diff_20, 1),
      avg_kills_diff_25: rnd(pc.avg_kills_diff_25, 1),

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
      fb_rate: rnd(pc.fb_rate ?? pc.first_blood_rate, 0),
      first_tower_rate: rnd(pc.first_tower_rate, 0),

      // Side
      blue_games: pc.blue_games,
      blue_wr: blueWr,
      red_games: pc.red_games,
      red_wr: redWr,

      // Vision
      avg_vspm: rnd(pc.avg_vspm, 1),

      // Match log (for streak)
      match_log: matchLog,
    };
  });

  // 7. Filter by position if requested
  const result = position && position !== 'All'
    ? players.filter(p => p.position === position)
    : players;

  res.json(result);
}

export async function getPlayerByNamePg(req, res) {
  const { name } = req.params;
  const { league = 'LEC', year, split, stage, team: teamParam } = req.query;
  const playerName = decodeURIComponent(name).trim();
  if (!playerName) throw new ApiError(400, 'Player name is required');

  // 1. Resolve serie
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) throw new ApiError(404, 'Serie not found');
  const { sf, stageParams } = stageFilter(stageParam, 3); // $1=playerId, $2=serieId, $3=tournamentId

  // 2. Find the player in player_career for this serie
  const baseQuery = `
    SELECT pc.*,
           p.name, p.image_url, p.slug, p.nationality,
           t.id AS tid, COALESCE(tb.display_acronym, t.acronym) AS team_abbr, COALESCE(tb.display_name, t.name) AS team_name,
           COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS team_logo_url
    FROM player_career pc
    JOIN players p ON p.id = pc.player_id
    LEFT JOIN teams t ON t.id = pc.team_id
    LEFT JOIN team_brands tb ON tb.team_id = pc.team_id AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
    WHERE pc.serie_id = $1 AND LOWER(p.name) = LOWER($2)
  `;

  let pcRows;

  // Try with team filter first (match real acronym, brand acronym, or brand slug)
  if (teamParam) {
    const { rows } = await pgDb.query(
      baseQuery + ` AND (LOWER(t.acronym) = LOWER($3) OR LOWER(tb.display_acronym) = LOWER($3) OR LOWER(tb.slug_name) = LOWER($3)) LIMIT 1`,
      [serieId, playerName, teamParam]
    );
    pcRows = rows;
  }

  // Fallback: search without team filter (handles brand mismatches)
  if (!pcRows || !pcRows.length) {
    const { rows } = await pgDb.query(baseQuery + ` LIMIT 1`, [serieId, playerName]);
    pcRows = rows;
  }

  if (!pcRows.length) throw new ApiError(404, `Player "${playerName}" not found in this serie`);
  const pc = pcRows[0];

  // 3. Parallel: champions played + match log + rune map + champ map + frame diffs + stage aggregation
  const hasStage = stageParam != null;

  const [{ rows: champStats }, { rows: matchLogRows }, champMap, runeMap, spellMap, runePathMap, { rows: frameDiffRows }, stageAggResult, stageChampResult] = await Promise.all([
    // Champion stats (pre-aggregated per serie — will be overridden by stageChampResult when stage active)
    pgDb.query(`
      SELECT pcs.champion_id, pcs.champion_name,
             pcs.games, pcs.wins, pcs.losses, pcs.win_rate,
             pcs.kills_avg, pcs.deaths_avg, pcs.assists_avg, pcs.kda, pcs.dpm
      FROM player_champion_stats pcs
      WHERE pcs.player_id = $1 AND pcs.serie_id = $2
      ORDER BY pcs.games DESC
    `, [pc.player_id, serieId]),

    pgDb.query(`
      SELECT
        gp.game_id, gp.id AS game_player_id,
        g.begin_at AS date,
        g.length AS duration,
        gp.champion_id,
        gp.kills, gp.deaths, gp.assists,
        gp.creep_score, gp.total_damage_dealt_to_champions, gp.gold_earned,
        gp.rune_shards,
        gp.rune_primary_path_id, gp.rune_secondary_path_id,
        CASE WHEN g.winner_id = gp.team_id THEN 'W' ELSE 'L' END AS result,
        gt.color AS side,
        opp.acronym AS opponent_abbr,
        COALESCE(opp.dark_mode_image_url, opp.image_url) AS opponent_logo
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
      LEFT JOIN LATERAL (
        SELECT t2.acronym, t2.image_url, t2.dark_mode_image_url
        FROM game_teams gt2
        JOIN teams t2 ON t2.id = gt2.team_id
        WHERE gt2.game_id = g.id AND gt2.team_id != gp.team_id
        LIMIT 1
      ) opp ON true
      WHERE gp.player_id = $1
        AND g.serie_id = $2 ${sf}
      ORDER BY g.begin_at DESC
      LIMIT 60
    `, [pc.player_id, serieId, ...stageParams]),

    getChampMap(),
    getRuneMap(),
    getSpellMap(),
    getRunePathMap(),

    // Frame-based CS/level diffs — computed live like SQLite aggregator
    // For each game, find closest frame to target timestamps, get player + opponent stats
    pgDb.query(`
      WITH player_games AS (
        SELECT gp.game_id, gp.role, gt.color AS side
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
        WHERE gp.player_id = $1 AND g.serie_id = $2 ${sf}
          AND g.finished = true AND g.length > 60
          AND gp.role IS NOT NULL
      ),
      target_frames AS (
        SELECT pg.game_id, pg.role, pg.side,
               gf.id AS frame_id, gf.timestamp AS ts,
               t.target_sec, t.minute_key,
               ROW_NUMBER() OVER (
                 PARTITION BY pg.game_id, t.minute_key
                 ORDER BY ABS(gf.timestamp - t.target_sec)
               ) AS rn
        FROM player_games pg
        CROSS JOIN (VALUES (13, 780), (20, 1200), (25, 1500)) AS t(minute_key, target_sec)
        JOIN game_frames gf ON gf.game_id = pg.game_id
          AND ABS(gf.timestamp - t.target_sec) <= 90
      )
      SELECT tf.minute_key,
             my.cs AS my_cs, my.level AS my_level,
             opp.cs AS opp_cs, opp.level AS opp_level
      FROM target_frames tf
      JOIN game_frame_players my ON my.frame_id = tf.frame_id
        AND my.team_color = tf.side::team_color AND my.role = tf.role::player_role
      JOIN game_frame_players opp ON opp.frame_id = tf.frame_id
        AND opp.team_color != tf.side::team_color AND opp.role = tf.role::player_role
      WHERE tf.rn = 1
        AND my.cs IS NOT NULL AND opp.cs IS NOT NULL
    `, [pc.player_id, serieId, ...stageParams]),

    // Stage-filtered aggregation: recompute ALL stats from game_players when stage is active
    hasStage ? pgDb.query(`
      SELECT
        COUNT(*) AS games,
        SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN g.winner_id != gp.team_id THEN 1 ELSE 0 END) AS losses,
        SUM(gp.kills) AS total_kills,
        SUM(gp.deaths) AS total_deaths,
        SUM(gp.assists) AS total_assists,
        ROUND(AVG(gp.kills)::numeric, 1) AS kills_avg,
        ROUND(AVG(gp.deaths)::numeric, 1) AS deaths_avg,
        ROUND(AVG(gp.assists)::numeric, 1) AS assists_avg,
        CASE WHEN SUM(gp.deaths) > 0
          THEN ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / SUM(gp.deaths)), 2)
          ELSE SUM(gp.kills) + SUM(gp.assists)
        END AS kda,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.total_damage_dealt_to_champions / (g.length / 60.0) END)::numeric, 0) AS dpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.gold_earned / (g.length / 60.0) END)::numeric, 0) AS gpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.creep_score / (g.length / 60.0) END)::numeric, 1) AS cspm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.total_damage_taken / (g.length / 60.0) END)::numeric, 0) AS dtaken_pm,
        ROUND(AVG(gp.total_damage_dealt_to_champions_percentage)::numeric, 1) AS dmg_share,
        ROUND(AVG(gp.gold_percentage)::numeric, 1) AS gold_share,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.magic_damage_dealt_to_champions / (g.length / 60.0) END)::numeric, 0) AS magic_dpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.physical_damage_dealt_to_champions / (g.length / 60.0) END)::numeric, 0) AS physical_dpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.true_damage_dealt_to_champions / (g.length / 60.0) END)::numeric, 0) AS true_dpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.wards_placed / (g.length / 60.0) END)::numeric, 2) AS wpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.kills_wards / (g.length / 60.0) END)::numeric, 2) AS wkpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN COALESCE(gp.vision_wards_bought_in_game, 0) / (g.length / 60.0) END)::numeric, 2) AS cwpm,
        ROUND(AVG(CASE WHEN g.length > 60 THEN (COALESCE(gp.wards_placed,0) + COALESCE(gp.kills_wards,0) + COALESCE(gp.vision_wards_bought_in_game,0)) / (g.length / 60.0) END)::numeric, 2) AS vspm,
        NULL AS kill_participation,
        ROUND(AVG(g.length)::numeric, 0) AS avg_duration,
        SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_games,
        SUM(CASE WHEN gt.color = 'blue' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS blue_wins,
        SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_games,
        SUM(CASE WHEN gt.color = 'red' AND g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS red_wins,
        MAX(gp.kills) AS max_kills,
        SUM(gp.double_kills) AS double_kills,
        SUM(gp.triple_kills) AS triple_kills,
        SUM(gp.quadra_kills) AS quadra_kills,
        SUM(gp.penta_kills) AS penta_kills,
        COUNT(DISTINCT gp.champion_id) AS unique_champions,
        ROUND(AVG(CASE WHEN gt.first_tower THEN 1 ELSE 0 END)::numeric * 100, 0) AS first_tower_rate,
        ROUND(AVG(CASE WHEN gp.first_blood_kill OR gp.first_blood_assist THEN 1 ELSE 0 END)::numeric * 100, 0) AS fb_rate
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
      WHERE gp.player_id = $1 AND g.serie_id = $2 ${sf}
        AND g.finished = true AND g.length > 60
    `, [pc.player_id, serieId, ...stageParams]) : Promise.resolve({ rows: [] }),

    // Stage-filtered champion stats from game_players
    hasStage ? pgDb.query(`
      SELECT
        gp.champion_id,
        ca.name AS champion_name,
        COUNT(*) AS games,
        SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
        COUNT(*) - SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS losses,
        CASE WHEN COUNT(*) > 0
          THEN ROUND((SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100), 1)
          ELSE 0 END AS win_rate,
        ROUND(AVG(gp.kills)::numeric, 1) AS kills_avg,
        ROUND(AVG(gp.deaths)::numeric, 1) AS deaths_avg,
        ROUND(AVG(gp.assists)::numeric, 1) AS assists_avg,
        CASE WHEN SUM(gp.deaths) > 0
          THEN ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / SUM(gp.deaths)), 2)
          ELSE SUM(gp.kills) + SUM(gp.assists)
        END AS kda,
        ROUND(AVG(CASE WHEN g.length > 60 THEN gp.total_damage_dealt_to_champions / (g.length / 60.0) END)::numeric, 0) AS dpm
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE gp.player_id = $1 AND g.serie_id = $2 ${sf}
        AND g.finished = true AND g.length > 60
      GROUP BY gp.champion_id, ca.name
      ORDER BY COUNT(*) DESC
    `, [pc.player_id, serieId, ...stageParams]) : Promise.resolve({ rows: [] }),
  ]);

  // Compute frame-based diffs (same as SQLite live aggregator)
  const frameDiffs = { 13: { cs: [], lvl: [] }, 20: { cs: [], lvl: [] }, 25: { cs: [], lvl: [] } };
  for (const r of frameDiffRows) {
    const mk = r.minute_key;
    if (frameDiffs[mk]) {
      frameDiffs[mk].cs.push(r.my_cs - r.opp_cs);
      if (r.my_level != null && r.opp_level != null) {
        frameDiffs[mk].lvl.push(r.my_level - r.opp_level);
      }
    }
  }
  const fdAvg = (arr) => arr.length > 0 ? rnd(arr.reduce((s, v) => s + v, 0) / arr.length, 1) : null;
  const fdAvg2 = (arr) => arr.length > 0 ? rnd(arr.reduce((s, v) => s + v, 0) / arr.length, 2) : null;

  // Build stage-overridden data source: use live-aggregated stats when stage filter is active
  const st = hasStage && stageAggResult.rows.length > 0 ? stageAggResult.rows[0] : null;
  const useChampStats = hasStage && stageChampResult.rows.length > 0 ? stageChampResult.rows : champStats;

  // 4. Fetch runes for match log games
  const gpIds = matchLogRows.map(m => m.game_player_id).filter(Boolean);
  let runesByGpId = {};
  if (gpIds.length > 0) {
    const { rows: runeRows } = await pgDb.query(`
      SELECT gpr.game_player_id, gpr.rune_id, gpr.tree, gpr.slot
      FROM game_player_runes gpr
      WHERE gpr.game_player_id = ANY($1::bigint[])
      ORDER BY gpr.game_player_id, gpr.slot
    `, [gpIds]);

    for (const r of runeRows) {
      if (!runesByGpId[r.game_player_id]) runesByGpId[r.game_player_id] = [];
      runesByGpId[r.game_player_id].push(r);
    }
  }

  // 5. Build response

  // Duration formatted — use stage data if available
  const avgDurSec = st ? (Number(st.avg_duration) || 0) : (pc.avg_duration || 0);
  const avgMins = Math.floor(avgDurSec / 60);
  const avgSecs = Math.round(avgDurSec % 60);
  const avgDurFormatted = `${avgMins}:${String(avgSecs).padStart(2, '0')}`;

  // Blue/Red WR — use stage data if available
  const blueGames = st ? Number(st.blue_games || 0) : (pc.blue_games || 0);
  const redGames = st ? Number(st.red_games || 0) : (pc.red_games || 0);
  const blueWins = st ? Number(st.blue_wins || 0) : (pc.blue_wins || 0);
  const redWins = st ? Number(st.red_wins || 0) : (pc.red_wins || 0);
  const blueWr = blueGames > 0 ? rnd(blueWins / blueGames * 100, 1) : null;
  const redWr = redGames > 0 ? rnd(redWins / redGames * 100, 1) : null;

  // Champions played (use stage-filtered data when available)
  const championsPlayed = useChampStats.map(cs => {
    const ch = champMap[cs.champion_id] || {};
    return {
      name: cs.champion_name || ch.name || `Champ ${cs.champion_id}`,
      image_url: ch.image_url || null,
      games: Number(cs.games),
      wins: Number(cs.wins),
      losses: Number(cs.losses),
      win_rate: rnd(cs.win_rate, 1),
      kda: rnd(cs.kda),
      avg_kills: rnd(cs.kills_avg, 1),
      avg_deaths: rnd(cs.deaths_avg, 1),
      avg_assists: rnd(cs.assists_avg, 1),
      avg_dpm: rnd(cs.dpm, 0),
    };
  });

  // Keystones from player_career.keystones_json — enrich with image_url from runeMap
  // (keystones_json only stores name/count/pct, not image_url)
  const runeByName = {};
  for (const [, rv] of Object.entries(runeMap)) {
    runeByName[rv.name?.toLowerCase()] = rv;
  }
  const keystones = ensureArr(pc.keystones_json).map(k => {
    const ri = runeByName[k.name?.toLowerCase()];
    return {
      name: k.name,
      image_url: k.image_url || ri?.image_url || null,
      count: k.count,
      pct: rnd(k.pct ?? (k.count / (_games || 1) * 100), 1),
    };
  });

  // Match log with runes
  const matchLog = matchLogRows.map(m => {
    const ch = champMap[m.champion_id] || {};
    const dur = m.duration || 1;

    // Build rune info
    const gpRunes = runesByGpId[m.game_player_id] || [];
    let keystoneInfo = null;
    let secondaryPathInfo = null;
    let shards = null;

    // Keystone: from game_player_runes (slot 0, primary tree)
    if (gpRunes.length > 0) {
      const keystone = gpRunes.find(r => r.slot === 0 && r.tree === 'primary');
      if (keystone) {
        const rd = runeMap[keystone.rune_id];
        keystoneInfo = rd ? { name: rd.name, image_url: rd.image_url } : null;
      }
    }

    // Secondary path: from game_players.rune_secondary_path_id → rune_paths table
    if (m.rune_secondary_path_id) {
      const sp = runePathMap[m.rune_secondary_path_id];
      if (sp) {
        secondaryPathInfo = { name: sp.name, image_url: sp.image_url };
      }
    }
    // Shards: always from rune_shards JSONB (same source as Record/SQLite)
    if (m.rune_shards) {
      const rs = typeof m.rune_shards === 'string' ? JSON.parse(m.rune_shards) : m.rune_shards;
      const toInfo = (obj) => obj && obj.id ? { id: obj.id, name: obj.name || '?', image_url: obj.image_url || null } : null;
      shards = {
        offense: toInfo(rs.offense),
        flex: toInfo(rs.flex),
        defense: toInfo(rs.defense),
      };
      if (!shards.offense && !shards.flex && !shards.defense) shards = null;
    }

    return {
      game_id: m.game_id,
      date: m.date,
      champion: { name: ch.name || `Champ ${m.champion_id}`, image_url: ch.image_url || null },
      kills: m.kills,
      deaths: m.deaths,
      assists: m.assists,
      result: m.result,
      side: m.side,
      cspm: dur > 60 ? rnd(m.creep_score / (dur / 60), 1) : null,
      dpm: dur > 60 ? rnd(m.total_damage_dealt_to_champions / (dur / 60), 0) : null,
      gpm: dur > 60 ? rnd(m.gold_earned / (dur / 60), 0) : null,
      opponent: { abbr: m.opponent_abbr, logo: m.opponent_logo },
      runes: {
        keystone: keystoneInfo?.name || null,
        keystone_img: keystoneInfo?.image_url || null,
        secondary_path: secondaryPathInfo?.name || null,
        secondary_path_img: secondaryPathInfo?.image_url || null,
        shards,
      },
    };
  });

  // Total ward stats — use stage data when available
  const _wpm = st ? Number(st.wpm || 0) : (pc.avg_wpm || 0);
  const _wkpm = st ? Number(st.wkpm || 0) : (pc.avg_wkpm || 0);
  const _cwpm = st ? Number(st.cwpm || 0) : (pc.avg_cwpm || 0);
  const _vspm = st ? Number(st.vspm || 0) : (pc.avg_vspm || 0);
  const _games = st ? Number(st.games || 0) : (pc.games || 0);
  const totalMinutes = avgDurSec / 60 * _games;
  const wardsPlaced = totalMinutes > 0 ? Math.round(_wpm * totalMinutes) : null;
  const wardsDestroyed = totalMinutes > 0 ? Math.round(_wkpm * totalMinutes) : null;
  const visionWardsBought = totalMinutes > 0 ? Math.round(_cwpm * totalMinutes) : null;

  // Win rate
  const _wins = st ? Number(st.wins || 0) : (pc.wins || 0);
  const _losses = st ? Number(st.losses || 0) : (pc.losses || 0);
  const _winRate = _games > 0 ? rnd(_wins / _games * 100, 1) : 0;

  res.json({
    id: pc.player_id,
    name: pc.name,
    image_url: pc.image_url,
    slug: pc.slug,
    nationality: pc.nationality,
    position: mapRole(pc.role),
    team_abbr: pc.team_abbr,
    team_name: pc.team_name,
    team_logo_url: pc.team_logo_url,

    games: _games,
    wins: _wins,
    losses: _losses,
    win_rate: _winRate,

    total_kills: st ? Number(st.total_kills || 0) : pc.total_kills,
    total_deaths: st ? Number(st.total_deaths || 0) : pc.total_deaths,
    total_assists: st ? Number(st.total_assists || 0) : pc.total_assists,
    avg_kills: rnd(st ? st.kills_avg : pc.kills_avg, 1),
    avg_deaths: rnd(st ? st.deaths_avg : pc.deaths_avg, 1),
    avg_assists: rnd(st ? st.assists_avg : pc.assists_avg, 1),
    kda: rnd(st ? st.kda : pc.kda),
    kill_participation: rnd(st ? st.kill_participation : pc.kill_participation, 1),

    avg_dpm: rnd(st ? st.dpm : pc.dpm, 0),
    avg_gpm: rnd(st ? st.gpm : pc.gpm, 0),
    avg_cspm: rnd(st ? st.cspm : pc.cspm, 1),
    avg_dtaken_per_min: rnd(st ? st.dtaken_pm : pc.avg_dtaken_pm, 0),
    avg_damage_share: rnd(st ? st.dmg_share : pc.dmg_share, 1),
    avg_gold_share: rnd(st ? st.gold_share : pc.gold_share, 1),

    avg_magic_dpm: rnd(st ? st.magic_dpm : pc.avg_magic_dpm, 0),
    avg_physical_dpm: rnd(st ? st.physical_dpm : pc.avg_physical_dpm, 0),
    avg_true_dpm: rnd(st ? st.true_dpm : pc.avg_true_dpm, 0),

    avg_wpm: rnd(_wpm, 2),
    avg_wkpm: rnd(_wkpm, 2),
    avg_cwpm: rnd(_cwpm, 2),
    avg_vspm: rnd(_vspm, 2),
    wards_placed: wardsPlaced,
    wards_destroyed: wardsDestroyed,
    vision_wards_bought: visionWardsBought,

    // Frame diffs computed live from game_frames (matches SQLite aggregator behavior)
    avg_cs_diff_13: fdAvg(frameDiffs[13].cs),
    avg_cs_diff_20: fdAvg(frameDiffs[20].cs),
    avg_cs_diff_25: fdAvg(frameDiffs[25].cs),
    avg_level_diff_13: fdAvg2(frameDiffs[13].lvl),
    avg_level_diff_20: fdAvg2(frameDiffs[20].lvl),
    avg_level_diff_25: fdAvg2(frameDiffs[25].lvl),
    avg_gold_diff_15: st ? null : rnd(pc.avg_cs_diff_14 != null ? pc.avg_cs_diff_14 * 20 : null, 0),

    first_blood_kills: null,
    first_blood_victim: null,
    fb_rate: st ? rnd(Number(st.fb_rate), 0) : rnd(pc.first_blood_rate, 1),
    first_tower_rate: st ? rnd(Number(st.first_tower_rate), 0) : rnd(pc.first_tower_rate, 1),
    max_kills: st ? Number(st.max_kills || 0) : pc.max_kills,
    double_kills: st ? Number(st.double_kills || 0) : pc.double_kills,
    triple_kills: st ? Number(st.triple_kills || 0) : pc.triple_kills,
    quadra_kills: st ? Number(st.quadra_kills || 0) : pc.quadra_kills,
    penta_kills: st ? Number(st.penta_kills || 0) : pc.penta_kills,

    blue_wr: blueWr,
    red_wr: redWr,
    blue_games: blueGames,
    red_games: redGames,

    avg_duration: rnd(avgDurSec / 60, 1),
    avg_duration_formatted: avgDurFormatted,

    unique_champions: st ? Number(st.unique_champions || 0) : pc.unique_champions,
    champions_played: championsPlayed,
    keystones,
    match_log: matchLog,
  });
}
