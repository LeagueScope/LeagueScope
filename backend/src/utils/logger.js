import pino from 'pino';
import config from '../config/index.js';

const logger = pino({
  level: config.logging.level,
  transport: config.isDev() ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    }
  } : undefined,
});

// Wrapper con métodos convenientes
export const log = {
  info: (msg, data = {}) => logger.info(data, msg),
  error: (msg, data = {}) => logger.error(data, msg),
  warn: (msg, data = {}) => logger.warn(data, msg),
  debug: (msg, data = {}) => logger.debug(data, msg),
  fatal: (msg, data = {}) => logger.fatal(data, msg),

  // HTTP request logging (used by requestLogger middleware).
  // Includes the correlation id (req.id) if the requestId middleware ran.
  request: (req, res, duration) => {
    logger.info({
      reqId: req.id,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
    }, 'HTTP Request');
  },
};


export default logger;
