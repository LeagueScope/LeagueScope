import { pgDb, ApiError, resolveLeagueId, getChampMap, getItemMap, getSpellMap, getRuneMap, rnd, mapRole, ensureArr } from './pgHelpers.js';

export async function getPlayerHistoryPg(req, res) {
  const { name } = req.params;
  const { league: leagueHint = 'LEC', page, perPage } = req.query;
  const needle = decodeURIComponent(name);
  const pageNum = parseInt(page) || 0;
  const pageSize = parseInt(perPage) || 0;  // 0 = no pagination (load all)

  // 1. Find player (try exact name, slug, or slug-ified version of the input)
  const slugified = needle.toLowerCase().replace(/\s+/g, '-');
  const { rows: playerRows } = await pgDb.query(`
    SELECT p.id, p.name, p.slug, p.image_url, p.nationality,
           p.role::text AS role, p.current_team_id,
           t.name AS current_team, t.acronym AS current_team_abbr,
           COALESCE(t.dark_mode_image_url, t.image_url) AS current_team_logo
    FROM players p
    LEFT JOIN teams t ON t.id = p.current_team_id
    WHERE LOWER(p.name) = LOWER($1)
       OR LOWER(p.slug) = LOWER($1)
       OR LOWER(p.slug) = $2
       OR LOWER(REPLACE(p.name, ' ', '')) = LOWER(REPLACE($1, ' ', ''))
    LIMIT 1
  `, [needle, slugified]);

  if (!playerRows.length) return res.status(404).json({ error: 'Player not found' });
  const player = playerRows[0];
  const playerId = player.id;

  // 2. Career entries (pre-aggregated in player_career) — with optional pagination
  const paginationClause = pageSize > 0 ? `LIMIT $2 OFFSET $3` : '';
  const careerParams = pageSize > 0 ? [playerId, pageSize, (pageNum - 1) * pageSize] : [playerId];
  const { rows: careerRows } = await pgDb.query(`
    SELECT
      pc.*,
      s.year, s.season, s.full_name AS serie_name, s.winner_id AS serie_winner_id,
      l.name AS league_slug,
      COALESCE(tb.display_name, ct.name) AS team_name,
      COALESCE(tb.display_acronym, ct.acronym) AS team_abbr,
      COALESCE(tb.display_logo, ct.dark_mode_image_url, ct.image_url) AS team_logo,
      COUNT(*) OVER() AS total_entries
    FROM player_career pc
    JOIN series s ON s.id = pc.serie_id
    JOIN leagues l ON l.id = s.league_id
    LEFT JOIN teams ct ON ct.id = pc.team_id
    LEFT JOIN team_brands tb ON tb.team_id = pc.team_id AND s.year BETWEEN tb.year_start AND tb.year_end
    WHERE pc.player_id = $1
    ORDER BY s.year DESC, s.begin_at DESC
    ${paginationClause}
  `, careerParams);

  if (!careerRows.length) return res.status(404).json({ error: 'No career data' });
  const totalEntries = Number(careerRows[0]?.total_entries || careerRows.length);

  const serieIds = [...new Set(careerRows.map(c => c.serie_id))];
  const playerTeamIds = [...new Set(careerRows.map(c => c.team_id).filter(Boolean))];

  // 3. Load lookups + game data + runes + champion stats + standings + roles ALL IN PARALLEL
  const [
    [champs, items, spells, runes],
    { rows: gameRows },
    { rows: runeRows },
    { rows: champStatRows },
    { rows: standingsRows },
    { rows: roleRows },
  ] = await Promise.all([
    Promise.all([getChampMap(), getItemMap(), getSpellMap(), getRuneMap()]),
    pgDb.query(`
      SELECT
        gp.game_id, gp.champion_id, gp.kills, gp.deaths, gp.assists,
        gp.minions_killed, COALESCE(gp.kills_neutral_minions, 0) AS neutral_cs,
        gp.total_damage_dealt_to_champions AS dmg_dealt,
        gp.gold_earned, gp.gold_spent,
        gp.team_id AS player_team_id, gp.items, gp.spell_1_id, gp.spell_2_id,
        g.id AS gid, g.length, g.winner_id, g.begin_at, g.match_id, g.serie_id,
        gt_player.color AS side,
        COALESCE(opp_tb.display_acronym, opp_t.acronym) AS opp_abbr,
        COALESCE(opp_tb.display_name, opp_t.name) AS opp_name,
        COALESCE(opp_tb.display_logo, opp_t.dark_mode_image_url, opp_t.image_url) AS opp_logo,
        gt_team.kills AS team_kills
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_teams gt_player ON gt_player.game_id = g.id AND gt_player.team_id = gp.team_id
      JOIN game_teams gt_opp ON gt_opp.game_id = g.id AND gt_opp.team_id != gp.team_id
      JOIN teams opp_t ON opp_t.id = gt_opp.team_id
      JOIN series _s ON _s.id = g.serie_id
      LEFT JOIN team_brands opp_tb ON opp_tb.team_id = gt_opp.team_id AND _s.year BETWEEN opp_tb.year_start AND opp_tb.year_end
      JOIN game_teams gt_team ON gt_team.game_id = g.id AND gt_team.team_id = gp.team_id
      WHERE gp.player_id = $1 AND g.serie_id = ANY($2::int[])
        AND g.finished = true AND g.length > 60
      ORDER BY g.begin_at DESC
    `, [playerId, serieIds]),
    pgDb.query(`
      SELECT gp.game_id, gpr.rune_id, gpr.tree::text, gpr.slot
      FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = $1 AND g.serie_id = ANY($2::int[])
      ORDER BY gp.game_id, gpr.tree, gpr.slot
    `, [playerId, serieIds]),
    // Use pre-computed player_champion_stats instead of JS aggregation
    // Group by champion_name (not champion_id) to avoid duplicates from multiple pandascore aliases
    pgDb.query(`
      SELECT MIN(pcs.champion_id) AS champion_id, pcs.champion_name,
             SUM(pcs.games)::int AS games, SUM(pcs.wins)::int AS wins,
             SUM(pcs.games * pcs.kills_avg) AS total_kills,
             SUM(pcs.games * pcs.deaths_avg) AS total_deaths,
             SUM(pcs.games * pcs.assists_avg) AS total_assists
      FROM player_champion_stats pcs
      WHERE pcs.player_id = $1 AND pcs.serie_id = ANY($2::int[])
      GROUP BY pcs.champion_name
      ORDER BY SUM(pcs.games) DESC
    `, [playerId, serieIds]),
    // Tournament standings for placement
    pgDb.query(`
      SELECT ts.tournament_id, ts.team_id, ts.rank,
             t.serie_id, t.name AS tourn_name
      FROM tournament_standings ts
      JOIN tournaments t ON t.id = ts.tournament_id
      WHERE t.serie_id = ANY($1::int[]) AND ts.team_id = ANY($2::int[])
    `, [serieIds, playerTeamIds]).catch(() => ({ rows: [] })),
    // Most played role per serie (from actual game data, not player_career)
    pgDb.query(`
      SELECT g.serie_id, gp.role::text AS role, COUNT(*) AS cnt
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = $1 AND g.serie_id = ANY($2::int[])
        AND g.finished = true AND gp.role IS NOT NULL
      GROUP BY g.serie_id, gp.role
      ORDER BY g.serie_id, COUNT(*) DESC
    `, [playerId, serieIds]),
  ]);

  const runesByGame = {};
  for (const rr of runeRows) {
    if (!runesByGame[rr.game_id]) runesByGame[rr.game_id] = [];
    runesByGame[rr.game_id].push(rr);
  }

  // 5b. Build most-played role per serie from game_players (actual game data)
  const roleBySerie = {};
  for (const r of roleRows) {
    // roleRows is ordered by serie_id, cnt DESC — first row per serie is the most played
    if (!roleBySerie[r.serie_id]) roleBySerie[r.serie_id] = r.role;
  }

  // 5c. Compute placement per serie from tournament_standings
  const standingsBySerie = {};
  for (const st of standingsRows) {
    (standingsBySerie[`${st.serie_id}_${st.team_id}`] ||= []).push(st);
  }
  const placementBySerie = {};
  for (const pc of careerRows) {
    const sId = pc.serie_id;
    const tId = pc.team_id;
    if (!tId) continue;
    const standings = standingsBySerie[`${sId}_${tId}`] || [];
    let placement = null;

    // 1. Prefer playoff/finals tournament standing
    const priorityNames = ['playoffs', 'finals', 'grand final', 'bracket'];
    let best = null;
    for (const pn of priorityNames) {
      const found = standings.find(s => s.tourn_name?.toLowerCase().includes(pn));
      if (found) { best = found; break; }
    }
    if (!best && standings.length > 0) best = standings[standings.length - 1];
    if (best) placement = best.rank;

    // 2. Fallback: series winner_id
    if (!placement && pc.serie_winner_id === tId) placement = 1;

    if (placement) placementBySerie[sId] = placement;
  }

  // 6. Group games by serie_id for match_log building
  const gamesBySerie = {};
  for (const g of gameRows) {
    if (!gamesBySerie[g.serie_id]) gamesBySerie[g.serie_id] = [];
    gamesBySerie[g.serie_id].push(g);
  }

  // 7. Build career array
  const career = careerRows.map(pc => {
    const n = Number(pc.games || 0);
    const splitName = pc.serie_name || pc.season || `Serie ${pc.serie_id}`;
    const leagueSlug = (pc.league_slug || '').toUpperCase();

    // Build match_log for this serie
    const serieGames = gamesBySerie[pc.serie_id] || [];
    const match_log = serieGames.map(g => {
      const dur = (g.length || 1) / 60;
      const cs = (g.minions_killed || 0) + (g.neutral_cs || 0);
      const isWin = g.winner_id === g.player_team_id;
      const champInfo = champs[g.champion_id] || {};

      // Items (stored as INTEGER[] in PostgreSQL)
      const itemIds = (g.items || []).filter(Boolean);
      const itemList = itemIds.map(id => items[id] || { id, name: '?', image_url: null });

      // Spells
      const spellList = [];
      if (g.spell_1_id && spells[g.spell_1_id]) spellList.push(spells[g.spell_1_id]);
      if (g.spell_2_id && spells[g.spell_2_id]) spellList.push(spells[g.spell_2_id]);

      // Runes
      const gameRunes = runesByGame[g.game_id] || [];
      let keystoneImg = null, keystoneName = null, secPathImg = null, secPathName = null;
      for (const rr of gameRunes) {
        const runeInfo = runes[rr.rune_id];
        if (!runeInfo) continue;
        if (rr.tree === 'primary' && rr.slot === 0) {
          keystoneImg = runeInfo.image_url;
          keystoneName = runeInfo.name;
        }
        if (rr.tree === 'secondary' && rr.slot === 0) {
          secPathImg = runeInfo.image_url;
          secPathName = runeInfo.name;
        }
      }

      // KDA
      const deaths = g.deaths || 0;
      const kda = deaths > 0 ? ((g.kills || 0) + (g.assists || 0)) / deaths : ((g.kills || 0) + (g.assists || 0));

      return {
        game_id: g.game_id,
        match_id: g.match_id,
        result: isWin ? 'W' : 'L',
        win: isWin,
        champion: {
          name: champInfo.name || `Champion ${g.champion_id}`,
          image_url: champInfo.image_url || null,
        },
        side: g.side || null,
        opponent: {
          name: g.opp_name || '—',
          abbr: g.opp_abbr || '—',
          logo: g.opp_logo || null,
        },
        kills: g.kills || 0,
        deaths: g.deaths || 0,
        assists: g.assists || 0,
        kda: rnd(kda),
        cspm: rnd(cs / Math.max(dur, 1), 1),
        dpm: rnd((g.dmg_dealt || 0) / Math.max(dur, 1)),
        gpm: rnd((g.gold_earned || 0) / Math.max(dur, 1)),
        runes: {
          keystone: keystoneName,
          keystone_img: keystoneImg,
          secondary_path: secPathName,
          secondary_path_img: secPathImg,
        },
        spells: spellList,
        items: itemList,
        date: g.begin_at || null,
      };
    });

    return {
      year: pc.year,
      split: splitName,
      league: leagueSlug,
      serie_id: pc.serie_id,
      role: mapRole(roleBySerie[pc.serie_id] || pc.role),  // most played role from actual games
      team: pc.team_name || '—',
      team_abbr: pc.team_abbr || '—',
      team_logo: pc.team_logo || null,
      games: n,
      wins: Number(pc.wins || 0),
      losses: Number(pc.losses || 0),
      win_rate: Number(pc.win_rate || 0),
      avg_kills: Number(pc.kills_avg || 0),
      avg_deaths: Number(pc.deaths_avg || 0),
      avg_assists: Number(pc.assists_avg || 0),
      kda: Number(pc.kda || 0),
      avg_cspm: Number(pc.cspm || 0),
      avg_gpm: Number(pc.gpm || 0),
      avg_dpm: Number(pc.dpm || 0),
      avg_vspm: Number(pc.avg_vspm || 0),
      kill_participation: Number(pc.kill_participation || 0),
      avg_damage_share: Number(pc.dmg_share || 0),
      avg_gold_share: Number(pc.gold_share || 0),
      unique_champions: Number(pc.unique_champions || 0),
      match_log,
      placement: placementBySerie[pc.serie_id] ?? null,
      is_winner: (placementBySerie[pc.serie_id] === 1) || (pc.serie_winner_id === pc.team_id),
    };
  });

  // 8. Build allChampions from pre-computed player_champion_stats
  const allChampions = champStatRows.map(c => {
    const g = Number(c.games || 0);
    const w = Number(c.wins || 0);
    const k = Number(c.total_kills || 0);
    const d = Number(c.total_deaths || 0);
    const a = Number(c.total_assists || 0);
    const champInfo = champs[c.champion_id] || {};
    return {
      name: c.champion_name || champInfo.name || `champ_${c.champion_id}`,
      image_url: champInfo.image_url || null,
      games: g, wins: w,
      kills: k, deaths: d, assists: a,
      win_rate: g > 0 ? rnd(w / g * 100, 1) : 0,
      kda: d > 0 ? rnd((k + a) / d) : rnd(k + a),
      avg_kills: g > 0 ? rnd(k / g, 1) : 0,
      avg_deaths: g > 0 ? rnd(d / g, 1) : 0,
      avg_assists: g > 0 ? rnd(a / g, 1) : 0,
    };
  });

  // 9. Compute career totals for profile
  const totals = career.reduce((acc, s) => ({
    games: acc.games + s.games,
    wins: acc.wins + s.wins,
    losses: acc.losses + s.losses,
    kills: acc.kills + (s.avg_kills * s.games),
    deaths: acc.deaths + (s.avg_deaths * s.games),
    assists: acc.assists + (s.avg_assists * s.games),
  }), { games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 });

  // Use latest career role (careerRows[0] is most recent due to ORDER BY year DESC)
  // Use most-played role from latest serie's actual game data
  const latestSerieId = careerRows.length > 0 ? careerRows[0].serie_id : null;
  const latestRole = latestSerieId && roleBySerie[latestSerieId]
    ? mapRole(roleBySerie[latestSerieId])
    : mapRole(player.role);

  const profile = {
    name: player.name,
    slug: player.slug,
    image_url: player.image_url,
    nationality: player.nationality,
    role: latestRole,
    current_team: player.current_team,
    current_team_abbr: player.current_team_abbr,
    current_team_logo: player.current_team_logo,
    career_games: totals.games,
    career_wins: totals.wins,
    career_losses: totals.losses,
    career_wr: totals.games > 0 ? rnd(totals.wins / totals.games * 100, 1) : 0,
    career_kda: totals.deaths > 0 ? rnd((totals.kills + totals.assists) / totals.deaths) : 0,
    career_avg_kills: totals.games > 0 ? rnd(totals.kills / totals.games, 1) : 0,
    career_avg_deaths: totals.games > 0 ? rnd(totals.deaths / totals.games, 1) : 0,
    career_avg_assists: totals.games > 0 ? rnd(totals.assists / totals.games, 1) : 0,
    seasons_played: career.length,
    unique_champions: allChampions.length,
  };

  // 10. Recent games = match_log from the latest season
  const recentGames = career.length > 0 ? career[0].match_log : [];

  const response = { profile, career, allChampions, recentGames };
  if (pageSize > 0) {
    response.pagination = { page: pageNum, perPage: pageSize, total: totalEntries, totalPages: Math.ceil(totalEntries / pageSize) };
  }
  res.json(response);
}

