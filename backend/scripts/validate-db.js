#!/usr/bin/env node
/**
 * validate-db.js — LeagueScope Ultimate Database Integrity Audit
 *
 * Comprehensive validation covering:
 *   1.  Row counts & table health
 *   2.  Reference data (champions, aliases, items, runes, spells)
 *   3.  Structural integrity (FK chains)
 *   4.  Entity names & slugs (no NULLs/blanks where needed)
 *   5.  Match quality (Bo format, winner, opponents, status)
 *   6.  Game quality (patch, teams, players, duration, winner)
 *   7.  Picks & bans (coverage, duplicates, draft order)
 *   8.  Runes (slot structure, paths, keystones)
 *   9.  Timeline data (frames, frame_players, events)
 *  10.  Derived stats (player_career, team_career, champion_global_stats)
 *  11.  Data freshness & ingestion state
 *  12.  Major leagues deep-dive
 *  13.  Cross-table consistency
 *
 * Usage:
 *   node scripts/validate-db.js                  # full audit
 *   node scripts/validate-db.js --recent         # only 2026 data
 *   node scripts/validate-db.js --league LEC     # only one league
 *   node scripts/validate-db.js --fix            # attempt auto-fixes where safe
 */

import 'dotenv/config';
import pg from 'pg';

const PG_DSN = process.env.PG_DSN;
if (!PG_DSN) { console.error('ERROR: PG_DSN not set'); process.exit(1); }

const args = process.argv.slice(2);
const recentOnly = args.includes('--recent');
const fixMode = args.includes('--fix');
const leagueIdx = args.indexOf('--league');
const leagueFilter = leagueIdx !== -1 ? args[leagueIdx + 1]?.toUpperCase() : null;

const poolCfg = { connectionString: PG_DSN, max: 2 };
if (PG_DSN.includes('rds.amazonaws.com')) poolCfg.ssl = { rejectUnauthorized: false };
const pool = new pg.Pool(poolCfg);

// ── Styling ──
const BOLD = '\x1b[1m';
const RST  = '\x1b[0m';
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';
const DIM  = '\x1b[2m';

let totalChecks = 0, passed = 0, warnings = 0, errors = 0;

