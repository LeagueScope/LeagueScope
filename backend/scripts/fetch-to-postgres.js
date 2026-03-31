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
 *   5. Pre-computed stats (player_career, team_career, champion_global_stats)
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
 *   --skip-stats       Skip pre-computed stats (player_career, team_career, etc.)
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
  LEC: 4197, LCS: 4198, LCK: 293, LPL: 294, CBLOL: 302, LCP: 5351,
  // Historical predecessors
  EULCS: 290, NALCS: 289, LMS: 295,
  // LTA (2025+)
  LTANORTH: 5345, LTASOUTH: 5346,
  // International
  WORLDS: 297, MSI: 300,
  // Tier 2
  PCS: 4288, LLA: 4199, VCS: 4141, LCO: 4539, LCL: 4004,
  TCL: 1003, LJL: 2092, OPL: 301,
  // ERLs
  EUMASTERS: 4139, EMEAMASTERS: 4996,
  LFL: 4292, PRM: 4302, LES: 5496, UL: 4300, LVPSL: 4213,
  NLC: 4411, LPLOL: 4407, GLL: 4723, AL: 4962,
  HLL: 5355, LIT: 5211, PGN: 4405,
  EBL: 4426, ES: 4722, HM: 4433,
  // Academy / Dev
  LDL: 4226, LCKCL: 4553, CBLOLACAD: 4533, LCSACAD: 4228, NACL: 4961,
  // Off-season
  ALLSTAR: 296, DEMACIACUP: 4140, KESPACUP: 2711, EWC: 5262,
  // Other
  FIRSTSTAND: 5369, ROADOFLEGENDS: 5366, RIFTLEGENDS: 5358,
};

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const ARG_LEAGUE = getArg('league')?.toUpperCase();
const ARG_YEAR = getArg('year') ? Number(getArg('year')) : null;
const ARG_SPLIT = getArg('split');
const SKIP_STATIC = hasFlag('skip-static');
const STATIC_ONLY = hasFlag('static-only');
const SKIP_TIMELINE = hasFlag('skip-timeline');
const SKIP_STATS = hasFlag('skip-stats');
const DRY_RUN = hasFlag('dry-run');

