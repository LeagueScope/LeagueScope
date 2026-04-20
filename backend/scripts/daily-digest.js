#!/usr/bin/env node
/**
 * daily-digest.js — 8h LeagueScope digest (00:00 / 08:00 / 16:00 Europe/Madrid)
 *
 * Cada invocación cubre la ventana de 8h que acaba de terminar en hora Madrid.
 * El Lambda recibe desde EventBridge Scheduler un input con:
 *   {
 *     "slotMadrid": "00" | "08" | "16",
 *     "windowStartUtc": "2026-04-20T06:00:00Z",   // opcional
 *     "windowEndUtc":   "2026-04-20T14:00:00Z"    // opcional
 *   }
 * Si no vienen, se calculan desde NOW alineado al slot Madrid más cercano.
 *
 * Secciones del correo:
 *   0. Header con patch activo, slot, ventana, contador de partidos
 *   1. Partidos de la ventana agrupados por banda geográfica + INTL
 *      (cada partido con badge BO/fase, scores, walkover, integrity flags, timestamps)
 *   2. Salud de la ingesta (Lambda errors + API quota + fallos estructurados)
 *   3. Offseason tracker (sólo si hay ligas con gap > 48h)
 *   4. Ligas más stale
 *
 * Persiste cada run en `digest_runs` para que el sparkline de 7 días se renderice
 * con una sola query en runs futuros.
 *
 * Env vars:
 *   PG_DSN, ALERTS_FROM, ALERTS_TO, SES_CONFIG_SET, AUTO_INGEST_FN,
 *   MATCH_POLLER_FN, PANDASCORE_HOURLY_LIMIT, AWS_REGION
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { CloudWatchClient, GetMetricStatisticsCommand, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { sparkline, trendColor } from './lib/digestSparkline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGION = process.env.AWS_REGION || 'eu-west-3';
const FROM = process.env.ALERTS_FROM || 'LeagueScope Alerts <alerts@leaguescope.com>';
const TO = process.env.ALERTS_TO || 'leaguescopeweb@gmail.com';
const CONFIG_SET = process.env.SES_CONFIG_SET || 'leaguescope-default';
const AUTO_INGEST_FN = process.env.AUTO_INGEST_FN || 'leaguescope-auto-ingest';
const MATCH_POLLER_FN = process.env.MATCH_POLLER_FN || 'leaguescope-match-poller';
const HOURLY_LIMIT = parseInt(process.env.PANDASCORE_HOURLY_LIMIT || '10000', 10);
const WINDOW_LIMIT = HOURLY_LIMIT * 8; // 8h quota

const ses = new SESv2Client({ region: REGION });
const cw = new CloudWatchClient({ region: REGION });

// ─── Palette / status ──────────────────────────────────────────────────────
const PALETTE = {
  ok:   { accent: '#16a34a', bg: '#f0fdf4', label: 'Operativo' },
  warn: { accent: '#d97706', bg: '#fffbeb', label: 'Con incidencias' },
  err:  { accent: '#dc2626', bg: '#fef2f2', label: 'Requiere atención' },
};

// ─── Ligas por banda geográfica ────────────────────────────────────────────
// slug → { id, name, band }. Estas 27 son las que el usuario aprobó seguir.
const LEAGUES = {
  // ASIA-PACIFIC (~07-15 UTC)
  LCK:            { id: 293,  name: 'LCK',                 band: 'APAC' },
  LPL:            { id: 294,  name: 'LPL',                 band: 'APAC' },
  LCP:            { id: 5351, name: 'LCP',                 band: 'APAC' },
  VCS:            { id: 4141, name: 'VCS',                 band: 'APAC' },
  LJL:            { id: 2092, name: 'LJL',                 band: 'APAC' },
  LCKCL:          { id: 4553, name: 'LCK Challengers',     band: 'APAC' },
  // EMEA (~14-22 UTC)
  LEC:            { id: 4197, name: 'LEC',                 band: 'EMEA' },
  TCL:            { id: 1003, name: 'TCL',                 band: 'EMEA' },
  EMEAMASTERS:    { id: 4996, name: 'EMEA Masters',        band: 'EMEA' },
  LFL:            { id: 4292, name: 'LFL',                 band: 'EMEA' },
  PRM:            { id: 4302, name: 'Prime League',        band: 'EMEA' },
  LES:            { id: 5496, name: 'LES',                 band: 'EMEA' },
  NLC:            { id: 4411, name: 'NLC',                 band: 'EMEA' },
  LIT:            { id: 5211, name: 'LIT',                 band: 'EMEA' },
  EBL:            { id: 4426, name: 'EBL',                 band: 'EMEA' },
  HLL:            { id: 5355, name: 'Hitpoint Masters',    band: 'EMEA' },
  ROADOFLEGENDS:  { id: 5366, name: 'Road of Legends',     band: 'EMEA' },
  // AMERICAS (~20 UTC → 05 UTC)
  LCS:            { id: 4198, name: 'LCS',                 band: 'AMER' },
  CBLOL:          { id: 302,  name: 'CBLOL',               band: 'AMER' },
  LRN:            { id: 5048, name: 'LRN',                 band: 'AMER' },
  LRS:            { id: 5049, name: 'LRS',                 band: 'AMER' },
  NACL:           { id: 4961, name: 'NACL',                band: 'AMER' },
  CIRCUITODESAF:  { id: 5377, name: 'Circuito Desafiante', band: 'AMER' },
  // INTL (transversal, placeholder "Sin partidos" si no hay actividad en la ventana)
  FIRSTSTAND:     { id: 5369, name: 'First Stand',         band: 'INTL' },
  MSI:            { id: 300,  name: 'MSI',                 band: 'INTL' },
  EWC:            { id: 5262, name: 'Esports World Cup',   band: 'INTL' },
  WORLDS:         { id: 297,  name: 'Worlds',              band: 'INTL' },
};

const LEAGUE_IDS = Object.values(LEAGUES).map((l) => l.id);
// reverse: id → { slug, name, band }
const LEAGUE_BY_ID = {};
for (const [slug, info] of Object.entries(LEAGUES)) {
  LEAGUE_BY_ID[info.id] = { slug, ...info };
}

const BAND_LABELS = {
  APAC: 'Asia-Pacífico',
  EMEA: 'EMEA',
  AMER: 'Américas',
  INTL: 'Internacional',
};
const BAND_ORDER = ['INTL', 'APAC', 'EMEA', 'AMER'];

// ─── Helpers de formateo ───────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('es-ES');
}
function fmtPct(numer, denom) {
  if (!denom || denom === 0) return numer > 0 ? '+∞' : '±0';
  const pct = ((numer - denom) / denom) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}`;
}
function fmtMadrid(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso); }
}
function fmtUtc(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm} UTC`;
  } catch { return ''; }
}
function fmtMadridDate(iso) {
  if (!iso) return 'nunca';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return String(iso); }
}
function fmtRelativeHours(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = diffMs / 3_600_000;
  if (hours < 1) return `hace ${Math.round(hours * 60)} min`;
  if (hours < 48) return `hace ${hours.toFixed(1)} h`;
  return `hace ${(hours / 24).toFixed(1)} d`;
}

// ─── Ventana del correo ─────────────────────────────────────────────────────
// Calcula [start, end) en UTC para una ventana alineada a los slots 00/08/16 Madrid.
function computeWindow(now, slotHintMadrid) {
  // Convertimos now a hora Madrid para decidir el slot actual.
  const madridNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  let slot;
  if (slotHintMadrid && ['00', '08', '16'].includes(slotHintMadrid)) {
    slot = slotHintMadrid;
  } else {
    const h = madridNow.getHours();
    if (h < 8) slot = '00';
    else if (h < 16) slot = '08';
    else slot = '16';
  }
  // slot '00' significa: ventana acabó a las 00:00 Madrid, cubre [16:00 ayer, 00:00 hoy) Madrid
  // slot '08': cubre [00:00 hoy, 08:00 hoy)
  // slot '16': cubre [08:00 hoy, 16:00 hoy)
  const slotHour = parseInt(slot, 10);
  // End = next occurrence of slotHour en hora Madrid <= now
  const endMadrid = new Date(madridNow);
  endMadrid.setHours(slotHour, 0, 0, 0);
  if (endMadrid.getTime() > madridNow.getTime()) {
    endMadrid.setDate(endMadrid.getDate() - 1);
  }
  const startMadrid = new Date(endMadrid.getTime() - 8 * 3_600_000);
  // Convertimos a UTC verdadero respetando el offset Europe/Madrid
  // (usamos toISOString de los Date que están en "wall time Madrid" interpretados como local)
  // Nota: como construimos endMadrid desde .toLocaleString('en-US'), el tz queda pisado.
  // Preferimos hacer el cálculo al revés: alinear now (UTC) al slot Madrid correspondiente.
  const end = alignUtcToMadridSlot(now, slot);
  const start = new Date(end.getTime() - 8 * 3_600_000);
  return { start, end, slot };
}

// Dado un instante UTC y un slot Madrid ('00'|'08'|'16'), devuelve la hora UTC exacta
// en la que ocurre ese slot más cercano al instante (<= now).
function alignUtcToMadridSlot(now, slot) {
  const slotHour = parseInt(slot, 10);
  // Generamos candidatos para hoy y ayer en Madrid, los convertimos a UTC via Intl, comparamos.
  const candidates = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
    const candMadrid = new Date(now.getTime() + dayOffset * 86_400_000);
    // Construimos la cadena "YYYY-MM-DDTHH:00:00" en el calendario Madrid
    const y = candMadrid.toLocaleString('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric' });
    const m = candMadrid.toLocaleString('en-CA', { timeZone: 'Europe/Madrid', month: '2-digit' });
    const d = candMadrid.toLocaleString('en-CA', { timeZone: 'Europe/Madrid', day: '2-digit' });
    const wallStr = `${y}-${m}-${d}T${String(slotHour).padStart(2, '0')}:00:00`;
    // parseamos interpretando la hora pared como si fuera UTC, luego restamos offset de Madrid
    const wallUtcMs = Date.parse(wallStr + 'Z');
    // Offset Madrid en ese instante (CET=-60, CEST=-120 en "getTimezoneOffset" style)
    // Truco: formatter con timeZoneName short
    const offsetMin = computeTzOffsetMinutes('Europe/Madrid', new Date(wallUtcMs));
    const realUtcMs = wallUtcMs - offsetMin * 60_000 * -1; // offsetMin es negativo para tz delante de UTC
    candidates.push(new Date(realUtcMs));
  }
  // el candidato más grande que sea <= now
  const valid = candidates.filter((c) => c.getTime() <= now.getTime()).sort((a, b) => b - a);
  return valid[0] || candidates[0];
}

function computeTzOffsetMinutes(tz, date) {
  // Diferencia entre hora UTC y hora pared en tz, en minutos.
  // Positivo si la tz está por detrás de UTC; negativo si está por delante.
  const utcStr = date.toISOString().slice(0, 16);
  const tzStr = date.toLocaleString('sv', { timeZone: tz }).slice(0, 16); // 'YYYY-MM-DD HH:MM'
  const utcMs = Date.parse(utcStr + 'Z');
  const tzMs = Date.parse(tzStr.replace(' ', 'T') + 'Z');
  return (utcMs - tzMs) / 60_000;
}

// ─── Queries ────────────────────────────────────────────────────────────────
async function openPool() {
  const dsn = process.env.PG_DSN;
  const config = { connectionString: dsn };
  if (dsn && dsn.includes('rds.amazonaws.com')) {
    config.ssl = { rejectUnauthorized: false };
  }
  const client = new pg.Client(config);
  await client.connect();
  return client;
}

async function ensureTables(client) {
  const sqlPath = path.join(__dirname, 'sql', 'digest_runs.sql');
  if (fs.existsSync(sqlPath)) {
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    await client.query(sql);
  }
}

/**
 * Trae todos los matches con begin_at o end_at en la ventana + metadatos suficientes
 * para clasificar cada match.
 */
