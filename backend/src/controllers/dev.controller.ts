import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { logger } from '../config/logger';
import { findMatchingDonors } from '../services/donorMatching.service';
import { setDevForceActive, clearDevForceActive } from '../services/donorStatus.service';

const PROD_GUARD = (res: Response): boolean => {
  if (process.env.NODE_ENV === 'production' && process.env.USE_DUMMY_DATA !== 'true') {
    res.status(403).json({ success: false, message: 'Not available in production.' });
    return true;
  }
  return false;
};

export const devController = {

  // POST /v1/dev/donor/force-active
  // Forces the current user into ACTIVE + eligible donor state without health screening.
  // Only clears eligibility-gate fields (nextEligibleDate, deferral). Does NOT touch
  // totalDonations or lastDonationDate — donation history must remain intact.
  async forceActiveDonor(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const userId = req.user!.userId;

      const before = await prisma.user.findUnique({
        where: { id: userId },
        select: { totalDonations: true, lastDonationDate: true, donorStatus: true, isDonorEligible: true, isDonor: true },
      });
      console.log('[DevQAForceActive] before:', `donorStatus=${before?.donorStatus} isDonorEligible=${before?.isDonorEligible} isDonor=${before?.isDonor} totalDonations=${before?.totalDonations ?? 0}`);

      // QA override: null lastDonationDate so the DB-side cooldown guard in
      // donorStatus.service can no longer re-DEFER this user after a backend
      // restart clears the in-memory _devForceActiveIds Set. totalDonations
      // (aggregate history) is preserved. Production users never hit this
      // path — this controller is guarded by PROD_GUARD above.
      await prisma.user.update({
        where: { id: userId },
        data: {
          donorStatus:          'ACTIVE',
          isDonorEligible:      true,
          willingToDonate:      true,
          isDonor:              true,
          lastDonationDate:     null,    // DEV-ONLY: clear DB cooldown trigger
          nextEligibleDate:     null,    // clear cooldown gate
          deferralReason:       null,
          deferralDate:         null,
          eligibilityCheckedAt: new Date(), // mark cache fresh so re-check doesn't revert
          // totalDonations intentionally NOT modified — donation history preserved
        },
      });

      // Register in the in-memory bypass set (defence-in-depth within the same process).
      setDevForceActive(userId);

      console.log('[DevQAForceActive] override: cleared lastDonationDate to bypass cooldown guard (DEV-ONLY).');
      console.log('[DevQAForceActive] previousLastDonationDate:', before?.lastDonationDate?.toISOString() ?? 'null');
      console.log('[DevQAForceActive] after:', `donorStatus=ACTIVE isDonorEligible=true isDonor=true totalDonations=${before?.totalDonations ?? 0}`);
      console.log('[DevQAForceActive] totalDonationsPreserved:', before?.totalDonations ?? 0);
      logger.info('[DevQA] force-active-donor', { userId });
      res.json({ success: true, message: 'User forced to ACTIVE donor state. Donation history preserved.' });
    } catch (err) {
      logger.error('[DevQA] forceActiveDonor failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },

  // POST /v1/dev/donor/defer
  // Simulates an alcohol deferral (24-hour deferral window).
  async deferDonor(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const userId = req.user!.userId;
      const deferUntil = new Date(Date.now() + 24 * 3_600_000); // 24h
      await prisma.user.update({
        where: { id: userId },
        data: {
          donorStatus:     'DEFERRED',
          isDonorEligible: false,
          nextEligibleDate: deferUntil,
        },
      });
      logger.info('[DevQA] defer-donor', { userId, until: deferUntil });
      res.json({
        success: true,
        message: `Donor deferred 24 h. Eligible again at ${deferUntil.toISOString()}.`,
        deferredUntil: deferUntil.toISOString(),
      });
    } catch (err) {
      logger.error('[DevQA] deferDonor failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },

  // POST /v1/dev/verification/mark-verified
  // Upserts all 3 verification document types as VERIFIED for the current user.
  async markAllVerified(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const userId = req.user!.userId;
      const types = ['ID_PROOF', 'BLOOD_GROUP_PROOF', 'MEDICAL_SCREENING'] as const;

      await Promise.all(
        types.map((verificationType) =>
          prisma.verification.upsert({
            where: { userId_verificationType: { userId, verificationType } } as any,
            update: {
              status:          'VERIFIED',
              autoCheckPassed: true,
              reviewedAt:      new Date(),
              reviewNotes:     'Dev QA forced verification',
            },
            create: {
              userId,
              verificationType,
              status:          'VERIFIED',
              fileName:        'dev-verified.jpg',
              s3Key:           `${userId}/${verificationType}/dev-verified.jpg`,
              autoCheckPassed: true,
              reviewedAt:      new Date(),
              reviewNotes:     'Dev QA forced verification',
              uploadedAt:      new Date(),
            } as any,
          })
        )
      );

      // Update User-level flag columns (required by promotion checks)
      await prisma.user.update({
        where: { id: userId },
        data: { idVerified: true, bloodGroupVerified: true, medicalVerified: true },
      });

      // Auto-promote: same logic as runVerificationPipeline
      const freshUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { nextEligibleDate: true },
      });
      const hasActiveDeferral = !!freshUser?.nextEligibleDate && freshUser.nextEligibleDate > new Date();
      if (!hasActiveDeferral) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            donorStatus:             'ACTIVE',
            isDonor:                 true,
            isDonorEligible:         true,
            donorVerificationStatus: 'ELIGIBLE',
            eligibilityCheckedAt:    new Date(),
          },
        });
        logger.info('[DevQA] mark-all-verified: promoted to ACTIVE', { userId });
      } else {
        logger.info('[DevQA] mark-all-verified: deferred — no promotion', { userId });
      }

      logger.info('[DevQA] mark-all-verified', { userId });
      res.json({ success: true, message: 'All verification documents marked as VERIFIED.' });
    } catch (err) {
      logger.error('[DevQA] markAllVerified failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },

  // POST /v1/dev/verification/reset
  // Deletes all verification rows for the current user (returns to NOT_SUBMITTED state).
  async resetVerification(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const userId = req.user!.userId;
      const { count } = await prisma.verification.deleteMany({ where: { userId } });
      logger.info('[DevQA] reset-verification', { userId, deleted: count });
      res.json({ success: true, message: `Deleted ${count} verification record(s). Status reset to NOT_SUBMITTED.` });
    } catch (err) {
      logger.error('[DevQA] resetVerification failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },

  // POST /v1/dev/requests/:id/expire
  // Directly expires a request by ID regardless of current status.
  async expireRequest(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const { id } = req.params;
      const request = await prisma.bloodRequest.findUnique({ where: { id } });
      if (!request) {
        res.status(404).json({ success: false, message: 'Request not found.' });
        return;
      }
      await prisma.bloodRequest.update({ where: { id }, data: { status: 'EXPIRED' } });
      logger.info('[DevQA] expire-request', { requestId: id });
      res.json({ success: true, message: `Request ${id} set to EXPIRED.` });
    } catch (err) {
      logger.error('[DevQA] expireRequest failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },

  // POST /v1/dev/donor/clear-force-active
  // Removes the in-memory dev override so the cooldown guard resumes normally.
  // Call this after testing to restore realistic eligibility behaviour.
  async clearForceActiveDonor(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const userId = req.user!.userId;
      clearDevForceActive(userId);
      console.log('[DevQA] clear-force-active — cooldown guard restored for userId:', userId);
      logger.info('[DevQA] clear-force-active', { userId });
      res.json({ success: true, message: 'Dev force-active override cleared. Cooldown guard is active again.' });
    } catch (err) {
      logger.error('[DevQA] clearForceActiveDonor failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },

  // POST /v1/dev/requests/:id/notify-matches
  // Retriggers REQUEST_MATCHED notifications for an existing request.
  // Safe to call multiple times — already-notified donors are skipped.
  async devNotifyMatches(req: Request, res: Response): Promise<void> {
    if (PROD_GUARD(res)) return;
    try {
      const { id: requestId } = req.params;
      const userId   = req.user!.userId;
      const userRole = req.user!.role;

      const request = await prisma.bloodRequest.findUnique({
        where: { id: requestId },
        select: { requesterId: true, status: true },
      });
      if (!request) {
        res.status(404).json({ success: false, message: 'Request not found.' });
        return;
      }

      const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
      if (request.requesterId !== userId && !isAdmin) {
        res.status(403).json({ success: false, message: 'Forbidden: requester or admin only.' });
        return;
      }

      if (request.status !== 'OPEN' && request.status !== 'ACTIVE') {
        res.status(400).json({
          success: false,
          message: `Request must be OPEN or ACTIVE (got ${request.status}).`,
        });
        return;
      }

      console.log(`[DevNotifyMatches] requestId: ${requestId}`);
      const result = await findMatchingDonors(requestId);

      logger.info('[DevQA] dev-notify-matches', {
        requestId,
        matchedCount: result.matchedCount,
        notifiedCount: result.notifiedDonorIds.length,
      });

      res.json({
        success: true,
        data: {
          requestId,
          matchedCount: result.matchedCount,
          notifiedCount: result.notifiedDonorIds.length,
          notifiedDonorIds: result.notifiedDonorIds,
        },
        message: 'Matched donor notifications triggered',
      });
    } catch (err) {
      logger.error('[DevQA] devNotifyMatches failed', { err });
      res.status(500).json({ success: false, message: 'Failed.' });
    }
  },
};
