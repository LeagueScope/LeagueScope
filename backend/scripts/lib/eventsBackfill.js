/**
 * eventsBackfill.js — auto-curación de game_events parciales.
 *
 * Detecta games donde el agregado de game_teams (kills) supera al conteo de
 * eventos en game_events (player_kill) y vuelve a llamar al endpoint de
 * /lol/games/:id/events de PandaScore PAGINADO (apiGetAll), borrando e
 * insertando en bloque dentro de una transacción.
 *
 * Llamado desde auto-ingest.js al inicio de cada Lambda invocation con un
 * presupuesto de tiempo (deadline) para no romper el límite de 14 min.
 *
 * Histórico: bug raíz fue usar apiGet (sin paginar) en fetch-to-postgres.js.
 * PandaScore por defecto sirve per_page=50, así que games con >50 events
 * (la mayoría) se quedaban truncados. Fix aplicado en fetch-to-postgres.js
 * y este módulo limpia los 2.6k games existentes que quedaron así.
 */

const PANDASCORE_BASE_URL = 'https://api.pandascore.co';
const MIN_DELAY_MS = 400;

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

/**
 * Construye un cliente HTTP rate-limited contra PandaScore.
 * Devuelve { apiGet, apiGetAll, getCallCount }.
 */
function makeClient(token) {
  let lastRequestTime = 0;
  let callCount = 0;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function apiFetch(url, attempt = 1) {
    const wait = Math.max(0, MIN_DELAY_MS - (Date.now() - lastRequestTime));
    if (wait > 0) await sleep(wait);
    lastRequestTime = Date.now();
    callCount++;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(tid);
      if (res.status === 429) {
        const ra = parseInt(res.headers.get('Retry-After') || '5');
        if (attempt <= 5) { await sleep(ra * 1000); return apiFetch(url, attempt + 1); }
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
    const u = new URL(PANDASCORE_BASE_URL + path);
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

  return { apiGet, apiGetAll, getCallCount: () => callCount };
}

/**
 * Re-ingestar events de un solo game (DELETE + INSERT en transacción).
 * @param {pg.Pool} pool
 * @param {Array<object>} events  output de apiGetAll
 * @param {number} gameId
 * @returns {number} events realmente insertados
 */
async function reingestGameEvents(pool, gameId, events) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM game_events WHERE game_id = $1', [gameId]);
    let inserted = 0;
    for (const ev of events) {
      if (!VALID_EVENT_TYPES.has(ev.type)) continue;
      const e = extractEvent(ev);
      const { rows: evRows } = await client.query(`
        INSERT INTO game_events (game_id, timestamp, type,
          killer_player_id, killer_champion_id, victim_player_id, victim_champion_id, is_first)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [gameId, e.timestamp, e.type,
          e.killer_player_id, e.killer_champion_id,
          e.victim_player_id, e.victim_champion_id,
          e.is_first]);

      if (evRows[0]?.id && Array.isArray(e.assistants)) {
        for (const a of e.assistants) {
          if (a.player_id) {
            await client.query(
              'INSERT INTO game_event_assists (event_id, player_id, champion_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
              [evRows[0].id, a.player_id, a.champion_id ?? null],
            );
          }
        }
      }
      inserted++;
    }
    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Phase principal: cura games con events parciales.
 *
 * @param {object} opts
 * @param {pg.Pool} opts.pool
 * @param {string} opts.token       PandaScore token
 * @param {number} opts.deadlineMs  Timestamp epoch al que NO se debe pasar
 * @param {number} [opts.minGap=5]  Solo games con kill_gap >= este valor
 * @param {number} [opts.maxGames=100] Tope absoluto de games por invocación
 * @param {function} [opts.log]     console.log substitute
 * @returns {Promise<{found,fixed,failed,apiCalls,elapsedMs}>}
 */
export async function fixPartialEvents({
  pool,
  token,
  deadlineMs,
  minGap = 5,
  maxGames = 100,
  log = console.log,
} = {}) {
  const startTs = Date.now();
  if (!pool || !token || !deadlineMs) {
    throw new Error('fixPartialEvents requires pool, token, deadlineMs');
  }

  // Margen mínimo: si quedan <30s no merece la pena empezar
  const budget = deadlineMs - Date.now();
  if (budget < 30_000) {
    log(`▶ fixPartialEvents: skip (only ${(budget/1000).toFixed(0)}s left)`);
    return { found: 0, fixed: 0, failed: 0, apiCalls: 0, elapsedMs: 0 };
  }

  log(`▶ fixPartialEvents: budget ${(budget/1000).toFixed(0)}s, minGap=${minGap}, maxGames=${maxGames}`);

  // Detectar games con gap. Excluimos legacy (sin events) — esos son data
  // anterior a 2018 sin detalle disponible en PandaScore.
  const { rows } = await pool.query(`
    WITH agg AS (
      SELECT game_id, SUM(kills) AS agg_kills
      FROM game_teams GROUP BY game_id
    ),
    ev AS (
      SELECT game_id, COUNT(*) FILTER (WHERE type='player_kill') AS ev_kills
      FROM game_events GROUP BY game_id
    )
    SELECT a.game_id, a.agg_kills - COALESCE(e.ev_kills, 0) AS gap
    FROM agg a
    LEFT JOIN ev e ON e.game_id = a.game_id
    WHERE COALESCE(e.ev_kills, 0) > 0
      AND a.agg_kills - COALESCE(e.ev_kills, 0) >= $1
    ORDER BY gap DESC
    LIMIT $2
  `, [minGap, maxGames]);

  if (rows.length === 0) {
    log('  No partial events to fix ✓');
    return { found: 0, fixed: 0, failed: 0, apiCalls: 0, elapsedMs: Date.now() - startTs };
  }

  log(`  Found ${rows.length} games with gap>=${minGap}`);

  const client = makeClient(token);
  let fixed = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { game_id, gap } = rows[i];

    // Reservar 5s para el cleanup. Si nos quedan <5s, salimos.
    if (Date.now() + 5000 >= deadlineMs) {
      log(`  Deadline reached after ${i}/${rows.length}, stopping early`);
      break;
    }

    try {
      const events = await client.apiGetAll(`/lol/games/${game_id}/events`);
      if (!events || events.length === 0) {
        // PandaScore no devuelve events para este game (game running, removed, etc.)
        continue;
      }
      const inserted = await reingestGameEvents(pool, game_id, events);
      fixed++;
      if ((i + 1) % 20 === 0 || i === rows.length - 1) {
        log(`  [${i+1}/${rows.length}] last game ${game_id} (gap=${gap}, ${inserted} events) · fixed=${fixed} failed=${failed}`);
      }
    } catch (e) {
      failed++;
      log(`  ✗ game ${game_id} failed: ${e.message?.slice(0, 100)}`);
    }
  }

  const elapsedMs = Date.now() - startTs;
  log(`  Done: fixed=${fixed} failed=${failed} apiCalls=${client.getCallCount()} elapsed=${(elapsedMs/1000).toFixed(0)}s`);
  return {
    found: rows.length,
    fixed,
    failed,
    apiCalls: client.getCallCount(),
    elapsedMs,
  };
}