async function fetchWindowMatches(client, start, end) {
  const leagueIds = LEAGUE_IDS;
  const { rows } = await client.query(
    `
    SELECT
      m.id,
      m.league_id,
      m.status,
      m.begin_at,
      m.end_at,
      m.scheduled_at,
      m.number_of_games,
      m.forfeit,
      m.draw,
      m.winner_id,
      m.games_ingested_at,
      COALESCE(l.name, '') AS league_name,
      -- Tournament stage (para fase: regular / playoffs / finals)
      COALESCE(t.name, '') AS tournament_name,
      -- Opponents (array de ids)
      (SELECT array_agg(team_id ORDER BY side)      FROM match_opponents WHERE match_id = m.id) AS opponent_ids,
      (SELECT array_agg(result_score ORDER BY side) FROM match_opponents WHERE match_id = m.id) AS opponent_scores,
      -- Team names
      (SELECT array_agg(tm.name ORDER BY mo.side)
         FROM match_opponents mo
         LEFT JOIN teams tm ON tm.id = mo.team_id
         WHERE mo.match_id = m.id) AS opponent_names,
      (SELECT array_agg(COALESCE(tm.acronym, tm.name) ORDER BY mo.side)
         FROM match_opponents mo
         LEFT JOIN teams tm ON tm.id = mo.team_id
         WHERE mo.match_id = m.id) AS opponent_acronyms,
      -- Games en el match
      (SELECT COUNT(*)::int FROM games g WHERE g.match_id = m.id AND g.finished = true AND g.length > 0) AS real_games,
      (SELECT COUNT(*)::int FROM games g WHERE g.match_id = m.id) AS total_games,
      -- Games con stats (game_players)
      (SELECT COUNT(DISTINCT g.id)::int
         FROM games g
         WHERE g.match_id = m.id
           AND EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id)) AS games_with_stats,
      -- Games con frames
      (SELECT COUNT(DISTINCT g.id)::int
         FROM games g
         WHERE g.match_id = m.id
           AND EXISTS (SELECT 1 FROM game_frames f WHERE f.game_id = g.id)) AS games_with_frames,
      -- Parche predominante
      (SELECT g.patch FROM games g WHERE g.match_id = m.id AND g.patch IS NOT NULL
        GROUP BY g.patch ORDER BY COUNT(*) DESC LIMIT 1) AS patch
    FROM matches m
    LEFT JOIN leagues l     ON l.id = m.league_id
    LEFT JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.league_id = ANY($1::int[])
      AND (
        (m.begin_at     >= $2 AND m.begin_at     < $3) OR
        (m.end_at       >= $2 AND m.end_at       < $3) OR
        (m.scheduled_at >= $2 AND m.scheduled_at < $3)
      )
    ORDER BY COALESCE(m.begin_at, m.scheduled_at) ASC
    `,
    [leagueIds, start.toISOString(), end.toISOString()],
  );
  return rows;
}

