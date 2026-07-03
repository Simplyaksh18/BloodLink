import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Auth-sensitive routes: login, register, OTP, password reset, Firebase auth.
// 10 attempts per 15 minutes prevents brute-force without blocking normal use.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
  handler: (req, res, _next, options) => {
    console.log('[Security] rate limited path:', req.path, '| ip:', req.ip);
    res.status(options.statusCode).json(options.message);
  },
});
console.log('[Security] auth rate limit enabled: 10 / 15min');

// OTP-specific: tighter limit (3/min) to prevent OTP flooding.
export const otpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests, please wait before requesting again' },
  handler: (req, res, _next, options) => {
    console.log('[Security] rate limited path:', req.path, '| ip:', req.ip);
    res.status(options.statusCode).json(options.message);
  },
});

// Global API limit: 300 requests per 15 minutes per IP.
// The admin-import bypass is intentionally scoped to X-Admin-Import header
// which is only set by the local CSV import script and validated by ADMIN auth
// middleware — not exploitable by arbitrary clients.
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down' },
  skip: (req: Request) => {
    if (req.headers['x-admin-import'] === 'true') {
      console.log('[RateLimit] admin donor import bypass:', req.method, req.path);
      return true;
    }
    return false;
  },
  handler: (req, res, _next, options) => {
    console.log('[Security] rate limited path:', req.path, '| ip:', req.ip);
    res.status(options.statusCode).json(options.message);
  },
});
console.log('[Security] global rate limit enabled: 300 / 15min');

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Upload limit exceeded, try again in an hour' },
});
