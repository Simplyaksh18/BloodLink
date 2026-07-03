import { expireOldRequests } from '../services/request.service';
import { logger } from '../config/logger';

const JOB_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

async function runExpiryJob(): Promise<void> {
  try {
    const count = await expireOldRequests();
    if (count > 0) {
      logger.info(`Request expiry job: expired ${count} request(s)`);
    }
  } catch (err) {
    logger.error('Request expiry job error', { err });
  }
}

export function startRequestExpiryJob(): void {
  runExpiryJob(); // run immediately on startup to catch any already-expired rows
  setInterval(runExpiryJob, JOB_INTERVAL_MS);
  logger.info('Request expiry job started (5-minute interval)');
}
