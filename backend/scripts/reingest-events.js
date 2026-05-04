#!/usr/bin/env node
/**
 * reingest-events.js
 *
 * One-shot backfill: re-fetch and replace `game_events` for games whose
 * event count is below the aggregate (partial ingest from the pre-fix bug
 * where `apiGet` was used instead of `apiGetAll`, capping events at 50).
 *
 * Usage:
 *   PG_DSN=... PANDASCORE_TOKEN=... node scripts/reingest-events.js
 *   PG_DSN=... PANDASCORE_TOKEN=... node scripts/reingest-events.js --limit 100
 *   PG_DSN=... PANDASCORE_TOKEN=... node scripts/reingest-events.js --severe-only
 *   PG_DSN=... PANDASCORE_TOKEN=... node scripts/reingest-events.js --dry-run
 *
 * Flags:
 *   --limit N       Re-process only the first N games (default: all)
 *   --severe-only   Only games with kill gap >= 5 (default: all gap > 0)
 *   --dry-run       Don't write to DB or call PandaScore, just print plan
 */

import pg from 'pg';

// ─── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);
const LIMIT = getArg('limit') ? Number(getArg('limit')) : null;
const SEVERE_ONLY = hasFlag('severe-only');
const DRY_RUN = hasFlag('dry-run');

// ─── Env ───────────────────────────────────────────────────────────────────
const PG_DSN = process.env.PG_DSN;
const TOKEN = process.env.PANDASCORE_TOKEN;
if (!PG_DSN) { console.error('Missing PG_DSN'); process.exit(1); }
if (!TOKEN && !DRY_RUN) { console.error('Missing PANDASCORE_TOKEN'); process.exit(1); }

const BASE_URL = 'https://api.pandascore.co';

// ─── Constants ─────────────────────────────────────────────────────────────
const VALID_EVENT_TYPES = new Set([
  'player_kill', 'tower_kill', 'inhibitor_kill', 'drake_kill',
  'baron_nashor_kill', 'herald_kill', 'rift_herald_kill',
  'voidgrub_kill', 'atakhan_kill',
]);
const EVENT_TYPE_MAP = { rift_herald_kill: 'herald_kill' };
const normEventType = (t) => EVENT_TYPE_MAP[t] || t;

function extractEvent(ev) {
  const p = ev.payload || {};
  const killer = p.killer?.object || ev.killer || {};
  const victim = p.victim?.object || ev.victim || {};
  const assists = p.assists
    ? p.assists.filter(a => a != null).map(a => ({
        player_id: a.object?.player_id ?? a.player_id,
        champion_id: a.object?.champion?.id ?? a.champion_id,
      }))
    : ev.assistants || null;
  return {
    timestamp: ev.ingame_timestamp ?? ev.timestamp ?? null,
    type: normEventType(ev.type),
    killer_player_id: killer.player_id ?? null,
    killer_champion_id: killer.champion?.id ?? killer.champion_id ?? null,
    victim_player_id: victim.player_id ?? null,
    victim_champion_id: victim.champion?.id ?? victim.champion_id ?? null,
    assistants: assists,
    is_first: ev.is_first ?? false,
  };
}

// ─── HTTP client ───────────────────────────────────────────────────────────
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
      if (attempt <= 5) { console.log(`  429 — esperando ${ra}s`); await sleep(ra * 1000); return apiFetch(url, attempt + 1); }
      throw new Error(`429 after ${attempt} retries`);
    }
    if (res.status >= 500 && attempt <= 3) { await sleep(2000 * attempt); return apiFetch(url, attempt + 1); }
    if (res.status === 403 || res.status === 404) return { data: null, total: 0 };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json(), total: parseInt(res.headers.get('X-Total') || '0') };
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError' && attempt <= 3) { await sleep(2000 * attempt); return apiFetch(url, attempt + 1); }
    throw err;
  }
}

function buildUrl(path, params = {}) {
  const u = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) u.searchParams.set(k, String(v));
  }
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

