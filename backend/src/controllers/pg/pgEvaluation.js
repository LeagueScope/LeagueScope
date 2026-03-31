/**
 * pgEvaluation.js
 * Player evaluation algorithm based on champion archetypes.
 *
 * Two-layer system:
 *   1. Playstyle Profile  — archetype distribution weighted by games played
 *   2. Performance Rating — archetype-aware metrics compared to role averages
 *
 * Nine evaluation dimensions:
 *   - Archetype-weighted impact (DPM, dmg_share)
 *   - Archetype-weighted tankiness (damage taken)
 *   - KDA & combat
 *   - Assists & kill participation (especially for supports)
 *   - Economy & resource efficiency (dmg_share / gold_share)
 *   - Vision & utility (wards, CC)
 *   - Early / Mid / Late game (frame diffs at min 13, 20, 25)
 *   - Consistency (variance across games)
 *   - Close-game performance (games with <3k gold diff)
 *   + Bonus: Adaptability (archetype diversity) & Ban pressure
 */

import { pgDb } from './pgHelpers.js';
import { log } from '../../utils/logger.js';

// ── Archetype weight matrices ────────────────────────────────────────────────
// Each archetype defines how much each metric category matters (sum ≈ 1.0).
// Keys: dmg, tanked, kda, assists, economy, vision, cc, early

const ARCHETYPE_WEIGHTS = {
  Tanque: {
    dmg: 0.03, tanked: 0.25, kda: 0.12, assists: 0.15,
    economy: 0.03, vision: 0.10, cc: 0.20, early: 0.12,
  },
  Luchador: {
    dmg: 0.20, tanked: 0.15, kda: 0.18, assists: 0.08,
    economy: 0.12, vision: 0.03, cc: 0.07, early: 0.17,
  },
  Mago: {
    dmg: 0.25, tanked: 0.03, kda: 0.18, assists: 0.10,
    economy: 0.15, vision: 0.04, cc: 0.10, early: 0.15,
  },
  Asesino: {
    dmg: 0.22, tanked: 0.02, kda: 0.22, assists: 0.05,
    economy: 0.10, vision: 0.03, cc: 0.03, early: 0.33,
  },
  Tirador: {
    dmg: 0.28, tanked: 0.02, kda: 0.18, assists: 0.05,
    economy: 0.20, vision: 0.03, cc: 0.02, early: 0.22,
  },
  Asistencia: {
    dmg: 0.03, tanked: 0.05, kda: 0.10, assists: 0.28,
    economy: 0.02, vision: 0.25, cc: 0.15, early: 0.12,
  },
  Resistencia: {
    dmg: 0.05, tanked: 0.22, kda: 0.12, assists: 0.18,
    economy: 0.03, vision: 0.12, cc: 0.18, early: 0.10,
  },
};