/**
 * Trae fallos no reportados para cruzar con la lista de matches clasificados.
 */
async function fetchPendingFailures(client, windowStart) {
  try {
    const { rows } = await client.query(`
      SELECT id, source, league_slug, league_id, match_id, stage, error_type, message, occurred_at
      FROM ingestion_failures
      WHERE resolved_at IS NULL
        AND reported_in IS NULL
        AND occurred_at > $1
      ORDER BY occurred_at DESC
      LIMIT 100
    `, [new Date(windowStart.getTime() - 24 * 3_600_000).toISOString()]);
    return rows;
  } catch {
    // Tabla no existe todavía en el primer deploy
    return [];
  }
}

/**
 * Clasifica un match dentro de la ventana:
 *   COMPLETO     — todos los games con stats y frames
 *   PARCIAL      — games con stats pero frames incompletos
 *   SOLO_RESULTADO — match finished con winner pero games vacíos
 *   PROGRAMADO   — not_started / running y cae en la ventana (previsto)
 *   FALLO        — finished pero con fallos sin resolver en ingestion_failures
 *   WALKOVER     — forfeit=true o walkover
 *   CANCELED     — canceled/postponed
 */
function classifyMatch(m, failuresByMatchId) {
  if (m.status === 'canceled' || m.status === 'postponed') return 'CANCELED';
  if (m.forfeit) return 'WALKOVER';
  if (m.status === 'not_started' || m.status === 'running') return 'PROGRAMADO';
  if (m.status === 'finished') {
    const hasFailure = failuresByMatchId?.[m.id]?.length > 0;
    if (m.real_games === 0) {
      if (hasFailure) return 'FALLO';
      return 'SOLO_RESULTADO';
    }
    // Comprobamos expected vs actual
    const expectedGames = m.real_games || 0;
    if (expectedGames > 0 && m.games_with_frames >= expectedGames && m.games_with_stats >= expectedGames) {
      return 'COMPLETO';
    }
    if (m.games_with_stats >= expectedGames && m.games_with_frames < expectedGames) {
      return 'PARCIAL';
    }
    if (hasFailure) return 'FALLO';
    return 'PARCIAL';
  }
  return 'SOLO_RESULTADO';
}

/**
 * Flags de integridad que se muestran inline al lado del match:
 *   - score vs games mismatch
 *   - missing game_players en algún game
 *   - missing patch
 *   - match cerrado pero sin games
 */
