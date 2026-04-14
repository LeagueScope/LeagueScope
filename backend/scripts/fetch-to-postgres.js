#!/usr/bin/env node
/**
 * fetch-to-postgres.js
 *
 * PandaScore → PostgreSQL direct ingestion.
 * Replaces the old 3-step pipeline (PandaScore → SQLite → ETL → PostgreSQL).
 *
 * Phases:
 *   1. Reference data (champions, champion_aliases, items, runes, spells)
 *   2. Structure (leagues, series, tournaments, teams, players, matches)
 *   3. Game data (games, game_teams, game_players, picks_bans, player_runes)
 *   4. Timeline (game_frames, game_frame_players, game_events)
 *   5. Pre-computed stats (player_career, team_career, champion_global_stats,
 *      player_champion_stats)
 *
 * Usage:
 *   PG_DSN="postgresql://..." node scripts/fetch-to-postgres.js --league LEC --year 2026
 *   PG_DSN="postgresql://..." node scripts/fetch-to-postgres.js --league LEC --year 2026 --split spring
 *   PG_DSN="postgresql://..." node scripts/fetch-to-postgres.js --static-only
 *
 * Flags:
 *   --league <SLUG>    League to fetch (required unless --static-only)
 *   --year <YYYY>      Filter by year (optional)
 *   --split <name>     Filter by split (optional)
 *   --skip-static      Skip reference data (champions, items, etc.)
 *   --static-only      Only fetch reference data
 *   --skip-timeline    Skip frames & events (faster, less data)
 *   --skip-stats       Skip pre-computed stats
 *   --dry-run          Fetch data but don't insert (test API access)
 *
 * Safe to re-run — uses INSERT ... ON CONFLICT DO UPDATE (upsert) throughout.
 *
 * Rate limit: PandaScore allows ~10K req/hr. A typical serie uses ~700 requests.
 */

import pg from 'pg';
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

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.pandascore.co';
const TOKEN = process.env.PANDASCORE_TOKEN;
const PG_DSN = process.env.PG_DSN;

if (!TOKEN) { console.error('ERROR: PANDASCORE_TOKEN not set in .env'); process.exit(1); }
if (!PG_DSN) { console.error('ERROR: PG_DSN not set in .env'); process.exit(1); }

const CHAMPION_MAP_PATH = path.join(__dirname, '..', 'data', 'champion_map.json');

// ─── League IDs (PandaScore) ────────────────────────────────────────────────

const LEAGUE_IDS = {
  // Tier 1
  LCK: 293, LPL: 294, LEC: 4197, LCS: 4198, CBLOL: 302, LCP: 5351,
  // Tier 2
  VCS: 4141, LJL: 2092, TCL: 1003,
  // Latin America
  LRN: 5048, LRS: 5049,
  // Academy / Challengers
  LCKCL: 4553, NACL: 4961, CIRCUITODESAF: 5377,
  // EMEA Masters
  EMEAMASTERS: 4996,
  // ERLs
  LFL: 4292, PRM: 4302, LES: 5496, NLC: 4411, LIT: 5211, EBL: 4426, HLL: 5355,
  // International
  WORLDS: 297, MSI: 300, FIRSTSTAND: 5369, EWC: 5262,
  // Other
  ROADOFLEGENDS: 5366,
};

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const ARG_LEAGUE = getArg('league')?.toUpperCase();
const ARG_YEAR = getArg('year') ? Number(getArg('year')) : null;
const ARG_SPLIT = getArg('split');
const ARG_MATCH_ID = getArg('match-id') ? Number(getArg('match-id')) : null;
const SKIP_STATIC = hasFlag('skip-static');
const STATIC_ONLY = hasFlag('static-only');
const SKIP_TIMELINE = hasFlag('skip-timeline');
const SKIP_STATS = hasFlag('skip-stats');
const STATS_ONLY = hasFlag('stats-only');
const DRY_RUN = hasFlag('dry-run');

if (!STATIC_ONLY && !STATS_ONLY && !ARG_LEAGUE && !ARG_MATCH_ID) {
  console.error('Usage: node scripts/fetch-to-postgres.js --league LEC [--year 2026] [--split spring]');
  console.error('       node scripts/fetch-to-postgres.js --match-id 123456');
  console.error('       node scripts/fetch-to-postgres.js --static-only');
  console.error('       node scripts/fetch-to-postgres.js --league LEC --stats-only');
  process.exit(1);
}
if (ARG_LEAGUE && !LEAGUE_IDS[ARG_LEAGUE]) {
  console.error(`Unknown league: ${ARG_LEAGUE}. Available: ${Object.keys(LEAGUE_IDS).join(', ')}`);
  process.exit(1);
}

// ─── Role normalization ─────────────────────────────────────────────────────

const ROLE_MAP = { top: 'top', jun: 'jun', jungle: 'jun', mid: 'mid', adc: 'adc', bot: 'adc', sup: 'sup', support: 'sup' };
const VALID_ROLES = new Set(['top', 'jun', 'mid', 'adc', 'sup']);
const normRole = (r) => { const n = ROLE_MAP[r?.toLowerCase()]; return n && VALID_ROLES.has(n) ? n : null; };

const VALID_COLORS = new Set(['blue', 'red']);
const normColor = (c) => VALID_COLORS.has(c?.toLowerCase()) ? c.toLowerCase() : null;

const VALID_STATUSES = new Set(['finished', 'running', 'not_started', 'canceled', 'postponed']);
const normStatus = (s) => VALID_STATUSES.has(s) ? s : null;

const VALID_EVENT_TYPES = new Set(['player_kill', 'tower_kill', 'inhibitor_kill', 'drake_kill', 'baron_nashor_kill', 'herald_kill', 'rift_herald_kill', 'voidgrub_kill', 'atakhan_kill']);

// Map API event type to DB enum value (e.g. rift_herald_kill → herald_kill)
const EVENT_TYPE_MAP = { rift_herald_kill: 'herald_kill' };
function normEventType(t) { return EVENT_TYPE_MAP[t] || t; }

// Upsert rune paths from game player data — PandaScore paths (Domination=1, Inspiration=2,
// Precision=3, Resolve=4, Sorcery=5) are only available in the games API, not /lol/runes-reforged.
async function upsertRunePathsFromPlayer(gp) {
  const rr = gp.runes_reforged;
  if (!rr) return;
  for (const pathObj of [rr.primary_path, rr.secondary_path]) {
    if (pathObj?.id && pathObj.name && pathObj.type === 'path') {
      await upsert(`
        INSERT INTO rune_paths (id, name, image_url) VALUES ($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = COALESCE(EXCLUDED.image_url, rune_paths.image_url)
      `, [pathObj.id, pathObj.name, pathObj.image_url || null]);
    }
  }
}

// Extract event fields — PandaScore nests data under ev.payload
function extractEvent(ev) {
  const p = ev.payload || {};
  const killer = p.killer?.object || ev.killer || {};
  const victim = p.victim?.object || ev.victim || {};
  const assists = p.assists
    ? p.assists.filter(a => a != null).map(a => ({ player_id: a.object?.player_id ?? a.player_id, champion_id: a.object?.champion?.id ?? a.champion_id }))
    : ev.assistants || null;
  return {
    timestamp: ev.ingame_timestamp ?? ev.timestamp ?? null,
    type: normEventType(ev.type),
    killer_player_id: killer.player_id ?? null,
    killer_champion_id: killer.champion?.id ?? killer.champion_id ?? null,
    victim_player_id: victim.player_id ?? null,
    victim_champion_id: victim.champion?.id ?? victim.champion_id ?? null,
    assistants: assists ? JSON.stringify(assists) : null,
    is_first: ev.is_first ?? false,
  };
}

// ─── HTTP client with rate limiting ─────────────────────────────────────────

let requestCount = 0;
let lastRequestTime = 0;
const MIN_DELAY = 400;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function apiFetch(url, attempt = 1) {
  const wait = Math.max(0, MIN_DELAY - (Date.now() - lastRequestTime));
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

    if (res.status === 429) {
      const ra = parseInt(res.headers.get('Retry-After') || '5');
      if (attempt <= 5) { log(`  ⏳ 429 — waiting ${ra}s (attempt ${attempt})...`); await sleep(ra * 1000); return apiFetch(url, attempt + 1); }
      throw new Error(`429 after ${attempt} retries`);
    }
    if (res.status >= 500 && attempt <= 3) { await sleep(2000 * attempt); return apiFetch(url, attempt + 1); }
    if (res.status === 403 || res.status === 404) return { data: null, total: 0 };
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

    return { data: await res.json(), total: parseInt(res.headers.get('X-Total') || '0') };
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError' && attempt <= 3) { log(`  ⏳ Timeout (attempt ${attempt})...`); await sleep(2000 * attempt); return apiFetch(url, attempt + 1); }
    throw err;
  }
}

function buildUrl(path, params = {}) {
  const u = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) { if (v != null) u.searchParams.set(k, String(v)); }
  return u.toString();
}

async function apiGet(path, params = {}) {
  return apiFetch(buildUrl(path, params));
}

async function apiGetAll(path, params = {}, maxPages = 30) {
  const first = await apiGet(path, { ...params, per_page: 100, page: 1 });
  if (!first.data) return [];
  if (!Array.isArray(first.data)) return [first.data];
  const results = [...first.data];
  if (first.total <= 100) return results;
  const pages = Math.min(Math.ceil(first.total / 100), maxPages);
  for (let p = 2; p <= pages; p++) {
    const pg = await apiGet(path, { ...params, per_page: 100, page: p });
    if (pg.data && Array.isArray(pg.data)) results.push(...pg.data);
  }
  return results;
}

// ─── PostgreSQL ─────────────────────────────────────────────────────────────

const poolCfg = { connectionString: PG_DSN, max: 4 };
if (PG_DSN.includes('rds.amazonaws.com')) {
  poolCfg.ssl = { rejectUnauthorized: false };
}
const pool = new pg.Pool(poolCfg);

async function upsert(sql, params) {
  if (DRY_RUN) return { rows: [] };
  return pool.query(sql, params);
}

// ─── Logging ────────────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

function log(msg) { console.log(msg); }
function section(title) { log(`\n${BOLD}══ ${title} ══${RST}`); }
function done(msg) { log(`  ${GREEN}✓${RST} ${msg}`); }
function warn(msg) { log(`  ${YELLOW}⚠${RST} ${msg}`); }

// ─── Champion map (alias resolution) ────────────────────────────────────────

let championMap = null;
function loadChampionMap() {
  if (!fs.existsSync(CHAMPION_MAP_PATH)) {
    warn('champion_map.json not found — alias resolution disabled');
    return;
  }
  championMap = JSON.parse(fs.readFileSync(CHAMPION_MAP_PATH, 'utf-8'));
  done(`Loaded champion_map: ${championMap._meta.total_champions} champions, ${championMap._meta.total_ids} IDs`);
}

// ─── Auto-resolve unknown champion IDs ─────────────────────────────────────
const knownChampionIds = new Set();

async function loadKnownChampionIds() {
  const { rows } = await pool.query('SELECT pandascore_id FROM champion_aliases');
  for (const r of rows) knownChampionIds.add(r.pandascore_id);
}

