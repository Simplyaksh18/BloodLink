import { Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { NotFoundError } from '../utils/ApiError';
import { logAudit } from '../services/audit.service';

// Only pass known User schema fields to Prisma to avoid "Unknown argument" errors
const VALID_USER_FIELDS = new Set([
  'name', 'email', 'gender', 'bloodGroup', 'city', 'state', 'address', 'pincode',
  'latitude', 'longitude', 'isDonor', 'isDonorEligible', 'donorStatus', 'willingToDonate',
  'idVerified', 'bloodGroupVerified', 'medicalVerified', 'isActive', 'totalDonations',
  'lastDonationDate', 'avatarUrl',
  // CSV import tracking
  'importedDonor', 'age', 'importedAt',
]);

function sanitizeForUser(body: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (VALID_USER_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

export const addDonor = asyncHandler(async (req: Request, res: Response) => {
  const { phone, ...rest } = req.body;
  const data = sanitizeForUser(rest);
  console.log('[LiveDonorImportAPI] received: POST /admin/donors —', phone);
  console.log('[LiveDonorImportAPI] importedDonor:', data.importedDonor ?? 'NOT SET');
  console.log('[LiveDonorImportAPI] phone:', phone);
  console.log('[LiveDonorImportAPI] bloodGroup:', data.bloodGroup ?? 'NOT SET');
  console.log('[LiveDonorImportAPI] city:', data.city ?? 'NOT SET');
  try {
    const user = await prisma.user.create({ data: { phone, isDonor: true, ...data } as any });
    console.log('[LiveDonorImportAPI] saved userId:', user.id);
    ApiResponse.created(res, { id: user.id });
  } catch (err: any) {
    // Prisma P2002 = unique constraint violation — tell the import script to upsert instead
    if (err?.code === 'P2002') {
      res.status(409).json({ success: false, message: 'User already exists with this phone' });
      return;
    }
    throw err;
  }
});

export const upsertDonor = asyncHandler(async (req: Request, res: Response) => {
  const { phone, ...rest } = req.body;
  if (!phone) {
    res.status(400).json({ success: false, message: 'phone is required for upsert' });
    return;
  }
  const data = sanitizeForUser(rest);
  console.log('[LiveDonorImportAPI] received: PUT /admin/donors/upsert —', phone);
  console.log('[LiveDonorImportAPI] importedDonor:', data.importedDonor ?? 'NOT SET');
  console.log('[LiveDonorImportAPI] bloodGroup:', data.bloodGroup ?? 'NOT SET');
  console.log('[LiveDonorImportAPI] city:', data.city ?? 'NOT SET');
  const existing = await prisma.user.findFirst({ where: { phone } });
  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { isDonor: true, ...data } as any,
    });
    console.log('[LiveDonorImportAPI] saved userId:', updated.id, '(updated)');
    ApiResponse.success(res, { id: updated.id, updated: true });
  } else {
    const created = await prisma.user.create({ data: { phone, isDonor: true, ...data } as any });
    console.log('[LiveDonorImportAPI] saved userId:', created.id, '(created via upsert)');
    ApiResponse.created(res, { id: created.id, updated: false });
  }
});

export const removeDonor = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new NotFoundError('Donor not found');
  await prisma.user.update({ where: { id: req.params.id }, data: { isDonor: false, isDeleted: true } });
  ApiResponse.success(res, null, 'Donor removed');
});

export const addBloodBank = asyncHandler(async (req: Request, res: Response) => {
  const bank = await prisma.bloodBank.create({ data: req.body });
  ApiResponse.created(res, { id: bank.id });
});

