import { Request, Response } from 'express';
import { checkEligibility, getEligibilityStatus, getDocumentStatus } from '../services/eligibility.service';
import { submitHealthScreening } from '../services/healthScreening.service';
import { healthScreeningSchema, setReminderSchema } from '../utils/validators';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

export const donorEligibilityController = {
  // POST /v1/donors/health-screening
  async submitHealthScreening(req: Request, res: Response): Promise<void> {
    console.log('[Backend] POST /donors/health-screening HIT', JSON.stringify(req.body));
    try {
      const parsed = healthScreeningSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          data: { errors: parsed.error.flatten().fieldErrors },
          message: 'Validation failed. Please review the highlighted fields.',
        });
        return;
      }

      const userId = req.user!.userId;
      const { screening, eligibility } = await submitHealthScreening(userId, parsed.data);

      res.status(200).json({
        success: true,
        data: {
          screeningPassed: screening.screeningPassed,
          disqualifyingFactors: screening.disqualifyingFactors
            ? JSON.parse(screening.disqualifyingFactors)
            : [],
          screeningDate: screening.screeningDate,
          eligibility: {
            eligible: eligibility.eligible,
            reasons: eligibility.reasons,
            nextEligibleDate: eligibility.nextEligibleDate?.toISOString() ?? null,
            eligibilityExpiry: eligibility.eligibilityExpiry?.toISOString() ?? null,
          },
        },
        message: screening.screeningPassed
          ? eligibility.eligible
            ? 'Health screening passed. You are now eligible to donate blood!'
            : 'Health screening submitted. Please review the eligibility requirements.'
          : 'Health screening indicates you are currently ineligible to donate blood.',
      });
    } catch (err) {
      logger.error('Health screening submission failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'An unexpected error occurred.' });
    }
  },

  // GET /v1/donors/eligibility
  async getEligibilityStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const status = await getEligibilityStatus(userId);

      res.status(200).json({
        success: true,
        data: status,
        message: status.eligible
          ? 'You are currently eligible to donate blood.'
          : 'You are not currently eligible to donate blood.',
      });
    } catch (err) {
      logger.error('Get eligibility status failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'An unexpected error occurred.' });
    }
  },

  // PUT /v1/donors/become-donor
  async becomeDonor(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const eligibility = await checkEligibility(userId);

      if (!eligibility.eligible) {
        res.status(403).json({
          success: false,
          data: {
            reasons: eligibility.reasons,
            nextEligibleDate: eligibility.nextEligibleDate?.toISOString() ?? null,
            needsMedicalScreening: eligibility.needsMedicalScreening ?? false,
            needsHealthScreening:  eligibility.needsHealthScreening  ?? false,
          },
          message: 'You do not meet the eligibility requirements to become a blood donor.',
        });
        return;
      }

      const expiry = eligibility.eligibilityExpiry!;
      await prisma.user.update({
        where: { id: userId },
        data: {
          isDonor:               true,
          willingToDonate:       true,
          isDonorEligible:       true,
          donorEligibleSince:    new Date(),
          donorEligibilityExpiry: expiry,
          donorVerificationStatus: 'ELIGIBLE',
          // Phase 5: sync stateful donor status
          donorStatus:           'ACTIVE',
          deferralDate:          null,
          deferralReason:        null,
          nextEligibleDate:      null,
          eligibilityCheckedAt:  new Date(),
        },
      });

      res.status(200).json({
        success: true,
        data: {
          isDonorEligible:       true,
          donorEligibleSince:    new Date().toISOString(),
          donorEligibilityExpiry: expiry.toISOString(),
          warnings: eligibility.reasons,
        },
        message: 'You are now registered as an eligible blood donor!',
      });
    } catch (err) {
      logger.error('Become donor failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'An unexpected error occurred.' });
    }
  },

  // GET /v1/donors/document-status
  async getDocumentStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const status = await getDocumentStatus(userId);

      res.status(200).json({
        success: true,
        data: status,
        message: status.canProceed
          ? 'All required documents are verified.'
          : `Missing documents: ${status.needsDocuments.join(', ')}`,
      });
    } catch (err) {
      logger.error('Get document status failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'An unexpected error occurred.' });
    }
  },

  // POST /v1/donors/set-reminder
  async setReminder(req: Request, res: Response): Promise<void> {
    try {
      const parsed = setReminderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          data: { errors: parsed.error.flatten().fieldErrors },
          message: 'Invalid reminder date.',
        });
        return;
      }

      const reminderDate = new Date(parsed.data.reminderDate);
      if (reminderDate <= new Date()) {
        res.status(400).json({
          success: false,
          data: {},
          message: 'Reminder date must be in the future.',
        });
        return;
      }

      await prisma.notification.create({
        data: {
          userId: req.user!.userId,
          title: 'Blood Donation Reminder',
          body: `Reminder: Check your blood donation eligibility on ${reminderDate.toLocaleDateString('en-IN')} (${reminderDate.toISOString()}).`,
          notificationType: 'REMINDER',
        },
      });

      res.status(200).json({
        success: true,
        data: { reminderDate: reminderDate.toISOString() },
        message: `Reminder set for ${reminderDate.toLocaleDateString('en-IN')}.`,
      });
    } catch (err) {
      logger.error('Set reminder failed', { err });
      res.status(500).json({ success: false, data: {}, message: 'An unexpected error occurred.' });
    }
  },
};
