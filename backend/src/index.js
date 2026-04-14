/**
 * LeagueScope Backend
 * Entry point
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import http from 'http';
// path and fileURLToPath removed — no longer serving static files

// Env validation is performed inside ./config/index.js at import time.
// Importing config first ensures the process crashes with a clear message
// before any other module tries to read process.env.
import config from './config/index.js';
import routes from './routes/index.js';
import { log } from './utils/logger.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';


// Placeholder para WebSocket (futuro)
let io = null;

/**
 * Crear aplicación Express
 */
function createApp() {
  const app = express();

  // ── Correlation ID — first, so every subsequent log/error carries it ────────
  app.use(requestId);

  // ── Security headers (helmet + CSP) ────────────────────────────────────────
  // NOTE: the backend serves only JSON API responses (no HTML). The CSP here
  // is defence-in-depth against a hypothetical future regression where an
  // endpoint leaks HTML. 'unsafe-inline' has been removed from styleSrc
  // because the backend never renders pages.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "https://fonts.googleapis.com"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com"],
        imgSrc:     ["'self'", "data:", "https://cdn.pandascore.co", "https://raw.githubusercontent.com", "https://flagcdn.com"],
        connectSrc: ["'self'", config.frontendUrl || "http://localhost:5173"],
        objectSrc:  ["'none'"],
        frameSrc:   ["'none'"],
        baseUri:    ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // ── Gzip/Brotli compression ─────────────────────────────────────────────────
  app.use(compression({ level: 6, threshold: 1024 }));

  // ── CORS ─────────────────────────────────────────────────────────────
  const allowedOrigins = [
    config.frontendUrl,
    ...(config.isProd() ? [process.env.PROD_URL].filter(Boolean) : []),
  ];
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);              // server-to-server (no origin)
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: true,
  }));

  // ── Rate limiting — global baseline ────────────────────────────────────
  app.use('/api/', rateLimit({
    windowMs: config.rateLimit.windowMs,      // default 60s
    max: config.rateLimit.maxRequests,         // default 100 req/window
    standardHeaders: true,                     // RateLimit-* headers (draft-6)
    legacyHeaders: false,                      // disable X-RateLimit-* headers
    message: { error: 'Too many requests, please try again later.' },
  }));

  // ── Rate limiting — stricter for heavy endpoints ───────────────────────
  const heavyLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,                                  // 30 req/min for expensive queries
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests to this endpoint, please slow down.' },
  });
  app.use('/api/v1/pg/search', heavyLimiter);
  app.use('/api/v1/pg/matches/:id/detail', heavyLimiter);
  app.use('/api/v1/pg/player-history', heavyLimiter);
  app.use('/api/v1/pg/team-history', heavyLimiter);
  app.use('/api/v1/pg/champion-history', heavyLimiter);
  app.use('/api/v1/pg/headtohead', heavyLimiter);

  // ── Body parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '10kb' }));

  // Request logging
  if (config.isDev()) {
    app.use(requestLogger);
  }

  // ── API Cache-Control headers ───────────────────────────────────────────
  // Static/slow-changing data: cache aggressively
  const cacheStatic = (req, res, next) => {
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600'); // 24h + 1h stale
    next();
  };
  const cacheMedium = (req, res, next) => {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60'); // 5min + 1min stale
    next();
  };
  const cacheShort = (req, res, next) => {
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=30'); // 2min + 30s stale
    next();
  };

  // Realtime endpoints — never cache (live match polling relies on this)
  const cacheNone = (req, res, next) => {
    res.set('Cache-Control', 'no-store, must-revalidate');
    next();
  };

  // Filter endpoints — change rarely
  app.use('/api/v1/pg/filters', cacheStatic);
  // Home overview — realtime (fingerprint-driven refresh)
  app.use('/api/v1/pg/home', cacheNone);
  app.use('/api/v1/pg/live-status', cacheNone);
  // Search — moderate freshness
  app.use('/api/v1/pg/search', cacheMedium);
  // Data endpoints — short cache
  app.use('/api/v1/pg/overview', cacheShort);
  app.use('/api/v1/pg/teams', cacheShort);
  app.use('/api/v1/pg/players', cacheShort);
  app.use('/api/v1/pg/champions', cacheShort);
  app.use('/api/v1/pg/matches', cacheShort);
  app.use('/api/v1/pg/standings', cacheShort);

  // Routes
  app.use('/api', routes);

  // Health check raíz
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Static file serving removed — frontend is deployed on AWS Amplify

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Iniciar servidor
 */
async function startServer() {
  try {
    // Cache warmer desactivado — PG sirve datos directamente
    // startCacheWarmer();

    // Crear app
    const app = createApp();
    const httpServer = http.createServer(app);

    // Placeholder WebSocket (futuro)
    // io = new Server(httpServer, { cors: { origin: config.frontendUrl } });

    // Iniciar servidor
    httpServer.listen(config.port, () => {
      log.info(`LeagueScope Backend started on http://localhost:${config.port} [${config.nodeEnv}]`);
      log.info(`Source: PostgreSQL | Frontend: ${config.frontendUrl}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      log.info(`${signal} received, shutting down...`);
      // await saveToDisk();  // Cache desactivada — PostgreSQL sirve todos los datos

      httpServer.close(async () => {
        process.exit(0);
      });

      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return httpServer;

  } catch (error) {
    log.fatal('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

// Placeholder para live data updates (futuro)
function setupLiveUpdates() {
  // setInterval(updateLiveData, config.liveUpdateInterval);
}

// Iniciar
startServer();

export { createApp, startServer };
