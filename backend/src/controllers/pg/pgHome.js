import { pgDb, resolveLeagueId, resolveSerie, rnd, getChampMap, stageFilter } from './pgHelpers.js';

// ── getTournamentPg ─────────────────────────────────────────────────────────
// Returns tournament-level stats for a given serie

export async function getTournamentPg(req, res) {
  const { league = 'LEC', year, split, stage } = req.query;

  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json({});
  const { sf, stageParams } = stageFilter(stageParam, 2);

  // Basic tournament stats
  const { rows: stats } = await pgDb.query(`
    SELECT COUNT(*) AS total_games,
           ROUND(AVG(length)) AS avg_duration
    FROM games g
    WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 0
  `, [serieId, ...stageParams]);

  const s = stats[0] || {};
  const avgSec = Number(s.avg_duration || 0);
  const minutes = Math.floor(avgSec / 60);
  const seconds = Math.round(avgSec % 60);

  res.json({
    total_games: Number(s.total_games || 0),
    avg_duration: avgSec,
    avg_duration_formatted: `${minutes}:${String(seconds).padStart(2, '0')}`,
  });
}

// ── getOverviewPg ─────────────────────────────────────────────────────────
// Returns tournament overview with champions, players, teams, and side stats

export async function getOverviewPg(req, res) {
  const { league = 'LEC', year, split, stage } = req.query;

  // 1. Resolve serie
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json({});
  const { sf, stageParams } = stageFilter(stageParam, 2);

  // 2. Parallel fetch all data sources
  const [
    { rows: champRows },
    { rows: playerRows },
    { rows: teamRows },
    { rows: sideRows },
    { rows: dragonRows },
    { rows: playerTopChampRows },
    champMap,
  ] = await Promise.all([
    // Top champions by picks — live from game_players + bans when stage, precalculated otherwise
    stageParam
      ? pgDb.query(`
          WITH tid AS (SELECT $2::int AS v),
          pick_stats AS (
            SELECT ca.name AS champion_name, MIN(gp.champion_id) AS champion_id,
                   COUNT(*) AS picks,
                   SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
                   ROUND(AVG(gp.kills)::numeric, 1) AS kills_avg,
                   ROUND(AVG(gp.deaths)::numeric, 1) AS deaths_avg,
                   ROUND(AVG(gp.assists)::numeric, 1) AS assists_avg,
                   SUM(gp.kills) AS tk, SUM(gp.deaths) AS td, SUM(gp.assists) AS ta
            FROM game_players gp
            JOIN games g ON g.id = gp.game_id
            LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
            WHERE g.serie_id = $1 AND g.tournament_id = (SELECT v FROM tid) AND g.finished = true AND g.length > 60
            GROUP BY ca.name
          ),
          ban_stats AS (
            SELECT ca.name AS champion_name,
                   COUNT(*) AS bans,
                   SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS bans_blue,
                   SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS bans_red
            FROM game_picks_bans pb
            JOIN games g ON g.id = pb.game_id
            JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = pb.team_id
            LEFT JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
            WHERE g.serie_id = $1 AND g.tournament_id = (SELECT v FROM tid) AND g.finished = true AND pb.type = 'ban'
            GROUP BY ca.name
          ),
          total AS (
            SELECT COUNT(*) AS cnt FROM games WHERE serie_id = $1 AND tournament_id = (SELECT v FROM tid) AND finished = true
          )
          SELECT
            COALESCE(p.champion_id, 0) AS champion_id,
            COALESCE(p.champion_name, b.champion_name) AS champion_name,
            COALESCE(p.picks, 0) AS picks,
            COALESCE(b.bans, 0) AS bans,
            COALESCE(p.wins, 0) AS wins,
            COALESCE(p.picks, 0) - COALESCE(p.wins, 0) AS losses,
            CASE WHEN COALESCE(p.picks, 0) > 0 THEN ROUND(p.wins::numeric / p.picks * 100, 1) ELSE 0 END AS win_rate,
            p.kills_avg, p.deaths_avg, p.assists_avg,
            CASE WHEN COALESCE(p.td, 0) > 0 THEN ROUND((p.tk + p.ta)::numeric / p.td, 2) ELSE COALESCE(p.tk, 0) + COALESCE(p.ta, 0) END AS kda,
            CASE WHEN t.cnt > 0 THEN ROUND(COALESCE(b.bans_blue, 0)::numeric / t.cnt * 100, 1) ELSE 0 END AS ban_rate_blue,
            CASE WHEN t.cnt > 0 THEN ROUND(COALESCE(b.bans_red, 0)::numeric / t.cnt * 100, 1) ELSE 0 END AS ban_rate_red,
            COALESCE(b.bans_blue, 0) AS bans_blue,
            COALESCE(b.bans_red, 0) AS bans_red,
            t.cnt AS total_games_in_serie
          FROM pick_stats p
          FULL OUTER JOIN ban_stats b ON b.champion_name = p.champion_name
          CROSS JOIN total t
          ORDER BY COALESCE(p.picks, 0) DESC
        `, [serieId, ...stageParams])
      : pgDb.query(`
          SELECT cgs.champion_id, cgs.champion_name, cgs.picks, cgs.bans, cgs.wins, cgs.losses,
                 cgs.win_rate,
                 cgs.kills_avg, cgs.deaths_avg, cgs.assists_avg, cgs.kda,
                 cgs.ban_rate_blue,
                 cgs.ban_rate_red,
                 cgs.bans_blue, cgs.bans_red,
                 cgs.total_games_in_serie
          FROM champion_global_stats cgs
          WHERE cgs.serie_id = $1
          ORDER BY cgs.picks DESC
        `, [serieId]),

    // Player career stats — live from game_players when stage, precalculated otherwise
    stageParam
      ? pgDb.query(`
          SELECT
            gp.player_id, p.name, p.image_url AS player_image_url,
            MODE() WITHIN GROUP (ORDER BY gp.role) AS role, MAX(gp.team_id) AS team_id,
            COALESCE(tb.display_acronym, t.acronym) AS team_abbr, COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS team_logo_url,
            COUNT(*) AS games,
            SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
            ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0)), 2) AS kda,
            ROUND(AVG(CASE WHEN team_kills.tk > 0 THEN (gp.kills + gp.assists)::numeric / team_kills.tk * 100 ELSE 0 END), 1) AS kill_participation,
            ROUND(AVG((gp.minions_killed + COALESCE(gp.kills_neutral_minions, 0)) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS avg_cspm,
            ROUND(AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS dpm,
            ROUND(AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))::numeric, 0) AS gpm,
            ROUND(AVG(gp.total_damage_dealt_to_champions_percentage)::numeric, 1) AS dmg_share,
            ROUND(AVG(gp.gold_percentage)::numeric, 1) AS gold_share,
            MAX(gp.kills) AS max_kills
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          JOIN players p ON p.id = gp.player_id
          LEFT JOIN teams t ON t.id = gp.team_id
          LEFT JOIN team_brands tb ON tb.team_id = gp.team_id AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
          LEFT JOIN LATERAL (
            SELECT SUM(gp2.kills) AS tk FROM game_players gp2 WHERE gp2.game_id = gp.game_id AND gp2.team_id = gp.team_id
          ) team_kills ON true
          WHERE g.serie_id = $1 AND g.tournament_id = $2 AND g.finished = true AND g.length > 60
          GROUP BY gp.player_id, p.name, p.image_url, gp.team_id, t.acronym, t.dark_mode_image_url, t.image_url, tb.display_acronym, tb.display_logo
          ORDER BY COUNT(*) DESC
        `, [serieId, ...stageParams])
      : pgDb.query(`
          SELECT
            gp.player_id, p.name, p.image_url AS player_image_url,
            MODE() WITHIN GROUP (ORDER BY gp.role) AS role, MAX(gp.team_id) AS team_id,
            COALESCE(tb.display_acronym, t.acronym) AS team_abbr, COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS team_logo_url,
            COUNT(*) AS games,
            SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
            ROUND(((SUM(gp.kills) + SUM(gp.assists))::numeric / NULLIF(SUM(gp.deaths), 0)), 2) AS kda,
            ROUND(AVG(CASE WHEN team_kills.tk > 0 THEN (gp.kills + gp.assists)::numeric / team_kills.tk * 100 ELSE 0 END), 1) AS kill_participation,
            ROUND(AVG((gp.minions_killed + COALESCE(gp.kills_neutral_minions, 0)) / NULLIF(g.length / 60.0, 0))::numeric, 1) AS avg_cspm,
            ROUND(AVG(gp.total_damage_dealt_to_champions / NULLIF(g.length / 60.0, 0))::numeric, 0) AS dpm,
            ROUND(AVG(gp.gold_earned / NULLIF(g.length / 60.0, 0))::numeric, 0) AS gpm,
            ROUND(AVG(gp.total_damage_dealt_to_champions_percentage)::numeric, 1) AS dmg_share,
            ROUND(AVG(gp.gold_percentage)::numeric, 1) AS gold_share,
            MAX(gp.kills) AS max_kills
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          JOIN players p ON p.id = gp.player_id
          LEFT JOIN teams t ON t.id = gp.team_id
          LEFT JOIN team_brands tb ON tb.team_id = gp.team_id AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
          LEFT JOIN LATERAL (
            SELECT SUM(gp2.kills) AS tk FROM game_players gp2 WHERE gp2.game_id = gp.game_id AND gp2.team_id = gp.team_id
          ) team_kills ON true
          WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
          GROUP BY gp.player_id, p.name, p.image_url, gp.team_id, t.acronym, t.dark_mode_image_url, t.image_url, tb.display_acronym, tb.display_logo
          ORDER BY COUNT(*) DESC
        `, [serieId]),

    // Team stats from game_teams (aggregated)
    pgDb.query(`
      SELECT
        gt.team_id,
        COALESCE(tb2.display_acronym, t.acronym) AS abbr,
        COALESCE(tb2.display_logo, t.dark_mode_image_url, t.image_url) AS logo_url,
        COUNT(*) AS games,
        ROUND(AVG(gt.kills)::numeric, 1) AS avg_kills,
        ROUND(AVG(CASE WHEN g.winner_id != gt.team_id THEN gt.kills ELSE NULL END)::numeric, 1) AS avg_deaths_approx,
        ROUND(AVG(gt.dragon_kills)::numeric, 1) AS avg_dragons
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      JOIN teams t ON t.id = gt.team_id
      JOIN series _s ON _s.id = g.serie_id
      LEFT JOIN team_brands tb2 ON tb2.team_id = gt.team_id AND _s.year BETWEEN tb2.year_start AND tb2.year_end
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
      GROUP BY gt.team_id, t.acronym, t.image_url, t.dark_mode_image_url, tb2.display_acronym, tb2.display_logo
    `, [serieId, ...stageParams]),

    // Side stats (blue vs red aggregated)
    pgDb.query(`
      SELECT
        gt.color,
        COUNT(*) AS games,
        SUM(CASE WHEN g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN gt.first_blood = true THEN 1 ELSE 0 END) AS fb,
        SUM(CASE WHEN gt.first_dragon = true THEN 1 ELSE 0 END) AS fd,
        SUM(CASE WHEN gt.first_herald = true THEN 1 ELSE 0 END) AS fh,
        SUM(CASE WHEN gt.first_tower = true THEN 1 ELSE 0 END) AS ft,
        SUM(CASE WHEN gt.first_baron = true THEN 1 ELSE 0 END) AS fba
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
      GROUP BY gt.color
    `, [serieId, ...stageParams]),

    // Dragon breakdown
    pgDb.query(`
      SELECT
        SUM(COALESCE(gt.cloud_drake_kills, 0)) AS cloud,
        SUM(COALESCE(gt.ocean_drake_kills, 0)) AS ocean,
        SUM(COALESCE(gt.mountain_drake_kills, 0)) AS mountain,
        SUM(COALESCE(gt.infernal_drake_kills, 0)) AS infernal,
        SUM(COALESCE(gt.hextech_drake_kills, 0)) AS hextech,
        SUM(COALESCE(gt.chemtech_drake_kills, 0)) AS chemtech,
        SUM(COALESCE(gt.elder_drake_kills, 0)) AS elder
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
    `, [serieId, ...stageParams]),

    // Most played champion per player (for player cards)
    stageParam
      ? pgDb.query(`
          SELECT DISTINCT ON (gp.player_id)
            gp.player_id,
            ca.name AS top_champ_name,
            gp.champion_id AS top_champ_id
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
          WHERE g.serie_id = $1 AND g.tournament_id = $2 AND g.finished = true AND g.length > 60
          GROUP BY gp.player_id, ca.name, gp.champion_id
          ORDER BY gp.player_id, COUNT(*) DESC
        `, [serieId, ...stageParams])
      : pgDb.query(`
          SELECT DISTINCT ON (pcs.player_id)
            pcs.player_id,
            c.name AS top_champ_name,
            pcs.champion_id AS top_champ_id
          FROM player_champion_stats pcs
          JOIN champion_aliases ca ON ca.pandascore_id = pcs.champion_id
          JOIN champions c ON c.id = ca.canonical_id
          WHERE pcs.serie_id = $1
          ORDER BY pcs.player_id, pcs.games DESC
        `, [serieId]),

    // Get champion map helper (pandascore_id → { name, image_url })
    getChampMap(),
  ]);

  // 3. Build side_stats
  const sideMap = {};
  for (const s of sideRows) {
    const g = Number(s.games) || 1;
    sideMap[s.color] = {
      win_rate: rnd(s.wins / g * 100, 1),
      first_blood_rate: rnd(s.fb / g * 100, 1),
      first_dragon_rate: rnd(s.fd / g * 100, 1),
      first_herald_rate: rnd(s.fh / g * 100, 1),
      first_tower_rate: rnd(s.ft / g * 100, 1),
      first_baron_rate: rnd(s.fba / g * 100, 1),
    };
  }

  // 4. Dragons
  const dragonData = dragonRows[0] || {};
  const dragons_by_type = {};
  for (const dtype of ['cloud', 'ocean', 'mountain', 'infernal', 'hextech', 'chemtech', 'elder']) {
    const v = Number(dragonData[dtype] || 0);
    if (v > 0) dragons_by_type[dtype] = v;
  }

  // 5. Tournament meta
  const totalGames = champRows.length > 0 ? (champRows[0].total_games_in_serie || 0) : 0;
  const tournament = {
    league: league.toUpperCase(),
    total_games: totalGames,
    side_stats: { blue: sideMap.blue || {}, red: sideMap.red || {} },
    dragons_by_type,
  };

  // 6. Top champions (top 11 by picks)
  const topChamps = champRows.slice(0, 11).map(c => {
    const champ = champMap[c.champion_id] || {};
    const tg = c.total_games_in_serie || 1;
    return {
      name: c.champion_name || champ.name,
      image_url: champ.image_url || null,
      games: Number(c.picks) || 0,
      picks: Number(c.picks) || 0,
      bans: Number(c.bans) || 0,
      win_rate: rnd(c.win_rate, 1),
      ban_rate_blue: rnd(c.ban_rate_blue, 1),
      ban_rate_red: rnd(c.ban_rate_red, 1),
    };
  });

  // 7. Blue/red bans (top 5 each)
  const blueBans = [...champRows]
    .filter(c => c.bans_blue > 0)
    .sort((a, b) => (b.ban_rate_blue || 0) - (a.ban_rate_blue || 0))
    .slice(0, 5)
    .map(c => {
      const champ = champMap[c.champion_id] || {};
      return {
        name: c.champion_name || champ.name,
        image_url: champ.image_url || null,
        ban_rate_blue: rnd(c.ban_rate_blue, 1),
      };
    });

  const redBans = [...champRows]
    .filter(c => c.bans_red > 0)
    .sort((a, b) => (b.ban_rate_red || 0) - (a.ban_rate_red || 0))
    .slice(0, 5)
    .map(c => {
      const champ = champMap[c.champion_id] || {};
      return {
        name: c.champion_name || champ.name,
        image_url: champ.image_url || null,
        ban_rate_red: rnd(c.ban_rate_red, 1),
      };
    });

  // 8. Player rankings
  // Build player_id → most played champion { name, image_url } lookup
  const playerTopChamp = {};
  for (const r of playerTopChampRows) {
    const chInfo = champMap[r.top_champ_id] || {};
    playerTopChamp[r.player_id] = {
      name: r.top_champ_name,
      image_url: chInfo.image_url || null,
    };
  }

  const mapPlayer = (p) => ({
    name: p.name,
    image_url: p.player_image_url || null,
    top_champion: playerTopChamp[p.player_id]?.name || null,
    top_champion_image: playerTopChamp[p.player_id]?.image_url || null,
    team_abbr: p.team_abbr,
    team_logo_url: p.team_logo_url,
    kda: rnd(p.kda),
    avg_cspm: rnd(p.avg_cspm, 1),
    max_kills: Number(p.max_kills) || 0,
    kill_participation: rnd(p.kill_participation, 1),
    avg_damage_share: rnd(p.dmg_share, 1),
    avg_gold_share: rnd(p.gold_share, 1),
  });

  const topKills = [...playerRows]
    .sort((a, b) => (b.max_kills || 0) - (a.max_kills || 0))
    .slice(0, 12).map(mapPlayer);

  const topCS = [...playerRows]
    .sort((a, b) => (b.avg_cspm || 0) - (a.avg_cspm || 0))
    .slice(0, 12).map(mapPlayer);

  const topKDAPlayers = [...playerRows]
    .filter(p => p.games >= 3)
    .sort((a, b) => (b.kda || 0) - (a.kda || 0))
    .slice(0, 12).map(mapPlayer);

  const topKillParticipation = [...playerRows]
    .filter(p => p.games >= 3)
    .sort((a, b) => (b.kill_participation || 0) - (a.kill_participation || 0))
    .slice(0, 3).map(mapPlayer);

  const topDamageShare = [...playerRows]
    .filter(p => p.games >= 3)
    .sort((a, b) => (b.dmg_share || 0) - (a.dmg_share || 0))
    .slice(0, 3).map(mapPlayer);

  const topGoldShare = [...playerRows]
    .filter(p => p.games >= 3)
    .sort((a, b) => (b.gold_share || 0) - (a.gold_share || 0))
    .slice(0, 3).map(mapPlayer);

  // 9. Team rankings
  const mapTeam = (t) => ({
    abbr: t.abbr,
    logo_url: t.logo_url,
    avg_kills: Number(t.avg_kills),
    avg_deaths: Number(t.avg_deaths_approx),
    avg_dragons: Number(t.avg_dragons),
  });

  const topKillsPerGame = [...teamRows]
    .sort((a, b) => Number(b.avg_kills) - Number(a.avg_kills))
    .slice(0, 3).map(mapTeam);

  // Deaths: team with fewest avg_kills_received (approx from opponent kills)
  // Deaths per game per team — use team_career precalculated or recalculate from opponent kills
  const { rows: teamCareerRows } = stageParam
    ? await pgDb.query(`
        SELECT gt.team_id, t.acronym AS abbr,
               COALESCE(t.dark_mode_image_url, t.image_url) AS logo_url,
               ROUND(AVG(opp.kills)::numeric, 1) AS deaths_avg,
               ROUND(AVG(gt.kills)::numeric, 1) AS kills_avg
        FROM game_teams gt
        JOIN games g ON g.id = gt.game_id
        JOIN teams t ON t.id = gt.team_id
        LEFT JOIN game_teams opp ON opp.game_id = g.id AND opp.team_id != gt.team_id
        WHERE g.serie_id = $1 ${sf} AND g.finished = true AND g.length > 60
        GROUP BY gt.team_id, t.acronym, t.dark_mode_image_url, t.image_url
      `, [serieId, ...stageParams])
    : await pgDb.query(`
        SELECT gt.team_id, t.acronym AS abbr,
               COALESCE(t.dark_mode_image_url, t.image_url) AS logo_url,
               ROUND(AVG(opp.kills)::numeric, 1) AS deaths_avg,
               ROUND(AVG(gt.kills)::numeric, 1) AS kills_avg
        FROM game_teams gt
        JOIN games g ON g.id = gt.game_id
        JOIN teams t ON t.id = gt.team_id
        LEFT JOIN game_teams opp ON opp.game_id = g.id AND opp.team_id != gt.team_id
        WHERE g.serie_id = $1 AND g.finished = true AND g.length > 60
        GROUP BY gt.team_id, t.acronym, t.dark_mode_image_url, t.image_url
      `, [serieId]);

  const topDeathsPerGame = [...teamCareerRows]
    .sort((a, b) => (a.deaths_avg || 999) - (b.deaths_avg || 999))
    .slice(0, 3)
    .map(t => ({
      abbr: t.abbr,
      logo_url: t.logo_url,
      avg_deaths: rnd(t.deaths_avg, 1),
    }));

  const topDragonsPerGame = [...teamRows]
    .sort((a, b) => Number(b.avg_dragons) - Number(a.avg_dragons))
    .slice(0, 3).map(mapTeam);

  res.json({
    tournament,
    topChamps,
    topKills,
    topCS,
    topKDAPlayers,
    topKillParticipation,
    topDamageShare,
    topGoldShare,
    topKillsPerGame,
    topDeathsPerGame,
    topDragonsPerGame,
    blueBans,
    redBans,
  });
}