// Fallback if archetype not found
const DEFAULT_WEIGHTS = {
  dmg: 0.15, tanked: 0.10, kda: 0.18, assists: 0.12,
  economy: 0.10, vision: 0.10, cc: 0.10, early: 0.15,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const rnd = (v, d = 1) => (v == null ? null : +Number(v).toFixed(d));

/** Compute percentile rank of `val` within sorted array `arr`. Returns 0-100. */
function percentile(val, arr) {
  if (!arr.length || val == null) return 50; // default to median if no data
  const below = arr.filter((v) => v < val).length;
  return rnd((below / arr.length) * 100, 1);
}

/** Standard deviation of an array. */
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/** Blend weights for a champion with primary + optional secondary archetype. */
function blendWeights(primary, secondary) {
  const pW = ARCHETYPE_WEIGHTS[primary] || DEFAULT_WEIGHTS;
  if (!secondary) return { ...pW };
  const sW = ARCHETYPE_WEIGHTS[secondary] || DEFAULT_WEIGHTS;
  // 70/30 split: primary archetype dominates
  const blended = {};
  for (const k of Object.keys(pW)) {
    blended[k] = rnd(pW[k] * 0.7 + sW[k] * 0.3, 3);
  }
  return blended;
}

/** Convert overall score (0-100) to tier letter. */
function scoreToTier(score) {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
}

// ── Data fetchers ────────────────────────────────────────────────────────────

/** Fetch archetype mapping for all champions. Returns Map<champName, {primary, secondary}>. */
async function getArchetypeMap() {
  const { rows } = await pgDb.query(`SELECT champion_name, primary_archetype, secondary_archetype FROM champion_archetypes`);
  const map = new Map();
  for (const r of rows) map.set(r.champion_name.toLowerCase(), { primary: r.primary_archetype, secondary: r.secondary_archetype });
  return map;
}

/** Fetch all per-game rows for a player in a serie. */
async function getPlayerGames(playerId, serieId) {
  const { rows } = await pgDb.query(`
    SELECT gp.game_id, gp.player_id, gp.team_id, gp.role,
           c.name AS champion_name, gp.champion_id,
           gp.kills, gp.deaths, gp.assists,
           gp.kill_participation,
           gp.total_damage_dealt_to_champions AS dmg_to_champs,
           gp.total_damage_taken AS dmg_taken,
           gp.total_damage_dealt_to_champions_percentage AS dmg_share,
           gp.gold_earned, gp.gold_percentage AS gold_share,
           gp.creep_score, gp.minions_killed,
           gp.wards_placed, gp.kills_wards AS wards_killed,
           gp.vision_wards_bought_in_game AS control_wards,
           gp.total_time_crowd_control_dealt AS cc_time,
           gp.total_heal,
           gp.first_blood_kill, gp.first_blood_assist,
           gp.cs_at_14, gp.cs_diff_at_14,
           g.length AS game_length,
           g.finished
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
    JOIN champions c ON c.id = ca.canonical_id
    WHERE gp.player_id = $1
      AND g.serie_id = $2
      AND g.finished = true
      AND g.length > 600
    ORDER BY g.begin_at
  `, [playerId, serieId]);
  return rows;
}

/** Fetch role averages for the same serie (all players at the same role). */
async function getRoleAverages(role, serieId) {
  const { rows } = await pgDb.query(`
    SELECT
      AVG(gp.kills)                                       AS avg_kills,
      AVG(gp.deaths)                                      AS avg_deaths,
      AVG(gp.assists)                                     AS avg_assists,
      AVG(gp.kill_participation)                           AS avg_kp,
      AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0)) AS avg_dpm,
      AVG(gp.total_damage_taken / NULLIF(g.length / 60.0, 0))              AS avg_dtpm,
      AVG(gp.total_damage_dealt_to_champions_percentage)   AS avg_dmg_share,
      AVG(gp.gold_percentage)                              AS avg_gold_share,
      AVG(gp.creep_score / NULLIF(g.length / 60.0, 0))    AS avg_cspm,
      AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))    AS avg_gpm,
      AVG(gp.wards_placed / NULLIF(g.length / 60.0, 0))   AS avg_wpm,
      AVG(gp.kills_wards / NULLIF(g.length / 60.0, 0))    AS avg_wkpm,
      AVG(gp.total_time_crowd_control_dealt / NULLIF(g.length, 0)) AS avg_cc_per_sec,
      AVG(gp.cs_diff_at_14)                                AS avg_cs_diff_14
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.role = $1
      AND g.serie_id = $2
      AND g.finished = true
      AND g.length > 600
  `, [role, serieId]);
  return rows[0] || {};
}

/** Fetch distribution arrays for percentile comparisons (all players same role in serie). */
async function getRoleDistributions(role, serieId) {
  const { rows } = await pgDb.query(`
    SELECT
      gp.player_id,
      AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0)) AS dpm,
      AVG(gp.total_damage_taken / NULLIF(g.length / 60.0, 0))              AS dtpm,
      CASE WHEN AVG(gp.deaths) > 0
           THEN (AVG(gp.kills) + AVG(gp.assists)) / AVG(gp.deaths)
           ELSE AVG(gp.kills) + AVG(gp.assists) END                        AS kda,
      AVG(gp.kill_participation)                                            AS kp,
      AVG(gp.assists)                                                       AS assists,
      AVG(gp.creep_score / NULLIF(g.length / 60.0, 0))                     AS cspm,
      AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))                     AS gpm,
      AVG(gp.wards_placed / NULLIF(g.length / 60.0, 0))                    AS wpm,
      AVG(gp.total_time_crowd_control_dealt / NULLIF(g.length, 0))          AS cc,
      AVG(gp.cs_diff_at_14)                                                 AS cs_diff_14,
      CASE WHEN AVG(gp.gold_percentage) > 0
           THEN AVG(gp.total_damage_dealt_to_champions_percentage) / AVG(gp.gold_percentage)
           ELSE 1 END                                                       AS efficiency
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.role = $1
      AND g.serie_id = $2
      AND g.finished = true
      AND g.length > 600
    GROUP BY gp.player_id
  `, [role, serieId]);
  return rows;
}

/** Fetch timeline frames for player's games (minutes 13, 20, 25). */
async function getTimelineData(playerId, gameIds) {
  if (!gameIds.length) return [];
  const { rows } = await pgDb.query(`
    SELECT gf.game_id, gf.timestamp,
           gfp.kills, gfp.deaths, gfp.assists, gfp.cs, gfp.level,
           gfp.role, gfp.team_color
    FROM game_frame_players gfp
    JOIN game_frames gf ON gf.id = gfp.frame_id
    WHERE gfp.player_id = $1
      AND gf.game_id = ANY($2::int[])
      AND gf.timestamp IN (
        SELECT DISTINCT ON (game_id, target) gf2.timestamp
        FROM game_frames gf2,
             LATERAL (VALUES (780), (1200), (1500)) AS t(target)
        WHERE gf2.game_id = ANY($2::int[])
        ORDER BY game_id, target, ABS(gf2.timestamp - t.target)
      )
    ORDER BY gf.game_id, gf.timestamp
  `, [playerId, gameIds]);
  return rows;
}

/** Fetch opponent frame data at same timestamps for diff calculation. */
async function getOpponentFrames(playerId, gameIds) {
  if (!gameIds.length) return [];
  // Get the opponent at same role in same game
  const { rows } = await pgDb.query(`
    WITH player_games AS (
      SELECT gp.game_id, gp.role, gp.team_id
      FROM game_players gp
      WHERE gp.player_id = $1 AND gp.game_id = ANY($2::int[])
    ),
    opponents AS (
      SELECT gp2.player_id AS opp_id, gp2.game_id, gp2.role
      FROM game_players gp2
      JOIN player_games pg ON pg.game_id = gp2.game_id
                           AND pg.role = gp2.role
                           AND pg.team_id != gp2.team_id
    )
    SELECT gf.game_id, gf.timestamp,
           gfp.kills AS opp_kills, gfp.deaths AS opp_deaths,
           gfp.cs AS opp_cs, gfp.level AS opp_level
    FROM game_frame_players gfp
    JOIN game_frames gf ON gf.id = gfp.frame_id
    JOIN opponents o ON o.opp_id = gfp.player_id AND o.game_id = gf.game_id
    WHERE gf.game_id = ANY($2::int[])
      AND gf.timestamp IN (
        SELECT DISTINCT ON (game_id, target) gf2.timestamp
        FROM game_frames gf2,
             LATERAL (VALUES (780), (1200), (1500)) AS t(target)
        WHERE gf2.game_id = ANY($2::int[])
        ORDER BY game_id, target, ABS(gf2.timestamp - t.target)
      )
    ORDER BY gf.game_id, gf.timestamp
  `, [playerId, gameIds]);
  return rows;
}

/** Detect close games: gold diff < 3000 at end. */
async function getCloseGameIds(gameIds) {
  if (!gameIds.length) return new Set();
  const { rows } = await pgDb.query(`
    SELECT game_id
    FROM (
      SELECT gt.game_id,
             ABS(MAX(gt.gold_earned) - MIN(gt.gold_earned)) AS gold_diff
      FROM game_teams gt
      WHERE gt.game_id = ANY($1::int[])
      GROUP BY gt.game_id
    ) sub
    WHERE gold_diff < 3000
  `, [gameIds]);
  return new Set(rows.map((r) => r.game_id));
}

/** For supports: count assists in kills where killer is top/mid/jun. */
async function getSupportRoaming(playerId, gameIds) {
  if (!gameIds.length) return { roamAssists: 0, totalAssists: 0 };
  const { rows } = await pgDb.query(`
    WITH player_team AS (
      SELECT gp.game_id, gp.team_id
      FROM game_players gp
      WHERE gp.player_id = $1 AND gp.game_id = ANY($2::int[])
    ),
    team_kills AS (
      SELECT ge.game_id, ge.killer_player_id, ge.assistants
      FROM game_events ge
      JOIN player_team pt ON pt.game_id = ge.game_id
      WHERE ge.type = 'player_kill'
        AND ge.game_id = ANY($2::int[])
    ),
    kills_with_assist AS (
      SELECT tk.game_id, tk.killer_player_id,
             jsonb_array_elements(tk.assistants) ->> 'player_id' AS assist_pid
      FROM team_kills tk
      WHERE tk.assistants IS NOT NULL AND tk.assistants != '[]'::jsonb
    )
    SELECT
      COUNT(*) FILTER (
        WHERE kwa.assist_pid::int = $1
          AND killer_role.role IN ('top', 'mid', 'jun')
      ) AS roam_assists,
      COUNT(*) FILTER (WHERE kwa.assist_pid::int = $1) AS total_assists
    FROM kills_with_assist kwa
    LEFT JOIN game_players killer_role
      ON killer_role.player_id = kwa.killer_player_id
     AND killer_role.game_id = kwa.game_id
  `, [playerId, gameIds]);
  return rows[0] || { roam_assists: 0, total_assists: 0 };
}

/** Objective participation: was player involved in dragon/baron/herald kills? */
async function getObjectiveParticipation(playerId, gameIds) {
  if (!gameIds.length) return { participated: 0, total: 0 };
  const { rows } = await pgDb.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (
        WHERE ge.killer_player_id = $1
           OR ge.assistants @> jsonb_build_array(jsonb_build_object('player_id', $1))
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(ge.assistants) a
             WHERE (a ->> 'player_id')::int = $1
           )
      ) AS participated
    FROM game_events ge
    JOIN game_players gp ON gp.game_id = ge.game_id AND gp.player_id = $1
    WHERE ge.game_id = ANY($2::int[])
      AND ge.type IN ('drake_kill', 'baron_nashor_kill', 'herald_kill')
  `, [playerId, gameIds]);
  return rows[0] || { participated: 0, total: 0 };
}

/** Ban pressure: how many bans target champions in this player's pool? */
async function getBanPressure(playerId, serieId) {
  const { rows } = await pgDb.query(`
    WITH player_pool AS (
      SELECT DISTINCT gp.champion_id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = $1 AND g.serie_id = $2 AND g.finished = true
    ),
    player_games AS (
      SELECT DISTINCT gp.game_id, gp.team_id
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = $1 AND g.serie_id = $2 AND g.finished = true
    ),
    opponent_bans AS (
      SELECT pb.game_id, pb.champion_id
      FROM game_picks_bans pb
      JOIN player_games pg ON pg.game_id = pb.game_id AND pg.team_id != pb.team_id
      WHERE pb.type = 'ban'
    )
    SELECT
      COUNT(DISTINCT ob.game_id || '-' || ob.champion_id) AS pool_bans,
      (SELECT COUNT(*) FROM player_games) AS total_games,
      (SELECT COUNT(DISTINCT champion_id) FROM player_pool) AS pool_size
    FROM opponent_bans ob
    WHERE ob.champion_id IN (SELECT champion_id FROM player_pool)
  `, [playerId, serieId]);
  return rows[0] || { pool_bans: 0, total_games: 0, pool_size: 0 };
}

// ── Core evaluation logic ────────────────────────────────────────────────────

/**
 * Layer 1: Playstyle Profile
 * Weighted by games played on each champion.
 */
function computePlaystyleProfile(games, archetypeMap) {
  const profile = {
    Tanque: 0, Luchador: 0, Mago: 0, Asesino: 0,
    Tirador: 0, Asistencia: 0, Resistencia: 0,
  };
  let totalWeight = 0;

  // Group games by champion
  const champGames = {};
  for (const g of games) {
    const key = g.champion_name?.toLowerCase();
    if (!champGames[key]) champGames[key] = { name: g.champion_name, count: 0, wins: 0 };
    champGames[key].count++;
  }

  for (const [key, info] of Object.entries(champGames)) {
    const arch = archetypeMap.get(key);
    if (!arch) continue;
    const w = info.count;
    totalWeight += w;
    if (arch.primary) {
      if (arch.secondary) {
        // Primary 70%, secondary 30%
        profile[arch.primary] = (profile[arch.primary] || 0) + w * 0.7;
        profile[arch.secondary] = (profile[arch.secondary] || 0) + w * 0.3;
      } else {
        profile[arch.primary] = (profile[arch.primary] || 0) + w;
      }
    }
  }

  // Convert to percentages
  const result = {};
  if (totalWeight > 0) {
    for (const [k, v] of Object.entries(profile)) {
      const pct = rnd((v / totalWeight) * 100, 1);
      if (pct > 0) result[k] = pct;
    }
  }
  return result;
}

/**
 * Layer 2: Performance Rating
 * Computes per-game metrics, compares to role percentiles, applies archetype weights.
 */
function computePerformanceRating(games, roleDistributions, archetypeMap) {
  if (!games.length) return null;

  // Build sorted arrays from role distributions for percentile calc
  const distArrays = {
    dpm: [], dtpm: [], kda: [], kp: [], assists: [],
    cspm: [], gpm: [], wpm: [], cc: [], cs_diff_14: [], efficiency: [],
  };
  for (const p of roleDistributions) {
    for (const k of Object.keys(distArrays)) {
      if (p[k] != null) distArrays[k].push(+p[k]);
    }
  }
  for (const arr of Object.values(distArrays)) arr.sort((a, b) => a - b);

  // Compute player averages
  const mins = games.map((g) => (g.game_length || 1800) / 60);
  const playerAvg = {
    dpm: avg(games.map((g, i) => (g.dmg_to_champs || 0) / mins[i])),
    dtpm: avg(games.map((g, i) => (g.dmg_taken || 0) / mins[i])),
    kda: computeKDA(games),
    kp: avg(games.map((g) => g.kill_participation || 0)),
    assists: avg(games.map((g) => g.assists || 0)),
    cspm: avg(games.map((g, i) => (g.creep_score || g.minions_killed || 0) / mins[i])),
    gpm: avg(games.map((g, i) => (g.gold_earned || 0) / mins[i])),
    wpm: avg(games.map((g, i) => (g.wards_placed || 0) / mins[i])),
    cc: avg(games.map((g) => (g.cc_time || 0) / (g.game_length || 1800))),
    cs_diff_14: avg(games.map((g) => g.cs_diff_at_14 || 0)),
    efficiency: computeEfficiency(games),
  };

  // Percentile for each metric
  const pctiles = {};
  for (const k of Object.keys(distArrays)) {
    pctiles[k] = percentile(playerAvg[k], distArrays[k]);
  }

  // Map metric keys to weight categories
  const metricToWeight = {
    dpm: 'dmg', dtpm: 'tanked', kda: 'kda', kp: 'assists',
    assists: 'assists', cspm: 'economy', gpm: 'economy',
    wpm: 'vision', cc: 'cc', cs_diff_14: 'early', efficiency: 'economy',
  };

  // Compute weighted score using the dominant archetype blend
  const dominantArch = getDominantArchetype(games, archetypeMap);
  const weights = blendWeights(dominantArch.primary, dominantArch.secondary);

  // Group percentiles by weight category and average them
  const catScores = {};
  const catCounts = {};
  for (const [metric, cat] of Object.entries(metricToWeight)) {
    catScores[cat] = (catScores[cat] || 0) + (pctiles[metric] || 50);
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }
  for (const cat of Object.keys(catScores)) {
    catScores[cat] = rnd(catScores[cat] / catCounts[cat], 1);
  }

  // Final weighted score
  let overall = 0;
  for (const [cat, w] of Object.entries(weights)) {
    overall += (catScores[cat] || 50) * w;
  }

  return {
    overall: rnd(overall, 1),
    tier: scoreToTier(overall),
    dominant_archetype: dominantArch,
    weights_used: weights,
    category_scores: catScores,
    percentiles: pctiles,
    averages: Object.fromEntries(Object.entries(playerAvg).map(([k, v]) => [k, rnd(v, 1)])),
  };
}

/** Consistency: inverse of normalized std dev across games. 100 = perfectly consistent. */
function computeConsistency(games) {
  if (games.length < 3) return { score: null, detail: 'Need 3+ games' };

  const mins = games.map((g) => (g.game_length || 1800) / 60);
  const dpmArr = games.map((g, i) => (g.dmg_to_champs || 0) / mins[i]);
  const kdaArr = games.map((g) => {
    const d = g.deaths || 1;
    return ((g.kills || 0) + (g.assists || 0)) / d;
  });
  const cspmArr = games.map((g, i) => (g.creep_score || g.minions_killed || 0) / mins[i]);

  // Coefficient of variation (lower = more consistent)
  const cv = (arr) => {
    const m = avg(arr);
    return m > 0 ? stdDev(arr) / m : 0;
  };

  const cvDpm = cv(dpmArr);
  const cvKda = cv(kdaArr);
  const cvCspm = cv(cspmArr);

  // Convert CV to 0-100 score (CV of 0 = 100, CV of 1+ = ~0)
  const cvToScore = (v) => Math.max(0, Math.min(100, rnd((1 - v) * 100, 1)));

  const scores = {
    dpm: cvToScore(cvDpm),
    kda: cvToScore(cvKda),
    cspm: cvToScore(cvCspm),
  };

  return {
    score: rnd((scores.dpm * 0.4 + scores.kda * 0.35 + scores.cspm * 0.25), 1),
    detail: scores,
  };
}

/** Timeline analysis: performance at minutes 13, 20, 25 vs opponent. */
function computeTimeline(playerFrames, oppFrames) {
  // Group by game_id → timestamp
  const playerByGame = groupByGame(playerFrames);
  const oppByGame = groupByGame(oppFrames);

  const phases = { early: 780, mid: 1200, late: 1500 };
  const result = {};

  for (const [phase, targetTs] of Object.entries(phases)) {
    const csDiffs = [];
    const lvlDiffs = [];
    const killDiffs = [];

    for (const [gameId, frames] of Object.entries(playerByGame)) {
      // Find closest frame to target timestamp
      const pFrame = findClosest(frames, targetTs);
      const oFrames = oppByGame[gameId];
      const oFrame = oFrames ? findClosest(oFrames, targetTs) : null;

      if (pFrame && oFrame) {
        csDiffs.push((pFrame.cs || 0) - (oFrame.opp_cs || oFrame.cs || 0));
        lvlDiffs.push((pFrame.level || 0) - (oFrame.opp_level || oFrame.level || 0));
        killDiffs.push(
          ((pFrame.kills || 0) - (pFrame.deaths || 0)) -
          ((oFrame.opp_kills || oFrame.kills || 0) - (oFrame.opp_deaths || oFrame.deaths || 0))
        );
      }
    }

    result[phase] = {
      avg_cs_diff: rnd(avg(csDiffs), 1),
      avg_level_diff: rnd(avg(lvlDiffs), 2),
      avg_kill_diff: rnd(avg(killDiffs), 2),
      games: csDiffs.length,
    };
  }

  return result;
}

/** Close-game performance: compare metrics in close games vs all games. */
function computeCloseGamePerformance(games, closeGameIds) {
  const closeGames = games.filter((g) => closeGameIds.has(g.game_id));
  const normalGames = games.filter((g) => !closeGameIds.has(g.game_id));

  if (closeGames.length < 2) return { score: null, detail: 'Not enough close games' };

  const metricsFor = (subset) => {
    const mins = subset.map((g) => (g.game_length || 1800) / 60);
    return {
      kda: computeKDA(subset),
      dpm: avg(subset.map((g, i) => (g.dmg_to_champs || 0) / mins[i])),
      kp: avg(subset.map((g) => g.kill_participation || 0)),
    };
  };

  const closeM = metricsFor(closeGames);
  const allM = metricsFor(games);

  // Score: if close-game performance >= overall → clutch. >100 capped.
  const ratios = [];
  if (allM.kda > 0) ratios.push(closeM.kda / allM.kda);
  if (allM.dpm > 0) ratios.push(closeM.dpm / allM.dpm);
  if (allM.kp > 0) ratios.push(closeM.kp / allM.kp);

  const clutchRatio = avg(ratios);
  // ratio of 1.0 = same as average = 70 points. >1.0 scales up, <1.0 scales down.
  const score = Math.max(0, Math.min(100, rnd(clutchRatio * 70, 1)));

  return {
    score,
    close_games: closeGames.length,
    all_games: games.length,
    close_metrics: Object.fromEntries(Object.entries(closeM).map(([k, v]) => [k, rnd(v, 1)])),
  };
}

/** Adaptability: how many different archetypes does the player play well? */
function computeAdaptability(games, archetypeMap) {
  const champStats = {};
  for (const g of games) {
    const key = g.champion_name?.toLowerCase();
    if (!champStats[key]) champStats[key] = { name: g.champion_name, games: 0, wins: 0 };
    champStats[key].games++;
  }

  const archetypesPlayed = new Set();
  let uniqueChamps = 0;
  for (const [key, info] of Object.entries(champStats)) {
    uniqueChamps++;
    const arch = archetypeMap.get(key);
    if (arch?.primary) archetypesPlayed.add(arch.primary);
    if (arch?.secondary) archetypesPlayed.add(arch.secondary);
  }

  // Score: base on unique champs (0-15 → 0-60) + archetype diversity (0-7 → 0-40)
  const champScore = Math.min(60, uniqueChamps * 4);
  const archScore = Math.min(40, archetypesPlayed.size * (40 / 5));

  return {
    score: rnd(champScore + archScore, 1),
    unique_champions: uniqueChamps,
    archetypes_played: [...archetypesPlayed],
  };
}

// ── Small utility helpers ────────────────────────────────────────────────────

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + (b || 0), 0) / arr.length;
}

function computeKDA(games) {
  const totK = games.reduce((s, g) => s + (g.kills || 0), 0);
  const totD = games.reduce((s, g) => s + (g.deaths || 0), 0);
  const totA = games.reduce((s, g) => s + (g.assists || 0), 0);
  return totD > 0 ? (totK + totA) / totD : totK + totA;
}

function computeEfficiency(games) {
  const avgDmgShare = avg(games.map((g) => g.dmg_share || 0));
  const avgGoldShare = avg(games.map((g) => g.gold_share || 0));
  return avgGoldShare > 0 ? avgDmgShare / avgGoldShare : 1;
}

function getDominantArchetype(games, archetypeMap) {
  const counts = {};
  for (const g of games) {
    const arch = archetypeMap.get(g.champion_name?.toLowerCase());
    if (!arch) continue;
    const key = arch.secondary ? `${arch.primary}/${arch.secondary}` : arch.primary;
    counts[key] = (counts[key] || 0) + 1;
  }
  let best = null;
  let max = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > max) { max = v; best = k; }
  }
  if (!best) return { primary: null, secondary: null };
  const parts = best.split('/');
  return { primary: parts[0], secondary: parts[1] || null };
}

function groupByGame(frames) {
  const grouped = {};
  for (const f of frames) {
    const gid = f.game_id;
    if (!grouped[gid]) grouped[gid] = [];
    grouped[gid].push(f);
  }
  return grouped;
}

function findClosest(frames, targetTs) {
  let best = null;
  let bestDiff = Infinity;
  for (const f of frames) {
    const diff = Math.abs((f.timestamp || 0) - targetTs);
    if (diff < bestDiff) { bestDiff = diff; best = f; }
  }
  return best;
}

// ── Main endpoint handler ────────────────────────────────────────────────────

export async function getPlayerEvaluation(req, res) {
  try {
    const playerId = parseInt(req.params.id, 10);
    const serieId = parseInt(req.query.serie, 10);

    if (!playerId || !serieId) {
      return res.status(400).json({ error: 'player id and serie query param required' });
    }

    // Fetch all data in parallel
    const [archetypeMap, games] = await Promise.all([
      getArchetypeMap(),
      getPlayerGames(playerId, serieId),
    ]);

    if (!games.length) {
      return res.status(404).json({ error: 'No games found for this player in this serie' });
    }

    const role = games[0].role;
    const gameIds = games.map((g) => g.game_id);

    // Parallel data fetches
    const [
      roleDistributions,
      playerFrames,
      oppFrames,
      closeGameIds,
      supportRoaming,
      objectiveData,
      banData,
    ] = await Promise.all([
      getRoleDistributions(role, serieId),
      getTimelineData(playerId, gameIds),
      getOpponentFrames(playerId, gameIds),
      getCloseGameIds(gameIds),
      role === 'sup' ? getSupportRoaming(playerId, gameIds) : Promise.resolve(null),
      getObjectiveParticipation(playerId, gameIds),
      getBanPressure(playerId, serieId),
    ]);

    // Compute all dimensions
    const playstyle = computePlaystyleProfile(games, archetypeMap);
    const performance = computePerformanceRating(games, roleDistributions, archetypeMap);
    const consistency = computeConsistency(games);
    const timeline = computeTimeline(playerFrames, oppFrames);
    const clutch = computeCloseGamePerformance(games, closeGameIds);
    const adaptability = computeAdaptability(games, archetypeMap);

    // Objective participation rate
    const objRate = objectiveData.total > 0
      ? rnd((objectiveData.participated / objectiveData.total) * 100, 1)
      : null;

    // Ban pressure rate (pool bans per game)
    const banRate = banData.total_games > 0
      ? rnd(banData.pool_bans / banData.total_games, 2)
      : null;

    // Support roaming ratio
    const roamRate = supportRoaming && supportRoaming.total_assists > 0
      ? rnd((supportRoaming.roam_assists / supportRoaming.total_assists) * 100, 1)
      : null;

    // ── Composite final score ──────────────────────────────────────────────
    // Weighted combination of all dimensions
    const compositeWeights = {
      performance: 0.40,
      consistency: 0.15,
      clutch: 0.10,
      adaptability: 0.10,
      timeline_early: 0.10,
      objectives: 0.08,
      ban_pressure: 0.07,
    };

    // Normalize timeline early to 0-100 (cs_diff of +15 ≈ 100, -15 ≈ 0)
    const earlyScore = timeline.early
      ? Math.max(0, Math.min(100, rnd(50 + (timeline.early.avg_cs_diff || 0) * (50 / 15), 1)))
      : 50;

    // Normalize objective participation to 0-100
    const objScore = objRate != null ? objRate : 50;

    // Normalize ban pressure: 2+ bans/game on your pool = 100
    const banScore = banRate != null ? Math.min(100, rnd(banRate * 50, 1)) : 50;

    const compositeInputs = {
      performance: performance?.overall || 50,
      consistency: consistency.score != null ? consistency.score : 50,
      clutch: clutch.score != null ? clutch.score : 50,
      adaptability: adaptability.score,
      timeline_early: earlyScore,
      objectives: objScore,
      ban_pressure: banScore,
    };

    let compositeScore = 0;
    for (const [k, w] of Object.entries(compositeWeights)) {
      compositeScore += (compositeInputs[k] || 50) * w;
    }
    compositeScore = rnd(compositeScore, 1);

    // Build champion pool detail
    const champPool = {};
    for (const g of games) {
      const key = g.champion_name?.toLowerCase();
      if (!champPool[key]) {
        const arch = archetypeMap.get(key);
        champPool[key] = {
          name: g.champion_name,
          games: 0, wins: 0,
          archetypes: [arch?.primary, arch?.secondary].filter(Boolean),
        };
      }
      champPool[key].games++;
      if (g.kills !== undefined) { /* win tracking would need game_teams, approximate via KDA */ }
    }

    res.json({
      player_id: playerId,
      serie_id: serieId,
      role,
      games_played: games.length,

      // Final composite
      composite: {
        score: compositeScore,
        tier: scoreToTier(compositeScore),
        breakdown: compositeInputs,
        weights: compositeWeights,
      },

      // Layer 1: Playstyle
      playstyle_profile: playstyle,

      // Layer 2: Performance
      performance,

      // Extra dimensions
      consistency,
      timeline,
      close_game_performance: clutch,
      adaptability,
      objective_participation: { rate: objRate, ...objectiveData },
      ban_pressure: { bans_per_game: banRate, ...banData },

      // Support-specific
      ...(roamRate != null && {
        support_roaming: {
          roam_rate: roamRate,
          roam_assists: +supportRoaming.roam_assists,
          total_assists: +supportRoaming.total_assists,
        },
      }),

      // Champion pool
      champion_pool: Object.values(champPool)
        .sort((a, b) => b.games - a.games)
        .map((c) => ({
          ...c,
          pick_rate: rnd((c.games / games.length) * 100, 1),
        })),
    });
  } catch (err) {
    log.error('[pgEvaluation] Error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  }
}
