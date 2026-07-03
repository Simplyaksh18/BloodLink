import { prisma } from '../config/database';
import { logger } from '../config/logger';

const JOB_INTERVAL_MS = 60 * 60 * 1000; // every hour

/**
 * Automatically promotes DEFERRED users to ACTIVE when their nextEligibleDate passes.
 * Also sends reminder notifications as the eligibility date approaches.
 */
async function runEligibilityUpdateJob(): Promise<void> {
  const now = new Date();

  try {
    // Find DEFERRED users whose nextEligibleDate has passed
    const nowEligible = await prisma.user.findMany({
      where: {
        donorStatus:     'DEFERRED',
        nextEligibleDate: { lte: now },
      },
      select: { id: true, name: true },
    });

    for (const user of nowEligible) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          donorStatus:          'PENDING_REVIEW',
          nextEligibleDate:     null,
          deferralDate:         null,
          deferralReason:       null,
          eligibilityCheckedAt: now,
          reminderSet:          false,
        },
      });
      await prisma.notification.create({
        data: {
          userId:           user.id,
          title:            "You're eligible to donate again!",
          body:             'Your deferral period has ended. Open BloodLink to complete your donor registration.',
          notificationType: 'SYSTEM',
        },
      });
      logger.info(`Eligibility job: promoted user ${user.id} to PENDING_REVIEW`);
    }

    // 7-day advance reminder
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 86_400_000);
    const soonUsers = await prisma.user.findMany({
      where: {
        donorStatus:     'DEFERRED',
        reminderSet:     true,
        nextEligibleDate: { gte: now, lte: sevenDaysFromNow },
      },
      select: { id: true, nextEligibleDate: true },
    });

    for (const user of soonUsers) {
      const days = user.nextEligibleDate
        ? Math.ceil((user.nextEligibleDate.getTime() - now.getTime()) / 86_400_000)
        : null;

      if (days !== null && days <= 7 && days >= 1) {
        await prisma.notification.create({
          data: {
            userId:           user.id,
            title:            `${days} day${days === 1 ? '' : 's'} until you can donate!`,
            body:             `You'll be eligible to donate blood in ${days} day${days === 1 ? '' : 's'}. Get ready!`,
            notificationType: 'REMINDER',
          },
        });
      }
    }

    if (nowEligible.length > 0 || soonUsers.length > 0) {
      logger.info(`Eligibility job: updated ${nowEligible.length} users, reminded ${soonUsers.length}`);
    }
  } catch (err) {
    logger.error('Eligibility update job error', { err });
  }
}

export function startEligibilityUpdateJob(): void {
  // Run immediately on startup, then on every interval
  runEligibilityUpdateJob();
  setInterval(runEligibilityUpdateJob, JOB_INTERVAL_MS);
  logger.info('Eligibility update job started (hourly)');
}