function integrityFlags(m) {
  const flags = [];
  if (m.status === 'finished' && m.real_games > 0 && !m.patch) flags.push('patch?');
  if (m.status === 'finished' && m.real_games === 0 && m.total_games > 0) flags.push('games vacíos');
  if (m.games_with_frames < m.real_games && m.real_games > 0) flags.push(`frames ${m.games_with_frames}/${m.real_games}`);
  if (m.games_with_stats < m.real_games && m.real_games > 0) flags.push(`stats ${m.games_with_stats}/${m.real_games}`);
  // score vs games: si winner existe pero el score marca 0-0
  if (m.status === 'finished' && m.winner_id && Array.isArray(m.opponent_scores)) {
    const sum = m.opponent_scores.reduce((s, v) => s + (v || 0), 0);
    if (sum === 0 && m.real_games > 0) flags.push('score?');
  }
  return flags;
}

/**
 * Determina la fase aproximada del match a partir del nombre del tournament.
 */
function matchPhase(tournamentName = '') {
  const t = String(tournamentName).toLowerCase();
  if (!t) return null;
  if (t.includes('grand final') || t === 'final' || t.includes(' final')) return 'FINAL';
  if (t.includes('semifinal') || t.includes('semi-final')) return 'SEMI';
  if (t.includes('playoff')) return 'PLAYOFFS';
  if (t.includes('group')) return 'GROUPS';
  if (t.includes('regular')) return 'REGULAR';
  if (t.includes('knockout')) return 'KO';
  if (t.includes('play-in')) return 'PLAY-IN';
  if (t.includes('swiss')) return 'SWISS';
  return null;
}

function matchFormat(n) {
  if (!n) return 'BO?';
  if (n === 1) return 'BO1';
  if (n === 3) return 'BO3';
  if (n === 5) return 'BO5';
  if (n === 7) return 'BO7';
  return `BO${n}`;
}

/**
 * Filtra matches BO>1 cuya "serie" NO termina dentro de la ventana.
 * Criterio: si el match es finished, se queda; si es programado y end_at está fuera, también
 * pasa (lo queremos anunciar). Pero si hubiera games cruzando ventanas, este filtro
 * decide que sólo se liste en la ventana en la que el match CERRÓ.
 *
 * Como nuestra tabla `matches` tiene end_at ↔ winner confirmado, basta con esta regla:
 *   incluir si begin_at ∈ ventana  ó  end_at ∈ ventana  ó  scheduled_at ∈ ventana
 * y para matches finished con end_at FUERA de la ventana, los excluimos (se habrán listado
 * en la ventana en que terminaron).
 */
function filterCrossWindowSeries(matches, start, end) {
  return matches.filter((m) => {
    if (m.status === 'finished' && m.end_at) {
      const endTs = new Date(m.end_at).getTime();
      return endTs >= start.getTime() && endTs < end.getTime();
    }
    // No finished: se queda si begin_at o scheduled_at están en la ventana
    const pivot = m.begin_at || m.scheduled_at;
    if (!pivot) return false;
    const ts = new Date(pivot).getTime();
    return ts >= start.getTime() && ts < end.getTime();
  });
}

// ─── Stats de ventana ──────────────────────────────────────────────────────
async function fetchWindowStats(client, start, end) {
  const { rows: [stats] } = await client.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE games_ingested_at >= $1 AND games_ingested_at < $2)::int AS new_ingestions,
      COUNT(*) FILTER (WHERE end_at >= $1 AND end_at < $2 AND status = 'finished')::int AS finished_in_window
    FROM matches
    WHERE league_id = ANY($3::int[])
    `,
    [start.toISOString(), end.toISOString(), LEAGUE_IDS],
  );
  const { rows: [games] } = await client.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE g.end_at >= $1 AND g.end_at < $2)::int AS total,
      COUNT(*) FILTER (WHERE g.end_at >= $1 AND g.end_at < $2
                       AND EXISTS (SELECT 1 FROM game_frames f WHERE f.game_id = g.id))::int AS with_frames
    FROM games g
    WHERE g.league_id = ANY($3::int[])
    `,
    [start.toISOString(), end.toISOString(), LEAGUE_IDS],
  );
  return { ...stats, games_total: games.total, games_with_frames: games.with_frames };
}

