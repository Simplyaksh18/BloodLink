import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { logger } from '../config/logger';
import { env } from '../config/env';

export function errorMiddleware(err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.headers['x-correlation-id'] as string;

  // Body-parser payload-too-large (1mb limit)
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({ success: false, message: 'Request body too large. Maximum size is 1mb.' });
    return;
  }

  if (err instanceof ApiError && err.isOperational) {
    logger.warn('Operational error', {
      message: err.message,
      statusCode: err.statusCode,
      path: req.path,
      correlationId,
    });

    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors ?? undefined,
    });
    return;
  }

  logger.error('Unexpected error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    correlationId,
  });

  res.status(500).json({
    success: false,
    message: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
