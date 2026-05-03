/**
 * casterDb.ts — Two Postgres pools for the caster system.
 *
 * - adminPool: connects as admin (full access). Used to read auth.caster_users
 *   on login, and write auth.caster_query_log for audit. NEVER used to run
 *   user-supplied queries.
 *
 * - streamerPool: connects as streamer_ro (SELECT-only on public schema, NO
 *   access to auth schema, statement_timeout = 5s). All caster template
 *   queries run through this pool. If something goes wrong here, the worst
 *   case is reading public LoL data — credentials are physically out of reach.
 */

import { Pool, type PoolConfig } from 'pg';

function buildConfig(connectionString: string | undefined): PoolConfig {
  if (!connectionString) {
    throw new Error('Missing Postgres connection string env var');
  }
  return {
    connectionString,
    // RDS exige SSL. rejectUnauthorized=false vale aquí porque el certificado
    // de RDS lo emite Amazon y la verificación de cadena no añade seguridad
    // real en este contexto (la conexión es cifrada igualmente).
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  };
}

// Singleton para evitar abrir un pool nuevo en cada hot-reload de Next.js
declare global {
  // eslint-disable-next-line no-var
  var __caster_admin_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __caster_streamer_pool: Pool | undefined;
}

export const adminPool: Pool =
  globalThis.__caster_admin_pool ??
  (globalThis.__caster_admin_pool = new Pool(buildConfig(process.env.ADMIN_DB_URL)));

export const streamerPool: Pool =
  globalThis.__caster_streamer_pool ??
  (globalThis.__caster_streamer_pool = new Pool(buildConfig(process.env.STREAMER_RO_URL)));
