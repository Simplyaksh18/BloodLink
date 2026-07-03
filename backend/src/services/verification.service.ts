import { VerificationType, VerificationStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { verificationRepository } from '../repositories/verification.repository';
import { runAutomatedChecks } from './automatedChecks.service';
import { assessFraud, persistFraudAlerts } from './fraudDetection.service';
import { generatePresignedUploadUrl, generatePresignedViewUrl, buildS3Key, archiveDocument } from './aws.service';
import { createAndSendNotification } from './notification.service';
import { syncDonorEligibilityFromDocuments } from './donorStatus.service';
import {
  ApiVerification,
  ApiVerificationStatus,
  ApiVerificationQueueItem,
  ApiFraudAlert,
  PresignedUploadResult,
  RejectionDetail,
  UPLOAD_RATE_LIMIT_PER_HOUR,
  FRAUD_SCORE_THRESHOLD,
  CONFIDENCE_APPROVE_THRESHOLD,
} from '../types/verification.types';
import { BadRequestError, NotFoundError, ForbiddenError } from '../utils/ApiError';
import { logger } from '../config/logger';

// ─── Mappers ────────────────────────────────────────────────────────────────

function mapVerification(v: {
  id: string; userId: string; verificationType: VerificationType; status: VerificationStatus;
  fileName: string | null; fileType: string | null; fileSize: number | null; uploadedAt: Date | null;
  autoCheckPassed: boolean | null; autoCheckResults?: Prisma.JsonValue | null; fraudScore: number;
  reviewedAt: Date | null; reviewNotes: string | null; rejectionReason: string | null;
  expiresAt: Date | null; isExpired: boolean; resubmissionCount: number;
  createdAt: Date; updatedAt: Date; s3Key?: string | null;
}, documentUrl?: string): ApiVerification {
  let rejectionDetails: RejectionDetail[] | undefined;
  let canResubmit: boolean | undefined;

  if (v.status === VerificationStatus.REJECTED) {
    // autoCheckResults can be either:
    //   - Legacy: AutoCheckResult[]  (array)
    //   - New:    { checks: AutoCheckResult[], confidence: ConfidenceBreakdown }
    let checkArray: any[] = [];
    if (Array.isArray(v.autoCheckResults)) {
      checkArray = v.autoCheckResults as any[];
    } else if (v.autoCheckResults && typeof v.autoCheckResults === 'object') {
      const r = v.autoCheckResults as any;
      checkArray = Array.isArray(r.checks) ? r.checks : [];
    }

    // Combine failed metadata checks with consistency/quality issues from confidence
    const failedChecks = checkArray.filter((r: any) => r && r.passed === false);
    const confidenceIssues: Array<{ check: string; message: string; suggestion: string }> = [];

    if (v.autoCheckResults && typeof v.autoCheckResults === 'object' && !Array.isArray(v.autoCheckResults)) {
      const r = v.autoCheckResults as any;
      const conf = r.confidence;
      if (conf) {
        const allIssues = [
          ...(conf.documentQuality?.issues ?? []),
          ...(conf.dataConsistency?.issues ?? []),
          ...(conf.securityChecks?.issues ?? []),
        ];
        for (const msg of allIssues) {
          confidenceIssues.push({ check: 'document_analysis', message: msg, suggestion: 'Please upload a clearer, authentic document.' });
        }
      }
    }

    const allDetails = [
      ...failedChecks.map((r: any) => ({
        check: r.checkName ?? 'unknown',
        message: r.message ?? 'Check failed',
        suggestion: r.suggestion ?? 'Please review and resubmit your document.',
      })),
      ...confidenceIssues,
    ];

    if (allDetails.length > 0) {
      rejectionDetails = allDetails;
      canResubmit = true;
    } else if (v.rejectionReason) {
      rejectionDetails = [{ check: 'automated_check', message: v.rejectionReason, suggestion: 'Please submit a genuine, original document.' }];
      canResubmit = true;
    }
  }

  return {
    id: v.id,
    userId: v.userId,
    verificationType: v.verificationType,
    status: v.status,
    fileName: v.fileName ?? undefined,
    fileType: v.fileType ?? undefined,
    fileSize: v.fileSize ?? undefined,
    uploadedAt: v.uploadedAt?.toISOString(),
    autoCheckPassed: v.autoCheckPassed ?? undefined,
    fraudScore: v.fraudScore,
    reviewedAt: v.reviewedAt?.toISOString(),
    reviewNotes: v.reviewNotes ?? undefined,
    rejectionReason: v.rejectionReason ?? undefined,
    expiresAt: v.expiresAt?.toISOString(),
    isExpired: v.isExpired,
    resubmissionCount: v.resubmissionCount,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    documentUrl,
    rejectionDetails,
    canResubmit,
  };
}

function mapFraudAlert(a: {
  id: string; verificationId: string; userId: string; alertType: string; severity: number;
  description: string; metadata: Prisma.JsonValue; isResolved: boolean;
  resolvedBy: string | null; resolvedAt: Date | null; createdAt: Date;
}): ApiFraudAlert {
  return {
    id: a.id,
    verificationId: a.verificationId,
    userId: a.userId,
    alertType: a.alertType,
    severity: a.severity,
    description: a.description,
    metadata: a.metadata as Record<string, unknown> | undefined,
    isResolved: a.isResolved,
    resolvedBy: a.resolvedBy ?? undefined,
    resolvedAt: a.resolvedAt?.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

// ─── User flag helper ────────────────────────────────────────────────────────

async function updateUserVerificationFlags(
  verificationType: VerificationType,
  userId: string,
  verified: boolean
): Promise<void> {
  const flagUpdate: Record<string, boolean> = {};
  if (verificationType === VerificationType.ID_PROOF) flagUpdate.idVerified = verified;
  if (verificationType === VerificationType.BLOOD_GROUP_PROOF) flagUpdate.bloodGroupVerified = verified;
  if (verificationType === VerificationType.MEDICAL_SCREENING) flagUpdate.medicalVerified = verified;
  if (Object.keys(flagUpdate).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: flagUpdate });
  }
}

// ─── Synchronous verification pipeline ──────────────────────────────────────
// Runs automated checks + fraud detection, persists final VERIFIED or REJECTED
// status, and returns the result immediately (no async queue).

async function runVerificationPipeline(
  documentId: string,
  userId: string,
  verificationType: VerificationType,
): Promise<ApiVerification> {
  const verification = await verificationRepository.findById(documentId);
  if (!verification) throw new NotFoundError('Verification record not found');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');

  const checks = await runAutomatedChecks(verification, user);
  const fraudAssessment = await assessFraud(verification, user, checks.fraudIndicators);
  await persistFraudAlerts(verification, fraudAssessment);

  const fraudScore = Math.min(fraudAssessment.totalScore, 100);
  const { confidenceBreakdown } = checks;
  const confidenceOk = confidenceBreakdown.totalConfidence >= CONFIDENCE_APPROVE_THRESHOLD;

  // Enriched results: store both raw check results AND the confidence breakdown
  const enrichedResults = {
    checks: checks.results,
    confidence: confidenceBreakdown,
  };

  const pass = checks.passed && confidenceOk && fraudScore < FRAUD_SCORE_THRESHOLD;

  if (pass) {
    const verified = await verificationRepository.update(documentId, {
      status: VerificationStatus.VERIFIED,
      autoCheckPassed: true,
      autoCheckResults: enrichedResults as unknown as Prisma.InputJsonValue,
      fraudScore,
      fraudFlags: Prisma.DbNull,
      rejectionReason: null,
    });

    await updateUserVerificationFlags(verificationType, userId, true);

    // If all 3 required docs are now VERIFIED, promote donorStatus (respects cooldown/deferral).
    await syncDonorEligibilityFromDocuments(userId);

    await createAndSendNotification({
      userId,
      title: 'Document Verified!',
      body: `Your ${verificationType.replace(/_/g, ' ').toLowerCase()} has been verified successfully.`,
      notificationType: 'VERIFICATION',
    });

    return mapVerification(verified);
  } else {
    // Build a precise rejection reason from all sources
    const failedCheckMessages = checks.results.filter(r => !r.passed).map(r => r.message);
    const confidenceMessages   = !confidenceOk
      ? [
          ...confidenceBreakdown.documentQuality.issues,
          ...confidenceBreakdown.dataConsistency.issues,
          ...confidenceBreakdown.securityChecks.issues,
        ].filter(Boolean)
      : [];
    const fraudMessages = fraudScore >= FRAUD_SCORE_THRESHOLD
      ? fraudAssessment.rules.filter(r => r.triggered).map(r => r.description)
      : [];

    const rejectionReason =
      [...failedCheckMessages, ...confidenceMessages, ...fraudMessages].join('; ')
      || 'Document did not pass automated verification';

    const rejected = await verificationRepository.update(documentId, {
      status: VerificationStatus.REJECTED,
      autoCheckPassed: false,
      autoCheckResults: enrichedResults as unknown as Prisma.InputJsonValue,
      fraudScore,
      fraudFlags: (checks.fraudIndicators.length > 0 ? checks.fraudIndicators : null) as unknown as Prisma.InputJsonValue,
      rejectionReason,
    });

    await updateUserVerificationFlags(verificationType, userId, false);

    await createAndSendNotification({
      userId,
      title: 'Document Not Accepted',
      body: 'Your document was not accepted. Please review the reasons and resubmit.',
      notificationType: 'VERIFICATION',
    });

    return mapVerification(rejected);
  }
}

// ─── Upload initiation ───────────────────────────────────────────────────────

export async function initiateUpload(
  userId: string,
  documentType: VerificationType,
  fileName: string,
  fileType: string,
  fileSize?: number
): Promise<PresignedUploadResult> {
  const recentCount = await verificationRepository.countRecentUploads(userId, 60);
  if (recentCount >= UPLOAD_RATE_LIMIT_PER_HOUR) {
    throw new BadRequestError('Upload rate limit exceeded. Please try again later.');
  }

  const s3Key = buildS3Key(userId, documentType, fileName);
  const uploadUrl = await generatePresignedUploadUrl(s3Key, fileType);

  const existing = await verificationRepository.findByUserAndType(userId, documentType);
  let verification;

  if (existing && existing.status === VerificationStatus.NOT_SUBMITTED) {
    verification = await verificationRepository.update(existing.id, { s3Key, fileName, fileType, fileSize: fileSize ?? null });
  } else {
    verification = await verificationRepository.create({
      user: { connect: { id: userId } },
      verificationType: documentType,
      status: VerificationStatus.NOT_SUBMITTED,
      s3Key,
      fileName,
      fileType,
      fileSize: fileSize ?? null,
    });
  }

  return { uploadUrl, documentId: verification.id, s3Key, expiresIn: 300 };
}

// ─── Confirm upload — synchronous pipeline, returns VERIFIED or REJECTED ─────

export async function confirmUpload(
  userId: string,
  documentId: string,
  s3Key: string,
  fileSize?: number
): Promise<ApiVerification> {
  const verification = await verificationRepository.findById(documentId);
  if (!verification) throw new NotFoundError('Document not found');
  if (verification.userId !== userId) throw new ForbiddenError('Access denied');
  if (verification.s3Key !== s3Key) throw new BadRequestError('s3Key mismatch');

  await verificationRepository.update(documentId, {
    status: VerificationStatus.UPLOADED,
    uploadedAt: new Date(),
    fileSize: fileSize ?? verification.fileSize,
  });

  return runVerificationPipeline(documentId, userId, verification.verificationType);
}

// ─── Status queries ──────────────────────────────────────────────────────────

export async function getVerificationStatus(userId: string): Promise<ApiVerificationStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { idVerified: true, bloodGroupVerified: true, medicalVerified: true },
  });
  if (!user) throw new NotFoundError('User not found');

  const verifications = await verificationRepository.findAllByUser(userId);
  const byType: Partial<Record<VerificationType, ApiVerification>> = {};

  for (const v of verifications) {
    const existing = byType[v.verificationType];
    if (!existing || new Date(v.createdAt) > new Date(existing.createdAt)) {
      byType[v.verificationType] = mapVerification(v);
    }
  }

  const verifiedCount = [user.idVerified, user.bloodGroupVerified, user.medicalVerified].filter(Boolean).length;
  const overallStatus: ApiVerificationStatus['overallStatus'] =
    verifiedCount === 3 ? 'FULLY_VERIFIED' : verifiedCount > 0 ? 'PARTIALLY_VERIFIED' : 'UNVERIFIED';

  return {
    userId,
    idVerified: user.idVerified,
    bloodGroupVerified: user.bloodGroupVerified,
    medicalVerified: user.medicalVerified,
    overallStatus,
    verifications: byType,
  };
}