export async function getTeamHistoryPg(req, res) {
  const identifier = decodeURIComponent(req.params.identifier || '');
  if (!identifier) throw new ApiError(400, 'Identificador de equipo requerido');
  const { page: tPage, perPage: tPerPage } = req.query;
  const tPageNum = parseInt(tPage) || 0;
  const tPageSize = parseInt(tPerPage) || 0;

  // 1. Resolve team (by acronym, name, slug, or id)
  const { rows: teamRows } = await pgDb.query(`
    SELECT id, name, acronym, slug, location, image_url, dark_mode_image_url
    FROM teams
    WHERE UPPER(acronym) = UPPER($1)
       OR UPPER(name)    = UPPER($1)
       OR slug           = $1
       OR id::text       = $1
    LIMIT 1
  `, [identifier]);

  if (!teamRows.length) throw new ApiError(404, `Equipo "${identifier}" no encontrado`);
  const team = teamRows[0];
  const teamId = team.id;

  // 2. Career entries (pre-aggregated in team_career) — with optional pagination
  const tPagClause = tPageSize > 0 ? `LIMIT $2 OFFSET $3` : '';
  const tCareerParams = tPageSize > 0 ? [teamId, tPageSize, (tPageNum - 1) * tPageSize] : [teamId];
  const { rows: careerRows } = await pgDb.query(`
    SELECT
      tc.*,
      s.year, s.season, s.full_name AS serie_name, s.winner_id AS serie_winner_id,
      l.name AS league_slug,
      COUNT(*) OVER() AS total_entries
    FROM team_career tc
    JOIN series s ON s.id = tc.serie_id
    JOIN leagues l ON l.id = s.league_id
    WHERE tc.team_id = $1
    ORDER BY s.year DESC, s.begin_at DESC
    ${tPagClause}
  `, tCareerParams);

  if (!careerRows.length) return res.status(404).json({ error: 'No career data' });
  const tTotalEntries = Number(careerRows[0]?.total_entries || careerRows.length);

  // 3. Fetch matches + roster IN PARALLEL (both depend on serieIds only)
  const serieIds = [...new Set(careerRows.map(c => c.serie_id))];

  const [{ rows: matchRows }, { rows: rosterRows }, { rows: standingsRows }] = await Promise.all([
    pgDb.query(`
      SELECT
        m.id AS match_id, m.name AS match_name, m.serie_id, m.match_type,
        m.number_of_games AS best_of, m.begin_at,
        m.winner_id AS match_winner_id,
        mo_us.result_score AS our_score, mo_opp.result_score AS opp_score,
        mo_opp.team_id AS opp_team_id,
        COALESCE(opp_tb.display_acronym, opp_t.acronym) AS opp_abbr,
        COALESCE(opp_tb.display_name, opp_t.name) AS opp_name,
        COALESCE(opp_tb.display_logo, opp_t.dark_mode_image_url, opp_t.image_url) AS opp_logo
      FROM matches m
      JOIN match_opponents mo_us  ON mo_us.match_id = m.id  AND mo_us.team_id = $1
      JOIN match_opponents mo_opp ON mo_opp.match_id = m.id AND mo_opp.team_id != $1
      JOIN teams opp_t ON opp_t.id = mo_opp.team_id
      JOIN series _s ON _s.id = m.serie_id
      LEFT JOIN team_brands opp_tb ON opp_tb.team_id = mo_opp.team_id AND _s.year BETWEEN opp_tb.year_start AND opp_tb.year_end
      WHERE m.serie_id = ANY($2::int[]) AND m.status = 'finished'
      ORDER BY m.begin_at DESC
    `, [teamId, serieIds]),
    pgDb.query(`
      SELECT DISTINCT ON (s.id, p.id)
        s.id AS serie_id, s.year, s.season AS split, l.name AS league_slug,
        p.id AS player_id, p.name AS player_name, p.image_url AS player_image,
        p.nationality, COALESCE(pc.role, tr.role::text) AS role
      FROM tournament_rosters tr
      JOIN tournaments t ON t.id = tr.tournament_id
      JOIN series s ON s.id = t.serie_id
      JOIN leagues l ON l.id = s.league_id
      JOIN players p ON p.id = tr.player_id
      LEFT JOIN player_career pc ON pc.player_id = tr.player_id AND pc.serie_id = s.id
      WHERE tr.team_id = $1 AND s.id = ANY($2::int[])
      ORDER BY s.id, p.id
    `, [teamId, serieIds]),
    // Tournament standings for placement
    pgDb.query(`
      SELECT ts.tournament_id, ts.team_id, ts.rank,
             t.serie_id, t.name AS tourn_name
      FROM tournament_standings ts
      JOIN tournaments t ON t.id = ts.tournament_id
      WHERE t.serie_id = ANY($1::int[]) AND ts.team_id = $2
    `, [serieIds, teamId]).catch(() => ({ rows: [] })),
  ]);

  // Group matches by serie
  const matchesBySerie = {};
  for (const m of matchRows) {
    (matchesBySerie[m.serie_id] ||= []).push(m);
  }

  // Build rivals from individual games (not matches) for consistent counting with career_games
  const { rows: rivalGameRows } = await pgDb.query(`
    SELECT
      COALESCE(opp_tb.display_acronym, opp_t.acronym) AS opp_abbr,
      COALESCE(opp_tb.display_name, opp_t.name) AS opp_name,
      COALESCE(opp_tb.display_logo, opp_t.dark_mode_image_url, opp_t.image_url) AS opp_logo,
      COUNT(*) AS games,
      SUM(CASE WHEN g.winner_id = $1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN g.winner_id != $1 THEN 1 ELSE 0 END) AS losses
    FROM game_teams gt
    JOIN games g ON g.id = gt.game_id
    JOIN game_teams opp_gt ON opp_gt.game_id = g.id AND opp_gt.team_id != $1
    JOIN teams opp_t ON opp_t.id = opp_gt.team_id
    JOIN series _s2 ON _s2.id = g.serie_id
    LEFT JOIN team_brands opp_tb ON opp_tb.team_id = opp_gt.team_id AND _s2.year BETWEEN opp_tb.year_start AND opp_tb.year_end
    WHERE gt.team_id = $1 AND g.serie_id = ANY($2::int[]) AND g.finished = true AND g.length > 60
    GROUP BY opp_tb.display_acronym, opp_t.acronym, opp_tb.display_name, opp_t.name, opp_tb.display_logo, opp_t.dark_mode_image_url, opp_t.image_url
    ORDER BY COUNT(*) DESC
  `, [teamId, serieIds]);

  const rivals = rivalGameRows.map(r => ({
    name: r.opp_name,
    abbr: r.opp_abbr,
    logo: r.opp_logo,
    games: Number(r.games),
    wins: Number(r.wins),
    losses: Number(r.losses),
    wr: r.games > 0 ? rnd(r.wins / r.games * 100, 1) : 0,
  }));

  // Group roster by serie
  const rosterBySerie = {};
  for (const r of rosterRows) {
    if (!rosterBySerie[r.serie_id]) rosterBySerie[r.serie_id] = {
      year: r.year, split: r.split, league: (r.league_slug || '').toUpperCase(), roster: []
    };
    rosterBySerie[r.serie_id].roster.push({
      name: r.player_name,
      image_url: r.player_image,
      nationality: r.nationality,
      role: r.role,
    });
  }
  const rosterTimeline = Object.values(rosterBySerie).sort((a, b) => b.year - a.year);

  // 5b. Compute placement per serie from tournament_standings
  const placementBySerie = {};

  // Group standings rows by serie_id
  const standingsBySerie = {};
  for (const st of standingsRows) {
    (standingsBySerie[st.serie_id] ||= []).push(st);
  }

  for (const sId of serieIds) {
    const standings = standingsBySerie[sId] || [];
    let placement = null;

    // 1. Prefer playoff/finals tournament standing
    const priorityNames = ['playoffs', 'finals', 'grand final', 'bracket'];
    let best = null;
    for (const pn of priorityNames) {
      const found = standings.find(s => s.tourn_name?.toLowerCase().includes(pn));
      if (found) { best = found; break; }
    }
    // Fallback to any standing (last one)
    if (!best && standings.length > 0) best = standings[standings.length - 1];

    if (best) placement = best.rank;

    // 2. Grand Final match override (fix PandaScore double-elim misranking)
    const serieMatches = matchesBySerie[sId] || [];
    let finalMatch = null;
    for (const m of serieMatches) {
      const mName = (m.match_name || '').toLowerCase();
      if (mName.includes('grand final')) { finalMatch = m; break; }
      if (/\bfinal\b/.test(mName) && !mName.includes('semifinal') && !mName.includes('quarterfinal')
          && !mName.includes('upper bracket') && !mName.includes('lower bracket')) {
        finalMatch = m;
      }
    }
    if (finalMatch && finalMatch.match_winner_id) {
      if (finalMatch.match_winner_id === teamId) {
        placement = 1;
      } else {
        // Team was in the final (we have the match in our serieMatches) but lost
        placement = 2;
      }
    }

    // 3. Fallback: series winner_id
    if (!placement) {
      const careerEntry = careerRows.find(c => c.serie_id === sId);
      if (careerEntry && careerEntry.serie_winner_id === teamId) placement = 1;
    }

    if (placement) placementBySerie[sId] = placement;
  }

  // 6. Build career array
  const career = careerRows.map(tc => {
    const n = Number(tc.games || 0);
    const wins = Number(tc.wins || 0);
    const losses = Number(tc.losses || 0);
    const splitName = tc.serie_name || tc.season || `Serie ${tc.serie_id}`;
    const leagueSlug = (tc.league_slug || '').toUpperCase();

    const blueG = Number(tc.blue_games || 0);
    const blueW = Number(tc.blue_wins || 0);
    const redG = Number(tc.red_games || 0);
    const redW = Number(tc.red_wins || 0);

    // Match log for this serie
    const serieMatches = matchesBySerie[tc.serie_id] || [];
    const match_log = serieMatches.map(m => {
      const isWin = m.match_winner_id === teamId;
      return {
        match_id: m.match_id,
        match_name: m.match_name,
        result: isWin ? 'W' : 'L',
        score: `${m.our_score ?? 0}-${m.opp_score ?? 0}`,
        best_of: m.best_of || 1,
        date: m.begin_at,
        has_detail: true,
        opponent: {
          abbr: m.opp_abbr,
          name: m.opp_name,
          logo: m.opp_logo,
        },
      };
    });

    return {
      serie_id: tc.serie_id,
      year: tc.year,
      split: splitName,
      league: leagueSlug,
      games: n,
      wins,
      losses,
      win_rate: Number(tc.win_rate || 0),
      kda: Number(tc.kda || 0),
      avg_kills: Number(tc.kills_avg || 0),
      avg_deaths: Number(tc.deaths_avg || 0),
      avg_assists: Number(tc.assists_avg || 0),
      avg_towers: Number(tc.avg_towers || 0),
      avg_dragons: Number(tc.avg_dragons || 0),
      avg_barons: Number(tc.avg_barons || 0),
      avg_heralds: Number(tc.avg_heralds || 0),
      avg_game_length: Number(tc.avg_duration || 0),
      avg_gold: Number(tc.gpm || 0),
      blue_games: blueG,
      blue_wins: blueW,
      blue_wr: blueG > 0 ? rnd(blueW / blueG * 100, 1) : 0,
      red_games: redG,
      red_wins: redW,
      red_wr: redG > 0 ? rnd(redW / redG * 100, 1) : 0,
      placement: placementBySerie[tc.serie_id] ?? null,
      is_winner: (placementBySerie[tc.serie_id] === 1) || (tc.serie_winner_id === teamId),
      match_log,
    };
  });

  // 7. Build profile
  const totG = career.reduce((s, c) => s + c.games, 0);
  const totW = career.reduce((s, c) => s + c.wins, 0);
  const totL = career.reduce((s, c) => s + c.losses, 0);
  const totK = career.reduce((s, c) => s + (c.avg_kills * c.games), 0);
  const totD = career.reduce((s, c) => s + (c.avg_deaths * c.games), 0);
  const totA = career.reduce((s, c) => s + (c.avg_assists * c.games), 0);

  const profile = {
    id: teamId,
    name: team.name,
    acronym: team.acronym,
    image_url: team.image_url,
    dark_mode_image_url: team.dark_mode_image_url,
    location: team.location,
    slug: team.slug,
    career_games: totG,
    career_wins: totW,
    career_losses: totL,
    career_wr: totG > 0 ? rnd(totW / totG * 100, 1) : 0,
    career_kda: totD > 0 ? rnd((totK + totA) / totD) : 0,
    career_avg_kills: totG > 0 ? rnd(totK / totG, 1) : 0,
    career_avg_deaths: totG > 0 ? rnd(totD / totG, 1) : 0,
    career_avg_assists: totG > 0 ? rnd(totA / totG, 1) : 0,
    seasons_played: career.length,
    leagues_played: [...new Set(career.map(c => c.league))],
  };

  const tResponse = { profile, career, rosterTimeline, rivals };
  if (tPageSize > 0) {
    tResponse.pagination = { page: tPageNum, perPage: tPageSize, total: tTotalEntries, totalPages: Math.ceil(tTotalEntries / tPageSize) };
  }
  res.json(tResponse);
}
