#!/usr/bin/env node
/**
 * match-poller.js — Continuous 24/7 match status poller
 *
 * Implements status-based ingestion:
 *   • not_started → Register match metadata (scheduled_at, teams, tournament)
 *   • running     → Update status to 'running' (frontend shows "En vivo")
 *   • finished    → Trigger FULL game data dump (stats, timeline, runes — definitive)
 *
 * Architecture:
 *   This script runs as a long-lived process (or Lambda on a schedule).
 *   Every POLL_INTERVAL seconds it:
 *     1. Fetches /lol/matches/upcoming → upserts as not_started
 *     2. Fetches /lol/matches/running  → updates status to running
 *     3. Queries DB for finished-but-not-ingested matches
 *     4. For each: spawns fetch-to-postgres.js --match-id <id> to do the full dump
 *     5. After dump, marks match as games_ingested_at = NOW()
 *
 * This does NOT replace auto-ingest.js — that handles historical backfill
 * (full series sweeps). This handles real-time status tracking.
 *
 * Usage:
 *   node scripts/match-poller.js                   # run continuously
 *   node scripts/match-poller.js --once             # single poll cycle
 *   node scripts/match-poller.js --interval 120     # poll every 2 min
 *   node scripts/match-poller.js --leagues LEC,LCK  # only specific leagues
 *
 * Env vars:
 *   PG_DSN             — PostgreSQL connection string
 *   PANDASCORE_TOKEN   — PandaScore API token
 *   POLL_INTERVAL      — Seconds between polls (default: 90)
 */

import { spawn } from 'child_process';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logIngestionFailure, markFailuresResolved } from './lib/digestFailures.js';

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

// ─── Config ───────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.pandascore.co';
const TOKEN = process.env.PANDASCORE_TOKEN;
const PG_DSN = process.env.PG_DSN;

if (!PG_DSN) { console.error('ERROR: PG_DSN not set'); process.exit(1); }
if (!TOKEN) { console.error('ERROR: PANDASCORE_TOKEN not set'); process.exit(1); }

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const ONCE = hasFlag('once');
const REFRESH_STATS = hasFlag('refresh-stats');
const FIX_SCORES = hasFlag('fix-scores');
const POLL_INTERVAL = Number(getArg('interval') || process.env.POLL_INTERVAL || 90) * 1000;
const LEAGUE_FILTER = getArg('leagues')?.split(',').map(l => l.trim().toUpperCase()) || null;
const MAX_CONCURRENT_INGESTS = Number(getArg('max-concurrent') || 2);

const FETCH_SCRIPT = path.join(__dirname, 'fetch-to-postgres.js');

// ─── League IDs (same as fetch-to-postgres.js) ───────────────────────────
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

// Build reverse map: league_id → slug
const LEAGUE_SLUGS = {};
for (const [slug, id] of Object.entries(LEAGUE_IDS)) {
  LEAGUE_SLUGS[id] = slug;
}

// Tracked league IDs (filtered if --leagues flag provided)
const TRACKED_LEAGUE_IDS = LEAGUE_FILTER
  ? LEAGUE_FILTER.map(l => LEAGUE_IDS[l]).filter(Boolean)
  : Object.values(LEAGUE_IDS);

const TRACKED_LEAGUE_IDS_SET = new Set(TRACKED_LEAGUE_IDS);

// ─── Logging ──────────────────────────────────────────────────────────────
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (msg) => console.log(`[${ts()}] ${msg}`);
const logOk = (msg) => console.log(`[${ts()}] ${GREEN}✓${RST} ${msg}`);
const logWarn = (msg) => console.log(`[${ts()}] ${YELLOW}⚠${RST} ${msg}`);
const logErr = (msg) => console.error(`[${ts()}] ${RED}✗${RST} ${msg}`);
const logLive = (msg) => console.log(`[${ts()}] ${CYAN}▶${RST} ${msg}`);

// ─── HTTP client (same rate-limited pattern as fetch-to-postgres.js) ─────
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
      if (attempt <= 5) { log(`  â³ 429 — waiting ${ra}s (attempt ${attempt})...`); await sleep(ra * 1000); return apiFetch(url, attempt + 1); }
      throw new Error(`429 after ${attempt} retries`);
    }
    if (res.status >= 500 && attempt <= 3) { await sleep(2000 * attempt); return apiFetch(url, attempt + 1); }
    if (res.status === 403 || res.status === 404) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);

    return await res.json();
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError' && attempt <= 3) { log(`  â³ Timeout (attempt ${attempt})...`); await sleep(2000 * attempt); return apiFetch(url, attempt + 1); }
    throw err;
  }
}

function buildUrl(path, params = {}) {
  const u = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) { if (v != null) u.searchParams.set(k, String(v)); }
  return u.toString();
}

async function apiGetAll(path, params = {}, maxPages = 10) {
  const url = buildUrl(path, { ...params, per_page: 100, page: 1 });
  const first = await apiFetch(url);
  if (!Array.isArray(first)) return first ? [first] : [];
  const results = [...first];
  // PandaScore doesn't always return X-Total for pre-filtered endpoints,
  // so paginate only if we got a full page
  if (first.length === 100) {
    for (let p = 2; p <= maxPages; p++) {
      const pageUrl = buildUrl(path, { ...params, per_page: 100, page: p });
      const page = await apiFetch(pageUrl);
      if (!Array.isArray(page) || page.length === 0) break;
      results.push(...page);
      if (page.length < 100) break;
    }
  }
  return results;
}

