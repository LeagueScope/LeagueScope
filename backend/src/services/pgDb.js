/**
 * pgDb.js
 * PostgreSQL connection pool for LeagueScope.
 * Uses the `pg` package (node-postgres).
 *
 * Connection is configured via PG_DSN env var or defaults to localhost.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const PG_DSN = process.env.PG_DSN;
if (!PG_DSN) {
  console.error('[pgDb] ERROR: PG_DSN env variable is not set. Add it to your .env file.');
  process.exit(1);
}

// RDS requires SSL — detect by hostname
const useSSL = PG_DSN.includes('rds.amazonaws.com');

const poolConfig = {
  connectionString: PG_DSN,
  max: 10,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

if (useSSL) {
  // Verificar el certificado del servidor contra el bundle de CA de AWS RDS.
  // Sin esto, la conexión va cifrada pero es vulnerable a MITM.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const caPath = path.join(__dirname, '..', '..', 'certs', 'eu-west-3-bundle.pem');
  try {
    const ca = fs.readFileSync(caPath, 'utf8');
    poolConfig.ssl = { rejectUnauthorized: true, ca };
    console.log('[pgDb] SSL enabled with verified RDS CA bundle');
  } catch {
    console.warn(`[pgDb] WARN: RDS CA bundle not found at ${caPath} — falling back to unverified SSL`);
    poolConfig.ssl = { rejectUnauthorized: false };
  }
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[pgDb] Unexpected pool error:', err.message);
});

// Graceful shutdown
const shutdown = () => { pool.end().catch(() => {}); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/**
 * Run a single query. Returns { rows, rowCount }.
 * Usage: const { rows } = await query('SELECT * FROM games WHERE id = $1', [275077]);
 */
export async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Get a client from the pool (for transactions or multi-query).
 * Remember to call client.release() when done.
 */
export async function getClient() {
  return pool.connect();
}

export default { query, getClient, pool };
