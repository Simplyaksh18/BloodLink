import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import {
  getDonorStatus,
  computeDonorStatus,
  setDonorReminder,
  cancelDonorReminder,
} from '../services/donorStatus.service';
import { checkEligibility } from '../services/eligibility.service';

export const donorStatusController = {

  // GET /v1/donor/status
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      const data = await getDonorStatus(userId);
      res.json({
        success: true,
        data,
        message: data.isEligible
          ? 'You are an active blood donor.'
          : data.donorStatus === 'DEFERRED'
            ? `You can donate again in ${data.daysRemaining ?? '?'} days.`
            : data.donorStatus === 'INELIGIBLE'
              ? 'You are not eligible to donate blood at this time.'
              : data.donorStatus === 'PENDING_REVIEW'
                ? 'All checks passed. Tap Register to become a donor.'
                : 'Complete the registration process to become a donor.',
      });
    } catch (err) {
      logger.error('getDonorStatus failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'Failed to retrieve donor status.' });
    }
  },

  // POST /v1/donor/register
  async register(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;

      // Force fresh eligibility check
      const elig = await checkEligibility(userId);

      if (!elig.eligible) {
        // Save deferred/ineligible status and return it
        const data = await computeDonorStatus(userId);
        res.status(403).json({
          success: false,
          data,
          message: elig.reasons[0] ?? 'You do not meet eligibility requirements.',
        });
        return;
      }

      // Eligible — register as donor
      const expiry = elig.eligibilityExpiry!;
      await prisma.user.update({
        where: { id: userId },
        data: {
          isDonor:               true,
          willingToDonate:       true,
          isDonorEligible:       true,
          donorEligibleSince:    new Date(),
          donorEligibilityExpiry: expiry,
          donorVerificationStatus: 'ELIGIBLE',
          donorStatus:           'ACTIVE',
          deferralDate:          null,
          deferralReason:        null,
          nextEligibleDate:      null,
          eligibilityCheckedAt:  new Date(),
        },
      });

      const data = await computeDonorStatus(userId);
      res.json({
        success: true,
        data,
        message: 'You are now registered as an eligible blood donor!',
      });
    } catch (err) {
      logger.error('donor register failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'Registration failed. Please try again.' });
    }
  },

  // POST /v1/donor/set-reminder
  async setReminder(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      await setDonorReminder(userId);
      res.json({ success: true, data: { reminderSet: true }, message: 'Reminder set successfully.' });
    } catch (err) {
      logger.error('setDonorReminder failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'Failed to set reminder.' });
    }
  },

  // DELETE /v1/donor/reminder
  async cancelReminder(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      await cancelDonorReminder(userId);
      res.json({ success: true, data: { reminderSet: false }, message: 'Reminder cancelled.' });
    } catch (err) {
      logger.error('cancelDonorReminder failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'Failed to cancel reminder.' });
    }
  },

  // POST /v1/donor/dev-reset  (DEV ONLY — resets full donor test state for current user)
  async devReset(req: Request, res: Response): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({ success: false, message: 'Not available in production.' });
      return;
    }
    try {
      const userId = req.user!.userId;
      console.log('[DevReset] clearing donor fields for userId:', userId);
      await prisma.user.update({
        where: { id: userId },
        data: {
          donorStatus:             'NEVER_DONATED',
          deferralReason:          null,
          deferralDate:            null,
          nextEligibleDate:        null,
          eligibilityCheckedAt:    null,
          isDonorEligible:         false,
          isDonor:                 false,
          willingToDonate:         false,
          donorEligibleSince:      null,
          donorEligibilityExpiry:  null,
          reminderSet:             false,
          totalDonations:          0,
          lastDonationDate:        null,
        },
      });

      console.log('[DevReset] deleting health screening for userId:', userId);
      await prisma.healthScreening.deleteMany({ where: { userId } });

      console.log('[DevReset] clearing donor caches for userId:', userId);
      // (no Redis layer in this project — eligibilityCheckedAt=null above is the cache key)

      res.json({
        success: true,
        userId,
        reset: { donorFields: true, healthScreening: true, caches: true },
        message: 'Donor state fully reset. You are now a fresh NEVER_DONATED user.',
      });
    } catch (err) {
      logger.error('devReset failed', { err });
      res.status(500).json({ success: false, message: 'Reset failed.' });
    }
  },

  // PUT /v1/donor/reactivate
  async reactivate(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      // Force a fresh eligibility check regardless of cache age
      const data = await computeDonorStatus(userId);
      res.json({
        success: true,
        data,
        message: data.isEligible
          ? 'Great news! You are now eligible to donate.'
          : data.donorStatus === 'DEFERRED'
            ? `Still deferred — eligible in ${data.daysRemaining ?? '?'} days.`
            : 'Eligibility status updated.',
      });
    } catch (err) {
      logger.error('reactivate failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'Failed to re-check eligibility.' });
    }
  },
};
