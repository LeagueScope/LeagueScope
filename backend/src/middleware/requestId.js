import { randomUUID } from 'node:crypto';

/**
 * Correlation ID middleware.
 *
 * - If the incoming request already carries an `X-Request-ID` header
 *   (e.g. injected by an upstream load balancer / CDN), reuse it
 *   ONLY if it matches a strict whitelist (alphanumerics + _.-).
 * - Otherwise generate a fresh UUID v4.
 * - Attaches the id to `req.id` so other middlewares / handlers can include it
 *   in logs, error reports, and external API calls.
 * - Echoes the id back in the response header so clients can correlate
 *   their network traces with server logs.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function requestId(req, res, next) {
  const incoming = req.get('X-Request-ID');
  const id = (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming))
    ? incoming
    : randomUUID();

  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

export default requestId;
