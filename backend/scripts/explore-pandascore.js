#!/usr/bin/env node
/**
 * explore-pandascore.js — PandaScore API Structure Explorer
 *
 * Fetches one sample from each endpoint used by the ingestion pipeline
 * and outputs the full JSON structure to understand field names, nesting,
 * and data types. This helps verify that fetch-to-postgres.js maps
 * correctly to the PostgreSQL schema.
 *
 * Usage:
 *   node scripts/explore-pandascore.js
 *   node scripts/explore-pandascore.js --endpoint games    # Only explore games
 *   node scripts/explore-pandascore.js --save              # Save output to file
 *
 * Output: JSON structures for each endpoint, showing real field names and nesting.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── .env loader ────────────────────────────────────────────────────────────
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

const BASE_URL = 'https://api.pandascore.co';
const TOKEN = process.env.PANDASCORE_TOKEN;
if (!TOKEN) { console.error('ERROR: PANDASCORE_TOKEN not set'); process.exit(1); }

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);
const ONLY_ENDPOINT = getArg('endpoint');
const SAVE_OUTPUT = hasFlag('save');

let requestCount = 0;
let lastRequestTime = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function apiFetch(url, attempt = 1) {
  const wait = Math.max(0, 400 - (Date.now() - lastRequestTime));
  if (wait > 0) await sleep(wait);
  lastRequestTime = Date.now();
  requestCount++;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (res.status === 429 && attempt <= 5) {
      const ra = parseInt(res.headers.get('Retry-After') || '5');
      console.log(`  ⏳ 429 — waiting ${ra}s (attempt ${attempt})...`);
      await sleep(ra * 1000);
      return apiFetch(url, attempt + 1);
    }
    if (res.status >= 500 && attempt <= 3) {
      await sleep(2000 * attempt);
      return apiFetch(url, attempt + 1);
    }
    if (!res.ok) {
      console.log(`  ⚠ HTTP ${res.status}: ${url}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError' && attempt <= 3) {
      await sleep(2000 * attempt);
      return apiFetch(url, attempt + 1);
    }
    throw err;
  }
}

function buildUrl(path, params = {}) {
  const u = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) { if (v != null) u.searchParams.set(k, String(v)); }
  return u.toString();
}

// ─── Schema extractor: show structure with types, not full data ────────────
function extractSchema(obj, depth = 0, maxArrayItems = 2) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return `"string" (example: "${obj.slice(0, 80)}${obj.length > 80 ? '...' : ''}")`;
  if (typeof obj === 'number') return `number (example: ${obj})`;
  if (typeof obj === 'boolean') return `boolean (example: ${obj})`;

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    // Show structure of first item(s)
    const items = obj.slice(0, maxArrayItems).map(item => extractSchema(item, depth + 1, 1));
    return `Array[${obj.length}] [\n${items.map(i => '  '.repeat(depth + 1) + i).join(',\n')}\n${'  '.repeat(depth)}]`;
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([key, val]) => {
      const valStr = extractSchema(val, depth + 1, 1);
      return `${'  '.repeat(depth + 1)}"${key}": ${valStr}`;
    });
    return `{\n${lines.join(',\n')}\n${'  '.repeat(depth)}}`;
  }

  return typeof obj;
}

// ─── Full raw dump (limited depth) ────────────────────────────────────────
function safeDump(obj, maxDepth = 6) {
  return JSON.stringify(obj, (key, value) => {
    // Truncate very long arrays
    if (Array.isArray(value) && value.length > 3) {
      return [...value.slice(0, 3), `... (${value.length - 3} more items)`];
    }
    // Truncate very long strings
    if (typeof value === 'string' && value.length > 200) {
      return value.slice(0, 200) + '...';
    }
    return value;
  }, 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS TO EXPLORE
// ═══════════════════════════════════════════════════════════════════════════

const results = {};

async function exploreSeries() {
  console.log('\n══ SERIES (for LEC) ══');
  const url = buildUrl('/lol/series', { 'filter[league_id]': 4197, per_page: 2, sort: '-year' });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.series = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
  return data?.[0];
}

async function exploreTournaments(serieId) {
  console.log('\n══ TOURNAMENTS (for serie) ══');
  const url = buildUrl(`/series/${serieId}/tournaments`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.tournaments = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
  return data?.[0];
}

async function exploreMatches(serieId) {
  console.log('\n══ MATCHES (for serie — first finished) ══');
  const url = buildUrl(`/series/${serieId}/matches`, {
    'filter[status]': 'finished', per_page: 2, sort: '-begin_at'
  });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.matches = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
  return data?.[0];
}

async function exploreGames(matchId) {
  console.log('\n══ GAMES (for match) ══');
  const url = buildUrl(`/lol/matches/${matchId}/games`, { per_page: 5 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    // This is the BIG one — show full structure of game.teams[0] and game.teams[0].players[0]
    results.games = { sample: data[0], schema: extractSchema(data[0]) };
    console.log('\n── Full game structure ──');
    console.log(safeDump(data[0]));

    // Deep dive: team structure
    if (data[0].teams?.[0]) {
      console.log('\n── game.teams[0] (team detail) ──');
      console.log(safeDump(data[0].teams[0]));

      // Deep dive: player structure (THE MOST IMPORTANT)
      if (data[0].teams[0].players?.[0]) {
        console.log('\n── game.teams[0].players[0] (PLAYER DETAIL — critical for game_players mapping) ──');
        console.log(safeDump(data[0].teams[0].players[0]));
      }
    }
  }
  return data?.[0];
}

async function exploreFrames(gameId) {
  console.log('\n══ FRAMES (for game — timeline) ══');
  const url = buildUrl(`/lol/games/${gameId}/frames`, { per_page: 5 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.frames = { sample: data[0], schema: extractSchema(data[0]) };
    console.log('\n── Frame structure ──');
    console.log(safeDump(data[0]));

    // Deep dive: blue side role data
    if (data[0].blue) {
      console.log('\n── frame.blue (side detail, first frame with role data) ──');
      // Find a frame with role data
      const frameWithRoles = data.find(f => f.blue?.top || f.blue?.mid);
      if (frameWithRoles) {
        console.log(safeDump(frameWithRoles.blue));
      } else {
        console.log(safeDump(data[0].blue));
      }
    }
  }
  return data;
}

async function exploreEvents(gameId) {
  console.log('\n══ EVENTS (for game) ══');
  const url = buildUrl(`/lol/games/${gameId}/events`, { per_page: 100 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    // Group events by type to show structure of each type
    const byType = {};
    for (const ev of data) {
      if (!byType[ev.type]) byType[ev.type] = ev;
    }
    results.events = { byType, schema: {} };
    for (const [type, sample] of Object.entries(byType)) {
      console.log(`\n── Event type: ${type} ──`);
      console.log(safeDump(sample));
      results.events.schema[type] = extractSchema(sample);
    }
  }
}

async function explorePlayerStats(serieId) {
  console.log('\n══ PLAYER STATS (per serie — for player_career + player_stats) ══');
  const url = buildUrl(`/lol/series/${serieId}/players/stats`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.playerStats = { sample: data[0], schema: extractSchema(data[0]) };
    console.log('\n── Player stats top-level ──');
    console.log(safeDump(data[0]));

    // Deep dive: stats.average/totals
    const s = data[0].stats || data[0];
    if (s.average || s.averages) {
      console.log('\n── stats.average (ALL fields — maps to player_career columns) ──');
      console.log(JSON.stringify(s.average || s.averages, null, 2));
    }
    if (s.total || s.totals) {
      console.log('\n── stats.total ──');
      console.log(JSON.stringify(s.total || s.totals, null, 2));
    }

    // Deep dive: favorite_champions (maps to player_champion_stats)
    if (data[0].favorite_champions?.length > 0) {
      console.log('\n── favorite_champions[0] (maps to player_champion_stats) ──');
      console.log(safeDump(data[0].favorite_champions[0]));
    }
  }
}

async function exploreTeamStats(serieId) {
  console.log('\n══ TEAM STATS (per serie — for team_career + team_stats) ══');
  const url = buildUrl(`/lol/series/${serieId}/teams/stats`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.teamStats = { sample: data[0], schema: extractSchema(data[0]) };
    console.log('\n── Team stats top-level ──');
    console.log(safeDump(data[0]));

    const s = data[0].stats || data[0];
    if (s.average || s.averages) {
      console.log('\n── stats.average (ALL fields — maps to team_career columns) ──');
      console.log(JSON.stringify(s.average || s.averages, null, 2));
    }
  }
}

async function exploreMatchPlayerStats(matchId) {
  console.log('\n══ MATCH PLAYER STATS (per match) ══');
  const url = buildUrl(`/lol/matches/${matchId}/players/stats`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.matchPlayerStats = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

async function exploreTournamentPlayerStats(tournamentId) {
  console.log('\n══ TOURNAMENT PLAYER STATS ══');
  const url = buildUrl(`/lol/tournaments/${tournamentId}/players/stats`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.tournamentPlayerStats = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

async function exploreTournamentTeamStats(tournamentId) {
  console.log('\n══ TOURNAMENT TEAM STATS ══');
  const url = buildUrl(`/lol/tournaments/${tournamentId}/teams/stats`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.tournamentTeamStats = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

async function exploreItems() {
  console.log('\n══ ITEMS (reference data) ══');
  const url = buildUrl('/lol/versions/all/items', { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.items = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

async function exploreSpells() {
  console.log('\n══ SPELLS (reference data) ══');
  const url = buildUrl('/lol/spells', { per_page: 5 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.spells = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

async function exploreRunesReforged() {
  console.log('\n══ RUNES REFORGED (reference data) ══');
  const url = buildUrl('/lol/runes-reforged', { per_page: 5 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.runesReforged = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));

    // Show slot structure
    if (data[0].slots) {
      console.log(`\n── Rune path: ${data[0].name} — Slots structure ──`);
      for (let i = 0; i < data[0].slots.length; i++) {
        const slot = data[0].slots[i];
        console.log(`  Slot ${i}: ${slot.runes?.length || 0} runes — ${slot.runes?.map(r => r.name).join(', ')}`);
      }
    }
  }
}

async function explorePlayers() {
  console.log('\n══ PLAYERS (metadata) ══');
  const url = buildUrl('/lol/players', { 'filter[id]': '5934', per_page: 1 }); // Faker
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.players = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

async function exploreSerieTeams(serieId) {
  console.log('\n══ SERIE TEAMS ══');
  const url = buildUrl(`/lol/series/${serieId}/teams`, { per_page: 2 });
  const data = await apiFetch(url);
  if (data && data.length > 0) {
    results.serieTeams = { sample: data[0], schema: extractSchema(data[0]) };
    console.log(safeDump(data[0]));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PANDASCORE API STRUCTURE EXPLORER');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Token: ${TOKEN.slice(0, 8)}...`);
  console.log(`  Filter: ${ONLY_ENDPOINT || 'all endpoints'}`);
  console.log('');

  const shouldExplore = (name) => !ONLY_ENDPOINT || ONLY_ENDPOINT === name;

  // Phase 1: Reference data
  if (shouldExplore('items')) await exploreItems();
  if (shouldExplore('spells')) await exploreSpells();
  if (shouldExplore('runes')) await exploreRunesReforged();
  if (shouldExplore('players')) await explorePlayers();

  // Phase 2: Structure — need a real serie to drill into
  let serie = null;
  let tournament = null;
  let match = null;
  let game = null;

  if (shouldExplore('series') || shouldExplore('tournaments') || shouldExplore('matches') ||
      shouldExplore('games') || shouldExplore('frames') || shouldExplore('events') ||
      shouldExplore('playerStats') || shouldExplore('teamStats') ||
      shouldExplore('matchPlayerStats') || shouldExplore('tournamentPlayerStats') ||
      shouldExplore('tournamentTeamStats') || shouldExplore('serieTeams') ||
      !ONLY_ENDPOINT) {
    serie = await exploreSeries();
    if (serie) {
      tournament = await exploreTournaments(serie.id);
      if (shouldExplore('serieTeams') || !ONLY_ENDPOINT) await exploreSerieTeams(serie.id);
      match = await exploreMatches(serie.id);
      if (match) {
        game = await exploreGames(match.id);
        if (game) {
          if (shouldExplore('frames') || !ONLY_ENDPOINT) await exploreFrames(game.id);
          if (shouldExplore('events') || !ONLY_ENDPOINT) await exploreEvents(game.id);
        }
        if (shouldExplore('matchPlayerStats') || !ONLY_ENDPOINT) await exploreMatchPlayerStats(match.id);
      }
      if (shouldExplore('playerStats') || !ONLY_ENDPOINT) await explorePlayerStats(serie.id);
      if (shouldExplore('teamStats') || !ONLY_ENDPOINT) await exploreTeamStats(serie.id);
      if (tournament) {
        if (shouldExplore('tournamentPlayerStats') || !ONLY_ENDPOINT) await exploreTournamentPlayerStats(tournament.id);
        if (shouldExplore('tournamentTeamStats') || !ONLY_ENDPOINT) await exploreTournamentTeamStats(tournament.id);
      }
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Done. ${requestCount} API requests made.`);
  console.log(`  Endpoints explored: ${Object.keys(results).join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Save full output
  if (SAVE_OUTPUT) {
    const outputPath = path.join(__dirname, '..', 'data', 'pandascore-api-structures.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n  📁 Full output saved to: ${outputPath}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
