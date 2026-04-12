#!/usr/bin/env node
/**
 * validate-data.js — Comprehensive data integrity checker for LeagueScope DB
 *
 * Checks:
 *   1. Reference data (rune_paths, runes, champions, items, spells)
 *   2. Games integrity (patch, length, winner, teams, players per game)
 *   3. Runes integrity (rune_primary/secondary_path_id, game_player_runes rows, FK validity)
 *   4. Events integrity (count per game, type distribution)
 *   5. Frames/frame_players integrity (frames per game, players per frame)
 *   6. Stats tables (team_career, player_career, champion_global_stats per serie)
 *   7. Picks/bans integrity
 *   8. Sample rune reconstruction (full runes_reforged for a random player)
 *
 * Usage:
 *   node scripts/validate-data.js
 *   node scripts/validate-data.js --serie-id 7585
 *   node scripts/validate-data.js --match-id 1402258
 *   node scripts/validate-data.js --league LEC
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const PG_DSN = process.env.PG_DSN || process.env.DATABASE_URL;
if (!PG_DSN) { console.error('PG_DSN not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: PG_DSN });

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const ARG_SERIE = getArg('serie-id') ? Number(getArg('serie-id')) : null;
const ARG_MATCH = getArg('match-id') ? Number(getArg('match-id')) : null;
const ARG_LEAGUE = getArg('league')?.toUpperCase();

// ── Colors ──
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', B = '\x1b[34m', C = '\x1b[36m';
const DIM = '\x1b[2m', BOLD = '\x1b[1m', RST = '\x1b[0m';

let criticals = 0, warnings = 0, goods = 0;

function critical(msg) { criticals++; console.log(`  ${R}✖ CRITICAL:${RST} ${msg}`); }
function warn(msg)     { warnings++;  console.log(`  ${Y}⚠ WARNING:${RST}  ${msg}`); }
function good(msg)     { goods++;     console.log(`  ${G}✔${RST} ${msg}`); }
function info(msg)     {              console.log(`  ${DIM}${msg}${RST}`); }
function section(title) { console.log(`\n${BOLD}${C}── ${title} ──${RST}`); }

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}  LEAGUESCOPE DATA INTEGRITY VALIDATOR${RST}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RST}`);

  // Resolve scope
  let serieFilter = '';
  let serieParams = [];
  let scopeLabel = 'ALL DATA';

  if (ARG_MATCH) {
    scopeLabel = `Match ${ARG_MATCH}`;
    info(`Scope: ${scopeLabel}`);
  } else if (ARG_SERIE) {
    serieFilter = 'AND g.serie_id = $1';
    serieParams = [ARG_SERIE];
    scopeLabel = `Serie ${ARG_SERIE}`;
    info(`Scope: ${scopeLabel}`);
  } else if (ARG_LEAGUE) {
    const leagueRows = await q(`
      SELECT s.id FROM series s JOIN leagues l ON l.id = s.league_id
      WHERE UPPER(l.name) = $1 ORDER BY s.begin_at DESC LIMIT 1
    `, [ARG_LEAGUE]);
    if (leagueRows.length) {
      serieFilter = 'AND g.serie_id = $1';
      serieParams = [leagueRows[0].id];
      scopeLabel = `League ${ARG_LEAGUE} (serie ${leagueRows[0].id})`;
    } else {
      console.error(`No series found for league ${ARG_LEAGUE}`);
      process.exit(1);
    }
    info(`Scope: ${scopeLabel}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. REFERENCE DATA
  // ═══════════════════════════════════════════════════════════════════
  section('1. REFERENCE DATA');

  const [runePaths, runes, champs, champAliases, items, spells] = await Promise.all([
    q('SELECT COUNT(*) AS c FROM rune_paths'),
    q('SELECT COUNT(*) AS c FROM runes'),
    q('SELECT COUNT(*) AS c FROM champions'),
    q('SELECT COUNT(*) AS c FROM champion_aliases'),
    q('SELECT COUNT(*) AS c FROM items'),
    q('SELECT COUNT(*) AS c FROM spells'),
  ]);

  const rpCount = Number(runePaths[0].c);
  const rCount = Number(runes[0].c);
  const chCount = Number(champs[0].c);
  const caCount = Number(champAliases[0].c);
  const iCount = Number(items[0].c);
  const spCount = Number(spells[0].c);

  if (rpCount === 5) good(`rune_paths: ${rpCount} (expected 5: Precision, Domination, Sorcery, Resolve, Inspiration)`);
  else if (rpCount === 0) critical(`rune_paths: 0 rows — run --static-only to populate`);
  else if (rpCount > 5) critical(`rune_paths: ${rpCount} rows (expected 5!) — TABLE IS POLLUTED with non-path entries. Fix: run --static-only to clean and repopulate.`);
  else warn(`rune_paths: ${rpCount} (expected 5)`);

  // Show actual rune_paths contents for diagnosis
  const pathNames = await q('SELECT id, name FROM rune_paths ORDER BY id LIMIT 10');
  info(`  rune_paths contents: ${pathNames.map(p => `${p.id}="${p.name}"`).join(', ')}${rpCount > 10 ? ` ... +${rpCount - 10} more` : ''}`);

  if (rCount >= 60) good(`runes: ${rCount} (expected ~63+)`);
  else if (rCount === 0) critical(`runes: 0 rows — run --static-only to populate`);
  else warn(`runes: ${rCount} (expected ~63+)`);

  // Check rune type distribution
  const runeTypes = await q('SELECT type::text, COUNT(*) AS c FROM runes GROUP BY type ORDER BY type');
  info(`  Rune types: ${runeTypes.map(r => `${r.type}=${r.c}`).join(', ')}`);

  if (chCount >= 100) good(`champions: ${chCount}`);
  else if (chCount === 0) critical('champions: 0 rows');
  else warn(`champions: ${chCount} (expected 100+)`);

  if (caCount >= 100) good(`champion_aliases: ${caCount}`);
  else if (caCount === 0) critical('champion_aliases: 0 rows');
  else warn(`champion_aliases: ${caCount}`);

  info(`items: ${iCount}, spells: ${spCount}`);

  // ═══════════════════════════════════════════════════════════════════
  // 2. GAMES INTEGRITY
  // ═══════════════════════════════════════════════════════════════════
  section('2. GAMES INTEGRITY');

  let gameFilter, gameParams;
  if (ARG_MATCH) {
    gameFilter = 'WHERE g.match_id = $1 AND g.finished = true';
    gameParams = [ARG_MATCH];
  } else {
    gameFilter = `WHERE g.finished = true ${serieFilter}`;
    gameParams = serieParams;
  }

  const games = await q(`SELECT COUNT(*) AS c FROM games g ${gameFilter}`, gameParams);
  const totalGames = Number(games[0].c);
  good(`Finished games in scope: ${totalGames}`);

  if (totalGames === 0) {
    warn('No finished games in scope — skipping game-level checks');
  } else {
    // Patch coverage
    const patchNull = await q(`SELECT COUNT(*) AS c FROM games g ${gameFilter} AND g.patch IS NULL`, gameParams);
    const patchNullCount = Number(patchNull[0].c);
    if (patchNullCount === 0) good('All games have patch');
    else if (patchNullCount === totalGames) critical(`ALL ${totalGames} games have patch=NULL`);
    else warn(`${patchNullCount}/${totalGames} games have patch=NULL (${(patchNullCount/totalGames*100).toFixed(1)}%)`);

    // Length coverage
    const lengthNull = await q(`SELECT COUNT(*) AS c FROM games g ${gameFilter} AND (g.length IS NULL OR g.length = 0)`, gameParams);
    const lengthNullCount = Number(lengthNull[0].c);
    if (lengthNullCount === 0) good('All games have length');
    else warn(`${lengthNullCount}/${totalGames} games have length=NULL or 0`);

    // Winner coverage
    const winnerNull = await q(`SELECT COUNT(*) AS c FROM games g ${gameFilter} AND g.winner_id IS NULL`, gameParams);
    const winnerNullCount = Number(winnerNull[0].c);
    if (winnerNullCount === 0) good('All finished games have winner_id');
    else critical(`${winnerNullCount}/${totalGames} finished games have winner_id=NULL`);

    // game_teams: should be 2 per game
    const teamCounts = await q(`
      SELECT gt_count, COUNT(*) AS games FROM (
        SELECT g.id, COUNT(gt.team_id) AS gt_count
        FROM games g
        LEFT JOIN game_teams gt ON gt.game_id = g.id
        ${gameFilter}
        GROUP BY g.id
      ) sub GROUP BY gt_count ORDER BY gt_count
    `, gameParams);
    const twoTeams = teamCounts.find(r => Number(r.gt_count) === 2);
    const notTwo = teamCounts.filter(r => Number(r.gt_count) !== 2);
    if (twoTeams) good(`${twoTeams.games}/${totalGames} games have 2 game_teams`);
    for (const r of notTwo) {
      if (Number(r.gt_count) === 0) critical(`${r.games} games have 0 game_teams`);
      else warn(`${r.games} games have ${r.gt_count} game_teams`);
    }

    // game_players: should be 10 per game
    const playerCounts = await q(`
      SELECT gp_count, COUNT(*) AS games FROM (
        SELECT g.id, COUNT(gp.id) AS gp_count
        FROM games g
        LEFT JOIN game_players gp ON gp.game_id = g.id
        ${gameFilter}
        GROUP BY g.id
      ) sub GROUP BY gp_count ORDER BY gp_count
    `, gameParams);
    const tenPlayers = playerCounts.find(r => Number(r.gp_count) === 10);
    const notTen = playerCounts.filter(r => Number(r.gp_count) !== 10);
    if (tenPlayers) good(`${tenPlayers.games}/${totalGames} games have 10 game_players`);
    for (const r of notTen) {
      if (Number(r.gp_count) === 0) critical(`${r.games} games have 0 game_players`);
      else warn(`${r.games} games have ${r.gp_count} game_players`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. RUNES INTEGRITY
  // ═══════════════════════════════════════════════════════════════════
  section('3. RUNES INTEGRITY');

  if (totalGames > 0) {
    // 3a. rune_primary_path_id / rune_secondary_path_id on game_players
    const pathNull = await q(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN gp.rune_primary_path_id IS NULL THEN 1 ELSE 0 END) AS primary_null,
        SUM(CASE WHEN gp.rune_secondary_path_id IS NULL THEN 1 ELSE 0 END) AS secondary_null,
        SUM(CASE WHEN gp.rune_shards IS NULL THEN 1 ELSE 0 END) AS shards_null
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      ${gameFilter}
    `, gameParams);
    const tp = Number(pathNull[0].total);
    const pn = Number(pathNull[0].primary_null);
    const sn = Number(pathNull[0].secondary_null);
    const shn = Number(pathNull[0].shards_null);

    if (pn === 0) good(`rune_primary_path_id: all ${tp} players have value`);
    else if (pn === tp) critical(`rune_primary_path_id: ALL ${tp} players are NULL`);
    else warn(`rune_primary_path_id: ${pn}/${tp} NULL (${(pn/tp*100).toFixed(1)}%)`);

    if (sn === 0) good(`rune_secondary_path_id: all ${tp} players have value`);
    else if (sn === tp) critical(`rune_secondary_path_id: ALL ${tp} players are NULL`);
    else warn(`rune_secondary_path_id: ${sn}/${tp} NULL (${(sn/tp*100).toFixed(1)}%)`);

    if (shn === 0) good(`rune_shards: all ${tp} players have value`);
    else if (shn === tp) critical(`rune_shards: ALL ${tp} players are NULL`);
    else warn(`rune_shards: ${shn}/${tp} NULL (${(shn/tp*100).toFixed(1)}%)`);

    // 3b. FK validity — do the rune_path IDs actually exist in rune_paths?
    const badPrimary = await q(`
      SELECT COUNT(*) AS c FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      ${gameFilter}
      AND gp.rune_primary_path_id IS NOT NULL
      AND gp.rune_primary_path_id NOT IN (SELECT id FROM rune_paths)
    `, gameParams);
    if (Number(badPrimary[0].c) === 0) good('rune_primary_path_id FK: all valid');
    else critical(`rune_primary_path_id FK: ${badPrimary[0].c} players point to non-existent rune_paths`);

    const badSecondary = await q(`
      SELECT COUNT(*) AS c FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      ${gameFilter}
      AND gp.rune_secondary_path_id IS NOT NULL
      AND gp.rune_secondary_path_id NOT IN (SELECT id FROM rune_paths)
    `, gameParams);
    if (Number(badSecondary[0].c) === 0) good('rune_secondary_path_id FK: all valid');
    else critical(`rune_secondary_path_id FK: ${badSecondary[0].c} players point to non-existent rune_paths`);

    // 3c. game_player_runes: how many rune rows per player?
    //     Expected: 9 per player (1 keystone + 3 primary + 2 secondary + 3 shards)
    //     But some older data may have 6 (no shards in game_player_runes, shards in JSONB)
    const runeCountDist = await q(`
      SELECT rune_count, COUNT(*) AS players FROM (
        SELECT gp.id, COUNT(gpr.rune_id) AS rune_count
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        LEFT JOIN game_player_runes gpr ON gpr.game_player_id = gp.id
        ${gameFilter}
        GROUP BY gp.id
      ) sub GROUP BY rune_count ORDER BY rune_count
    `, gameParams);

    info('game_player_runes distribution (runes per player):');
    for (const r of runeCountDist) {
      const cnt = Number(r.rune_count);
      const players = Number(r.players);
      const pct = (players / tp * 100).toFixed(1);
      if (cnt === 0) critical(`  ${cnt} runes: ${players} players (${pct}%) — MISSING ALL RUNES`);
      else if (cnt >= 6 && cnt <= 9) good(`  ${cnt} runes: ${players} players (${pct}%)`);
      else warn(`  ${cnt} runes: ${players} players (${pct}%) — unusual count`);
    }

    // 3d. FK validity — do rune_ids in game_player_runes exist in runes table?
    const badRuneFK = await q(`
      SELECT COUNT(*) AS c FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      JOIN games g ON g.id = gp.game_id
      ${gameFilter}
      AND gpr.rune_id NOT IN (SELECT id FROM runes)
    `, gameParams);
    if (Number(badRuneFK[0].c) === 0) good('game_player_runes FK: all rune_ids valid');
    else critical(`game_player_runes FK: ${badRuneFK[0].c} rows point to non-existent runes`);

    // 3e. Sample rune reconstruction for a random player
    const samplePlayer = await q(`
      SELECT gp.id, gp.game_id, gp.player_id, gp.champion_id,
             gp.rune_primary_path_id, gp.rune_secondary_path_id, gp.rune_shards,
             p.name AS player_name
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      JOIN players p ON p.id = gp.player_id
      ${gameFilter}
      AND gp.rune_primary_path_id IS NOT NULL
      ORDER BY g.id DESC LIMIT 1
    `, gameParams);

    if (samplePlayer.length > 0) {
      const sp = samplePlayer[0];
      info(`\nSample rune check: ${sp.player_name} (game_player ${sp.id}, game ${sp.game_id})`);

      const primaryPath = await q('SELECT * FROM rune_paths WHERE id = $1', [sp.rune_primary_path_id]);
      const secondaryPath = await q('SELECT * FROM rune_paths WHERE id = $1', [sp.rune_secondary_path_id]);
      info(`  Primary path: ${primaryPath[0]?.name || 'NOT FOUND'} (id=${sp.rune_primary_path_id})`);
      info(`  Secondary path: ${secondaryPath[0]?.name || 'NOT FOUND'} (id=${sp.rune_secondary_path_id})`);

      const playerRunes = await q(`
        SELECT gpr.slot, gpr.tree::text, gpr.rune_id, r.name AS rune_name, r.type::text, r.image_url
        FROM game_player_runes gpr
        LEFT JOIN runes r ON r.id = gpr.rune_id
        WHERE gpr.game_player_id = $1
        ORDER BY gpr.slot
      `, [sp.id]);

      if (playerRunes.length === 0) critical(`  game_player_runes: 0 rows for this player!`);
      else {
        good(`  game_player_runes: ${playerRunes.length} rows`);
        for (const r of playerRunes) {
          const hasImage = r.image_url ? 'img✔' : 'img✖';
          const nameOk = r.rune_name && r.rune_name !== '?' ? '✔' : '✖';
          info(`    slot ${r.slot}: [${r.tree}] ${r.rune_name || '???'} (id=${r.rune_id}, type=${r.type}, ${hasImage}, name${nameOk})`);
        }
      }

      // Check shards JSONB
      if (sp.rune_shards) {
        const shards = typeof sp.rune_shards === 'string' ? JSON.parse(sp.rune_shards) : sp.rune_shards;
        const shardKeys = Object.keys(shards).filter(k => shards[k]?.id);
        if (shardKeys.length >= 3) good(`  rune_shards JSONB: ${shardKeys.join(', ')} — all present`);
        else warn(`  rune_shards JSONB: only ${shardKeys.join(', ')} present (expected offense, flex, defense)`);
        info(`  Shards: ${JSON.stringify(shards)}`);
      } else {
        warn('  rune_shards: NULL on game_players');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. EVENTS INTEGRITY
  // ═══════════════════════════════════════════════════════════════════
  section('4. EVENTS INTEGRITY');

  if (totalGames > 0) {
    const eventCounts = await q(`
      SELECT ev_count, COUNT(*) AS games FROM (
        SELECT g.id, COUNT(ge.id) AS ev_count
        FROM games g
        LEFT JOIN game_events ge ON ge.game_id = g.id
        ${gameFilter}
        GROUP BY g.id
      ) sub GROUP BY ev_count ORDER BY ev_count
    `, gameParams);

    let gamesWithEvents = 0, gamesNoEvents = 0, lowEventGames = 0;
    for (const r of eventCounts) {
      const cnt = Number(r.ev_count);
      const games = Number(r.games);
      if (cnt === 0) gamesNoEvents += games;
      else if (cnt <= 10) lowEventGames += games;
      else gamesWithEvents += games;
    }

    if (gamesNoEvents === 0) good(`All ${totalGames} games have events`);
    else if (gamesNoEvents === totalGames) critical(`ALL ${totalGames} games have 0 events`);
    else warn(`${gamesNoEvents}/${totalGames} games have 0 events`);

    if (lowEventGames > 0) warn(`${lowEventGames} games have ≤10 events (likely buggy ingestion — expected 30-80+)`);
    if (gamesWithEvents > 0) good(`${gamesWithEvents} games have 10+ events`);

    // Event type distribution
    const typeDist = await q(`
      SELECT ge.type::text, COUNT(*) AS c
      FROM game_events ge
      JOIN games g ON g.id = ge.game_id
      ${gameFilter.replace('WHERE', 'WHERE ge.id IS NOT NULL AND')}
      GROUP BY ge.type ORDER BY c DESC
    `, gameParams);
    info('Event type distribution:');
    for (const r of typeDist) info(`  ${r.type}: ${r.c}`);

    // Events with NULL timestamp
    const nullTs = await q(`
      SELECT COUNT(*) AS c FROM game_events ge
      JOIN games g ON g.id = ge.game_id
      ${gameFilter.replace('WHERE', 'WHERE ge.id IS NOT NULL AND')}
      AND ge.timestamp IS NULL
    `, gameParams);
    if (Number(nullTs[0].c) === 0) good('All events have timestamp');
    else critical(`${nullTs[0].c} events have timestamp=NULL (dedup issue!)`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. FRAMES & FRAME_PLAYERS INTEGRITY
  // ═══════════════════════════════════════════════════════════════════
  section('5. FRAMES & FRAME_PLAYERS');

  if (totalGames > 0) {
    const frameCounts = await q(`
      SELECT fr_count, COUNT(*) AS games FROM (
        SELECT g.id, COUNT(gf.id) AS fr_count
        FROM games g
        LEFT JOIN game_frames gf ON gf.game_id = g.id
        ${gameFilter}
        GROUP BY g.id
      ) sub GROUP BY fr_count ORDER BY fr_count
    `, gameParams);

    let gamesWithFrames = 0, gamesNoFrames = 0;
    for (const r of frameCounts) {
      if (Number(r.fr_count) === 0) gamesNoFrames += Number(r.games);
      else gamesWithFrames += Number(r.games);
    }

    if (gamesNoFrames === 0) good(`All ${totalGames} games have frames`);
    else if (gamesNoFrames === totalGames) critical(`ALL ${totalGames} games have 0 frames`);
    else warn(`${gamesNoFrames}/${totalGames} games have 0 frames`);
    if (gamesWithFrames > 0) {
      const avgFrames = await q(`
        SELECT ROUND(AVG(cnt)) AS avg FROM (
          SELECT COUNT(*) AS cnt FROM game_frames gf
          JOIN games g ON g.id = gf.game_id
          ${gameFilter}
          GROUP BY g.id HAVING COUNT(*) > 0
        ) sub
      `, gameParams);
      info(`Avg frames per game (with frames): ${avgFrames[0]?.avg || '?'}`);
    }

    // Frame players per frame — should be 10
    const fpCounts = await q(`
      SELECT fp_count, COUNT(*) AS frames FROM (
        SELECT gf.id, COUNT(gfp.frame_id) AS fp_count
        FROM game_frames gf
        JOIN games g ON g.id = gf.game_id
        LEFT JOIN game_frame_players gfp ON gfp.frame_id = gf.id
        ${gameFilter}
        GROUP BY gf.id
      ) sub GROUP BY fp_count ORDER BY fp_count
    `, gameParams);

    let framesGood = 0, framesBad = 0;
    for (const r of fpCounts) {
      const cnt = Number(r.fp_count);
      const frames = Number(r.frames);
      if (cnt === 10) framesGood += frames;
      else {
        framesBad += frames;
        if (cnt === 0) info(`  ${frames} frames have 0 frame_players`);
        else info(`  ${frames} frames have ${cnt} frame_players`);
      }
    }
    if (framesGood > 0) good(`${framesGood} frames have 10 frame_players`);
    if (framesBad > 0) warn(`${framesBad} frames have ≠10 frame_players`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. STATS TABLES (team_career, player_career, champion_global_stats)
  // ═══════════════════════════════════════════════════════════════════
  section('6. STATS TABLES (team_career / player_career / champion_global_stats)');

  // Get all league serie mappings
  const leagueSeries = await q(`
    SELECT DISTINCT ON (UPPER(l.name))
      UPPER(l.name) AS slug, s.id AS serie_id, s.season
    FROM series s
    JOIN leagues l ON l.id = s.league_id
    ORDER BY UPPER(l.name), s.begin_at DESC
  `);

  const MAJOR = ['LEC', 'LCS', 'LCK', 'LPL'];
  const TIER3 = ['CBLOL', 'LCP', 'VCS', 'LJL', 'TCL'];

  for (const ls of leagueSeries) {
    const isMajor = MAJOR.includes(ls.slug);
    const isTier3 = TIER3.includes(ls.slug);
    if (!isMajor && !isTier3) continue; // skip tier4 for brevity

    const tc = await q('SELECT COUNT(*) AS c FROM team_career WHERE serie_id = $1', [ls.serie_id]);
    const pc = await q('SELECT COUNT(*) AS c FROM player_career WHERE serie_id = $1', [ls.serie_id]);
    const cgs = await q('SELECT COUNT(*) AS c FROM champion_global_stats WHERE serie_id = $1', [ls.serie_id]);

    const tcCount = Number(tc[0].c);
    const pcCount = Number(pc[0].c);
    const cgsCount = Number(cgs[0].c);
    const tier = isMajor ? 'MAJOR' : 'TIER3';

    if (tcCount === 0 && pcCount === 0 && cgsCount === 0) {
      critical(`${ls.slug} (${tier}, serie ${ls.serie_id}): ALL stats empty — team_career=0, player_career=0, champion_global_stats=0 → HOMEPAGE WILL HIDE THIS LEAGUE`);
    } else {
      const parts = [];
      if (tcCount > 0) parts.push(`team_career=${tcCount}`);
      else parts.push(`${R}team_career=0${RST}`);
      if (pcCount > 0) parts.push(`player_career=${pcCount}`);
      else parts.push(`${Y}player_career=0${RST}`);
      if (cgsCount > 0) parts.push(`champion_global_stats=${cgsCount}`);
      else parts.push(`${Y}champion_global_stats=0${RST}`);

      if (tcCount > 0 && cgsCount > 0) good(`${ls.slug} (${tier}, serie ${ls.serie_id}): ${parts.join(', ')}`);
      else warn(`${ls.slug} (${tier}, serie ${ls.serie_id}): ${parts.join(', ')} — partial stats`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. PICKS & BANS
  // ═══════════════════════════════════════════════════════════════════
  section('7. PICKS & BANS');

  if (totalGames > 0) {
    const pbCounts = await q(`
      SELECT pb_count, COUNT(*) AS games FROM (
        SELECT g.id, COUNT(pb.id) AS pb_count
        FROM games g
        LEFT JOIN game_picks_bans pb ON pb.game_id = g.id
        ${gameFilter}
        GROUP BY g.id
      ) sub GROUP BY pb_count ORDER BY pb_count
    `, gameParams);

    let gamesWithPB = 0, gamesNoPB = 0;
    for (const r of pbCounts) {
      if (Number(r.pb_count) === 0) gamesNoPB += Number(r.games);
      else gamesWithPB += Number(r.games);
    }

    if (gamesNoPB === 0) good(`All ${totalGames} games have picks/bans`);
    else warn(`${gamesNoPB}/${totalGames} games have 0 picks/bans`);
    if (gamesWithPB > 0) good(`${gamesWithPB} games have picks/bans data`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 8. KEY GAME_PLAYERS COLUMNS
  // ═══════════════════════════════════════════════════════════════════
  section('8. KEY GAME_PLAYERS COLUMNS');

  if (totalGames > 0) {
    const colChecks = [
      'kills', 'deaths', 'assists', 'gold_earned', 'cs',
      'largest_killing_spree', 'largest_multi_kill',
      'total_damage_to_champions', 'spell1_id', 'spell2_id',
    ];

    for (const col of colChecks) {
      const nullCount = await q(`
        SELECT COUNT(*) AS c FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        ${gameFilter}
        AND gp.${col} IS NULL
      `, gameParams);
      const nc = Number(nullCount[0].c);
      if (nc === 0) good(`${col}: all players have value`);
      else if (nc >= totalGames * 10 * 0.8) critical(`${col}: ${nc} NULL (${(nc/(totalGames*10)*100).toFixed(0)}%)`);
      else warn(`${col}: ${nc} NULL`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}  VALIDATION SUMMARY — ${scopeLabel}${RST}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════${RST}`);
  console.log(`  ${G}✔ Good:${RST}     ${goods}`);
  console.log(`  ${Y}⚠ Warnings:${RST} ${warnings}`);
  console.log(`  ${R}✖ Critical:${RST} ${criticals}`);

  if (criticals > 0) {
    console.log(`\n  ${R}${BOLD}ACTION REQUIRED:${RST} ${criticals} critical issue(s) found.`);
    console.log(`  Run the appropriate ingestion commands to fix.`);
  } else if (warnings > 0) {
    console.log(`\n  ${Y}Some warnings — review above for details.${RST}`);
  } else {
    console.log(`\n  ${G}${BOLD}ALL CHECKS PASSED!${RST}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