export async function getVerificationStatusByType(
  userId: string,
  type: VerificationType
): Promise<ApiVerification | null> {
  const v = await verificationRepository.findByUserAndType(userId, type);
  if (!v) return null;

  let documentUrl: string | undefined;
  if (v.s3Key) {
    try { documentUrl = await generatePresignedViewUrl(v.s3Key); } catch {}
  }

  return mapVerification(v, documentUrl);
}

export async function getDocuments(userId: string): Promise<ApiVerification[]> {
  const verifications = await verificationRepository.findAllByUser(userId);
  return verifications.map((v) => mapVerification(v));
}

export async function getDocument(userId: string, documentId: string): Promise<ApiVerification> {
  const v = await verificationRepository.findById(documentId);
  if (!v) throw new NotFoundError('Document not found');
  if (v.userId !== userId) throw new ForbiddenError('Access denied');

  let documentUrl: string | undefined;
  if (v.s3Key) {
    try { documentUrl = await generatePresignedViewUrl(v.s3Key); } catch {}
  }

  return mapVerification(v, documentUrl);
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const v = await verificationRepository.findById(documentId);
  if (!v) throw new NotFoundError('Document not found');
  if (v.userId !== userId) throw new ForbiddenError('Access denied');

  const deletable: VerificationStatus[] = [VerificationStatus.REJECTED, VerificationStatus.NOT_SUBMITTED];
  if (!deletable.includes(v.status)) {
    throw new BadRequestError('Can only delete documents that are rejected or not yet submitted');
  }

  if (v.s3Key) {
    await archiveDocument(v.s3Key);
  }

  await verificationRepository.update(documentId, {
    status: VerificationStatus.NOT_SUBMITTED,
    s3Key: null,
    fileName: null,
    fileType: null,
    fileSize: null,
    uploadedAt: null,
    autoCheckPassed: null,
    autoCheckResults: Prisma.DbNull,
    fraudFlags: Prisma.DbNull,
    rejectionReason: null,
  });
}

