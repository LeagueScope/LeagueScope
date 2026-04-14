import 'dotenv/config';

// ── Environment validation ──────────────────────────────────────────────────
// Runs at module import time, before any other code reads process.env.
// Crashes with a clear, coloured message if required vars are missing or malformed.

const REQUIRED_ENV = ['PANDASCORE_TOKEN', 'PG_DSN'];

function fatal(lines) {
  // eslint-disable-next-line no-console
  console.error('');
  for (const line of lines) console.error(line);
  console.error('');
  process.exit(1);
}

const missing = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missing.length > 0) {
  fatal([
    '[FATAL] Missing required environment variables:',
    ...missing.map(k => `  ✗  ${k}`),
    '',
    '  Define them in backend/.env (dev) or in the service environment (prod).',
  ]);
}

// Format checks — catch classic mistakes early so we fail at boot, not at runtime.
const pgDsn = process.env.PG_DSN.trim();
if (!/^postgres(ql)?:\/\//i.test(pgDsn)) {
  fatal([
    '[FATAL] PG_DSN is malformed.',
    `  got: ${pgDsn.slice(0, 40)}${pgDsn.length > 40 ? '…' : ''}`,
    '  expected: postgres://user:pass@host:port/db  or  postgresql://…',
  ]);
}

const rawPort = process.env.PORT;
if (rawPort !== undefined && !/^\d+$/.test(rawPort)) {
  fatal([
    '[FATAL] PORT must be a positive integer.',
    `  got: "${rawPort}"`,
  ]);
}

// Soft warnings — not fatal, but worth flagging so the operator knows.
if (!process.env.FRONTEND_URL) {
  // eslint-disable-next-line no-console
  console.warn('[WARN] FRONTEND_URL not set — CORS will only allow http://localhost:5173.');
}
if (!process.env.PANDASCORE_PLAN) {
  // eslint-disable-next-line no-console
  console.warn('[WARN] PANDASCORE_PLAN not set — timeline frames unavailable (Tier 2 mode).');
}

// ── Config object ───────────────────────────────────────────────────────────

const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  pandascore: {
    token: process.env.PANDASCORE_TOKEN,
    baseUrl: 'https://api.pandascore.co',
  },

  pg: {
    dsn: pgDsn,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  liveUpdateInterval: parseInt(process.env.LIVE_UPDATE_INTERVAL, 10) || 30000,

  defaults: {
    league: process.env.DEFAULT_LEAGUE || 'LEC',
    year: parseInt(process.env.DEFAULT_YEAR, 10) || 2026,
  },

  isDev: () => config.nodeEnv === 'development',
  isProd: () => config.nodeEnv === 'production',
  isTest: () => config.nodeEnv === 'test',
};

export default config;
