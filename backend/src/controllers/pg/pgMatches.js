import { pgDb, ApiError, resolveLeagueId, resolveSerie, getChampMap, getRuneMap, getItemMap, getSpellMap, getRunePathMap, deriveMatchLabel, rnd, stageFilter } from './pgHelpers.js';

export async function getMatchDetailPg(req, res) {
  const { id } = req.params;
  const matchId = Number(id);

  // 1. Match metadata + opponents + tournament + games + lookups — ALL IN PARALLEL
  const [
    { rows: matchRows },
    { rows: opponents },
    { rows: tourneyRows },
    [champMap, runeMap, itemMap, spellMap, runePathMap],
    { rows: gameRows },
  ] = await Promise.all([
    pgDb.query(`
      SELECT m.id, m.serie_id, m.status, m.number_of_games, m.scheduled_at, m.begin_at,
             m.winner_id, m.winner_type
      FROM matches m WHERE m.id = $1
    `, [matchId]),
    pgDb.query(`
      SELECT mo.team_id, mo.result_score AS score, COALESCE(tb.display_name, t.name) AS name, COALESCE(tb.display_acronym, t.acronym) AS acronym,
             COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS image_url
      FROM match_opponents mo
      JOIN teams t ON t.id = mo.team_id
      JOIN matches m ON m.id = mo.match_id
      JOIN series _s ON _s.id = m.serie_id
      LEFT JOIN team_brands tb ON tb.team_id = mo.team_id AND _s.year BETWEEN tb.year_start AND tb.year_end
      WHERE mo.match_id = $1 ORDER BY mo.side
    `, [matchId]),
    pgDb.query(`
      SELECT t.id, t.name, t.slug, t.begin_at, t.end_at, l.name AS league_name, l.image_url AS league_image
      FROM games g JOIN tournaments t ON t.id = g.tournament_id JOIN leagues l ON l.id = t.league_id
      WHERE g.match_id = $1 LIMIT 1
    `, [matchId]),
    Promise.all([getChampMap(), getRuneMap(), getItemMap(), getSpellMap(), getRunePathMap()]),
    pgDb.query(`
      SELECT id, position, length, finished, winner_id, begin_at, end_at, patch, forfeit
      FROM games WHERE match_id = $1 ORDER BY position ASC
    `, [matchId]),
  ]);

  if (!matchRows.length) throw ApiError.notFound('Match');
  const match = matchRows[0];
  const tourney = tourneyRows[0] || null;

  // 2. Batch-fetch ALL per-game data across all games in one shot
  const gameIds = gameRows.map(g => g.id);

  const [
    { rows: allTeamRows },
    { rows: allPlayerRows },
    { rows: allRuneRows },
    { rows: allFrameRows },
    { rows: allFramePlayerRows },
    { rows: allEventRows },
    { rows: allBanRows },
  ] = await Promise.all([
    pgDb.query(`
      SELECT gt.game_id, gt.team_id, gt.color,
             COALESCE(tb.display_name, t.name) AS name,
             COALESCE(tb.display_acronym, t.acronym) AS acronym,
             COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS image_url,
             gt.kills, gt.gold_earned, gt.tower_kills, gt.inhibitor_kills,
             gt.baron_kills, gt.herald_kills, gt.dragon_kills,
             gt.elder_drake_kills, gt.voidgrub_kills, gt.atakhan_kills,
             gt.cloud_drake_kills, gt.ocean_drake_kills, gt.mountain_drake_kills,
             gt.infernal_drake_kills, gt.hextech_drake_kills, gt.chemtech_drake_kills,
             gt.first_blood, gt.first_tower, gt.first_dragon, gt.first_baron,
             gt.first_herald, gt.first_inhibitor, gt.first_voidgrub, gt.first_atakhan
      FROM game_teams gt
      JOIN teams t ON t.id = gt.team_id
      JOIN games g ON g.id = gt.game_id
      JOIN series _s ON _s.id = g.serie_id
      LEFT JOIN team_brands tb ON tb.team_id = gt.team_id AND _s.year BETWEEN tb.year_start AND tb.year_end
      WHERE gt.game_id = ANY($1::int[]) ORDER BY gt.game_id, gt.color
    `, [gameIds]),
    pgDb.query(`
      SELECT gp.*, p.name AS player_name, p.image_url AS player_image_url
      FROM game_players gp JOIN players p ON p.id = gp.player_id
      WHERE gp.game_id = ANY($1::int[])
    `, [gameIds]),
    pgDb.query(`
      SELECT gp.game_id, gpr.game_player_id, gpr.rune_id, gpr.tree::text, gpr.slot
      FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      WHERE gp.game_id = ANY($1::int[])
      ORDER BY gpr.game_player_id, gpr.slot
    `, [gameIds]),
    pgDb.query(`
      SELECT gf.id AS frame_id, gf.game_id, gf.timestamp,
             gf.blue_team_id, gf.blue_gold, gf.blue_kills, gf.blue_towers,
             gf.blue_drakes, gf.blue_nashors, gf.blue_heralds,
             gf.blue_inhibitors, gf.blue_voidgrubs, gf.blue_atakhans,
             gf.red_team_id, gf.red_gold, gf.red_kills, gf.red_towers,
             gf.red_drakes, gf.red_nashors, gf.red_heralds,
             gf.red_inhibitors, gf.red_voidgrubs, gf.red_atakhans
      FROM game_frames gf
      WHERE gf.game_id = ANY($1::int[]) ORDER BY gf.game_id, gf.timestamp
    `, [gameIds]),
    pgDb.query(`
      SELECT gfp.frame_id, gfp.player_id, gfp.team_color, gfp.role,
             gfp.champion_id, gfp.kills, gfp.deaths, gfp.assists, gfp.cs, gfp.level
      FROM game_frame_players gfp
      JOIN game_frames gf ON gf.id = gfp.frame_id
      WHERE gf.game_id = ANY($1::int[])
    `, [gameIds]),
    pgDb.query(`
      SELECT ge.game_id, ge.type, ge.timestamp, ge.is_first,
             ge.killer_player_id, ge.killer_champion_id,
             ge.victim_player_id, ge.victim_champion_id,
             pk.name AS killer_name, pv.name AS victim_name,
             COALESCE(
               (SELECT json_agg(json_build_object('player_id', gea.player_id, 'champion_id', gea.champion_id))
                FROM game_event_assists gea WHERE gea.event_id = ge.id),
               '[]'::json
             ) AS assistants
      FROM game_events ge
      LEFT JOIN players pk ON pk.id = ge.killer_player_id
      LEFT JOIN players pv ON pv.id = ge.victim_player_id
      WHERE ge.game_id = ANY($1::int[]) ORDER BY ge.game_id, ge.timestamp
    `, [gameIds]),
    pgDb.query(`
      SELECT gpb.game_id, gpb.team_id, gpb.champion_id, gpb.pick_turn
      FROM game_picks_bans gpb
      WHERE gpb.game_id = ANY($1::int[]) AND gpb.type = 'ban'
      ORDER BY gpb.game_id, gpb.team_id, gpb.pick_turn
    `, [gameIds]),
  ]);

  // 3. Index batch results by game_id for O(1) lookup
  const teamsByGame = {};
  for (const t of allTeamRows) { (teamsByGame[t.game_id] ||= []).push(t); }
  const playersByGame = {};
  for (const p of allPlayerRows) { (playersByGame[p.game_id] ||= []).push(p); }
  const runesByPlayerKey = {};
  for (const r of allRuneRows) { (runesByPlayerKey[r.game_player_id] ||= []).push(r); }
  const framesByGame = {};
  for (const f of allFrameRows) { (framesByGame[f.game_id] ||= []).push(f); }
  const framePlayersByFrame = {};
  for (const fp of allFramePlayerRows) { (framePlayersByFrame[fp.frame_id] ||= []).push(fp); }
  const bansByGameTeam = {};
  for (const b of allBanRows) { const key = `${b.game_id}_${b.team_id}`; (bansByGameTeam[key] ||= []).push(b); }
  const eventsByGame = {};
  for (const e of allEventRows) { (eventsByGame[e.game_id] ||= []).push(e); }

  // 4. Process each game (pure in-memory, zero queries)
  const games = gameRows.map(game => {
    const teamRows = teamsByGame[game.id] || [];
    const teams = teamRows.map(t => ({
      id: t.team_id, name: t.name, acronym: t.acronym, image_url: t.image_url,
      color: t.color, kills: t.kills, gold_earned: t.gold_earned,
      tower_kills: t.tower_kills, inhibitor_kills: t.inhibitor_kills,
      baron_kills: t.baron_kills, herald_kills: t.herald_kills, dragon_kills: t.dragon_kills,
      elder_drake_kills: t.elder_drake_kills, voidgrub_kills: t.voidgrub_kills, atakhan_kills: t.atakhan_kills,
      first_blood: t.first_blood, first_tower: t.first_tower, first_dragon: t.first_dragon,
      first_baron: t.first_baron, first_herald: t.first_herald, first_inhibitor: t.first_inhibitor,
      bans: (bansByGameTeam[`${game.id}_${t.team_id}`] || []).map(b => {
        const ch = champMap[b.champion_id];
        return ch ? { id: b.champion_id, name: ch.name, image_url: ch.image_url }
                  : { id: b.champion_id, name: '?', image_url: null };
      }),
    }));

    const playerRows = playersByGame[game.id] || [];
    const players = playerRows.map(gp => {
      const champ = champMap[gp.champion_id];
      const items = (gp.items || []).map(iid => itemMap[iid] || { id: iid, name: '?', image_url: null });

      const summoner_spells = [];
      if (gp.spell_1_id) summoner_spells.push(spellMap[gp.spell_1_id] || { id: gp.spell_1_id, name: '?', image_url: null });
      if (gp.spell_2_id) summoner_spells.push(spellMap[gp.spell_2_id] || { id: gp.spell_2_id, name: '?', image_url: null });

      // Runes — from pre-fetched batch (zero queries)
      let runes_reforged = null;
      const runeRows = runesByPlayerKey[gp.id] || [];
      if (runeRows.length > 0) {
        const primaryPerks = [];
        const secondaryPerks = [];
        let keystone = null;
        for (const rr of runeRows) {
          const runeInfo = runeMap[rr.rune_id] || { id: rr.rune_id, name: '?', image_url: null };
          if (rr.tree === 'primary' && rr.slot === 0) keystone = runeInfo;
          else if (rr.tree === 'primary' && rr.slot >= 1 && rr.slot <= 3) primaryPerks.push(runeInfo);
          else if (rr.tree === 'secondary' && rr.slot >= 4 && rr.slot <= 5) secondaryPerks.push(runeInfo);
        }
        const primaryPath = runePathMap[gp.rune_primary_path_id] || null;
        const secondaryPath = runePathMap[gp.rune_secondary_path_id] || null;
        // Shards from game_player_runes slots 6-8
        let shards = null;
        const offenseRune = runeRows.find(r => r.slot === 6);
        const flexRune = runeRows.find(r => r.slot === 7);
        const defenseRune = runeRows.find(r => r.slot === 8);
        if (offenseRune || flexRune || defenseRune) {
          const toInfo = (rr) => rr ? (runeMap[rr.rune_id] || { id: rr.rune_id, name: '?', image_url: null }) : null;
          shards = {
            offense: toInfo(offenseRune),
            flex: toInfo(flexRune),
            defense: toInfo(defenseRune),
          };
          if (!shards.offense && !shards.flex && !shards.defense) shards = null;
        }
        runes_reforged = {
          primary_path: { id: primaryPath?.id || null, name: primaryPath?.name || null, image_url: primaryPath?.image_url || null, keystone, perks: primaryPerks },
          secondary_path: { id: secondaryPath?.id || null, name: secondaryPath?.name || null, image_url: secondaryPath?.image_url || null, perks: secondaryPerks },
          shards,
        };
      }

      return {
        player_id: gp.player_id, name: gp.player_name, team_id: gp.team_id, role: gp.role, level: gp.level,
        champion: champ
          ? { id: gp.champion_id, name: champ.name, image_url: champ.image_url }
          : { id: gp.champion_id, name: '?', image_url: null },
        kills: gp.kills, deaths: gp.deaths, assists: gp.assists,
        creep_score: gp.creep_score,
        minions_killed: gp.creep_score != null
          ? (gp.creep_score - (gp.kills_neutral_minions ?? 0))
          : (gp.minions_killed ?? 0),
        jungle_minions_killed: gp.kills_neutral_minions ?? 0,
        cs_at_14: gp.cs_at_14, cs_diff_at_14: gp.cs_diff_at_14,
        gold_earned: gp.gold_earned, gold_spent: gp.gold_spent, gold_percentage: gp.gold_percentage,
        total_damage: { dealt: gp.total_damage_dealt, dealt_to_champions: gp.total_damage_dealt_to_champions, taken: gp.total_damage_taken },
        physical_damage: { dealt: gp.physical_damage_dealt, dealt_to_champions: gp.physical_damage_dealt_to_champions, taken: gp.physical_damage_taken },
        magic_damage: { dealt: gp.magic_damage_dealt, dealt_to_champions: gp.magic_damage_dealt_to_champions, taken: gp.magic_damage_taken },
        true_damage: { dealt: gp.true_damage_dealt, dealt_to_champions: gp.true_damage_dealt_to_champions, taken: gp.true_damage_taken },
        total_heal: gp.total_heal, total_units_healed: gp.total_units_healed,
        total_time_crowd_control_dealt: gp.total_time_crowd_control_dealt,
        wards_placed: gp.wards_placed,
        wards: {
          placed: gp.wards_placed ?? 0,
          sight_wards_bought_in_game: gp.sight_wards_bought_in_game ?? 0,
          vision_wards_bought_in_game: gp.vision_wards_bought_in_game ?? 0,
        },
        kills_counters: {
          players: gp.kills_players, turrets: gp.kills_turrets, inhibitors: gp.kills_inhibitors,
          wards: gp.kills_wards, neutral_minions: gp.kills_neutral_minions,
          neutral_minions_enemy_jungle: gp.kills_neutral_minions_enemy_jungle,
          neutral_minions_team_jungle: gp.kills_neutral_minions_team_jungle,
        },
        largest_killing_spree: gp.largest_killing_spree, largest_multi_kill: gp.largest_multi_kill,
        largest_critical_strike: gp.largest_critical_strike,
        double_kills: gp.double_kills, triple_kills: gp.triple_kills,
        quadra_kills: gp.quadra_kills, penta_kills: gp.penta_kills,
        first_blood_kill: gp.first_blood_kill, first_blood_assist: gp.first_blood_assist,
        first_tower_kill: gp.first_tower_kill, first_tower_assist: gp.first_tower_assist,
        items, summoner_spells, runes_reforged,
      };
    });

    // Frames (with per-player CS data for the CS chart)
    const blueTeam = teams.find(t => t.color === 'blue');
    const redTeam = teams.find(t => t.color === 'red');
    const frames = (framesByGame[game.id] || []).map(f => {
      // Build players-by-role objects for blue/red from game_frame_players
      const fpRows = framePlayersByFrame[f.frame_id] || [];
      const bluePlayers = {}, redPlayers = {};
      for (const fp of fpRows) {
        const role = fp.role || 'unknown';
        const obj = { id: fp.player_id, cs: fp.cs ?? 0, kills: fp.kills, deaths: fp.deaths, assists: fp.assists, level: fp.level };
        if (fp.team_color === 'blue') bluePlayers[role] = obj;
        else redPlayers[role] = obj;
      }
      return {
        current_timestamp: f.timestamp,
        blue: { id: blueTeam?.id || f.blue_team_id, name: blueTeam?.name, acronym: blueTeam?.acronym,
                gold: f.blue_gold, kills: f.blue_kills, towers: f.blue_towers, drakes: f.blue_drakes,
                nashors: f.blue_nashors, heralds: f.blue_heralds, inhibitors: f.blue_inhibitors,
                voidgrubs: f.blue_voidgrubs, atakhans: f.blue_atakhans, players: bluePlayers },
        red:  { id: redTeam?.id || f.red_team_id, name: redTeam?.name, acronym: redTeam?.acronym,
                gold: f.red_gold, kills: f.red_kills, towers: f.red_towers, drakes: f.red_drakes,
                nashors: f.red_nashors, heralds: f.red_heralds, inhibitors: f.red_inhibitors,
                voidgrubs: f.red_voidgrubs, atakhans: f.red_atakhans, players: redPlayers },
      };
    });

    // Events from game_events table
    const playerLookup = new Map(playerRows.map(p => [p.player_id, p]));
    const events = (eventsByGame[game.id] || []).map(evt => {
      const killerChamp = champMap[evt.killer_champion_id];
      const victimChamp = champMap[evt.victim_champion_id];
      const killerTeamId = playerLookup.get(evt.killer_player_id)?.team_id;
      const side = killerTeamId === blueTeam?.id ? 'blue' : killerTeamId === redTeam?.id ? 'red' : null;
      const assists = (evt.assistants || []).map(a => {
        const aChamp = champMap[a.champion_id];
        const aPlayer = playerLookup.get(a.player_id);
        return { name: aPlayer?.player_name || null, champion: aChamp?.name || null,
                 champion_image: aChamp?.image_url || null };
      }).filter(a => a.name);

      return {
        type: evt.type, timestamp: evt.timestamp, is_first: evt.is_first ?? false, side,
        killer_name: evt.killer_name, killer_champion: killerChamp?.name || null,
        killer_champion_image: killerChamp?.image_url || null,
        victim_name: evt.victim_name, victim_champion: victimChamp?.name || null,
        victim_champion_image: victimChamp?.image_url || null,
        victim_type: evt.type?.includes('tower') ? 'tower' : evt.type?.includes('inhibitor') ? 'inhibitor'
                   : evt.type?.includes('drake') ? 'drake' : evt.type?.includes('baron') ? 'baron_nashor' : null,
        dragon_type: null, assists,
      };
    });

    const winnerTeam = teams.find(t => t.id === game.winner_id);
    const winner = winnerTeam ? { id: winnerTeam.id, name: winnerTeam.name, acronym: winnerTeam.acronym, image_url: winnerTeam.image_url } : null;

    return {
      id: game.id, position: game.position, length: game.length, finished: game.finished,
      winner, teams, players, begin_at: game.begin_at, end_at: game.end_at,
      detailed_stats: true, frames, events,
    };
  });

  // 5. Reorder opponents: blue side first (from game 1)
  let orderedOpponents = opponents;
  if (games.length > 0) {
    const g1Blue = games[0].teams?.find(t => t.color === 'blue');
    if (g1Blue) {
      const blueFirst = opponents.filter(o => o.team_id === g1Blue.id);
      const rest = opponents.filter(o => o.team_id !== g1Blue.id);
      orderedOpponents = [...blueFirst, ...rest];
    }
  }

  res.json({
    id: match.id, serie_id: match.serie_id,
    opponents: orderedOpponents.map(o => ({ opponent: { id: o.team_id, name: o.name, acronym: o.acronym, image_url: o.image_url }, score: o.score })),
    results: opponents.map(o => ({ team_id: o.team_id, score: o.score })),
    number_of_games: match.number_of_games, status: match.status,
    scheduled_at: match.scheduled_at, begin_at: match.begin_at,
    tournament: tourney ? { id: tourney.id, name: tourney.name, slug: tourney.slug } : null,
    games,
  });
}