// ─── Resubmission — also runs sync pipeline ──────────────────────────────────

export async function resubmit(
  userId: string,
  verificationId: string,
  newS3Key: string,
  reason: string
): Promise<ApiVerification> {
  const v = await verificationRepository.findById(verificationId);
  if (!v) throw new NotFoundError('Verification not found');
  if (v.userId !== userId) throw new ForbiddenError('Access denied');

  if (v.status !== VerificationStatus.REJECTED) {
    throw new BadRequestError('Can only resubmit rejected verifications');
  }

  if (v.s3Key && v.s3Key !== newS3Key) {
    await archiveDocument(v.s3Key);
  }

  await verificationRepository.update(verificationId, {
    status: VerificationStatus.UPLOADED,
    s3Key: newS3Key,
    uploadedAt: new Date(),
    resubmissionCount: { increment: 1 },
    reviewNotes: null,
    rejectionReason: null,
    autoCheckPassed: null,
    autoCheckResults: Prisma.DbNull,
    fraudFlags: Prisma.DbNull,
  });

  logger.info('Verification resubmitted', { verificationId, userId, reason });

  return runVerificationPipeline(verificationId, userId, v.verificationType);
}

export async function getHistory(userId: string): Promise<ApiVerification[]> {
  const verifications = await verificationRepository.findAllByUser(userId);
  return verifications.map((v) => mapVerification(v));
}

