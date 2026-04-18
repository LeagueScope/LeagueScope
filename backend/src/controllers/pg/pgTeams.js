import { pgDb, ApiError, resolveLeagueId, resolveSerie, pct, rnd, fmtMins, stageFilter } from './pgHelpers.js';

export async function getTeamsPg(req, res) {
  const { league = 'LEC', year, split, stage } = req.query;

  // 1. Resolve serie + stage (tournament)
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json([]);

  // Stage filter: applied to all queries that filter by g.serie_id
  const { sf, stageParams } = stageFilter(stageParam, 2);
  const teamIdx = stageParams.length ? 3 : 2; // next available param index after stageParams

  // 2. Team-level aggregation from game_teams + games
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
    WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
    GROUP BY gt.team_id, t.slug, t.image_url, t.dark_mode_image_url, tb.display_name, tb.display_acronym, tb.display_logo, t.name, t.acronym
    ORDER BY SUM(CASE WHEN g.winner_id = gt.team_id THEN 1 ELSE 0 END) DESC
  `, [serieId, ...stageParams]);

  if (!teamStats.length) return res.json([]);

  const teamIds = teamStats.map(t => t.team_id);

  // 3. Player-level aggregation per team (damage, wards, CS, gold, etc.)
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
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
        AND gp.team_id = ANY($${teamIdx}::int[])
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
  `, [serieId, ...stageParams, teamIds]);

  const playerAggMap = {};
  for (const pa of playerAgg) playerAggMap[pa.team_id] = pa;

  // 4. Unique champions via champion_aliases (canonical)
  const { rows: champCounts } = await pgDb.query(`
    SELECT gp.team_id, COUNT(DISTINCT ca.canonical_id) AS unique_champions
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
    WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
      AND gp.team_id = ANY($${teamIdx}::int[])
    GROUP BY gp.team_id
  `, [serieId, ...stageParams, teamIds]);
  const ucMap = {};
  for (const r of champCounts) ucMap[r.team_id] = Number(r.unique_champions);

  // 5. Rival deaths (opponent kills = our deaths) per team
  const { rows: rivalKills } = await pgDb.query(`
    SELECT
      rival.team_id AS our_team_id,
      ROUND(AVG(gt.kills)::numeric, 1) AS avg_deaths,
      ROUND(AVG(gt.tower_kills)::numeric, 1) AS avg_towers_lost
    FROM game_teams gt
    JOIN games g ON g.id = gt.game_id
    JOIN game_teams rival ON rival.game_id = gt.game_id AND rival.team_id != gt.team_id
    WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
      AND rival.team_id = ANY($${teamIdx}::int[])
    GROUP BY rival.team_id
  `, [serieId, ...stageParams, teamIds]);
  const rivalMap = {};
  for (const r of rivalKills) rivalMap[r.our_team_id] = r;

  // 6. Per-game gold/CS differential vs opponent
  const { rows: diffs } = await pgDb.query(`
    WITH team_game AS (
      SELECT gp.team_id, gp.game_id, g.length,
        SUM(gp.gold_earned) AS gold,
        SUM(COALESCE(gp.creep_score, gp.minions_killed)) AS cs
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
        AND gp.team_id = ANY($${teamIdx}::int[])
      GROUP BY gp.team_id, gp.game_id, g.length
    )
    SELECT
      a.team_id,
      ROUND(AVG((a.gold - b.gold)::numeric / GREATEST(a.length / 60.0, 1)), 1) AS delta_gpm,
      ROUND(AVG((a.cs - b.cs)::numeric / GREATEST(a.length / 60.0, 1)), 1)     AS delta_cspm
    FROM team_game a
    JOIN team_game b ON a.game_id = b.game_id AND a.team_id != b.team_id
    GROUP BY a.team_id
  `, [serieId, ...stageParams, teamIds]);
  const diffMap = {};
  for (const d of diffs) diffMap[d.team_id] = d;

  // 7. Timeline diffs @13/@20/@25 — SIMPLE: for each game & target minute, pick the
  //     closest frame within ±180s. Read gold/kills/towers directly from game_frames
  //     (denormalized per team color). CS comes from game_frame_players summed by color.
  const { rows: tlDiffs } = await pgDb.query(`
    WITH targets AS (
      SELECT * FROM (VALUES (13, 780), (20, 1200), (25, 1500)) AS t(minute_key, target_sec)
    ),
    closest AS (
      SELECT gf.id AS frame_id, gf.game_id, gf.timestamp,
             gf.blue_team_id, gf.red_team_id,
             gf.blue_gold, gf.red_gold,
             gf.blue_kills, gf.red_kills,
             gf.blue_towers, gf.red_towers,
             t.minute_key,
             ROW_NUMBER() OVER (PARTITION BY gf.game_id, t.minute_key
                                ORDER BY ABS(gf.timestamp - t.target_sec)) AS rn
      FROM game_frames gf
      JOIN games g ON g.id = gf.game_id
      CROSS JOIN targets t
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length >= (t.target_sec + 60)
        AND (gf.blue_team_id = ANY($${teamIdx}::int[]) OR gf.red_team_id = ANY($${teamIdx}::int[]))
        AND ABS(gf.timestamp - t.target_sec) <= 180
    ),
    frame_cs AS (
      SELECT fp.frame_id,
             SUM(CASE WHEN fp.team_color = 'blue' THEN fp.cs ELSE 0 END) AS blue_cs,
             SUM(CASE WHEN fp.team_color = 'red'  THEN fp.cs ELSE 0 END) AS red_cs
      FROM game_frame_players fp
      WHERE fp.frame_id IN (SELECT frame_id FROM closest WHERE rn = 1)
      GROUP BY fp.frame_id
    ),
    per_game AS (
      SELECT c.*, fc.blue_cs, fc.red_cs
      FROM closest c
      LEFT JOIN frame_cs fc ON fc.frame_id = c.frame_id
      WHERE c.rn = 1
    )
    SELECT team_id, minute_key,
           ROUND(AVG(gold_diff)::numeric) AS avg_gold_diff,
           ROUND(AVG(kills_diff)::numeric, 1) AS avg_kills_diff,
           ROUND(AVG(tower_diff)::numeric, 1) AS avg_tower_diff,
           ROUND(AVG(cs_diff)::numeric, 1)   AS avg_cs_diff
    FROM (
      SELECT blue_team_id AS team_id, minute_key,
             (blue_gold - red_gold)     AS gold_diff,
             (blue_kills - red_kills)   AS kills_diff,
             (blue_towers - red_towers) AS tower_diff,
             (blue_cs - red_cs)         AS cs_diff
      FROM per_game WHERE blue_team_id = ANY($${teamIdx}::int[])
      UNION ALL
      SELECT red_team_id AS team_id, minute_key,
             (red_gold - blue_gold)     AS gold_diff,
             (red_kills - blue_kills)   AS kills_diff,
             (red_towers - blue_towers) AS tower_diff,
             (red_cs - blue_cs)         AS cs_diff
      FROM per_game WHERE red_team_id = ANY($${teamIdx}::int[])
    ) s
    GROUP BY team_id, minute_key
  `, [serieId, ...stageParams, teamIds]);

  const tlMap = {};
  for (const r of tlDiffs) {
    if (!tlMap[r.team_id]) tlMap[r.team_id] = {};
    const mb = r.minute_key;
    if (r.avg_gold_diff  != null) tlMap[r.team_id][`avg_gold_diff_${mb}`]  = Number(r.avg_gold_diff);
    if (r.avg_kills_diff != null) tlMap[r.team_id][`avg_kills_diff_${mb}`] = Number(r.avg_kills_diff);
    if (r.avg_tower_diff != null) tlMap[r.team_id][`avg_tower_diff_${mb}`] = Number(r.avg_tower_diff);
    if (r.avg_cs_diff    != null) tlMap[r.team_id][`avg_cs_diff_${mb}`]    = Number(r.avg_cs_diff);
  }

  // 8. CS diff @14 from game_players (fallback for @13 if frame_players data is missing)
  const { rows: csDiffs } = await pgDb.query(`
    WITH per_game AS (
      SELECT gp.team_id, gp.game_id, AVG(gp.cs_diff_at_14) AS cs_diff_14
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
        AND gp.team_id = ANY($${teamIdx}::int[]) AND gp.cs_diff_at_14 IS NOT NULL
      GROUP BY gp.team_id, gp.game_id
    )
    SELECT team_id, ROUND(AVG(cs_diff_14)::numeric, 1) AS avg_cs_diff_13
    FROM per_game GROUP BY team_id
  `, [serieId, ...stageParams, teamIds]);
  const csDiffMap = {};
  for (const r of csDiffs) csDiffMap[r.team_id] = Number(r.avg_cs_diff_13);

  // 8b. team_career fallback for GD/KD/TWD @13, @20, @25 + CSD @20/@25 — used when
  //     game_frames hasn't been populated yet (PandaScore aggregates come from
  //     /lol/series/{id}/teams/stats and are ingested by fetch-to-postgres).
  const { rows: tcDiffs } = await pgDb.query(`
    SELECT team_id,
           avg_gold_diff_13, avg_gold_diff_20, avg_gold_diff_25,
           avg_cs_diff_13,   avg_cs_diff_20,   avg_cs_diff_25,
           avg_kills_diff_13, avg_kills_diff_20, avg_kills_diff_25,
           avg_tower_diff_13, avg_tower_diff_20, avg_tower_diff_25
    FROM team_career
    WHERE serie_id = $1 AND team_id = ANY($2::int[])
  `, [serieId, teamIds]);
  const tcDiffMap = {};
  for (const r of tcDiffs) {
    tcDiffMap[r.team_id] = {
      avg_gold_diff_13:  r.avg_gold_diff_13  != null ? Number(r.avg_gold_diff_13)  : null,
      avg_gold_diff_20:  r.avg_gold_diff_20  != null ? Number(r.avg_gold_diff_20)  : null,
      avg_gold_diff_25:  r.avg_gold_diff_25  != null ? Number(r.avg_gold_diff_25)  : null,
      avg_cs_diff_13:    r.avg_cs_diff_13    != null ? Number(r.avg_cs_diff_13)    : null,
      avg_cs_diff_20:    r.avg_cs_diff_20    != null ? Number(r.avg_cs_diff_20)    : null,
      avg_cs_diff_25:    r.avg_cs_diff_25    != null ? Number(r.avg_cs_diff_25)    : null,
      avg_kills_diff_13: r.avg_kills_diff_13 != null ? Number(r.avg_kills_diff_13) : null,
      avg_kills_diff_20: r.avg_kills_diff_20 != null ? Number(r.avg_kills_diff_20) : null,
      avg_kills_diff_25: r.avg_kills_diff_25 != null ? Number(r.avg_kills_diff_25) : null,
      avg_tower_diff_13: r.avg_tower_diff_13 != null ? Number(r.avg_tower_diff_13) : null,
      avg_tower_diff_20: r.avg_tower_diff_20 != null ? Number(r.avg_tower_diff_20) : null,
      avg_tower_diff_25: r.avg_tower_diff_25 != null ? Number(r.avg_tower_diff_25) : null,
    };
  }

  // 8c. CS diff @13/@20/@25 derived from player_career — AVG across the team's
  //     players multiplied by 5 (since each player's avg_cs_diff is a per-role
  //     duel, and 5 duels summed = team CS diff). AVG ignores NULLs so @20/@25
  //     come through even if only a subset of players has that field.
  const { rows: pcCs } = await pgDb.query(`
    SELECT team_id,
      ROUND((AVG(avg_cs_diff_13) * 5)::numeric, 1) AS cs_diff_13,
      ROUND((AVG(avg_cs_diff_20) * 5)::numeric, 1) AS cs_diff_20,
      ROUND((AVG(avg_cs_diff_25) * 5)::numeric, 1) AS cs_diff_25
    FROM player_career
    WHERE serie_id = $1 AND team_id = ANY($2::int[])
    GROUP BY team_id
  `, [serieId, teamIds]);
  const pcCsMap = {};
  for (const r of pcCs) {
    pcCsMap[r.team_id] = {
      avg_cs_diff_13: r.cs_diff_13 != null ? Number(r.cs_diff_13) : null,
      avg_cs_diff_20: r.cs_diff_20 != null ? Number(r.cs_diff_20) : null,
      avg_cs_diff_25: r.cs_diff_25 != null ? Number(r.cs_diff_25) : null,
    };
  }

  // 8d. KD and TWD @13/@20/@25 derived from game_events — counts player_kill and
  //     tower_kill events by the team's players with timestamp ≤ T*60 seconds,
  //     subtracts the opponent's count, and averages across games that actually
  //     reached that minute mark (length-based filter).
  //     Caveat: tower_kill events without a killer_player_id (minion executes)
  //     are not attributed to either team and get dropped.
  const { rows: evRows } = await pgDb.query(`
    WITH team_bucket_counts AS (
      SELECT
        ge.game_id,
        gp.team_id,
        SUM(CASE WHEN ge.type='player_kill' AND ge.timestamp <= 780  THEN 1 ELSE 0 END) AS k13,
        SUM(CASE WHEN ge.type='player_kill' AND ge.timestamp <= 1200 THEN 1 ELSE 0 END) AS k20,
        SUM(CASE WHEN ge.type='player_kill' AND ge.timestamp <= 1500 THEN 1 ELSE 0 END) AS k25,
        SUM(CASE WHEN ge.type='tower_kill'  AND ge.timestamp <= 780  THEN 1 ELSE 0 END) AS t13,
        SUM(CASE WHEN ge.type='tower_kill'  AND ge.timestamp <= 1200 THEN 1 ELSE 0 END) AS t20,
        SUM(CASE WHEN ge.type='tower_kill'  AND ge.timestamp <= 1500 THEN 1 ELSE 0 END) AS t25
      FROM game_events ge
      JOIN game_players gp ON gp.game_id = ge.game_id AND gp.player_id = ge.killer_player_id
      JOIN games g ON g.id = ge.game_id
      WHERE g.serie_id = $1 ${sf}
        AND g.finished = true
        AND ge.type IN ('player_kill','tower_kill')
      GROUP BY ge.game_id, gp.team_id
    ),
    diffs AS (
      SELECT
        gt.team_id, g.length,
        COALESCE(m.k13,0) - COALESCE(o.k13,0) AS kd13,
        COALESCE(m.k20,0) - COALESCE(o.k20,0) AS kd20,
        COALESCE(m.k25,0) - COALESCE(o.k25,0) AS kd25,
        COALESCE(m.t13,0) - COALESCE(o.t13,0) AS td13,
        COALESCE(m.t20,0) - COALESCE(o.t20,0) AS td20,
        COALESCE(m.t25,0) - COALESCE(o.t25,0) AS td25
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      JOIN game_teams gt2 ON gt2.game_id = gt.game_id AND gt2.team_id != gt.team_id
      LEFT JOIN team_bucket_counts m ON m.game_id = gt.game_id AND m.team_id = gt.team_id
      LEFT JOIN team_bucket_counts o ON o.game_id = gt.game_id AND o.team_id = gt2.team_id
      WHERE g.serie_id = $1 ${sf}
        AND g.finished = true AND g.length > 60
        AND gt.team_id = ANY($${teamIdx}::int[])
    )
    SELECT team_id,
      ROUND((AVG(kd13) FILTER (WHERE length >= 780))::numeric, 1)  AS kd13,
      ROUND((AVG(kd20) FILTER (WHERE length >= 1200))::numeric, 1) AS kd20,
      ROUND((AVG(kd25) FILTER (WHERE length >= 1500))::numeric, 1) AS kd25,
      ROUND((AVG(td13) FILTER (WHERE length >= 780))::numeric, 1)  AS td13,
      ROUND((AVG(td20) FILTER (WHERE length >= 1200))::numeric, 1) AS td20,
      ROUND((AVG(td25) FILTER (WHERE length >= 1500))::numeric, 1) AS td25
    FROM diffs
    GROUP BY team_id
  `, [serieId, ...stageParams, teamIds]);
  const evMap = {};
  for (const r of evRows) {
    evMap[r.team_id] = {
      avg_kills_diff_13: r.kd13 != null ? Number(r.kd13) : null,
      avg_kills_diff_20: r.kd20 != null ? Number(r.kd20) : null,
      avg_kills_diff_25: r.kd25 != null ? Number(r.kd25) : null,
      avg_tower_diff_13: r.td13 != null ? Number(r.td13) : null,
      avg_tower_diff_20: r.td20 != null ? Number(r.td20) : null,
      avg_tower_diff_25: r.td25 != null ? Number(r.td25) : null,
    };
  }

  // 9. Match history (for streaks) — last 50 games
  const { rows: matchHist } = await pgDb.query(`
    SELECT gt.team_id, g.id AS game_id, g.winner_id, g.begin_at, gt.color,
           rival.team_id AS opponent_id, rt.acronym AS opponent_acronym
    FROM game_teams gt
    JOIN games g ON g.id = gt.game_id
    JOIN game_teams rival ON rival.game_id = gt.game_id AND rival.team_id != gt.team_id
    JOIN teams rt ON rt.id = rival.team_id
    WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
      AND gt.team_id = ANY($${teamIdx}::int[])
    ORDER BY g.begin_at DESC
  `, [serieId, ...stageParams, teamIds]);

  const histMap = {};
  for (const r of matchHist) {
    if (!histMap[r.team_id]) histMap[r.team_id] = [];
    if (histMap[r.team_id].length < 50) {
      histMap[r.team_id].push({
        gameid: r.game_id,
        result: r.winner_id === r.team_id,
        opponent: r.opponent_acronym,
        side: r.color,
        date: r.begin_at,
      });
    }
  }

  // 10. BO3+ detection — if serie plays best-of-3+, surface series-level W/L
  //     (so standings show 4-2 series like Riot publishes instead of 10-5 games)
  const { rows: bestOfRows } = await pgDb.query(`
    SELECT mode() WITHIN GROUP (ORDER BY COALESCE(number_of_games, 1)) AS best_of
    FROM matches WHERE serie_id = $1 AND status = 'finished'
  `, [serieId]);
  const serieBestOf = Number(bestOfRows[0]?.best_of) || 1;
  const useMatchWL = serieBestOf >= 3;

  // Match-level standings (series W/L) + series history — only when BO3+
  const matchStandingsMap = {};
  const seriesHistMap = {};
  if (useMatchWL) {
    // Stage filter for matches.tournament_id (matches table, not games)
    // stageParams = [] or [tournamentId]; $1 = serieId; then stageParams; then teamIds
    const mTourIdx = stageParams.length ? 2 : null;
    const mTeamIdx = stageParams.length ? 3 : 2;
    const mf = mTourIdx ? `AND m.tournament_id = $${mTourIdx}` : '';
    const matchParams = stageParams.length
      ? [serieId, ...stageParams, teamIds]
      : [serieId, teamIds];

    const { rows: ms } = await pgDb.query(`
      SELECT mo.team_id,
             COUNT(*) FILTER (WHERE m.winner_id = mo.team_id) AS match_wins,
             COUNT(*) FILTER (WHERE m.winner_id IS NOT NULL AND m.winner_id != mo.team_id) AS match_losses
      FROM matches m
      JOIN match_opponents mo ON mo.match_id = m.id
      WHERE m.serie_id = $1 ${mf} AND m.status = 'finished'
        AND mo.team_id = ANY($${mTeamIdx}::int[])
      GROUP BY mo.team_id
    `, matchParams);
    for (const r of ms) {
      matchStandingsMap[r.team_id] = {
        match_wins: Number(r.match_wins) || 0,
        match_losses: Number(r.match_losses) || 0,
      };
    }

    // Series history (for series-level streak calculation in the client)
    const { rows: sh } = await pgDb.query(`
      SELECT mo.team_id, m.id AS match_id, m.winner_id, m.begin_at,
             opp_t.acronym AS opponent_acronym
      FROM matches m
      JOIN match_opponents mo ON mo.match_id = m.id
      JOIN match_opponents opp ON opp.match_id = m.id AND opp.team_id != mo.team_id
      JOIN teams opp_t ON opp_t.id = opp.team_id
      WHERE m.serie_id = $1 ${mf} AND m.status = 'finished'
        AND mo.team_id = ANY($${mTeamIdx}::int[])
      ORDER BY m.begin_at DESC
    `, matchParams);
    for (const r of sh) {
      if (!seriesHistMap[r.team_id]) seriesHistMap[r.team_id] = [];
      if (seriesHistMap[r.team_id].length < 50) {
        seriesHistMap[r.team_id].push({
          match_id: r.match_id,
          result: r.winner_id === r.team_id,
          opponent: r.opponent_acronym,
          date: r.begin_at,
        });
      }
    }
  }

  // ── Build result array ────────────────────────────────────────────────────
  const result = teamStats.map(t => {
    const pa = playerAggMap[t.team_id] || {};
    const rv = rivalMap[t.team_id] || {};
    const df = diffMap[t.team_id] || {};
    const tl = tlMap[t.team_id] || {};
    const tc = tcDiffMap[t.team_id] || {};
    const pcc = pcCsMap[t.team_id] || {};
    const ev = evMap[t.team_id] || {};
    const n = Number(t.games);
    const wins = Number(t.wins);
    const losses = Number(t.losses);
    const totalDurSec = Number(pa.total_duration_sec || 0);
    const totalDurMin = totalDurSec / 60;
    const avgDurMin = Number(t.avg_duration_min) || 0;

    // Per-minute rates (total / total_minutes)
    const pmRate = (total) => totalDurMin > 0 ? rnd(Number(total || 0) / totalDurMin) : null;

    const avgKills = Number(t.avg_kills);
    const avgDeaths = Number(rv.avg_deaths || 0);
    const avgAssists = n > 0 ? rnd(Number(pa.total_assists || 0) / n, 1) : null;
    const kda = avgDeaths > 0 ? rnd((avgKills + (avgAssists || 0)) / avgDeaths) : null;

    const blueGames = Number(t.blue_games);
    const blueWins = Number(t.blue_wins);
    const redGames = Number(t.red_games);
    const redWins = Number(t.red_wins);

    return {
      id: t.team_id,
      name: t.brand_name,
      team: t.brand_name,
      abbr: t.brand_acronym,
      logo_url: t.image_url,
      slug: t.slug,

      games: n,
      wins,
      losses,
      win_rate: pct(wins, n),

      avg_duration: avgDurMin,
      avg_duration_formatted: fmtMins(avgDurMin),
      unique_champions: ucMap[t.team_id] || 0,

      // Side WR
      blue_games: blueGames,
      blue_wins: blueWins,
      blue_wr: pct(blueWins, blueGames),
      red_games: redGames,
      red_wins: redWins,
      red_wr: pct(redWins, redGames),

      // First objectives %
      first_blood_rate: pct(Number(t.fb_count), n),
      first_tower_rate: pct(Number(t.ft_count), n),
      first_dragon_rate: pct(Number(t.fd_count), n),
      first_baron_rate: pct(Number(t.fba_count), n),
      first_herald_rate: pct(Number(t.fh_count), n),
      first_inhibitor_rate: pct(Number(t.fi_count), n),
      first_voidgrub_rate: pct(Number(t.fvg_count), n),
      first_atakhan_rate: pct(Number(t.fat_count), n),

      // Avg / game
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

      // Per minute
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

      // Differentials
      delta_gpm: Number(df.delta_gpm || 0),
      delta_cspm: Number(df.delta_cspm || 0),

      // Economy
      avg_gold_spent: n > 0 ? rnd(Number(pa.total_gold_spent || 0) / n) : null,
      avg_neutral_minions_enemy: n > 0 ? rnd(Number(pa.total_neutral_enemy || 0) / n, 1) : null,
      avg_neutral_minions_team: n > 0 ? rnd(Number(pa.total_neutral_team || 0) / n, 1) : null,

      // Timeline diffs — cascade of fallbacks (prefer most computed-on-the-fly):
      //  CSD: game_frames → SUM player_career (5 role-starters) → game_players @14 (only @13) → team_career
      //  KD:  game_frames → game_events (count @T) → team_career
      //  TWD: game_frames → game_events (count @T) → team_career
      //  GD:  game_frames → team_career   (gold is continuous, no event source)
      avg_gold_diff_13:  tl.avg_gold_diff_13  ?? tc.avg_gold_diff_13  ?? null,
      avg_cs_diff_13:    tl.avg_cs_diff_13    ?? pcc.avg_cs_diff_13    ?? csDiffMap[t.team_id] ?? tc.avg_cs_diff_13 ?? null,
      avg_kills_diff_13: tl.avg_kills_diff_13 ?? ev.avg_kills_diff_13  ?? tc.avg_kills_diff_13 ?? null,
      avg_tower_diff_13: tl.avg_tower_diff_13 ?? ev.avg_tower_diff_13  ?? tc.avg_tower_diff_13 ?? null,
      avg_gold_diff_20:  tl.avg_gold_diff_20  ?? tc.avg_gold_diff_20   ?? null,
      avg_cs_diff_20:    tl.avg_cs_diff_20    ?? pcc.avg_cs_diff_20    ?? tc.avg_cs_diff_20    ?? null,
      avg_kills_diff_20: tl.avg_kills_diff_20 ?? ev.avg_kills_diff_20  ?? tc.avg_kills_diff_20 ?? null,
      avg_tower_diff_20: tl.avg_tower_diff_20 ?? ev.avg_tower_diff_20  ?? tc.avg_tower_diff_20 ?? null,
      avg_gold_diff_25:  tl.avg_gold_diff_25  ?? tc.avg_gold_diff_25   ?? null,
      avg_cs_diff_25:    tl.avg_cs_diff_25    ?? pcc.avg_cs_diff_25    ?? tc.avg_cs_diff_25    ?? null,
      avg_kills_diff_25: tl.avg_kills_diff_25 ?? ev.avg_kills_diff_25  ?? tc.avg_kills_diff_25 ?? null,
      avg_tower_diff_25: tl.avg_tower_diff_25 ?? ev.avg_tower_diff_25  ?? tc.avg_tower_diff_25 ?? null,

      // Match history (for streaks)
      match_history: histMap[t.team_id] || [],

      // Series-level fields (BO3+ only): keeps Pro Vision (game-level) untouched
      ...(useMatchWL ? {
        best_of: serieBestOf,
        match_wins: matchStandingsMap[t.team_id]?.match_wins ?? 0,
        match_losses: matchStandingsMap[t.team_id]?.match_losses ?? 0,
        match_wr: matchStandingsMap[t.team_id]
          ? pct(
              matchStandingsMap[t.team_id].match_wins,
              matchStandingsMap[t.team_id].match_wins + matchStandingsMap[t.team_id].match_losses
            )
          : 0,
        series_history: seriesHistMap[t.team_id] || [],
      } : {}),
    };
  });

  res.json(result);
}

