/**
 * Middleware de manejo de errores
 */

import { log } from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Clase de error de API
 */
export class ApiError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
  
  static badRequest(message) {
    return new ApiError(message, 400);
  }
  
  static notFound(resource = 'Resource') {
    return new ApiError(`${resource} not found`, 404);
  }
  
  static internal(message = 'Internal server error') {
    return new ApiError(message, 500);
  }
}

/**
 * Middleware para rutas no encontradas
 */
export function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'Not found' });
}

/**
 * Middleware de manejo de errores
 */
export function errorHandler(err, req, res, next) {
  log.error('Error', { 
    message: err.message, 
    stack: config.isDev() ? err.stack : undefined,
    path: req.path 
  });
  
  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  
  const message = config.isDev() ? err.message : 'Internal server error';
  return res.status(500).json({ error: message });
}

/**
 * Wrapper para controladores async
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default {
  ApiError,
  notFoundHandler,
  errorHandler,
  asyncHandler,
};
