import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { sanitizeBody, sanitizeHeaders } from '../utils/piiSanitizer';
import { env } from '../config/env';

console.log('[Security] PII log sanitizer enabled');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? uuidv4();
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      // Truncate user-agent — no PII but can be long
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 200) || undefined,
      ip: req.ip,
    });

    // Debug-only body logging: sanitize ALL sensitive fields before writing.
    // Never enabled in production (LOG_LEVEL is 'info' or 'warn' there).
    if (env.LOG_LEVEL === 'debug' && req.body && Object.keys(req.body).length > 0) {
      logger.debug('request body', {
        correlationId,
        sanitizedBody: sanitizeBody(req.body),
        sanitizedHeaders: sanitizeHeaders(req.headers as Record<string, unknown>),
      });
    }
  });

  next();
}