// List blood banks for admin verification dashboard. Optional ?status filter.
// Admin router already enforces requireRole('ADMIN','SUPER_ADMIN').
//
// Excludes obvious seed/demo rows from the verification queue:
//   - ownerId IS NULL  (real registrations always set ownerId in createBank)
//   - registrationNumber starts with 'BB-'  (seed marker; createBank never sets it)
//   - email ends with '@bloodlink.test'     (seed marker)
// Public discovery (/blood-banks) is untouched.
// Postgres 3-valued logic: `col LIKE 'x'` on NULL is NULL, and `NOT NULL`
// is NULL → treated as non-match. Real user-created banks legitimately have
// registrationNumber = NULL (only seed sets it) and often email = NULL, so a
// plain NOT clause silently drops them. The OR-with-null form below is
// null-safe and preserves the "exclude demo rows" intent.
const REAL_BANKS_ONLY: Prisma.BloodBankWhereInput = {
  isActive: true,
  ownerId: { not: null },
  AND: [
    { OR: [
        { registrationNumber: null },
        { registrationNumber: { not: { startsWith: 'BB-' } } },
    ]},
    { OR: [
        { email: null },
        { email: { not: { endsWith: '@bloodlink.test' } } },
    ]},
  ],
};

export const listBloodBanks = asyncHandler(async (req: Request, res: Response) => {
  const status = (req.query.status as string | undefined)?.toUpperCase();
  const where: Prisma.BloodBankWhereInput = { ...REAL_BANKS_ONLY };
  if (status === 'PENDING_REVIEW' || status === 'VERIFIED' || status === 'REJECTED') {
    where.verificationStatus = status as any;
  }

  const [banks, counts, demoCount] = await Promise.all([
    prisma.bloodBank.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, licenseNumber: true, contactPhone: true, email: true,
        address: true, city: true, state: true, pincode: true,
        verificationStatus: true, isVerified: true, rejectionReason: true,
        createdAt: true, ownerId: true,
      },
    }),
    prisma.bloodBank.groupBy({
      by: ['verificationStatus'],
      where: REAL_BANKS_ONLY,
      _count: { _all: true },
    }),
    prisma.bloodBank.count({
      where: {
        isActive: true,
        OR: [
          { ownerId: null },
          { registrationNumber: { startsWith: 'BB-' } },
          { email: { endsWith: '@bloodlink.test' } },
        ],
      },
    }),
  ]);

  const stats = counts.reduce(
    (acc, c) => ({ ...acc, [c.verificationStatus]: c._count._all }),
    { PENDING_REVIEW: 0, VERIFIED: 0, REJECTED: 0 } as Record<string, number>,
  );

  console.log('[AdminBanksDB] querySource: prisma.bloodBank (real-owner-only)');
  console.log('[AdminBanksDB] totalRows:', banks.length);
  console.log('[AdminBanksDB] firstNames:', banks.slice(0, 5).map((b) => b.name));
  console.log('[AdminBanksDB] dummyDataEnabled:', false);
  console.log('[AdminBanksDB] demoRowsFiltered:', demoCount);

  ApiResponse.success(res, { banks, stats, total: banks.length });
});

// Full detail (admin view — bypasses public verified-only guard).
export const getBloodBankDetail = asyncHandler(async (req: Request, res: Response) => {
  const bank = await prisma.bloodBank.findUnique({
    where: { id: req.params.id },
    include: { owner: { select: { id: true, name: true, phone: true, email: true } } },
  });
  if (!bank) throw new NotFoundError('Blood bank not found');
  ApiResponse.success(res, bank);
});

export const removeBloodBank = asyncHandler(async (req: Request, res: Response) => {
  const bank = await prisma.bloodBank.findUnique({ where: { id: req.params.id } });
  if (!bank) throw new NotFoundError('Blood bank not found');
  await prisma.bloodBank.update({ where: { id: req.params.id }, data: { isActive: false } });
  ApiResponse.success(res, null, 'Blood bank removed');
});

export const getPendingVerifications = asyncHandler(async (_req: Request, res: Response) => {
  const pendingDonors = await prisma.user.findMany({
    where: { donorVerificationStatus: 'UNDER_REVIEW', isDeleted: false },
    select: { id: true, name: true, phone: true, bloodGroup: true, donorVerificationStatus: true, createdAt: true },
  });
  const pendingRequests = await prisma.bloodRequest.findMany({
    where: { verificationStatus: 'PENDING' },
    include: { requester: { select: { id: true, name: true } } },
    take: 50,
  });

  ApiResponse.success(res, { donors: pendingDonors, requests: pendingRequests });
});