// ── getHomeOverviewPg ────────────────────────────────────────────────────────
// Multi-league home page overview with team standings, player rankings, and match results

export async function getHomeOverviewPg(req, res) {
  const MAJOR_LEAGUES = ['LEC', 'LCS', 'LCK', 'LPL'];
  const TIER3_LEAGUES = ['CBLOL', 'LCP', 'VCS', 'LJL', 'TCL'];
  const TIER4_LEAGUES = ['LFL', 'PRM', 'LES', 'NLC', 'LIT', 'EBL', 'ROADOFLEGENDS', 'LCKCL', 'NACL', 'CIRCUITODESAF', 'LRN', 'LRS'];
  const ALL_LEAGUES = [...MAJOR_LEAGUES, ...TIER3_LEAGUES, ...TIER4_LEAGUES];

  // ── 1. Resolve latest serie_id for each league ──
  const { rows: serieRows } = await pgDb.query(`
    SELECT DISTINCT ON (UPPER(l.name))
      UPPER(l.name) AS slug,
      s.id AS serie_id,
      s.season,
      s.full_name
    FROM series s
    JOIN leagues l ON l.id = s.league_id
    WHERE UPPER(l.name) = ANY($1::text[])
    ORDER BY UPPER(l.name), s.begin_at DESC
  `, [ALL_LEAGUES]);

  if (!serieRows.length) {
    return res.json({
      leagueOverviews: [], tier3Leagues: [], tier4Leagues: [],
      metaSnapshot: null, teamHighlights: null,
    });
  }

  const serieMap = {};
  for (const r of serieRows) serieMap[r.slug] = { serieId: r.serie_id, season: r.season, fullName: r.full_name };
  const allSerieIds = serieRows.map(r => r.serie_id);

  // ── 2. Batch-fetch all data across all series in parallel ──
  const [
    { rows: teamRows },
    { rows: playerRows },
    { rows: champRows },
    { rows: sideRows },
    { rows: recentMatchRows },
    { rows: upcomingMatchRows },
    { rows: bestOfRows },
    { rows: matchStandingRows },
    { rows: tournamentRows },
  ] = await Promise.all([
    // 2a. team_career for standings / performance / rankings
    pgDb.query(`
      SELECT tc.serie_id, tc.team_id, tc.games, tc.wins, tc.losses, tc.win_rate,
             tc.kills_avg, tc.deaths_avg, tc.assists_avg, tc.kda,
             tc.avg_dragons, tc.gpm, tc.avg_gold_diff_20,
             t.acronym AS abbr, t.name AS team_name,
             COALESCE(t.dark_mode_image_url, t.image_url) AS logo_url
      FROM team_career tc
      JOIN teams t ON t.id = tc.team_id
      WHERE tc.serie_id = ANY($1::int[])
    `, [allSerieIds]),

    // 2b. player_career for best players
    pgDb.query(`
      SELECT pc.serie_id, pc.player_id, pc.games, pc.kda, pc.role,
             p.name,
             p.image_url,
             t.acronym AS team_abbr,
             COALESCE(t.dark_mode_image_url, t.image_url) AS team_logo_url
      FROM player_career pc
      JOIN players p ON p.id = pc.player_id
      LEFT JOIN teams t ON t.id = pc.team_id
      WHERE pc.serie_id = ANY($1::int[])
    `, [allSerieIds]),

    // 2c. champion_global_stats for champions played + meta snapshot
    pgDb.query(`
      SELECT cgs.serie_id, cgs.picks, cgs.bans, cgs.wins, cgs.win_rate,
             cgs.blue_picks, cgs.red_picks,
             c.name AS champion_name, c.image_url AS champ_image_url
      FROM champion_global_stats cgs
      JOIN champion_aliases ca ON ca.pandascore_id = cgs.champion_id
      JOIN champions c ON c.id = ca.canonical_id
      WHERE cgs.serie_id = ANY($1::int[])
    `, [allSerieIds]),

    // 2d. Side stats per serie (aggregated from game_teams)
    pgDb.query(`
      SELECT g.serie_id,
        COUNT(DISTINCT g.id) AS total_games,
        SUM(CASE WHEN gt.color = 'blue' AND g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS blue_wins,
        SUM(CASE WHEN gt.color = 'red'  AND g.winner_id = gt.team_id THEN 1 ELSE 0 END) AS red_wins,
        SUM(CASE WHEN gt.color = 'blue' THEN gt.kills ELSE 0 END) AS blue_kills,
        SUM(CASE WHEN gt.color = 'red'  THEN gt.kills ELSE 0 END) AS red_kills,
        SUM(CASE WHEN gt.color = 'blue' THEN gt.dragon_kills ELSE 0 END) AS blue_drakes,
        SUM(CASE WHEN gt.color = 'red'  THEN gt.dragon_kills ELSE 0 END) AS red_drakes,
        SUM(CASE WHEN gt.color = 'blue' THEN gt.tower_kills ELSE 0 END) AS blue_towers,
        SUM(CASE WHEN gt.color = 'red'  THEN gt.tower_kills ELSE 0 END) AS red_towers,
        SUM(CASE WHEN gt.color = 'blue' THEN gt.baron_kills ELSE 0 END) AS blue_barons,
        SUM(CASE WHEN gt.color = 'red'  THEN gt.baron_kills ELSE 0 END) AS red_barons
      FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.serie_id = ANY($1::int[]) AND g.finished = true AND g.length > 60
      GROUP BY g.serie_id
    `, [allSerieIds]),

    // 2e. Recent finished matches (top 5 per serie via window function)
    pgDb.query(`
      SELECT * FROM (
        SELECT m.id, m.serie_id, m.number_of_games, m.begin_at, m.winner_id,
          ROW_NUMBER() OVER (PARTITION BY m.serie_id ORDER BY m.begin_at DESC) AS rn
        FROM matches m
        WHERE m.serie_id = ANY($1::int[]) AND m.status = 'finished'
      ) sub WHERE rn <= 5
    `, [allSerieIds]),

    // 2f. Upcoming matches (top 4 per serie)
    pgDb.query(`
      SELECT * FROM (
        SELECT m.id, m.serie_id, m.begin_at, m.number_of_games, m.status,
          ROW_NUMBER() OVER (PARTITION BY m.serie_id ORDER BY m.begin_at ASC) AS rn
        FROM matches m
        WHERE m.serie_id = ANY($1::int[]) AND m.status IN ('not_started', 'running')
      ) sub WHERE rn <= 4
    `, [allSerieIds]),

    // 2g. Best-of format per serie (mode of number_of_games from finished matches)
    pgDb.query(`
      SELECT serie_id,
             mode() WITHIN GROUP (ORDER BY COALESCE(number_of_games, 1)) AS best_of
      FROM matches
      WHERE serie_id = ANY($1::int[]) AND status = 'finished'
      GROUP BY serie_id
    `, [allSerieIds]),

    // 2h. Match-level standings (series W/L for BO3+ leagues)
    pgDb.query(`
      SELECT t.serie_id, mo.team_id,
             COUNT(*) FILTER (WHERE m.winner_id = mo.team_id) AS match_wins,
             COUNT(*) FILTER (WHERE m.winner_id IS NOT NULL AND m.winner_id != mo.team_id) AS match_losses
      FROM matches m
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN match_opponents mo ON mo.match_id = m.id
      WHERE t.serie_id = ANY($1::int[]) AND m.status = 'finished'
      GROUP BY t.serie_id, mo.team_id
    `, [allSerieIds]),

    // 2i. Current tournament per serie (latest by end_at) for phase detection
    pgDb.query(`
      SELECT DISTINCT ON (t.serie_id)
        t.serie_id, t.name AS tournament_name, t.has_bracket
      FROM tournaments t
      WHERE t.serie_id = ANY($1::int[])
      ORDER BY t.serie_id, t.end_at DESC NULLS LAST, t.begin_at DESC
    `, [allSerieIds]),
  ]);

  // ── 3. Batch-fetch opponents & kills for all matched matches ──
  const allRecentIds = recentMatchRows.map(r => r.id);
  const allUpcomingIds = upcomingMatchRows.map(r => r.id);
  const allMatchIds = [...allRecentIds, ...allUpcomingIds];

  const oppMap = {};
  const killsMap = {};

  if (allMatchIds.length > 0) {
    const batchQueries = [
      pgDb.query(`
        SELECT mo.match_id, mo.team_id, mo.result_score,
               t.acronym AS abbr,
               COALESCE(t.dark_mode_image_url, t.image_url) AS logo_url
        FROM match_opponents mo
        JOIN teams t ON t.id = mo.team_id
        WHERE mo.match_id = ANY($1::int[])
        ORDER BY mo.match_id, mo.side, mo.team_id
      `, [allMatchIds]),
    ];
    if (allRecentIds.length > 0) {
      batchQueries.push(
        pgDb.query(`
          SELECT g.match_id, gt.team_id, SUM(gt.kills) AS total_kills
          FROM game_teams gt
          JOIN games g ON g.id = gt.game_id
          WHERE g.match_id = ANY($1::int[])
          GROUP BY g.match_id, gt.team_id
        `, [allRecentIds])
      );
    }
    const batchResults = await Promise.all(batchQueries);
    for (const o of batchResults[0].rows) (oppMap[o.match_id] ||= []).push(o);
    if (batchResults[1]) {
      for (const k of batchResults[1].rows) {
        (killsMap[k.match_id] ||= {})[k.team_id] = Number(k.total_kills) || 0;
      }
    }
  }

  // ── 3b. Fetch ALL running matches across all tracked leagues (by league_id,
  //        not serie_id) so live matches always appear even if they belong to
  //        a serie that isn't the "latest" one resolved in step 1. ──
  const leagueIdRows = await pgDb.query(`
    SELECT l.id AS league_id, UPPER(l.name) AS slug
    FROM leagues l
    WHERE UPPER(l.name) = ANY($1::text[])
  `, [ALL_LEAGUES]);
  const slugByLeagueId = {};
  for (const r of leagueIdRows.rows) slugByLeagueId[r.league_id] = r.slug;
  const allLeagueIds = leagueIdRows.rows.map(r => r.league_id);

  let globalLiveRows = [];
  let globalLiveOppMap = {};
  if (allLeagueIds.length > 0) {
    const { rows: liveMatchRows } = await pgDb.query(`
      SELECT m.id, m.league_id, m.begin_at, m.number_of_games, m.status
      FROM matches m
      WHERE m.league_id = ANY($1::int[]) AND m.status = 'running'
    `, [allLeagueIds]);
    globalLiveRows = liveMatchRows;

    if (liveMatchRows.length > 0) {
      const liveIds = liveMatchRows.map(r => r.id);
      const { rows: liveOpps } = await pgDb.query(`
        SELECT mo.match_id, mo.team_id, mo.result_score,
               t.acronym AS abbr,
               COALESCE(t.dark_mode_image_url, t.image_url) AS logo_url
        FROM match_opponents mo
        JOIN teams t ON t.id = mo.team_id
        WHERE mo.match_id = ANY($1::int[])
        ORDER BY mo.match_id, mo.side, mo.team_id
      `, [liveIds]);
      for (const o of liveOpps) (globalLiveOppMap[o.match_id] ||= []).push(o);
    }
  }

  // Index live matches by league slug
  const liveBySlug = {};
  for (const m of globalLiveRows) {
    const slug = slugByLeagueId[m.league_id];
    if (slug) (liveBySlug[slug] ||= []).push(m);
  }

  // ── 4. Index data by serie_id ──
  const teamsBySerie = {};
  for (const t of teamRows) (teamsBySerie[t.serie_id] ||= []).push(t);

  const playersBySerie = {};
  for (const p of playerRows) (playersBySerie[p.serie_id] ||= []).push(p);

  const champsBySerie = {};
  for (const c of champRows) (champsBySerie[c.serie_id] ||= []).push(c);

  const sideStatsBySerie = {};
  for (const s of sideRows) sideStatsBySerie[s.serie_id] = s;

  const recentBySerie = {};
  for (const m of recentMatchRows) (recentBySerie[m.serie_id] ||= []).push(m);

  const upcomingBySerie = {};
  for (const m of upcomingMatchRows) (upcomingBySerie[m.serie_id] ||= []).push(m);

  const bestOfBySerie = {};
  for (const b of bestOfRows) bestOfBySerie[b.serie_id] = Number(b.best_of) || 1;

  const tournamentBySerie = {};
  for (const t of tournamentRows) tournamentBySerie[t.serie_id] = t;

  const matchStandingsBySerie = {};
  for (const ms of matchStandingRows) {
    (matchStandingsBySerie[ms.serie_id] ||= {})[ms.team_id] = {
      match_wins: Number(ms.match_wins) || 0,
      match_losses: Number(ms.match_losses) || 0,
    };
  }

  // ── 5. Build overview per league (pure in-memory, no extra queries) ──
  function buildOverview(slug) {
    const info = serieMap[slug];
    if (!info) return null;
    const { serieId, season, fullName } = info;

    const teams = (teamsBySerie[serieId] || [])
      .sort((a, b) => (Number(b.wins) || 0) - (Number(a.wins) || 0) || (Number(b.win_rate) || 0) - (Number(a.win_rate) || 0));
    const players = playersBySerie[serieId] || [];
    const champs = (champsBySerie[serieId] || [])
      .sort((a, b) => (Number(b.picks) || 0) - (Number(a.picks) || 0));
    const ss = sideStatsBySerie[serieId];
    const recent = recentBySerie[serieId] || [];
    const upcoming = upcomingBySerie[serieId] || [];

    if (!teams.length && !champs.length) return null;

    // Mini standings (top 8)
    // For BO3+ leagues, use match-level W/L (series won/lost); for BO1, use game W/L
    const bestOf = bestOfBySerie[serieId] || 1;
    const matchStandings = matchStandingsBySerie[serieId] || {};
    const useMatchWL = bestOf >= 3;

    const miniStandings = teams.map(t => {
      const ms = matchStandings[t.team_id];
      const gameW = Number(t.wins) || 0;
      const gameL = Number(t.losses) || 0;
      return {
        abbr: t.abbr,
        name: t.team_name,
        logo_url: t.logo_url,
        wins: useMatchWL && ms ? ms.match_wins : gameW,
        losses: useMatchWL && ms ? ms.match_losses : gameL,
        ...(useMatchWL ? { gameWins: gameW, gameLosses: gameL } : {}),
        win_rate: rnd(Number(t.win_rate), 1),
        games: Number(t.games) || 0,
      };
    })
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
      .slice(0, 8);

    // Champions played (top 5 by picks)
    const championsPlayed = champs.slice(0, 5).map(c => ({
      name: c.champion_name,
      image_url: c.champ_image_url,
      games: Number(c.picks) || 0,
      bans: Number(c.bans) || 0,
      winRate: rnd(Number(c.win_rate), 1),
    }));

    // Blue vs Red side stats
    let blueVsRed = null;
    if (ss) {
      const g  = Number(ss.total_games) || 0;
      const bw = Number(ss.blue_wins) || 0;
      const rw = Number(ss.red_wins) || 0;
      const bk = Number(ss.blue_kills) || 0;
      const rk = Number(ss.red_kills) || 0;
      const bd = Number(ss.blue_drakes) || 0;
      const rd = Number(ss.red_drakes) || 0;
      const bt = Number(ss.blue_towers) || 0;
      const rt = Number(ss.red_towers) || 0;
      const bb = Number(ss.blue_barons) || 0;
      const rb = Number(ss.red_barons) || 0;
      blueVsRed = [
        { label: 'Win Rate', blue: _pct(bw, g),       red: _pct(rw, g) },
        { label: 'Kills',    blue: _pct(bk, bk + rk), red: _pct(rk, bk + rk) },
        { label: 'Dragons',  blue: _pct(bd, bd + rd), red: _pct(rd, bd + rd) },
        { label: 'Towers',   blue: _pct(bt, bt + rt), red: _pct(rt, bt + rt) },
        { label: 'Barons',   blue: _pct(bb, bb + rb), red: _pct(rb, bb + rb) },
      ];
    }

    // Team Performance (top 5 per metric)
    const toRow = (t, val) => ({ abbr: t.abbr, logo_url: t.logo_url, value: val });

    const killsPerGame = [...teams]
      .filter(t => t.kills_avg != null)
      .sort((a, b) => Number(b.kills_avg) - Number(a.kills_avg))
      .slice(0, 5)
      .map(t => toRow(t, rnd(Number(t.kills_avg), 1)));

    const deathsPerGame = [...teams]
      .filter(t => t.deaths_avg != null)
      .sort((a, b) => Number(a.deaths_avg) - Number(b.deaths_avg))
      .slice(0, 5)
      .map(t => toRow(t, rnd(Number(t.deaths_avg), 1)));

    const dragonsPerGame = [...teams]
      .filter(t => t.avg_dragons != null)
      .sort((a, b) => Number(b.avg_dragons) - Number(a.avg_dragons))
      .slice(0, 5)
      .map(t => toRow(t, rnd(Number(t.avg_dragons), 1)));

    // Team Rankings
    const winRate = [...teams]
      .filter(t => (Number(t.games) || 0) >= 2 && t.win_rate != null)
      .sort((a, b) => Number(b.win_rate) - Number(a.win_rate))
      .slice(0, 5)
      .map(t => toRow(t, rnd(Number(t.win_rate), 1)));

    const kdaRanking = [...teams]
      .filter(t => t.kills_avg != null && t.deaths_avg != null)
      .map(t => ({
        ...t,
        _kda: Number(t.deaths_avg) > 0
          ? rnd((Number(t.kills_avg) + (Number(t.assists_avg) || 0)) / Number(t.deaths_avg))
          : rnd(Number(t.kills_avg) + (Number(t.assists_avg) || 0)),
      }))
      .sort((a, b) => b._kda - a._kda)
      .slice(0, 5)
      .map(t => toRow(t, t._kda));

    const goldDiff20 = [...teams]
      .filter(t => t.avg_gold_diff_20 != null)
      .sort((a, b) => Number(b.avg_gold_diff_20) - Number(a.avg_gold_diff_20))
      .slice(0, 5)
      .map(t => toRow(t, rnd(Number(t.avg_gold_diff_20))));

    // Recent matches
    const recentMatches = recent.map(m => {
      const opps = oppMap[m.id] || [];
      if (opps.length < 2) return null;
      const isSeries = (m.number_of_games || 1) > 1;
      // Determine winner: prefer scores (more reliable), fallback to winner_id
      const s0 = Number(opps[0].result_score) || 0;
      const s1 = Number(opps[1].result_score) || 0;
      let winner;
      if (s0 !== s1) {
        winner = s0 > s1 ? 'blue' : 'red';
      } else {
        winner = m.winner_id === opps[0].team_id ? 'blue' : 'red';
      }
      return {
        matchid: m.id,
        isSeries,
        numberOfGames: m.number_of_games || 1,
        winner,
        dateStr: m.begin_at ? new Date(m.begin_at).toISOString().split('T')[0] : null,
        blue: {
          abbr: opps[0].abbr || '',
          score: opps[0].result_score || 0,
          kills: killsMap[m.id]?.[opps[0].team_id] || 0,
          logo_url: opps[0].logo_url,
        },
        red: {
          abbr: opps[1].abbr || '',
          score: opps[1].result_score || 0,
          kills: killsMap[m.id]?.[opps[1].team_id] || 0,
          logo_url: opps[1].logo_url,
        },
      };
    }).filter(Boolean);

    // Upcoming matches (reshaped to PandaScore format for frontend compatibility)
    const upcomingFormatted = upcoming.map(m => {
      const opps = oppMap[m.id] || [];
      return {
        id: m.id,
        begin_at: m.begin_at,
        opponents: [
          { opponent: { acronym: opps[0]?.abbr || 'TBD', dark_mode_image_url: opps[0]?.logo_url, image_url: opps[0]?.logo_url } },
          { opponent: { acronym: opps[1]?.abbr || 'TBD', dark_mode_image_url: opps[1]?.logo_url, image_url: opps[1]?.logo_url } },
        ],
      };
    });

    // Live matches — use the global league-level query (not serie-filtered)
    // so live matches always appear even if the match belongs to a different serie
    const liveMatches = (liveBySlug[slug] || []).map(m => {
      const opps = globalLiveOppMap[m.id] || [];
      return {
        id: m.id,
        begin_at: m.begin_at,
        number_of_games: m.number_of_games || 3,
        blue: {
          abbr: opps[0]?.abbr || 'TBD',
          logo_url: opps[0]?.logo_url || null,
          score: opps[0]?.result_score || 0,
        },
        red: {
          abbr: opps[1]?.abbr || 'TBD',
          logo_url: opps[1]?.logo_url || null,
          score: opps[1]?.result_score || 0,
        },
      };
    });

    // Best players (top 5 by KDA, min 2 games)
    const bestPlayers = [...players]
      .filter(p => (Number(p.games) || 0) >= 2 && p.kda != null)
      .sort((a, b) => Number(b.kda) - Number(a.kda))
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        playerName: p.name,
        image_url: p.image_url,
        role: p.role,
        team: p.team_abbr || '',
        team_logo_url: p.team_logo_url,
        kda: rnd(Number(p.kda), 2),
        value: rnd(Number(p.kda), 2),
      }));

    return {
      region: slug,
      split: season || fullName || null,
      upcoming: upcomingFormatted,
      liveMatches,
      championsPlayed,
      blueVsRed,
      teamPerformance: { killsPerGame, deathsPerGame, dragonsPerGame },
      teamRankings: { goldDiff20, winRate, kda: kdaRanking },
      recentMatches,
      miniStandings,
      bestPlayers,
      bestOf,
      isPlayoffs: tournamentBySerie[serieId]?.has_bracket === true,
      phaseName: tournamentBySerie[serieId]?.tournament_name || null,
      _serieId: serieId,
    };
  }

  const majorOverviews = MAJOR_LEAGUES.map(buildOverview).filter(Boolean);
  const tier3Overviews = TIER3_LEAGUES.map(buildOverview).filter(Boolean);
  const tier4Overviews = TIER4_LEAGUES.map(buildOverview).filter(Boolean);

  // ── 6. Meta Snapshot (cross-league champion aggregation from majors) ──
  let metaSnapshot = null;
  const majorSerieIds = majorOverviews.map(o => o._serieId).filter(Boolean);
  if (majorSerieIds.length > 0) {
    // Find the latest patch across major leagues
    const { rows: patchRows } = await pgDb.query(`
      SELECT g.patch, COUNT(*) AS cnt
      FROM games g
      WHERE g.serie_id = ANY($1::int[]) AND g.finished = true AND g.patch IS NOT NULL
      GROUP BY g.patch ORDER BY g.patch DESC LIMIT 1
    `, [majorSerieIds]);
    const currentPatch = patchRows[0]?.patch || null;

    // Calculate meta snapshot from game_players filtered by current patch
    const patchFilter = currentPatch ? 'AND g.patch = $2' : '';
    const patchParams = currentPatch ? [majorSerieIds, currentPatch] : [majorSerieIds];

    const { rows: patchChampRows } = await pgDb.query(`
      SELECT
        ca.name AS champion_name,
        c.image_url AS champ_image_url,
        COUNT(*) AS picks,
        SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_picks,
        SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_picks
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_teams gt ON gt.game_id = g.id AND gt.team_id = gp.team_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      LEFT JOIN champions c ON c.id = ca.canonical_id
      WHERE g.serie_id = ANY($1::int[]) AND g.finished = true AND g.length > 60
        ${patchFilter}
      GROUP BY ca.name, c.image_url
    `, patchParams);

    // Bans for current patch
    const { rows: patchBanRows } = await pgDb.query(`
      SELECT ca.name AS champion_name, COUNT(*) AS bans
      FROM game_picks_bans pb
      JOIN games g ON g.id = pb.game_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
      WHERE g.serie_id = ANY($1::int[]) AND g.finished = true AND pb.type = 'ban'
        ${patchFilter}
      GROUP BY ca.name
    `, patchParams);

    const banMap = {};
    for (const b of patchBanRows) banMap[(b.champion_name || '').toLowerCase()] = Number(b.bans);

    const totalGamesInPatch = patchChampRows.reduce((max, c) => Math.max(max, Number(c.picks)), 0) > 0
      ? (await pgDb.query(`SELECT COUNT(DISTINCT g.id) AS cnt FROM games g WHERE g.serie_id = ANY($1::int[]) AND g.finished = true ${patchFilter}`, patchParams)).rows[0]?.cnt || 1
      : 1;

    const allChampAgg = patchChampRows.map(c => {
      const bans = banMap[(c.champion_name || '').toLowerCase()] || 0;
      const picks = Number(c.picks);
      const bluePicks = Number(c.blue_picks);
      const redPicks = Number(c.red_picks);
      return {
        championName: c.champion_name,
        image_url: c.champ_image_url,
        picks,
        bans,
        winRate: picks > 0 ? rnd(Number(c.wins) / picks * 100, 1) : 0,
        earlyPickRate: rnd(bluePicks / Math.max(totalGamesInPatch, 1) * 100, 1),
        blue_picks: bluePicks,
        red_picks: redPicks,
        bluePickRate: rnd(bluePicks / Math.max(totalGamesInPatch, 1) * 100, 1),
        redPickRate: rnd(redPicks / Math.max(totalGamesInPatch, 1) * 100, 1),
      };
    });

    metaSnapshot = {
      patch: currentPatch,
      totalGames: Number(totalGamesInPatch),
      mostPickedChampions: [...allChampAgg].sort((a, b) => b.picks - a.picks).slice(0, 5),
      mostBannedChampions: [...allChampAgg].sort((a, b) => b.bans - a.bans).slice(0, 5),
      highestWinRateChampions: [...allChampAgg].filter(c => c.picks >= 5).sort((a, b) => b.winRate - a.winRate).slice(0, 5),
      priorityChampionsBlue: [...allChampAgg].filter(c => c.blue_picks > 0).sort((a, b) => b.bluePickRate - a.bluePickRate).slice(0, 5)
        .map(c => ({ ...c, earlyPickRate: c.bluePickRate })),
      priorityChampionsRed: [...allChampAgg].filter(c => c.red_picks > 0).sort((a, b) => b.redPickRate - a.redPickRate).slice(0, 5)
        .map(c => ({ ...c, earlyPickRate: c.redPickRate })),
    };
  }

  // Strip internal _serieId before sending
  const strip = (o) => { const { _serieId, ...rest } = o; return rest; };

  res.json({
    leagueOverviews: majorOverviews.map(strip),
    tier3Leagues: tier3Overviews.map(strip),
    tier4Leagues: tier4Overviews.map(strip),
    metaSnapshot,
    teamHighlights: null,
  });
}

