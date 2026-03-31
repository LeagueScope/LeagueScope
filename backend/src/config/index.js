/**
 * Configuración centralizada del backend
 * Lee variables de entorno y proporciona valores por defecto
 */

import 'dotenv/config';

const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // PandaScore API
  pandascore: {
    token: process.env.PANDASCORE_TOKEN || '',
    baseUrl: 'https://api.pandascore.co',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Live Data (futuro)
  liveUpdateInterval: parseInt(process.env.LIVE_UPDATE_INTERVAL, 10) || 30000,

  // Default values
  defaults: {
    league: process.env.DEFAULT_LEAGUE || 'LEC',
    year: parseInt(process.env.DEFAULT_YEAR, 10) || 2026,
  },

  // Helpers
  isDev: () => config.nodeEnv === 'development',
  isProd: () => config.nodeEnv === 'production',
  isTest: () => config.nodeEnv === 'test',
};

export default config;

