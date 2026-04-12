#!/usr/bin/env node
/**
 * compare-matches.js — Deep comparison between a KNOWN GOOD match and a SUSPECT match.
 *
 * Compares every layer of data:
 *   1. Match metadata
 *   2. Games (per game in the series)
 *   3. Game teams (objectives, first flags, bans)
 *   4. Game players (stats, items, spells, rune paths)
 *   5. Game player runes (full rune tree: keystone, primary, secondary, shards)
 *   6. Picks & Bans (draft order)
 *   7. Game frames (timeline snapshots)
 *   8. Game events (kills, objectives, etc.)
 *
 * Usage:
 *   node scripts/compare-matches.js --good "<name or ID>" --suspect "<name or ID>"
 *
 * Examples:
 *   node scripts/compare-matches.js --good "G2 vs KC" --suspect "VIT vs MKOI"
 *   node scripts/compare-matches.js --good 1234567 --suspect 7654321
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── .env loader ──────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const PG_DSN = process.env.PG_DSN;
if (!PG_DSN) { console.error('PG_DSN not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: PG_DSN, max: 4 });

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const GOOD_ARG = getArg('good');
const SUSPECT_ARG = getArg('suspect');

if (!GOOD_ARG || !SUSPECT_ARG) {
  console.error('Usage: node scripts/compare-matches.js --good "<name or ID>" --suspect "<name or ID>"');
  process.exit(1);
}

// ─── Colors ───────────────────────────────────────────────────────────────
const BOLD = '\x1b[1m';
const RST = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

const OK = `${GREEN}✓${RST}`;
const FAIL = `${RED}✗${RST}`;
const WARN = `${YELLOW}⚠${RST}`;
const INFO = `${CYAN}ℹ${RST}`;

let issues = [];
let warnings = [];

function section(title) { console.log(`\n${BOLD}═══ ${title} ═══${RST}`); }
function sub(title) { console.log(`\n  ${BOLD}── ${title} ──${RST}`); }

function issue(msg, details = null) {
  issues.push(msg);
  console.log(`  ${FAIL} ${msg}`);
  if (details) console.log(`      ${DIM}${typeof details === 'object' ? JSON.stringify(details) : details}${RST}`);
}

function warn(msg, details = null) {
  warnings.push(msg);
  console.log(`  ${WARN} ${msg}`);
  if (details) console.log(`      ${DIM}${typeof details === 'object' ? JSON.stringify(details) : details}${RST}`);
}

function ok(msg) { console.log(`  ${OK} ${msg}`); }
function info(msg) { console.log(`  ${INFO} ${msg}`); }

// ─── Find match by name or ID ─────────────────────────────────────────────
async function findMatch(arg) {
  // Try as numeric ID first
  if (/^\d+$/.test(arg)) {
    const { rows } = await pool.query('SELECT * FROM matches WHERE id = $1', [parseInt(arg)]);
    if (rows.length > 0) return rows[0];
  }

  // Search by name (fuzzy)
  const { rows } = await pool.query(`
    SELECT m.*, l.name AS league_name, s.full_name AS serie_name
    FROM matches m
    LEFT JOIN leagues l ON l.id = m.league_id
    LEFT JOIN series s ON s.id = m.serie_id
    WHERE m.name ILIKE $1
    ORDER BY m.begin_at DESC
    LIMIT 5
  `, [`%${arg}%`]);

  if (rows.length === 0) {
    // Try matching opponent team names
    const { rows: byTeams } = await pool.query(`
      SELECT DISTINCT m.*, l.name AS league_name, s.full_name AS serie_name
      FROM matches m
      JOIN match_opponents mo ON mo.match_id = m.id
      JOIN teams t ON t.id = mo.team_id
      LEFT JOIN leagues l ON l.id = m.league_id
      LEFT JOIN series s ON s.id = m.serie_id
      WHERE t.acronym ILIKE ANY($1) OR t.name ILIKE ANY($1)
      ORDER BY m.begin_at DESC
      LIMIT 20
    `, [arg.split(/\s+vs\s+/i).map(t => `%${t.trim()}%`)]);

    if (byTeams.length === 0) return null;

    // If multiple, try to find the most specific match
    if (byTeams.length === 1) return byTeams[0];

    // Group by match_id and find one where BOTH teams match
    const parts = arg.split(/\s+vs\s+/i).map(t => t.trim().toLowerCase());
    if (parts.length === 2) {
      for (const match of byTeams) {
        const { rows: opps } = await pool.query(
          `SELECT t.acronym, t.name FROM match_opponents mo JOIN teams t ON t.id = mo.team_id WHERE mo.match_id = $1`,
          [match.id]
        );
        const oppNames = opps.map(o => [o.acronym?.toLowerCase(), o.name?.toLowerCase()]).flat();
        if (parts.every(p => oppNames.some(n => n?.includes(p)))) {
          return match;
        }
      }
    }

    return byTeams[0]; // fallback to first
  }

  return rows[0];
}

// ─── Compare utilities ────────────────────────────────────────────────────
function compareField(label, goodVal, suspectVal, { isCritical = false, tolerance = 0 } = {}) {
  if (goodVal === null && suspectVal === null) return true;
  if (goodVal === undefined && suspectVal === undefined) return true;

  // Numeric tolerance
  if (typeof goodVal === 'number' && typeof suspectVal === 'number' && tolerance > 0) {
    if (Math.abs(goodVal - suspectVal) <= tolerance) return true;
  }

  const gStr = JSON.stringify(goodVal);
  const sStr = JSON.stringify(suspectVal);

  if (gStr === sStr) return true;

  const fn = isCritical ? issue : warn;

  // Check for null vs value (common bug pattern)
  if (goodVal !== null && suspectVal === null) {
    fn(`${label}: GOOD has value but SUSPECT is NULL`, { good: goodVal, suspect: suspectVal });
  } else if (goodVal === null && suspectVal !== null) {
    fn(`${label}: GOOD is NULL but SUSPECT has value`, { good: goodVal, suspect: suspectVal });
  } else {
    fn(`${label}: values differ`, { good: goodVal, suspect: suspectVal });
  }
  return false;
}

function structureCheck(label, goodObj, suspectObj, fields, options = {}) {
  let allOk = true;
  for (const f of fields) {
    const fieldName = typeof f === 'string' ? f : f.name;
    const fieldOpts = typeof f === 'string' ? options : { ...options, ...f };
    if (!compareField(`${label}.${fieldName}`, goodObj[fieldName], suspectObj[fieldName], fieldOpts)) {
      allOk = false;
    }
  }
  return allOk;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPARISON FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. Match metadata ────────────────────────────────────────────────────
async function compareMatchMetadata(good, suspect) {
  section('1. Match Metadata');

  info(`GOOD:    [${good.id}] ${good.name} (${good.league_name || good.league_id}) — ${good.status}`);
  info(`SUSPECT: [${suspect.id}] ${suspect.name} (${suspect.league_name || suspect.league_id}) — ${suspect.status}`);

  // Check essential fields exist
  const essentialFields = ['tournament_id', 'serie_id', 'league_id', 'status', 'number_of_games', 'winner_id'];
  for (const f of essentialFields) {
    if (good[f] !== null && suspect[f] === null) {
      issue(`Match.${f}: GOOD has ${good[f]} but SUSPECT is NULL`);
    } else if (suspect[f] === null) {
      warn(`Match.${f}: both NULL`);
    } else {
      ok(`Match.${f}: present`);
    }
  }
}

// ─── 2. Games ─────────────────────────────────────────────────────────────
async function compareGames(good, suspect) {
  section('2. Games');

  const { rows: goodGames } = await pool.query(
    'SELECT * FROM games WHERE match_id = $1 ORDER BY position', [good.id]);
  const { rows: suspectGames } = await pool.query(
    'SELECT * FROM games WHERE match_id = $1 ORDER BY position', [suspect.id]);

  info(`GOOD: ${goodGames.length} games`);
  info(`SUSPECT: ${suspectGames.length} games`);

  if (goodGames.length === 0) { issue('GOOD match has 0 games!'); return { goodGames: [], suspectGames: [] }; }
  if (suspectGames.length === 0) { issue('SUSPECT match has 0 games!'); return { goodGames: [], suspectGames: [] }; }

  // Compare structure of each game (using first game of each)
  const g = goodGames[0];
  const s = suspectGames[0];

  sub('Game structure comparison (Game 1)');

  const gameFields = ['length', 'finished', 'complete', 'winner_id', 'patch', 'detailed_stats'];
  for (const f of gameFields) {
    if (g[f] !== null && s[f] === null) {
      issue(`Game.${f}: GOOD=${g[f]}, SUSPECT=NULL`);
    } else if (g[f] === null && s[f] !== null) {
      warn(`Game.${f}: GOOD=NULL, SUSPECT=${s[f]}`);
    } else {
      ok(`Game.${f}: both populated (good=${g[f]}, suspect=${s[f]})`);
    }
  }

  return { goodGames, suspectGames };
}

// ─── 3. Game Teams (objectives, first flags) ─────────────────────────────
async function compareGameTeams(goodGames, suspectGames) {
  section('3. Game Teams (Objectives, First Flags, Bans)');

  for (let i = 0; i < Math.min(goodGames.length, suspectGames.length); i++) {
    const gGame = goodGames[i];
    const sGame = suspectGames[i];

    sub(`Game ${i + 1} (good=${gGame.id}, suspect=${sGame.id})`);

    const { rows: gTeams } = await pool.query(
      'SELECT gt.*, t.acronym FROM game_teams gt JOIN teams t ON t.id = gt.team_id WHERE gt.game_id = $1 ORDER BY gt.color',
      [gGame.id]);
    const { rows: sTeams } = await pool.query(
      'SELECT gt.*, t.acronym FROM game_teams gt JOIN teams t ON t.id = gt.team_id WHERE gt.game_id = $1 ORDER BY gt.color',
      [sGame.id]);

    if (gTeams.length !== sTeams.length) {
      issue(`Game ${i+1}: GOOD has ${gTeams.length} teams, SUSPECT has ${sTeams.length}`);
      continue;
    }

    for (let t = 0; t < gTeams.length; t++) {
      const gT = gTeams[t];
      const sT = sTeams[t];

      info(`${gT.color} side: GOOD=${gT.acronym}, SUSPECT=${sT.acronym}`);

      // Objectives
      const objFields = ['kills', 'gold_earned', 'tower_kills', 'inhibitor_kills',
        'baron_kills', 'herald_kills', 'dragon_kills', 'elder_drake_kills',
        'voidgrub_kills', 'atakhan_kills',
        'chemtech_drake_kills', 'cloud_drake_kills', 'hextech_drake_kills',
        'infernal_drake_kills', 'mountain_drake_kills', 'ocean_drake_kills'];

      let objOk = true;
      for (const f of objFields) {
        if (gT[f] !== null && sT[f] === null) {
          issue(`  ${gT.color}.${f}: GOOD=${gT[f]}, SUSPECT=NULL`);
          objOk = false;
        } else if (gT[f] === null && sT[f] === null &&
                   !['elder_drake_kills', 'voidgrub_kills', 'atakhan_kills',
                     'chemtech_drake_kills', 'cloud_drake_kills', 'hextech_drake_kills',
                     'infernal_drake_kills', 'mountain_drake_kills', 'ocean_drake_kills'].includes(f)) {
          warn(`  ${gT.color}.${f}: both NULL (should have data)`);
          objOk = false;
        }
      }
      if (objOk) ok(`  ${gT.color} objectives: all populated`);

      // First flags
      const firstFields = ['first_blood', 'first_tower', 'first_inhibitor',
        'first_baron', 'first_dragon', 'first_herald', 'first_voidgrub', 'first_atakhan'];

      let firstOk = true;
      for (const f of firstFields) {
        if (gT[f] !== null && sT[f] === null) {
          issue(`  ${gT.color}.${f}: GOOD=${gT[f]}, SUSPECT=NULL`);
          firstOk = false;
        }
      }
      if (firstOk) ok(`  ${gT.color} first flags: all populated`);

      // Bans
      if (gT.bans && gT.bans.length > 0 && (!sT.bans || sT.bans.length === 0)) {
        issue(`  ${gT.color}.bans: GOOD has ${gT.bans.length} bans, SUSPECT has none`);
      } else if (gT.bans && sT.bans) {
        ok(`  ${gT.color}.bans: GOOD=${gT.bans.length}, SUSPECT=${sT.bans.length}`);
      }

      // Player IDs
      if (gT.player_ids && gT.player_ids.length > 0 && (!sT.player_ids || sT.player_ids.length === 0)) {
        issue(`  ${gT.color}.player_ids: GOOD has ${gT.player_ids.length}, SUSPECT has none`);
      } else if (gT.player_ids && sT.player_ids) {
        ok(`  ${gT.color}.player_ids: GOOD=${gT.player_ids.length}, SUSPECT=${sT.player_ids.length}`);
      }
    }
  }
}

// ─── 4. Game Players ─────────────────────────────────────────────────────
async function compareGamePlayers(goodGames, suspectGames) {
  section('4. Game Players (Stats, Items, Spells, Rune Paths)');

  for (let i = 0; i < Math.min(goodGames.length, suspectGames.length); i++) {
    const gGame = goodGames[i];
    const sGame = suspectGames[i];

    sub(`Game ${i + 1}`);

    const { rows: gPlayers } = await pool.query(`
      SELECT gp.*, p.name AS player_name, t.acronym AS team_acronym,
        ca.name AS champion_name
      FROM game_players gp
      JOIN players p ON p.id = gp.player_id
      JOIN teams t ON t.id = gp.team_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE gp.game_id = $1
      ORDER BY gp.team_id, gp.role
    `, [gGame.id]);

    const { rows: sPlayers } = await pool.query(`
      SELECT gp.*, p.name AS player_name, t.acronym AS team_acronym,
        ca.name AS champion_name
      FROM game_players gp
      JOIN players p ON p.id = gp.player_id
      JOIN teams t ON t.id = gp.team_id
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
      WHERE gp.game_id = $1
      ORDER BY gp.team_id, gp.role
    `, [sGame.id]);

    info(`GOOD: ${gPlayers.length} players, SUSPECT: ${sPlayers.length} players`);

    if (gPlayers.length !== sPlayers.length) {
      issue(`Player count mismatch: GOOD=${gPlayers.length}, SUSPECT=${sPlayers.length}`);
    }

    // Check each player in GOOD match for data completeness, then compare structure with SUSPECT
    const gFirst = gPlayers[0];
    const sFirst = sPlayers[0];
    if (!gFirst || !sFirst) continue;

    // Stats fields that should be populated
    const criticalStats = ['kills', 'deaths', 'assists', 'creep_score', 'gold_earned', 'level',
      'total_damage_dealt_to_champions', 'total_damage_taken'];
    const importantStats = ['minions_killed', 'cs_at_14', 'gold_spent', 'gold_percentage',
      'physical_damage_dealt_to_champions', 'magic_damage_dealt_to_champions',
      'true_damage_dealt_to_champions', 'total_heal', 'total_time_crowd_control_dealt',
      'wards_placed', 'vision_wards_bought_in_game',
      'double_kills', 'triple_kills', 'quadra_kills', 'penta_kills',
      'largest_killing_spree', 'largest_multi_kill'];
    const runeFields = ['rune_primary_path_id', 'rune_secondary_path_id', 'rune_shards'];
    const spellFields = ['spell_1_id', 'spell_2_id'];

    // Aggregate check across ALL players
    let nullCountGood = {};
    let nullCountSuspect = {};
    const allFields = [...criticalStats, ...importantStats, ...runeFields, ...spellFields, 'items'];

    for (const f of allFields) {
      nullCountGood[f] = 0;
      nullCountSuspect[f] = 0;
    }

    for (const p of gPlayers) {
      for (const f of allFields) {
        if (p[f] === null || p[f] === undefined || (Array.isArray(p[f]) && p[f].length === 0)) {
          nullCountGood[f]++;
        }
      }
    }

    for (const p of sPlayers) {
      for (const f of allFields) {
        if (p[f] === null || p[f] === undefined || (Array.isArray(p[f]) && p[f].length === 0)) {
          nullCountSuspect[f]++;
        }
      }
    }

    // Report differences
    for (const f of allFields) {
      const gNull = nullCountGood[f];
      const sNull = nullCountSuspect[f];

      if (gNull === 0 && sNull === sPlayers.length) {
        issue(`${f}: ALL populated in GOOD, ALL NULL in SUSPECT`);
      } else if (gNull === 0 && sNull > 0) {
        issue(`${f}: all populated in GOOD, ${sNull}/${sPlayers.length} NULL in SUSPECT`);
      } else if (gNull === gPlayers.length && sNull === 0) {
        warn(`${f}: all NULL in GOOD, all populated in SUSPECT`);
      } else if (gNull === 0 && sNull === 0) {
        ok(`${f}: all populated in both`);
      } else {
        info(`${f}: GOOD has ${gNull} NULLs, SUSPECT has ${sNull} NULLs`);
      }
    }

    // Show sample player data comparison
    sub(`Sample player comparison (first player each)`);
    info(`GOOD:    ${gFirst.player_name} (${gFirst.team_acronym}) — ${gFirst.champion_name || gFirst.champion_id}`);
    info(`SUSPECT: ${sFirst.player_name} (${sFirst.team_acronym}) — ${sFirst.champion_name || sFirst.champion_id}`);

    console.log(`    ${DIM}GOOD    — K/D/A: ${gFirst.kills}/${gFirst.deaths}/${gFirst.assists}, CS: ${gFirst.creep_score}, Gold: ${gFirst.gold_earned}, Items: ${JSON.stringify(gFirst.items)}, Spells: ${gFirst.spell_1_id}/${gFirst.spell_2_id}, Rune1: ${gFirst.rune_primary_path_id}, Rune2: ${gFirst.rune_secondary_path_id}, Shards: ${JSON.stringify(gFirst.rune_shards)}${RST}`);
    console.log(`    ${DIM}SUSPECT — K/D/A: ${sFirst.kills}/${sFirst.deaths}/${sFirst.assists}, CS: ${sFirst.creep_score}, Gold: ${sFirst.gold_earned}, Items: ${JSON.stringify(sFirst.items)}, Spells: ${sFirst.spell_1_id}/${sFirst.spell_2_id}, Rune1: ${sFirst.rune_primary_path_id}, Rune2: ${sFirst.rune_secondary_path_id}, Shards: ${JSON.stringify(sFirst.rune_shards)}${RST}`);
  }
}

// ─── 5. Game Player Runes ────────────────────────────────────────────────
async function compareRunes(goodGames, suspectGames) {
  section('5. Game Player Runes (Full Rune Trees)');

  for (let i = 0; i < Math.min(goodGames.length, suspectGames.length); i++) {
    const gGame = goodGames[i];
    const sGame = suspectGames[i];

    sub(`Game ${i + 1}`);

    // Count runes per player
    const { rows: gRuneCounts } = await pool.query(`
      SELECT gp.player_id, p.name AS player_name, COUNT(gpr.rune_id) AS rune_count,
        array_agg(gpr.slot ORDER BY gpr.slot) AS slots
      FROM game_players gp
      JOIN players p ON p.id = gp.player_id
      LEFT JOIN game_player_runes gpr ON gpr.game_player_id = gp.id
      WHERE gp.game_id = $1
      GROUP BY gp.player_id, p.name
      ORDER BY p.name
    `, [gGame.id]);

    const { rows: sRuneCounts } = await pool.query(`
      SELECT gp.player_id, p.name AS player_name, COUNT(gpr.rune_id) AS rune_count,
        array_agg(gpr.slot ORDER BY gpr.slot) AS slots
      FROM game_players gp
      JOIN players p ON p.id = gp.player_id
      LEFT JOIN game_player_runes gpr ON gpr.game_player_id = gp.id
      WHERE gp.game_id = $1
      GROUP BY gp.player_id, p.name
      ORDER BY p.name
    `, [sGame.id]);

    // GOOD: expected rune count per player (keystone + 3 primary + 2 secondary + 3 shards = 9)
    const gTotal = gRuneCounts.reduce((sum, r) => sum + parseInt(r.rune_count), 0);
    const sTotal = sRuneCounts.reduce((sum, r) => sum + parseInt(r.rune_count), 0);

    info(`GOOD total runes: ${gTotal} (${gRuneCounts.length} players)`);
    info(`SUSPECT total runes: ${sTotal} (${sRuneCounts.length} players)`);

    // Check slot distribution
    for (const g of gRuneCounts) {
      const slotsStr = g.slots?.filter(s => s !== null).join(',') || 'none';
      const runeCount = parseInt(g.rune_count);
      if (runeCount === 0) {
        issue(`GOOD ${g.player_name}: 0 runes (expected 6-9)`);
      } else if (runeCount < 6) {
        warn(`GOOD ${g.player_name}: only ${runeCount} runes (slots: ${slotsStr})`);
      }
    }

    for (const s of sRuneCounts) {
      const slotsStr = s.slots?.filter(sl => sl !== null).join(',') || 'none';
      const runeCount = parseInt(s.rune_count);
      if (runeCount === 0) {
        issue(`SUSPECT ${s.player_name}: 0 runes (expected 6-9)`);
      } else if (runeCount < 6) {
        warn(`SUSPECT ${s.player_name}: only ${runeCount} runes (slots: ${slotsStr})`);
      }
    }

    // Average runes per player comparison
    const gAvg = gRuneCounts.length > 0 ? (gTotal / gRuneCounts.length).toFixed(1) : 0;
    const sAvg = sRuneCounts.length > 0 ? (sTotal / sRuneCounts.length).toFixed(1) : 0;

    if (gAvg > 0 && sAvg == 0) {
      issue(`Avg runes/player: GOOD=${gAvg}, SUSPECT=0 (RUNES COMPLETELY MISSING)`);
    } else if (Math.abs(gAvg - sAvg) > 2) {
      issue(`Avg runes/player: GOOD=${gAvg}, SUSPECT=${sAvg} (significant difference)`);
    } else {
      ok(`Avg runes/player: GOOD=${gAvg}, SUSPECT=${sAvg}`);
    }

    // Show full rune detail for first player of each
    const { rows: gRuneDetail } = await pool.query(`
      SELECT gpr.slot, gpr.tree, r.name AS rune_name, r.type AS rune_type
      FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      JOIN runes r ON r.id = gpr.rune_id
      WHERE gp.game_id = $1
      ORDER BY gp.player_id, gpr.slot
      LIMIT 9
    `, [gGame.id]);

    const { rows: sRuneDetail } = await pool.query(`
      SELECT gpr.slot, gpr.tree, r.name AS rune_name, r.type AS rune_type
      FROM game_player_runes gpr
      JOIN game_players gp ON gp.id = gpr.game_player_id
      JOIN runes r ON r.id = gpr.rune_id
      WHERE gp.game_id = $1
      ORDER BY gp.player_id, gpr.slot
      LIMIT 9
    `, [sGame.id]);

    if (gRuneDetail.length > 0) {
      info(`GOOD first player runes:`);
      for (const r of gRuneDetail) {
        console.log(`      slot ${r.slot}: ${r.rune_name} (${r.rune_type || r.tree})`);
      }
    }
    if (sRuneDetail.length > 0) {
      info(`SUSPECT first player runes:`);
      for (const r of sRuneDetail) {
        console.log(`      slot ${r.slot}: ${r.rune_name} (${r.rune_type || r.tree})`);
      }
    }
  }
}

// ─── 6. Picks & Bans ────────────────────────────────────────────────────
async function comparePicksBans(goodGames, suspectGames) {
  section('6. Picks & Bans');

  for (let i = 0; i < Math.min(goodGames.length, suspectGames.length); i++) {
    const gGame = goodGames[i];
    const sGame = suspectGames[i];

    sub(`Game ${i + 1}`);

    const { rows: gPB } = await pool.query(`
      SELECT pb.type, pb.pick_turn, pb.champion_id, ca.name AS champion_name, t.acronym
      FROM game_picks_bans pb
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
      LEFT JOIN teams t ON t.id = pb.team_id
      WHERE pb.game_id = $1
      ORDER BY pb.type DESC, pb.pick_turn
    `, [gGame.id]);

    const { rows: sPB } = await pool.query(`
      SELECT pb.type, pb.pick_turn, pb.champion_id, ca.name AS champion_name, t.acronym
      FROM game_picks_bans pb
      LEFT JOIN champion_aliases ca ON ca.pandascore_id = pb.champion_id
      LEFT JOIN teams t ON t.id = pb.team_id
      WHERE pb.game_id = $1
      ORDER BY pb.type DESC, pb.pick_turn
    `, [sGame.id]);

    const gBans = gPB.filter(r => r.type === 'ban');
    const gPicks = gPB.filter(r => r.type === 'pick');
    const sBans = sPB.filter(r => r.type === 'ban');
    const sPicks = sPB.filter(r => r.type === 'pick');

    info(`GOOD:    ${gBans.length} bans, ${gPicks.length} picks`);
    info(`SUSPECT: ${sBans.length} bans, ${sPicks.length} picks`);

    if (gBans.length > 0 && sBans.length === 0) {
      issue('BANS: GOOD has bans, SUSPECT has NONE');
    } else if (gBans.length !== sBans.length) {
      warn(`Ban count differs: GOOD=${gBans.length}, SUSPECT=${sBans.length}`);
    } else {
      ok(`Ban count matches: ${gBans.length}`);
    }

    if (gPicks.length > 0 && sPicks.length === 0) {
      issue('PICKS: GOOD has picks, SUSPECT has NONE');
    } else if (gPicks.length !== sPicks.length) {
      warn(`Pick count differs: GOOD=${gPicks.length}, SUSPECT=${sPicks.length}`);
    } else {
      ok(`Pick count matches: ${gPicks.length}`);
    }

    // Check pick_turn populated
    const gTurns = gBans.filter(b => b.pick_turn !== null).length;
    const sTurns = sBans.filter(b => b.pick_turn !== null).length;
    if (gTurns > 0 && sTurns === 0) {
      issue('Ban pick_turn: GOOD has turn order, SUSPECT has all NULL');
    } else {
      ok(`Ban pick_turn: GOOD=${gTurns}/${gBans.length} with turns, SUSPECT=${sTurns}/${sBans.length}`);
    }
  }
}

// ─── 7. Frames ───────────────────────────────────────────────────────────
async function compareFrames(goodGames, suspectGames) {
  section('7. Game Frames (Timeline)');

  for (let i = 0; i < Math.min(goodGames.length, suspectGames.length); i++) {
    const gGame = goodGames[i];
    const sGame = suspectGames[i];

    sub(`Game ${i + 1}`);

    const { rows: gFrames } = await pool.query(
      'SELECT * FROM game_frames WHERE game_id = $1 ORDER BY timestamp', [gGame.id]);
    const { rows: sFrames } = await pool.query(
      'SELECT * FROM game_frames WHERE game_id = $1 ORDER BY timestamp', [sGame.id]);

    info(`GOOD: ${gFrames.length} frames`);
    info(`SUSPECT: ${sFrames.length} frames`);

    if (gFrames.length > 0 && sFrames.length === 0) {
      issue('FRAMES: GOOD has frames, SUSPECT has NONE');
    } else if (gFrames.length === 0 && sFrames.length === 0) {
      warn('Both have 0 frames');
    } else {
      ok(`Both have frames: GOOD=${gFrames.length}, SUSPECT=${sFrames.length}`);
    }

    // Check frame content
    if (gFrames.length > 0 && sFrames.length > 0) {
      const gF = gFrames[Math.floor(gFrames.length / 2)]; // mid-game frame
      const sF = sFrames[Math.floor(sFrames.length / 2)];

      const frameFields = ['blue_gold', 'red_gold', 'blue_kills', 'red_kills',
        'blue_towers', 'red_towers', 'blue_drakes', 'red_drakes',
        'blue_nashors', 'red_nashors', 'blue_heralds', 'red_heralds',
        'blue_voidgrubs', 'red_voidgrubs', 'blue_atakhans', 'red_atakhans'];

      let nullGood = 0, nullSuspect = 0;
      for (const f of frameFields) {
        if (gF[f] === null) nullGood++;
        if (sF[f] === null) nullSuspect++;
      }

      if (nullGood < 4 && nullSuspect > 10) {
        issue(`Mid-game frame: GOOD has ${nullGood} NULLs, SUSPECT has ${nullSuspect}/${frameFields.length} NULLs`);
      } else {
        ok(`Mid-game frame NULLs: GOOD=${nullGood}, SUSPECT=${nullSuspect} (of ${frameFields.length})`);
      }

      // Frame players
      const { rows: gFP } = await pool.query(
        'SELECT COUNT(*) AS cnt FROM game_frame_players WHERE frame_id = $1', [gF.id]);
      const { rows: sFP } = await pool.query(
        'SELECT COUNT(*) AS cnt FROM game_frame_players WHERE frame_id = $1', [sF.id]);

      info(`Mid-game frame_players: GOOD=${gFP[0].cnt}, SUSPECT=${sFP[0].cnt}`);
    }
  }
}

// ─── 8. Events ───────────────────────────────────────────────────────────
async function compareEvents(goodGames, suspectGames) {
  section('8. Game Events');

  for (let i = 0; i < Math.min(goodGames.length, suspectGames.length); i++) {
    const gGame = goodGames[i];
    const sGame = suspectGames[i];

    sub(`Game ${i + 1}`);

    const { rows: gEvents } = await pool.query(`
      SELECT type, COUNT(*) AS cnt FROM game_events WHERE game_id = $1 GROUP BY type ORDER BY type
    `, [gGame.id]);
    const { rows: sEvents } = await pool.query(`
      SELECT type, COUNT(*) AS cnt FROM game_events WHERE game_id = $1 GROUP BY type ORDER BY type
    `, [sGame.id]);

    const gTotal = gEvents.reduce((sum, e) => sum + parseInt(e.cnt), 0);
    const sTotal = sEvents.reduce((sum, e) => sum + parseInt(e.cnt), 0);

    info(`GOOD: ${gTotal} events (${gEvents.length} types)`);
    info(`SUSPECT: ${sTotal} events (${sEvents.length} types)`);

    if (gTotal > 0 && sTotal === 0) {
      issue('EVENTS: GOOD has events, SUSPECT has NONE');
    } else if (gTotal === 0 && sTotal === 0) {
      warn('Both have 0 events');
    }

    // Compare event types
    const gEventMap = {};
    for (const e of gEvents) gEventMap[e.type] = parseInt(e.cnt);
    const sEventMap = {};
    for (const e of sEvents) sEventMap[e.type] = parseInt(e.cnt);

    const allTypes = new Set([...Object.keys(gEventMap), ...Object.keys(sEventMap)]);
    for (const type of [...allTypes].sort()) {
      const gCnt = gEventMap[type] || 0;
      const sCnt = sEventMap[type] || 0;

      if (gCnt > 0 && sCnt === 0) {
        issue(`  ${type}: GOOD=${gCnt}, SUSPECT=0 (MISSING)`);
      } else if (gCnt === 0 && sCnt > 0) {
        warn(`  ${type}: GOOD=0, SUSPECT=${sCnt} (extra)`);
      } else {
        ok(`  ${type}: GOOD=${gCnt}, SUSPECT=${sCnt}`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`${BOLD}LeagueScope Match Comparison Tool${RST}`);
  console.log(`Database: ${PG_DSN.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`GOOD:    ${GOOD_ARG}`);
  console.log(`SUSPECT: ${SUSPECT_ARG}`);
  console.log('');

  // Find matches
  const good = await findMatch(GOOD_ARG);
  if (!good) { console.error(`${FAIL} Could not find GOOD match: "${GOOD_ARG}"`); await pool.end(); process.exit(1); }

  const suspect = await findMatch(SUSPECT_ARG);
  if (!suspect) { console.error(`${FAIL} Could not find SUSPECT match: "${SUSPECT_ARG}"`); await pool.end(); process.exit(1); }

  // Run all comparisons
  await compareMatchMetadata(good, suspect);
  const { goodGames, suspectGames } = await compareGames(good, suspect);

  if (goodGames.length > 0 && suspectGames.length > 0) {
    await compareGameTeams(goodGames, suspectGames);
    await compareGamePlayers(goodGames, suspectGames);
    await compareRunes(goodGames, suspectGames);
    await comparePicksBans(goodGames, suspectGames);
    await compareFrames(goodGames, suspectGames);
    await compareEvents(goodGames, suspectGames);
  }

  // Summary
  section('SUMMARY');
  console.log(`  ${RED}Critical issues: ${issues.length}${RST}`);
  console.log(`  ${YELLOW}Warnings: ${warnings.length}${RST}`);

  if (issues.length > 0) {
    console.log(`\n  ${BOLD}Critical issues found:${RST}`);
    for (const iss of issues) {
      console.log(`    ${FAIL} ${iss}`);
    }
  }

  if (issues.length === 0 && warnings.length === 0) {
    console.log(`\n  ${OK} Both matches have identical data structure. No bugs detected.`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(2);
});