// ── getLiveStatusPg ──────────────────────────────────────────────────────────
// Lightweight endpoint that returns a fingerprint of the current live-match
// state.  The frontend polls this every ~15s and only triggers a full
// router.refresh() when the fingerprint changes (match started/ended/score
// changed).  Runs a single fast query on the matches table.

export async function getLiveStatusPg(_req, res) {
  const MAJOR_LEAGUES  = ['LEC', 'LCS', 'LCK', 'LPL'];
  const TIER3_LEAGUES  = ['CBLOL', 'LCP', 'VCS', 'LJL', 'TCL'];
  const TIER4_LEAGUES  = ['LFL', 'PRM', 'LES', 'NLC', 'LIT', 'EBL', 'ROADOFLEGENDS', 'LCKCL', 'NACL', 'CIRCUITODESAF', 'LRN', 'LRS'];
  const INTL_LEAGUES   = ['WORLDS', 'MSI', 'FIRSTSTAND', 'EWC'];
  const EXTRA_LEAGUES  = ['EMEAMASTERS'];
  const ALL_LEAGUES    = [...MAJOR_LEAGUES, ...TIER3_LEAGUES, ...TIER4_LEAGUES, ...INTL_LEAGUES, ...EXTRA_LEAGUES];

  // 1. Resolve league IDs by name
  const { rows: leagueRows } = await pgDb.query(`
    SELECT id FROM leagues WHERE UPPER(name) = ANY($1::text[])
  `, [ALL_LEAGUES]);

  if (!leagueRows.length) {
    return res.json({ liveCount: 0, fingerprint: '0' });
  }

  const allLeagueIds = leagueRows.map(r => r.id);

  // 2. Get running matches with their opponent scores (by league_id, not serie)
  const { rows: liveRows } = await pgDb.query(`
    SELECT m.id, mo.team_id, mo.result_score
    FROM matches m
    JOIN match_opponents mo ON mo.match_id = m.id
    WHERE m.league_id = ANY($1::int[]) AND m.status = 'running'
    ORDER BY m.id, mo.side
  `, [allLeagueIds]);

  // 3. Build fingerprint: sorted list of "matchId:score1-score2"
  const matchMap = {};
  for (const r of liveRows) {
    if (!matchMap[r.id]) matchMap[r.id] = [];
    matchMap[r.id].push(r.result_score || 0);
  }
  const parts = Object.entries(matchMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, scores]) => `${id}:${scores.join('-')}`);

  const fingerprint = parts.length > 0 ? parts.join('|') : '0';

  res.json({
    liveCount: Object.keys(matchMap).length,
    fingerprint,
  });
}

// ── Helper function for percentage formatting ──
function _pct(num, denom) {
  if (denom === 0) return 0;
  return rnd(num / denom * 100, 1);
}
