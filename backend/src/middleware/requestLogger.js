/**
 * Middleware de logging de requests
 */

import { log } from '../utils/logger.js';

export function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    log.request(req, res, duration);
  });
  
  next();
}

export default requestLogger;