if (!STATIC_ONLY && !ARG_LEAGUE) {
  console.error('Usage: node scripts/fetch-to-postgres.js --league LEC [--year 2026] [--split spring]');
  console.error('       node scripts/fetch-to-postgres.js --static-only');
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

const VALID_EVENT_TYPES = new Set(['player_kill', 'tower_kill', 'inhibitor_kill', 'drake_kill', 'baron_nashor_kill', 'herald_kill', 'voidgrub_kill', 'atakhan_kill']);

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

const pool = new pg.Pool({ connectionString: PG_DSN, max: 4 });

async function upsert(sql, params) {
  if (DRY_RUN) return;
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

  // 1b. Items
  const items = await apiGetAll('/lol/versions/all/items');
  let itemCount = 0;
  for (const item of items) {
    await upsert(`
      INSERT INTO items (id, name, slug, image_url, gold_base, gold_total, gold_purchasable, gold_sell,
        flat_armor_mod, flat_crit_chance_mod, flat_hp_pool_mod, flat_hp_regen_mod, flat_mp_pool_mod,
        flat_mp_regen_mod, flat_magic_damage_mod, flat_movement_speed_mod, flat_physical_damage_mod,
        flat_spell_block_mod, percent_attack_speed_mod, percent_life_steal_mod, percent_movement_speed_mod)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
    `, [
      item.id, item.name, item.slug || null, item.image_url || null,
      item.gold_base ?? null, item.gold_total ?? null, item.gold_purchasable ?? null, item.gold_sell ?? null,
      item.flat_armor_mod ?? null, item.flat_crit_chance_mod ?? null, item.flat_hp_pool_mod ?? null,
      item.flat_hp_regen_mod ?? null, item.flat_mp_pool_mod ?? null, item.flat_mp_regen_mod ?? null,
      item.flat_magic_damage_mod ?? null, item.flat_movement_speed_mod ?? null,
      item.flat_physical_damage_mod ?? null, item.flat_spell_block_mod ?? null,
      item.percent_attack_speed_mod ?? null, item.percent_life_steal_mod ?? null,
      item.percent_movement_speed_mod ?? null,
    ]);
    itemCount++;
  }
  done(`Items: ${itemCount}`);

  // 1c. Spells
  const spells = await apiGetAll('/lol/spells');
  for (const sp of spells) {
    await upsert(`
      INSERT INTO spells (id, name, slug, image_url) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `, [sp.id, sp.name, sp.slug || null, sp.image_url || null]);
  }
  done(`Spells: ${spells.length}`);

  // 1d. Rune paths + runes
  const runeData = await apiGetAll('/lol/runes-reforged');
  let runeCount = 0;
  for (const path of runeData) {
    await upsert(`
      INSERT INTO rune_paths (id, name, image_url) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `, [path.id, path.name, path.image_url || null]);

    // Extract runes from slots
    if (path.slots) {
      for (const slot of path.slots) {
        for (const rune of (slot.runes || [])) {
          await upsert(`
            INSERT INTO runes (id, name, slug, image_url, path_id) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
          `, [rune.id, rune.name, rune.slug || null, rune.image_url || null, path.id]);
          runeCount++;
        }
      }
    }
  }
  done(`Rune paths: ${runeData.length}, Runes: ${runeCount}`);
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

  for (const s of series) {
    await upsert(`
      INSERT INTO series (id, league_id, full_name, slug, year, season, begin_at, end_at, winner_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name, begin_at = EXCLUDED.begin_at, end_at = EXCLUDED.end_at, winner_id = EXCLUDED.winner_id
    `, [s.id, leagueId, s.full_name || s.name, s.slug, s.year, s.season, s.begin_at, s.end_at, s.winner_id]);

    // 2c. Tournaments for this serie
    const tournaments = await apiGetAll(`/series/${s.id}/tournaments`);
    for (const t of tournaments) {
      const tier = t.tier || null;
      await upsert(`
        INSERT INTO tournaments (id, serie_id, league_id, name, slug, tier, begin_at, end_at,
          winner_id, has_bracket, live_supported)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, winner_id = EXCLUDED.winner_id, tier = EXCLUDED.tier
      `, [t.id, s.id, leagueId, t.name, t.slug, tier, t.begin_at, t.end_at,
          t.winner_id, t.has_bracket ?? false, t.live_supported ?? false]);

      // Tournament teams
      if (t.teams) {
        for (const team of t.teams) {
          allTeamIds.add(team.id);
        }
      }

      // Tournament rosters
      if (t.expected_roster) {
        for (const roster of t.expected_roster) {
          if (!roster.team?.id || !roster.players) continue;
          for (const p of roster.players) {
            allPlayerIds.add(p.id);
            const role = normRole(p.role);
            await upsert(`
              INSERT INTO tournament_rosters (tournament_id, team_id, player_id, role)
              VALUES ($1,$2,$3,$4)
              ON CONFLICT DO NOTHING
            `, [t.id, roster.team.id, p.id, role]);
          }
        }
      }

      // Standings
      if (t.standings) {
        for (const standing of t.standings) {
          if (!standing.team?.id) continue;
          await upsert(`
            INSERT INTO tournament_standings (tournament_id, team_id, rank, wins, losses)
            VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT DO NOTHING
          `, [t.id, standing.team.id, standing.rank ?? null, standing.wins ?? null, standing.losses ?? null]);
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

    // 2e. Matches
    const matches = await apiGetAll(`/series/${s.id}/matches`);
    const finishedMatches = matches.filter(m => m.status === 'finished' || m.winner_id);

    for (const m of finishedMatches) {
      await upsert(`
        INSERT INTO matches (id, tournament_id, serie_id, league_id, name, slug, status,
          number_of_games, begin_at, end_at, winner_id, detailed_stats, forfeit, draw)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status, winner_id = EXCLUDED.winner_id, end_at = EXCLUDED.end_at
      `, [m.id, m.tournament_id, s.id, leagueId, m.name, m.slug,
          normStatus(m.status), m.number_of_games, m.begin_at, m.end_at,
          m.winner_id, m.detailed_stats ?? false, m.forfeit ?? false, m.draw ?? false]);

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
    }
    done(`Matches: ${finishedMatches.length} finished`);

    seriesList.push({ ...s, finishedMatches });
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
            image_url, current_team_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, role = EXCLUDED.role, image_url = EXCLUDED.image_url,
            current_team_id = EXCLUDED.current_team_id
        `, [p.id, p.name, p.first_name, p.last_name, p.slug, normRole(p.role),
            p.nationality, p.birthday, p.image_url, p.current_team?.id || null]);
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

        await upsert(`
          INSERT INTO games (id, match_id, tournament_id, serie_id, league_id, position,
            begin_at, end_at, length, patch, winner_id, finished, forfeit, detailed_stats, complete)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (id) DO UPDATE SET
            winner_id = EXCLUDED.winner_id, finished = EXCLUDED.finished, length = EXCLUDED.length
        `, [game.id, match.id, match.tournament_id, serie.id, LEAGUE_IDS[ARG_LEAGUE],
            game.position ?? gi + 1, game.begin_at, game.end_at, game.length,
            game.patch || null, game.winner?.id || game.winner_id || null,
            game.finished ?? game.status === 'finished', game.forfeit ?? false,
            game.detailed_stats ?? false, game.complete ?? false]);

        // Process teams + players from game.teams[]
        if (game.teams && Array.isArray(game.teams)) {
          for (const gt of game.teams) {
            const teamId = gt.team?.id || gt.id;
            if (!teamId) continue;

            const color = normColor(gt.color);
            await upsert(`
              INSERT INTO game_teams (game_id, team_id, color, kills, gold_earned,
                tower_kills, inhibitor_kills, baron_kills, dragon_kills, herald_kills,
                voidgrub_kills, atakhan_kills, elder_drake_kills,
                first_blood, first_tower, first_inhibitor, first_baron, first_dragon,
                first_herald, first_voidgrub, first_atakhan,
                bans, player_ids)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
              ON CONFLICT DO NOTHING
            `, [game.id, teamId, color,
                gt.kills ?? null, gt.gold_earned ?? null,
                gt.tower_kills ?? null, gt.inhibitor_kills ?? null, gt.baron_kills ?? null,
                gt.dragon_kills ?? null, gt.herald_kills ?? null,
                gt.voidgrub_kills ?? null, gt.atakhan_kills ?? null, gt.elder_drake_kills ?? null,
                gt.first_blood ?? null, gt.first_tower ?? null, gt.first_inhibitor ?? null,
                gt.first_baron ?? null, gt.first_dragon ?? null,
                gt.first_herald ?? null, gt.first_voidgrub ?? null, gt.first_atakhan ?? null,
                gt.bans ? gt.bans.map(b => b.id || b) : null,
                gt.players ? gt.players.map(p => p.id || p.player?.id) : null]);

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

            // Players
            if (gt.players && Array.isArray(gt.players)) {
              for (const gp of gt.players) {
                const playerId = gp.id || gp.player?.id;
                if (!playerId) continue;

                const champId = gp.champion?.id || null;
                const role = normRole(gp.role);
                const opponentTeamId = gp.opponent?.id || null;
                const opponentChampId = gp.opponent?.champion?.id || null;

                // Damage extraction
                const td = gp.total_damage || {};
                const pd = gp.physical_damage || {};
                const md = gp.magic_damage || {};
                const trd = gp.true_damage || {};
                const wards = gp.wards || {};
                const kc = gp.kills_counters || {};
                const ks = gp.kills_series || {};
                const flags = gp.flags || {};

                const { rows } = await upsert(`
                  INSERT INTO game_players (
                    game_id, player_id, team_id, champion_id, role, opponent_team_id, opponent_champion_id,
                    kills, deaths, assists, creep_score, minions_killed, level,
                    gold_earned, gold_spent, gold_percentage,
                    total_damage_dealt, total_damage_dealt_to_champions, total_damage_taken,
                    damage_dealt_percentage, damage_dealt_to_champions_percentage,
                    physical_damage_dealt, physical_damage_dealt_to_champions, physical_damage_taken,
                    magic_damage_dealt, magic_damage_dealt_to_champions, magic_damage_taken,
                    true_damage_dealt, true_damage_dealt_to_champions, true_damage_taken,
                    total_heal, total_units_healed, total_time_crowd_control_dealt,
                    wards_placed, sight_wards_bought, vision_wards_bought, wards_destroyed,
                    kills_turrets, kills_inhibitors, kills_wards, kills_neutral_minions,
                    kills_neutral_minions_enemy, kills_neutral_minions_team,
                    double_kills, triple_kills, quadra_kills, penta_kills,
                    first_blood_kill, first_blood_assist, first_tower_kill, first_tower_assist,
                    items, spell1_id, spell2_id,
                    rune_primary_path_id, rune_secondary_path_id, rune_keystone_id,
                    cs_at_14, cs_diff_at_14
                  )
                  VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                    $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
                    $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56
                  )
                  ON CONFLICT DO NOTHING
                  RETURNING id
                `, [
                  game.id, playerId, teamId, champId, role, opponentTeamId, opponentChampId,
                  gp.kills ?? null, gp.deaths ?? null, gp.assists ?? null,
                  gp.creep_score ?? null, gp.minions_killed ?? null, gp.level ?? null,
                  gp.gold_earned ?? null, gp.gold_spent ?? null, gp.gold_percentage ?? null,
                  td.dealt ?? null, td.dealt_to_champions ?? null, td.taken ?? null,
                  td.dealt_percentage ?? null, td.dealt_to_champions_percentage ?? null,
                  pd.dealt ?? null, pd.dealt_to_champions ?? null, pd.taken ?? null,
                  md.dealt ?? null, md.dealt_to_champions ?? null, md.taken ?? null,
                  trd.dealt ?? null, trd.dealt_to_champions ?? null, trd.taken ?? null,
                  gp.total_heal ?? null, gp.total_units_healed ?? null, gp.total_time_crowd_control_dealt ?? null,
                  wards.placed ?? null, wards.sight_wards_bought_in_game ?? null,
                  wards.vision_wards_bought_in_game ?? null, kc.wards ?? null,
                  kc.turrets ?? null, kc.inhibitors ?? null, kc.wards ?? null, kc.neutral_minions ?? null,
                  kc.neutral_minions_enemy_jungle ?? null, kc.neutral_minions_team_jungle ?? null,
                  ks.double_kills ?? null, ks.triple_kills ?? null, ks.quadra_kills ?? null, ks.penta_kills ?? null,
                  flags.first_blood_kill ?? false, flags.first_blood_assist ?? false,
                  flags.first_tower_kill ?? false, flags.first_tower_assist ?? false,
                  gp.items ? gp.items.map(i => i?.id || i) : null,
                  gp.spells?.[0]?.id ?? null, gp.spells?.[1]?.id ?? null,
                  gp.runes_reforged?.primary_path?.id ?? null,
                  gp.runes_reforged?.secondary_path?.id ?? null,
                  gp.runes_reforged?.primary_path?.keystone?.id ?? null,
                  gp.cs_at_14 ?? null, gp.cs_diff_at_14 ?? null,
                ]) || { rows: [] };

                // Pick entry
                if (champId) {
                  await upsert(`
                    INSERT INTO game_picks_bans (game_id, team_id, champion_id, type)
                    VALUES ($1,$2,$3,'pick')
                    ON CONFLICT DO NOTHING
                  `, [game.id, teamId, champId]);
                }

                // Player runes
                const gpId = rows?.[0]?.id;
                if (gpId && gp.runes_reforged) {
                  const rr = gp.runes_reforged;
                  const runeInserts = [];

                  // Keystone
                  if (rr.primary_path?.keystone?.id) runeInserts.push([gpId, rr.primary_path.keystone.id, 'primary', 'keystone']);
                  // Primary lesser runes
                  (rr.primary_path?.lesser_runes || []).forEach((r, i) => {
                    if (r?.id) runeInserts.push([gpId, r.id, 'primary', `slot${i + 1}`]);
                  });
                  // Secondary lesser runes
                  (rr.secondary_path?.lesser_runes || []).forEach((r, i) => {
                    if (r?.id) runeInserts.push([gpId, r.id, 'secondary', `slot${i + 1}`]);
                  });
                  // Shards
                  if (rr.shards?.offense?.id) runeInserts.push([gpId, rr.shards.offense.id, 'primary', 'shard']);
                  if (rr.shards?.flex?.id) runeInserts.push([gpId, rr.shards.flex.id, 'primary', 'shard']);
                  if (rr.shards?.defense?.id) runeInserts.push([gpId, rr.shards.defense.id, 'primary', 'shard']);

                  for (const [gpi, runeId, tree, slot] of runeInserts) {
                    await upsert(`
                      INSERT INTO game_player_runes (game_player_id, rune_id, tree, slot)
                      VALUES ($1,$2,$3,$4)
                      ON CONFLICT DO NOTHING
                    `, [gpi, runeId, tree, slot]);
                  }
                }

                totalPlayers++;
              }
            }
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

        // Frames
        const { data: frames } = await apiGet(`/lol/games/${game.id}/frames`);
        if (frames && Array.isArray(frames)) {
          for (const frame of frames) {
            const ts = frame.current_timestamp ?? frame.timestamp;
            if (ts == null) continue;

            const blue = frame.blue || {};
            const red = frame.red || {};

            await upsert(`
              INSERT INTO game_frames (game_id, timestamp,
                blue_gold, blue_kills, blue_towers, blue_drakes, blue_nashors, blue_heralds,
                blue_inhibitors, blue_voidgrubs, blue_atakhans, blue_score,
                red_gold, red_kills, red_towers, red_drakes, red_nashors, red_heralds,
                red_inhibitors, red_voidgrubs, red_atakhans, red_score)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [game.id, ts,
                blue.gold ?? null, blue.kills ?? null, blue.towers ?? null, blue.drakes ?? null,
                blue.nashors ?? null, blue.heralds ?? null, blue.inhibitors ?? null,
                blue.voidgrubs ?? null, blue.atakhans ?? null, blue.score ?? null,
                red.gold ?? null, red.kills ?? null, red.towers ?? null, red.drakes ?? null,
                red.nashors ?? null, red.heralds ?? null, red.inhibitors ?? null,
                red.voidgrubs ?? null, red.atakhans ?? null, red.score ?? null]);

            frameCount++;

            // Frame players (per role for each side)
            const { rows: frameRows } = await pool.query(
              `SELECT id FROM game_frames WHERE game_id = $1 AND timestamp = $2`, [game.id, ts]
            );
            const frameId = frameRows?.[0]?.id;
            if (frameId) {
              for (const [side, sideColor] of [['blue', 'blue'], ['red', 'red']]) {
                const sideData = frame[side] || {};
                for (const role of ['top', 'jun', 'mid', 'adc', 'sup']) {
                  const rp = sideData[role];
                  if (!rp) continue;
                  await upsert(`
                    INSERT INTO game_frame_players (frame_id, player_id, champion_id, team_color, role,
                      kills, deaths, assists, cs, level)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    ON CONFLICT DO NOTHING
                  `, [frameId, rp.player_id ?? null, rp.champion?.id ?? null,
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
          for (const ev of events) {
            const evType = ev.type;
            if (!VALID_EVENT_TYPES.has(evType)) continue;

            await upsert(`
              INSERT INTO game_events (game_id, timestamp, type,
                killer_player_id, killer_champion_id, victim_player_id, victim_champion_id,
                assistants, is_first)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
              ON CONFLICT DO NOTHING
            `, [game.id, ev.timestamp ?? null, evType,
                ev.killer?.player_id ?? null, ev.killer?.champion_id ?? null,
                ev.victim?.player_id ?? null, ev.victim?.champion_id ?? null,
                ev.assistants ? JSON.stringify(ev.assistants) : null,
                ev.is_first ?? false]);
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
    // Player career stats (per serie)
    const playerCareer = await apiGetAll(`/lol/series/${serie.id}/players/stats`);
    for (const pc of playerCareer) {
      if (!pc.player?.id) continue;
      const stats = pc.stats || pc;
      await upsert(`
        INSERT INTO player_career (player_id, serie_id, team_id,
          games, wins, losses, kills, deaths, assists, kda,
          avg_kills, avg_deaths, avg_assists, avg_kda,
          avg_gpm, avg_cspm, avg_dpm, avg_wpm, avg_wkpm, avg_cwpm,
          total_gold, avg_gold_percentage, avg_damage_percentage,
          avg_cs_at_14, avg_cs_diff_at_14)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
        ON CONFLICT (player_id, serie_id) DO UPDATE SET
          games = EXCLUDED.games, wins = EXCLUDED.wins, kda = EXCLUDED.kda
      `, [pc.player.id, serie.id, pc.team?.id ?? null,
          stats.games_count ?? null, stats.wins ?? null, stats.losses ?? null,
          stats.kills ?? null, stats.deaths ?? null, stats.assists ?? null, stats.kda ?? null,
          stats.average?.kills ?? null, stats.average?.deaths ?? null,
          stats.average?.assists ?? null, stats.average?.kda ?? null,
          stats.average?.gold_per_minute ?? null, stats.average?.cs_per_minute ?? null,
          stats.average?.damage_per_minute ?? null, stats.average?.wards_per_minute ?? null,
          stats.average?.wards_killed_per_minute ?? null, stats.average?.control_wards_per_minute ?? null,
          stats.total?.gold_earned ?? null, stats.average?.gold_percentage ?? null,
          stats.average?.damage_percentage ?? null,
          stats.average?.cs_at_14 ?? null, stats.average?.cs_diff_at_14 ?? null]);
    }
    done(`Serie ${serie.year} ${serie.season}: ${playerCareer.length} player_career`);

    // Team career stats (per serie)
    const teamCareer = await apiGetAll(`/lol/series/${serie.id}/teams/stats`);
    for (const tc of teamCareer) {
      if (!tc.team?.id) continue;
      const stats = tc.stats || tc;
      await upsert(`
        INSERT INTO team_career (team_id, serie_id,
          games, wins, losses, kda,
          avg_kills, avg_deaths, avg_assists,
          avg_gpm, avg_cspm, avg_dpm, avg_wpm, avg_wkpm,
          avg_tower_kills, avg_dragon_kills, avg_baron_kills, avg_herald_kills,
          first_blood_rate, first_tower_rate, first_dragon_rate, first_baron_rate,
          avg_game_length)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (team_id, serie_id) DO UPDATE SET
          games = EXCLUDED.games, wins = EXCLUDED.wins, kda = EXCLUDED.kda
      `, [tc.team.id, serie.id,
          stats.games_count ?? null, stats.wins ?? null, stats.losses ?? null, stats.kda ?? null,
          stats.average?.kills ?? null, stats.average?.deaths ?? null, stats.average?.assists ?? null,
          stats.average?.gold_per_minute ?? null, stats.average?.cs_per_minute ?? null,
          stats.average?.damage_per_minute ?? null, stats.average?.wards_per_minute ?? null,
          stats.average?.wards_killed_per_minute ?? null,
          stats.average?.tower_kills ?? null, stats.average?.dragon_kills ?? null,
          stats.average?.baron_kills ?? null, stats.average?.herald_kills ?? null,
          stats.first_blood_percentage ?? null, stats.first_tower_percentage ?? null,
          stats.first_dragon_percentage ?? null, stats.first_baron_percentage ?? null,
          stats.average?.game_length ?? null]);
    }
    done(`Serie ${serie.year} ${serie.season}: ${teamCareer.length} team_career`);
  }
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
  if (ARG_LEAGUE) log(`  League:   ${ARG_LEAGUE} (ID: ${LEAGUE_IDS[ARG_LEAGUE]})`);
  if (ARG_YEAR) log(`  Year:     ${ARG_YEAR}`);
  if (ARG_SPLIT) log(`  Split:    ${ARG_SPLIT}`);
  log(`  Database: ${PG_DSN.replace(/:[^:@]+@/, ':***@')}`);
  log(`  Flags:    ${[SKIP_STATIC && 'skip-static', STATIC_ONLY && 'static-only', SKIP_TIMELINE && 'skip-timeline', SKIP_STATS && 'skip-stats', DRY_RUN && 'dry-run'].filter(Boolean).join(' ') || 'none'}`);
  log('');

  try {
    // Phase 1: Reference data
    if (!SKIP_STATIC) {
      await phase1_reference();
    }

    if (STATIC_ONLY) {
      done('Static-only mode — done.');
      return;
    }

    // Phase 2: Structure
    const seriesList = await phase2_structure(ARG_LEAGUE, LEAGUE_IDS[ARG_LEAGUE]);

    if (seriesList.length === 0) {
      warn('No series found for the given filters.');
      return;
    }

    // Phase 3: Game data
    await phase3_games(seriesList);

    // Phase 4: Timeline
    if (!SKIP_TIMELINE) {
      await phase4_timeline(seriesList);
    } else {
      log(`\n  ${DIM}Skipping timeline (--skip-timeline)${RST}`);
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