async function ensureChampionAlias(champId) {
  if (!champId || knownChampionIds.has(champId)) return;
  // Unknown champion ID — fetch from PandaScore and auto-create alias
  try {
    const { data: champData } = await apiGet(`/lol/champions/${champId}`);
    if (!champData || !champData.name) {
      warn(`Unknown champion ID ${champId} — API returned no data, skipping`);
      return;
    }
    const name = champData.name;
    // Find existing canonical champion by name
    const { rows: existing } = await pool.query(
      'SELECT id FROM champions WHERE LOWER(name) = LOWER($1) LIMIT 1', [name]
    );
    let canonicalId;
    if (existing.length) {
      canonicalId = existing[0].id;
    } else {
      // New champion entirely — create canonical entry
      canonicalId = champId;
      await upsert(`
        INSERT INTO champions (id, name, slug, image_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
      `, [canonicalId, name, name.toLowerCase().replace(/[^a-z0-9]/g, '-'), champData.image_url || null]);
      done(`New champion created: ${name} (${canonicalId})`);
    }
    await upsert(`
      INSERT INTO champion_aliases (pandascore_id, canonical_id, name, image_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (pandascore_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
    `, [champId, canonicalId, name, champData.image_url || null]);
    knownChampionIds.add(champId);
    done(`Auto-alias: ${name} (${champId} → canonical ${canonicalId})`);
  } catch (err) {
    warn(`Failed to auto-resolve champion ID ${champId}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════

async function phase1_reference() {
  section('PHASE 1: Reference Data');
  loadChampionMap();

  // 1a. Champions (from champion_map.json → canonical champions)
  if (championMap) {
    let count = 0;
    for (const [name, champ] of Object.entries(championMap.champions)) {
      await upsert(`
        INSERT INTO champions (id, name, slug, image_url, big_image_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, image_url = EXCLUDED.image_url, big_image_url = EXCLUDED.big_image_url
      `, [champ.canonical_id, name, name.toLowerCase().replace(/[^a-z0-9]/g, '-'), champ.image_url, champ.big_image_url]);

      // Insert all aliases
      for (const aliasId of (champ.alias_ids || [])) {
        await upsert(`
          INSERT INTO champion_aliases (pandascore_id, canonical_id, name, image_url)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (pandascore_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
        `, [aliasId, champ.canonical_id, name, champ.image_url]);
      }
      // Also insert canonical_id as alias for itself
      await upsert(`
        INSERT INTO champion_aliases (pandascore_id, canonical_id, name, image_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (pandascore_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
      `, [champ.canonical_id, champ.canonical_id, name, champ.image_url]);
      count++;
    }
    done(`Champions: ${count} canonical + aliases`);
  }

  // 1b. Items — schema: id, name, image_url, is_trinket, gold_base, gold_total, gold_sell,
  //     gold_purchasable, flat_*_mod, percent_*_mod, videogame_versions
  const items = await apiGetAll('/lol/versions/all/items');
  let itemCount = 0;
  for (const item of items) {
    if (!item.name) continue; // Skip items with no name (deprecated/removed)
    const isTrinket = item.is_trinket ?? (item.gold_total === 0 && item.name?.toLowerCase().includes('ward'));
    await upsert(`
      INSERT INTO items (id, name, image_url, is_trinket, gold_base, gold_total, gold_sell, gold_purchasable,
        flat_armor_mod, flat_crit_chance_mod, flat_hp_pool_mod, flat_hp_regen_mod, flat_mp_pool_mod,
        flat_mp_regen_mod, flat_magic_damage_mod, flat_movement_speed_mod, flat_physical_damage_mod,
        flat_spell_block_mod, percent_attack_speed_mod, percent_life_steal_mod, percent_movement_speed_mod,
        videogame_versions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url,
        is_trinket = EXCLUDED.is_trinket, videogame_versions = EXCLUDED.videogame_versions
    `, [
      item.id, item.name, item.image_url || null, isTrinket,
      item.gold_base ?? null, item.gold_total ?? null, item.gold_sell ?? null, item.gold_purchasable ?? null,
      item.flat_armor_mod ?? null, item.flat_crit_chance_mod ?? null, item.flat_hp_pool_mod ?? null,
      item.flat_hp_regen_mod ?? null, item.flat_mp_pool_mod ?? null, item.flat_mp_regen_mod ?? null,
      item.flat_magic_damage_mod ?? null, item.flat_movement_speed_mod ?? null,
      item.flat_physical_damage_mod ?? null, item.flat_spell_block_mod ?? null,
      item.percent_attack_speed_mod ?? null, item.percent_life_steal_mod ?? null,
      item.percent_movement_speed_mod ?? null,
      item.videogame_versions ?? null,
    ]);
    itemCount++;
  }
  done(`Items: ${itemCount}`);

  // 1c. Spells — schema: id, name, image_url (no slug)
  const spells = await apiGetAll('/lol/spells');
  for (const sp of spells) {
    await upsert(`
      INSERT INTO spells (id, name, image_url) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
    `, [sp.id, sp.name, sp.image_url || null]);
  }
  done(`Spells: ${spells.length}`);

  // 1d. Runes — PandaScore /lol/runes-reforged returns a FLAT list of 83 individual runes.
  //     It does NOT include rune paths (Domination, Inspiration, Precision, Resolve, Sorcery).
  //     Rune paths use IDs 1-5 which COLLIDE with rune IDs (1=Electrocute, 2=Predator, etc.).
  //     rune_paths must be populated separately (from game data, see _upsertRunePaths below).
  //
  //     The type field from the API tells us the rune's slot:
  //       "keystone", "slot1", "slot2", "slot3", "shard"
  const VALID_RUNE_TYPES = new Set(['keystone', 'slot1', 'slot2', 'slot3', 'shard']);
  const runeData = await apiGetAll('/lol/runes-reforged');
  let runeCount = 0;

  // Clean rune_paths pollution: the previous code wrongly inserted all 83 runes as paths.
  // The real paths have IDs 1-5 and come from game data, not this endpoint.
  // We clean everything and let _upsertRunePaths repopulate from actual game data.
  const { rowCount: cleanedPaths } = await pool.query(
    'DELETE FROM rune_paths WHERE id NOT IN (SELECT DISTINCT rune_primary_path_id FROM game_players WHERE rune_primary_path_id IS NOT NULL UNION SELECT DISTINCT rune_secondary_path_id FROM game_players WHERE rune_secondary_path_id IS NOT NULL)'
  );
  if (cleanedPaths > 0) log(`  Cleaned ${cleanedPaths} unused entries from rune_paths`);

  for (const rune of runeData) {
    const runeType = VALID_RUNE_TYPES.has(rune.type) ? rune.type : 'shard';
    await upsert(`
      INSERT INTO runes (id, name, image_url, type) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url, type = EXCLUDED.type
    `, [rune.id, rune.name, rune.image_url || null, runeType]);
    runeCount++;
  }

  // Now seed rune_paths from the 5 known PandaScore paths.
  // These IDs come from the games API (primary_path.id / secondary_path.id).
  // We seed them here so the homepage and match pages work immediately.
  const PANDASCORE_RUNE_PATHS = [
    { id: 1, name: 'Domination',   image_url: 'https://cdn-api.pandascore.co/images/lol/rune_path/image/d3bdc898f4176d5fc3fa4e43a2021bbe.png' },
    { id: 2, name: 'Inspiration',  image_url: 'https://cdn-api.pandascore.co/images/lol/rune_path/image/3f3b8ad8c25c4ad5ddec4d1cff137022.png' },
    { id: 3, name: 'Precision',    image_url: 'https://cdn-api.pandascore.co/images/lol/rune_path/image/6aac126e9e7489812bb15e3ff4855f70.png' },
    { id: 4, name: 'Resolve',      image_url: 'https://cdn-api.pandascore.co/images/lol/rune_path/image/54c94cceac3bd8cf21be2a1e537a8880.png' },
    { id: 5, name: 'Sorcery',      image_url: 'https://cdn-api.pandascore.co/images/lol/rune_path/image/fedb6f0ca24988f397ad65670e1f9f76.png' },
  ];
  for (const rp of PANDASCORE_RUNE_PATHS) {
    await upsert(`
      INSERT INTO rune_paths (id, name, image_url) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
    `, [rp.id, rp.name, rp.image_url]);
  }

  done(`Rune paths: 5 (seeded), Runes: ${runeCount}`);

  // Load all known champion IDs for auto-alias resolution in Phase 3+
  await loadKnownChampionIds();
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: STRUCTURE (League → Series → Tournaments → Teams → Matches)
// ═══════════════════════════════════════════════════════════════════════════

async function phase2_structure(leagueSlug, leagueId) {
  section('PHASE 2: Structure');

  // 2a. League
  await upsert(`
    INSERT INTO leagues (id, name, slug) VALUES ($1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `, [leagueId, leagueSlug, leagueSlug.toLowerCase()]);
  done(`League: ${leagueSlug} (${leagueId})`);

  // 2b. Series
  const allSeries = await apiGetAll(`/lol/series`, { 'filter[league_id]': leagueId });
  let series = allSeries;
  if (ARG_YEAR) series = series.filter(s => s.year === ARG_YEAR);
  if (ARG_SPLIT) series = series.filter(s => s.full_name?.toLowerCase().includes(ARG_SPLIT.toLowerCase()));

  log(`  Found ${series.length} series${ARG_YEAR ? ` for ${ARG_YEAR}` : ''}${ARG_SPLIT ? ` (${ARG_SPLIT})` : ''}`);

  const allTeamIds = new Set();
  const allPlayerIds = new Set();
  const seriesList = [];
  const tournamentIds = []; // Track tournament IDs for stats phase

  for (const s of series) {
    await upsert(`
      INSERT INTO series (id, league_id, full_name, slug, year, season, begin_at, end_at, winner_id, winner_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name, begin_at = EXCLUDED.begin_at, end_at = EXCLUDED.end_at,
        winner_id = EXCLUDED.winner_id, winner_type = EXCLUDED.winner_type
    `, [s.id, leagueId, s.full_name || s.name, s.slug, s.year, s.season,
        s.begin_at, s.end_at, s.winner_id, s.winner_type || null]);

    // 2c. Tournaments for this serie
    const tournaments = await apiGetAll(`/series/${s.id}/tournaments`);
    for (const t of tournaments) {
      tournamentIds.push(t.id);
      await upsert(`
        INSERT INTO tournaments (id, serie_id, league_id, name, slug, tier, begin_at, end_at,
          winner_id, winner_type, prizepool, has_bracket, region, country)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, winner_id = EXCLUDED.winner_id, tier = EXCLUDED.tier,
          winner_type = EXCLUDED.winner_type, prizepool = EXCLUDED.prizepool
      `, [t.id, s.id, leagueId, t.name, t.slug, t.tier ? t.tier.toUpperCase() : null, t.begin_at, t.end_at,
          t.winner_id, t.winner_type || null, t.prizepool || null,
          t.has_bracket ?? false, t.region || null, t.country || null]);

      // Tournament teams → tournament_teams table
      if (t.teams) {
        for (const team of t.teams) {
          allTeamIds.add(team.id);
          // Ensure team exists in `teams` before inserting into tournament_teams (FK constraint).
          // Uses DO NOTHING so step 2d can later overwrite with full team data from /series/{id}/teams.
          await upsert(`
            INSERT INTO teams (id, name, slug, acronym, location, image_url)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `, [team.id, team.name || 'Unknown', team.slug || null,
              team.acronym || null, team.location || null, team.image_url || null]);

          await upsert(`
            INSERT INTO tournament_teams (tournament_id, team_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [t.id, team.id]);
        }
      }

      // Tournament rosters
      if (t.expected_roster) {
        for (const roster of t.expected_roster) {
          if (!roster.team?.id || !roster.players) continue;
          for (const p of roster.players) {
            allPlayerIds.add(p.id);
            const role = normRole(p.role);
            // Ensure player exists before inserting roster
            await upsert(`
              INSERT INTO players (id, name, first_name, last_name, role, image_url, nationality)
              VALUES ($1,$2,$3,$4,$5,$6,$7)
              ON CONFLICT (id) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, players.name),
                role = COALESCE(EXCLUDED.role, players.role),
                image_url = COALESCE(EXCLUDED.image_url, players.image_url)
            `, [p.id, p.name || p.slug || 'Unknown', p.first_name || null, p.last_name || null,
                role, p.image_url || null, p.nationality || null]);
            await upsert(`
              INSERT INTO tournament_rosters (tournament_id, team_id, player_id, role)
              VALUES ($1,$2,$3,$4)
              ON CONFLICT DO NOTHING
            `, [t.id, roster.team.id, p.id, role]);
          }
        }
      }

      // Standings — schema: (tournament_id, team_id, rank) — only 3 columns
      if (t.standings) {
        for (const standing of t.standings) {
          if (!standing.team?.id) continue;
          await upsert(`
            INSERT INTO tournament_standings (tournament_id, team_id, rank)
            VALUES ($1,$2,$3)
            ON CONFLICT DO NOTHING
          `, [t.id, standing.team.id, standing.rank ?? 0]);
        }
      }
    }
    done(`Serie ${s.year} ${s.season || s.full_name}: ${tournaments.length} tournaments`);

    // 2d. Teams in this serie
    const serieTeams = await apiGetAll(`/lol/series/${s.id}/teams`);
    for (const team of serieTeams) {
      allTeamIds.add(team.id);
      await upsert(`
        INSERT INTO teams (id, name, slug, acronym, location, image_url, dark_mode_image_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, acronym = EXCLUDED.acronym, image_url = EXCLUDED.image_url,
          dark_mode_image_url = EXCLUDED.dark_mode_image_url
      `, [team.id, team.name, team.slug, team.acronym, team.location,
          team.image_url, team.dark_mode_image_url || null]);
    }

    // 2e. Matches — ALL matches (not just finished), but only fetch game data for finished ones
    const matches = await apiGetAll(`/series/${s.id}/matches`);
    const finishedMatches = [];

    for (const m of matches) {
      const status = normStatus(m.status);
      await upsert(`
        INSERT INTO matches (id, tournament_id, serie_id, league_id, name, slug, match_type,
          number_of_games, status, begin_at, end_at, scheduled_at, original_scheduled_at,
          winner_id, winner_type, forfeit, draw, rescheduled, detailed_stats, stream_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status, winner_id = EXCLUDED.winner_id, end_at = EXCLUDED.end_at,
          winner_type = EXCLUDED.winner_type, stream_url = EXCLUDED.stream_url
      `, [m.id, m.tournament_id, s.id, leagueId, m.name, m.slug,
          m.match_type || null, m.number_of_games,
          status, m.begin_at, m.end_at,
          m.scheduled_at || null, m.original_scheduled_at || null,
          m.winner_id, m.winner_type || null,
          m.forfeit ?? false, m.draw ?? false, m.rescheduled ?? false,
          m.detailed_stats ?? false, m.streams_list?.[0]?.raw_url || null]);

      // Match opponents
      if (m.opponents) {
        for (let i = 0; i < m.opponents.length; i++) {
          const opp = m.opponents[i];
          const team = opp.opponent || opp;
          if (!team.id) continue;
          allTeamIds.add(team.id);
          const result = m.results?.[i];
          await upsert(`
            INSERT INTO match_opponents (match_id, team_id, side, result_score)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT DO NOTHING
          `, [m.id, team.id, i + 1, result?.score ?? null]);
        }
      }

      // Only process game data for finished matches
      if (status === 'finished' || m.winner_id) {
        finishedMatches.push(m);
      }
    }
    done(`Matches: ${matches.length} total (${finishedMatches.length} finished)`);

    seriesList.push({ ...s, finishedMatches, allMatches: matches, tournamentIds: tournaments.map(t => t.id) });
  }

  // 2f. Fetch player metadata (batch by 50)
  const playerIdArr = [...allPlayerIds];
  for (let i = 0; i < playerIdArr.length; i += 50) {
    const batch = playerIdArr.slice(i, i + 50);
    const { data: players } = await apiGet('/lol/players', { 'filter[id]': batch.join(','), per_page: 50 });
    if (players && Array.isArray(players)) {
      for (const p of players) {
        await upsert(`
          INSERT INTO players (id, name, first_name, last_name, slug, role, nationality, birthday,
            image_url, active, current_team_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, role = EXCLUDED.role, image_url = EXCLUDED.image_url,
            active = EXCLUDED.active, current_team_id = EXCLUDED.current_team_id
        `, [p.id, p.name, p.first_name, p.last_name, p.slug, normRole(p.role),
            p.nationality, p.birthday, p.image_url, p.active ?? null,
            p.current_team?.id || null]);
      }
    }
  }
  done(`Players: ${playerIdArr.length} metadata fetched`);

  return seriesList;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: GAME DATA
// ═══════════════════════════════════════════════════════════════════════════

async function phase3_games(seriesList) {
  section('PHASE 3: Game Data');

  let totalGames = 0;
  let totalPlayers = 0;

  for (const serie of seriesList) {
    log(`  Processing serie: ${serie.year} ${serie.season || serie.full_name}`);

    for (const match of serie.finishedMatches) {
      // Fetch games for this match
      const games = await apiGetAll(`/lol/matches/${match.id}/games`);

      for (let gi = 0; gi < games.length; gi++) {
        const game = games[gi];
        if (!game || !game.id) continue;

        const gameStatus = normStatus(game.status || (game.finished ? 'finished' : null));
        await upsert(`
          INSERT INTO games (id, match_id, tournament_id, serie_id, league_id, position,
            status, begin_at, end_at, length, patch, winner_id, winner_type,
            finished, forfeit, detailed_stats, complete)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status, winner_id = EXCLUDED.winner_id, finished = EXCLUDED.finished,
            length = COALESCE(EXCLUDED.length, games.length),
            winner_type = EXCLUDED.winner_type,
            patch = COALESCE(EXCLUDED.patch, games.patch),
            detailed_stats = EXCLUDED.detailed_stats,
            complete = EXCLUDED.complete,
            begin_at = COALESCE(EXCLUDED.begin_at, games.begin_at),
            end_at = COALESCE(EXCLUDED.end_at, games.end_at)
        `, [game.id, match.id, match.tournament_id, serie.id, LEAGUE_IDS[ARG_LEAGUE],
            game.position ?? gi + 1, gameStatus,
            game.begin_at, game.end_at, game.length,
            game.videogame_version?.name || game.videogame_version || game.match?.videogame_version?.name || game.patch || game.version || null, game.winner?.id || game.winner_id || null,
            game.winner?.type || game.winner_type || null,
            game.finished ?? game.status === 'finished', game.forfeit ?? false,
            game.detailed_stats ?? false, game.complete ?? false]);

        // Process teams + players from game.teams[]
        if (game.teams && Array.isArray(game.teams)) {
          for (const gt of game.teams) {
            const teamId = gt.team?.id || gt.id;
            if (!teamId) continue;

            const color = normColor(gt.color);
            // game_teams — including drake breakdown columns
            await upsert(`
              INSERT INTO game_teams (game_id, team_id, color, kills, gold_earned,
                tower_kills, inhibitor_kills, baron_kills, dragon_kills, herald_kills,
                voidgrub_kills, atakhan_kills, elder_drake_kills,
                chemtech_drake_kills, cloud_drake_kills, hextech_drake_kills,
                infernal_drake_kills, mountain_drake_kills, ocean_drake_kills,
                first_blood, first_tower, first_inhibitor, first_baron, first_dragon,
                first_herald, first_voidgrub, first_atakhan)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
              ON CONFLICT DO NOTHING
            `, [game.id, teamId, color,
                gt.kills ?? null, gt.gold_earned ?? null,
                gt.tower_kills ?? null, gt.inhibitor_kills ?? null, gt.baron_kills ?? null,
                gt.dragon_kills ?? null, gt.herald_kills ?? null,
                gt.voidgrub_kills ?? null, gt.atakhan_kills ?? null, gt.elder_drake_kills ?? null,
                gt.chemtech_drake_kills ?? null, gt.cloud_drake_kills ?? null, gt.hextech_drake_kills ?? null,
                gt.infernal_drake_kills ?? null, gt.mountain_drake_kills ?? null, gt.ocean_drake_kills ?? null,
                gt.first_blood ?? null, gt.first_tower ?? null, gt.first_inhibitor ?? null,
                gt.first_baron ?? null, gt.first_dragon ?? null,
                gt.first_herald ?? null, gt.first_voidgrub ?? null, gt.first_atakhan ?? null]);

            // Bans → game_picks_bans
            if (gt.bans) {
              for (let bi = 0; bi < gt.bans.length; bi++) {
                const banChampId = gt.bans[bi]?.id || gt.bans[bi];
                if (!banChampId) continue;
                await ensureChampionAlias(banChampId);
                await upsert(`
                  INSERT INTO game_picks_bans (game_id, team_id, champion_id, type, pick_turn)
                  VALUES ($1,$2,$3,'ban',$4)
                  ON CONFLICT DO NOTHING
                `, [game.id, teamId, banChampId, bi + 1]);
              }
            }

            // Players — column names matching schema exactly
            if (gt.players && Array.isArray(gt.players)) {
              for (const gp of gt.players) {
                const playerId = gp.id || gp.player?.id;
                if (!playerId) continue;

                const champId = gp.champion?.id || null;
                const role = normRole(gp.role);
                const opponentId = gp.opponent?.id || null;         // schema: opponent_id (team)
                const opponentChampId = gp.opponent?.champion?.id || null;

                // Auto-resolve unknown champion IDs
                if (champId) await ensureChampionAlias(champId);
                if (opponentChampId) await ensureChampionAlias(opponentChampId);

                // Damage extraction
                const td = gp.total_damage || gp.damage?.total || {};
                const pd = gp.physical_damage || gp.damage?.physical || {};
                const md = gp.magic_damage || gp.damage?.magic || {};
                const trd = gp.true_damage || gp.damage?.true_damage || {};
                const wards = gp.wards || {};
                const kc = gp.kills_counters || gp.kill_counters || {};
                const ks = gp.kills_series || {};
                const flags = gp.flags || {};

                const { rows } = await upsert(`
                  INSERT INTO game_players (
                    game_id, player_id, team_id, champion_id, role,
                    kills, deaths, assists, creep_score, minions_killed, cs_at_14, cs_diff_at_14,
                    gold_earned, gold_spent, gold_percentage, level,
                    total_damage_dealt, total_damage_dealt_to_champions, total_damage_taken,
                    total_damage_dealt_percentage, total_damage_dealt_to_champions_percentage,
                    physical_damage_dealt, physical_damage_dealt_to_champions, physical_damage_taken,
                    physical_damage_dealt_percentage, physical_damage_dealt_to_champions_percentage,
                    magic_damage_dealt, magic_damage_dealt_to_champions, magic_damage_taken,
                    magic_damage_dealt_percentage, magic_damage_dealt_to_champions_percentage,
                    true_damage_dealt, true_damage_dealt_to_champions, true_damage_taken,
                    true_damage_dealt_percentage, true_damage_dealt_to_champions_percentage,
                    total_heal, total_units_healed, total_time_crowd_control_dealt,
                    wards_placed, sight_wards_bought_in_game, vision_wards_bought_in_game,
                    kills_players, kills_turrets, kills_inhibitors, kills_wards,
                    kills_neutral_minions, kills_neutral_minions_enemy_jungle, kills_neutral_minions_team_jungle,
                    largest_killing_spree, largest_multi_kill, largest_critical_strike,
                    double_kills, triple_kills, quadra_kills, penta_kills,
                    first_blood_kill, first_blood_assist, first_tower_kill, first_tower_assist,
                    first_inhibitor_kill, first_inhibitor_assist,
                    spell_1_id, spell_2_id,
                    rune_primary_path_id, rune_secondary_path_id,
                    opponent_id, opponent_champion_id, items
                  )
                  VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                    $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
                    $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
                    $57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69
                  )
                  ON CONFLICT (game_id, player_id) DO UPDATE SET
                    team_id = COALESCE(EXCLUDED.team_id, game_players.team_id),
                    champion_id = COALESCE(EXCLUDED.champion_id, game_players.champion_id),
                    role = COALESCE(EXCLUDED.role, game_players.role),
                    kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, assists = EXCLUDED.assists,
                    creep_score = EXCLUDED.creep_score, minions_killed = EXCLUDED.minions_killed,
                    cs_at_14 = COALESCE(EXCLUDED.cs_at_14, game_players.cs_at_14),
                    cs_diff_at_14 = COALESCE(EXCLUDED.cs_diff_at_14, game_players.cs_diff_at_14),
                    gold_earned = EXCLUDED.gold_earned, gold_spent = EXCLUDED.gold_spent,
                    gold_percentage = EXCLUDED.gold_percentage, level = EXCLUDED.level,
                    total_damage_dealt = EXCLUDED.total_damage_dealt,
                    total_damage_dealt_to_champions = EXCLUDED.total_damage_dealt_to_champions,
                    total_damage_taken = EXCLUDED.total_damage_taken,
                    total_damage_dealt_percentage = EXCLUDED.total_damage_dealt_percentage,
                    total_damage_dealt_to_champions_percentage = EXCLUDED.total_damage_dealt_to_champions_percentage,
                    physical_damage_dealt = EXCLUDED.physical_damage_dealt,
                    physical_damage_dealt_to_champions = EXCLUDED.physical_damage_dealt_to_champions,
                    physical_damage_taken = EXCLUDED.physical_damage_taken,
                    magic_damage_dealt = EXCLUDED.magic_damage_dealt,
                    magic_damage_dealt_to_champions = EXCLUDED.magic_damage_dealt_to_champions,
                    magic_damage_taken = EXCLUDED.magic_damage_taken,
                    true_damage_dealt = EXCLUDED.true_damage_dealt,
                    true_damage_dealt_to_champions = EXCLUDED.true_damage_dealt_to_champions,
                    true_damage_taken = EXCLUDED.true_damage_taken,
                    total_heal = EXCLUDED.total_heal, total_units_healed = EXCLUDED.total_units_healed,
                    total_time_crowd_control_dealt = EXCLUDED.total_time_crowd_control_dealt,
                    wards_placed = EXCLUDED.wards_placed,
                    sight_wards_bought_in_game = EXCLUDED.sight_wards_bought_in_game,
                    vision_wards_bought_in_game = EXCLUDED.vision_wards_bought_in_game,
                    kills_players = EXCLUDED.kills_players, kills_turrets = EXCLUDED.kills_turrets,
                    kills_inhibitors = EXCLUDED.kills_inhibitors, kills_wards = EXCLUDED.kills_wards,
                    kills_neutral_minions = EXCLUDED.kills_neutral_minions,
                    largest_killing_spree = COALESCE(EXCLUDED.largest_killing_spree, game_players.largest_killing_spree),
                    largest_multi_kill = COALESCE(EXCLUDED.largest_multi_kill, game_players.largest_multi_kill),
                    largest_critical_strike = COALESCE(EXCLUDED.largest_critical_strike, game_players.largest_critical_strike),
                    double_kills = EXCLUDED.double_kills, triple_kills = EXCLUDED.triple_kills,
                    quadra_kills = EXCLUDED.quadra_kills, penta_kills = EXCLUDED.penta_kills,
                    first_blood_kill = EXCLUDED.first_blood_kill, first_blood_assist = EXCLUDED.first_blood_assist,
                    spell_1_id = COALESCE(EXCLUDED.spell_1_id, game_players.spell_1_id),
                    spell_2_id = COALESCE(EXCLUDED.spell_2_id, game_players.spell_2_id),
                    rune_primary_path_id = COALESCE(EXCLUDED.rune_primary_path_id, game_players.rune_primary_path_id),
                    rune_secondary_path_id = COALESCE(EXCLUDED.rune_secondary_path_id, game_players.rune_secondary_path_id),
                    items = EXCLUDED.items
                  RETURNING id
                `, [
                  game.id, playerId, teamId, champId, role,
                  gp.kills ?? null, gp.deaths ?? null, gp.assists ?? null,
                  gp.creep_score ?? null, gp.minions_killed ?? null,
                  gp.cs_at_14 ?? null, gp.cs_diff_at_14 ?? null,
                  gp.gold_earned ?? null, gp.gold_spent ?? null, gp.gold_percentage ?? null,
                  gp.level ?? null,
                  // total damage
                  td.dealt ?? null, td.dealt_to_champions ?? null, td.taken ?? null,
                  td.dealt_percentage ?? null, td.dealt_to_champions_percentage ?? null,
                  // physical damage
                  pd.dealt ?? null, pd.dealt_to_champions ?? null, pd.taken ?? null,
                  pd.dealt_percentage ?? null, pd.dealt_to_champions_percentage ?? null,
                  // magic damage
                  md.dealt ?? null, md.dealt_to_champions ?? null, md.taken ?? null,
                  md.dealt_percentage ?? null, md.dealt_to_champions_percentage ?? null,
                  // true damage
                  trd.dealt ?? null, trd.dealt_to_champions ?? null, trd.taken ?? null,
                  trd.dealt_percentage ?? null, trd.dealt_to_champions_percentage ?? null,
                  // heal/cc
                  gp.total_heal ?? null, gp.total_units_healed ?? null, gp.total_time_crowd_control_dealt ?? null,
                  // wards
                  wards.placed ?? null, wards.sight_wards_bought_in_game ?? null,
                  wards.vision_wards_bought_in_game ?? null,
                  // kill counters
                  kc.players ?? null, kc.turrets ?? null, kc.inhibitors ?? null, kc.wards ?? null,
                  kc.neutral_minions ?? null, kc.neutral_minions_enemy_jungle ?? null,
                  kc.neutral_minions_team_jungle ?? null,
                  // kill series
                  ks.largest_killing_spree ?? gp.largest_killing_spree ?? null,
                  ks.largest_multi_kill ?? gp.largest_multi_kill ?? null,
                  ks.largest_critical_strike ?? gp.largest_critical_strike ?? null,
                  ks.double_kills ?? gp.double_kills ?? null, ks.triple_kills ?? gp.triple_kills ?? null,
                  ks.quadra_kills ?? gp.quadra_kills ?? null, ks.penta_kills ?? gp.penta_kills ?? null,
                  // flags
                  flags.first_blood_kill ?? gp.first_blood_kill ?? false,
                  flags.first_blood_assist ?? gp.first_blood_assist ?? false,
                  flags.first_tower_kill ?? gp.first_tower_kill ?? false,
                  flags.first_tower_assist ?? gp.first_tower_assist ?? false,
                  flags.first_inhibitor_kill ?? gp.first_inhibitor_kill ?? false,
                  flags.first_inhibitor_assist ?? gp.first_inhibitor_assist ?? false,
                  // spells
                  gp.spells?.[0]?.id ?? gp.spell1_id ?? null, gp.spells?.[1]?.id ?? gp.spell2_id ?? null,
                  // runes
                  gp.runes_reforged?.primary_path?.id ?? null,
                  gp.runes_reforged?.secondary_path?.id ?? null,
                  // opponent
                  opponentId, opponentChampId,
                  // items
                  gp.items ? gp.items.map(i => i?.id || i) : null,
                ]);

                // Pick entry
                if (champId) {
                  await upsert(`
                    INSERT INTO game_picks_bans (game_id, team_id, champion_id, type)
                    VALUES ($1,$2,$3,'pick')
                    ON CONFLICT DO NOTHING
                  `, [game.id, teamId, champId]);
                }

                // Upsert rune paths from game data (Domination=1, etc.)
                await upsertRunePathsFromPlayer(gp);

                // Player runes — slot assignment:
                //   0 = keystone, 1-3 = primary lesser, 4-5 = secondary lesser
                //   6 = shard offense, 7 = shard flex, 8 = shard defense
                const gpId = rows?.[0]?.id;
                if (gpId && gp.runes_reforged) {
                  // First, delete existing runes for this player (safe re-run)
                  await upsert(`DELETE FROM game_player_runes WHERE game_player_id = $1`, [gpId]);

                  const rr = gp.runes_reforged;
                  const runeInserts = [];

                  // Keystone → slot 0
                  if (rr.primary_path?.keystone?.id) runeInserts.push([gpId, rr.primary_path.keystone.id, 'primary', 0]);
                  // Primary lesser runes → slots 1-3
                  (rr.primary_path?.lesser_runes || []).forEach((r, i) => {
                    if (r?.id) runeInserts.push([gpId, r.id, 'primary', i + 1]);
                  });
                  // Secondary lesser runes → slots 4-5
                  (rr.secondary_path?.lesser_runes || []).forEach((r, i) => {
                    if (r?.id) runeInserts.push([gpId, r.id, 'secondary', i + 4]);
                  });
                  // Shards → slots 6 (offense), 7 (flex), 8 (defense) — each is distinct
                  if (rr.shards?.offense?.id) runeInserts.push([gpId, rr.shards.offense.id, 'primary', 6]);
                  if (rr.shards?.flex?.id) runeInserts.push([gpId, rr.shards.flex.id, 'primary', 7]);
                  if (rr.shards?.defense?.id) runeInserts.push([gpId, rr.shards.defense.id, 'primary', 8]);

                  for (const [gpi, runeId, tree, slot] of runeInserts) {
                    await upsert(`
                      INSERT INTO game_player_runes (game_player_id, rune_id, tree, slot)
                      VALUES ($1,$2,$3,$4)
                      ON CONFLICT (game_player_id, slot) DO UPDATE SET rune_id = EXCLUDED.rune_id, tree = EXCLUDED.tree
                    `, [gpi, runeId, tree, slot]);
                  }
                }

                totalPlayers++;
              }
            }
          }
        }

        // ─── Fallback: fetch game detail when teams[].players, bans or patch are missing ───
        // PandaScore /matches/{id}/games returns teams without players/bans/patch,
        // but /lol/games/{id} returns full data including teams[].bans[], players[] and patch.
        const hasTeamPlayers = game.teams?.some(t => t.players?.length > 0);
        const hasTeamBans = game.teams?.some(t => t.bans?.length > 0);
        const hasPatch = !!(game.videogame_version?.name || game.videogame_version || game.match?.videogame_version?.name || game.patch || game.version);
        let gamePlayers = game.players;
        let gameDetail = null;
        if ((!hasTeamPlayers || !hasTeamBans || !hasPatch) && game.id) {
          const resp = await apiGet(`/lol/games/${game.id}`);
          gameDetail = resp.data;
          if (!hasTeamPlayers && gameDetail?.players?.length > 0) gamePlayers = gameDetail.players;
          // Backfill patch from game detail
          if (!hasPatch && gameDetail) {
            const detailPatch = gameDetail.videogame_version?.name || gameDetail.videogame_version || gameDetail.match?.videogame_version?.name || gameDetail.patch || gameDetail.version || null;
            if (detailPatch) {
              await upsert(`UPDATE games SET patch = $1 WHERE id = $2 AND patch IS NULL`, [detailPatch, game.id]);
            }
          }
        }

        // Process bans from gameDetail when original teams didn't have them
        if (!hasTeamBans && gameDetail?.teams?.length > 0) {
          for (const gt of gameDetail.teams) {
            const teamId = gt.team?.id || gt.id;
            if (!teamId || !gt.bans?.length) continue;
            for (let bi = 0; bi < gt.bans.length; bi++) {
              const banChampId = gt.bans[bi]?.id || gt.bans[bi];
              if (!banChampId) continue;
              await ensureChampionAlias(banChampId);
              await upsert(`
                INSERT INTO game_picks_bans (game_id, team_id, champion_id, type, pick_turn)
                VALUES ($1,$2,$3,'ban',$4)
                ON CONFLICT DO NOTHING
              `, [game.id, teamId, banChampId, bi + 1]);
            }
          }
        }
        if (!hasTeamPlayers && gamePlayers?.length > 0) {
          for (const gp of gamePlayers) {
            const playerId = gp.player_id || gp.id || gp.player?.id;
            if (!playerId) continue;

            const teamId = gp.team?.id || null;
            const champId = gp.champion?.id || null;
            const role = normRole(gp.role);
            const opponentId = gp.opponent?.id || null;
            const opponentChampId = gp.opponent?.champion?.id || null;

            if (champId) await ensureChampionAlias(champId);
            if (opponentChampId) await ensureChampionAlias(opponentChampId);

            const td = gp.total_damage || gp.damage?.total || {};
            const pd = gp.physical_damage || gp.damage?.physical || {};
            const md = gp.magic_damage || gp.damage?.magic || {};
            const trd = gp.true_damage || gp.damage?.true_damage || {};
            const wards = gp.wards || {};
            const kc = gp.kills_counters || gp.kill_counters || {};
            const ks = gp.kills_series || {};
            const flags = gp.flags || {};

            const { rows } = await upsert(`
              INSERT INTO game_players (
                game_id, player_id, team_id, champion_id, role,
                kills, deaths, assists, creep_score, minions_killed, cs_at_14, cs_diff_at_14,
                gold_earned, gold_spent, gold_percentage, level,
                total_damage_dealt, total_damage_dealt_to_champions, total_damage_taken,
                total_damage_dealt_percentage, total_damage_dealt_to_champions_percentage,
                physical_damage_dealt, physical_damage_dealt_to_champions, physical_damage_taken,
                physical_damage_dealt_percentage, physical_damage_dealt_to_champions_percentage,
                magic_damage_dealt, magic_damage_dealt_to_champions, magic_damage_taken,
                magic_damage_dealt_percentage, magic_damage_dealt_to_champions_percentage,
                true_damage_dealt, true_damage_dealt_to_champions, true_damage_taken,
                true_damage_dealt_percentage, true_damage_dealt_to_champions_percentage,
                total_heal, total_units_healed, total_time_crowd_control_dealt,
                wards_placed, sight_wards_bought_in_game, vision_wards_bought_in_game,
                kills_players, kills_turrets, kills_inhibitors, kills_wards,
                kills_neutral_minions, kills_neutral_minions_enemy_jungle, kills_neutral_minions_team_jungle,
                largest_killing_spree, largest_multi_kill, largest_critical_strike,
                double_kills, triple_kills, quadra_kills, penta_kills,
                first_blood_kill, first_blood_assist, first_tower_kill, first_tower_assist,
                first_inhibitor_kill, first_inhibitor_assist,
                spell_1_id, spell_2_id,
                rune_primary_path_id, rune_secondary_path_id,
                opponent_id, opponent_champion_id, items
              )
              VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
                $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
                $57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69
              )
              ON CONFLICT (game_id, player_id) DO UPDATE SET
                team_id = COALESCE(EXCLUDED.team_id, game_players.team_id),
                champion_id = COALESCE(EXCLUDED.champion_id, game_players.champion_id),
                role = COALESCE(EXCLUDED.role, game_players.role),
                kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, assists = EXCLUDED.assists,
                creep_score = EXCLUDED.creep_score, minions_killed = EXCLUDED.minions_killed,
                cs_at_14 = COALESCE(EXCLUDED.cs_at_14, game_players.cs_at_14),
                cs_diff_at_14 = COALESCE(EXCLUDED.cs_diff_at_14, game_players.cs_diff_at_14),
                gold_earned = EXCLUDED.gold_earned, gold_spent = EXCLUDED.gold_spent,
                gold_percentage = EXCLUDED.gold_percentage, level = EXCLUDED.level,
                total_damage_dealt = EXCLUDED.total_damage_dealt,
                total_damage_dealt_to_champions = EXCLUDED.total_damage_dealt_to_champions,
                total_damage_taken = EXCLUDED.total_damage_taken
            `, [game.id, playerId, teamId, champId, role,
                gp.kills ?? null, gp.deaths ?? null, gp.assists ?? null,
                gp.creep_score ?? null, gp.minions_killed ?? null,
                gp.cs_at_14 ?? null, gp.cs_diff_at_14 ?? null,
                gp.gold_earned ?? null, gp.gold_spent ?? null, gp.gold_percentage ?? null, gp.level ?? null,
                td.dealt ?? null, td.dealt_to_champions ?? null, td.taken ?? null,
                td.dealt_percentage ?? null, td.dealt_to_champions_percentage ?? null,
                pd.dealt ?? null, pd.dealt_to_champions ?? null, pd.taken ?? null,
                pd.dealt_percentage ?? null, pd.dealt_to_champions_percentage ?? null,
                md.dealt ?? null, md.dealt_to_champions ?? null, md.taken ?? null,
                md.dealt_percentage ?? null, md.dealt_to_champions_percentage ?? null,
                trd.dealt ?? null, trd.dealt_to_champions ?? null, trd.taken ?? null,
                trd.dealt_percentage ?? null, trd.dealt_to_champions_percentage ?? null,
                gp.total_heal ?? null, gp.total_units_healed ?? null, gp.total_time_crowd_control_dealt ?? null,
                wards.placed ?? null, wards.sight_wards_bought_in_game ?? null,
                wards.vision_wards_bought_in_game ?? null,
                kc.players ?? null, kc.turrets ?? null, kc.inhibitors ?? null, kc.wards ?? null,
                kc.neutral_minions ?? null, kc.neutral_minions_enemy_jungle ?? null,
                kc.neutral_minions_team_jungle ?? null,
                ks.largest_killing_spree ?? gp.largest_killing_spree ?? null,
                ks.largest_multi_kill ?? gp.largest_multi_kill ?? null,
                ks.largest_critical_strike ?? gp.largest_critical_strike ?? null,
                ks.double_kills ?? gp.double_kills ?? null, ks.triple_kills ?? gp.triple_kills ?? null,
                ks.quadra_kills ?? gp.quadra_kills ?? null, ks.penta_kills ?? gp.penta_kills ?? null,
                flags.first_blood_kill ?? gp.first_blood_kill ?? false,
                flags.first_blood_assist ?? gp.first_blood_assist ?? false,
                flags.first_tower_kill ?? gp.first_tower_kill ?? false,
                flags.first_tower_assist ?? gp.first_tower_assist ?? false,
                flags.first_inhibitor_kill ?? gp.first_inhibitor_kill ?? false,
                flags.first_inhibitor_assist ?? gp.first_inhibitor_assist ?? false,
                gp.spells?.[0]?.id ?? gp.spell1_id ?? null, gp.spells?.[1]?.id ?? gp.spell2_id ?? null,
                gp.runes_reforged?.primary_path?.id ?? null,
                gp.runes_reforged?.secondary_path?.id ?? null,
                opponentId, opponentChampId,
                gp.items ? gp.items.map(i => i?.id || i) : null,
            ]);

            if (champId && teamId) {
              await upsert(`
                INSERT INTO game_picks_bans (game_id, team_id, champion_id, type)
                VALUES ($1,$2,$3,'pick')
                ON CONFLICT DO NOTHING
              `, [game.id, teamId, champId]);
            }

            await upsertRunePathsFromPlayer(gp);

            const gpId = rows?.[0]?.id;
            if (gpId && gp.runes_reforged) {
              await upsert(`DELETE FROM game_player_runes WHERE game_player_id = $1`, [gpId]);
              const rr = gp.runes_reforged;
              const runeInserts = [];
              if (rr.primary_path?.keystone?.id) runeInserts.push([gpId, rr.primary_path.keystone.id, 'primary', 0]);
              (rr.primary_path?.lesser_runes || []).forEach((r, i) => { if (r?.id) runeInserts.push([gpId, r.id, 'primary', i + 1]); });
              (rr.secondary_path?.lesser_runes || []).forEach((r, i) => { if (r?.id) runeInserts.push([gpId, r.id, 'secondary', i + 4]); });
              if (rr.shards?.offense?.id) runeInserts.push([gpId, rr.shards.offense.id, 'primary', 6]);
              if (rr.shards?.flex?.id) runeInserts.push([gpId, rr.shards.flex.id, 'primary', 7]);
              if (rr.shards?.defense?.id) runeInserts.push([gpId, rr.shards.defense.id, 'primary', 8]);
              for (const [gpi, runeId, tree, slot] of runeInserts) {
                await upsert(`
                  INSERT INTO game_player_runes (game_player_id, rune_id, tree, slot)
                  VALUES ($1,$2,$3,$4)
                  ON CONFLICT (game_player_id, slot) DO UPDATE SET rune_id = EXCLUDED.rune_id, tree = EXCLUDED.tree
                `, [gpi, runeId, tree, slot]);
              }
            }
            totalPlayers++;
          }
        }

        totalGames++;
      }
    }
    done(`Serie ${serie.year} ${serie.season}: games processed`);
  }

  done(`Total: ${totalGames} games, ${totalPlayers} game_players`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4: TIMELINE (frames + events)
// ═══════════════════════════════════════════════════════════════════════════

async function phase4_timeline(seriesList) {
  section('PHASE 4: Timeline');

  let frameCount = 0;
  let eventCount = 0;

  for (const serie of seriesList) {
    for (const match of serie.finishedMatches) {
      const games = await apiGetAll(`/lol/matches/${match.id}/games`);

      for (const game of games) {
        if (!game?.id) continue;

        // Frames — including blue_team_id, red_team_id
        const { data: frames } = await apiGet(`/lol/games/${game.id}/frames`);
        if (frames && Array.isArray(frames)) {
          // Delete existing frames + frame_players for clean re-insert
          await pool.query(`DELETE FROM game_frame_players WHERE frame_id IN (SELECT id FROM game_frames WHERE game_id = $1)`, [game.id]);
          await pool.query(`DELETE FROM game_frames WHERE game_id = $1`, [game.id]);

          for (const frame of frames) {
            const ts = frame.current_timestamp ?? frame.timestamp;
            if (ts == null) continue;

            const blue = frame.blue || {};
            const red = frame.red || {};

            const { rows: frameInsRows } = await upsert(`
              INSERT INTO game_frames (game_id, timestamp,
                blue_team_id, blue_gold, blue_kills, blue_towers, blue_drakes, blue_nashors,
                blue_heralds, blue_inhibitors, blue_voidgrubs, blue_atakhans, blue_score,
                red_team_id, red_gold, red_kills, red_towers, red_drakes, red_nashors,
                red_heralds, red_inhibitors, red_voidgrubs, red_atakhans, red_score)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
              ON CONFLICT (game_id, timestamp) DO UPDATE SET
                blue_gold = EXCLUDED.blue_gold, blue_kills = EXCLUDED.blue_kills,
                red_gold = EXCLUDED.red_gold, red_kills = EXCLUDED.red_kills
              RETURNING id
            `, [game.id, ts,
                blue.team_id ?? null, blue.gold ?? null, blue.kills ?? null, blue.towers ?? null,
                blue.drakes ?? null, blue.nashors ?? null, blue.heralds ?? null,
                blue.inhibitors ?? null, blue.voidgrubs ?? null, blue.atakhans ?? null, blue.score ?? null,
                red.team_id ?? null, red.gold ?? null, red.kills ?? null, red.towers ?? null,
                red.drakes ?? null, red.nashors ?? null, red.heralds ?? null,
                red.inhibitors ?? null, red.voidgrubs ?? null, red.atakhans ?? null, red.score ?? null]);

            frameCount++;

            // Frame players (per role for each side)
            const frameId = frameInsRows?.[0]?.id;
            if (frameId) {
              for (const [side, sideColor] of [['blue', 'blue'], ['red', 'red']]) {
                const sideData = frame[side] || {};
                const playersObj = sideData.players || sideData;
                for (const role of ['top', 'jun', 'mid', 'adc', 'sup']) {
                  const rp = playersObj[role] || sideData[role];
                  if (!rp) continue;
                  const fpChampId = rp.champion?.id ?? null;
                  if (fpChampId) await ensureChampionAlias(fpChampId);
                  await upsert(`
                    INSERT INTO game_frame_players (frame_id, player_id, champion_id, team_color, role,
                      kills, deaths, assists, cs, level)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    ON CONFLICT DO NOTHING
                  `, [frameId, rp.player_id ?? rp.id ?? null, fpChampId,
                      sideColor, role,
                      rp.kills ?? null, rp.deaths ?? null, rp.assists ?? null,
                      rp.cs ?? null, rp.level ?? null]);
                }
              }
            }
          }
        }

        // Events
        const { data: events } = await apiGet(`/lol/games/${game.id}/events`);
        if (events && Array.isArray(events)) {
          // Delete existing events for clean re-insert
          await pool.query(`DELETE FROM game_events WHERE game_id = $1`, [game.id]);
          for (const ev of events) {
            if (!VALID_EVENT_TYPES.has(ev.type)) continue;
            const e = extractEvent(ev);

            const { rows: evRows } = await upsert(`
              INSERT INTO game_events (game_id, timestamp, type,
                killer_player_id, killer_champion_id, victim_player_id, victim_champion_id,
                is_first)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [game.id, e.timestamp, e.type,
                e.killer_player_id, e.killer_champion_id,
                e.victim_player_id, e.victim_champion_id,
                e.is_first]);

            if (evRows?.[0]?.id && e.assistants) {
              const eventId = evRows[0].id;
              const assists = typeof e.assistants === 'string' ? JSON.parse(e.assistants) : e.assistants;
              if (Array.isArray(assists)) {
                for (const a of assists) {
                  if (a.player_id) {
                    await upsert(`INSERT INTO game_event_assists (event_id, player_id, champion_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [eventId, a.player_id, a.champion_id ?? null]);
                  }
                }
              }
            }
            eventCount++;
          }
        }
      }
    }
    done(`Serie ${serie.year} ${serie.season}: timeline processed`);
  }

  done(`Total: ${frameCount} frames, ${eventCount} events`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: PRE-COMPUTED STATS
// ═══════════════════════════════════════════════════════════════════════════

async function phase5_stats(seriesList) {
  section('PHASE 5: Pre-computed Stats');

  for (const serie of seriesList) {
    // ─── 5a. Player career stats (per serie) — all 56 schema columns ────────
    const playerCareer = await apiGetAll(`/lol/series/${serie.id}/players/stats`);
    for (const pc of playerCareer) {
      if (!pc.player?.id) continue;
      const s = pc.stats || pc;
      const a = s.average || s.averages || {};
      const t = s.total || s.totals || {};

      await upsert(`
        INSERT INTO player_career (
          player_id, serie_id, team_id, role,
          games, wins, losses, win_rate, avg_duration, unique_champions,
          blue_games, blue_wins, red_games, red_wins,
          total_kills, total_deaths, total_assists,
          kills_avg, deaths_avg, assists_avg, kda, kill_participation, max_kills,
          first_blood_rate, first_tower_rate,
          double_kills, triple_kills, quadra_kills, penta_kills,
          avg_dtaken_pm, avg_magic_dpm, avg_physical_dpm, avg_true_dpm,
          avg_cc_per_min, avg_heal_per_min,
          cspm, gpm, dpm, dmg_share, gold_share, avg_gold_spent,
          avg_cs_diff_13, avg_cs_diff_14, avg_cs_diff_20, avg_cs_diff_25,
          avg_level_diff_13, avg_level_diff_20, avg_level_diff_25,
          avg_kills_diff_13, avg_kills_diff_20, avg_kills_diff_25,
          avg_vspm, avg_wpm, avg_wkpm, avg_cwpm
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
          $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55
        )
        ON CONFLICT (player_id, serie_id) DO UPDATE SET
          games = EXCLUDED.games, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
          kda = EXCLUDED.kda, kills_avg = EXCLUDED.kills_avg, deaths_avg = EXCLUDED.deaths_avg,
          assists_avg = EXCLUDED.assists_avg, gpm = EXCLUDED.gpm, dpm = EXCLUDED.dpm,
          cspm = EXCLUDED.cspm, win_rate = EXCLUDED.win_rate,
          kill_participation = COALESCE(EXCLUDED.kill_participation, player_career.kill_participation),
          avg_cs_diff_13 = COALESCE(EXCLUDED.avg_cs_diff_13, player_career.avg_cs_diff_13),
          avg_cs_diff_14 = COALESCE(EXCLUDED.avg_cs_diff_14, player_career.avg_cs_diff_14),
          avg_cs_diff_20 = COALESCE(EXCLUDED.avg_cs_diff_20, player_career.avg_cs_diff_20),
          avg_cs_diff_25 = COALESCE(EXCLUDED.avg_cs_diff_25, player_career.avg_cs_diff_25),
          avg_level_diff_13 = COALESCE(EXCLUDED.avg_level_diff_13, player_career.avg_level_diff_13),
          avg_level_diff_20 = COALESCE(EXCLUDED.avg_level_diff_20, player_career.avg_level_diff_20),
          avg_level_diff_25 = COALESCE(EXCLUDED.avg_level_diff_25, player_career.avg_level_diff_25),
          avg_kills_diff_13 = COALESCE(EXCLUDED.avg_kills_diff_13, player_career.avg_kills_diff_13),
          avg_kills_diff_20 = COALESCE(EXCLUDED.avg_kills_diff_20, player_career.avg_kills_diff_20),
          avg_kills_diff_25 = COALESCE(EXCLUDED.avg_kills_diff_25, player_career.avg_kills_diff_25)
      `, [
        pc.player.id, serie.id, pc.team?.id ?? null, normRole(pc.player?.role) || null,
        s.games_count ?? null, s.wins ?? null, s.losses ?? null,
        s.win_rate ?? (s.games_count ? (s.wins / s.games_count) : null),
        a.game_length ?? a.duration ?? null, s.unique_champions ?? null,
        s.blue_games ?? null, s.blue_wins ?? null, s.red_games ?? null, s.red_wins ?? null,
        t.kills ?? s.kills ?? null, t.deaths ?? s.deaths ?? null, t.assists ?? s.assists ?? null,
        a.kills ?? null, a.deaths ?? null, a.assists ?? null, s.kda ?? a.kda ?? null,
        a.kill_participation ?? s.kill_participation ?? null, s.max_kills ?? null,
        s.first_blood_percentage ?? null, s.first_tower_percentage ?? null,
        t.double_kills ?? s.double_kills ?? null, t.triple_kills ?? s.triple_kills ?? null,
        t.quadra_kills ?? s.quadra_kills ?? null, t.penta_kills ?? s.penta_kills ?? null,
        a.damage_taken_per_minute ?? null, a.magic_damage_per_minute ?? null,
        a.physical_damage_per_minute ?? null, a.true_damage_per_minute ?? null,
        a.cc_per_minute ?? null, a.heal_per_minute ?? null,
        a.cs_per_minute ?? null, a.gold_per_minute ?? null, a.damage_per_minute ?? null,
        a.damage_percentage ?? null, a.gold_percentage ?? null, a.gold_spent ?? null,
        a.cs_diff_at_13 ?? null, a.cs_diff_at_14 ?? null, a.cs_diff_at_20 ?? null, a.cs_diff_at_25 ?? null,
        a.level_diff_at_13 ?? null, a.level_diff_at_20 ?? null, a.level_diff_at_25 ?? null,
        a.kills_diff_at_13 ?? null, a.kills_diff_at_20 ?? null, a.kills_diff_at_25 ?? null,
        a.vision_score_per_minute ?? null, a.wards_per_minute ?? null,
        a.wards_killed_per_minute ?? null, a.control_wards_per_minute ?? null,
      ]);

      // Insert player keystones from game data
      await upsert(`
        INSERT INTO player_keystones (player_id, serie_id, rune_id, rune_name, games, wins)
        SELECT gp.player_id, $1, gpr.rune_id, r.name, COUNT(*) AS games,
          SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_player_runes gpr ON gpr.game_player_id = gp.id AND gpr.slot = 0
        JOIN runes r ON r.id = gpr.rune_id
        WHERE g.serie_id = $1 AND gp.player_id = $2
        GROUP BY gp.player_id, gpr.rune_id, r.name
        ON CONFLICT (player_id, serie_id, rune_id) DO UPDATE SET
          games = EXCLUDED.games, wins = EXCLUDED.wins, rune_name = EXCLUDED.rune_name
      `, [serie.id, pc.player.id]);
    }
    done(`Serie ${serie.year} ${serie.season}: ${playerCareer.length} player_career`);

    // ─── 5b. Team career stats (per serie) — all 82 schema columns ──────────
    const teamCareer = await apiGetAll(`/lol/series/${serie.id}/teams/stats`);
    for (const tc of teamCareer) {
      if (!tc.team?.id) continue;
      const s = tc.stats || tc;
      const a = s.average || s.averages || {};
      const t = s.total || s.totals || {};

      const db = {};
      if (tc.drake_breakdown) {
        const arr = Array.isArray(tc.drake_breakdown) ? tc.drake_breakdown : Object.entries(tc.drake_breakdown).map(([k,v]) => ({type:k,...v}));
        for (const d of arr) db[d.type] = d.average ?? d.count ?? 0;
      }

      await upsert(`
        INSERT INTO team_career (
          team_id, serie_id,
          games, wins, losses, win_rate, avg_duration, avg_win_duration, avg_loss_duration,
          unique_champions, total_kills, total_deaths, total_assists,
          kills_avg, deaths_avg, assists_avg, kda,
          avg_cspm, gpm, egpm, dpm, delta_gpm, delta_cspm,
          blue_games, blue_wins, red_games, red_wins,
          avg_dtaken_pm, avg_magic_dpm, avg_physical_dpm, avg_true_dpm,
          avg_cc_per_min, avg_heal_per_min,
          avg_gold_diff_13, avg_gold_diff_14, avg_gold_diff_20, avg_gold_diff_25,
          avg_cs_diff_13, avg_cs_diff_14, avg_cs_diff_20, avg_cs_diff_25,
          avg_kills_diff_13, avg_kills_diff_14, avg_kills_diff_20, avg_kills_diff_25,
          avg_tower_diff_13, avg_tower_diff_20, avg_tower_diff_25,
          avg_drake_diff_13, avg_drake_diff_20, avg_drake_diff_25,
          avg_neutral_minions_team, avg_neutral_minions_enemy,
          avg_towers, avg_towers_lost, avg_plates, avg_inhibitors,
          avg_dragons, avg_elder_dragons, avg_barons, avg_heralds, avg_voidgrubs, avg_atakhans,
          avg_chemtech_drakes, avg_cloud_drakes, avg_hextech_drakes, avg_infernal_drakes, avg_mountain_drakes, avg_ocean_drakes,
          first_blood_rate, first_tower_rate, first_dragon_rate, dragon_soul_rate,
          first_elder_rate, first_baron_rate, first_herald_rate, first_voidgrub_rate,
          first_atakhan_rate, first_inhibitor_rate,
          avg_wpm, avg_wkpm, avg_cwpm
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
          $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
          $57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$70,$71,$72,$73,$74,$75,$76,
          $77,$78,$79,$80,$81,$82
        )
        ON CONFLICT (team_id, serie_id) DO UPDATE SET
          games = EXCLUDED.games, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
          kda = EXCLUDED.kda, gpm = EXCLUDED.gpm, dpm = EXCLUDED.dpm,
          win_rate = EXCLUDED.win_rate
      `, [
        tc.team.id, serie.id,
        s.games_count ?? null, s.wins ?? null, s.losses ?? null,
        s.win_rate ?? (s.games_count ? (s.wins / s.games_count) : null),
        a.game_length ?? a.duration ?? null, a.win_game_length ?? null, a.loss_game_length ?? null,
        s.unique_champions ?? null,
        t.kills ?? s.kills ?? null, t.deaths ?? s.deaths ?? null, t.assists ?? s.assists ?? null,
        a.kills ?? null, a.deaths ?? null, a.assists ?? null, s.kda ?? a.kda ?? null,
        a.cs_per_minute ?? null, a.gold_per_minute ?? null, a.earned_gold_per_minute ?? null,
        a.damage_per_minute ?? null, a.delta_gold_per_minute ?? null, a.delta_cs_per_minute ?? null,
        s.blue_games ?? null, s.blue_wins ?? null, s.red_games ?? null, s.red_wins ?? null,
        a.damage_taken_per_minute ?? null, a.magic_damage_per_minute ?? null,
        a.physical_damage_per_minute ?? null, a.true_damage_per_minute ?? null,
        a.cc_per_minute ?? null, a.heal_per_minute ?? null,
        // Diffs
        a.gold_diff_at_13 ?? null, a.gold_diff_at_14 ?? null, a.gold_diff_at_20 ?? null, a.gold_diff_at_25 ?? null,
        a.cs_diff_at_13 ?? null, a.cs_diff_at_14 ?? null, a.cs_diff_at_20 ?? null, a.cs_diff_at_25 ?? null,
        a.kills_diff_at_13 ?? null, a.kills_diff_at_14 ?? null, a.kills_diff_at_20 ?? null, a.kills_diff_at_25 ?? null,
        a.tower_diff_at_13 ?? null, a.tower_diff_at_20 ?? null, a.tower_diff_at_25 ?? null,
        a.drake_diff_at_13 ?? null, a.drake_diff_at_20 ?? null, a.drake_diff_at_25 ?? null,
        a.neutral_minions_team ?? null, a.neutral_minions_enemy ?? null,
        a.tower_kills ?? null, a.towers_lost ?? null, a.plates ?? null, a.inhibitor_kills ?? null,
        a.dragon_kills ?? null, a.elder_drake_kills ?? null, a.baron_kills ?? null,
        a.herald_kills ?? null, a.voidgrub_kills ?? null, a.atakhan_kills ?? null,
        db.chemtech ?? null, db.cloud ?? null, db.hextech ?? null, db.infernal ?? null, db.mountain ?? null, db.ocean ?? null,
        s.first_blood_percentage ?? null, s.first_tower_percentage ?? null,
        s.first_dragon_percentage ?? null, s.dragon_soul_percentage ?? null,
        s.first_elder_percentage ?? null, s.first_baron_percentage ?? null,
        s.first_herald_percentage ?? null, s.first_voidgrub_percentage ?? null,
        s.first_atakhan_percentage ?? null, s.first_inhibitor_percentage ?? null,
        a.wards_per_minute ?? null, a.wards_killed_per_minute ?? null, a.control_wards_per_minute ?? null,
      ]);
    }
    done(`Serie ${serie.year} ${serie.season}: ${teamCareer.length} team_career`);

    // REMOVED: player_stats and team_stats JSONB dump tables (data computed from game_players/game_teams)

    // REMOVED: tournament_player_stats, tournament_team_stats, match_player_stats JSONB dump tables

    // ─── 5g. Player champion stats (per serie) ─────────────────────────────
    // PandaScore provides champion-level breakdowns in player stats
    for (const pc of playerCareer) {
      if (!pc.player?.id || !pc.favorite_champions) continue;
      for (const fc of pc.favorite_champions) {
        const champId = fc.champion?.id || fc.id;
        if (!champId) continue;
        await upsert(`
          INSERT INTO player_champion_stats (
            player_id, serie_id, champion_id, champion_name,
            games, wins, losses, win_rate, avg_game_duration,
            blue_games, blue_wins, red_games, red_wins,
            kills_avg, deaths_avg, assists_avg, kda, kill_participation,
            dpm, cspm, gpm, dmg_share, gold_share,
            double_kills, triple_kills, quadra_kills, penta_kills, avg_wpm
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
          ON CONFLICT (player_id, serie_id, champion_id) DO UPDATE SET
            games = EXCLUDED.games, wins = EXCLUDED.wins, kda = EXCLUDED.kda
        `, [
          pc.player.id, serie.id, champId, fc.champion?.name || fc.name || null,
          fc.games_count ?? null, fc.wins ?? null, fc.losses ?? null,
          fc.win_rate ?? null, fc.average?.game_length ?? null,
          fc.blue_games ?? null, fc.blue_wins ?? null, fc.red_games ?? null, fc.red_wins ?? null,
          fc.average?.kills ?? null, fc.average?.deaths ?? null, fc.average?.assists ?? null,
          fc.kda ?? null, fc.average?.kill_participation ?? null,
          fc.average?.damage_per_minute ?? null, fc.average?.cs_per_minute ?? null,
          fc.average?.gold_per_minute ?? null, fc.average?.damage_percentage ?? null,
          fc.average?.gold_percentage ?? null,
          fc.double_kills ?? null, fc.triple_kills ?? null, fc.quadra_kills ?? null,
          fc.penta_kills ?? null, fc.average?.wards_per_minute ?? null,
        ]);
      }
    }
    done(`Serie ${serie.year} ${serie.season}: player_champion_stats processed`);

    // ─── 5h. Champion global stats (per serie) — ALL columns + relational sub-tables ─
    // Computed from game_players + game_picks_bans + game_teams + games
    if (!DRY_RUN) {
      const { rows: champStats } = await pool.query(`
        WITH total_games AS (
          SELECT COUNT(*) AS cnt FROM games WHERE serie_id = $1 AND finished = true
        ),
        -- Pick stats with full detail
        pick_data AS (
          SELECT
            gp.champion_id,
            ca.name AS champion_name,
            COUNT(*) AS picks,
            COUNT(DISTINCT gp.player_id) AS players_count,
            SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN gp.team_id != g.winner_id THEN 1 ELSE 0 END) AS losses,
            -- Blue/Red side
            SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_picks,
            SUM(CASE WHEN gt.color = 'blue' AND gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS blue_wins,
            SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_picks,
            SUM(CASE WHEN gt.color = 'red' AND gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS red_wins,
            -- Averages
            AVG(gp.kills)::REAL AS kills_avg,
            AVG(gp.deaths)::REAL AS deaths_avg,
            AVG(gp.assists)::REAL AS assists_avg,
            AVG(g.length)::REAL AS avg_game_duration,
            -- Advanced averages
            AVG(gp.cs_at_14)::REAL AS cs_at_14_avg,
            AVG(gp.cs_diff_at_14)::REAL AS cs_diff_at_14_avg,
            AVG(CASE WHEN g.length > 0 THEN gp.total_damage_dealt_to_champions::REAL / (g.length / 60.0) END)::REAL AS dpm,
            AVG(CASE WHEN g.length > 0 THEN gp.gold_earned::REAL / (g.length / 60.0) END)::REAL AS gpm,
            AVG(CASE WHEN g.length > 0 THEN gp.creep_score::REAL / (g.length / 60.0) END)::REAL AS cspm,
            AVG(CASE WHEN g.length > 0 THEN gp.total_damage_taken::REAL / (g.length / 60.0) END)::REAL AS avg_dtaken_pm,
            AVG(CASE WHEN g.length > 0 THEN gp.magic_damage_dealt_to_champions::REAL / (g.length / 60.0) END)::REAL AS avg_magic_dpm,
            AVG(CASE WHEN g.length > 0 THEN gp.physical_damage_dealt_to_champions::REAL / (g.length / 60.0) END)::REAL AS avg_physical_dpm,
            AVG(CASE WHEN g.length > 0 THEN gp.true_damage_dealt_to_champions::REAL / (g.length / 60.0) END)::REAL AS avg_true_dpm,
            AVG(gp.total_damage_dealt_to_champions_percentage)::REAL AS dmg_share,
            AVG(gp.gold_percentage)::REAL AS gold_share,
            AVG(CASE WHEN g.length > 0 THEN gp.wards_placed::REAL / (g.length / 60.0) END)::REAL AS avg_wpm,
            AVG(CASE WHEN g.length > 0 THEN gp.vision_wards_bought_in_game::REAL / (g.length / 60.0) END)::REAL AS avg_wcpm,
            -- Kill participation (kills+assists / team_kills)
            (AVG(CASE WHEN gt_stats.kills > 0
              THEN (gp.kills + gp.assists)::REAL / gt_stats.kills
              ELSE 0 END) * 100)::REAL AS kill_participation,
            -- First blood rate
            (AVG(CASE WHEN gp.first_blood_kill THEN 1.0 ELSE 0.0 END) * 100)::REAL AS fb_rate,
            -- Multi-kills
            SUM(gp.double_kills) AS double_kills,
            SUM(gp.triple_kills) AS triple_kills,
            SUM(gp.quadra_kills) AS quadra_kills,
            SUM(gp.penta_kills) AS penta_kills,
            -- Most common role
            MODE() WITHIN GROUP (ORDER BY gp.role) AS main_role
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          JOIN game_teams gt ON gt.game_id = gp.game_id AND gt.team_id = gp.team_id
          LEFT JOIN game_teams gt_stats ON gt_stats.game_id = gp.game_id AND gt_stats.team_id = gp.team_id
          LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
          WHERE g.serie_id = $1 AND g.finished = true
          GROUP BY gp.champion_id, ca.name
        ),
        -- Ban stats with blue/red breakdown
        ban_data AS (
          SELECT
            pb.champion_id,
            COUNT(*) AS bans,
            SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS bans_blue,
            SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS bans_red,
            AVG(pb.pick_turn)::REAL AS ban_turn_avg
          FROM game_picks_bans pb
          JOIN games g ON g.id = pb.game_id
          LEFT JOIN game_teams gt ON gt.game_id = pb.game_id AND gt.team_id = pb.team_id
          WHERE g.serie_id = $1 AND pb.type = 'ban' AND g.finished = true
          GROUP BY pb.champion_id
        ),
        -- Relational: roles breakdown per champion
        roles_data AS (
          SELECT
            sub.champion_id,
            jsonb_object_agg(
              COALESCE(sub.role::TEXT, 'unknown'),
              jsonb_build_object('games', sub.cnt, 'wins', sub.w, 'losses', sub.cnt - sub.w)
            ) AS roles_json
          FROM (
            SELECT gp2.champion_id, gp2.role, COUNT(*) AS cnt,
              SUM(CASE WHEN gp2.team_id = g2.winner_id THEN 1 ELSE 0 END) AS w
            FROM game_players gp2
            JOIN games g2 ON g2.id = gp2.game_id
            WHERE g2.serie_id = $1 AND g2.finished = true
            GROUP BY gp2.champion_id, gp2.role
          ) sub
          GROUP BY sub.champion_id
        ),
        -- Relational: top players per champion (aggregated per player, then collected per champion)
        top_players_per_player AS (
          SELECT
            gp.champion_id,
            gp.player_id,
            p.name AS player_name,
            t.name AS team_name,
            COUNT(*) AS games,
            SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins,
            CASE WHEN SUM(gp.deaths) > 0
              THEN (SUM(gp.kills) + SUM(gp.assists))::REAL / SUM(gp.deaths)
              ELSE (SUM(gp.kills) + SUM(gp.assists))::REAL END AS kda
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          LEFT JOIN players p ON p.id = gp.player_id
          LEFT JOIN teams t ON t.id = gp.team_id
          WHERE g.serie_id = $1 AND g.finished = true
          GROUP BY gp.champion_id, gp.player_id, p.name, t.name
        ),
        top_players_data AS (
          SELECT
            tpp.champion_id,
            jsonb_agg(jsonb_build_object(
              'player_id', tpp.player_id,
              'player_name', tpp.player_name,
              'team_name', tpp.team_name,
              'games', tpp.games,
              'wins', tpp.wins,
              'kda', tpp.kda
            ) ORDER BY tpp.games DESC) AS top_players_json
          FROM top_players_per_player tpp
          GROUP BY tpp.champion_id
        ),
        -- Relational: matchups (opponent champion encounters)
        matchups_sub AS (
          SELECT gp3.champion_id, gp3.opponent_champion_id, COUNT(*) AS cnt,
            SUM(CASE WHEN gp3.team_id = g3.winner_id THEN 1 ELSE 0 END) AS w
          FROM game_players gp3
          JOIN games g3 ON g3.id = gp3.game_id
          WHERE g3.serie_id = $1 AND g3.finished = true AND gp3.opponent_champion_id IS NOT NULL
          GROUP BY gp3.champion_id, gp3.opponent_champion_id
        ),
        matchups_data AS (
          SELECT
            ms.champion_id,
            jsonb_agg(jsonb_build_object(
              'opponent_champion_id', ms.opponent_champion_id,
              'opponent_name', ca_opp.name,
              'games', ms.cnt,
              'wins', ms.w
            ) ORDER BY ms.cnt DESC) AS matchups_json
          FROM matchups_sub ms
          LEFT JOIN champion_aliases ca_opp ON ca_opp.pandascore_id = ms.opponent_champion_id
          GROUP BY ms.champion_id
        ),
        -- Relational: most common items per champion
        items_sub AS (
          SELECT sub.champion_id, sub.item_id, COUNT(*) AS cnt
          FROM (
            SELECT gp4.champion_id, unnest(gp4.items) AS item_id
            FROM game_players gp4
            JOIN games g4 ON g4.id = gp4.game_id
            WHERE g4.serie_id = $1 AND g4.finished = true AND gp4.items IS NOT NULL
          ) sub
          GROUP BY sub.champion_id, sub.item_id
        ),
        items_data AS (
          SELECT
            isub.champion_id,
            jsonb_agg(jsonb_build_object('item_id', isub.item_id, 'count', isub.cnt)
              ORDER BY isub.cnt DESC) AS items_json
          FROM items_sub isub
          GROUP BY isub.champion_id
        ),
        -- Relational: keystone distribution per champion
        keystones_sub AS (
          SELECT
            gp.champion_id, gpr.rune_id, r.name AS rune_name,
            COUNT(*) AS games,
            SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins
          FROM game_player_runes gpr
          JOIN game_players gp ON gp.id = gpr.game_player_id
          JOIN games g ON g.id = gp.game_id
          LEFT JOIN runes r ON r.id = gpr.rune_id
          WHERE g.serie_id = $1 AND g.finished = true AND gpr.slot = 0
          GROUP BY gp.champion_id, gpr.rune_id, r.name
        ),
        keystones_data AS (
          SELECT
            ksub.champion_id,
            jsonb_agg(jsonb_build_object(
              'rune_id', ksub.rune_id,
              'rune_name', ksub.rune_name,
              'games', ksub.games,
              'wins', ksub.wins
            ) ORDER BY ksub.games DESC) AS keystones_json
          FROM keystones_sub ksub
          GROUP BY ksub.champion_id
        ),
        -- Relational: patch breakdown per champion
        patch_sub AS (
          SELECT
            gp.champion_id, g.patch,
            COUNT(*) AS games,
            SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          WHERE g.serie_id = $1 AND g.finished = true AND g.patch IS NOT NULL
          GROUP BY gp.champion_id, g.patch
        ),
        patch_data AS (
          SELECT
            psub.champion_id,
            jsonb_agg(jsonb_build_object(
              'patch', psub.patch,
              'games', psub.games,
              'wins', psub.wins,
              'bans', 0
            ) ORDER BY psub.patch) AS patch_breakdown_json
          FROM patch_sub psub
          GROUP BY psub.champion_id
        )
        SELECT
          p.*,
          (SELECT cnt FROM total_games) AS total_games_in_serie,
          COALESCE(b.bans, 0) AS bans,
          b.bans_blue, b.bans_red,
          CASE WHEN (SELECT cnt FROM total_games) > 0
            THEN COALESCE(b.bans_blue, 0)::REAL / (SELECT cnt FROM total_games) * 100 ELSE 0 END AS ban_rate_blue,
          CASE WHEN (SELECT cnt FROM total_games) > 0
            THEN COALESCE(b.bans_red, 0)::REAL / (SELECT cnt FROM total_games) * 100 ELSE 0 END AS ban_rate_red,
          b.ban_turn_avg,
          CASE WHEN p.picks > 0 THEN p.wins::REAL / p.picks * 100 ELSE 0 END AS win_rate,
          CASE WHEN p.deaths_avg > 0 THEN (p.kills_avg + p.assists_avg) / p.deaths_avg
            ELSE p.kills_avg + p.assists_avg END AS kda,
          rd.roles_json,
          tp.top_players_json,
          mu.matchups_json,
          it.items_json,
          ks.keystones_json,
          pd.patch_breakdown_json
        FROM pick_data p
        LEFT JOIN ban_data b ON b.champion_id = p.champion_id
        LEFT JOIN roles_data rd ON rd.champion_id = p.champion_id
        LEFT JOIN top_players_data tp ON tp.champion_id = p.champion_id
        LEFT JOIN matchups_data mu ON mu.champion_id = p.champion_id
        LEFT JOIN items_data it ON it.champion_id = p.champion_id
        LEFT JOIN keystones_data ks ON ks.champion_id = p.champion_id
        LEFT JOIN patch_data pd ON pd.champion_id = p.champion_id
      `, [serie.id]);

      for (const cs of champStats) {
        await upsert(`
          INSERT INTO champion_global_stats (
            champion_id, serie_id, champion_name, total_games_in_serie,
            players_count, picks, bans, wins, losses, win_rate,
            blue_picks, blue_wins, red_picks, red_wins,
            bans_blue, bans_red, ban_rate_blue, ban_rate_red, ban_turn_avg,
            avg_game_duration,
            kills_avg, deaths_avg, assists_avg, kda, kill_participation, fb_rate,
            double_kills, triple_kills, quadra_kills, penta_kills,
            cs_at_14_avg, cs_diff_at_14_avg,
            dpm, gpm, cspm,
            avg_dtaken_pm, avg_magic_dpm, avg_physical_dpm, avg_true_dpm,
            dmg_share, gold_share, avg_wpm, avg_wcpm,
            main_role
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
            $39,$40,$41,$42,$43,$44
          )
          ON CONFLICT (champion_id, serie_id) DO UPDATE SET
            picks = EXCLUDED.picks, bans = EXCLUDED.bans, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
            win_rate = EXCLUDED.win_rate, kda = EXCLUDED.kda, dpm = EXCLUDED.dpm, gpm = EXCLUDED.gpm,
            kill_participation = EXCLUDED.kill_participation, main_role = EXCLUDED.main_role,
            ban_rate_blue = EXCLUDED.ban_rate_blue, ban_rate_red = EXCLUDED.ban_rate_red
        `, [
          cs.champion_id, serie.id, cs.champion_name, cs.total_games_in_serie,
          cs.players_count, cs.picks, cs.bans, cs.wins, cs.losses, cs.win_rate,
          cs.blue_picks, cs.blue_wins, cs.red_picks, cs.red_wins,
          cs.bans_blue ?? null, cs.bans_red ?? null, cs.ban_rate_blue, cs.ban_rate_red,
          cs.ban_turn_avg ?? null,
          cs.avg_game_duration,
          cs.kills_avg, cs.deaths_avg, cs.assists_avg, cs.kda,
          cs.kill_participation, cs.fb_rate,
          cs.double_kills, cs.triple_kills, cs.quadra_kills, cs.penta_kills,
          cs.cs_at_14_avg, cs.cs_diff_at_14_avg,
          cs.dpm, cs.gpm, cs.cspm,
          cs.avg_dtaken_pm, cs.avg_magic_dpm, cs.avg_physical_dpm, cs.avg_true_dpm,
          cs.dmg_share, cs.gold_share, cs.avg_wpm, cs.avg_wcpm,
          cs.main_role
        ]);

        // Insert champion role stats
        if (cs.roles_json) {
          const roles = typeof cs.roles_json === 'string' ? JSON.parse(cs.roles_json) : cs.roles_json;
          for (const [role, data] of Object.entries(roles)) {
            await upsert(`
              INSERT INTO champion_role_stats (champion_id, serie_id, role, games, wins, losses)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (champion_id, serie_id, role) DO UPDATE SET
                games = EXCLUDED.games, wins = EXCLUDED.wins, losses = EXCLUDED.losses
            `, [cs.champion_id, serie.id, role, data.games || 0, data.wins || 0, data.losses || 0]);
          }
        }

        // Insert champion top players
        if (cs.top_players_json) {
          const topPlayers = typeof cs.top_players_json === 'string' ? JSON.parse(cs.top_players_json) : cs.top_players_json;
          for (const player of topPlayers) {
            await upsert(`
              INSERT INTO champion_top_players (champion_id, serie_id, player_id, player_name, team_name, games, wins, kda)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
              ON CONFLICT (champion_id, serie_id, player_id) DO UPDATE SET
                player_name = EXCLUDED.player_name, team_name = EXCLUDED.team_name,
                games = EXCLUDED.games, wins = EXCLUDED.wins, kda = EXCLUDED.kda
            `, [cs.champion_id, serie.id, player.player_id, player.player_name || null, player.team_name || null, player.games || 0, player.wins || 0, player.kda || 0]);
          }
        }

        // Insert champion matchups
        if (cs.matchups_json) {
          const matchups = typeof cs.matchups_json === 'string' ? JSON.parse(cs.matchups_json) : cs.matchups_json;
          for (const matchup of matchups) {
            await upsert(`
              INSERT INTO champion_matchups (champion_id, serie_id, opponent_champion_id, opponent_name, games, wins)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (champion_id, serie_id, opponent_champion_id) DO UPDATE SET
                opponent_name = EXCLUDED.opponent_name, games = EXCLUDED.games, wins = EXCLUDED.wins
            `, [cs.champion_id, serie.id, matchup.opponent_champion_id, matchup.opponent_name || null, matchup.games || 0, matchup.wins || 0]);
          }
        }

        // Insert champion items
        if (cs.items_json) {
          const items = typeof cs.items_json === 'string' ? JSON.parse(cs.items_json) : cs.items_json;
          for (const item of items) {
            await upsert(`
              INSERT INTO champion_items (champion_id, serie_id, item_id, count)
              VALUES ($1,$2,$3,$4)
              ON CONFLICT (champion_id, serie_id, item_id) DO UPDATE SET
                count = EXCLUDED.count
            `, [cs.champion_id, serie.id, item.item_id, item.count || 0]);
          }
        }

        // Insert champion keystones
        if (cs.keystones_json) {
          const keystones = typeof cs.keystones_json === 'string' ? JSON.parse(cs.keystones_json) : cs.keystones_json;
          for (const keystone of keystones) {
            await upsert(`
              INSERT INTO champion_keystones (champion_id, serie_id, rune_id, rune_name, games, wins)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (champion_id, serie_id, rune_id) DO UPDATE SET
                rune_name = EXCLUDED.rune_name, games = EXCLUDED.games, wins = EXCLUDED.wins
            `, [cs.champion_id, serie.id, keystone.rune_id, keystone.rune_name || null, keystone.games || 0, keystone.wins || 0]);
          }
        }

        // Insert champion patch stats
        if (cs.patch_breakdown_json) {
          const patches = typeof cs.patch_breakdown_json === 'string' ? JSON.parse(cs.patch_breakdown_json) : cs.patch_breakdown_json;
          for (const patch of patches) {
            await upsert(`
              INSERT INTO champion_patch_stats (champion_id, serie_id, patch, games, wins, bans)
              VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (champion_id, serie_id, patch) DO UPDATE SET
                games = EXCLUDED.games, wins = EXCLUDED.wins, bans = EXCLUDED.bans
            `, [cs.champion_id, serie.id, patch.patch, patch.games || 0, patch.wins || 0, patch.bans || 0]);
          }
        }
      }
      done(`Serie ${serie.year} ${serie.season}: ${champStats.length} champion_global_stats (computed + relational)`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE-MATCH MODE: Ingest game data for one specific match
// Called by match-poller.js when a match transitions to 'finished'
// ═══════════════════════════════════════════════════════════════════════════

async function ingestSingleMatch(matchId) {
  section(`SINGLE-MATCH INGESTION: ${matchId}`);

  // Fetch match details from API
  const { data: match } = await apiGet(`/lol/matches/${matchId}`);
  if (!match || !match.id) {
    warn(`Match ${matchId} not found on API`);
    return;
  }

  if (match.status !== 'finished' && !match.winner_id) {
    warn(`Match ${matchId} is not finished (status: ${match.status}) — skipping game data`);
    return;
  }

  // Fetch games for this match
  const games = await apiGetAll(`/lol/matches/${matchId}/games`);
  log(`  Found ${games.length} games for match ${matchId}`);

  let totalPlayers = 0;

  // ─── Phase 3: Game data ─────────────────────────────────────────────────
  for (let gi = 0; gi < games.length; gi++) {
    const game = games[gi];
    if (!game || !game.id) continue;

    const gameStatus = normStatus(game.status || (game.finished ? 'finished' : null));
    await upsert(`
      INSERT INTO games (id, match_id, tournament_id, serie_id, league_id, position,
        status, begin_at, end_at, length, patch, winner_id, winner_type,
        finished, forfeit, detailed_stats, complete)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, winner_id = EXCLUDED.winner_id, finished = EXCLUDED.finished,
        length = COALESCE(EXCLUDED.length, games.length),
        winner_type = EXCLUDED.winner_type,
        patch = COALESCE(EXCLUDED.patch, games.patch),
        detailed_stats = EXCLUDED.detailed_stats,
        complete = EXCLUDED.complete,
        begin_at = COALESCE(EXCLUDED.begin_at, games.begin_at),
        end_at = COALESCE(EXCLUDED.end_at, games.end_at)
    `, [game.id, matchId, match.tournament_id, match.serie_id, match.league_id,
        game.position ?? gi + 1, gameStatus,
        game.begin_at, game.end_at, game.length,
        game.videogame_version?.name || game.videogame_version || game.match?.videogame_version?.name || game.patch || game.version || null, game.winner?.id || game.winner_id || null,
        game.winner?.type || game.winner_type || null,
        game.finished ?? game.status === 'finished', game.forfeit ?? false,
        game.detailed_stats ?? false, game.complete ?? false]);

    // Process teams + players (same logic as phase3_games)
    if (game.teams && Array.isArray(game.teams)) {
      for (const gt of game.teams) {
        const teamId = gt.team?.id || gt.id;
        if (!teamId) continue;

        const color = normColor(gt.color);
        await upsert(`
          INSERT INTO game_teams (game_id, team_id, color, kills, gold_earned,
            tower_kills, inhibitor_kills, baron_kills, dragon_kills, herald_kills,
            voidgrub_kills, atakhan_kills, elder_drake_kills,
            chemtech_drake_kills, cloud_drake_kills, hextech_drake_kills,
            infernal_drake_kills, mountain_drake_kills, ocean_drake_kills,
            first_blood, first_tower, first_inhibitor, first_baron, first_dragon,
            first_herald, first_voidgrub, first_atakhan)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
          ON CONFLICT DO NOTHING
        `, [game.id, teamId, color,
            gt.kills ?? null, gt.gold_earned ?? null,
            gt.tower_kills ?? null, gt.inhibitor_kills ?? null, gt.baron_kills ?? null,
            gt.dragon_kills ?? null, gt.herald_kills ?? null,
            gt.voidgrub_kills ?? null, gt.atakhan_kills ?? null, gt.elder_drake_kills ?? null,
            gt.chemtech_drake_kills ?? null, gt.cloud_drake_kills ?? null, gt.hextech_drake_kills ?? null,
            gt.infernal_drake_kills ?? null, gt.mountain_drake_kills ?? null, gt.ocean_drake_kills ?? null,
            gt.first_blood ?? null, gt.first_tower ?? null, gt.first_inhibitor ?? null,
            gt.first_baron ?? null, gt.first_dragon ?? null,
            gt.first_herald ?? null, gt.first_voidgrub ?? null, gt.first_atakhan ?? null]);

        // Bans → game_picks_bans
        if (gt.bans) {
          for (let bi = 0; bi < gt.bans.length; bi++) {
            const banChampId = gt.bans[bi]?.id || gt.bans[bi];
            if (!banChampId) continue;
            await upsert(`
              INSERT INTO game_picks_bans (game_id, team_id, champion_id, type, pick_turn)
              VALUES ($1,$2,$3,'ban',$4)
              ON CONFLICT DO NOTHING
            `, [game.id, teamId, banChampId, bi + 1]);
          }
        }
      }
    }

    // ─── Fallback: fetch game detail when players, bans or patch are missing ───
    const hasTeamPlayers = game.teams?.some(t => t.players?.length > 0);
    const hasTeamBans = game.teams?.some(t => t.bans?.length > 0);
    const hasPatch = !!(game.videogame_version?.name || game.videogame_version || game.match?.videogame_version?.name || game.patch || game.version);
    let playerSource = game.players && Array.isArray(game.players) && game.players.length > 0
      ? game.players
      : (game.teams || []).flatMap(gt => gt.players || []);

    let gameDetail = null;
    if ((!hasTeamPlayers || !hasTeamBans || !hasPatch) && playerSource.length === 0 && game.id) {
      const resp = await apiGet(`/lol/games/${game.id}`);
      gameDetail = resp.data;
      if (gameDetail?.players?.length > 0) playerSource = gameDetail.players;
    } else if ((!hasTeamBans || !hasPatch) && game.id) {
      const resp = await apiGet(`/lol/games/${game.id}`);
      gameDetail = resp.data;
    }

    // Backfill patch from game detail
    if (!hasPatch && gameDetail) {
      const detailPatch = gameDetail.videogame_version?.name || gameDetail.videogame_version || gameDetail.match?.videogame_version?.name || gameDetail.patch || gameDetail.version || null;
      if (detailPatch) {
        await upsert(`UPDATE games SET patch = $1 WHERE id = $2 AND patch IS NULL`, [detailPatch, game.id]);
      }
    }

    // Process bans from gameDetail when original teams didn't have them
    if (!hasTeamBans && gameDetail?.teams?.length > 0) {
      for (const gt of gameDetail.teams) {
        const teamId = gt.team?.id || gt.id;
        if (!teamId || !gt.bans?.length) continue;
        for (let bi = 0; bi < gt.bans.length; bi++) {
          const banChampId = gt.bans[bi]?.id || gt.bans[bi];
          if (!banChampId) continue;
          await ensureChampionAlias(banChampId);
          await upsert(`
            INSERT INTO game_picks_bans (game_id, team_id, champion_id, type, pick_turn)
            VALUES ($1,$2,$3,'ban',$4)
            ON CONFLICT DO NOTHING
          `, [game.id, teamId, banChampId, bi + 1]);
        }
      }
    }

    // Build team lookup from game.teams for assigning team_id to flat players
    const teamLookup = {};
    const teamsSource = gameDetail?.teams || game.teams || [];
    for (const gt of teamsSource) {
      const tid = gt.team?.id || gt.id;
      if (tid && gt.players) {
        for (const p of gt.players) { teamLookup[p.id || p.player?.id] = tid; }
      }
    }

    for (const gp of playerSource) {
      const playerId = gp.player_id || gp.id || gp.player?.id;
      if (!playerId) continue;

      // Resolve team_id: from gp.team.id, or from teamLookup, or null
      const teamId = gp.team?.id || teamLookup[playerId] || null;

      // Ensure player exists
      const pInfo = gp.player || gp;
      await upsert(`
        INSERT INTO players (id, name, first_name, last_name, slug, role, nationality, image_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, players.name),
          image_url = COALESCE(EXCLUDED.image_url, players.image_url)
      `, [playerId, pInfo.name || null,
          pInfo.first_name || null, pInfo.last_name || null,
          pInfo.slug || null, normRole(gp.role || pInfo.role),
          pInfo.nationality || null, pInfo.image_url || null]);

      const champId = gp.champion?.id || null;
      const role = normRole(gp.role || pInfo.role);
      // opponent is the opposing TEAM (no champion info from API)
      const opponentId = gp.opponent?.id || null;
      const opponentChampId = null; // API does not provide opponent champion

      const td = gp.total_damage || gp.damage?.total || {};
      const pd = gp.physical_damage || gp.damage?.physical || {};
      const md = gp.magic_damage || gp.damage?.magic || {};
      const trd = gp.true_damage || gp.damage?.true_damage || {};
      const wards = gp.wards || {};
      const kc = gp.kills_counters || gp.kill_counters || {};
      const ks = gp.kills_series || {};
      const flags = gp.flags || {};

      const { rows } = await upsert(`
        INSERT INTO game_players (
          game_id, player_id, team_id, champion_id, role,
          kills, deaths, assists, creep_score, minions_killed, cs_at_14, cs_diff_at_14,
          gold_earned, gold_spent, gold_percentage, level,
          total_damage_dealt, total_damage_dealt_to_champions, total_damage_taken,
          total_damage_dealt_percentage, total_damage_dealt_to_champions_percentage,
          physical_damage_dealt, physical_damage_dealt_to_champions, physical_damage_taken,
          physical_damage_dealt_percentage, physical_damage_dealt_to_champions_percentage,
          magic_damage_dealt, magic_damage_dealt_to_champions, magic_damage_taken,
          magic_damage_dealt_percentage, magic_damage_dealt_to_champions_percentage,
          true_damage_dealt, true_damage_dealt_to_champions, true_damage_taken,
          true_damage_dealt_percentage, true_damage_dealt_to_champions_percentage,
          total_heal, total_units_healed, total_time_crowd_control_dealt,
          wards_placed, sight_wards_bought_in_game, vision_wards_bought_in_game,
          kills_players, kills_turrets, kills_inhibitors, kills_wards,
          kills_neutral_minions, kills_neutral_minions_enemy_jungle, kills_neutral_minions_team_jungle,
          largest_killing_spree, largest_multi_kill, largest_critical_strike,
          double_kills, triple_kills, quadra_kills, penta_kills,
          first_blood_kill, first_blood_assist, first_tower_kill, first_tower_assist,
          first_inhibitor_kill, first_inhibitor_assist,
          spell_1_id, spell_2_id,
          rune_primary_path_id, rune_secondary_path_id,
          opponent_id, opponent_champion_id, items
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
          $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
          $57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69
        )
        ON CONFLICT (game_id, player_id) DO UPDATE SET
          team_id = COALESCE(EXCLUDED.team_id, game_players.team_id),
          champion_id = COALESCE(EXCLUDED.champion_id, game_players.champion_id),
          role = COALESCE(EXCLUDED.role, game_players.role),
          kills = EXCLUDED.kills, deaths = EXCLUDED.deaths, assists = EXCLUDED.assists,
          creep_score = EXCLUDED.creep_score, minions_killed = EXCLUDED.minions_killed,
          cs_at_14 = COALESCE(EXCLUDED.cs_at_14, game_players.cs_at_14),
          cs_diff_at_14 = COALESCE(EXCLUDED.cs_diff_at_14, game_players.cs_diff_at_14),
          gold_earned = EXCLUDED.gold_earned, gold_spent = EXCLUDED.gold_spent,
          gold_percentage = EXCLUDED.gold_percentage, level = EXCLUDED.level,
          total_damage_dealt = EXCLUDED.total_damage_dealt,
          total_damage_dealt_to_champions = EXCLUDED.total_damage_dealt_to_champions,
          total_damage_taken = EXCLUDED.total_damage_taken,
          total_damage_dealt_percentage = EXCLUDED.total_damage_dealt_percentage,
          total_damage_dealt_to_champions_percentage = EXCLUDED.total_damage_dealt_to_champions_percentage,
          physical_damage_dealt = EXCLUDED.physical_damage_dealt,
          physical_damage_dealt_to_champions = EXCLUDED.physical_damage_dealt_to_champions,
          physical_damage_taken = EXCLUDED.physical_damage_taken,
          magic_damage_dealt = EXCLUDED.magic_damage_dealt,
          magic_damage_dealt_to_champions = EXCLUDED.magic_damage_dealt_to_champions,
          magic_damage_taken = EXCLUDED.magic_damage_taken,
          true_damage_dealt = EXCLUDED.true_damage_dealt,
          true_damage_dealt_to_champions = EXCLUDED.true_damage_dealt_to_champions,
          true_damage_taken = EXCLUDED.true_damage_taken,
          total_heal = EXCLUDED.total_heal, total_units_healed = EXCLUDED.total_units_healed,
          total_time_crowd_control_dealt = EXCLUDED.total_time_crowd_control_dealt,
          wards_placed = EXCLUDED.wards_placed,
          sight_wards_bought_in_game = EXCLUDED.sight_wards_bought_in_game,
          vision_wards_bought_in_game = EXCLUDED.vision_wards_bought_in_game,
          kills_players = EXCLUDED.kills_players, kills_turrets = EXCLUDED.kills_turrets,
          kills_inhibitors = EXCLUDED.kills_inhibitors, kills_wards = EXCLUDED.kills_wards,
          kills_neutral_minions = EXCLUDED.kills_neutral_minions,
          largest_killing_spree = COALESCE(EXCLUDED.largest_killing_spree, game_players.largest_killing_spree),
          largest_multi_kill = COALESCE(EXCLUDED.largest_multi_kill, game_players.largest_multi_kill),
          largest_critical_strike = COALESCE(EXCLUDED.largest_critical_strike, game_players.largest_critical_strike),
          double_kills = EXCLUDED.double_kills, triple_kills = EXCLUDED.triple_kills,
          quadra_kills = EXCLUDED.quadra_kills, penta_kills = EXCLUDED.penta_kills,
          first_blood_kill = EXCLUDED.first_blood_kill, first_blood_assist = EXCLUDED.first_blood_assist,
          spell_1_id = COALESCE(EXCLUDED.spell_1_id, game_players.spell_1_id),
          spell_2_id = COALESCE(EXCLUDED.spell_2_id, game_players.spell_2_id),
          rune_primary_path_id = COALESCE(EXCLUDED.rune_primary_path_id, game_players.rune_primary_path_id),
          rune_secondary_path_id = COALESCE(EXCLUDED.rune_secondary_path_id, game_players.rune_secondary_path_id),
          items = EXCLUDED.items
        RETURNING id
      `, [
        game.id, playerId, teamId, champId, role,
        gp.kills ?? null, gp.deaths ?? null, gp.assists ?? null,
        gp.creep_score ?? null, gp.minions_killed ?? null,
        gp.cs_at_14 ?? null, gp.cs_diff_at_14 ?? null,
        gp.gold_earned ?? null, gp.gold_spent ?? null, gp.gold_percentage ?? null,
        gp.level ?? null,
        td.dealt ?? null, td.dealt_to_champions ?? null, td.taken ?? null,
        td.dealt_percentage ?? null, td.dealt_to_champions_percentage ?? null,
        pd.dealt ?? null, pd.dealt_to_champions ?? null, pd.taken ?? null,
        pd.dealt_percentage ?? null, pd.dealt_to_champions_percentage ?? null,
        md.dealt ?? null, md.dealt_to_champions ?? null, md.taken ?? null,
        md.dealt_percentage ?? null, md.dealt_to_champions_percentage ?? null,
        trd.dealt ?? null, trd.dealt_to_champions ?? null, trd.taken ?? null,
        trd.dealt_percentage ?? null, trd.dealt_to_champions_percentage ?? null,
        gp.total_heal ?? null, gp.total_units_healed ?? null, gp.total_time_crowd_control_dealt ?? null,
        wards.placed ?? null, wards.sight_wards_bought_in_game ?? null,
        wards.vision_wards_bought_in_game ?? null,
        kc.players ?? null, kc.turrets ?? null, kc.inhibitors ?? null, kc.wards ?? null,
        kc.neutral_minions ?? null, kc.neutral_minions_enemy_jungle ?? null,
        kc.neutral_minions_team_jungle ?? null,
        ks.largest_killing_spree ?? gp.largest_killing_spree ?? null,
        ks.largest_multi_kill ?? gp.largest_multi_kill ?? null,
        ks.largest_critical_strike ?? gp.largest_critical_strike ?? null,
        ks.double_kills ?? gp.double_kills ?? null, ks.triple_kills ?? gp.triple_kills ?? null,
        ks.quadra_kills ?? gp.quadra_kills ?? null, ks.penta_kills ?? gp.penta_kills ?? null,
        flags.first_blood_kill ?? gp.first_blood_kill ?? false,
        flags.first_blood_assist ?? gp.first_blood_assist ?? false,
        flags.first_tower_kill ?? gp.first_tower_kill ?? false,
        flags.first_tower_assist ?? gp.first_tower_assist ?? false,
        flags.first_inhibitor_kill ?? gp.first_inhibitor_kill ?? false,
        flags.first_inhibitor_assist ?? gp.first_inhibitor_assist ?? false,
        gp.spells?.[0]?.id ?? gp.spell1_id ?? null, gp.spells?.[1]?.id ?? gp.spell2_id ?? null,
        gp.runes_reforged?.primary_path?.id ?? null,
        gp.runes_reforged?.secondary_path?.id ?? null,
        opponentId, opponentChampId,
        gp.items ? gp.items.map(i => i?.id || i) : null,
      ]);

      // Pick entry
      if (champId) {
        await upsert(`
          INSERT INTO game_picks_bans (game_id, team_id, champion_id, type)
          VALUES ($1,$2,$3,'pick')
          ON CONFLICT DO NOTHING
        `, [game.id, teamId, champId]);
      }

      // Upsert rune paths from game data (Domination=1, etc.)
      await upsertRunePathsFromPlayer(gp);

      // Player runes
      const gpId = rows?.[0]?.id;
      if (gpId && gp.runes_reforged) {
        await upsert(`DELETE FROM game_player_runes WHERE game_player_id = $1`, [gpId]);

        const rr = gp.runes_reforged;
        const runeInserts = [];
        if (rr.primary_path?.keystone?.id) runeInserts.push([gpId, rr.primary_path.keystone.id, 'primary', 0]);
        (rr.primary_path?.lesser_runes || []).forEach((r, i) => {
          if (r?.id) runeInserts.push([gpId, r.id, 'primary', i + 1]);
        });
        (rr.secondary_path?.lesser_runes || []).forEach((r, i) => {
          if (r?.id) runeInserts.push([gpId, r.id, 'secondary', i + 4]);
        });
        if (rr.shards?.offense?.id) runeInserts.push([gpId, rr.shards.offense.id, 'primary', 6]);
        if (rr.shards?.flex?.id) runeInserts.push([gpId, rr.shards.flex.id, 'primary', 7]);
        if (rr.shards?.defense?.id) runeInserts.push([gpId, rr.shards.defense.id, 'primary', 8]);

        for (const [gpi, runeId, tree, slot] of runeInserts) {
          await upsert(`
            INSERT INTO game_player_runes (game_player_id, rune_id, tree, slot)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (game_player_id, slot) DO UPDATE SET rune_id = EXCLUDED.rune_id, tree = EXCLUDED.tree
          `, [gpi, runeId, tree, slot]);
        }
      }

      totalPlayers++;
    }
    done(`Game ${game.id}: processed`);
  }

  // ─── Phase 4: Timeline (if not skipped) ─────────────────────────────────
  if (!SKIP_TIMELINE) {
    let frameCount = 0;
    let eventCount = 0;

    for (const game of games) {
      if (!game?.id) continue;

      const { data: frames } = await apiGet(`/lol/games/${game.id}/frames`);
      if (frames && Array.isArray(frames)) {
        // Delete existing frames + frame_players for clean re-insert
        await pool.query(`DELETE FROM game_frame_players WHERE frame_id IN (SELECT id FROM game_frames WHERE game_id = $1)`, [game.id]);
        await pool.query(`DELETE FROM game_frames WHERE game_id = $1`, [game.id]);

        for (const frame of frames) {
          const frameTs = frame.current_timestamp ?? frame.timestamp;
          if (frameTs == null) continue;

          const blue = frame.blue || {};
          const red = frame.red || {};

          const { rows: frameInsertRows } = await upsert(`
            INSERT INTO game_frames (game_id, timestamp,
              blue_team_id, blue_gold, blue_kills, blue_towers, blue_drakes, blue_nashors,
              blue_heralds, blue_inhibitors, blue_voidgrubs, blue_atakhans, blue_score,
              red_team_id, red_gold, red_kills, red_towers, red_drakes, red_nashors,
              red_heralds, red_inhibitors, red_voidgrubs, red_atakhans, red_score)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
            ON CONFLICT (game_id, timestamp) DO UPDATE SET
              blue_gold = EXCLUDED.blue_gold, blue_kills = EXCLUDED.blue_kills,
              red_gold = EXCLUDED.red_gold, red_kills = EXCLUDED.red_kills
            RETURNING id
          `, [game.id, frameTs,
              blue.team_id ?? null, blue.gold ?? null, blue.kills ?? null, blue.towers ?? null,
              blue.drakes ?? null, blue.nashors ?? null, blue.heralds ?? null,
              blue.inhibitors ?? null, blue.voidgrubs ?? null, blue.atakhans ?? null, blue.score ?? null,
              red.team_id ?? null, red.gold ?? null, red.kills ?? null, red.towers ?? null,
              red.drakes ?? null, red.nashors ?? null, red.heralds ?? null,
              red.inhibitors ?? null, red.voidgrubs ?? null, red.atakhans ?? null, red.score ?? null]);

          frameCount++;

          const frameId = frameInsertRows?.[0]?.id;
          if (frameId) {
            for (const [side, sideColor] of [['blue', 'blue'], ['red', 'red']]) {
              const sideData = frame[side] || {};
              const playersObj = sideData.players || sideData;
              for (const role of ['top', 'jun', 'mid', 'adc', 'sup']) {
                const rp = playersObj[role] || sideData[role];
                if (!rp) continue;
                const fpChampId2 = rp.champion?.id ?? null;
                if (fpChampId2) await ensureChampionAlias(fpChampId2);
                await upsert(`
                  INSERT INTO game_frame_players (frame_id, player_id, champion_id, team_color, role,
                    kills, deaths, assists, cs, level)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                  ON CONFLICT DO NOTHING
                `, [frameId, rp.player_id ?? rp.id ?? null, fpChampId2,
                    sideColor, role,
                    rp.kills ?? null, rp.deaths ?? null, rp.assists ?? null,
                    rp.cs ?? null, rp.level ?? null]);
              }
            }
          }
        }
      }

      const { data: events } = await apiGet(`/lol/games/${game.id}/events`);
      if (events && Array.isArray(events)) {
        // Delete existing events for this game to avoid UNIQUE constraint dedup issues
        await pool.query(`DELETE FROM game_events WHERE game_id = $1`, [game.id]);
        for (const ev of events) {
          if (!VALID_EVENT_TYPES.has(ev.type)) continue;
          const e = extractEvent(ev);

          const { rows: evRows } = await upsert(`
            INSERT INTO game_events (game_id, timestamp, type,
              killer_player_id, killer_champion_id, victim_player_id, victim_champion_id,
              is_first)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
            RETURNING id
          `, [game.id, e.timestamp, e.type,
              e.killer_player_id, e.killer_champion_id,
              e.victim_player_id, e.victim_champion_id,
              e.is_first]);

          if (evRows?.[0]?.id && e.assistants) {
            const eventId = evRows[0].id;
            const assists = typeof e.assistants === 'string' ? JSON.parse(e.assistants) : e.assistants;
            if (Array.isArray(assists)) {
              for (const a of assists) {
                if (a.player_id) {
                  await upsert(`INSERT INTO game_event_assists (event_id, player_id, champion_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [eventId, a.player_id, a.champion_id ?? null]);
                }
              }
            }
          }
          eventCount++;
        }
      }
    }
    done(`Timeline: ${frameCount} frames, ${eventCount} events`);
  }

  done(`Match ${matchId}: ${games.length} games, ${totalPlayers} players ingested`);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();

  log('');
  log(`${BOLD}═══════════════════════════════════════════════════════════${RST}`);
  log(`${BOLD}  PANDASCORE → POSTGRESQL DIRECT INGESTION${RST}`);
  log(`${BOLD}═══════════════════════════════════════════════════════════${RST}`);
  if (ARG_MATCH_ID) log(`  Match:    ${ARG_MATCH_ID} (single-match mode)`);
  if (ARG_LEAGUE) log(`  League:   ${ARG_LEAGUE} (ID: ${LEAGUE_IDS[ARG_LEAGUE]})`);
  if (ARG_YEAR) log(`  Year:     ${ARG_YEAR}`);
  if (ARG_SPLIT) log(`  Split:    ${ARG_SPLIT}`);
  log(`  Database: ${PG_DSN.replace(/:[^:@]+@/, ':***@')}`);
  log(`  Flags:    ${[SKIP_STATIC && 'skip-static', STATIC_ONLY && 'static-only', STATS_ONLY && 'stats-only', SKIP_TIMELINE && 'skip-timeline', SKIP_STATS && 'skip-stats', DRY_RUN && 'dry-run'].filter(Boolean).join(' ') || 'none'}`);
  log('');

  try {
    // ─── Single-match mode (called by match-poller.js) ────────────────────
    if (ARG_MATCH_ID) {
      await ingestSingleMatch(ARG_MATCH_ID);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      section('COMPLETE');
      log(`  API requests: ${requestCount}`);
      log(`  Time: ${elapsed}s`);
      return;
    }

    // ─── Full league mode ─────────────────────────────────────────────────
    // Phase 1: Reference data
    if (!SKIP_STATIC && !STATS_ONLY) {
      await phase1_reference();
    }

    if (STATIC_ONLY) {
      done('Static-only mode — done.');
      return;
    }

    // Phase 2: Structure (always needed to resolve seriesList)
    const seriesList = await phase2_structure(ARG_LEAGUE, LEAGUE_IDS[ARG_LEAGUE]);

    if (seriesList.length === 0) {
      warn('No series found for the given filters.');
      return;
    }

    if (!STATS_ONLY) {
      // Phase 3: Game data
      await phase3_games(seriesList);

      // Phase 4: Timeline
      if (!SKIP_TIMELINE) {
        await phase4_timeline(seriesList);
      } else {
        log(`\n  ${DIM}Skipping timeline (--skip-timeline)${RST}`);
      }
    } else {
      log(`\n  ${DIM}Skipping phases 1/3/4 (--stats-only)${RST}`);
    }

    // Phase 5: Stats
    if (!SKIP_STATS) {
      await phase5_stats(seriesList);
    } else {
      log(`\n  ${DIM}Skipping stats (--skip-stats)${RST}`);
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    section('COMPLETE');
    log(`  API requests: ${requestCount}`);
    log(`  Time: ${elapsed}s`);
    log(`  Run validate: npm run validate`);
    log(`  Run tests:    npm run test:pipeline`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});
