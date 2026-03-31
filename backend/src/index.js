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
import path from 'path';
import { fileURLToPath } from 'url';

// ── Environment validation ────────────────────────────────────────────────────
// Must run before any other import that reads process.env
const REQUIRED_ENV = ['PANDASCORE_TOKEN'];
const MISSING_ENV = REQUIRED_ENV.filter(k => !process.env[k]);
if (MISSING_ENV.length > 0) {
  console.error('');
  console.error('[FATAL] Missing required environment variables:');
  MISSING_ENV.forEach(k => console.error(`  ✗  ${k}`));
  console.error('');
  console.error('  Create a .env file in backend/ with:');
  MISSING_ENV.forEach(k => console.error(`  ${k}=your_value_here`));
  console.error('');
  process.exit(1);
}

// Optional — warn if PANDASCORE_PLAN is not set (defaults to Tier 2 behaviour)
if (!process.env.PANDASCORE_PLAN) {
  console.warn('[WARN] PANDASCORE_PLAN not set — timeline frames will be unavailable (Tier 2 mode).');
}

import config from './config/index.js';
import routes from './routes/index.js';
import { log } from './utils/logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
// Cache desactivada — datos servidos por PostgreSQL, no necesita pre-calentar ni persistir
// import { startCacheWarmer } from './services/cacheWarmer.js';
// import { saveToDisk } from './services/cache.js';

// Placeholder para WebSocket (futuro)
let io = null;

/**
 * Crear aplicación Express
 */
function createApp() {
  const app = express();

  // ── Security headers (helmet + CSP) ────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
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

  // ── CORS — restricted to allowed origins, GET-only ──────────────────────
  const allowedOrigins = [
    config.frontendUrl,                                // dev: http://localhost:5173
    ...(config.isProd() ? [process.env.PROD_URL].filter(Boolean) : []),
  ];
  app.use(cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin) return cb(null, true);
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

  // Filter endpoints — change rarely
  app.use('/api/v1/pg/filters', cacheStatic);
  // Home overview — moderate freshness
  app.use('/api/v1/pg/home', cacheMedium);
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

  // ── Static file serving (production) ──────────────────────────────────────
  if (config.isProd()) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.resolve(__dirname, '../../frontend/dist');

    // Hashed assets (JS, CSS) — cache 1 year (immutable, filename changes on rebuild)
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));

    // Other static files (index.html, logos, etc.) — cache 1 hour
    app.use(express.static(distPath, { maxAge: '1h' }));

    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

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
