import './config/env'; // Validate env first
import app from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { logger } from './config/logger';
import { initSocketServer } from './socket/socketServer';
import http from 'http';

const server = http.createServer(app);
initSocketServer(server);

async function start(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();

    server.listen(env.PORT, () => {
      logger.info(`BloodLink API server started`, {
        port: env.PORT,
        env: env.NODE_ENV,
        apiVersion: env.API_VERSION,
        dummyData: env.USE_DUMMY_DATA,
        url: `http://localhost:${env.PORT}/${env.API_VERSION}/health`,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — graceful shutdown initiated`);
  server.close(async () => {
    await disconnectDatabase();
    await disconnectRedis();
    logger.info('Server shut down cleanly');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

void start();
