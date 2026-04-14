import { randomUUID } from 'node:crypto';

/**
 * Correlation ID middleware.
 *
 * - If the incoming request already carries an `X-Request-ID` header
 *   (e.g. injected by an upstream load balancer / CDN), reuse it.
 * - Otherwise generate a fresh UUID v4.
 * - Attaches the id to `req.id` so other middlewares / handlers can include it
 *   in logs, error reports, and external API calls.
 * - Echoes the id back in the response header so clients can correlate
 *   their network traces with server logs.
 */
export function requestId(req, res, next) {
  const incoming = req.get('X-Request-ID');
  const id = (typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128)
    ? incoming
    : randomUUID();

  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

export default requestId;