// ─── Admin: kept for compatibility — controller returns deprecation notice ────

export async function getPendingReviews(
  type?: VerificationType,
  page = 1,
  limit = 20
): Promise<{ items: ApiVerificationQueueItem[]; total: number; page: number; limit: number; hasMore: boolean }> {
  const { items, total } = await verificationRepository.findPendingReview(type, page, limit);
  return {
    items: items.map((v) => ({
      ...mapVerification(v),
      user: v.user,
      fraudAlerts: v.fraudAlerts.map(mapFraudAlert),
    })),
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}

export async function getVerificationDetail(verificationId: string): Promise<ApiVerificationQueueItem> {
  const v = await verificationRepository.findById(verificationId);
  if (!v) throw new NotFoundError('Verification not found');

  let documentUrl: string | undefined;
  if (v.s3Key) {
    try { documentUrl = await generatePresignedViewUrl(v.s3Key); } catch {}
  }

  return {
    ...mapVerification(v, documentUrl),
    user: v.user,
    fraudAlerts: v.fraudAlerts.map(mapFraudAlert),
  };
}

export async function assignForReview(verificationId: string, reviewerId: string): Promise<ApiVerification> {
  const v = await verificationRepository.findById(verificationId);
  if (!v) throw new NotFoundError('Verification not found');

  const updated = await verificationRepository.update(verificationId, {
    reviewer: { connect: { id: reviewerId } },
  });

  return mapVerification(updated);
}

export async function approveVerification(
  verificationId: string,
  reviewerId: string,
  notes?: string
): Promise<ApiVerification> {
  const v = await verificationRepository.findById(verificationId);
  if (!v) throw new NotFoundError('Verification not found');

  const updated = await verificationRepository.update(verificationId, {
    status: VerificationStatus.VERIFIED,
    reviewer: { connect: { id: reviewerId } },
    reviewedAt: new Date(),
    reviewNotes: notes ?? null,
  });

  await updateUserVerificationFlags(v.verificationType, v.userId, true);

  // If all 3 docs are now verified, promote donorStatus (respects cooldown/deferral).
  await syncDonorEligibilityFromDocuments(v.userId);

  await createAndSendNotification({
    userId: v.userId,
    title: 'Verification Approved!',
    body: `Your ${v.verificationType.replace(/_/g, ' ').toLowerCase()} verification has been approved.`,
    notificationType: 'VERIFICATION',
  });

  return mapVerification(updated);
}

export async function rejectVerification(
  verificationId: string,
  reviewerId: string,
  reason: string,
  notes?: string
): Promise<ApiVerification> {
  const v = await verificationRepository.findById(verificationId);
  if (!v) throw new NotFoundError('Verification not found');

  const updated = await verificationRepository.update(verificationId, {
    status: VerificationStatus.REJECTED,
    reviewer: { connect: { id: reviewerId } },
    reviewedAt: new Date(),
    rejectionReason: reason,
    reviewNotes: notes ?? null,
  });

  await updateUserVerificationFlags(v.verificationType, v.userId, false);

  await createAndSendNotification({
    userId: v.userId,
    title: 'Verification Not Approved',
    body: `Your verification was not approved. Reason: ${reason}`,
    notificationType: 'VERIFICATION',
  });

  return mapVerification(updated);
}

// ─── Admin: stats & fraud ─────────────────────────────────────────────────────

export async function getStats() {
  const [approvedToday, rejectedToday, totalVerified, totalRejected] = await Promise.all([
    verificationRepository.findApprovedToday(),
    verificationRepository.findRejectedToday(),
    verificationRepository.countByStatus(VerificationStatus.VERIFIED),
    verificationRepository.countByStatus(VerificationStatus.REJECTED),
  ]);

  return { pending: 0, approvedToday, rejectedToday, totalVerified, totalRejected };
}

export async function getFraudAlerts(
  minScore = FRAUD_SCORE_THRESHOLD,
  onlyUnresolved = true,
  page = 1,
  limit = 20
) {
  const { items, total } = await verificationRepository.findFraudAlerts(minScore, onlyUnresolved, page, limit);
  return {
    items: items.map(mapFraudAlert),
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}

export async function resolveFraudAlert(alertId: string, resolvedBy: string) {
  const alert = await verificationRepository.resolveFraudAlert(alertId, resolvedBy);
  return mapFraudAlert(alert);
}

export async function getHighFraudVerifications(minScore = FRAUD_SCORE_THRESHOLD, page = 1, limit = 20) {
  const { items, total } = await verificationRepository.findWithHighFraudScore(minScore, page, limit);
  return {
    items: items.map((v) => ({
      ...mapVerification(v),
      user: v.user,
      fraudAlerts: v.fraudAlerts.map(mapFraudAlert),
    })),
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}
