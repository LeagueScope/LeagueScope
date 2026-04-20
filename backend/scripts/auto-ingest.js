#!/usr/bin/env node
/**
 * auto-ingest.js — Automated league ingestion orchestrator
 *
 * Designed for AWS Lambda (15-min timeout) but works locally too.
 * Picks the most stale leagues, runs fetch-to-postgres.js for each,
 * and tracks state in the ingestion_state table.
 *
 * Flow:
 *   1. Read ingestion_state to find most stale leagues
 *   2. Process leagues one-by-one (most stale first, weighted by priority)
 *   3. Stop when approaching the time limit
 *   4. Update state after each league
 *
 * Usage (local):
 *   node scripts/auto-ingest.js
 *   node scripts/auto-ingest.js --max-time 600    # 10 min limit
 *   node scripts/auto-ingest.js --max-leagues 1    # just 1 league
 *   node scripts/auto-ingest.js --static-first     # run static data first
 *
 * Usage (Lambda): exported handler() is the entry point.
 *
 * Env vars:
 *   PG_DSN             — PostgreSQL connection string
 *   PANDASCORE_TOKEN   — PandaScore API token
 *   MAX_TIME_SECONDS   — Max execution time (default: 840 = 14 min)
 *   CURRENT_YEAR       — Override year filter (default: current year)
 */

import { execSync, spawn } from 'child_process';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logIngestionFailure, markFailuresResolved } from './lib/digestFailures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── .env loader (for local runs) ──────────────────────────────────────────
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

// ─── Config ────────────────────────────────────────────────────────────────
const PG_DSN = process.env.PG_DSN;
const TOKEN = process.env.PANDASCORE_TOKEN;

if (!PG_DSN) { console.error('ERROR: PG_DSN not set'); process.exit(1); }
if (!TOKEN) { console.error('ERROR: PANDASCORE_TOKEN not set'); process.exit(1); }

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(`--${name}`);

const MAX_TIME_MS = (Number(getArg('max-time') || process.env.MAX_TIME_SECONDS || 840)) * 1000;
const MAX_LEAGUES = Number(getArg('max-leagues') || 10);
const STATIC_FIRST = hasFlag('static-first');
const CURRENT_YEAR = Number(getArg('year') || process.env.CURRENT_YEAR || new Date().getFullYear());
const SKIP_TIMELINE = hasFlag('skip-timeline');

const SCRIPT_PATH = path.join(__dirname, 'fetch-to-postgres.js');

// ─── Logging ───────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[${ts()}] ${msg}`);
const err = (msg) => console.error(`[${ts()}] ERROR: ${msg}`);

// ─── DB Pool ───────────────────────────────────────────────────────────────
function createPool() {
  const poolConfig = { connectionString: PG_DSN, max: 2, connectionTimeoutMillis: 5000 };
  if (PG_DSN.includes('rds.amazonaws.com')) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  return new pg.Pool(poolConfig);
}

// ─── Ensure tables & migrations exist ─────────────────────────────────────
async function ensureStateTable(pool) {
  const sqlPath = path.join(__dirname, 'sql', 'ingestion_state.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');
  await pool.query(sql);

  // Also apply match ingestion tracking migration
  const migrationPath = path.join(__dirname, 'sql', 'match_ingestion_tracking.sql');
  if (fs.existsSync(migrationPath)) {
    const migSql = fs.readFileSync(migrationPath, 'utf-8');
    await pool.query(migSql);
  }

  // digest_runs + ingestion_failures (usados por daily-digest.js y este orquestador)
  const digestPath = path.join(__dirname, 'sql', 'digest_runs.sql');
  if (fs.existsSync(digestPath)) {
    const digSql = fs.readFileSync(digestPath, 'utf-8');
    await pool.query(digSql);
  }

  log('ingestion_state + match tracking + digest tables ready');
}

// ─── Pick next leagues to process ──────────────────────────────────────────
async function pickLeagues(pool, limit) {
  // Priority-weighted staleness: higher priority leagues get picked sooner
  // A priority-3 league is "3x more stale" than a priority-1 league
  // Exclude leagues currently running (stuck > 30 min are reset to idle)
  await pool.query(`
    UPDATE ingestion_state
    SET status = 'idle', last_error = 'timeout (auto-reset)'
    WHERE status = 'running'
      AND last_started < NOW() - INTERVAL '30 minutes'
  `);

  // Auto-retry: leagues in 'error' status are retried after a backoff period
  // based on consecutive failures (retry_count). Backoff: 5min, 15min, 30min, 1h, 2h
  await pool.query(`
    UPDATE ingestion_state
    SET status = 'idle'
    WHERE status = 'error'
      AND last_started < NOW() - (
        INTERVAL '5 minutes' * POWER(2, LEAST(COALESCE(retry_count, 0), 5))
      )
  `);

  const { rows } = await pool.query(`
    SELECT league_slug, league_id, priority, last_completed
    FROM ingestion_state
    WHERE status != 'running'
      AND priority > 0
    ORDER BY
      last_completed ASC NULLS FIRST,
      priority DESC
    LIMIT $1
  `, [limit]);

  return rows;
}

