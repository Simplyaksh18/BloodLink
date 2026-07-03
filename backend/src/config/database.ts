import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
          ]
        : [{ emit: 'event', level: 'error' }],
  });

if (process.env.NODE_ENV === 'development') {
  (prisma as any).$on('query', (e: { query: string; duration: number }) => {
    if (e.duration > 1000) {
      logger.warn('Slow query detected', { query: e.query, durationMs: e.duration });
    }
  });
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await prisma.$connect();
      logger.info('Database connected successfully');
      return;
    } catch (error) {
      attempt++;
      logger.error(`Database connection attempt ${attempt}/${maxRetries} failed`, { error });
      if (attempt === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}
