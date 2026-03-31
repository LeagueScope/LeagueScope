/**
 * pgHelpers.js
 * Shared utilities for all PG controller modules:
 *   - League ID resolver (FRONTEND_TO_PG_ID + DB fallback)
 *   - Lookup caches (champions, runes, items, spells, rune paths)
 *   - Formatters and helpers (pct, rnd, mapRole, ensureArr, etc.)
 *   - Match label derivation
 */

import * as pgDb from '../../services/pgDb.js';
import { log } from '../../utils/logger.js';

// Re-export pgDb and ApiError for convenience
export { pgDb };
export { ApiError } from '../../middleware/errorHandler.js';
export { log };

// ── League ID resolver ───────────────────────────────────────────────────────

const FRONTEND_TO_PG_ID = {
  // Tier 1
  lck: 293, lpl: 294, lec: 4197, lcs: 4198, cblol: 302,
  lcp: 5351, vcs: 4141, ljl: 2092, tcl: 1003,
  // Tier 2
  lckcl: 4553, nacl: 4961, emeamasters: 4996, circuitodesaf: 5377,
  lrn: 5048, lrs: 5049,
  // Tier 3
  lfl: 4292, prm: 4302, les: 5496, nlc: 4411, lit: 5211,
  ebl: 4426, roadoflegends: 5366,
  // International
  msi: 300, worlds: 297, firststand: 5369, riftlegends: 5358, americascup: 5504,
  // Extinct Tier 1-2
  eulcs: 290, nalcs: 289, lms: 295, pcs: 4288, lla: 4199,
  lcl: 4004, lco: 4539, ltanorth: 5345, ltasouth: 5346, ldl: 4226,
  // Extinct Tier 3
  lvpsl: 4213, lvpsl2: 4969, ul: 4300, gll: 4723, tcldiv2: 5051,
  polskaliga: 4263, belgianleague: 4401, dutchleague: 4402,
  eslmeister: 4264, challengefr: 666, hm: 4433,
  // Extinct International
  allstar: 296, ewc: 5262, iem: 878, intwildcard: 299,
  seasonkickoff: 4953, eumasters: 4139,
  // Extinct Rift Rivals
  rrnaeu: 2107, rrlcklpllms: 4097, rrlcklplvcs: 4230,
  rrlcltcl: 2132, rrlcltclvcs: 4143, rrcbclslln: 2133, rrgplljlopl: 2108,
  // Extinct Showmatches
  comedycentral: 5489, kcvsibai: 4706, kcx3: 5210,
  gameonrevival: 5461, pulsefirecup: 4392, redbullloio: 5184,
  // Extinct LATAM
  copanorte: 305, copasur: 298, cdln: 1077, cdls: 527,
  liganorte: 1002, lmf: 4787,
};

let _leagueMap = null;

async function _loadLeagueMap() {
  if (_leagueMap) return _leagueMap;
  const { rows } = await pgDb.query(`SELECT id, name, slug FROM leagues`);
  const map = new Map();
  for (const [frontendId, pgId] of Object.entries(FRONTEND_TO_PG_ID)) {
    map.set(frontendId.toUpperCase(), pgId);
  }
  for (const r of rows) {
    if (r.name && !map.has(r.name.toUpperCase())) map.set(r.name.toUpperCase(), r.id);
    if (r.slug) {
      const slugUp = r.slug.toUpperCase();
      if (!map.has(slugUp)) map.set(slugUp, r.id);
      const slugNorm = slugUp.replace(/[-_\s]/g, '');
      if (!map.has(slugNorm)) map.set(slugNorm, r.id);
    }
    if (r.name) {
      const nameNorm = r.name.toUpperCase().replace(/[\s-_]/g, '');
      if (!map.has(nameNorm)) map.set(nameNorm, r.id);
    }
  }
  _leagueMap = map;
  log.info(`[pg] League map loaded: ${rows.length} leagues, ${map.size} keys (${Object.keys(FRONTEND_TO_PG_ID).length} explicit)`);
  return map;
}

export async function resolveLeagueId(input) {
  if (!input) return null;
  const map = await _loadLeagueMap();
  const key = input.toUpperCase().trim();
  if (map.has(key)) return map.get(key);
  const normalized = key.replace(/[-_\s]/g, '');
  if (map.has(normalized)) return map.get(normalized);
  log.warn(`[pg] resolveLeagueId: no match for "${input}"`);
  return null;
}