// ─── Run ingestion for a single league ─────────────────────────────────────
function runIngest(league, year, extraFlags = []) {
  return new Promise((resolve, reject) => {
    const cmdArgs = [
      SCRIPT_PATH,
      '--league', league,
      '--year', String(year),
      '--skip-static',  // static data only needs to run once per cycle
      ...extraFlags,
    ];

    log(`  Starting: node ${cmdArgs.join(' ')}`);

    const child = spawn('node', cmdArgs, {
      env: { ...process.env, PG_DSN, PANDASCORE_TOKEN: TOKEN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        // Extract request count from stdout
        const match = stdout.match(/API requests:\s*(\d+)/);
        const apiCalls = match ? Number(match[1]) : 0;
        resolve({ success: true, apiCalls, stdout, stderr });
      } else {
        resolve({ success: false, apiCalls: 0, stdout, stderr, code });
      }
    });

    child.on('error', (e) => {
      resolve({ success: false, apiCalls: 0, stderr: e.message, code: -1 });
    });
  });
}

// ─── Run static data (champions, items, runes, spells) ─────────────────────
async function runStaticData() {
  log('Running static data ingestion (champions, items, runes, spells)...');
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT_PATH, '--static-only'], {
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
      resolve({ success: code === 0, apiCalls, stdout, stderr });
    });
    child.on('error', (e) => resolve({ success: false, apiCalls: 0, stderr: e.message }));
  });
}

// ─── Update state ──────────────────────────────────────────────────────────
async function markStarted(pool, league) {
  await pool.query(
    `UPDATE ingestion_state SET status = 'running', last_started = NOW() WHERE league_slug = $1`,
    [league]
  );
}

async function markCompleted(pool, league, apiCalls) {
  await pool.query(
    `UPDATE ingestion_state
     SET status = 'idle', last_completed = NOW(), last_error = NULL,
         api_calls_used = $2, retry_count = 0
     WHERE league_slug = $1`,
    [league, apiCalls]
  );
  // Mark all finished matches for this league as ingested
  // (the full league sweep processes all finished matches)
  await pool.query(
    `UPDATE matches
     SET games_ingested_at = COALESCE(games_ingested_at, NOW())
     WHERE league_id = (SELECT league_id FROM ingestion_state WHERE league_slug = $1)
       AND status = 'finished'
       AND games_ingested_at IS NULL
       AND id IN (SELECT DISTINCT match_id FROM games)`,
    [league]
  );
  // Si en runs anteriores hubo fallos para esta liga, los marcamos resueltos
  await markFailuresResolved(pool, { league_slug: league });
}

async function markError(pool, league, error, leagueId) {
  await pool.query(
    `UPDATE ingestion_state
     SET status = 'error', last_error = $2,
         retry_count = COALESCE(retry_count, 0) + 1
     WHERE league_slug = $1`,
    [league, error.slice(0, 500)]
  );
  await logIngestionFailure(pool, {
    source: 'auto-ingest',
    league_slug: league,
    league_id: leagueId || null,
    stage: 'fetch-to-postgres',
    message: error,
  });
}

// ─── Main orchestrator ─────────────────────────────────────────────────────
async function orchestrate() {
  const startTime = Date.now();
  const deadline = startTime + MAX_TIME_MS;
  const pool = createPool();
  let totalApiCalls = 0;
  let leaguesProcessed = 0;

  try {
    await ensureStateTable(pool);

    // Static data: run once per day (check last completion)
    if (STATIC_FIRST) {
      const res = await runStaticData();
      totalApiCalls += res.apiCalls;
      log(`  Static data: ${res.success ? 'OK' : 'FAILED'} (${res.apiCalls} API calls)`);
      if (!res.success) err(res.stderr.slice(0, 200));
    }

    // Pick leagues to process
    const leagues = await pickLeagues(pool, MAX_LEAGUES);

    if (leagues.length === 0) {
      log('No leagues need updating');
      return { processed: 0, apiCalls: 0 };
    }

    log(`Selected ${leagues.length} leagues: ${leagues.map(l => l.league_slug).join(', ')}`);

    for (const league of leagues) {
      // Check if we're approaching the deadline (leave 60s buffer)
      const timeLeft = deadline - Date.now();
      if (timeLeft < 60_000) {
        log(`Time limit approaching (${Math.round(timeLeft / 1000)}s left), stopping`);
        break;
      }

      log(`\n▶ Processing ${league.league_slug} (priority ${league.priority})`);
      await markStarted(pool, league.league_slug);

      const extraFlags = SKIP_TIMELINE ? ['--skip-timeline'] : [];
      const result = await runIngest(league.league_slug, CURRENT_YEAR, extraFlags);

      if (result.success) {
        await markCompleted(pool, league.league_slug, result.apiCalls);
        log(`  ✓ ${league.league_slug}: OK (${result.apiCalls} API calls)`);
      } else {
        const errorMsg = result.stderr?.slice(0, 500) || `Exit code ${result.code}`;
        await markError(pool, league.league_slug, errorMsg, league.league_id);
        err(`  ✗ ${league.league_slug}: FAILED — ${errorMsg.slice(0, 100)}`);
      }

      totalApiCalls += result.apiCalls;
      leaguesProcessed++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\nâ•â•â• Done: ${leaguesProcessed} leagues, ${totalApiCalls} API calls, ${elapsed}s â•â•â•`);

    return { processed: leaguesProcessed, apiCalls: totalApiCalls, elapsed };
  } finally {
    await pool.end();
  }
}

// ─── Lambda handler ────────────────────────────────────────────────────────
export async function handler(event, context) {
  // Lambda: adjust max time based on remaining context time
  if (context?.getRemainingTimeInMillis) {
    const remaining = context.getRemainingTimeInMillis();
    // Leave 30s buffer for cleanup
    process.env.MAX_TIME_SECONDS = String(Math.floor((remaining - 30_000) / 1000));
  }

  try {
    const result = await orchestrate();
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error('Lambda handler error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
}

// ─── CLI entry point ───────────────────────────────────────────────────────
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
if (!isLambda) {
  orchestrate().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