export async function getMatchesPg(req, res) {
  const { league = 'LEC', year, split, stage } = req.query;

  // Resolve serie + stage
  const { serieId, stageParam } = await resolveSerie({ league, year, split, stage });
  if (!serieId) return res.json([]);
  const { sf: sfm, stageParams } = stageFilter(stageParam, 2, 'm');

  // Get ALL matches (finished + running + not_started) in one query
  const { rows: matches } = await pgDb.query(`
    SELECT m.id, m.status, m.number_of_games, m.scheduled_at, m.begin_at, m.winner_id,
           m.slug, m.name AS match_name, t.has_bracket
    FROM matches m
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.serie_id = $1 ${sfm} AND m.status IN ('finished','running','not_started')
    ORDER BY m.begin_at DESC
  `, [serieId, ...stageParams]);

  if (!matches.length) return res.json([]);
  const matchIds = matches.map(m => m.id);

  // Batch-fetch all opponents and games in parallel
  const [{ rows: allOpps }, { rows: allGames }] = await Promise.all([
    pgDb.query(`
      SELECT mo.match_id, mo.team_id, mo.result_score AS score, mo.side,
             COALESCE(tb.display_name, t.name) AS name, COALESCE(tb.display_acronym, t.acronym) AS acronym,
             COALESCE(tb.display_logo, t.dark_mode_image_url, t.image_url) AS image_url
      FROM match_opponents mo
      JOIN teams t ON t.id = mo.team_id
      JOIN matches m ON m.id = mo.match_id
      JOIN series _s ON _s.id = m.serie_id
      LEFT JOIN team_brands tb ON tb.team_id = mo.team_id AND _s.year BETWEEN tb.year_start AND tb.year_end
      WHERE mo.match_id = ANY($1::int[]) ORDER BY mo.match_id, mo.side
    `, [matchIds]),
    pgDb.query(`
      SELECT g.id, g.match_id, g.length, g.winner_id, g.position
      FROM games g WHERE g.match_id = ANY($1::int[]) ORDER BY g.match_id, g.position
    `, [matchIds]),
  ]);

  // Index by match_id
  const oppsByMatch = {};
  for (const o of allOpps) (oppsByMatch[o.match_id] ||= []).push(o);
  const gamesByMatch = {};
  for (const g of allGames) (gamesByMatch[g.match_id] ||= []).push(g);

  // Build team form data: for each scheduled match, show 3 matches before it
  // (finished → W/L, not_started → pending)
  const upcomingTeamIds = new Set();
  const upcomingMatches = [];
  for (const m of matches) {
    if (m.status !== 'finished') {
      upcomingMatches.push(m);
      const opps = oppsByMatch[m.id] || [];
      for (const o of opps) upcomingTeamIds.add(o.team_id);
    }
  }

  // Fetch ALL matches (finished + not_started) for these teams in this serie
  // so we can compute form relative to each scheduled match's date
  const teamMatchHistory = {}; // teamId → [{match_id, begin_at, status, winner_id, opp_acronym, opp_logo}]
  if (upcomingTeamIds.size > 0) {
    const teamIdArr = [...upcomingTeamIds];
    const { rows: historyRows } = await pgDb.query(`
      SELECT DISTINCT ON (mo.team_id, m.id)
             mo.team_id, m.id AS match_id, m.winner_id, m.begin_at, m.status,
             opp.team_id AS opp_team_id,
             COALESCE(tb2.display_acronym, t2.acronym) AS opp_acronym,
             COALESCE(tb2.display_logo, t2.dark_mode_image_url, t2.image_url) AS opp_logo
      FROM match_opponents mo
      JOIN matches m ON m.id = mo.match_id
      JOIN match_opponents opp ON opp.match_id = m.id AND opp.team_id != mo.team_id
      JOIN teams t2 ON t2.id = opp.team_id
      JOIN series _s ON _s.id = m.serie_id
      LEFT JOIN team_brands tb2 ON tb2.team_id = opp.team_id AND _s.year BETWEEN tb2.year_start AND tb2.year_end
      WHERE mo.team_id = ANY($1::int[]) AND m.serie_id = $2 AND m.status IN ('finished','not_started','running')
      ORDER BY mo.team_id, m.id, m.begin_at DESC
    `, [teamIdArr, serieId]);

    for (const r of historyRows) (teamMatchHistory[r.team_id] ||= []).push(r);
    // Sort each team's history by date ascending
    for (const rows of Object.values(teamMatchHistory)) {
      rows.sort((a, b) => new Date(a.begin_at) - new Date(b.begin_at));
    }
  }

  // Helper: get 3 matches before a given match for a team
  function getFormForTeam(teamId, matchId, matchDate) {
    const history = teamMatchHistory[teamId] || [];
    // Find matches that are before this match (by date, or same date but different id)
    const before = history.filter(h =>
      h.match_id !== matchId && new Date(h.begin_at) < new Date(matchDate)
    );
    // Take last 3 (most recent first)
    const last3 = before.slice(-3).reverse();
    return last3.map(h => ({
      status: h.status === 'finished' ? (h.winner_id === teamId ? 'win' : 'loss') : 'pending',
      opp_acronym: h.opp_acronym,
      opp_logo: h.opp_logo,
    }));
  }

  const result = matches.map(m => {
    const opps = oppsByMatch[m.id] || [];
    const gamesSummary = gamesByMatch[m.id] || [];

    // Use match_opponents.side ordering (side 1 = teamA, side 2 = teamB)
    const tA = opps[0] || {};
    const tB = opps[1] || {};

    const winnerOpp = opps.find(o => o.team_id === m.winner_id);
    const dateStr = m.begin_at ? new Date(m.begin_at).toISOString().split('T')[0] : '';

    const base = {
      id: m.id, matchid: m.id, status: m.status,
      number_of_games: m.number_of_games, best_of: m.number_of_games,
      scheduled_at: m.scheduled_at, date: m.begin_at, date_str: dateStr, begin_at: m.begin_at,
      winner_id: m.winner_id,
      winner: winnerOpp ? { id: winnerOpp.team_id, name: winnerOpp.name, acronym: winnerOpp.acronym } : null,
      match_label: m.has_bracket ? ((m.match_name || '').split(':')[0].trim() || deriveMatchLabel(m.slug, m.match_name)) : null,
      teamA: { id: tA.team_id, name: tA.name, abbr: tA.acronym, acronym: tA.acronym, logo_url: tA.image_url, score: tA.score },
      teamB: { id: tB.team_id, name: tB.name, abbr: tB.acronym, acronym: tB.acronym, logo_url: tB.image_url, score: tB.score },
      teams: opps.map(o => ({ id: o.team_id, name: o.name, abbr: o.acronym, acronym: o.acronym, logo_url: o.image_url, image_url: o.image_url })),
      opponents: opps.map(o => ({ opponent: { id: o.team_id, name: o.name, acronym: o.acronym, image_url: o.image_url }, score: o.score })),
      results: opps.map(o => ({ team_id: o.team_id, score: o.score })),
      games: gamesSummary.map(g => ({
        id: g.id, length: g.length, position: g.position,
        winner: (() => { const wt = opps.find(o => o.team_id === g.winner_id); return wt ? { id: wt.team_id, name: wt.name, acronym: wt.acronym } : null; })(),
      })),
    };

    // Add form data for non-finished matches (relative to this match's date)
    if (m.status !== 'finished') {
      base.teamA.form = getFormForTeam(tA.team_id, m.id, m.begin_at || m.scheduled_at);
      base.teamB.form = getFormForTeam(tB.team_id, m.id, m.begin_at || m.scheduled_at);
    }

    return base;
  });

  res.json(result);
}