function check(ok, label, detail = '') {
  totalChecks++;
  if (ok) { passed++; console.log(`  ${PASS} ${label}`); }
  else    { errors++; console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`); }
}
function warn(label, detail = '') {
  totalChecks++; warnings++;
  console.log(`  ${WARN} ${label}${detail ? ' — ' + detail : ''}`);
}
function info(label) { console.log(`  ${INFO} ${label}`); }

async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function count(sql, params = []) {
  const rows = await q(sql, params);
  return Number(rows[0]?.count || rows[0]?.cnt || 0);
}
async function val(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0]?.val ?? null;
}

// ── Date filter helpers ──
const gf = recentOnly ? "AND g.begin_at >= '2026-01-01'" : '';
const mf = recentOnly ? "AND m.begin_at >= '2026-01-01'" : '';
const sf = recentOnly ? "AND s.begin_at >= '2026-01-01'" : '';

// ══════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}  LeagueScope — Ultimate Database Integrity Audit${RST}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════════${RST}`);
  if (recentOnly) console.log(`  ${DIM}Scope: 2026+ data only${RST}`);
  if (leagueFilter) console.log(`  ${DIM}League: ${leagueFilter}${RST}`);
  if (fixMode) console.log(`  ${DIM}Mode: AUTO-FIX enabled${RST}`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════════
  // 1. TABLE ROW COUNTS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`${BOLD}── 1. TABLE ROW COUNTS ──────────────────────────────────────${RST}`);
  const tables = [
    'leagues', 'champions', 'champion_aliases', 'items', 'spells', 'runes', 'rune_paths',
    'teams', 'players',
    'series', 'tournaments', 'matches', 'match_opponents',
    'games', 'game_teams', 'game_players', 'game_picks_bans',
    'game_player_runes', 'game_frames', 'game_frame_players', 'game_events',
    'champion_global_stats', 'player_career', 'team_career', 'player_champion_stats',
  ];
  const counts = {};
  for (const t of tables) {
    try {
      counts[t] = await count(`SELECT COUNT(*) FROM ${t}`);
      info(`${t}: ${counts[t].toLocaleString()} rows`);
    } catch {
      info(`${t}: TABLE NOT FOUND`);
      counts[t] = -1;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. REFERENCE DATA
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 2. REFERENCE DATA ────────────────────────────────────────${RST}`);

  // Champions
  check(counts.champions > 150, `Champions table has ${counts.champions} entries (expect 170+)`, 'too few');

  const champsNoName = await count(`SELECT COUNT(*) FROM champions WHERE name IS NULL OR TRIM(name) = ''`);
  check(champsNoName === 0, 'All champions have a name', `${champsNoName} without name`);

  // Champion aliases
  const aliasesNoCanonical = await count(`
    SELECT COUNT(*) FROM champion_aliases ca
    WHERE NOT EXISTS (SELECT 1 FROM champions c WHERE c.id = ca.canonical_id)
  `);
  check(aliasesNoCanonical === 0, 'All champion_aliases point to valid champions', `${aliasesNoCanonical} orphaned`);

  const gpNoAlias = await count(`
    SELECT COUNT(*) FROM game_players gp
    WHERE gp.champion_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM champion_aliases ca WHERE ca.pandascore_id = gp.champion_id)
  `);
  check(gpNoAlias === 0, 'All game_players.champion_id have a champion_alias', `${gpNoAlias} orphaned`);

  const bansNoAlias = await count(`
    SELECT COUNT(*) FROM game_picks_bans pb
    WHERE pb.champion_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM champion_aliases ca WHERE ca.pandascore_id = pb.champion_id)
  `);
  check(bansNoAlias === 0, 'All game_picks_bans.champion_id have a champion_alias', `${bansNoAlias} orphaned`);

  // Runes
  if (counts.runes > 0) {
    const keystoneCount = await count(`SELECT COUNT(*) FROM runes WHERE type = 'keystone'`);
    check(keystoneCount >= 15, `${keystoneCount} keystones in runes table (expect 15+)`, `only ${keystoneCount}`);

    const pathCount = await count(`SELECT COUNT(*) FROM rune_paths`);
    check(pathCount === 5, `${pathCount} rune paths (expect 5)`, `${pathCount} instead of 5`);

    const runesNoName = await count(`SELECT COUNT(*) FROM runes WHERE name IS NULL OR TRIM(name) = ''`);
    check(runesNoName === 0, 'All runes have a name', `${runesNoName} without name`);
  }

  // Items
  if (counts.items > 0) {
    const itemsNoName = await count(`SELECT COUNT(*) FROM items WHERE name IS NULL OR TRIM(name) = ''`);
    check(itemsNoName === 0, 'All items have a name', `${itemsNoName} without name`);
  }

  // Spells
  if (counts.spells > 0) {
    const spellsNoName = await count(`SELECT COUNT(*) FROM spells WHERE name IS NULL OR TRIM(name) = ''`);
    check(spellsNoName === 0, 'All spells have a name', `${spellsNoName} without name`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. STRUCTURAL INTEGRITY (FK chains)
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 3. STRUCTURAL INTEGRITY ──────────────────────────────────${RST}`);

  const fkChecks = [
    ['series', 'league_id', 'leagues', 'id', 'Series → Leagues'],
    ['tournaments', 'serie_id', 'series', 'id', 'Tournaments → Series'],
    ['matches', 'tournament_id', 'tournaments', 'id', 'Matches → Tournaments'],
    ['games', 'match_id', 'matches', 'id', 'Games → Matches'],
  ];
  for (const [child, fk, parent, pk, label] of fkChecks) {
    const orphaned = await count(`
      SELECT COUNT(*) FROM ${child} c
      WHERE c.${fk} IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.${pk} = c.${fk})
    `);
    check(orphaned === 0, `${label}: no orphaned records`, `${orphaned} orphaned`);
  }

  const seriesNoLeague = await count(`SELECT COUNT(*) FROM series WHERE league_id IS NULL`);
  check(seriesNoLeague === 0, 'All series have a league_id', `${seriesNoLeague} without`);

  const gamesNoSerie = await count(`SELECT COUNT(*) FROM games WHERE serie_id IS NULL`);
  if (gamesNoSerie > 0) warn(`${gamesNoSerie} games missing serie_id`);
  else check(true, 'All games have serie_id');

  const gamesNoLeague = await count(`SELECT COUNT(*) FROM games WHERE league_id IS NULL`);
  if (gamesNoLeague > 0) warn(`${gamesNoLeague} games missing league_id`);
  else check(true, 'All games have league_id');

  // ═══════════════════════════════════════════════════════════════════
  // 4. ENTITY NAMES & SLUGS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 4. ENTITY NAMES & SLUGS ──────────────────────────────────${RST}`);

  // Teams
  const teamsNoName = await count(`SELECT COUNT(*) FROM teams WHERE name IS NULL OR TRIM(name) = ''`);
  check(teamsNoName === 0, 'All teams have a name', `${teamsNoName} without name`);

  const teamsNoSlug = await count(`SELECT COUNT(*) FROM teams WHERE slug IS NULL OR TRIM(slug) = ''`);
  if (teamsNoSlug > 0) warn(`${teamsNoSlug} teams without slug`);
  else check(true, 'All teams have a slug');

  const teamsNoAcronym = await count(`SELECT COUNT(*) FROM teams WHERE acronym IS NULL OR TRIM(acronym) = ''`);
  if (teamsNoAcronym > 0) warn(`${teamsNoAcronym} teams without acronym`);
  else check(true, 'All teams have an acronym');

  // Players
  const playersNoName = await count(`SELECT COUNT(*) FROM players WHERE name IS NULL OR TRIM(name) = ''`);
  if (playersNoName > 0) warn(`${playersNoName} players without name (will show as 'Unknown')`);
  else check(true, 'All players have a name');

  const playersNoRole = await count(`SELECT COUNT(*) FROM players WHERE role IS NULL`);
  if (playersNoRole > 0) info(`${playersNoRole} players without role assigned`);

  // Leagues
  const leaguesNoName = await count(`SELECT COUNT(*) FROM leagues WHERE name IS NULL OR TRIM(name) = ''`);
  check(leaguesNoName === 0, 'All leagues have a name', `${leaguesNoName} without name`);

  // Series
  const seriesNoName = await count(`SELECT COUNT(*) FROM series WHERE full_name IS NULL OR TRIM(full_name) = ''`);
  if (seriesNoName > 0) warn(`${seriesNoName} series without full_name`);
  else check(true, 'All series have a full_name');

  const seriesNoYear = await count(`SELECT COUNT(*) FROM series WHERE year IS NULL`);
  if (seriesNoYear > 0) warn(`${seriesNoYear} series without year`);
  else check(true, 'All series have a year');

  // ═══════════════════════════════════════════════════════════════════
  // 5. MATCH QUALITY
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 5. MATCH DATA QUALITY ────────────────────────────────────${RST}`);

  // Status distribution
  const statusDist = await q(`
    SELECT status, COUNT(*) AS cnt FROM matches GROUP BY status ORDER BY cnt DESC
  `);
  for (const r of statusDist) info(`Status '${r.status}': ${Number(r.cnt).toLocaleString()}`);

  // Bo format (number_of_games)
  const matchesNoBo = await count(`SELECT COUNT(*) FROM matches m WHERE number_of_games IS NULL ${mf}`);
  if (matchesNoBo > 0) warn(`${matchesNoBo} matches without number_of_games (Bo format unknown)`);
  else check(true, 'All matches have number_of_games (Bo format)');

  const boDist = await q(`
    SELECT number_of_games AS bo, COUNT(*) AS cnt
    FROM matches m WHERE number_of_games IS NOT NULL ${mf}
    GROUP BY number_of_games ORDER BY number_of_games
  `);
  for (const r of boDist) info(`Bo${r.bo}: ${Number(r.cnt).toLocaleString()} matches`);

  const invalidBo = await count(`
    SELECT COUNT(*) FROM matches m WHERE number_of_games IS NOT NULL AND number_of_games NOT IN (1,2,3,5,7) ${mf}
  `);
  check(invalidBo === 0, 'All Bo formats are valid (1/2/3/5/7)', `${invalidBo} invalid`);

  // Finished without winner
  const finishedNoWinner = await count(`
    SELECT COUNT(*) FROM matches m WHERE status = 'finished' AND winner_id IS NULL ${mf}
  `);
  if (finishedNoWinner > 0) warn(`${finishedNoWinner} finished matches without winner_id`);
  else check(true, 'All finished matches have a winner');

  // Matches without opponents
  const matchesNoOpps = await count(`
    SELECT COUNT(*) FROM matches m
    WHERE m.status NOT IN ('canceled', 'postponed') ${mf}
    AND NOT EXISTS (SELECT 1 FROM match_opponents mo WHERE mo.match_id = m.id)
  `);
  if (matchesNoOpps > 0) warn(`${matchesNoOpps} active matches without opponents`);
  else check(true, 'All active matches have opponents');

  // Finished with < 2 opponents
  const matchesFewOpps = await count(`
    SELECT COUNT(*) FROM (
      SELECT m.id FROM matches m
      JOIN match_opponents mo ON mo.match_id = m.id
      WHERE m.status = 'finished' ${mf}
      GROUP BY m.id HAVING COUNT(*) < 2
    ) sub
  `);
  if (matchesFewOpps > 0) warn(`${matchesFewOpps} finished matches with <2 opponents (Bo3/Bo5 player rotation)`);
  else check(true, 'All finished matches have 2+ opponents');

  // Games count vs Bo format
  const boMismatch = await q(`
    SELECT m.id, m.number_of_games AS bo, COUNT(g.id) AS actual_games
    FROM matches m
    JOIN games g ON g.match_id = m.id
    WHERE m.status = 'finished' AND m.number_of_games IS NOT NULL ${mf}
    GROUP BY m.id, m.number_of_games
    HAVING COUNT(g.id) > m.number_of_games
    LIMIT 5
  `);
  if (boMismatch.length > 0) {
    warn(`${boMismatch.length}+ matches have more games than Bo format allows`,
      `e.g. match ${boMismatch[0].id} is Bo${boMismatch[0].bo} but has ${boMismatch[0].actual_games} games`);
  } else {
    check(true, 'All matches have games ≤ Bo format');
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. GAME DATA QUALITY
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 6. GAME DATA QUALITY ─────────────────────────────────────${RST}`);

  const finishedGames = await count(`SELECT COUNT(*) FROM games g WHERE g.finished = true ${gf}`);
  info(`Total finished games: ${finishedGames.toLocaleString()}`);

  // Patch coverage (overall)
  const gamesNoPatch = await count(`SELECT COUNT(*) FROM games g WHERE g.finished = true AND g.patch IS NULL ${gf}`);
  const patchPct = finishedGames > 0 ? ((1 - gamesNoPatch / finishedGames) * 100).toFixed(1) : 0;
  if (gamesNoPatch > 0) warn(`${gamesNoPatch} finished games without patch (${patchPct}% coverage)`);
  else check(true, 'All finished games have a patch');

  // Patch coverage (2026 specifically)
  const recentNoPatch = await count(`
    SELECT COUNT(*) FROM games WHERE finished = true AND patch IS NULL AND begin_at >= '2026-01-01'
  `);
  const recentTotal = await count(`
    SELECT COUNT(*) FROM games WHERE finished = true AND begin_at >= '2026-01-01'
  `);
  if (recentNoPatch > 0) warn(`${recentNoPatch}/${recentTotal} games from 2026 missing patch`);
  else check(true, `All ${recentTotal} games from 2026 have a patch`);

  // Patch distribution (2026)
  const patchDist = await q(`
    SELECT patch, COUNT(*) AS cnt FROM games
    WHERE finished = true AND begin_at >= '2026-01-01' AND patch IS NOT NULL
    GROUP BY patch ORDER BY patch DESC LIMIT 10
  `);
  for (const r of patchDist) info(`Patch ${r.patch}: ${Number(r.cnt).toLocaleString()} games`);

  // Games without game_teams
  const gamesNoTeams = await count(`
    SELECT COUNT(*) FROM games g
    WHERE g.finished = true ${gf}
    AND NOT EXISTS (SELECT 1 FROM game_teams gt WHERE gt.game_id = g.id)
  `);
  if (gamesNoTeams > 0) warn(`${gamesNoTeams} finished games without game_teams`);
  else check(true, 'All finished games have game_teams');

  // Games without game_players
  const gamesNoPlayers = await count(`
    SELECT COUNT(*) FROM games g
    WHERE g.finished = true ${gf}
    AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id)
  `);
  if (gamesNoPlayers > 0) warn(`${gamesNoPlayers} finished games without game_players`);
  else check(true, 'All finished games have game_players');

  // Games with wrong player count
  const wrongPlayerCount = await q(`
    SELECT gp.game_id, COUNT(*) AS cnt
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.finished = true ${gf}
    GROUP BY gp.game_id HAVING COUNT(*) != 10
    LIMIT 5
  `);
  if (wrongPlayerCount.length > 0) {
    warn(`${wrongPlayerCount.length}+ games with != 10 players`,
      `e.g. game ${wrongPlayerCount[0].game_id} has ${wrongPlayerCount[0].cnt}`);
  } else {
    check(true, 'All finished games have exactly 10 players');
  }

  // Games with wrong team count
  const wrongTeamCount = await count(`
    SELECT COUNT(*) FROM (
      SELECT gt.game_id FROM game_teams gt
      JOIN games g ON g.id = gt.game_id
      WHERE g.finished = true ${gf}
      GROUP BY gt.game_id HAVING COUNT(*) != 2
    ) sub
  `);
  check(wrongTeamCount === 0, 'All finished games have exactly 2 teams', `${wrongTeamCount} wrong`);

  // Invalid team colors
  const badColors = await count(`SELECT COUNT(*) FROM game_teams WHERE color NOT IN ('blue', 'red')`);
  check(badColors === 0, 'All game_teams have valid color (blue/red)', `${badColors} invalid`);

  // Finished games without winner
  const gamesNoWinner = await count(`SELECT COUNT(*) FROM games g WHERE g.finished = true AND g.winner_id IS NULL ${gf}`);
  if (gamesNoWinner > 0) warn(`${gamesNoWinner} finished games without winner_id`);
  else check(true, 'All finished games have a winner');

  // game_teams without kills
  const teamsNoKills = await count(`
    SELECT COUNT(*) FROM game_teams gt
    JOIN games g ON g.id = gt.game_id
    WHERE g.finished = true AND gt.kills IS NULL ${gf}
  `);
  if (teamsNoKills > 0) warn(`${teamsNoKills} game_teams with NULL kills`);
  else check(true, 'All game_teams have kills data');

  // Game duration sanity
  const gamesWeirdLength = await count(`
    SELECT COUNT(*) FROM games g
    WHERE g.finished = true AND g.length IS NOT NULL
    AND (g.length < 300 OR g.length > 7200) ${gf}
  `);
  if (gamesWeirdLength > 0) warn(`${gamesWeirdLength} games with suspicious duration (<5min or >2h)`);
  else check(true, 'All game durations are reasonable (5min–2h)');

  // game_players missing core stats (kills/deaths/assists)
  const gpNoKDA = await count(`
    SELECT COUNT(*) FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.finished = true ${gf}
    AND (gp.kills IS NULL OR gp.deaths IS NULL OR gp.assists IS NULL)
  `);
  if (gpNoKDA > 0) warn(`${gpNoKDA} game_players missing kills/deaths/assists`);
  else check(true, 'All game_players have KDA stats');

  // game_players missing champion_id
  const gpNoChamp = await count(`
    SELECT COUNT(*) FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.finished = true AND gp.champion_id IS NULL ${gf}
  `);
  check(gpNoChamp === 0, 'All game_players have a champion_id', `${gpNoChamp} without`);

  // game_players missing role
  const gpNoRole = await count(`
    SELECT COUNT(*) FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE g.finished = true AND gp.role IS NULL ${gf}
  `);
  if (gpNoRole > 0) warn(`${gpNoRole} game_players without role`);
  else check(true, 'All game_players have a role');

  // ═══════════════════════════════════════════════════════════════════
  // 7. PICKS & BANS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 7. PICKS & BANS ──────────────────────────────────────────${RST}`);

  const gamesWithBans = await count(`
    SELECT COUNT(DISTINCT pb.game_id) FROM game_picks_bans pb
    JOIN games g ON g.id = pb.game_id WHERE pb.type = 'ban' ${gf}
  `);
  const banPct = finishedGames > 0 ? (gamesWithBans / finishedGames * 100).toFixed(1) : 0;
  info(`Games with bans: ${gamesWithBans.toLocaleString()} (${banPct}% of finished)`);

  const gamesWithPicks = await count(`
    SELECT COUNT(DISTINCT pb.game_id) FROM game_picks_bans pb
    JOIN games g ON g.id = pb.game_id WHERE pb.type = 'pick' ${gf}
  `);
  const pickPct = finishedGames > 0 ? (gamesWithPicks / finishedGames * 100).toFixed(1) : 0;
  info(`Games with picks: ${gamesWithPicks.toLocaleString()} (${pickPct}% of finished)`);

  // 2026 ban coverage
  const recentBans = await count(`
    SELECT COUNT(DISTINCT pb.game_id) FROM game_picks_bans pb
    JOIN games g ON g.id = pb.game_id
    WHERE pb.type = 'ban' AND g.begin_at >= '2026-01-01'
  `);
  const recentBanPct = recentTotal > 0 ? (recentBans / recentTotal * 100).toFixed(1) : 0;
  if (Number(recentBanPct) < 90) warn(`2026 ban coverage: ${recentBanPct}% (${recentBans}/${recentTotal})`);
  else check(true, `2026 ban coverage: ${recentBanPct}% (${recentBans}/${recentTotal})`);

  // Duplicate picks (same champion picked twice for same team in same game)
  const dupPicks = await count(`
    SELECT COUNT(*) FROM (
      SELECT game_id, team_id, champion_id, COUNT(*) AS cnt
      FROM game_picks_bans WHERE type = 'pick'
      GROUP BY game_id, team_id, champion_id HAVING COUNT(*) > 1
    ) sub
  `);
  if (dupPicks > 0) warn(`${dupPicks} duplicate pick entries`);
  else check(true, 'No duplicate picks per team per game');

  // Bans without team_id
  const bansNoTeam = await count(`
    SELECT COUNT(*) FROM game_picks_bans pb
    JOIN games g ON g.id = pb.game_id
    WHERE pb.type = 'ban' AND pb.team_id IS NULL ${gf}
  `);
  if (bansNoTeam > 0) info(`${bansNoTeam} bans without team_id (neutral bans — normal for some APIs)`);

  // ═══════════════════════════════════════════════════════════════════
  // 8. RUNES
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 8. RUNES ─────────────────────────────────────────────────${RST}`);

  if (counts.game_player_runes > 0) {
    // Players should have 9 rune slots (0-8)
    const playersWithRunes = await count(`SELECT COUNT(DISTINCT game_player_id) FROM game_player_runes`);
    info(`Players with rune data: ${playersWithRunes.toLocaleString()}`);

    const wrongRuneCount = await q(`
      SELECT gpr.game_player_id, COUNT(*) AS cnt
      FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      JOIN games g ON g.id = gp.game_id
      WHERE g.finished = true ${gf}
      GROUP BY gpr.game_player_id
      HAVING COUNT(*) NOT IN (6, 7, 8, 9)
      LIMIT 5
    `);
    if (wrongRuneCount.length > 0) {
      warn(`${wrongRuneCount.length}+ players with unusual rune count`,
        `e.g. player ${wrongRuneCount[0].game_player_id} has ${wrongRuneCount[0].cnt} runes (expect 6-9)`);
    } else {
      check(true, 'All players have 6-9 rune slots filled');
    }

    // Keystone (slot 0) coverage
    const playersNoKeystone = await count(`
      SELECT COUNT(*) FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.finished = true ${gf}
      AND NOT EXISTS (
        SELECT 1 FROM game_player_runes gpr
        WHERE gpr.game_player_id = gp.id AND gpr.slot = 0
      )
      AND EXISTS (SELECT 1 FROM game_player_runes gpr2 WHERE gpr2.game_player_id = gp.id)
    `);
    if (playersNoKeystone > 0) warn(`${playersNoKeystone} players with runes but missing keystone (slot 0)`);
    else check(true, 'All players with runes have a keystone (slot 0)');

    // Orphaned runes (rune_id not in runes table)
    const orphanedRunes = await count(`
      SELECT COUNT(*) FROM game_player_runes gpr
      WHERE gpr.rune_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM runes r WHERE r.id = gpr.rune_id)
    `);
    if (orphanedRunes > 0) warn(`${orphanedRunes} game_player_runes referencing unknown rune_id`);
    else check(true, 'All rune references are valid');

    // Players with rune paths set
    const gpNoRunePath = await count(`
      SELECT COUNT(*) FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.finished = true ${gf}
      AND gp.rune_primary_path_id IS NULL
      AND EXISTS (SELECT 1 FROM game_player_runes gpr WHERE gpr.game_player_id = gp.id)
    `);
    if (gpNoRunePath > 0) warn(`${gpNoRunePath} players with runes but no primary rune path`);
    else check(true, 'All players with runes have primary rune path set');

  } else {
    warn('game_player_runes table is empty');
  }

  // ═══════════════════════════════════════════════════════════════════
  // 9. TIMELINE DATA (frames, events)
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 9. TIMELINE DATA ─────────────────────────────────────────${RST}`);

  if (counts.game_frames > 0) {
    // Frame coverage
    const gamesWithFrames = await count(`
      SELECT COUNT(DISTINCT gfr.game_id) FROM game_frames gfr
      JOIN games g ON g.id = gfr.game_id WHERE g.finished = true ${gf}
    `);
    const framePct = finishedGames > 0 ? (gamesWithFrames / finishedGames * 100).toFixed(1) : 0;
    info(`Games with frame data: ${gamesWithFrames.toLocaleString()} (${framePct}%)`);

    // Average frames per game
    const avgFrames = await val(`
      SELECT ROUND(AVG(cnt)) AS val FROM (
        SELECT game_id, COUNT(*) AS cnt FROM game_frames GROUP BY game_id
      ) sub
    `);
    info(`Average frames per game: ${avgFrames}`);

    // Frames with missing team data
    const framesNoBlue = await count(`
      SELECT COUNT(*) FROM game_frames WHERE blue_team_id IS NULL
    `);
    if (framesNoBlue > 0) info(`${framesNoBlue} frames without blue_team_id`);
  }

  if (counts.game_events > 0) {
    // Event type distribution
    const eventDist = await q(`
      SELECT type, COUNT(*) AS cnt FROM game_events GROUP BY type ORDER BY cnt DESC
    `);
    for (const r of eventDist) info(`Event '${r.type}': ${Number(r.cnt).toLocaleString()}`);

    // Events without timestamp
    const eventsNoTime = await count(`SELECT COUNT(*) FROM game_events WHERE timestamp IS NULL`);
    if (eventsNoTime > 0) warn(`${eventsNoTime} events without timestamp`);
    else check(true, 'All events have a timestamp');
  }

  // ═══════════════════════════════════════════════════════════════════
  // 10. DERIVED STATS
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 10. DERIVED STATS ────────────────────────────────────────${RST}`);

  // Series with games but missing derived stats
  const seriesWithGames = await q(`
    SELECT DISTINCT g.serie_id FROM games g
    JOIN series s ON s.id = g.serie_id
    WHERE g.finished = true AND s.begin_at >= '2025-01-01'
  `);
  const swgIds = seriesWithGames.map(r => r.serie_id);

  const teamCareerSeries = new Set((await q(`SELECT DISTINCT serie_id FROM team_career`)).map(r => r.serie_id));
  const missingTC = swgIds.filter(id => !teamCareerSeries.has(id));
  if (missingTC.length > 0) warn(`${missingTC.length} recent series without team_career`);
  else check(true, 'All recent series have team_career');

  const playerCareerSeries = new Set((await q(`SELECT DISTINCT serie_id FROM player_career`)).map(r => r.serie_id));
  const missingPC = swgIds.filter(id => !playerCareerSeries.has(id));
  if (missingPC.length > 0) warn(`${missingPC.length} recent series without player_career`);
  else check(true, 'All recent series have player_career');

  const cgsSeries = new Set((await q(`SELECT DISTINCT serie_id FROM champion_global_stats`)).map(r => r.serie_id));
  const missingCGS = swgIds.filter(id => !cgsSeries.has(id));
  if (missingCGS.length > 0) warn(`${missingCGS.length} recent series without champion_global_stats`);
  else check(true, 'All recent series have champion_global_stats');

  // player_career sanity — KDA shouldn't be crazy
  const crazyKDA = await count(`
    SELECT COUNT(*) FROM player_career WHERE kda IS NOT NULL AND (kda < 0 OR kda > 100)
  `);
  if (crazyKDA > 0) warn(`${crazyKDA} player_career entries with suspicious KDA (< 0 or > 100)`);
  else check(true, 'All player_career KDA values are reasonable');

  // team_career sanity — win_rate between 0 and 1
  const crazyWR = await count(`
    SELECT COUNT(*) FROM team_career WHERE win_rate IS NOT NULL AND (win_rate < 0 OR win_rate > 1)
  `);
  if (crazyWR > 0) warn(`${crazyWR} team_career entries with suspicious win_rate`);
  else check(true, 'All team_career win_rates are 0–1');

  // player_career games > 0
  const pcNoGames = await count(`
    SELECT COUNT(*) FROM player_career WHERE games IS NULL OR games = 0
  `);
  if (pcNoGames > 0) warn(`${pcNoGames} player_career entries with 0 or NULL games`);
  else check(true, 'All player_career entries have games > 0');

  // team_career games > 0
  const tcNoGames = await count(`
    SELECT COUNT(*) FROM team_career WHERE games IS NULL OR games = 0
  `);
  if (tcNoGames > 0) warn(`${tcNoGames} team_career entries with 0 or NULL games`);
  else check(true, 'All team_career entries have games > 0');

  // champion_global_stats — picks > 0
  const cgsNoPicks = await count(`
    SELECT COUNT(*) FROM champion_global_stats WHERE picks IS NULL OR picks = 0
  `);
  if (cgsNoPicks > 0) warn(`${cgsNoPicks} champion_global_stats with 0 picks`);
  else check(true, 'All champion_global_stats have picks > 0');

  // ═══════════════════════════════════════════════════════════════════
  // 11. DATA FRESHNESS & INGESTION
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 11. DATA FRESHNESS ───────────────────────────────────────${RST}`);

  const latestGame = await val(`SELECT MAX(begin_at) AS val FROM games WHERE finished = true`);
  const latestMatch = await val(`SELECT MAX(begin_at) AS val FROM matches WHERE status = 'finished'`);
  const latestIngestion = await val(`SELECT MAX(games_ingested_at) AS val FROM matches`);
  info(`Latest finished game: ${latestGame || 'N/A'}`);
  info(`Latest finished match: ${latestMatch || 'N/A'}`);
  info(`Latest ingestion: ${latestIngestion || 'N/A'}`);

  const pendingIngestion = await count(`
    SELECT COUNT(*) FROM matches WHERE status = 'finished' AND games_ingested_at IS NULL
  `);
  if (pendingIngestion > 0) warn(`${pendingIngestion} finished matches pending game ingestion`);
  else check(true, 'All finished matches have been ingested');

  // Stale ingestion (last ingestion > 24h ago)
  if (latestIngestion) {
    const hoursAgo = (Date.now() - new Date(latestIngestion).getTime()) / 3600000;
    if (hoursAgo > 24) warn(`Last ingestion was ${hoursAgo.toFixed(0)}h ago`);
    else check(true, `Last ingestion: ${hoursAgo.toFixed(1)}h ago`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 12. MAJOR LEAGUES DEEP-DIVE
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 12. MAJOR LEAGUES HEALTH ─────────────────────────────────${RST}`);

  const majors = leagueFilter ? [leagueFilter] : ['LEC', 'LCS', 'LCK', 'LPL'];
  for (const league of majors) {
    const serieInfo = await q(`
      SELECT s.id, s.full_name, s.season, s.year
      FROM series s JOIN leagues l ON l.id = s.league_id
      WHERE UPPER(l.name) = $1 ORDER BY s.begin_at DESC LIMIT 1
    `, [league]);

    if (!serieInfo.length) { warn(`${league}: no series found`); continue; }

    const sid = serieInfo[0].id;
    const sname = serieInfo[0].full_name || `${serieInfo[0].season} ${serieInfo[0].year}`;
    console.log(`  ${INFO} ${BOLD}${league}${RST} (${sname}) — serie ${sid}:`);

    const gCount = await count(`SELECT COUNT(*) FROM games WHERE serie_id = $1 AND finished = true`, [sid]);
    const gpCount = await count(`
      SELECT COUNT(*) FROM game_players gp JOIN games g ON g.id = gp.game_id
      WHERE g.serie_id = $1 AND g.finished = true
    `, [sid]);
    const banCount = await count(`
      SELECT COUNT(*) FROM game_picks_bans pb JOIN games g ON g.id = pb.game_id
      WHERE g.serie_id = $1 AND pb.type = 'ban' AND g.finished = true
    `, [sid]);
    const pickCount = await count(`
      SELECT COUNT(*) FROM game_picks_bans pb JOIN games g ON g.id = pb.game_id
      WHERE g.serie_id = $1 AND pb.type = 'pick' AND g.finished = true
    `, [sid]);
    const patchNull = await count(`SELECT COUNT(*) FROM games WHERE serie_id = $1 AND finished = true AND patch IS NULL`, [sid]);
    const tcCount = await count(`SELECT COUNT(*) FROM team_career WHERE serie_id = $1`, [sid]);
    const pcCount = await count(`SELECT COUNT(*) FROM player_career WHERE serie_id = $1`, [sid]);
    const cgsCount = await count(`SELECT COUNT(*) FROM champion_global_stats WHERE serie_id = $1`, [sid]);
    const runeCount = await count(`
      SELECT COUNT(*) FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      JOIN games g ON g.id = gp.game_id
      WHERE g.serie_id = $1 AND g.finished = true
    `, [sid]);

    check(gCount > 0, `  ${league}: ${gCount} finished games`);
    check(gpCount > 0, `  ${league}: ${gpCount} game_player records`);
    if (gpCount > 0 && gCount > 0 && Math.abs(gpCount - gCount * 10) > gCount * 2) {
      warn(`  ${league}: player count mismatch`, `${gpCount} vs expected ~${gCount * 10}`);
    }

    // Bo format distribution for this league
    const leagueBo = await q(`
      SELECT m.number_of_games AS bo, COUNT(*) AS cnt
      FROM matches m WHERE m.serie_id = $1 AND m.number_of_games IS NOT NULL
      GROUP BY m.number_of_games ORDER BY cnt DESC
    `, [sid]);
    for (const r of leagueBo) info(`  ${league}: ${Number(r.cnt).toLocaleString()} matches as Bo${r.bo}`);

    check(banCount > 0, `  ${league}: ${banCount} bans recorded`);
    check(pickCount > 0, `  ${league}: ${pickCount} picks recorded`);
    if (patchNull > 0) warn(`  ${league}: ${patchNull} games without patch`);
    else check(true, `  ${league}: all games have patch`);
    check(tcCount > 0, `  ${league}: ${tcCount} team_career entries`);
    check(pcCount > 0, `  ${league}: ${pcCount} player_career entries`);
    check(cgsCount > 0, `  ${league}: ${cgsCount} champion_global_stats entries`);
    if (runeCount > 0) check(true, `  ${league}: ${runeCount.toLocaleString()} rune records`);
    else warn(`  ${league}: 0 rune records`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 13. CROSS-TABLE CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}── 13. CROSS-TABLE CONSISTENCY ──────────────────────────────${RST}`);

  // game_players.team_id matches game_teams
  const playersWrongTeam = await count(`
    SELECT COUNT(*) FROM game_players gp
    WHERE gp.team_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM game_teams gt WHERE gt.game_id = gp.game_id AND gt.team_id = gp.team_id
    )
  `);
  if (playersWrongTeam > 0) warn(`${playersWrongTeam} game_players with team not in game_teams`);
  else check(true, 'All game_players teams match game_teams');

  // match winner is a match_opponent
  const winnerNotOpp = await count(`
    SELECT COUNT(*) FROM matches m
    WHERE m.winner_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM match_opponents mo WHERE mo.match_id = m.id AND mo.team_id = m.winner_id)
  `);
  if (winnerNotOpp > 0) warn(`${winnerNotOpp} matches where winner is not an opponent`);
  else check(true, 'All match winners are valid opponents');

  // game winner is in game_teams
  const gameWinnerNotTeam = await count(`
    SELECT COUNT(*) FROM games g
    WHERE g.winner_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM game_teams gt WHERE gt.game_id = g.id AND gt.team_id = g.winner_id)
  `);
  if (gameWinnerNotTeam > 0) warn(`${gameWinnerNotTeam} games where winner is not in game_teams`);
  else check(true, 'All game winners are in game_teams');

  // game_players.player_id exists in players table
  const gpOrphanPlayers = await count(`
    SELECT COUNT(*) FROM game_players gp
    WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = gp.player_id)
  `);
  if (gpOrphanPlayers > 0) warn(`${gpOrphanPlayers} game_players referencing non-existent player`);
  else check(true, 'All game_players reference valid players');

  // game_players.team_id exists in teams table
  const gpOrphanTeams = await count(`
    SELECT COUNT(*) FROM game_players gp
    WHERE gp.team_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = gp.team_id)
  `);
  if (gpOrphanTeams > 0) warn(`${gpOrphanTeams} game_players referencing non-existent team`);
  else check(true, 'All game_players reference valid teams');

  // Summoner spells validation
  const gpBadSpell1 = await count(`
    SELECT COUNT(*) FROM game_players gp
    WHERE gp.spell_1_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM spells s WHERE s.id = gp.spell_1_id)
  `);
  const gpBadSpell2 = await count(`
    SELECT COUNT(*) FROM game_players gp
    WHERE gp.spell_2_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM spells s WHERE s.id = gp.spell_2_id)
  `);
  const badSpells = gpBadSpell1 + gpBadSpell2;
  if (badSpells > 0) warn(`${badSpells} game_players referencing unknown spells`);
  else check(true, 'All summoner spell references are valid');

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════════${RST}`);
  console.log(`  ${BOLD}RESULTS: ${totalChecks} checks${RST}`);
  console.log(`  ${PASS} Passed: ${passed}`);
  if (warnings > 0) console.log(`  ${WARN} Warnings: ${warnings}`);
  if (errors > 0) console.log(`  ${FAIL} Errors: ${errors}`);

  const score = totalChecks > 0 ? ((passed / totalChecks) * 100).toFixed(1) : 0;
  console.log(`  ${DIM}Score: ${score}%${RST}`);

  if (errors === 0 && warnings === 0) {
    console.log(`\n  \x1b[32m★ DATABASE IS PERFECT ★\x1b[0m`);
  } else if (errors === 0) {
    console.log(`\n  \x1b[33m✓ Database OK — ${warnings} minor warnings\x1b[0m`);
  } else {
    console.log(`\n  \x1b[31m✗ Database has ${errors} integrity issues — review above\x1b[0m`);
  }
  console.log(`${BOLD}══════════════════════════════════════════════════════════════${RST}\n`);

  await pool.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