export const reviewVerification = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { action, reason } = req.body as { action: 'approve' | 'reject'; reason?: string };

  const user = await prisma.user.findUnique({ where: { id } });
  if (user) {
    await prisma.user.update({
      where: { id },
      data: { donorVerificationStatus: action === 'approve' ? 'ELIGIBLE' : 'NOT_ELIGIBLE' },
    });
    ApiResponse.success(res, null, `Donor ${action}d`);
    return;
  }

  const request = await prisma.bloodRequest.findUnique({ where: { id } });
  if (request) {
    await prisma.bloodRequest.update({
      where: { id },
      data: { verificationStatus: action === 'approve' ? 'APPROVED' : 'REJECTED' },
    });
    ApiResponse.success(res, null, `Request ${action}d`);
    return;
  }

  // Production Blood Bank verification workflow. Reuses admin auth
  // (requireRole('ADMIN','SUPER_ADMIN')) and existing adminReviewSchema.
  const bank = await prisma.bloodBank.findUnique({ where: { id } });
  if (bank) {
    const previousStatus = bank.verificationStatus;
    const approving = action === 'approve';
    await prisma.bloodBank.update({
      where: { id },
      data: {
        verificationStatus: approving ? 'VERIFIED' : 'REJECTED',
        isVerified: approving,
        rejectionReason: approving ? null : (reason ?? 'Rejected by admin'),
      },
    });
    logAudit({
      userId: req.user?.userId ?? null,
      action: 'BLOOD_BANK_VERIFICATION_REVIEW',
      entityType: 'BloodBank',
      entityId: id,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'],
      metadata: {
        previousStatus,
        newStatus: approving ? 'VERIFIED' : 'REJECTED',
        reason: approving ? null : (reason ?? null),
      },
    });
    ApiResponse.success(res, null, `Blood bank ${action}d`);
    return;
  }

  throw new NotFoundError('Verification target not found');
});

// GET /v1/admin/donors/imported/verify — inspect what was actually imported
export const verifyImportedDonors = asyncHandler(async (_req: Request, res: Response) => {
  const donors = await prisma.user.findMany({
    where: { importedDonor: true, isDeleted: false } as any,
    select: {
      id: true,
      name: true,
      phone: true,
      bloodGroup: true,
      city: true,
      gender: true,
      age: true,
      donorStatus: true,
      isActive: true,
      importedAt: true,
      createdAt: true,
    } as any,
    orderBy: { createdAt: 'asc' },
  });

  const totalImported = donors.length;
  const activeImported = (donors as any[]).filter((d: any) => d.isActive).length;
  const first10Names = (donors as any[]).slice(0, 10).map((d: any) => d.name);

  const bloodGroupCounts: Record<string, number> = {};
  const cityCounts: Record<string, number> = {};
  for (const d of donors as any[]) {
    if (d.bloodGroup) bloodGroupCounts[d.bloodGroup] = (bloodGroupCounts[d.bloodGroup] ?? 0) + 1;
    const c = ((d.city as string | null) ?? 'unknown').toLowerCase();
    cityCounts[c] = (cityCounts[c] ?? 0) + 1;
  }

  const sampleRows = (donors as any[]).slice(0, 5).map((d: any) => ({
    name: d.name,
    phone: d.phone,
    bloodGroup: d.bloodGroup,
    city: d.city,
    importedDonor: true,
    age: d.age,
    gender: d.gender,
    importedAt: d.importedAt,
  }));

  console.log('[AdminVerify] totalImported:', totalImported);
  console.log('[AdminVerify] activeImported:', activeImported);
  console.log('[AdminVerify] first 10 names:', first10Names);

  ApiResponse.success(res, {
    totalImported,
    activeImported,
    first10Names,
    bloodGroupCounts,
    cityCounts,
    sampleRows,
  });
});
