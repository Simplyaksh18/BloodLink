import { prisma } from '../config/database';
import {
  Verification,
  FraudAlert,
  VerificationType,
  VerificationStatus,
  Prisma,
} from '@prisma/client';

export type VerificationWithAlerts = Verification & {
  fraudAlerts: FraudAlert[];
  user: { id: string; name: string; phone: string; bloodGroup: string | null };
};

export class VerificationRepository {
  async findByUserAndType(
    userId: string,
    verificationType: VerificationType
  ): Promise<Verification | null> {
    return prisma.verification.findFirst({
      where: { userId, verificationType },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<VerificationWithAlerts | null> {
    return prisma.verification.findUnique({
      where: { id },
      include: {
        fraudAlerts: true,
        user: { select: { id: true, name: true, phone: true, bloodGroup: true } },
      },
    });
  }

  async findAllByUser(userId: string): Promise<Verification[]> {
    return prisma.verification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: Prisma.VerificationCreateInput): Promise<Verification> {
    return prisma.verification.create({ data });
  }

  async update(id: string, data: Prisma.VerificationUpdateInput): Promise<Verification> {
    return prisma.verification.update({ where: { id }, data });
  }

  async findPendingReview(
    type?: VerificationType,
    page = 1,
    limit = 20
  ): Promise<{ items: VerificationWithAlerts[]; total: number }> {
    const where: Prisma.VerificationWhereInput = {
      status: { in: [VerificationStatus.PENDING_REVIEW, VerificationStatus.AUTO_VERIFICATION_PASSED] },
      ...(type && { verificationType: type }),
    };
    const skip = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.verification.findMany({
        where,
        include: {
          fraudAlerts: true,
          user: { select: { id: true, name: true, phone: true, bloodGroup: true } },
        },
        orderBy: [{ fraudScore: 'desc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.verification.count({ where }),
    ]);
    return { items, total };
  }

  async findWithHighFraudScore(minScore: number, page = 1, limit = 20) {
    const where: Prisma.VerificationWhereInput = { fraudScore: { gte: minScore } };
    const skip = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.verification.findMany({
        where,
        include: {
          fraudAlerts: true,
          user: { select: { id: true, name: true, phone: true, bloodGroup: true } },
        },
        orderBy: { fraudScore: 'desc' },
        skip,
        take: limit,
      }),
      prisma.verification.count({ where }),
    ]);
    return { items, total };
  }

  async countByStatus(status: VerificationStatus): Promise<number> {
    return prisma.verification.count({ where: { status } });
  }

  async findReviewedToday(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return prisma.verification.count({
      where: { reviewedAt: { gte: start }, status: { in: [VerificationStatus.VERIFIED, VerificationStatus.REJECTED] } },
    });
  }

  async findApprovedToday(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return prisma.verification.count({ where: { status: VerificationStatus.VERIFIED, reviewedAt: { gte: start } } });
  }

  async findRejectedToday(): Promise<number> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return prisma.verification.count({ where: { status: VerificationStatus.REJECTED, reviewedAt: { gte: start } } });
  }

  async countRecentUploads(userId: string, windowMinutes: number): Promise<number> {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    return prisma.verification.count({ where: { userId, uploadedAt: { gte: since } } });
  }

  async findDuplicateS3Key(s3Key: string, excludeUserId: string): Promise<Verification | null> {
    return prisma.verification.findFirst({ where: { s3Key, userId: { not: excludeUserId } } });
  }

  async findRecentRejections(userId: string, type: VerificationType, windowMinutes: number): Promise<number> {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    return prisma.verification.count({
      where: { userId, verificationType: type, status: VerificationStatus.REJECTED, reviewedAt: { gte: since } },
    });
  }

  async createFraudAlert(data: Prisma.FraudAlertCreateInput): Promise<FraudAlert> {
    return prisma.fraudAlert.create({ data });
  }

  async findFraudAlerts(
    minSeverity = 0,
    onlyUnresolved = false,
    page = 1,
    limit = 20
  ): Promise<{ items: FraudAlert[]; total: number }> {
    const where: Prisma.FraudAlertWhereInput = {
      severity: { gte: minSeverity },
      ...(onlyUnresolved && { isResolved: false }),
    };
    const skip = (page - 1) * limit;
    const [items, total] = await prisma.$transaction([
      prisma.fraudAlert.findMany({ where, orderBy: { severity: 'desc' }, skip, take: limit }),
      prisma.fraudAlert.count({ where }),
    ]);
    return { items, total };
  }

  async resolveFraudAlert(id: string, resolvedBy: string): Promise<FraudAlert> {
    return prisma.fraudAlert.update({
      where: { id },
      data: { isResolved: true, resolvedBy, resolvedAt: new Date() },
    });
  }
}

export const verificationRepository = new VerificationRepository();