export async function getTeamByAbbrPg(req, res) {
  const { abbr } = req.params;
  const { league = 'LEC', year, split, stage } = req.query;

  // 1. Resolve serie + stage
  let { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.status(404).json({ error: 'Serie not found' });
  const { sf, stageParams } = stageFilter(stageParam, 3); // $1=serieId, $2=teamId, $3=tournamentId

  // 2. Find team by abbreviation — search current acronym, slug, name, and historical brands
  let { rows: teamRows } = await pgDb.query(`
    SELECT t.id, t.name, t.acronym, t.slug,
           COALESCE(t.dark_mode_image_url, t.image_url) AS image_url
    FROM teams t
    WHERE UPPER(t.acronym) = UPPER($1)
       OR t.slug = LOWER($1)
       OR UPPER(t.name) = UPPER($1)
    LIMIT 1
  `, [abbr]);

  // Fallback: search in team_brands (historical names/slugs)
  if (!teamRows.length) {
    const { rows: brandRows } = await pgDb.query(`
      SELECT DISTINCT ON (t.id) t.id, t.name, t.acronym, t.slug,
             COALESCE(t.dark_mode_image_url, t.image_url) AS image_url
      FROM team_brands tb
      JOIN teams t ON t.id = tb.team_id
      WHERE UPPER(tb.display_name) = UPPER($1)
         OR tb.slug_name = LOWER($1)
         OR UPPER(tb.display_name) LIKE UPPER($1) || '%'
      LIMIT 1
    `, [abbr]);
    teamRows = brandRows;
  }

  // Fallback: search by display_acronym in team_brands
  if (!teamRows.length) {
    const { rows: acrRows } = await pgDb.query(`
      SELECT DISTINCT t.id, t.name, t.acronym, t.slug, COALESCE(t.dark_mode_image_url, t.image_url) AS image_url
      FROM team_brands tb
      JOIN teams t ON t.id = tb.team_id
      WHERE UPPER(tb.display_acronym) = UPPER($1)
      LIMIT 1
    `, [abbr]);
    teamRows = acrRows;
  }

  if (!teamRows.length) return res.status(404).json({ error: 'Team not found' });
  const teamRow = teamRows[0];
  const teamId = teamRow.id;

  // 3. Get team stats — precalculated (team_career) or live from game_teams when stage active
  const requestedSerieId = serieId;   // keep original to detect fallback
  let tc;
  if (stageParam) {
    // Recalculate ALL team stats from game_teams + game_players for the specific tournament
    const { sf: stf, stageParams: stageParams3 } = stageFilter(stageParam, 3);
    const [{ rows: liveRows }, { rows: pmRows }] = await Promise.all([
      // Team-level stats from game_teams
      pgDb.query(`
        WITH team_games AS (
          SELECT gt.*, g.length, g.winner_id,
                 opp.gold_earned AS opp_gold, opp.tower_kills AS opp_towers
          FROM game_teams gt
          JOIN games g ON g.id = gt.game_id
          LEFT JOIN game_teams opp ON opp.game_id = g.id AND opp.team_id != gt.team_id
          WHERE gt.team_id = $1 AND g.serie_id = $2 ${stf} AND g.finished = true AND g.length > 60
        )
        SELECT
          COUNT(*) AS games,
          SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN winner_id != $1 THEN 1 ELSE 0 END) AS losses,
          ROUND(SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS win_rate,
          ROUND(AVG(length)::numeric, 0) AS avg_duration,
          ROUND(AVG(kills)::numeric, 1) AS kills_avg,
          ROUND(AVG(tower_kills)::numeric, 1) AS avg_towers,
          ROUND(AVG(opp_towers)::numeric, 1) AS avg_towers_lost,
          ROUND(AVG(dragon_kills)::numeric, 1) AS avg_dragons,
          ROUND(AVG(baron_kills)::numeric, 1) AS avg_barons,
          ROUND(AVG(herald_kills)::numeric, 1) AS avg_heralds,
          ROUND(AVG(inhibitor_kills)::numeric, 1) AS avg_inhibitors,
          ROUND(AVG(COALESCE(voidgrub_kills, 0))::numeric, 1) AS avg_voidgrubs,
          ROUND(AVG(COALESCE(atakhan_kills, 0))::numeric, 1) AS avg_atakhans,
          ROUND(AVG(COALESCE(elder_drake_kills, 0))::numeric, 1) AS avg_elder_dragons,
          0 AS avg_plates,
          ROUND(SUM(CASE WHEN first_blood THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_blood_rate,
          ROUND(SUM(CASE WHEN first_tower THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_tower_rate,
          ROUND(SUM(CASE WHEN first_dragon THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_dragon_rate,
          ROUND(SUM(CASE WHEN first_baron THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_baron_rate,
          ROUND(SUM(CASE WHEN first_herald THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_herald_rate,
          ROUND(SUM(CASE WHEN first_voidgrub THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_voidgrub_rate,
          ROUND(SUM(CASE WHEN first_atakhan THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_atakhan_rate,
          ROUND(SUM(CASE WHEN first_inhibitor THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS first_inhibitor_rate,
          0 AS dragon_soul_rate,
          SUM(CASE WHEN color = 'blue' THEN 1 ELSE 0 END) AS blue_games,
          SUM(CASE WHEN color = 'blue' AND winner_id = $1 THEN 1 ELSE 0 END) AS blue_wins,
          SUM(CASE WHEN color = 'red' THEN 1 ELSE 0 END) AS red_games,
          SUM(CASE WHEN color = 'red' AND winner_id = $1 THEN 1 ELSE 0 END) AS red_wins,
          ROUND(AVG(gold_earned / NULLIF(length / 60.0, 0) - opp_gold / NULLIF(length / 60.0, 0))::numeric, 1) AS delta_gpm,
          (SELECT COUNT(DISTINCT gp2.champion_id)
           FROM game_players gp2 JOIN games g2 ON g2.id = gp2.game_id
           WHERE gp2.team_id = $1 AND g2.serie_id = $2 AND g2.tournament_id = $3 AND g2.finished = true AND g2.length > 60
          ) AS unique_champions,
          NULL AS drake_breakdown_json
        FROM team_games
      `, [teamId, serieId, ...stageParams3]),
      // Per-minute stats from game_players (team-level = sum of 5 players per game, then avg across games)
      pgDb.query(`
        WITH per_game AS (
          SELECT
            gp.game_id, g.length,
            SUM(gp.gold_earned) AS gold, SUM(gp.total_damage_dealt_to_champions) AS dmg,
            SUM(gp.total_damage_taken) AS dtaken,
            SUM(gp.magic_damage_dealt_to_champions) AS magic_dmg,
            SUM(gp.physical_damage_dealt_to_champions) AS phys_dmg,
            SUM(gp.true_damage_dealt_to_champions) AS true_dmg,
            SUM(COALESCE(gp.creep_score, gp.minions_killed)) AS cs,
            SUM(gp.wards_placed) AS wards, SUM(gp.kills_wards) AS ward_kills,
            SUM(COALESCE(gp.vision_wards_bought_in_game, 0)) AS cw,
            SUM(gp.kills) AS kills, SUM(gp.deaths) AS deaths, SUM(gp.assists) AS assists,
            SUM(gp.total_time_crowd_control_dealt) AS cc,
            SUM(gp.total_heal) AS heal
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          WHERE gp.team_id = $1 AND g.serie_id = $2 ${stf} AND g.finished = true AND g.length > 60
          GROUP BY gp.game_id, g.length
        )
        SELECT
          ROUND(AVG(gold / NULLIF(length / 60.0, 0))::numeric, 0) AS gpm,
          ROUND(AVG(dmg / NULLIF(length / 60.0, 0))::numeric, 0) AS dpm,
          ROUND(AVG(cs / NULLIF(length / 60.0, 0))::numeric, 1) AS avg_cspm,
          ROUND(AVG(dtaken / NULLIF(length / 60.0, 0))::numeric, 0) AS avg_dtaken_pm,
          ROUND(AVG(magic_dmg / NULLIF(length / 60.0, 0))::numeric, 0) AS avg_magic_dpm,
          ROUND(AVG(phys_dmg / NULLIF(length / 60.0, 0))::numeric, 0) AS avg_physical_dpm,
          ROUND(AVG(true_dmg / NULLIF(length / 60.0, 0))::numeric, 0) AS avg_true_dpm,
          ROUND(AVG(wards / NULLIF(length / 60.0, 0))::numeric, 2) AS avg_wpm,
          ROUND(AVG(ward_kills / NULLIF(length / 60.0, 0))::numeric, 2) AS avg_wkpm,
          ROUND(AVG(cw / NULLIF(length / 60.0, 0))::numeric, 2) AS avg_cwpm,
          ROUND(AVG(cc / NULLIF(length / 60.0, 0))::numeric, 2) AS avg_cc_per_min,
          ROUND(AVG(heal / NULLIF(length / 60.0, 0))::numeric, 2) AS avg_heal_per_min,
          ROUND(AVG(deaths)::numeric / 5, 1) AS deaths_avg,
          ROUND(AVG(assists)::numeric / 5, 1) AS assists_avg,
          ROUND((SUM(kills) + SUM(assists))::numeric / NULLIF(SUM(deaths), 0), 2) AS kda
        FROM per_game
      `, [teamId, serieId, ...stageParams3]),
    ]);

    if (!liveRows.length) return res.status(404).json({ error: 'No data for this team in selected stage' });

    // Calculate gold/CS diffs @13/20/25 from game_frames + game_frame_players
    const { rows: frameDiffs } = await pgDb.query(`
      WITH team_games AS (
        SELECT g.id AS game_id, gt.color AS side
        FROM game_teams gt
        JOIN games g ON g.id = gt.game_id
        WHERE gt.team_id = $1 AND g.serie_id = $2 AND g.tournament_id = $3
          AND g.finished = true AND g.length > 60
      ),
      target_frames AS (
        SELECT tg.game_id, tg.side, gf.id AS frame_id, t.minute_key,
               gf.blue_gold, gf.red_gold,
               ROW_NUMBER() OVER (PARTITION BY tg.game_id, t.minute_key ORDER BY ABS(gf.timestamp - t.target_sec)) AS rn
        FROM team_games tg
        CROSS JOIN (VALUES (13, 780), (20, 1200), (25, 1500)) AS t(minute_key, target_sec)
        JOIN game_frames gf ON gf.game_id = tg.game_id AND ABS(gf.timestamp - t.target_sec) <= 90
      ),
      frame_cs AS (
        SELECT tf.frame_id, tf.minute_key, tf.side,
               SUM(CASE WHEN fp.team_color = tf.side::team_color THEN fp.cs ELSE 0 END) AS my_cs,
               SUM(CASE WHEN fp.team_color != tf.side::team_color THEN fp.cs ELSE 0 END) AS opp_cs
        FROM target_frames tf
        JOIN game_frame_players fp ON fp.frame_id = tf.frame_id
        WHERE tf.rn = 1
        GROUP BY tf.frame_id, tf.minute_key, tf.side
      )
      SELECT tf.minute_key,
             ROUND(AVG(CASE WHEN tf.side = 'blue' THEN tf.blue_gold - tf.red_gold ELSE tf.red_gold - tf.blue_gold END)::numeric, 0) AS gold_diff,
             ROUND(AVG(fc.my_cs - fc.opp_cs)::numeric, 1) AS cs_diff
      FROM target_frames tf
      LEFT JOIN frame_cs fc ON fc.frame_id = tf.frame_id AND fc.minute_key = tf.minute_key AND fc.side = tf.side
      WHERE tf.rn = 1
      GROUP BY tf.minute_key
    `, [teamId, serieId, ...stageParams3]);

    const gdMap = {}, csMap = {};
    for (const r of frameDiffs) {
      gdMap[r.minute_key] = Number(r.gold_diff);
      csMap[r.minute_key] = r.cs_diff != null ? Number(r.cs_diff) : null;
    }

    tc = {
      ...liveRows[0],
      ...(pmRows[0] || {}),
      delta_cspm: 0,
      avg_gold_diff_13: gdMap[13] ?? null,
      avg_gold_diff_20: gdMap[20] ?? null,
      avg_gold_diff_25: gdMap[25] ?? null,
      avg_cs_diff_13: csMap[13] ?? null,
      avg_cs_diff_20: csMap[20] ?? null,
      avg_cs_diff_25: csMap[25] ?? null,
    };
  } else {
    let { rows: tcRows } = await pgDb.query(`
      SELECT * FROM team_career WHERE team_id = $1 AND serie_id = $2
    `, [teamId, serieId]);
    // Fallback: if team not in this serie, find their most recent serie in the same league first
    if (!tcRows.length) {
      const leagueId = await resolveLeagueId(league);
      const { rows: fallbackRows } = await pgDb.query(`
        SELECT tc.*, s.id AS fallback_serie_id
        FROM team_career tc
        JOIN series s ON s.id = tc.serie_id
        WHERE tc.team_id = $1
          AND ($2::int IS NULL OR s.league_id = $2)
        ORDER BY s.year DESC, s.begin_at DESC
        LIMIT 1
      `, [teamId, leagueId]);
      // If not found in same league, try any league
      if (!fallbackRows.length) {
        const { rows: anyRows } = await pgDb.query(`
          SELECT tc.*, s.id AS fallback_serie_id
          FROM team_career tc
          JOIN series s ON s.id = tc.serie_id
          WHERE tc.team_id = $1
          ORDER BY s.year DESC, s.begin_at DESC
          LIMIT 1
        `, [teamId]);
        if (!anyRows.length) return res.status(404).json({ error: 'No team_career data found' });
        tcRows = anyRows;
        serieId = anyRows[0].fallback_serie_id;
      } else {
        tcRows = fallbackRows;
        serieId = fallbackRows[0].fallback_serie_id;
      }
    }
    tc = tcRows[0];
  }

  // 4. Parallel supplementary queries
  const [playersRes, seriesRes, winDurRes, lossDurRes, dragonRes] = await Promise.all([
    // 4a. Player names for the roster (from game_players when stage, player_career otherwise)
    stageParam
      ? pgDb.query(`
          SELECT DISTINCT p.name
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          JOIN players p ON p.id = gp.player_id
          WHERE gp.team_id = $2 AND g.serie_id = $1 ${sf} AND g.finished = true
          ORDER BY p.name
        `, [serieId, teamId, ...stageParams])
      : pgDb.query(`
          SELECT p.name
          FROM player_career pc
          JOIN players p ON p.id = pc.player_id
          WHERE pc.serie_id = $1 AND pc.team_id = $2
          ORDER BY pc.games DESC
        `, [serieId, teamId]),

    // 4b. Series history — match results via match_opponents
    stageParam
      ? pgDb.query(`
          SELECT
            m.id AS match_id,
            m.number_of_games AS best_of,
            m.begin_at,
            opp_t.acronym AS opponent,
            COALESCE(opp_t.dark_mode_image_url, opp_t.image_url) AS opponent_logo,
            mo_team.result_score AS score_team,
            mo_opp.result_score AS score_opponent,
            (m.winner_id = $2) AS result
          FROM matches m
          JOIN match_opponents mo_team ON mo_team.match_id = m.id AND mo_team.team_id = $2
          JOIN match_opponents mo_opp  ON mo_opp.match_id  = m.id AND mo_opp.team_id != $2
          JOIN teams opp_t ON opp_t.id = mo_opp.team_id
          WHERE m.serie_id = $1 AND m.tournament_id = $3
          ORDER BY m.begin_at DESC
          LIMIT 20
        `, [serieId, teamId, ...stageParams])
      : pgDb.query(`
          SELECT
            m.id AS match_id,
            m.number_of_games AS best_of,
            m.begin_at,
            opp_t.acronym AS opponent,
            COALESCE(opp_t.dark_mode_image_url, opp_t.image_url) AS opponent_logo,
            mo_team.result_score AS score_team,
            mo_opp.result_score AS score_opponent,
            (m.winner_id = $2) AS result
          FROM matches m
          JOIN match_opponents mo_team ON mo_team.match_id = m.id AND mo_team.team_id = $2
          JOIN match_opponents mo_opp  ON mo_opp.match_id  = m.id AND mo_opp.team_id != $2
          JOIN teams opp_t ON opp_t.id = mo_opp.team_id
          WHERE m.serie_id = $1
          ORDER BY m.begin_at DESC
          LIMIT 20
        `, [serieId, teamId]),

    // 4c. Avg win duration
    pgDb.query(`
      SELECT ROUND(AVG(g.length / 60.0)::numeric, 1) AS avg_dur
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.serie_id = $1 ${sf} AND gt.team_id = $2
        AND g.winner_id = $2 AND g.finished = true AND g.length > 60
    `, [serieId, teamId, ...stageParams]),

    // 4d. Avg loss duration
    pgDb.query(`
      SELECT ROUND(AVG(g.length / 60.0)::numeric, 1) AS avg_dur
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.serie_id = $1 ${sf} AND gt.team_id = $2
        AND g.winner_id != $2 AND g.finished = true AND g.length > 60
    `, [serieId, teamId, ...stageParams]),

    // 4e. Dragon breakdown from game_teams individual drake columns
    pgDb.query(`
      SELECT
        ROUND(AVG(COALESCE(gt.infernal_drake_kills, 0))::numeric, 1) AS infernal,
        ROUND(AVG(COALESCE(gt.mountain_drake_kills, 0))::numeric, 1) AS mountain,
        ROUND(AVG(COALESCE(gt.ocean_drake_kills, 0))::numeric, 1) AS ocean,
        ROUND(AVG(COALESCE(gt.cloud_drake_kills, 0))::numeric, 1) AS cloud,
        ROUND(AVG(COALESCE(gt.hextech_drake_kills, 0))::numeric, 1) AS hextech,
        ROUND(AVG(COALESCE(gt.chemtech_drake_kills, 0))::numeric, 1) AS chemtech
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.serie_id = $1 ${sf} AND gt.team_id = $2 AND g.finished = true AND g.length > 60
    `, [serieId, teamId, ...stageParams]),
  ]);

  const playerNames = playersRes.rows.map(r => r.name);

  const seriesHistory = seriesRes.rows.map(r => ({
    match_id: r.match_id,
    opponent: r.opponent,
    opponent_logo: r.opponent_logo,
    best_of: r.best_of || 1,
    score_team: r.score_team || 0,
    score_opponent: r.score_opponent || 0,
    result: r.result,
    date: r.begin_at,
  }));

  const avgWinDur = winDurRes.rows[0]?.avg_dur;
  const avgLossDur = lossDurRes.rows[0]?.avg_dur;

  // Drake breakdown — use team_career JSONB if available, else from dragon_kills_details
  let avgDrakes = null;
  const numGames = Number(tc.games) || 0;
  if (tc.drake_breakdown_json && numGames > 0) {
    const parsed = typeof tc.drake_breakdown_json === 'string'
      ? JSON.parse(tc.drake_breakdown_json) : tc.drake_breakdown_json;
    avgDrakes = {};
    for (const [k, v] of Object.entries(parsed)) {
      avgDrakes[k] = rnd(Number(v) / numGames, 1);
    }
  } else if (dragonRes.rows[0]) {
    const dr = dragonRes.rows[0];
    avgDrakes = {};
    for (const [k, v] of Object.entries(dr)) {
      if (v != null && Number(v) > 0) avgDrakes[k] = Number(v);
    }
    if (Object.keys(avgDrakes).length === 0) avgDrakes = null;
  }

  // Get brand + serie info for current serieId
  const [{ rows: brandRows }, { rows: serieInfoRows }] = await Promise.all([
    pgDb.query(`
      SELECT display_name, display_acronym, display_logo FROM team_brands
      WHERE team_id = $1 AND (SELECT year FROM series WHERE id = $2) BETWEEN year_start AND year_end
    `, [teamId, serieId]),
    // Only fetch if fallback happened (serieId changed)
    serieId !== requestedSerieId
      ? pgDb.query(`SELECT year, season, full_name FROM series WHERE id = $1`, [serieId])
      : Promise.resolve({ rows: [] }),
  ]);

  const brandName = brandRows[0]?.display_name || teamRow.name;
  const brandAcronym = brandRows[0]?.display_acronym || teamRow.acronym;
  const brandLogo = brandRows[0]?.display_logo || teamRow.image_url;

  // Compute derived fields
  const games = Number(tc.games) || 0;
  const wins = Number(tc.wins) || 0;
  const losses = Number(tc.losses) || 0;
  const blueGames = Number(tc.blue_games) || 0;
  const blueWins = Number(tc.blue_wins) || 0;
  const redGames = Number(tc.red_games) || 0;
  const redWins = Number(tc.red_wins) || 0;
  const avgDurMin = tc.avg_duration ? rnd(Number(tc.avg_duration) / 60, 1) : null;

  res.json({
    id: teamId,
    name: brandName,
    team: brandName,
    abbr: brandAcronym,
    real_acronym: teamRow.acronym,   // original acronym from teams table (for cross-referencing)
    logo_url: brandLogo,
    slug: teamRow.slug,

    games,
    wins,
    losses,
    win_rate: rnd(Number(tc.win_rate), 1),

    avg_duration: avgDurMin,
    avg_duration_formatted: fmtMins(avgDurMin),
    avg_win_duration: avgWinDur != null ? fmtMins(Number(avgWinDur)) : null,
    avg_loss_duration: avgLossDur != null ? fmtMins(Number(avgLossDur)) : null,
    unique_champions: Number(tc.unique_champions) || 0,

    // Side WR
    blue_games: blueGames,
    blue_wins: blueWins,
    blue_wr: blueGames > 0 ? rnd(blueWins / blueGames * 100, 1) : 0,
    red_games: redGames,
    red_wins: redWins,
    red_wr: redGames > 0 ? rnd(redWins / redGames * 100, 1) : 0,

    // KDA
    avg_kills: rnd(Number(tc.kills_avg), 1),
    avg_deaths: rnd(Number(tc.deaths_avg), 1),
    avg_assists: rnd(Number(tc.assists_avg), 1),
    kda: rnd(Number(tc.kda), 2),

    // First objective rates
    first_blood_rate: rnd(Number(tc.first_blood_rate), 1),
    first_tower_rate: rnd(Number(tc.first_tower_rate), 1),
    first_dragon_rate: rnd(Number(tc.first_dragon_rate), 1),
    first_baron_rate: rnd(Number(tc.first_baron_rate), 1),
    first_herald_rate: rnd(Number(tc.first_herald_rate), 1),
    first_voidgrub_rate: rnd(Number(tc.first_voidgrub_rate), 1),
    first_atakhan_rate: rnd(Number(tc.first_atakhan_rate), 1),
    first_inhibitor_rate: rnd(Number(tc.first_inhibitor_rate), 1),
    dragon_soul_rate: rnd(Number(tc.dragon_soul_rate), 1),

    // Avg per game objectives
    avg_towers: rnd(Number(tc.avg_towers), 1),
    avg_towers_lost: rnd(Number(tc.avg_towers_lost), 1),
    avg_plates: rnd(Number(tc.avg_plates), 1),
    avg_dragons: rnd(Number(tc.avg_dragons), 1),
    avg_elder_dragons: rnd(Number(tc.avg_elder_dragons), 1),
    avg_barons: rnd(Number(tc.avg_barons), 1),
    avg_heralds: rnd(Number(tc.avg_heralds), 1),
    avg_voidgrubs: rnd(Number(tc.avg_voidgrubs), 1),
    avg_atakhans: rnd(Number(tc.avg_atakhans), 1),
    avg_inhibitors: rnd(Number(tc.avg_inhibitors), 1),
    avg_drakes: avgDrakes,

    // Per minute rates
    avg_dpm: rnd(Number(tc.dpm), 0),
    avg_gpm: rnd(Number(tc.gpm), 0),
    avg_cspm: rnd(Number(tc.avg_cspm), 2),
    avg_wpm: rnd(Number(tc.avg_wpm), 2),
    avg_wkpm: rnd(Number(tc.avg_wkpm), 2),
    avg_cwpm: rnd(Number(tc.avg_cwpm), 2),
    avg_dtaken_per_min: rnd(Number(tc.avg_dtaken_pm), 0),
    avg_magic_dpm: rnd(Number(tc.avg_magic_dpm), 0),
    avg_physical_dpm: rnd(Number(tc.avg_physical_dpm), 0),
    avg_true_dpm: rnd(Number(tc.avg_true_dpm), 0),
    avg_cc_per_min: rnd(Number(tc.avg_cc_per_min), 2),
    avg_heal_per_min: rnd(Number(tc.avg_heal_per_min), 2),

    // Differentials
    delta_gpm: rnd(Number(tc.delta_gpm), 1),
    delta_cspm: rnd(Number(tc.delta_cspm), 1),

    // Timeline diffs
    avg_gold_diff_13: rnd(Number(tc.avg_gold_diff_13)),
    avg_gold_diff_20: rnd(Number(tc.avg_gold_diff_20)),
    avg_gold_diff_25: rnd(Number(tc.avg_gold_diff_25)),
    avg_cs_diff_13: rnd(Number(tc.avg_cs_diff_13), 1),
    avg_cs_diff_20: rnd(Number(tc.avg_cs_diff_20), 1),
    avg_cs_diff_25: rnd(Number(tc.avg_cs_diff_25), 1),

    // Series history & roster
    series_history: seriesHistory,
    players: playerNames,

    // Fallback info: if the team didn't play in the requested serie,
    // we return data from their most recent serie instead. Frontend uses this
    // to re-sync other API calls (players, champions) with the correct serie.
    used_serie_id: serieId,
    fallback: serieId !== requestedSerieId ? {
      year: serieInfoRows[0]?.year,
      split: serieInfoRows[0]?.season,
      serie_name: serieInfoRows[0]?.full_name,
    } : null,
  });
}