// ── Stage filter helper ──────────────────────────────────────────────────────
// Returns { sf, stageParams } for parameterized stage filtering.
//   sf:          SQL fragment like 'AND g.tournament_id = $2' or ''
//   stageParams: [stageParam] or []
// Usage:
//   const { sf, stageParams } = stageFilter(stageParam, 2);
//   pgDb.query(`WHERE g.serie_id = $1 ${sf}`, [serieId, ...stageParams]);
export function stageFilter(stageParam, nextIdx = 2, alias = 'g') {
  if (!stageParam) return { sf: '', stageParams: [] };
  return {
    sf: `AND ${alias}.tournament_id = $${nextIdx}`,
    stageParams: [parseInt(stageParam)],
  };
}

// ── Serie + Stage resolver ────────────────────────────────────────────────────
// Resolves league/year/split/stage into { serieId, stageParam }
// stageParam is the tournament_id (integer) or null if stage is "all"

export async function resolveSerie({ league = 'LEC', year, split, stage }) {
  const leagueId = await resolveLeagueId(league);
  if (!leagueId) return { serieId: null, stageParam: null };

  const { rows: serieRows } = await pgDb.query(`
    SELECT s.id FROM series s
    WHERE s.league_id = $1
      AND ($2::int IS NULL OR s.year = $2)
      AND ($3::text IS NULL OR s.season = $3 OR s.full_name ILIKE '%' || $3 || '%')
    ORDER BY s.begin_at DESC LIMIT 1
  `, [leagueId, year ? Number(year) : null, split || null]);

  if (!serieRows.length) return { serieId: null, stageParam: null };
  const serieId = serieRows[0].id;

  // If stage is provided (not "all"), resolve tournament_id
  // Uses partial match (same logic as legacy resolveTournamentId):
  //   name.includes(needle) || needle.includes(name)
  let stageParam = null;
  if (stage && stage.toLowerCase() !== 'all') {
    const { rows: tournRows } = await pgDb.query(
      `SELECT id, name FROM tournaments WHERE serie_id = $1`, [serieId]
    );
    const needle = stage.toLowerCase().trim();
    const match = tournRows.find(t => {
      const n = (t.name || '').toLowerCase();
      return n.includes(needle) || needle.includes(n);
    });
    if (match) {
      stageParam = match.id;
      log.info(`[pg] resolveSerie: stage "${stage}" → tournament ${match.id} (${match.name})`);
    } else {
      log.warn(`[pg] resolveSerie: stage "${stage}" not found in serie ${serieId}. Tournaments: ${tournRows.map(t => t.name).join(', ')}`);
    }
  }

  return { serieId, stageParam };
}

// ── Team brand resolution helpers ────────────────────────────────────────────
// Team brands override PandaScore's retroactively-contaminated names/logos.
// Two JOIN patterns depending on context:
//
// Pattern A — single-serie queries (serie_id available as parameter):
//   LEFT JOIN team_brands tb ON tb.team_id = X
//     AND (SELECT year FROM series WHERE id = $1) BETWEEN tb.year_start AND tb.year_end
//
// Pattern B — multi-serie queries (already JOINed to series table):
//   JOIN series _s ON _s.id = g.serie_id
//   LEFT JOIN team_brands tb ON tb.team_id = X AND _s.year BETWEEN tb.year_start AND tb.year_end

// COALESCE columns (use in SELECT):
export const TB_NAME  = (tbAlias = 'tb', tAlias = 't') => `COALESCE(${tbAlias}.display_name, ${tAlias}.name)`;
export const TB_ABBR  = (tbAlias = 'tb', tAlias = 't') => `COALESCE(${tbAlias}.display_acronym, ${tAlias}.acronym)`;
export const TB_LOGO  = (tbAlias = 'tb', tAlias = 't') => `COALESCE(${tbAlias}.display_logo, ${tAlias}.dark_mode_image_url, ${tAlias}.image_url)`;

// JOIN clause for single-serie (Pattern A):
export const TB_JOIN_SERIE = (tbAlias = 'tb', teamIdExpr = 't.id', serieParam = '$1') =>
  `LEFT JOIN team_brands ${tbAlias} ON ${tbAlias}.team_id = ${teamIdExpr} AND (SELECT year FROM series WHERE id = ${serieParam}) BETWEEN ${tbAlias}.year_start AND ${tbAlias}.year_end`;

