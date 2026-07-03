import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
    });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
    redisClient.on('close', () => logger.warn('Redis connection closed'));
  }
  return redisClient;
}

export async function connectRedis(): Promise<void> {
  try {
    const client = getRedisClient();
    await client.connect();
    const hasAuth = env.REDIS_URL.includes('@');
    logger.info(`[Redis] auth mode: ${hasAuth ? 'authenticated' : 'no-auth'}`);
    const pong = await client.ping();
    logger.info(`[Redis] ping success: ${pong === 'PONG'}`);
  } catch (error) {
    logger.warn('Redis unavailable, continuing without cache', { error });
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export const redis = {
  get: async (key: string): Promise<string | null> => {
    try {
      return await getRedisClient().get(key);
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string, ttlSeconds?: number): Promise<void> => {
    try {
      if (ttlSeconds) {
        await getRedisClient().setex(key, ttlSeconds, value);
      } else {
        await getRedisClient().set(key, value);
      }
    } catch {
      /* non-fatal */
    }
  },
  del: async (key: string): Promise<void> => {
    try {
      await getRedisClient().del(key);
    } catch {
      /* non-fatal */
    }
  },
  exists: async (key: string): Promise<boolean> => {
    try {
      return (await getRedisClient().exists(key)) === 1;
    } catch {
      return false;
    }
  },
};
