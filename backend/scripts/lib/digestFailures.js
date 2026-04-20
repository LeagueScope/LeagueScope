/**
 * digestFailures.js — Helper para escribir fallos estructurados en
 * ingestion_failures desde cualquier punto del pipeline (auto-ingest,
 * match-poller, fetch-to-postgres).
 *
 * Diseño: NO lanza nunca — un fallo al registrar un fallo no puede romper
 * el pipeline. Todos los errores del propio helper se silencian con un
 * console.warn para no añadir ruido.
 */

/**
 * Intenta clasificar un mensaje de error en un error_type estable que el
 * correo pueda agrupar.
 */
export function classifyError(message = '') {
  const m = String(message).toLowerCase();
  if (m.includes('429')) return 'http_429';
  if (m.includes('502') || m.includes('503') || m.includes('504')) return 'http_5xx';
  if (m.includes('http 4')) return 'http_4xx';
  if (m.includes('timeout') || m.includes('etimedout')) return 'timeout';
  if (m.includes('econnreset') || m.includes('econnrefused') || m.includes('enotfound')) return 'network';
  if (m.includes('constraint') || m.includes('violates') || m.includes('duplicate key')) return 'pg_constraint';
  if (m.includes('json') || m.includes('parse')) return 'parse_error';
  if (m.includes('exit code')) return 'subprocess_failed';
  return 'unknown';
}

/**
 * Registra un fallo de ingesta. Silent-fail por diseño.
 *
 * @param {pg.Pool|pg.Client} pool - conexión Postgres ya abierta
 * @param {object} ctx - contexto del fallo (todos los campos son opcionales)
 * @param {'auto-ingest'|'match-poller'|'fetch-to-postgres'|'other'} ctx.source
 * @param {string} [ctx.league_slug]
 * @param {number} [ctx.league_id]
 * @param {number} [ctx.match_id]
 * @param {string} [ctx.stage]
 * @param {string} [ctx.error_type]
 * @param {string} ctx.message
 * @param {string} [ctx.stack]
 */
export async function logIngestionFailure(pool, ctx) {
  if (!pool) return;
  const source = ctx?.source || 'other';
  const message = String(ctx?.message || '').slice(0, 2000);
  if (!message) return;
  const error_type = ctx?.error_type || classifyError(message);
  const stack = ctx?.stack ? String(ctx.stack).split('\n').slice(0, 20).join('\n').slice(0, 2000) : null;
  try {
    await pool.query(
      `INSERT INTO ingestion_failures
         (source, league_slug, league_id, match_id, stage, error_type, message, stack)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        source,
        ctx?.league_slug || null,
        ctx?.league_id || null,
        ctx?.match_id || null,
        ctx?.stage || null,
        error_type,
        message,
        stack,
      ],
    );
  } catch (e) {
    // No romper el pipeline si la tabla no existe todavía (primer deploy).
    console.warn(`[digestFailures] no pudo registrar fallo: ${e.message}`);
  }
}

/**
 * Marca fallos como resueltos cuando un match se ingesta con éxito.
 * Llamar tras un markCompleted / tras un ingestSingleMatch exitoso.
 */
export async function markFailuresResolved(pool, { league_slug, match_id } = {}) {
  if (!pool) return;
  try {
    if (match_id) {
      await pool.query(
        `UPDATE ingestion_failures
         SET resolved_at = NOW()
         WHERE match_id = $1 AND resolved_at IS NULL`,
        [match_id],
      );
    } else if (league_slug) {
      await pool.query(
        `UPDATE ingestion_failures
         SET resolved_at = NOW()
         WHERE league_slug = $1 AND resolved_at IS NULL
           AND source = 'auto-ingest'`,
        [league_slug],
      );
    }
  } catch (e) {
    console.warn(`[digestFailures] no pudo marcar resuelto: ${e.message}`);
  }
}
