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
        COALESCE(gp.creep_score, gp.minions_killed) AS cs,
        gp.total_damage_dealt_to_champions AS dmg_dealt,
        gp.gold_earned, gp.gold_spent,
        gp.team_id AS player_team_id, gp.items, gp.spell_1_id, gp.spell_2_id,
        gp.rune_primary_path_id, gp.rune_secondary_path_id,
        rp_pri.name AS rune_primary_path_name, rp_pri.image_url AS rune_primary_path_img,
        rp_sec.name AS rune_secondary_path_name, rp_sec.image_url AS rune_secondary_path_img,
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
      LEFT JOIN rune_paths rp_pri ON rp_pri.id = gp.rune_primary_path_id
      LEFT JOIN rune_paths rp_sec ON rp_sec.id = gp.rune_secondary_path_id
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
    // Champion stats: compute from game_players for accurate wins
    // Group by champion NAME (not ID) because PandaScore assigns different IDs across seasons
    pgDb.query(`
      SELECT MIN(gp.champion_id) AS champion_id,
             COALESCE(ca.name, 'champ_' || gp.champion_id) AS champion_name,
             COUNT(*)::int AS games,
             SUM(CASE WHEN g.winner_id = gp.team_id THEN 1 ELSE 0 END)::int AS wins,
             SUM(gp.kills)::numeric AS total_kills,
             SUM(gp.deaths)::numeric AS total_deaths,
             SUM(gp.assists)::numeric AS total_assists
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE gp.player_id = $1 AND g.serie_id = ANY($2::int[])
        AND g.finished = true AND g.length > 60
      GROUP BY COALESCE(ca.name, 'champ_' || gp.champion_id)
      ORDER BY COUNT(*) DESC
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
      const cs = g.cs || 0;
      const isWin = g.winner_id === g.player_team_id;
      const champInfo = champs[g.champion_id] || {};

      // Items (stored as INTEGER[] in PostgreSQL)
      const itemIds = (g.items || []).filter(Boolean);
      const itemList = itemIds.map(id => items[id] || { id, name: '?', image_url: null });

      // Spells
      const spellList = [];
      if (g.spell_1_id && spells[g.spell_1_id]) spellList.push(spells[g.spell_1_id]);
      if (g.spell_2_id && spells[g.spell_2_id]) spellList.push(spells[g.spell_2_id]);

      // Runes — keystone from game_player_runes, secondary path from game_players join
      const gameRunes = runesByGame[g.game_id] || [];
      let keystoneImg = null, keystoneName = null;
      for (const rr of gameRunes) {
        const runeInfo = runes[rr.rune_id];
        if (!runeInfo) continue;
        if (rr.tree === 'primary' && rr.slot === 0) {
          keystoneImg = runeInfo.image_url;
          keystoneName = runeInfo.name;
          break;
        }
      }
      const secPathImg = g.rune_secondary_path_img || null;
      const secPathName = g.rune_secondary_path_name || null;

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

    // Compute ONLY per-minute stats & KP from game data (player_career stores per-game totals, not per-minute)
    // Use player_career for games/wins/losses/kda/avg_k/avg_d/avg_a (correct from API, covers all games)
    const gCount = serieGames.length;
    let sumCspm = 0, sumDpm = 0, sumGpm = 0, sumKp = 0, kpCount = 0;
    for (const g of serieGames) {
      const dur = (g.length || 1) / 60;
      const cs = g.cs || 0;
      sumCspm += cs / Math.max(dur, 1);
      sumDpm  += (g.dmg_dealt || 0) / Math.max(dur, 1);
      sumGpm  += (g.gold_earned || 0) / Math.max(dur, 1);
      const teamK = Number(g.team_kills || 0);
      if (teamK > 0) {
        sumKp += ((g.kills || 0) + (g.assists || 0)) / teamK * 100;
        kpCount++;
      }
    }
    const calcCspm = gCount > 0 ? rnd(sumCspm / gCount, 1) : 0;
    const calcDpm  = gCount > 0 ? Math.round(sumDpm / gCount) : 0;
    const calcGpm  = gCount > 0 ? Math.round(sumGpm / gCount) : 0;
    const calcKp   = kpCount > 0 ? Math.round(sumKp / kpCount) : 0;

    return {
      year: pc.year,
      split: splitName,
      league: leagueSlug,
      serie_id: pc.serie_id,
      role: mapRole(roleBySerie[pc.serie_id] || pc.role),
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
      avg_cspm: calcCspm,
      avg_gpm: calcGpm,
      avg_dpm: calcDpm,
      avg_vspm: Number(pc.avg_vspm || 0),
      kill_participation: calcKp,
      avg_damage_share: Number(pc.dmg_share || 0),
      avg_gold_share: Number(pc.gold_share || 0),
      unique_champions: new Set(serieGames.map(g => champs[g.champion_id]?.name || g.champion_id)).size || Number(pc.unique_champions || 0),
      match_log,
      placement: placementBySerie[pc.serie_id] ?? null,
      is_winner: (placementBySerie[pc.serie_id] === 1) || (pc.serie_winner_id === pc.team_id),
    };
  });

  // 8. Build allChampions from game_players query (accurate wins from actual game results)
  const allChampions = champStatRows.map(c => {
    const g = Number(c.games || 0);
    const w = Number(c.wins || 0);
    const k = Number(c.total_kills || 0);
    const d = Number(c.total_deaths || 0);
    const a = Number(c.total_assists || 0);
    const champInfo = champs[c.champion_id] || {};
    return {
      name: champInfo.name || c.champion_name || `champ_${c.champion_id}`,
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

  // 8b. Profile add-ons (primary_league, international, best/worst split)
  // — mismo patrón que getTeamHistoryPg —

  // Primary league: la liga con más games en la carrera del jugador
  const leagueGamesP = {};
  for (const c of career) {
    leagueGamesP[c.league] = (leagueGamesP[c.league] || 0) + (c.games || 0);
  }
  const primarySlugP = Object.entries(leagueGamesP).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const primary_league = primarySlugP ? { slug: primarySlugP.toLowerCase(), name: primarySlugP } : null;

  // Best & Worst Split (min 10 games)
  const playableP = career.filter(c => (c.games || 0) >= 10);
  const sortedByWrP = [...playableP].sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0));
  const buildSplitP = (c) => c ? {
    serie_id: c.serie_id,
    league: c.league,
    year: c.year,
    split: c.split,
    games: c.games,
    wins: c.wins,
    losses: c.losses,
    win_rate: c.win_rate,
    placement: c.placement ?? null,
    team: c.team,
    team_abbr: c.team_abbr,
    team_logo: c.team_logo,
  } : null;
  const best_split  = buildSplitP(sortedByWrP[0]);
  const worst_split = sortedByWrP.length > 1 ? buildSplitP(sortedByWrP[sortedByWrP.length - 1]) : null;

  // International appearances (Worlds, MSI, EWC, First Stand, All-Star)
  const classifyIntlP = (leagueName) => {
    const lg = (leagueName || '').toUpperCase();
    if (lg.includes('WORLDS') || lg.includes('WORLD CHAMPIONSHIP')) return 'WORLDS';
    if (lg.includes('MSI') || lg.includes('MID-SEASON')) return 'MSI';
    if (lg.includes('EWC') || lg.includes('ESPORTS WORLD CUP')) return 'EWC';
    if (lg.includes('FIRSTSTAND') || lg.includes('FIRST STAND')) return 'FIRST STAND';
    if (lg.includes('ALLSTAR') || lg.includes('ALL-STAR') || lg.includes('ALL STAR')) return 'ALL-STAR';
    return null;
  };
  const INTL_ORDER_P = ['WORLDS', 'MSI', 'FIRST STAND', 'EWC', 'ALL-STAR'];
  const intlByLeagueP = {};
  for (const c of career) {
    const cls = classifyIntlP(c.league);
    if (!cls) continue;
    if (!intlByLeagueP[cls]) {
      intlByLeagueP[cls] = { league: cls, appearances: 0, best_placement: null, best_year: null };
    }
    intlByLeagueP[cls].appearances++;
    if (c.placement && (intlByLeagueP[cls].best_placement == null || c.placement < intlByLeagueP[cls].best_placement)) {
      intlByLeagueP[cls].best_placement = c.placement;
      intlByLeagueP[cls].best_year = c.year;
    }
  }
  const international = Object.values(intlByLeagueP).sort(
    (a, b) => INTL_ORDER_P.indexOf(a.league) - INTL_ORDER_P.indexOf(b.league)
  );

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
    primary_league,
    international,
    best_split,
    worst_split,
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
    // Roster: prioritize actual game role (most played in that serie) > tournament_rosters > player_career
    pgDb.query(`
      SELECT DISTINCT ON (s.id, p.id)
        s.id AS serie_id, s.year, s.season AS split, l.name AS league_slug,
        p.id AS player_id, p.name AS player_name, p.image_url AS player_image,
        p.nationality,
        COALESCE(gp_role.actual_role, tr.role::text, pc.role) AS role,
        COALESCE(gp_role.role_games, 0)::int AS role_games
      FROM tournament_rosters tr
      JOIN tournaments t ON t.id = tr.tournament_id
      JOIN series s ON s.id = t.serie_id
      JOIN leagues l ON l.id = s.league_id
      JOIN players p ON p.id = tr.player_id
      LEFT JOIN player_career pc ON pc.player_id = tr.player_id AND pc.serie_id = s.id
      LEFT JOIN LATERAL (
        SELECT gp.role::text AS actual_role, COUNT(*)::int AS role_games
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE gp.player_id = p.id AND g.serie_id = s.id AND gp.team_id = $1
          AND g.finished = true AND gp.role IS NOT NULL
        GROUP BY gp.role
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) gp_role ON true
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
      games: Number(r.role_games || 0),
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

  // 7. Profile add-ons (primary_league, international, best/worst split, iconic_lineup)

  // 7a. Primary league (la liga con más games en la carrera del equipo)
  const leagueGames = {};
  for (const c of career) {
    leagueGames[c.league] = (leagueGames[c.league] || 0) + c.games;
  }
  const primaryLeagueSlug = Object.entries(leagueGames).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const primary_league = primaryLeagueSlug
    ? { slug: primaryLeagueSlug.toLowerCase(), name: primaryLeagueSlug }
    : null;

  // 7b. Best & Worst split (min 10 games)
  const playableSplits = career.filter(c => c.games >= 10);
  const sortedByWr = [...playableSplits].sort((a, b) => b.win_rate - a.win_rate);
  const buildSplit = (c) => c ? {
    serie_id: c.serie_id,
    league: c.league,
    year: c.year,
    split: c.split,
    games: c.games,
    wins: c.wins,
    losses: c.losses,
    win_rate: c.win_rate,
    placement: c.placement,
  } : null;
  const best_split  = buildSplit(sortedByWr[0]);
  const worst_split = sortedByWr.length > 1 ? buildSplit(sortedByWr[sortedByWr.length - 1]) : null;

  // 7c. International appearances (con normalización de nombres reales en DB)
  const classifyIntl = (leagueName) => {
    const lg = (leagueName || '').toUpperCase();
    if (lg.includes('WORLDS') || lg.includes('WORLD CHAMPIONSHIP')) return 'WORLDS';
    if (lg.includes('MSI') || lg.includes('MID-SEASON')) return 'MSI';
    if (lg.includes('EWC') || lg.includes('ESPORTS WORLD CUP')) return 'EWC';
    if (lg.includes('FIRSTSTAND') || lg.includes('FIRST STAND')) return 'FIRST STAND';
    if (lg.includes('ALLSTAR') || lg.includes('ALL-STAR') || lg.includes('ALL STAR')) return 'ALL-STAR';
    return null;
  };
  const INTL_ORDER = ['WORLDS', 'MSI', 'FIRST STAND', 'EWC', 'ALL-STAR'];
  const intlByLeague = {};
  for (const c of career) {
    const cls = classifyIntl(c.league);
    if (!cls) continue;
    if (!intlByLeague[cls]) {
      intlByLeague[cls] = { league: cls, appearances: 0, best_placement: null, best_year: null };
    }
    intlByLeague[cls].appearances++;
    if (c.placement && (intlByLeague[cls].best_placement == null || c.placement < intlByLeague[cls].best_placement)) {
      intlByLeague[cls].best_placement = c.placement;
      intlByLeague[cls].best_year = c.year;
    }
  }
  const international = Object.values(intlByLeague).sort(
    (a, b) => INTL_ORDER.indexOf(a.league) - INTL_ORDER.indexOf(b.league)
  );

  // 7d. Iconic lineup (5 jugadores que más games han jugado juntos)
  let iconic_lineup = null;
  try {
    const { rows: iconicRows } = await pgDb.query(`
      WITH team_lineups AS (
        SELECT
          g.id AS game_id, g.winner_id, g.begin_at,
          MAX(CASE WHEN LOWER(gp.role) = 'top' THEN gp.player_id END) AS top_id,
          MAX(CASE WHEN LOWER(gp.role) IN ('jun','jungle','jng') THEN gp.player_id END) AS jng_id,
          MAX(CASE WHEN LOWER(gp.role) = 'mid' THEN gp.player_id END) AS mid_id,
          MAX(CASE WHEN LOWER(gp.role) IN ('adc','bot') THEN gp.player_id END) AS adc_id,
          MAX(CASE WHEN LOWER(gp.role) IN ('sup','support') THEN gp.player_id END) AS sup_id
        FROM games g
        JOIN game_players gp ON gp.game_id = g.id AND gp.team_id = $1
        WHERE g.finished = true AND g.length > 60
        GROUP BY g.id, g.winner_id, g.begin_at
      )
      SELECT
        top_id, jng_id, mid_id, adc_id, sup_id,
        COUNT(*)::int AS games,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END)::int AS wins,
        MIN(begin_at) AS first_game,
        MAX(begin_at) AS last_game
      FROM team_lineups
      WHERE top_id IS NOT NULL AND jng_id IS NOT NULL
        AND mid_id IS NOT NULL AND adc_id IS NOT NULL AND sup_id IS NOT NULL
      GROUP BY top_id, jng_id, mid_id, adc_id, sup_id
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `, [teamId]);

    if (iconicRows.length > 0) {
      const r = iconicRows[0];
      const ids = [r.top_id, r.jng_id, r.mid_id, r.adc_id, r.sup_id];
      const { rows: playerRows } = await pgDb.query(`
        SELECT id, name, image_url, nationality
        FROM players
        WHERE id = ANY($1::int[])
      `, [ids]);
      const byId = Object.fromEntries(playerRows.map(p => [p.id, p]));
      iconic_lineup = {
        players: [
          { role: 'TOP', ...byId[r.top_id] },
          { role: 'JNG', ...byId[r.jng_id] },
          { role: 'MID', ...byId[r.mid_id] },
          { role: 'ADC', ...byId[r.adc_id] },
          { role: 'SUP', ...byId[r.sup_id] },
        ],
        games: r.games,
        wins: r.wins,
        win_rate: r.games > 0 ? rnd(r.wins / r.games * 100, 1) : 0,
        first_game: r.first_game,
        last_game: r.last_game,
      };
    }
  } catch (e) {
    // Si la query falla por cualquier motivo, dejamos iconic_lineup en null y el frontend oculta la card
    console.warn('[getTeamHistoryPg] iconic_lineup query failed:', e.message);
  }

  // 8. Build profile
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
    primary_league,
    international,
    iconic_lineup,
    best_split,
    worst_split,
  };

  const tResponse = { profile, career, rosterTimeline, rivals };
  if (tPageSize > 0) {
    tResponse.pagination = { page: tPageNum, perPage: tPageSize, total: tTotalEntries, totalPages: Math.ceil(tTotalEntries / tPageSize) };
  }
  res.json(tResponse);
}
