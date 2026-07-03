import { Verification, User, VerificationType, Prisma } from '@prisma/client';
import { verificationRepository } from '../repositories/verification.repository';
import {
  FRAUD_SCORE_THRESHOLD,
  RAPID_RESUBMIT_WINDOW_MINUTES,
  RAPID_RESUBMIT_MAX_COUNT,
} from '../types/verification.types';
import { logger } from '../config/logger';

export interface FraudRule {
  name: string;
  score: number;
  triggered: boolean;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface FraudAssessment {
  totalScore: number;
  rules: FraudRule[];
  requiresPriorityReview: boolean;
}

export async function assessFraud(
  v: Verification,
  user: User,
  autoFraudIndicators: string[]
): Promise<FraudAssessment> {
  const rules: FraudRule[] = [];

  // Rule 1: Auto-check fraud indicators from automated checks
  for (const indicator of autoFraudIndicators) {
    if (indicator === 'DUPLICATE_DOCUMENT') {
      rules.push({ name: 'DUPLICATE_DOCUMENT', score: 50, triggered: true, description: 'Same document submitted by another user', metadata: { s3Key: v.s3Key ?? '' } });
    } else if (indicator === 'INVALID_FILE_TYPE') {
      rules.push({ name: 'INVALID_FILE_TYPE', score: 20, triggered: true, description: 'File MIME type is not allowed', metadata: { fileType: v.fileType ?? '' } });
    } else if (indicator === 'STALE_CERTIFICATE') {
      rules.push({ name: 'STALE_CERTIFICATE', score: 15, triggered: true, description: 'Certificate is older than allowed validity period' });
    } else if (indicator === 'EXPIRED_MEDICAL_SCREENING') {
      rules.push({ name: 'EXPIRED_MEDICAL_SCREENING', score: 25, triggered: true, description: 'Medical screening is older than 6 months' });
    } else if (indicator === 'EXPIRED_LICENSE') {
      rules.push({ name: 'EXPIRED_LICENSE', score: 30, triggered: true, description: 'License expiry date has passed' });
    } else if (indicator === 'ROLE_MISMATCH') {
      rules.push({ name: 'ROLE_MISMATCH', score: 20, triggered: true, description: 'User role does not match required role for this document type' });
    }
  }

  // Rule 2: Rapid resubmission check
  try {
    const recentRejections = await verificationRepository.findRecentRejections(
      v.userId,
      v.verificationType,
      RAPID_RESUBMIT_WINDOW_MINUTES
    );
    if (recentRejections >= RAPID_RESUBMIT_MAX_COUNT) {
      rules.push({
        name: 'RAPID_RESUBMISSION',
        score: 30,
        triggered: true,
        description: `${recentRejections} rejections in ${RAPID_RESUBMIT_WINDOW_MINUTES} minutes`,
        metadata: { count: recentRejections, windowMinutes: RAPID_RESUBMIT_WINDOW_MINUTES },
      });
    }
  } catch (err) {
    logger.warn('Rapid resubmission check failed', { err });
  }

  // Rule 3: High resubmission count overall
  if (v.resubmissionCount >= 5) {
    rules.push({
      name: 'HIGH_RESUBMISSION_COUNT',
      score: 20,
      triggered: true,
      description: `Document resubmitted ${v.resubmissionCount} times`,
      metadata: { count: v.resubmissionCount },
    });
  }

  // Rule 4: Blood group consistency (BLOOD_GROUP_PROOF only)
  if (v.verificationType === VerificationType.BLOOD_GROUP_PROOF && !user.bloodGroup) {
    rules.push({
      name: 'MISSING_BLOOD_GROUP_PROFILE',
      score: 10,
      triggered: true,
      description: 'User submitted blood group proof but has no blood group in profile',
    });
  }

  const totalScore = rules.reduce((sum, r) => sum + r.score, 0);
  const requiresPriorityReview = totalScore >= FRAUD_SCORE_THRESHOLD;

  return { totalScore: Math.min(totalScore, 100), rules, requiresPriorityReview };
}

export async function persistFraudAlerts(
  v: Verification,
  assessment: FraudAssessment
): Promise<void> {
  for (const rule of assessment.rules) {
    if (!rule.triggered) continue;
    try {
      await verificationRepository.createFraudAlert({
        verification: { connect: { id: v.id } },
        user: { connect: { id: v.userId } },
        alertType: rule.name,
        severity: rule.score,
        description: rule.description,
        metadata: (rule.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      });
    } catch (err) {
      logger.error('Failed to persist fraud alert', { rule: rule.name, err });
    }
  }
}
