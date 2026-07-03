import { prisma } from '../config/database';
import { Prisma, BloodRequest, RequestStatus } from '@prisma/client';

// Public-feed statuses: OPEN (legacy) and ACTIVE only.
// IN_PROGRESS means a donor has already accepted — not shown in public feeds.
const PUBLIC_STATUSES: RequestStatus[] = [RequestStatus.OPEN, RequestStatus.ACTIVE];

// Confirms targetedDonorId scalar is available on the Prisma BloodRequest model.
console.log('[TargetedRequestSchema] DB column exists: true');

export type BloodRequestWithRelations = BloodRequest & {
  requester: { id: string; name: string; phone: string };
  documents: { id: string; documentType: string; url: string }[];
};

export class RequestRepository {
  async create(data: Prisma.BloodRequestCreateInput): Promise<BloodRequestWithRelations> {
    return prisma.bloodRequest.create({
      data,
      include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
    });
  }

  async findById(id: string): Promise<BloodRequestWithRelations | null> {
    return prisma.bloodRequest.findUnique({
      where: { id },
      include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
    });
  }

  async findByRequesterId(requesterId: string): Promise<BloodRequestWithRelations[]> {
    return prisma.bloodRequest.findMany({
      where: { requesterId },
      include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(
    page: number,
    limit: number,
    bloodGroup?: string,
    priority?: string,
    donorBloodGroups?: string[],
    excludeRequesterId?: string,
    currentUserId?: string,
  ): Promise<{ items: BloodRequestWithRelations[]; total: number }> {
    const skip = (page - 1) * limit;

    const filterDesc = currentUserId
      ? `OR [null, ${currentUserId}]`
      : 'null only (no auth)';
    console.log('[NearbyRequestsBackend] targetedFilter applied:', filterDesc);

    // Universal requests (no target) are always shown.
    // Targeted requests are only shown to the designated donor.
    const targetedFilter: Prisma.BloodRequestWhereInput = currentUserId
      ? { OR: [{ targetedDonorId: null }, { targetedDonorId: currentUserId }] }
      : { targetedDonorId: null };

    const baseFilter: Prisma.BloodRequestWhereInput = {
      status: { in: PUBLIC_STATUSES },
      ...(donorBloodGroups
        ? { bloodGroup: { in: donorBloodGroups } }
        : bloodGroup
        ? { bloodGroup }
        : {}),
      ...(priority && { emergencyLevel: priority as any }),
      ...(excludeRequesterId && { requesterId: { not: excludeRequesterId } }),
    };

    const where: Prisma.BloodRequestWhereInput = { AND: [targetedFilter, baseFilter] };

    const [items, total] = await prisma.$transaction([
      prisma.bloodRequest.findMany({
        where,
        include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
        orderBy: [{ emergencyLevel: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.bloodRequest.count({ where }),
    ]);

    const includedTargetedCount = items.filter(i => i.targetedDonorId === currentUserId).length;
    const excludedNote = currentUserId
      ? 'targeted requests for other donors hidden by query filter'
      : 'all targeted requests hidden (no currentUserId)';
    console.log('[NearbyRequestsBackend] targeted included:', includedTargetedCount);
    console.log('[NearbyRequestsBackend] targeted excluded:', excludedNote);

    return { items, total };
  }

  async findFeed(page: number, limit: number, bloodGroup?: string): Promise<{ items: BloodRequestWithRelations[]; total: number }> {
    const skip = (page - 1) * limit;
    const where: Prisma.BloodRequestWhereInput = {
      status: { in: PUBLIC_STATUSES },
      ...(bloodGroup && { bloodGroup }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.bloodRequest.findMany({
        where,
        include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
        orderBy: [{ emergencyLevel: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.bloodRequest.count({ where }),
    ]);

    return { items, total };
  }

  async findNearby(
    lat: number,
    lng: number,
    radiusKm: number,
    bloodGroup?: string
  ): Promise<BloodRequestWithRelations[]> {
    const where: Prisma.BloodRequestWhereInput = {
      status: { in: PUBLIC_STATUSES },
      hospitalLatitude: { not: null },
      hospitalLongitude: { not: null },
      ...(bloodGroup && { bloodGroup }),
    };

    const requests = await prisma.bloodRequest.findMany({
      where,
      include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
      take: 100,
    });

    return requests.filter((r) => {
      if (!r.hospitalLatitude || !r.hospitalLongitude) return false;
      return haversineKm(lat, lng, r.hospitalLatitude, r.hospitalLongitude) <= radiusKm;
    });
  }

  async update(id: string, data: Prisma.BloodRequestUpdateInput): Promise<BloodRequestWithRelations> {
    return prisma.bloodRequest.update({
      where: { id },
      data,
      include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
    });
  }

  async updateStatus(id: string, status: RequestStatus): Promise<BloodRequestWithRelations> {
    return prisma.bloodRequest.update({
      where: { id },
      data: { status },
      include: { requester: { select: { id: true, name: true, phone: true } }, documents: true },
    });
  }

  async findExpired(): Promise<{ id: string; requesterId: string }[]> {
    return prisma.bloodRequest.findMany({
      where: {
        status: { in: [RequestStatus.OPEN, RequestStatus.ACTIVE, RequestStatus.IN_PROGRESS] },
        expiresAt: { lt: new Date() },
      },
      select: { id: true, requesterId: true },
    });
  }

  async addDocument(requestId: string, documentType: string, url: string): Promise<void> {
    await prisma.requestDocument.create({ data: { requestId, documentType, url } });
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const requestRepository = new RequestRepository();
