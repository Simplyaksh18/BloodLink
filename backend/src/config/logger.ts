import winston from 'winston';
import { env } from './env';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, correlationId, ...meta }) => {
  const id = correlationId ? ` [${correlationId}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts}${id} [${level}]: ${message}${metaStr}`;
});

const transports: winston.transport[] = [
  new winston.transports.Console({
    format:
      env.NODE_ENV === 'production'
        ? combine(timestamp(), errors({ stack: true }), json())
        : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), devFormat),
  }),
];

if (env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  );
}

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports,
  exitOnError: false,
});