// JOIN clause for multi-serie (Pattern B) — requires series alias already in query:
export const TB_JOIN_YEAR = (tbAlias = 'tb', teamIdExpr = 't.id', yearExpr = '_s.year') =>
  `LEFT JOIN team_brands ${tbAlias} ON ${tbAlias}.team_id = ${teamIdExpr} AND ${yearExpr} BETWEEN ${tbAlias}.year_start AND ${tbAlias}.year_end`;

// ── Lookup caches ────────────────────────────────────────────────────────────

let _champCache = null;
let _runeCache = null;
let _itemCache = null;
let _spellCache = null;
let _runePathCache = null;

export async function getChampMap() {
  if (_champCache) return _champCache;
  const { rows } = await pgDb.query(`
    SELECT ca.pandascore_id, c.name, c.image_url
    FROM champion_aliases ca
    JOIN champions c ON c.id = ca.canonical_id
  `);
  _champCache = {};
  for (const r of rows) {
    _champCache[r.pandascore_id] = {
      name: r.name,
      image_url: r.image_url || null,     // PandaScore CDN — single source of truth
    };
  }
  return _champCache;
}

export async function getRuneMap() {
  if (_runeCache) return _runeCache;
  const { rows } = await pgDb.query(`SELECT id, name, image_url FROM runes`);
  _runeCache = {};
  for (const r of rows) _runeCache[r.id] = { id: r.id, name: r.name, image_url: r.image_url };
  return _runeCache;
}

export async function getItemMap() {
  if (_itemCache) return _itemCache;
  const { rows } = await pgDb.query(`SELECT id, name, image_url FROM items`);
  _itemCache = {};
  for (const r of rows) _itemCache[r.id] = { id: r.id, name: r.name, image_url: r.image_url };
  return _itemCache;
}

export async function getSpellMap() {
  if (_spellCache) return _spellCache;
  const { rows } = await pgDb.query(`SELECT id, name, image_url FROM spells`);
  _spellCache = {};
  for (const r of rows) _spellCache[r.id] = { id: r.id, name: r.name, image_url: r.image_url };
  return _spellCache;
}

export async function getRunePathMap() {
  if (_runePathCache) return _runePathCache;
  const { rows } = await pgDb.query(`SELECT id, name, image_url FROM rune_paths`);
  _runePathCache = {};
  for (const r of rows) _runePathCache[r.id] = { id: r.id, name: r.name, image_url: r.image_url };
  return _runePathCache;
}

// ── Formatters & helpers ─────────────────────────────────────────────────────

export const pct = (n, d) => d > 0 ? parseFloat((n / d * 100).toFixed(1)) : 0;
export const rnd = (v, d = 2) => v != null ? parseFloat(Number(v).toFixed(d)) : null;

const PG_ROLE_MAP = { jun: 'jng', adc: 'bot' };
export const mapRole = (r) => PG_ROLE_MAP[r] || r;
export const mapRolesObj = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[mapRole(k)] = v;
  return out;
};

export const ensureArr = (v) => { if (Array.isArray(v)) return v; if (typeof v === 'string') try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } return []; };
export const ensureObj = (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) return v; if (typeof v === 'string') try { const p = JSON.parse(v); return (p && typeof p === 'object') ? p : {}; } catch { return {}; } return {}; };

export const fmtMins = (mins) => {
  if (!mins || isNaN(mins)) return '0:00';
  const totalSecs = Math.round(mins * 60);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ── Match label from slug ────────────────────────────────────────────────────

const ROUND_PATTERNS = [
  [/grand.?final/i, 'Grand Final'],
  [/winner.?final/i, 'Winners Final'],
  [/loser.?final/i, 'Losers Final'],
  [/upper.?bracket.*final/i, 'Upper Bracket Final'],
  [/lower.?bracket.*final/i, 'Lower Bracket Final'],
  [/semi.?final/i, 'Semifinal'],
  [/quarter.?final/i, 'Quarterfinal'],
  [/upper.?bracket.*round.?(\d+)/i, (m) => `Upper R${m[1]}`],
  [/lower.?bracket.*round.?(\d+)/i, (m) => `Lower R${m[1]}`],
  [/round.?(\d+)/i, (m) => `Round ${m[1]}`],
  [/3rd.?place|third.?place/i, '3rd Place'],
  [/5th.?place|fifth.?place/i, '5th Place'],
];

export function deriveMatchLabel(slug, name) {
  for (const [pattern, label] of ROUND_PATTERNS) {
    const m = (slug || '').match(pattern) || (name || '').match(pattern);
    if (m) return typeof label === 'function' ? label(m) : label;
  }
  return null;
}
