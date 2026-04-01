import { log } from '../utils/logger.js';
import config from '../config/index.js';

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

export function notFoundHandler(req, res, next) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, next) {
  log.error('Error', {
    message: err.message,
    stack: err.stack,
    path: req.path
  });
  
  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message, operational: true, stack: err.stack?.split('\n').slice(0, 3) });
  }
  
  // Temporarily show ALL error details to debug rewrite issue
  return res.status(500).json({ error: err.message, type: err.constructor.name, stack: err.stack?.split('\n').slice(0, 3) });
}

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