async function fetchTrendRuns(client, limit = 21) {
  try {
    const { rows } = await client.query(
      `SELECT id, started_at, slot_madrid, matches_total, per_league
       FROM digest_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.reverse(); // cronológico
  } catch {
    return [];
  }
}

async function fetchIngestionState(client) {
  const { rows } = await client.query(`
    SELECT i.league_slug, COALESCE(l.name, i.league_slug) AS league_name,
           i.last_completed, i.priority, i.status, i.retry_count
    FROM ingestion_state i
    LEFT JOIN leagues l ON l.id = i.league_id
    WHERE i.priority > 0
    ORDER BY i.last_completed ASC NULLS FIRST
  `);
  return rows;
}

async function fetchPatchInfo(client) {
  // Parche más reciente que aparece en games ingestadas en los últimos 14 días
  const { rows } = await client.query(`
    SELECT g.patch AS patch,
           MIN(g.begin_at) AS first_seen,
           MAX(g.begin_at) AS last_seen
    FROM games g
    WHERE g.patch IS NOT NULL
      AND g.begin_at > NOW() - INTERVAL '30 days'
    GROUP BY g.patch
    ORDER BY MAX(g.begin_at) DESC
    LIMIT 3
  `);
  return rows;
}

// ─── CloudWatch ────────────────────────────────────────────────────────────
async function getLambdaMetric(functionName, metricName, startTime, endTime) {
  const cmd = new GetMetricStatisticsCommand({
    Namespace: 'AWS/Lambda',
    MetricName: metricName,
    Dimensions: [{ Name: 'FunctionName', Value: functionName }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 3600 * 8,
    Statistics: ['Sum'],
  });
  const res = await cw.send(cmd);
  return res.Datapoints?.[0]?.Sum || 0;
}

async function fetchCloudWatch(start, end) {
  const [autoInv, autoErr, pollInv, pollErr] = await Promise.all([
    getLambdaMetric(AUTO_INGEST_FN, 'Invocations', start, end),
    getLambdaMetric(AUTO_INGEST_FN, 'Errors', start, end),
    getLambdaMetric(MATCH_POLLER_FN, 'Invocations', start, end),
    getLambdaMetric(MATCH_POLLER_FN, 'Errors', start, end),
  ]);
  const alarms = await cw.send(new DescribeAlarmsCommand({
    AlarmNamePrefix: 'leaguescope-',
    StateValue: 'ALARM',
  }));
  return {
    autoIngest: { invocations: autoInv, errors: autoErr },
    matchPoller: { invocations: pollInv, errors: pollErr },
    activeAlarms: alarms.MetricAlarms || [],
  };
}

// ─── Snapshot del run ──────────────────────────────────────────────────────
async function recordRun(client, { start, end, slot, matches, stats, patchActive, sesMessageId, status }) {
  const summary = {
    total: 0, completo: 0, parcial: 0, solo_res: 0, programado: 0, fallo: 0, walkover: 0,
  };
  const perLeague = {};
  for (const m of matches) {
    summary.total++;
    const key = m._classification.toLowerCase();
    const mapKey = {
      completo: 'completo', parcial: 'parcial', solo_resultado: 'solo_res',
      programado: 'programado', fallo: 'fallo', walkover: 'walkover', canceled: 'walkover',
    }[key];
    if (mapKey && summary[mapKey] != null) summary[mapKey]++;
    const slug = LEAGUE_BY_ID[m.league_id]?.slug;
    if (slug) {
      if (!perLeague[slug]) {
        perLeague[slug] = { completo: 0, parcial: 0, solo_res: 0, programado: 0, fallo: 0, walkover: 0, total: 0 };
      }
      perLeague[slug].total++;
      if (mapKey) perLeague[slug][mapKey]++;
    }
  }
  try {
    await client.query(
      `INSERT INTO digest_runs
        (window_start_utc, window_end_utc, slot_madrid,
         matches_total, matches_completo, matches_parcial, matches_solo_res,
         matches_programado, matches_fallo, matches_walkover,
         games_total, games_with_frames, leagues_active,
         patch_active, per_league, ses_message_id, status, finished_at)
       VALUES ($1,$2,$3, $4,$5,$6,$7,$8,$9,$10, $11,$12,$13, $14,$15,$16,$17, NOW())`,
      [
        start.toISOString(), end.toISOString(), slot,
        summary.total, summary.completo, summary.parcial, summary.solo_res,
        summary.programado, summary.fallo, summary.walkover,
        stats.games_total || 0, stats.games_with_frames || 0, Object.keys(perLeague).length,
        patchActive || null, JSON.stringify(perLeague), sesMessageId || null, status || 'ok',
      ],
    );
  } catch (e) {
    console.warn(`[digest] no pudo guardar run: ${e.message}`);
  }
}

// ─── Render ─────────────────────────────────────────────────────────────────
const CLASS_STYLE = {
  COMPLETO:       { bg: '#dcfce7', fg: '#14532d', label: 'Completo' },
  PARCIAL:        { bg: '#fef3c7', fg: '#78350f', label: 'Parcial' },
  SOLO_RESULTADO: { bg: '#e0e7ff', fg: '#3730a3', label: 'Solo resultado' },
  PROGRAMADO:     { bg: '#e2e8f0', fg: '#1e293b', label: 'Programado' },
  FALLO:          { bg: '#fecaca', fg: '#7f1d1d', label: 'Fallo' },
  WALKOVER:       { bg: '#fde68a', fg: '#78350f', label: 'Walkover' },
  CANCELED:       { bg: '#e2e8f0', fg: '#475569', label: 'Cancelado' },
};

function renderMatchRow(m, opts = {}) {
  const cls = CLASS_STYLE[m._classification] || CLASS_STYLE.SOLO_RESULTADO;
  const fmt = matchFormat(m.number_of_games);
  const phase = matchPhase(m.tournament_name);
  const flags = integrityFlags(m);
  const beginTs = m.begin_at || m.scheduled_at;
  const madrid = fmtMadrid(beginTs);
  const utc = fmtUtc(beginTs);

  const acro = Array.isArray(m.opponent_acronyms) ? m.opponent_acronyms : [];
  const scores = Array.isArray(m.opponent_scores) ? m.opponent_scores : [];
  const teamA = acro[0] || '—';
  const teamB = acro[1] || '—';
  const scoreA = scores[0] != null ? scores[0] : '';
  const scoreB = scores[1] != null ? scores[1] : '';
  const scoreStr = m.status === 'finished'
    ? `${scoreA}–${scoreB}`
    : (m.status === 'running' ? 'EN VIVO' : 'vs');

  const badges = [
    `<span style="display:inline-block;padding:1px 6px;border-radius:3px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:600;">${fmt}</span>`,
  ];
  if (phase) badges.push(`<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:3px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:600;">${phase}</span>`);

  const flagsHtml = flags.length
    ? `<span style="margin-left:8px;color:#b45309;font-size:11px;">⚠ ${flags.map(esc).join(' · ')}</span>`
    : '';

  return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;white-space:nowrap;color:#0f172a;font-size:12px;font-variant-numeric:tabular-nums;">
        ${esc(madrid)} <span style="color:#94a3b8;font-size:10px;">${esc(utc)}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#0f172a;">
        <div><strong>${esc(teamA)}</strong> <span style="color:#475569;">${esc(scoreStr)}</span> <strong>${esc(teamB)}</strong>${flagsHtml}</div>
        <div style="margin-top:3px;">${badges.join('')}</div>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;text-align:right;white-space:nowrap;">
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${cls.bg};color:${cls.fg};font-size:11px;font-weight:600;">${cls.label}</span>
      </td>
    </tr>`;
}

function buildLeagueBlock(leagueId, matches, sparklineValues) {
  const info = LEAGUE_BY_ID[leagueId];
  if (!info) return '';
  const name = info.name;
  const values = sparklineValues || [];
  const color = trendColor(values);
  const spark = values.length ? sparkline(values, { width: 110, height: 22, stroke: color }) : '';

  const rows = matches.map((m) => renderMatchRow(m)).join('');
  const count = matches.length;

  return `
    <tr>
      <td style="padding:14px 18px 4px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;">
              <span style="font-size:13px;font-weight:700;color:#0f172a;letter-spacing:-0.1px;">${esc(name)}</span>
              <span style="font-size:11px;color:#64748b;margin-left:6px;">${count} ${count === 1 ? 'partido' : 'partidos'}</span>
            </td>
            <td style="vertical-align:middle;text-align:right;">${spark}</td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
          ${rows || '<tr><td style="padding:10px;color:#94a3b8;font-size:12px;text-align:center;">Sin partidos</td></tr>'}
        </table>
      </td>
    </tr>`;
}

function buildIntlPlaceholder(leagueId) {
  const info = LEAGUE_BY_ID[leagueId];
  if (!info) return '';
  return `
    <tr>
      <td style="padding:8px 18px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:8px 10px;border:1px dashed #e2e8f0;border-radius:6px;color:#94a3b8;font-size:12px;">
              <strong style="color:#64748b;">${esc(info.name)}</strong> · Sin partidos en esta ventana
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function buildBandSection(band, leagueBlocks) {
  if (!leagueBlocks.length) return '';
  return `
    <tr>
      <td style="padding:18px 28px 0;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">${esc(BAND_LABELS[band])}</div>
      </td>
    </tr>
    ${leagueBlocks.join('')}
  `;
}

function computeSparklinesFromRuns(runs) {
  const series = {};
  for (const slug of Object.keys(LEAGUES)) series[slug] = [];
  for (const r of runs) {
    const pl = r.per_league || {};
    for (const slug of Object.keys(LEAGUES)) {
      series[slug].push(pl[slug]?.total || 0);
    }
  }
  return series;
}

function buildOffseasonBlock(ingestionState) {
  const now = Date.now();
  const stale = ingestionState
    .filter((s) => s.last_completed && (now - new Date(s.last_completed).getTime()) > 48 * 3_600_000)
    .filter((s) => LEAGUES[s.league_slug])
    .slice(0, 6);
  if (!stale.length) return '';

  const rows = stale.map((s) => {
    const gap = ((now - new Date(s.last_completed).getTime()) / 86_400_000).toFixed(1);
    return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#0f172a;">${esc(s.league_name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;text-align:right;font-variant-numeric:tabular-nums;">${gap} d sin actividad</td>
      </tr>`;
  }).join('');
  return `
    <tr>
      <td style="padding:20px 28px 0;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Offseason tracker</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          ${rows}
        </table>
      </td>
    </tr>`;
}

function buildFailuresBlock(failures) {
  if (!failures.length) return '';
  const rows = failures.slice(0, 8).map((f) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;background:#fef2f2;">
        <div style="font-size:11px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;">${esc(f.source || 'other')}${f.league_slug ? ' · ' + esc(f.league_slug) : ''}${f.match_id ? ' · match ' + f.match_id : ''}</div>
        <div style="font-size:12px;color:#7f1d1d;margin-top:2px;">${esc(String(f.message || '').slice(0, 220))}</div>
        <div style="font-size:10px;color:#991b1b;margin-top:2px;">${esc(fmtRelativeHours(f.occurred_at))} · ${esc(f.error_type || 'unknown')}</div>
      </td>
    </tr>`).join('');
  return `
    <tr>
      <td style="padding:20px 28px 0;">
        <div style="font-size:11px;font-weight:600;color:#991b1b;text-transform:uppercase;letter-spacing:1px;">Fallos de ingesta pendientes</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:collapse;border:1px solid #fee2e2;border-radius:8px;overflow:hidden;">
          ${rows}
        </table>
      </td>
    </tr>`;
}

function buildStatusCards(stats, cwData, windowLimit) {
  const apiEstimate = Math.round(cwData.autoIngest.invocations * 500 + cwData.matchPoller.invocations * 20);
  const quotaPct = Math.min(((apiEstimate / windowLimit) * 100), 100).toFixed(1);
  const quotaColor = quotaPct > 80 ? '#dc2626' : quotaPct > 50 ? '#d97706' : '#16a34a';
  return `
    <tr>
      <td style="padding:20px 28px 0;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Salud del sistema</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-collapse:separate;border-spacing:8px;">
          <tr>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;vertical-align:top;width:33%;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Matches ingestados</div>
              <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums;">${fmtNum(stats.new_ingestions)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:3px;">en la ventana</div>
            </td>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;vertical-align:top;width:33%;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Games con frames</div>
              <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:3px;font-variant-numeric:tabular-nums;">${fmtNum(stats.games_with_frames)} / ${fmtNum(stats.games_total)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:3px;">telemetría completa</div>
            </td>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;vertical-align:top;width:33%;">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;">Lambdas (err/inv)</div>
              <div style="font-size:20px;font-weight:700;color:${cwData.autoIngest.errors + cwData.matchPoller.errors > 0 ? '#dc2626' : '#0f172a'};margin-top:3px;font-variant-numeric:tabular-nums;">${fmtNum(cwData.autoIngest.errors + cwData.matchPoller.errors)} / ${fmtNum(cwData.autoIngest.invocations + cwData.matchPoller.invocations)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:3px;">auto-ingest + poller</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:10px;padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:11px;color:#64748b;">Llamadas PandaScore estimadas (ventana)</span>
            <span style="font-size:12px;font-weight:600;color:#0f172a;font-variant-numeric:tabular-nums;">${fmtNum(apiEstimate)} / ${fmtNum(windowLimit)}</span>
          </div>
          <div style="margin-top:6px;background:#e2e8f0;border-radius:4px;height:5px;overflow:hidden;">
            <div style="background:${quotaColor};height:100%;width:${quotaPct}%;"></div>
          </div>
        </div>
      </td>
    </tr>`;
}

// ─── Handler principal ──────────────────────────────────────────────────────
export async function handler(event) {
  console.log('Digest triggered:', JSON.stringify(event || {}));
  const now = new Date();
  const hintSlot = event?.slotMadrid || event?.slot || null;
  let start, end, slot;
  if (event?.windowStartUtc && event?.windowEndUtc) {
    start = new Date(event.windowStartUtc);
    end = new Date(event.windowEndUtc);
    slot = hintSlot || inferSlotFromEnd(end);
  } else {
    ({ start, end, slot } = computeWindow(now, hintSlot));
  }

  const client = await openPool();
  try {
    await ensureTables(client);

    const [windowMatches, failures, ingestionState, patchRows, trendRuns, windowStats, cwData] = await Promise.all([
      fetchWindowMatches(client, start, end),
      fetchPendingFailures(client, start),
      fetchIngestionState(client),
      fetchPatchInfo(client),
      fetchTrendRuns(client, 21),
      fetchWindowStats(client, start, end),
      fetchCloudWatch(start, end),
    ]);

    const failuresByMatchId = {};
    for (const f of failures) {
      if (f.match_id) {
        if (!failuresByMatchId[f.match_id]) failuresByMatchId[f.match_id] = [];
        failuresByMatchId[f.match_id].push(f);
      }
    }

    const matchesInWindow = filterCrossWindowSeries(windowMatches, start, end);

    for (const m of matchesInWindow) {
      m._classification = classifyMatch(m, failuresByMatchId);
    }

    const byBand = { APAC: {}, EMEA: {}, AMER: {}, INTL: {} };
    for (const m of matchesInWindow) {
      const info = LEAGUE_BY_ID[m.league_id];
      if (!info) continue;
      if (!byBand[info.band][info.id]) byBand[info.band][info.id] = [];
      byBand[info.band][info.id].push(m);
    }

    const sparklineSeries = computeSparklinesFromRuns(trendRuns);

    const bandSections = [];
    for (const band of BAND_ORDER) {
      const leagueBlocks = [];
      const leaguesOfBand = Object.values(LEAGUES).filter((l) => l.band === band);
      for (const leagueInfo of leaguesOfBand) {
        const leagueId = leagueInfo.id;
        const matches = byBand[band][leagueId] || [];
        if (matches.length > 0) {
          const slug = Object.keys(LEAGUES).find((s) => LEAGUES[s].id === leagueId);
          const values = (sparklineSeries[slug] || []).slice(-7);
          leagueBlocks.push(buildLeagueBlock(leagueId, matches, values));
        } else if (band === 'INTL') {
          const slug = Object.keys(LEAGUES).find((s) => LEAGUES[s].id === leagueId);
          const last28d = (sparklineSeries[slug] || []);
          const hasRecentActivity = last28d.some((v) => v > 0);
          if (hasRecentActivity) {
            leagueBlocks.push(buildIntlPlaceholder(leagueId));
          }
        }
      }
      if (leagueBlocks.length) {
        bandSections.push(buildBandSection(band, leagueBlocks));
      }
    }

    const patchActive = patchRows?.[0]?.patch || null;
    const patchAge = patchActive ? fmtRelativeHours(patchRows[0].first_seen) : null;

    const subject = buildSubject(slot, matchesInWindow);

    const hasErrors = cwData.activeAlarms.length > 0 || matchesInWindow.some((m) => m._classification === 'FALLO');
    const hasWarn = cwData.autoIngest.errors > 0 || cwData.matchPoller.errors > 0 || failures.length > 0;
    const status = hasErrors ? PALETTE.err : hasWarn ? PALETTE.warn : PALETTE.ok;

    const html = buildHtml({
      start, end, slot, status,
      bandSections, patchActive, patchAge, patchRows,
      matchesInWindow, stats: windowStats, cwData,
      ingestionState, failures,
    });
    const text = buildText({ slot, status, matchesInWindow, stats: windowStats, cwData, failures });

    let sesMessageId = null;
    let runStatus = 'ok';
    try {
      const res = await ses.send(new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [TO] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: html, Charset: 'UTF-8' },
              Text: { Data: text, Charset: 'UTF-8' },
            },
          },
        },
        ConfigurationSetName: CONFIG_SET,
      }));
      sesMessageId = res.MessageId;
      console.log(`Digest sent: ${sesMessageId} · slot=${slot} · matches=${matchesInWindow.length}`);
    } catch (sesErr) {
      console.error('SES send failed:', sesErr);
      runStatus = 'error';
    }

    await recordRun(client, {
      start, end, slot, matches: matchesInWindow,
      stats: windowStats, patchActive, sesMessageId, status: runStatus,
    });

    try {
      if (failures.length && sesMessageId) {
        const { rows: [latest] } = await client.query(
          `SELECT id FROM digest_runs WHERE ses_message_id = $1 ORDER BY id DESC LIMIT 1`,
          [sesMessageId],
        );
        if (latest?.id) {
          await client.query(
            `UPDATE ingestion_failures SET reported_in = $1
             WHERE id = ANY($2::bigint[]) AND reported_in IS NULL`,
            [latest.id, failures.map((f) => f.id)],
          );
        }
      }
    } catch (e) {
      console.warn(`[digest] no pudo marcar failures reportados: ${e.message}`);
    }

    return { ok: runStatus === 'ok', messageId: sesMessageId, slot, matchesCount: matchesInWindow.length };
  } catch (err) {
    console.error('Digest failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

function inferSlotFromEnd(end) {
  const h = new Date(end.toLocaleString('en-US', { timeZone: 'Europe/Madrid' })).getHours();
  if (h === 0 || h === 24) return '00';
  if (h === 8) return '08';
  if (h === 16) return '16';
  if (h < 8) return '00';
  if (h < 16) return '08';
  return '16';
}

function buildSubject(slot, matches) {
  const finished = matches.filter((m) => m._classification === 'COMPLETO' || m._classification === 'PARCIAL' || m._classification === 'SOLO_RESULTADO');
  let lead = '';
  if (finished.length) {
    const phasePriority = { FINAL: 5, SEMI: 4, PLAYOFFS: 3, GROUPS: 2, REGULAR: 1 };
    const leaguePriority = { LCK: 10, LPL: 10, LEC: 10, LCS: 10, WORLDS: 12, MSI: 11, FIRSTSTAND: 11, EWC: 11 };
    const sorted = [...finished].sort((a, b) => {
      const slugA = LEAGUE_BY_ID[a.league_id]?.slug || '';
      const slugB = LEAGUE_BY_ID[b.league_id]?.slug || '';
      const pa = (leaguePriority[slugA] || 1) + (phasePriority[matchPhase(a.tournament_name)] || 0);
      const pb = (leaguePriority[slugB] || 1) + (phasePriority[matchPhase(b.tournament_name)] || 0);
      return pb - pa;
    });
    const top = sorted[0];
    const acro = Array.isArray(top.opponent_acronyms) ? top.opponent_acronyms : [];
    const sc = Array.isArray(top.opponent_scores) ? top.opponent_scores : [];
    const slugTop = LEAGUE_BY_ID[top.league_id]?.slug || '';
    const phase = matchPhase(top.tournament_name);
    const phaseStr = phase ? ` ${phase}` : '';
    if (acro.length === 2 && top.status === 'finished') {
      lead = `${slugTop}${phaseStr} ${acro[0]} ${sc[0] ?? 0}-${sc[1] ?? 0} ${acro[1]}`;
    } else {
      lead = `${slugTop}${phaseStr}`;
    }
  }
  const extra = Math.max(0, matches.length - (lead ? 1 : 0));
  const tail = extra > 0 ? ` + ${extra} ${extra === 1 ? 'partido' : 'partidos'}` : '';
  if (lead) return `LeagueScope · ${slot}:00 · ${lead}${tail}`;
  if (matches.length === 0) return `LeagueScope · ${slot}:00 · sin actividad`;
  return `LeagueScope · ${slot}:00 · ${matches.length} ${matches.length === 1 ? 'partido' : 'partidos'}`;
}

function buildHtml({ start, end, slot, status, bandSections, patchActive, patchAge, patchRows, matchesInWindow, stats, cwData, ingestionState, failures }) {
  const windowLabel = `${fmtMadrid(start)} → ${fmtMadrid(end)}  ·  ${fmtUtc(start)} → ${fmtUtc(end)}`;
  const today = new Date().toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const patchHeader = patchActive
    ? `<div style="margin-top:4px;font-size:12px;color:#475569;">Parche activo <strong>${esc(patchActive)}</strong>${patchAge ? ' · primer games ' + esc(patchAge) : ''}</div>`
    : '';

  const classCounts = matchesInWindow.reduce((acc, m) => {
    acc[m._classification] = (acc[m._classification] || 0) + 1;
    return acc;
  }, {});

  const countBadges = ['COMPLETO', 'PARCIAL', 'SOLO_RESULTADO', 'PROGRAMADO', 'FALLO', 'WALKOVER']
    .filter((k) => classCounts[k])
    .map((k) => {
      const s = CLASS_STYLE[k];
      return `<span style="display:inline-block;margin-right:6px;padding:2px 8px;border-radius:4px;background:${s.bg};color:${s.fg};font-size:11px;font-weight:600;">${s.label} · ${classCounts[k]}</span>`;
    }).join('');

  const offseason = buildOffseasonBlock(ingestionState);
  const failuresBlock = buildFailuresBlock(failures);
  const statusCards = buildStatusCards(stats, cwData, WINDOW_LIMIT);

  const consoleUrl = `https://${REGION}.console.aws.amazon.com/cloudwatch/home?region=${REGION}#dashboards:`;

  const bandsHtml = bandSections.length
    ? bandSections.join('')
    : `<tr><td style="padding:20px 28px;"><div style="padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#475569;font-size:13px;">Sin partidos en esta ventana.</div></td></tr>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
      <tr>
        <td style="background:${status.bg};border-left:3px solid ${status.accent};padding:22px 28px;">
          <div style="font-size:11px;font-weight:600;color:${status.accent};text-transform:uppercase;letter-spacing:1.2px;">Informe ${esc(slot)}:00 · ${esc(status.label)}</div>
          <h1 style="margin:6px 0 2px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.2px;">LeagueScope</h1>
          <div style="font-size:13px;color:#475569;margin-top:2px;">${esc(today)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;font-variant-numeric:tabular-nums;">Ventana: ${esc(windowLabel)}</div>
          ${patchHeader}
          <div style="margin-top:10px;">${countBadges || '<span style="color:#64748b;font-size:11px;">Sin partidos en la ventana.</span>'}</div>
        </td>
      </tr>

      ${bandsHtml}

      ${statusCards}

      ${offseason}

      ${failuresBlock}

      <tr>
        <td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:11px;color:#94a3b8;">
                LeagueScope · Informe automático · <a href="https://leaguescope.com" style="color:#64748b;text-decoration:none;">leaguescope.com</a>
              </td>
              <td style="font-size:11px;text-align:right;">
                <a href="${consoleUrl}" style="color:#2563eb;text-decoration:none;font-weight:500;">Abrir CloudWatch →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText({ slot, status, matchesInWindow, stats, cwData, failures }) {
  const lines = [];
  lines.push(`LeagueScope · Informe ${slot}:00 · ${status.label}`);
  lines.push(`Partidos en ventana: ${matchesInWindow.length}`);
  lines.push(`Matches ingestados: ${fmtNum(stats.new_ingestions)}`);
  lines.push(`Games con frames: ${fmtNum(stats.games_with_frames)} / ${fmtNum(stats.games_total)}`);
  lines.push(`Lambdas: auto-ingest ${cwData.autoIngest.errors}/${cwData.autoIngest.invocations} err/inv · poller ${cwData.matchPoller.errors}/${cwData.matchPoller.invocations} err/inv`);
  if (failures.length) lines.push(`Fallos pendientes: ${failures.length}`);
  return lines.join('\n');
}