// ─── PG ────────────────────────────────────────────────────────────────────
const poolCfg = { connectionString: PG_DSN, max: 4 };
if (PG_DSN.includes('rds.amazonaws.com')) {
  poolCfg.ssl = { rejectUnauthorized: false };
}
const pool = new pg.Pool(poolCfg);

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(70));
  console.log('REINGEST EVENTS — backfill de games con ingesta parcial');
  console.log('═'.repeat(70));
  console.log(`DRY RUN:     ${DRY_RUN ? 'YES (no writes, no API calls)' : 'no'}`);
  console.log(`SEVERE ONLY: ${SEVERE_ONLY ? 'YES (gap >= 5 kills)' : 'no (any gap > 0)'}`);
  console.log(`LIMIT:       ${LIMIT ?? 'all'}`);
  console.log('');

  // 1) Identificar games con gap (excluye legacy con 0 events)
  const minGap = SEVERE_ONLY ? 5 : 1;
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

  const sql = `
    WITH agg AS (
      SELECT game_id, SUM(kills) AS agg_kills
      FROM game_teams GROUP BY game_id
    ),
    ev AS (
      SELECT game_id, COUNT(*) FILTER (WHERE type='player_kill') AS ev_kills
      FROM game_events GROUP BY game_id
    )
    SELECT a.game_id, a.agg_kills, COALESCE(e.ev_kills, 0) AS ev_kills,
           a.agg_kills - COALESCE(e.ev_kills, 0) AS gap
    FROM agg a
    LEFT JOIN ev e ON e.game_id = a.game_id
    WHERE COALESCE(e.ev_kills, 0) > 0
      AND a.agg_kills - COALESCE(e.ev_kills, 0) >= $1
    ORDER BY gap DESC
    ${limitClause}
  `;
  const { rows } = await pool.query(sql, [minGap]);
  console.log(`Games a procesar: ${rows.length}`);
  if (rows.length === 0) { await pool.end(); return; }

  if (DRY_RUN) {
    console.log('\nMuestra (top 10 por gap):');
    for (const r of rows.slice(0, 10)) {
      console.log(`  game_id=${r.game_id}  agg=${r.agg_kills}  ev=${r.ev_kills}  gap=${r.gap}`);
    }
    await pool.end();
    return;
  }

  // 2) Re-ingestar cada game
  let ok = 0, fail = 0, skipped = 0;
  const startTs = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const { game_id } = rows[i];
    try {
      const events = await apiGetAll(`/lol/games/${game_id}/events`);
      if (!events || events.length === 0) {
        console.log(`  [${i + 1}/${rows.length}] game ${game_id}: 0 events del API, skip`);
        skipped++;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM game_events WHERE game_id = $1`, [game_id]);

        let inserted = 0;
        for (const ev of events) {
          if (!VALID_EVENT_TYPES.has(ev.type)) continue;
          const e = extractEvent(ev);
          const { rows: evRows } = await client.query(`
            INSERT INTO game_events (game_id, timestamp, type,
              killer_player_id, killer_champion_id, victim_player_id, victim_champion_id,
              is_first)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT DO NOTHING
            RETURNING id
          `, [game_id, e.timestamp, e.type,
              e.killer_player_id, e.killer_champion_id,
              e.victim_player_id, e.victim_champion_id,
              e.is_first]);

          if (evRows[0]?.id && Array.isArray(e.assistants)) {
            for (const a of e.assistants) {
              if (a.player_id) {
                await client.query(
                  `INSERT INTO game_event_assists (event_id, player_id, champion_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
                  [evRows[0].id, a.player_id, a.champion_id ?? null],
                );
              }
            }
          }
          inserted++;
        }
        await client.query('COMMIT');
        ok++;

        if ((i + 1) % 50 === 0 || i === rows.length - 1) {
          const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
          const rate = ((i + 1) / (Date.now() - startTs) * 1000).toFixed(2);
          console.log(`  [${i + 1}/${rows.length}] last game ${game_id}: ${inserted} events  ·  ${elapsed}s  ·  ${rate} games/s  ·  ok=${ok} fail=${fail} skipped=${skipped}`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      fail++;
      console.error(`  [${i + 1}/${rows.length}] game ${game_id} FAIL: ${err.message}`);
    }
  }

  const totalSec = ((Date.now() - startTs) / 1000).toFixed(0);
  console.log('');
  console.log('═'.repeat(70));
  console.log(`DONE en ${totalSec}s · ok=${ok} · fail=${fail} · skipped=${skipped} · API calls=${requestCount}`);
  console.log('═'.repeat(70));

  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