// ─── DB Pool ──────────────────────────────────────────────────────────────
function createPool() {
  const poolConfig = { connectionString: PG_DSN, max: 3, connectionTimeoutMillis: 5000 };
  if (PG_DSN.includes('rds.amazonaws.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  return new pg.Pool(poolConfig);
}

// ─── Role normalization (minimal — just for match metadata) ──────────────
const ROLE_MAP = { top: 'top', jun: 'jun', jungle: 'jun', mid: 'mid', adc: 'adc', bot: 'adc', sup: 'sup', support: 'sup' };
const VALID_ROLES = new Set(['top', 'jun', 'mid', 'adc', 'sup']);
const normRole = (r) => { const n = ROLE_MAP[r?.toLowerCase()]; return n && VALID_ROLES.has(n) ? n : null; };
const VALID_STATUSES = new Set(['finished', 'running', 'not_started', 'canceled', 'postponed']);
const normStatus = (s) => VALID_STATUSES.has(s) ? s : null;

// ─── Ensure referenced entities exist (auto-fetch from API if missing) ────
const _knownChampions = new Set();
const _knownItems = new Set();

async function ensureChampionExists(pool, champId, champName) {
  if (!champId || _knownChampions.has(champId)) return true;
  const { rows } = await pool.query('SELECT 1 FROM champions WHERE id = $1', [champId]);
  if (rows.length) { _knownChampions.add(champId); return true; }
  // Also check champion_aliases
  const { rows: aliasRows } = await pool.query('SELECT canonical_id FROM champion_aliases WHERE pandascore_id = $1', [champId]);
  if (aliasRows.length) { _knownChampions.add(champId); return true; }
  // Try to fetch from API
  try {
    const data = await apiFetch(buildUrl(`/lol/champions/${champId}`));
    if (data && data.id) {
      const name = data.name || champName || `Champion ${champId}`;
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      await pool.query(`
        INSERT INTO champions (id, name, slug, image_url, big_image_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [data.id, name, slug, data.image_url || null, data.big_image_url || null]);
      await pool.query(`
        INSERT INTO champion_aliases (pandascore_id, canonical_id, name, image_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (pandascore_id) DO NOTHING
      `, [data.id, data.id, name, data.image_url || null]);
      _knownChampions.add(champId);
      log(`  ✓ Auto-fetched champion ${champId} (${name})`);
      return true;
    }
  } catch (e) { /* API fetch failed, skip */ }
  return false;
}

async function ensureItemExists(pool, itemId) {
  if (!itemId || _knownItems.has(itemId)) return true;
  const { rows } = await pool.query('SELECT 1 FROM items WHERE id = $1', [itemId]);
  if (rows.length) { _knownItems.add(itemId); return true; }
  // Try to fetch from API
  try {
    const data = await apiFetch(buildUrl(`/lol/items/${itemId}`));
    if (data && data.id && data.name) {
      await pool.query(`
        INSERT INTO items (id, name, image_url, is_trinket, gold_total)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `, [data.id, data.name, data.image_url || null, data.is_trinket ?? false, data.gold_total ?? null]);
      _knownItems.add(itemId);
      log(`  ✓ Auto-fetched item ${itemId} (${data.name})`);
      return true;
    }
  } catch (e) { /* API fetch failed, skip */ }
  return false;
}

const _knownRunes = new Set();
async function ensureRuneExists(pool, runeId, runeName) {
  if (!runeId || _knownRunes.has(runeId)) return true;
  const { rows } = await pool.query('SELECT 1 FROM runes WHERE id = $1', [runeId]);
  if (rows.length) { _knownRunes.add(runeId); return true; }
  try {
    // PandaScore doesn't have a single-rune endpoint, so insert a stub
    const name = runeName || `Rune ${runeId}`;
    await pool.query(`
      INSERT INTO runes (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING
    `, [runeId, name]);
    _knownRunes.add(runeId);
    log(`  ✓ Auto-inserted rune stub ${runeId} (${name})`);
    return true;
  } catch (e) { /* insert failed, skip */ }
  return false;
}

const _knownPlayers = new Set();
async function ensurePlayerExists(pool, playerId, playerName) {
  if (!playerId || _knownPlayers.has(playerId)) return true;
  const { rows } = await pool.query('SELECT 1 FROM players WHERE id = $1', [playerId]);
  if (rows.length) { _knownPlayers.add(playerId); return true; }
  try {
    const data = await apiFetch(buildUrl(`/lol/players/${playerId}`));
    if (data && data.id) {
      const name = data.name || playerName || `Player ${playerId}`;
      await pool.query(`
        INSERT INTO players (id, name, slug, first_name, last_name, image_url, role, nationality)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
      `, [data.id, name, data.slug || name.toLowerCase(), data.first_name || null,
          data.last_name || null, data.image_url || null,
          data.role ? normRole(data.role) : null, data.nationality || null]);
      _knownPlayers.add(playerId);
      log(`  ✓ Auto-fetched player ${playerId} (${name})`);
      return true;
    }
  } catch (e) { /* API fetch failed, skip */ }
  return false;
}

// ─── Ensure migration applied ─────────────────────────────────────────────
async function ensureMigration(pool) {
  const sqlPath = path.join(__dirname, 'sql', 'match_ingestion_tracking.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    await pool.query(sql);
  }
  // Also ensure ingestion_state exists
  const statePath = path.join(__dirname, 'sql', 'ingestion_state.sql');
  if (fs.existsSync(statePath)) {
    const sql = fs.readFileSync(statePath, 'utf-8');
    await pool.query(sql);
  }
  logOk('Migrations applied');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 1: Poll upcoming matches → register as not_started
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function pollUpcoming(pool) {
  log('Polling upcoming matches...');

  // PandaScore pre-filtered endpoint: /lol/matches/upcoming
  // Returns matches sorted by scheduled_at ascending
  const matches = await apiGetAll('/lol/matches/upcoming', {
    'filter[videogame]': 'lol',
    sort: 'scheduled_at',
  });

  let registered = 0;
  let skipped = 0;

  for (const m of matches) {
    // Only track leagues we care about
    if (!TRACKED_LEAGUE_IDS_SET.has(m.league_id)) { skipped++; continue; }

    const status = normStatus(m.status) || 'not_started';

    // Ensure league/serie/tournament exist (lightweight upsert)
    await ensureMatchStructure(pool, m);

    // Upsert match metadata (NO game data — just scheduling info)
    await pool.query(`
      INSERT INTO matches (id, tournament_id, serie_id, league_id, name, slug, match_type,
        number_of_games, status, begin_at, scheduled_at, original_scheduled_at,
        forfeit, draw, rescheduled, detailed_stats, stream_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, begin_at = COALESCE(EXCLUDED.begin_at, matches.begin_at),
        scheduled_at = COALESCE(EXCLUDED.scheduled_at, matches.scheduled_at),
        stream_url = COALESCE(EXCLUDED.stream_url, matches.stream_url),
        rescheduled = EXCLUDED.rescheduled
    `, [
      m.id, m.tournament_id, m.serie_id, m.league_id,
      m.name, m.slug, m.match_type || null,
      m.number_of_games,
      status,
      m.begin_at, m.scheduled_at || null, m.original_scheduled_at || null,
      m.forfeit ?? false, m.draw ?? false, m.rescheduled ?? false,
      m.detailed_stats ?? false,
      m.streams_list?.[0]?.raw_url || null,
    ]);

    // Upsert opponents
    if (m.opponents) {
      for (let i = 0; i < m.opponents.length; i++) {
        const opp = m.opponents[i];
        const team = opp.opponent || opp;
        if (!team.id) continue;

        // Ensure team exists
        await pool.query(`
          INSERT INTO teams (id, name, slug, acronym, location, image_url)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, image_url = EXCLUDED.image_url,
            acronym = EXCLUDED.acronym
        `, [team.id, team.name, team.slug, team.acronym, team.location, team.image_url]);

        await pool.query(`
          INSERT INTO match_opponents (match_id, team_id, side, result_score)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (match_id, team_id) DO UPDATE SET
            result_score = COALESCE(EXCLUDED.result_score, match_opponents.result_score)
        `, [m.id, team.id, i + 1, m.results?.[i]?.score ?? null]);
      }
    }

    registered++;
  }

  // DB-based stats that actually reflect progress
  const { rows: [dbStats] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'not_started')::int AS upcoming,
      COUNT(*) FILTER (WHERE status = 'running')::int AS live,
      COUNT(*) FILTER (WHERE status = 'finished' AND games_ingested_at IS NOT NULL)::int AS ingested,
      COUNT(*) FILTER (WHERE status = 'finished' AND games_ingested_at IS NULL)::int AS pending,
      COUNT(*) FILTER (WHERE status = 'not_started'
        AND scheduled_at < NOW() - INTERVAL '3 hours'
        AND games_ingested_at IS NULL)::int AS stale
    FROM matches
    WHERE league_id = ANY($1::int[])
  `, [TRACKED_LEAGUE_IDS]);

  logOk(`DB: ${dbStats.ingested} ingested, ${dbStats.upcoming} upcoming, ${dbStats.live} live | Pending: ${dbStats.pending} finished, ${dbStats.stale} stale | API: ${registered} synced, ${skipped} skipped`);
  return registered;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 2: Poll running matches → update status to 'running'
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function pollRunning(pool) {
  log('Polling running matches...');

  const matches = await apiGetAll('/lol/matches/running', {
    'filter[videogame]': 'lol',
  });

  let updated = 0;

  for (const m of matches) {
    if (!TRACKED_LEAGUE_IDS_SET.has(m.league_id)) continue;

    // Ensure structure
    await ensureMatchStructure(pool, m);

    // Update to running — NO game data written
    await pool.query(`
      INSERT INTO matches (id, tournament_id, serie_id, league_id, name, slug, match_type,
        number_of_games, status, begin_at, scheduled_at, original_scheduled_at,
        forfeit, draw, rescheduled, detailed_stats, stream_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'running',$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (id) DO UPDATE SET
        status = 'running',
        begin_at = COALESCE(EXCLUDED.begin_at, matches.begin_at),
        stream_url = COALESCE(EXCLUDED.stream_url, matches.stream_url)
    `, [
      m.id, m.tournament_id, m.serie_id, m.league_id,
      m.name, m.slug, m.match_type || null, m.number_of_games,
      m.begin_at, m.scheduled_at || null, m.original_scheduled_at || null,
      m.forfeit ?? false, m.draw ?? false, m.rescheduled ?? false,
      m.detailed_stats ?? false,
      m.streams_list?.[0]?.raw_url || null,
    ]);

    // Update opponents (scores may be updating live)
    if (m.opponents) {
      for (let i = 0; i < m.opponents.length; i++) {
        const opp = m.opponents[i];
        const team = opp.opponent || opp;
        if (!team.id) continue;

        await pool.query(`
          INSERT INTO teams (id, name, slug, acronym, location, image_url)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, image_url = EXCLUDED.image_url
        `, [team.id, team.name, team.slug, team.acronym, team.location, team.image_url]);

        await pool.query(`
          INSERT INTO match_opponents (match_id, team_id, side, result_score)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (match_id, team_id) DO UPDATE SET
            result_score = COALESCE(EXCLUDED.result_score, match_opponents.result_score)
        `, [m.id, team.id, i + 1, m.results?.[i]?.score ?? null]);
      }
    }

    const leagueSlug = LEAGUE_SLUGS[m.league_id] || m.league_id;
    const teams = (m.opponents || []).map(o => (o.opponent || o).acronym || (o.opponent || o).name).join(' vs ');
    logLive(`LIVE: ${leagueSlug} — ${teams} (match ${m.id})`);
    updated++;
  }

  logOk(`Running: ${updated} matches live`);
  return updated;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 3: Detect & ingest newly finished matches
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function pollFinished(pool) {
  log('Checking for newly finished matches...');

  // Strategy: poll /lol/matches/past (recent) and cross-reference with DB
  // Also check DB for matches that were 'running' but may now be finished
  const recentPast = await apiGetAll('/lol/matches/past', {
    'filter[videogame]': 'lol',
    sort: '-end_at',
    per_page: 50,  // Last 50 finished matches
  });

  let newlyFinished = 0;

  for (const m of recentPast) {
    if (!TRACKED_LEAGUE_IDS_SET.has(m.league_id)) continue;
    if (m.status !== 'finished' && !m.winner_id) continue;

    // Check if already ingested
    const { rows } = await pool.query(
      `SELECT id, games_ingested_at FROM matches WHERE id = $1`, [m.id]
    );

    if (rows.length > 0 && rows[0].games_ingested_at) {
      continue; // Already fully ingested
    }

    // Ensure structure exists
    await ensureMatchStructure(pool, m);

    // Ensure teams exist BEFORE match insert (winner_id FK requires it)
    if (m.opponents) {
      for (const opp of m.opponents) {
        const team = opp.opponent || opp;
        if (!team.id) continue;
        await pool.query(`
          INSERT INTO teams (id, name, slug, acronym, location, image_url)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
        `, [team.id, team.name, team.slug, team.acronym, team.location, team.image_url]);
      }
    }

    // Update match to finished + winner
    await pool.query(`
      INSERT INTO matches (id, tournament_id, serie_id, league_id, name, slug, match_type,
        number_of_games, status, begin_at, end_at, scheduled_at, original_scheduled_at,
        winner_id, winner_type, forfeit, draw, rescheduled, detailed_stats, stream_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'finished',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (id) DO UPDATE SET
        status = 'finished', end_at = EXCLUDED.end_at,
        winner_id = EXCLUDED.winner_id, winner_type = EXCLUDED.winner_type
    `, [
      m.id, m.tournament_id, m.serie_id, m.league_id,
      m.name, m.slug, m.match_type || null, m.number_of_games,
      m.begin_at, m.end_at, m.scheduled_at || null, m.original_scheduled_at || null,
      m.winner_id, m.winner_type || null,
      m.forfeit ?? false, m.draw ?? false, m.rescheduled ?? false,
      m.detailed_stats ?? false,
      m.streams_list?.[0]?.raw_url || null,
    ]);

    // Update opponents with final scores
    if (m.opponents) {
      for (let i = 0; i < m.opponents.length; i++) {
        const opp = m.opponents[i];
        const team = opp.opponent || opp;
        if (!team.id) continue;

        await pool.query(`
          INSERT INTO match_opponents (match_id, team_id, side, result_score)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (match_id, team_id) DO UPDATE SET result_score = EXCLUDED.result_score
        `, [m.id, team.id, i + 1, m.results?.[i]?.score ?? null]);
      }
    }

    newlyFinished++;
  }

  // Also check DB: matches that were 'running' and might have finished
  // (edge case: the /past endpoint might not list them yet)
  const { rows: staleRunning } = await pool.query(`
    SELECT id FROM matches
    WHERE status = 'running'
      AND begin_at < NOW() - INTERVAL '6 hours'
      AND games_ingested_at IS NULL
  `);

  for (const row of staleRunning) {
    // Re-check via API
    const url = buildUrl(`/lol/matches/${row.id}`);
    const match = await apiFetch(url);
    if (Array.isArray(match) && match.length === 0) continue;
    if (!match || !match.id) continue;

    if (match.status === 'finished' || match.winner_id) {
      // Ensure winner team exists before updating
      if (match.winner_id && match.opponents) {
        for (const opp of match.opponents) {
          const team = opp.opponent || opp;
          if (!team.id) continue;
          await pool.query(`
            INSERT INTO teams (id, name, slug, acronym, location, image_url)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
          `, [team.id, team.name, team.slug, team.acronym, team.location, team.image_url]);
        }
      }
      await pool.query(
        `UPDATE matches SET status = 'finished', end_at = $2, winner_id = $3 WHERE id = $1`,
        [match.id, match.end_at, match.winner_id]
      );
      newlyFinished++;
    }
  }

  // Also catch up: matches that are 'not_started' but scheduled_at is in the past
  // (happens when a league wasn't tracked before or poller was offline)
  const { rows: staleUpcoming } = await pool.query(`
    SELECT id FROM matches
    WHERE status = 'not_started'
      AND league_id = ANY($1::int[])
      AND scheduled_at < NOW() - INTERVAL '3 hours'
      AND games_ingested_at IS NULL
    ORDER BY scheduled_at ASC
    LIMIT 50
  `, [TRACKED_LEAGUE_IDS]);

  // Count total remaining stale matches (for progress display)
  const { rows: [{ count: totalStaleCount }] } = await pool.query(`
    SELECT COUNT(*)::int AS count FROM matches
    WHERE status = 'not_started'
      AND league_id = ANY($1::int[])
      AND scheduled_at < NOW() - INTERVAL '3 hours'
      AND games_ingested_at IS NULL
  `, [TRACKED_LEAGUE_IDS]);

  if (staleUpcoming.length > 0) {
    log(`  Catch-up: processing ${staleUpcoming.length} of ${totalStaleCount} stale upcoming matches...`);
  }

  for (const row of staleUpcoming) {
    const url = buildUrl(`/lol/matches/${row.id}`);
    const match = await apiFetch(url);
    if (Array.isArray(match) && match.length === 0) continue;
    if (!match || !match.id) continue;

    if (match.status === 'finished' || match.winner_id) {
      await ensureMatchStructure(pool, match);
      if (match.opponents) {
        for (const opp of match.opponents) {
          const team = opp.opponent || opp;
          if (!team.id) continue;
          await pool.query(`
            INSERT INTO teams (id, name, slug, acronym, location, image_url)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_url = EXCLUDED.image_url
          `, [team.id, team.name, team.slug, team.acronym, team.location, team.image_url]);
        }
      }
      await pool.query(`
        INSERT INTO matches (id, tournament_id, serie_id, league_id, name, slug, match_type,
          number_of_games, status, begin_at, end_at, scheduled_at, original_scheduled_at,
          winner_id, winner_type, forfeit, draw, rescheduled, detailed_stats, stream_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'finished',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (id) DO UPDATE SET
          status = 'finished', end_at = EXCLUDED.end_at,
          winner_id = EXCLUDED.winner_id, winner_type = EXCLUDED.winner_type
      `, [
        match.id, match.tournament_id, match.serie_id, match.league_id,
        match.name, match.slug, match.match_type || null, match.number_of_games,
        match.begin_at, match.end_at, match.scheduled_at || null, match.original_scheduled_at || null,
        match.winner_id, match.winner_type || null,
        match.forfeit ?? false, match.draw ?? false, match.rescheduled ?? false,
        match.detailed_stats ?? false,
        match.streams_list?.[0]?.raw_url || null,
      ]);

      // Update opponents with final scores
      if (match.opponents) {
        for (let i = 0; i < match.opponents.length; i++) {
          const opp = match.opponents[i];
          const team = opp.opponent || opp;
          if (!team.id) continue;
          await pool.query(`
            INSERT INTO match_opponents (match_id, team_id, side, result_score)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (match_id, team_id) DO UPDATE SET result_score = EXCLUDED.result_score
          `, [match.id, team.id, i + 1, match.results?.[i]?.score ?? null]);
        }
      }

      newlyFinished++;
    } else if (match.status === 'canceled' || match.status === 'postponed') {
      await pool.query('UPDATE matches SET status = $2 WHERE id = $1', [match.id, match.status]);
    }
  }

  // Show catch-up remaining after processing
  const staleRemaining = Math.max(0, totalStaleCount - staleUpcoming.length);
  if (totalStaleCount > 0) {
    logOk(`Newly finished: ${newlyFinished} matches to ingest | Catch-up remaining: ${staleRemaining} stale matches`);
  } else {
    logOk(`Newly finished: ${newlyFinished} matches to ingest | Catch-up: all clear ✓`);
  }

  // Now trigger game data ingestion for all pending matches
  if (newlyFinished > 0) {
    const ingestedIds = await ingestPendingMatches(pool);
    if (ingestedIds && ingestedIds.length > 0) {
      // Refresh stats after ingestion
      await refreshAllStats(pool, ingestedIds);
    }
  }

  return newlyFinished;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 4: Full game data dump for finished matches
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function ingestPendingMatches(pool) {
  const { rows: pending } = await pool.query(`
    SELECT m.id, m.tournament_id, m.serie_id, m.league_id, m.name
    FROM matches m
    WHERE m.status = 'finished'
      AND (m.games_ingested_at IS NULL
           OR (m.games_ingested_at = '1970-01-01' AND m.end_at < NOW() - INTERVAL '7 days'))
    ORDER BY m.end_at ASC NULLS LAST
    LIMIT 20
  `);

  if (pending.length === 0) {
    logOk('No pending matches to ingest');
    return [];
  }

  log(`Ingesting game data for ${pending.length} matches...`);

  const ingestedIds = [];

  // Process in batches to limit concurrency
  for (let i = 0; i < pending.length; i += MAX_CONCURRENT_INGESTS) {
    const batch = pending.slice(i, i + MAX_CONCURRENT_INGESTS);
    const promises = batch.map(match => ingestSingleMatch(pool, match));
    const results = await Promise.all(promises);

    // Collect successfully ingested match IDs
    for (const result of results) {
      if (result && result.success) {
        ingestedIds.push(result.matchId);
      }
    }
  }

  return ingestedIds;
}

// Compute match scores from games.winner_id when PandaScore didn't provide results
async function backfillMatchScores(pool, matchId) {
  try {
    // Skip canceled/postponed matches — they have no real scores
    const { rows: [mStatus] } = await pool.query(
      'SELECT status FROM matches WHERE id = $1', [matchId]
    );
    if (!mStatus || mStatus.status === 'canceled' || mStatus.status === 'postponed') return;

    const { rows: opps } = await pool.query(
      'SELECT team_id, result_score FROM match_opponents WHERE match_id = $1', [matchId]
    );
    // Only backfill if all scores are null or 0
    const needsBackfill = opps.length > 0 && opps.every(o => !o.result_score);
    if (!needsBackfill) return;

    // Count games won per team (only finished games with a winner)
    const { rows: gameCounts } = await pool.query(`
      SELECT winner_id, COUNT(*) AS wins
      FROM games
      WHERE match_id = $1 AND finished = true AND winner_id IS NOT NULL
      GROUP BY winner_id
    `, [matchId]);

    if (gameCounts.length > 0) {
      // Strategy A: compute from finished game winners
      const scoreMap = {};
      for (const gc of gameCounts) scoreMap[gc.winner_id] = Number(gc.wins);

      for (const opp of opps) {
        const score = scoreMap[opp.team_id] || 0;
        await pool.query(
          'UPDATE match_opponents SET result_score = $1 WHERE match_id = $2 AND team_id = $3',
          [score, matchId, opp.team_id]
        );
      }

      // Also update match winner_id if missing
      const { rows: mRows } = await pool.query('SELECT winner_id FROM matches WHERE id = $1', [matchId]);
      if (mRows.length && !mRows[0].winner_id) {
        const winner = gameCounts.reduce((a, b) => Number(a.wins) >= Number(b.wins) ? a : b);
        if (Number(winner.wins) > 0) {
          await pool.query('UPDATE matches SET winner_id = $1 WHERE id = $2', [winner.winner_id, matchId]);
        }
      }

      log(`  ✓ Backfilled scores for match ${matchId} from game results`);
      return;
    }

    // Strategy B: no finished games with winners, but match has winner_id
    // Infer score from total games played + winner_id
    const { rows: mRows } = await pool.query(
      'SELECT winner_id, number_of_games FROM matches WHERE id = $1', [matchId]
    );
    if (!mRows.length || !mRows[0].winner_id) return;

    const winnerId = mRows[0].winner_id;
    const bo = mRows[0].number_of_games || 1;

    // Count total games in the match (finished or not)
    const { rows: totalGames } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM games WHERE match_id = $1', [matchId]
    );
    const gamesPlayed = Number(totalGames[0]?.cnt || 0);

    // Winner score = games needed to win the BO (ceil(bo/2)), or gamesPlayed if BO1
    // Loser score = gamesPlayed - winnerScore
    const winsNeeded = Math.ceil(bo / 2); // BO1→1, BO3→2, BO5→3
    const winnerScore = gamesPlayed > 0 ? Math.min(winsNeeded, gamesPlayed) : winsNeeded;
    const loserScore = Math.max(0, gamesPlayed - winnerScore);

    for (const opp of opps) {
      const score = opp.team_id === winnerId ? winnerScore : loserScore;
      await pool.query(
        'UPDATE match_opponents SET result_score = $1 WHERE match_id = $2 AND team_id = $3',
        [score, matchId, opp.team_id]
      );
    }

    log(`  ✓ Backfilled scores for match ${matchId} from winner_id (${winnerScore}-${loserScore})`);
  } catch (e) {
    logWarn(`  backfillMatchScores ${matchId}: ${e.message}`);
  }
}

async function ingestSingleMatch(pool, match) {
  const leagueSlug = LEAGUE_SLUGS[match.league_id] || null;
  const matchLabel = `${leagueSlug || match.league_id} match ${match.id}`;

  log(`  Ingesting ${matchLabel}...`);

  try {
    const result = await runFetchForMatch(match.id);

    if (result.success) {
      // Verify that games actually have data (some leagues return empty shells)
      const { rows: [gameCheck] } = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE g.finished = true AND g.length > 0)::int AS real_games,
               COUNT(*)::int AS total_games
        FROM games g WHERE g.match_id = $1
      `, [match.id]);

      if (gameCheck.real_games > 0 || gameCheck.total_games === 0) {
        // Has real game data, or no games at all → mark as ingested
        await pool.query(
          `UPDATE matches SET games_ingested_at = NOW() WHERE id = $1`,
          [match.id]
        );
      } else {
        // Games exist but are empty shells (no finished games, no length)
        // Mark with a special timestamp far in the past so we know it was attempted
        // but don't block future re-ingestion attempts
        await pool.query(
          `UPDATE matches SET games_ingested_at = '1970-01-01' WHERE id = $1`,
          [match.id]
        );
        logWarn(`  ${matchLabel}: games are empty shells (${gameCheck.total_games} games, 0 with data) — marked for retry`);
        await logIngestionFailure(pool, {
          source: 'match-poller',
          league_slug: leagueSlug,
          league_id: match.league_id,
          match_id: match.id,
          stage: 'ingest-verify',
          error_type: 'empty_games',
          message: `${matchLabel}: ${gameCheck.total_games} games ingestadas sin datos reales`,
        });
      }

      // Backfill scores from games if result_score is still null/0
      await backfillMatchScores(pool, match.id);

      // Fallo previamente registrado para este match queda resuelto
      await markFailuresResolved(pool, { match_id: match.id });

      logOk(`  ${matchLabel}: OK (${result.apiCalls} API calls)`);
      return { success: true, matchId: match.id };
    } else {
      logErr(`  ${matchLabel}: FAILED — ${result.stderr?.slice(0, 200)}`);
      await logIngestionFailure(pool, {
        source: 'match-poller',
        league_slug: leagueSlug,
        league_id: match.league_id,
        match_id: match.id,
        stage: 'fetch-to-postgres',
        message: result.stderr?.slice(0, 1000) || `Exit code ${result.code ?? 'unknown'}`,
      });
      return { success: false, matchId: match.id };
    }
  } catch (err) {
    logErr(`  ${matchLabel}: ERROR — ${err.message}`);
    await logIngestionFailure(pool, {
      source: 'match-poller',
      league_slug: leagueSlug,
      league_id: match.league_id,
      match_id: match.id,
      stage: 'ingest-exception',
      message: err.message,
      stack: err.stack,
    });
    return { success: false, matchId: match.id };
  }
}

function runFetchForMatch(matchId) {
  return new Promise((resolve) => {
    const cmdArgs = [
      FETCH_SCRIPT,
      '--match-id', String(matchId),
      '--skip-static',
    ];

    const child = spawn('node', cmdArgs, {
      env: { ...process.env, PG_DSN, PANDASCORE_TOKEN: TOKEN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const match = stdout.match(/API requests:\s*(\d+)/);
      const apiCalls = match ? Number(match[1]) : 0;
      resolve({ success: code === 0, apiCalls, stdout, stderr, code });
    });

    child.on('error', (e) => {
      resolve({ success: false, apiCalls: 0, stderr: e.message, code: -1 });
    });
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS: Ensure league/serie/tournament structure exists
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function ensureMatchStructure(pool, m) {
  // League
  if (m.league_id) {
    const slug = LEAGUE_SLUGS[m.league_id] || m.league?.slug || `league-${m.league_id}`;
    const name = m.league?.name || slug;
    await pool.query(`
      INSERT INTO leagues (id, name, slug, image_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
    `, [m.league_id, name, slug.toLowerCase(), m.league?.image_url || null]);
  }

  // Serie
  if (m.serie_id && m.serie) {
    await pool.query(`
      INSERT INTO series (id, league_id, full_name, slug, year, season, begin_at, end_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO NOTHING
    `, [
      m.serie_id, m.league_id,
      m.serie.full_name || m.serie.name || null,
      m.serie.slug || null,
      m.serie.year || null,
      m.serie.season || null,
      m.serie.begin_at || null,
      m.serie.end_at || null,
    ]);
  } else if (m.serie_id) {
    await pool.query(`
      INSERT INTO series (id, league_id)
      VALUES ($1,$2)
      ON CONFLICT (id) DO NOTHING
    `, [m.serie_id, m.league_id]);
  }

  // Tournament
  if (m.tournament_id && m.tournament) {
    await pool.query(`
      INSERT INTO tournaments (id, serie_id, league_id, name, slug, begin_at, end_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO NOTHING
    `, [
      m.tournament_id, m.serie_id, m.league_id,
      m.tournament.name || null, m.tournament.slug || null,
      m.tournament.begin_at || null, m.tournament.end_at || null,
    ]);
  } else if (m.tournament_id) {
    await pool.query(`
      INSERT INTO tournaments (id, serie_id, league_id)
      VALUES ($1,$2,$3)
      ON CONFLICT (id) DO NOTHING
    `, [m.tournament_id, m.serie_id || null, m.league_id || null]);
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 5: Static Data Refresh (24h + startup)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let lastStaticRefresh = null;
const STATIC_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function refreshStaticIfNeeded() {
  const now = Date.now();
  if (lastStaticRefresh === null || (now - lastStaticRefresh) >= STATIC_REFRESH_INTERVAL) {
    log('Running static data refresh...');
    try {
      const result = await runStaticRefresh();
      if (result.success) {
        lastStaticRefresh = now;
        logOk(`Static data refreshed (${result.apiCalls} API calls)`);
      } else {
        logWarn(`Static data refresh failed: ${result.stderr?.slice(0, 200)}`);
      }
    } catch (err) {
      logErr(`Static refresh error: ${err.message}`);
    }
  }
}

function runStaticRefresh() {
  return new Promise((resolve) => {
    const cmdArgs = [
      FETCH_SCRIPT,
      '--static-only',
    ];

    const child = spawn('node', cmdArgs, {
      env: { ...process.env, PG_DSN, PANDASCORE_TOKEN: TOKEN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const match = stdout.match(/API requests:\s*(\d+)/);
      const apiCalls = match ? Number(match[1]) : 0;
      resolve({ success: code === 0, apiCalls, stdout, stderr, code });
    });

    child.on('error', (e) => {
      resolve({ success: false, apiCalls: 0, stderr: e.message, code: -1 });
    });
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STEP 6: Derived Stats Refresh (after match ingestion)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function refreshAllStats(pool, matchIds) {
  if (!matchIds || matchIds.length === 0) {
    return;
  }

  log(`Refreshing stats for ${matchIds.length} ingested matches...`);

  try {
    // Wait before refreshing to allow fetch-to-postgres time to complete
    await sleep(10000);

    // Find affected serie_id and tournament_id from ingested matches
    const { rows: affectedMatches } = await pool.query(`
      SELECT DISTINCT serie_id, tournament_id
      FROM matches
      WHERE id = ANY($1::int[])
    `, [matchIds]);

    const serieIds = new Set();

    for (const m of affectedMatches) {
      if (m.serie_id) serieIds.add(m.serie_id);
    }

    let statsRefreshed = 0;

    // Refresh player_career and team_career for each affected serie
    for (const serieId of serieIds) {
      statsRefreshed += await refreshSerieStats(pool, serieId);
    }

    // Refresh champion_global_stats for each affected serie
    for (const serieId of serieIds) {
      statsRefreshed += await refreshChampionGlobalStats(pool, serieId);
    }

    logOk(`Stats refresh complete: ${statsRefreshed} records updated`);
  } catch (err) {
    logErr(`Stats refresh error: ${err.message}`);
  }
}

async function refreshSerieStats(pool, serieId) {
  let updated = 0;

  try {
    // ─── Player career stats ─────────────────────────────────────────
    // PandaScore has NO bulk endpoint for player stats per series.
    // We must: 1) get player IDs from the DB (game_players for this serie), 2) call individual stats endpoints.
    log(`  Refreshing player_career for serie ${serieId}...`);

    // Step 1: Get distinct players who actually played in this serie from our DB
    const { rows: dbPlayers } = await pool.query(`
      SELECT DISTINCT gp.player_id, gp.team_id,
        mode() WITHIN GROUP (ORDER BY gp.role) AS role
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE g.serie_id = $1 AND gp.player_id IS NOT NULL
      GROUP BY gp.player_id, gp.team_id
    `, [serieId]);
    const playerList = dbPlayers.map(r => ({
      playerId: r.player_id, teamId: r.team_id, role: r.role
    }));
    log(`    Found ${playerList.length} players in DB for serie ${serieId}`);

    // Step 2: Fetch stats individually for each player
    const playerCareer = [];
    for (const { playerId, teamId, role } of playerList) {
      try {
        const statsArr = await apiGetAll(`/lol/series/${serieId}/players/${playerId}/stats`);
        // API returns an array — take the first element, or use the array itself if it has stats fields
        const raw = Array.isArray(statsArr) && statsArr.length > 0 ? statsArr[0] : statsArr;
        if (raw && (raw.stats || raw.games_count != null || raw.average || raw.averages)) {
          playerCareer.push({ player: { id: playerId, role }, team: { id: teamId }, ...raw });
        }
      } catch (e) {
        // Some players may not have stats (subs who never played) — skip silently
      }
      await sleep(100); // gentle rate limiting
    }
    log(`    API returned stats for ${playerCareer.length} players for serie ${serieId}`);

    // PandaScore /players/{id}/stats REAL structure (verified from API response):
    //   TOP-LEVEL: { id, name, role, slug, stats, teams, last_games, favorite_champions, ... }
    //   stats: { totals: {...}, averages: {...}, games_count: N, serie: {...} }
    //   stats.totals: kills, deaths, assists, wards_placed, games_won, games_lost, games_played,
    //     matches_won, matches_lost, matches_played,
    //     kills_series: { double_kills, triple_kills, quadra_kills, penta_kills },
    //     kill_counters: { inhibitors, turrets, wards }
    //   stats.averages: kills, deaths, assists, gold_earned, gold_spent, gold_percentage,
    //     minions_killed, cs_at_14, cs_diff_at_14, wards_placed, vision_wards_bought_in_game,
    //     total_damage: { dealt, dealt_to_champions, taken, dealt_to_champions_percentage },
    //     magic_damage/physical_damage/true_damage: { dealt, dealt_to_champions, taken, ... },
    //     total_heal, total_time_crowd_control_dealt, kill_counters: { players, neutral_minions, ... }
    //   NO: kda, kill_participation, cspm, dpm, gpm, game_length — must be calculated
    for (const pc of playerCareer) {
      if (!pc.player?.id) continue;
      const s = pc.stats || pc;
      const a = s.averages || s.average || {};
      const t = s.totals || s.total || {};
      const ks = t.kills_series || {};
      const aTd = a.total_damage || {};
      const aMd = a.magic_damage || {};
      const aPd = a.physical_damage || {};
      const aTrd = a.true_damage || {};

      // Derived values
      const games = s.games_count ?? t.games_played ?? null;
      const wins = t.games_won ?? null;
      const losses = t.games_lost ?? null;
      const winRate = (games && wins != null) ? (wins / games) * 100 : null;
      const kda = (t.kills != null && t.deaths)
        ? ((t.kills + (t.assists || 0)) / Math.max(t.deaths, 1)) : null;

      try {
        await pool.query(`
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
            win_rate = EXCLUDED.win_rate, kda = EXCLUDED.kda,
            kills_avg = EXCLUDED.kills_avg, deaths_avg = EXCLUDED.deaths_avg,
            assists_avg = EXCLUDED.assists_avg, gpm = EXCLUDED.gpm, dpm = EXCLUDED.dpm,
            cspm = EXCLUDED.cspm, dmg_share = EXCLUDED.dmg_share, gold_share = EXCLUDED.gold_share
        `, [
          pc.player.id, serieId, pc.team?.id ?? null,
          normRole(pc.role || pc.player?.role) || null,                     // role from top-level
          games, wins, losses, winRate,                                     // games/wins/losses/win_rate
          null,                                                             // avg_duration (not in API)
          null,                                                             // unique_champions (not in API)
          null, null, null, null,                                           // blue/red games/wins (not in player API)
          t.kills ?? null,                                                  // total_kills
          t.deaths ?? null,                                                 // total_deaths
          t.assists ?? null,                                                // total_assists
          a.kills ?? null,                                                  // kills_avg
          a.deaths ?? null,                                                 // deaths_avg
          a.assists ?? null,                                                // assists_avg
          kda,                                                              // kda (calculated)
          null,                                                             // kill_participation (not available)
          null,                                                             // max_kills (not in API)
          null,                                                             // first_blood_rate (not in API)
          null,                                                             // first_tower_rate (not in API)
          ks.double_kills ?? null,                                          // double_kills
          ks.triple_kills ?? null,                                          // triple_kills
          ks.quadra_kills ?? null,                                          // quadra_kills
          ks.penta_kills ?? null,                                           // penta_kills
          aTd.taken ?? null,                                                // avg_dtaken_pm (actually avg per game)
          aMd.dealt_to_champions ?? null,                                   // avg_magic_dpm (avg per game)
          aPd.dealt_to_champions ?? null,                                   // avg_physical_dpm (avg per game)
          aTrd.dealt_to_champions ?? null,                                  // avg_true_dpm (avg per game)
          null,                                                             // avg_cc_per_min (not in API)
          null,                                                             // avg_heal_per_min (not in API)
          null,                                                             // cspm (not in API — only minions_killed avg/game)
          a.gold_earned ?? null,                                            // gpm (actually avg gold per game)
          aTd.dealt_to_champions ?? null,                                   // dpm (actually avg dmg per game)
          aTd.dealt_to_champions_percentage ?? null,                        // dmg_share
          a.gold_percentage ?? null,                                        // gold_share
          a.gold_spent ?? null,                                             // avg_gold_spent
          null, a.cs_diff_at_14 ?? null, null, null,                        // cs_diff_13/14/20/25
          null, null, null,                                                 // level_diff_13/20/25
          null, null, null,                                                 // kills_diff_13/20/25
          null,                                                             // avg_vspm (not in API)
          a.wards_placed ?? null,                                           // avg_wpm (avg wards per game)
          a.kill_counters?.wards ?? null,                                   // avg_wkpm (avg wards killed)
          a.vision_wards_bought_in_game ?? null,                            // avg_cwpm (control wards bought)
        ]);
        updated++;
      } catch (e) {
        logWarn(`  player_career ${pc.player.id}: ${e.message}`);
      }
    }

    logOk(`    player_career: ${updated} inserted for serie ${serieId}`);

    // ─── Player keystones (from raw game data, not API) ─────────────
    for (const pc of playerCareer) {
      if (!pc.player?.id) continue;
      try {
        await pool.query(`
          INSERT INTO player_keystones (player_id, serie_id, rune_id, rune_name, games, wins)
          SELECT gp.player_id, $1, gpr.rune_id, r.name, COUNT(*) AS games,
            SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins
          FROM game_players gp
          JOIN games g ON g.id = gp.game_id
          JOIN game_player_runes gpr ON gpr.game_player_id = gp.id AND gpr.slot = 0
          JOIN runes r ON r.id = gpr.rune_id
          WHERE g.serie_id = $1 AND gp.player_id = $2 AND g.finished = true
          GROUP BY gp.player_id, gpr.rune_id, r.name
          ON CONFLICT (player_id, serie_id, rune_id) DO UPDATE SET
            games = EXCLUDED.games, wins = EXCLUDED.wins, rune_name = EXCLUDED.rune_name
        `, [serieId, pc.player.id]);
      } catch (e) {
        logWarn(`  player_keystones ${pc.player.id}: ${e.message}`);
      }
    }

    // ─── Team career stats ──────────────────────────────────────────
    const teamCareer = await apiGetAll(`/lol/series/${serieId}/teams/stats`);
    log(`    API returned ${teamCareer.length} teams for serie ${serieId}`);
    let teamUpdated = 0;

    // PandaScore /teams/stats REAL structure (verified from API response):
    //   TOP-LEVEL: { id, name, slug, acronym, location, stats, players, last_games, ... }
    //   stats: { totals: {...}, averages: {...}, games_count: N, serie: {...} }
    //   stats.totals: kills, deaths, assists, tower_kills, inhibitor_kills, wards_placed,
    //     baron_kills, dragon_kills, elder_drake_kills, herald_kill, voidgrub_kills, atakhan_kills,
    //     chemtech/cloud/hextech/infernal/mountain/ocean_drake_kills,
    //     games_played, games_won, games_lost, matches_played, matches_won, matches_lost,
    //     blue_games_won, blue_games_lost, red_games_won, red_games_lost
    //   stats.averages: kills, deaths, assists, tower_kills, gold_earned, inhibitor_kills,
    //     total_minions_killed, wards_placed, baron_kills, dragon_kills, herald_kill,
    //     voidgrub_kills, atakhan_kills, game_length,
    //     ratios: { first_blood, first_tower, first_dragon, first_baron, first_herald,
    //              first_inhibitor, first_voidgrub, first_atakhan, win }
    for (const tc of teamCareer) {
      const teamId = tc.id;  // Team IS the top-level object
      if (!teamId) { logWarn(`    team_career: skipped entry without id`); continue; }

      // Ensure team exists in teams table before inserting career stats (avoids FK violation)
      try {
        await pool.query(`
          INSERT INTO teams (id, name, slug, acronym, location, image_url, dark_mode_image_url)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, teams.name),
            slug = COALESCE(EXCLUDED.slug, teams.slug),
            acronym = COALESCE(EXCLUDED.acronym, teams.acronym),
            location = COALESCE(EXCLUDED.location, teams.location),
            image_url = COALESCE(EXCLUDED.image_url, teams.image_url),
            dark_mode_image_url = COALESCE(EXCLUDED.dark_mode_image_url, teams.dark_mode_image_url)
        `, [
          teamId, tc.name ?? null, tc.slug ?? null, tc.acronym ?? null,
          tc.location ?? null, tc.image_url ?? null, tc.dark_mode_image_url ?? null
        ]);
      } catch (eTeam) {
        logWarn(`  team upsert ${teamId}: ${eTeam.message}`);
      }

      const s  = tc.stats || {};
      const t  = s.totals   || {};
      const a  = s.averages || {};
      const ra = a.ratios   || {};

      const games  = s.games_count ?? t.games_played ?? null;
      const wins   = t.games_won ?? null;
      const losses = t.games_lost ?? null;
      const winRate = (games && wins != null) ? (wins / games) * 100 : null;

      try {
        await pool.query(`
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
            first_blood_rate, first_tower_rate, first_dragon_rate, dragon_soul_rate,
            first_elder_rate, first_baron_rate, first_herald_rate, first_voidgrub_rate,
            first_atakhan_rate, first_inhibitor_rate,
            avg_wpm, avg_wkpm, avg_cwpm,
            avg_chemtech_drakes, avg_cloud_drakes, avg_hextech_drakes,
            avg_infernal_drakes, avg_mountain_drakes, avg_ocean_drakes
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
            $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,
            $57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$70,$71,$72,$73,$74,$75,$76,$77,$78,$79,$80,$81,$82
          )
          ON CONFLICT (team_id, serie_id) DO UPDATE SET
            games = EXCLUDED.games, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
            win_rate = EXCLUDED.win_rate, kda = EXCLUDED.kda, gpm = EXCLUDED.gpm,
            kills_avg = EXCLUDED.kills_avg, deaths_avg = EXCLUDED.deaths_avg,
            assists_avg = EXCLUDED.assists_avg, avg_duration = EXCLUDED.avg_duration,
            first_blood_rate = EXCLUDED.first_blood_rate, first_tower_rate = EXCLUDED.first_tower_rate,
            avg_dragons = EXCLUDED.avg_dragons, avg_barons = EXCLUDED.avg_barons
        `, [
          teamId, serieId,
          games, wins, losses, winRate,
          a.game_length ?? null,                                         // avg_duration
          null,                                                          // avg_win_duration (not in API)
          null,                                                          // avg_loss_duration (not in API)
          null,                                                          // unique_champions (not in API)
          t.kills ?? null,                                               // total_kills
          t.deaths ?? null,                                              // total_deaths
          t.assists ?? null,                                             // total_assists
          a.kills ?? null,                                               // kills_avg
          a.deaths ?? null,                                              // deaths_avg
          a.assists ?? null,                                             // assists_avg
          (t.kills != null && t.deaths) ? ((t.kills + (t.assists || 0)) / Math.max(t.deaths, 1)) : null,  // kda
          null,                                                          // avg_cspm (not in API)
          a.gold_earned ?? null,                                         // gpm (gold_earned is avg gold)
          null,                                                          // egpm (not in API)
          null,                                                          // dpm (not in API)
          null,                                                          // delta_gpm (not in API)
          null,                                                          // delta_cspm (not in API)
          t.blue_games_won != null ? (t.blue_games_won + (t.blue_games_lost || 0)) : null,  // blue_games
          t.blue_games_won ?? null,                                      // blue_wins
          t.red_games_won != null ? (t.red_games_won + (t.red_games_lost || 0)) : null,    // red_games
          t.red_games_won ?? null,                                       // red_wins
          null, null, null, null,                                        // dtaken, magic_dpm, physical_dpm, true_dpm
          null, null,                                                    // cc_per_min, heal_per_min
          null, null, null, null,                                        // gold_diff_13/14/20/25
          null, null, null, null,                                        // cs_diff_13/14/20/25
          null, null, null, null,                                        // kills_diff_13/14/20/25
          null, null, null,                                              // tower_diff_13/20/25
          null, null, null,                                              // drake_diff_13/20/25
          null, null,                                                    // neutral_minions_team/enemy
          a.tower_kills ?? null,                                         // avg_towers
          null,                                                          // avg_towers_lost (not in API)
          null,                                                          // avg_plates (not in API)
          a.inhibitor_kills ?? null,                                     // avg_inhibitors
          a.dragon_kills ?? null,                                        // avg_dragons
          t.elder_drake_kills != null && games ? (t.elder_drake_kills / games) : null,  // avg_elder_dragons
          a.baron_kills ?? null,                                         // avg_barons
          a.herald_kill ?? null,                                         // avg_heralds
          a.voidgrub_kills ?? null,                                      // avg_voidgrubs
          a.atakhan_kills ?? null,                                       // avg_atakhans
          ra.first_blood != null ? ra.first_blood * 100 : null,          // first_blood_rate (%)
          ra.first_tower != null ? ra.first_tower * 100 : null,          // first_tower_rate (%)
          ra.first_dragon != null ? ra.first_dragon * 100 : null,        // first_dragon_rate (%)
          null,                                                          // dragon_soul_rate (not in API)
          null,                                                          // first_elder_rate (not in API)
          ra.first_baron != null ? ra.first_baron * 100 : null,          // first_baron_rate (%)
          ra.first_herald != null ? ra.first_herald * 100 : null,        // first_herald_rate (%)
          ra.first_voidgrub != null ? ra.first_voidgrub * 100 : null,    // first_voidgrub_rate (%)
          ra.first_atakhan != null ? ra.first_atakhan * 100 : null,      // first_atakhan_rate (%)
          ra.first_inhibitor != null ? ra.first_inhibitor * 100 : null,  // first_inhibitor_rate (%)
          a.wards_placed ?? null,                                        // avg_wpm
          null,                                                          // avg_wkpm (not in API)
          null,                                                          // avg_cwpm (not in API)
          t.chemtech_drake_kills != null && games ? (t.chemtech_drake_kills / games) : null,
          t.cloud_drake_kills != null && games ? (t.cloud_drake_kills / games) : null,
          t.hextech_drake_kills != null && games ? (t.hextech_drake_kills / games) : null,
          t.infernal_drake_kills != null && games ? (t.infernal_drake_kills / games) : null,
          t.mountain_drake_kills != null && games ? (t.mountain_drake_kills / games) : null,
          t.ocean_drake_kills != null && games ? (t.ocean_drake_kills / games) : null,
        ]);
        teamUpdated++;
      } catch (e) {
        logWarn(`  team_career ${teamId}: ${e.message}`);
      }
    }
    logOk(`    team_career: ${teamUpdated} inserted for serie ${serieId}`);

    // ─── REMOVED: player_stats, team_stats (JSONB dump tables) ─────
    // These were dropped in migrate-remove-jsonb.js. Their data is now
    // covered by player_career, team_career, and player_champion_stats.

    // ─── Player champion stats ──────────────────────────────────────
    for (const pc of playerCareer) {
      if (!pc.player?.id || !pc.favorite_champions) continue;
      for (const fc of pc.favorite_champions) {
        const champId = fc.champion?.id || fc.id;
        if (!champId) continue;
        const champExists = await ensureChampionExists(pool, champId, fc.champion?.name || fc.name);
        if (!champExists) { logWarn(`  player_champion_stats: skipping unknown champion ${champId}`); continue; }
        try {
          await pool.query(`
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
            pc.player.id, serieId, champId, fc.champion?.name || fc.name || null,
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
          updated++;
        } catch (e) {
          logWarn(`  player_champion_stats ${pc.player.id}/${champId}: ${e.message}`);
        }
      }
    }

  } catch (err) {
    logErr(`refreshSerieStats error: ${err.message}`);
  }

  return updated;
}

// REMOVED: refreshTournamentStats() and refreshMatchPlayerStats()
// These populated tournament_player_stats, tournament_team_stats, and match_player_stats
// (JSONB dump tables dropped in migrate-remove-jsonb.js).
// Their data is now covered by player_career, team_career, and game_players.

async function refreshChampionGlobalStats(pool, serieId) {
  let updated = 0;

  try {
    // Query to compute champion_global_stats from game data (same as fetch-to-postgres.js)
    const { rows: champStats } = await pool.query(`
      WITH total_games AS (
        SELECT COUNT(*) AS cnt FROM games WHERE serie_id = $1 AND finished = true
      ),
      pick_data AS (
        SELECT
          gp.champion_id,
          ca.name AS champion_name,
          COUNT(*) AS picks,
          COUNT(DISTINCT gp.player_id) AS players_count,
          SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN gp.team_id != g.winner_id THEN 1 ELSE 0 END) AS losses,
          SUM(CASE WHEN gt.color = 'blue' THEN 1 ELSE 0 END) AS blue_picks,
          SUM(CASE WHEN gt.color = 'blue' AND gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS blue_wins,
          SUM(CASE WHEN gt.color = 'red' THEN 1 ELSE 0 END) AS red_picks,
          SUM(CASE WHEN gt.color = 'red' AND gp.team_id = g.winner_id THEN 1 ELSE 0 END) AS red_wins,
          AVG(gp.kills)::REAL AS kills_avg,
          AVG(gp.deaths)::REAL AS deaths_avg,
          AVG(gp.assists)::REAL AS assists_avg,
          AVG(g.length)::REAL AS avg_game_duration,
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
          (AVG(CASE WHEN gt_stats.kills > 0
            THEN (gp.kills + gp.assists)::REAL / gt_stats.kills
            ELSE 0 END) * 100)::REAL AS kill_participation,
          (AVG(CASE WHEN gp.first_blood_kill THEN 1.0 ELSE 0.0 END) * 100)::REAL AS fb_rate,
          SUM(gp.double_kills) AS double_kills,
          SUM(gp.triple_kills) AS triple_kills,
          SUM(gp.quadra_kills) AS quadra_kills,
          SUM(gp.penta_kills) AS penta_kills,
          MODE() WITHIN GROUP (ORDER BY gp.role) AS main_role
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        JOIN game_teams gt ON gt.game_id = gp.game_id AND gt.team_id = gp.team_id
        LEFT JOIN game_teams gt_stats ON gt_stats.game_id = gp.game_id AND gt_stats.team_id = gp.team_id
        LEFT JOIN champion_aliases ca ON ca.pandascore_id = gp.champion_id
        WHERE g.serie_id = $1 AND g.finished = true
        GROUP BY gp.champion_id, ca.name
      ),
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
    `, [serieId]);

    for (const cs of champStats) {
      try {
        await pool.query(`
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
          cs.champion_id, serieId, cs.champion_name, cs.total_games_in_serie,
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
          cs.main_role,
        ]);
        updated++;

        // ── Insert derivative tables ──────────────────────────────────────

        // champion_role_stats
        if (cs.roles_json) {
          const roles = typeof cs.roles_json === 'string' ? JSON.parse(cs.roles_json) : cs.roles_json;
          for (const [role, data] of Object.entries(roles)) {
            if (role === 'unknown') continue;
            await pool.query(`
              INSERT INTO champion_role_stats (champion_id, serie_id, role, games, wins, losses)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (champion_id, serie_id, role) DO UPDATE SET
                games = EXCLUDED.games, wins = EXCLUDED.wins, losses = EXCLUDED.losses
            `, [cs.champion_id, serieId, role, data.games, data.wins, data.losses]);
          }
        }

        // champion_top_players
        if (cs.top_players_json) {
          const players = typeof cs.top_players_json === 'string' ? JSON.parse(cs.top_players_json) : cs.top_players_json;
          for (const p of players) {
            if (p.player_id && !(await ensurePlayerExists(pool, p.player_id, p.player_name))) continue;
            await pool.query(`
              INSERT INTO champion_top_players (champion_id, serie_id, player_id, player_name, team_name, games, wins, kda)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (champion_id, serie_id, player_id) DO UPDATE SET
                player_name = EXCLUDED.player_name, team_name = EXCLUDED.team_name,
                games = EXCLUDED.games, wins = EXCLUDED.wins, kda = EXCLUDED.kda
            `, [cs.champion_id, serieId, p.player_id, p.player_name, p.team_name, p.games, p.wins, p.kda]);
          }
        }

        // champion_matchups
        if (cs.matchups_json) {
          const matchups = typeof cs.matchups_json === 'string' ? JSON.parse(cs.matchups_json) : cs.matchups_json;
          for (const m of matchups) {
            if (m.opponent_champion_id && !(await ensureChampionExists(pool, m.opponent_champion_id, m.opponent_name))) continue;
            await pool.query(`
              INSERT INTO champion_matchups (champion_id, serie_id, opponent_champion_id, opponent_name, games, wins)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (champion_id, serie_id, opponent_champion_id) DO UPDATE SET
                opponent_name = EXCLUDED.opponent_name, games = EXCLUDED.games, wins = EXCLUDED.wins
            `, [cs.champion_id, serieId, m.opponent_champion_id, m.opponent_name, m.games, m.wins]);
          }
        }

        // champion_items
        if (cs.items_json) {
          const items = typeof cs.items_json === 'string' ? JSON.parse(cs.items_json) : cs.items_json;
          for (const it of items) {
            if (!it.item_id) continue;
            const itemExists = await ensureItemExists(pool, it.item_id);
            if (!itemExists) { logWarn(`  champion_items: skipping unknown item ${it.item_id}`); continue; }
            await pool.query(`
              INSERT INTO champion_items (champion_id, serie_id, item_id, count)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (champion_id, serie_id, item_id) DO UPDATE SET count = EXCLUDED.count
            `, [cs.champion_id, serieId, it.item_id, it.count]);
          }
        }

        // champion_keystones
        if (cs.keystones_json) {
          const keystones = typeof cs.keystones_json === 'string' ? JSON.parse(cs.keystones_json) : cs.keystones_json;
          for (const k of keystones) {
            if (k.rune_id && !(await ensureRuneExists(pool, k.rune_id, k.rune_name))) continue;
            await pool.query(`
              INSERT INTO champion_keystones (champion_id, serie_id, rune_id, rune_name, games, wins)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (champion_id, serie_id, rune_id) DO UPDATE SET
                rune_name = EXCLUDED.rune_name, games = EXCLUDED.games, wins = EXCLUDED.wins
            `, [cs.champion_id, serieId, k.rune_id, k.rune_name, k.games, k.wins]);
          }
        }

        // champion_patch_stats
        if (cs.patch_breakdown_json) {
          const patches = typeof cs.patch_breakdown_json === 'string' ? JSON.parse(cs.patch_breakdown_json) : cs.patch_breakdown_json;
          for (const pb of patches) {
            if (!pb.patch) continue;
            await pool.query(`
              INSERT INTO champion_patch_stats (champion_id, serie_id, patch, games, wins, bans)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (champion_id, serie_id, patch) DO UPDATE SET
                games = EXCLUDED.games, wins = EXCLUDED.wins, bans = EXCLUDED.bans
            `, [cs.champion_id, serieId, pb.patch, pb.games, pb.wins, pb.bans || 0]);
          }
        }

      } catch (e) {
        logWarn(`  champion_global_stats ${cs.champion_id}: ${e.message}`);
      }
    }

  } catch (err) {
    logErr(`refreshChampionGlobalStats error: ${err.message}`);
  }

  return updated;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// POLL CYCLE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Auto-backfill: re-ingest recent matches where games are missing rune data.
// This fixes the race condition where PandaScore hasn't published runes yet
// when the match was first ingested (typically the last game of a BO3/BO5).
async function autoBackfillIncomplete(pool) {
  try {
    const { rows: incomplete } = await pool.query(`
      SELECT DISTINCT m.id AS match_id, m.name
      FROM matches m
      JOIN games g ON g.match_id = m.id
      JOIN game_players gp ON gp.game_id = g.id
      LEFT JOIN game_player_runes gpr ON gpr.game_player_id = gp.id
      WHERE m.games_ingested_at IS NOT NULL
        AND m.games_ingested_at > NOW() - INTERVAL '3 days'
        AND g.finished = true AND g.length > 60
      GROUP BY m.id, m.name, g.id
      HAVING COUNT(DISTINCT gp.id) = 10 AND COUNT(gpr.game_player_id) = 0
    `);

    if (incomplete.length === 0) return;

    log(`  Backfill: ${incomplete.length} recent match(es) with missing rune data`);
    for (const m of incomplete) {
      log(`    Re-ingesting match ${m.match_id} (${m.name})...`);
      const result = await runFetchForMatch(m.match_id);
      if (result.success) {
        await pool.query(`UPDATE matches SET games_ingested_at = NOW() WHERE id = $1`, [m.match_id]);
        logOk(`    match ${m.match_id}: backfilled OK`);
      } else {
        logWarn(`    match ${m.match_id}: backfill failed — will retry next cycle`);
      }
    }
  } catch (err) {
    logWarn(`  Backfill check error: ${err.message}`);
  }
}

// Auto-heal: matches marked as finished with broken stats. Detecta dos
// patrones distintos:
//   1) no_players       → games sin filas en game_players (delay de telemetria
//                         de PandaScore, frecuente en tier-3 ERLs)
//   2) broken_team_stats → games con filas en game_teams pero todas con kills=0
//                         y todas las flags first_* en false. Causado por el
//                         antiguo bug del ON CONFLICT DO NOTHING en
//                         fetch-to-postgres.js (ya arreglado, pero quedan
//                         registros muertos que hay que reingestar).
// Ventana de 30 dias para cubrir games con bug viejo; nada mas antiguo se
// considera data rot permanente y se deja.
async function autoHealBrokenMatches(pool) {
  try {
    const { rows: broken } = await pool.query(`
      SELECT m.id AS match_id, m.name
      FROM matches m
      WHERE m.status = 'finished'
        AND m.games_ingested_at IS NOT NULL
        AND m.games_ingested_at < NOW() - INTERVAL '5 minutes'
        AND m.begin_at > NOW() - INTERVAL '30 days'
        AND m.detailed_stats = true
        AND (
          -- 1) games sin player telemetry
          EXISTS (
            SELECT 1 FROM games g
            WHERE g.match_id = m.id
              AND g.finished = true
              AND g.length > 60
              AND NOT EXISTS (
                SELECT 1 FROM game_players gp WHERE gp.game_id = g.id
              )
          )
          -- 2) games con game_teams roto (kills=0 + ninguna flag first_*)
          OR EXISTS (
            SELECT 1
            FROM games g
            WHERE g.match_id = m.id
              AND g.finished = true
              AND g.length > 300
              AND (
                SELECT COALESCE(SUM(gt.kills), 0) +
                       COUNT(*) FILTER (
                         WHERE gt.first_blood OR gt.first_dragon OR gt.first_herald
                            OR gt.first_tower  OR gt.first_baron
                       )
                FROM game_teams gt
                WHERE gt.game_id = g.id
              ) = 0
              AND EXISTS (
                SELECT 1 FROM game_teams gt2 WHERE gt2.game_id = g.id
              )
          )
        )
      ORDER BY m.begin_at DESC
      LIMIT 30
    `);

    if (broken.length === 0) return;

    log(`  Auto-heal: ${broken.length} recent match(es) with broken stats (missing players or empty game_teams)`);
    for (const m of broken) {
      log(`    Re-ingesting match ${m.match_id} (${m.name})...`);

      // Count player rows before retry
      const before = await pool.query(
        `SELECT COUNT(*)::int AS n FROM games g
         JOIN game_players gp ON gp.game_id = g.id
         WHERE g.match_id = $1`,
        [m.match_id]
      );
      const nBefore = before.rows[0].n;

      const result = await runFetchForMatch(m.match_id);

      if (result.success) {
        await pool.query(`UPDATE matches SET games_ingested_at = NOW() WHERE id = $1`, [m.match_id]);

        // Count player rows after retry
        const after = await pool.query(
          `SELECT COUNT(*)::int AS n FROM games g
           JOIN game_players gp ON gp.game_id = g.id
           WHERE g.match_id = $1`,
          [m.match_id]
        );
        const nAfter = after.rows[0].n;
        const delta = nAfter - nBefore;

        if (delta > 0) {
          logOk(`    match ${m.match_id}: auto-healed +${delta} players (total ${nAfter})`);
        } else {
          log(`    match ${m.match_id}: re-ingested but PandaScore still has no player data (will retry)`);
        }
      } else {
        logWarn(`    match ${m.match_id}: auto-heal failed — will retry next cycle`);
      }
    }
  } catch (err) {
    logWarn(`  Auto-heal check error: ${err.message}`);
  }
}

async function pollCycle(pool) {
  const cycleStart = Date.now();
  requestCount = 0;

  log(`${BOLD}─── Poll cycle ───${RST}`);

  try {
    // Step 0: Refresh static data if needed (24h cycle)
    await refreshStaticIfNeeded();

    // Step 1: Upcoming → register as not_started
    await pollUpcoming(pool);

    // Step 2: Running → update status
    await pollRunning(pool);

    // Step 3: Finished → detect & trigger ingestion
    await pollFinished(pool);

    // Also pick up any matches that were finished but not ingested from previous cycles
    const ingestedIds = await ingestPendingMatches(pool);
    if (ingestedIds && ingestedIds.length > 0) {
      // Stats will be refreshed by pollFinished() if it found newly finished matches
      // This picks up any leftovers from previous cycles
      await refreshAllStats(pool, ingestedIds);
    }

    // Step 5: Auto-backfill recent games with missing runes (PandaScore delay fix)
    await autoBackfillIncomplete(pool);

    // Step 6: Auto-heal recent matches with 0 game_players (PandaScore telemetry delay)
    await autoHealBrokenMatches(pool);

    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    log(`${BOLD}─── Cycle done: ${requestCount} API calls, ${elapsed}s ───${RST}\n`);
  } catch (err) {
    logErr(`Poll cycle error: ${err.message}`);
    if (err.stack) logErr(err.stack.split('\n').slice(0, 3).join('\n'));
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function main() {
  const pool = createPool();

  log('');
  log(`${BOLD}â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${RST}`);
  log(`${BOLD}  LEAGUESCOPE MATCH POLLER — Status-based ingestion${RST}`);
  log(`${BOLD}â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•${RST}`);
  log(`  Mode:     ${ONCE ? 'Single cycle' : 'Continuous'}`);
  log(`  Interval: ${POLL_INTERVAL / 1000}s`);
  log(`  Leagues:  ${LEAGUE_FILTER ? LEAGUE_FILTER.join(', ') : 'ALL'}`);
  log(`  Database: ${PG_DSN.replace(/:[^:@]+@/, ':***@')}`);
  log('');

  try {
    await ensureMigration(pool);

    // ─── --fix-scores mode: backfill missing match scores from game results ──
    if (FIX_SCORES) {
      log(`${BOLD}â•â•â• FIX SCORES MODE â•â•â•${RST}`);
      log('Finding matches with missing scores...');

      const { rows: brokenMatches } = await pool.query(`
        SELECT DISTINCT mo.match_id
        FROM match_opponents mo
        JOIN matches m ON m.id = mo.match_id
        WHERE m.status = 'finished'
          AND m.games_ingested_at IS NOT NULL
          AND (mo.result_score IS NULL OR mo.result_score = 0)
      `);

      if (brokenMatches.length === 0) {
        log('No matches with missing scores found.');
      } else {
        log(`Found ${brokenMatches.length} matches to fix...`);
        let fixed = 0;
        for (const row of brokenMatches) {
          await backfillMatchScores(pool, row.match_id);
          fixed++;
        }
        logOk(`Fixed scores for ${fixed} matches`);
      }

      await pool.end();
      process.exit(0);
    }

    // ─── --refresh-stats mode: recalculate ALL derived tables for existing data ──
    if (REFRESH_STATS) {
      log(`${BOLD}â•â•â• STATS REFRESH MODE (only missing) â•â•â•${RST}`);
      log('Finding series/tournaments/matches WITHOUT stats...');

      // Series that have ingested matches but NO player_career OR NO team_career data yet
      const { rows: missingSeries } = await pool.query(`
        SELECT DISTINCT m.serie_id
        FROM matches m
        JOIN series s ON s.id = m.serie_id
        WHERE m.games_ingested_at IS NOT NULL
          AND m.serie_id IS NOT NULL
          AND (
            m.serie_id NOT IN (SELECT DISTINCT serie_id FROM player_career WHERE serie_id IS NOT NULL)
            OR m.serie_id NOT IN (SELECT DISTINCT serie_id FROM team_career WHERE serie_id IS NOT NULL)
          )
      `);
      const serieIds = missingSeries.map(r => r.serie_id);

      // Series that have ingested matches but NO champion_global_stats yet
      const { rows: missingChampStats } = await pool.query(`
        SELECT DISTINCT m.serie_id
        FROM matches m
        JOIN series s ON s.id = m.serie_id
        WHERE m.games_ingested_at IS NOT NULL
          AND m.serie_id IS NOT NULL
          AND m.serie_id NOT IN (SELECT DISTINCT serie_id FROM champion_global_stats WHERE serie_id IS NOT NULL)
      `);
      const champSerieIds = missingChampStats.map(r => r.serie_id);

      log(`Missing stats: ${serieIds.length} series for player/team career, ${champSerieIds.length} series for champion_global`);

      if (serieIds.length === 0 && champSerieIds.length === 0) {
        logOk('All stats tables are up to date — nothing to refresh');
        await pool.end();
        return;
      }

      let totalUpdated = 0;

      // Serie-level stats (player_career, team_career, player_champion_stats)
      for (let i = 0; i < serieIds.length; i++) {
        log(`\n[${i + 1}/${serieIds.length}] Serie ${serieIds[i]}...`);
        totalUpdated += await refreshSerieStats(pool, serieIds[i]);
      }

      // Champion global stats per serie (only missing)
      for (let i = 0; i < champSerieIds.length; i++) {
        log(`\n[${i + 1}/${champSerieIds.length}] Champion global stats for serie ${champSerieIds[i]}...`);
        totalUpdated += await refreshChampionGlobalStats(pool, champSerieIds[i]);
      }

      // Player keystones (populate for all series that have player_career but no keystones)
      const { rows: missingPK } = await pool.query(`
        SELECT DISTINCT pc.serie_id FROM player_career pc
        WHERE pc.serie_id NOT IN (SELECT DISTINCT serie_id FROM player_keystones WHERE serie_id IS NOT NULL)
      `);
      if (missingPK.length > 0) {
        log(`\nPopulating player_keystones for ${missingPK.length} series...`);
        for (let i = 0; i < missingPK.length; i++) {
          const sid = missingPK[i].serie_id;
          if (i % 50 === 0) log(`  [${i + 1}/${missingPK.length}] serie ${sid}...`);
          await pool.query(`
            INSERT INTO player_keystones (player_id, serie_id, rune_id, rune_name, games, wins)
            SELECT gp.player_id, $1, gpr.rune_id, r.name, COUNT(*), SUM(CASE WHEN gp.team_id = g.winner_id THEN 1 ELSE 0 END)
            FROM game_players gp
            JOIN games g ON g.id = gp.game_id
            JOIN game_player_runes gpr ON gpr.game_player_id = gp.id AND gpr.slot = 0
            JOIN runes r ON r.id = gpr.rune_id
            WHERE g.serie_id = $1 AND g.finished = true
            GROUP BY gp.player_id, gpr.rune_id, r.name
            ON CONFLICT (player_id, serie_id, rune_id) DO UPDATE SET
              games = EXCLUDED.games, wins = EXCLUDED.wins, rune_name = EXCLUDED.rune_name
          `, [sid]);
        }
        logOk(`  player_keystones populated for ${missingPK.length} series`);
      }

      logOk(`\n${BOLD}STATS REFRESH COMPLETE: ${totalUpdated} records updated${RST}`);
      await pool.end();
      return;
    }

    // ─── --backfill-incomplete mode: re-ingest matches with games missing runes/data ──
    // Fixes: when a match was ingested before PandaScore had rune data for the last game(s)
    const BACKFILL_INCOMPLETE = args.includes('--backfill-incomplete');
    if (BACKFILL_INCOMPLETE) {
      const daysBack = Number(getArg('days') || 30);
      log(`${BOLD}â•â•â• BACKFILL INCOMPLETE GAMES â•â•â•${RST}`);
      log(`Looking for finished games with 0 runes in the last ${daysBack} days...`);

      // Find matches that have at least one finished game with 10 players but 0 runes
      const { rows: incompleteMatches } = await pool.query(`
        SELECT DISTINCT m.id AS match_id, m.name,
               COUNT(DISTINCT g.id) FILTER (
                 WHERE g.finished = true AND g.length > 60
                   AND (SELECT COUNT(*) FROM game_players WHERE game_id = g.id) = 10
                   AND (SELECT COUNT(*) FROM game_player_runes WHERE game_player_id IN
                        (SELECT id FROM game_players WHERE game_id = g.id)) = 0
               ) AS games_missing_runes,
               COUNT(DISTINCT g.id) FILTER (
                 WHERE g.finished = true AND g.length > 60
               ) AS total_games
        FROM matches m
        JOIN games g ON g.match_id = m.id
        WHERE m.games_ingested_at IS NOT NULL
          AND m.games_ingested_at > NOW() - INTERVAL '1 day' * $1
          AND g.finished = true AND g.length > 60
        GROUP BY m.id, m.name
        HAVING COUNT(DISTINCT g.id) FILTER (
          WHERE g.finished = true AND g.length > 60
            AND (SELECT COUNT(*) FROM game_players WHERE game_id = g.id) = 10
            AND (SELECT COUNT(*) FROM game_player_runes WHERE game_player_id IN
                 (SELECT id FROM game_players WHERE game_id = g.id)) = 0
        ) > 0
        ORDER BY m.id DESC
      `, [daysBack]);

      if (incompleteMatches.length === 0) {
        logOk('No incomplete matches found — all games have rune data!');
        await pool.end();
        return;
      }

      log(`Found ${incompleteMatches.length} matches with incomplete game data:`);
      for (const m of incompleteMatches) {
        log(`  match ${m.match_id}: ${m.name} — ${m.games_missing_runes}/${m.total_games} games missing runes`);
      }

      let fixed = 0;
      for (const m of incompleteMatches) {
        log(`\nRe-ingesting match ${m.match_id} (${m.name})...`);
        const result = await runFetchForMatch(m.match_id);
        if (result.success) {
          await pool.query(`UPDATE matches SET games_ingested_at = NOW() WHERE id = $1`, [m.match_id]);
          logOk(`  match ${m.match_id}: OK (${result.apiCalls} API calls)`);
          fixed++;
        } else {
          logErr(`  match ${m.match_id}: FAILED — ${result.stderr?.slice(0, 200)}`);
        }
      }

      logOk(`\n${BOLD}BACKFILL COMPLETE: ${fixed}/${incompleteMatches.length} matches re-ingested${RST}`);
      await pool.end();
      return;
    }

    // ─── --refresh-derivatives mode: re-run champion_global_stats + ALL derivatives ──
    // Use when champion_global_stats exists but derivative tables are empty
    const REFRESH_DERIVATIVES = args.includes('--refresh-derivatives');
    if (REFRESH_DERIVATIVES) {
      log(`${BOLD}â•â•â• DERIVATIVES REFRESH MODE â•â•â•${RST}`);
      log('Re-processing champion_global_stats + all derivative tables for ALL series...');

      const { rows: allChampSeries } = await pool.query(`
        SELECT DISTINCT serie_id FROM champion_global_stats WHERE serie_id IS NOT NULL ORDER BY serie_id
      `);
      log(`Found ${allChampSeries.length} series with champion_global_stats data`);

      let totalUpdated = 0;
      for (let i = 0; i < allChampSeries.length; i++) {
        const sid = allChampSeries[i].serie_id;
        if (i % 25 === 0 || i === allChampSeries.length - 1) {
          log(`\n[${i + 1}/${allChampSeries.length}] Serie ${sid}...`);
        }
        totalUpdated += await refreshChampionGlobalStats(pool, sid);
      }

      logOk(`\n${BOLD}DERIVATIVES REFRESH COMPLETE: ${totalUpdated} records updated${RST}`);
      await pool.end();
      return;
    }

    if (ONCE) {
      await pollCycle(pool);
    } else {
      // Continuous mode
      log('Starting continuous polling...');
      log(`Press Ctrl+C to stop.\n`);

      // Run first cycle immediately
      await pollCycle(pool);

      // Then poll on interval
      const intervalId = setInterval(async () => {
        try {
          await pollCycle(pool);
        } catch (err) {
          logErr(`Interval error: ${err.message}`);
        }
      }, POLL_INTERVAL);

      // Graceful shutdown
      const shutdown = async () => {
        log('\nShutting down...');
        clearInterval(intervalId);
        await pool.end();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    }
  } catch (err) {
    logErr(`Fatal: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  if (ONCE) {
    await pool.end();
  }
}

// ─── Lambda handler ───────────────────────────────────────────────────────
export async function handler(event, context) {
  const pool = createPool();
  try {
    await ensureMigration(pool);
    await pollCycle(pool);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    logErr(`Lambda error: ${err.message}`);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await pool.end();
  }
}

// ─── CLI entry ────────────────────────────────────────────────────────────
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
