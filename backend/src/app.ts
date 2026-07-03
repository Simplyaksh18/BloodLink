import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger.middleware';
import { globalRateLimiter } from './middleware/rateLimiter.middleware';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';
import routes from './routes';
import { startEligibilityUpdateJob } from './jobs/eligibilityUpdate.job';
import { startRequestExpiryJob } from './jobs/requestExpiry.job';
import fs from 'fs';

// Ensure temp upload dir exists
const uploadDir = '/tmp/bloodlink-uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();

// ── Security middleware ───────────────────────────────────────────────────────

// Helmet — set secure HTTP headers. crossOriginResourcePolicy open for mobile S3 assets.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
console.log('[Security] helmet enabled');

const corsOrigins = env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map(o => o.trim());
app.use(
  cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Admin-Import'],
    exposedHeaders: ['X-Correlation-ID'],
    credentials: true,
  })
);
console.log('[Security] CORS allowed origins:', env.CORS_ORIGIN);

// Compression — gzip level 6, skip small responses and SSE streams
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));
console.log('[Perf] compression enabled (gzip level 6, threshold 1 KB)');

// Body parsing — 1mb cap; uploads go through S3 presigned URLs, not the API body.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
console.log('[Security] body size limit: 1mb');

// Logging
app.use(requestLogger);

// Rate limiting
app.use(globalRateLimiter);

// Trust proxy (for rate limiting behind load balancer)
app.set('trust proxy', 1);

// API routes at /v1 to match frontend base URL
app.use(`/${env.API_VERSION}`, routes);

// 404 and error handling
app.use(notFoundMiddleware);
app.use(errorMiddleware);

if (env.NODE_ENV !== 'test') {
  startEligibilityUpdateJob();  // Phase 5: DEFERRED → PENDING_REVIEW when cooldown expires
  startRequestExpiryJob();      // Phase 4.3: ACTIVE/IN_PROGRESS → EXPIRED when expiresAt passes
}

export default app;
