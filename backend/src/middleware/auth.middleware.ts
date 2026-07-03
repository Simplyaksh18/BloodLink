import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UnauthorizedError, ForbiddenError } from '../utils/ApiError';
import { JwtPayload } from '../types';
import { redis } from '../config/redis';
import { TOKEN_BLACKLIST_PREFIX } from '../utils/constants';
import { prisma } from '../config/database';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authorization token required');
    }

    const token = authHeader.slice(7);

    const isBlacklisted = await redis.exists(`${TOKEN_BLACKLIST_PREFIX}${token}`);
    if (isBlacklisted) {
      throw new UnauthorizedError('Token has been revoked');
    }

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    // tokenVersion check — invalidates tokens issued before a password reset
    if (payload.tokenVersion !== undefined) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true, isActive: true, isDeleted: true },
      });
      if (!user || user.isDeleted || !user.isActive) {
        throw new UnauthorizedError('Account not found or deactivated');
      }
      if (user.tokenVersion > payload.tokenVersion) {
        throw new UnauthorizedError('Token invalidated. Please log in again.');
      }
    }

    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

// Populates req.user when a valid Bearer token is present; silently continues
// otherwise. For hybrid public/owner routes (e.g. GET /blood-banks/:id) where
// the ownership branch of the handler needs to know the caller if authenticated
// but the route itself is not gated.
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  try {
    const token = authHeader.slice(7);
    const isBlacklisted = await redis.exists(`${TOKEN_BLACKLIST_PREFIX}${token}`);
    if (isBlacklisted) return next();
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (payload.tokenVersion !== undefined) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true, isActive: true, isDeleted: true },
      });
      if (!user || user.isDeleted || !user.isActive) return next();
      if (user.tokenVersion > payload.tokenVersion) return next();
    }
    req.user = payload;
    next();
  } catch {
    // Malformed/expired token on an optional route — proceed as anonymous.
    next();
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }
    next();
  };
}
