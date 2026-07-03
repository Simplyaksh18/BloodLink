import { prisma } from '../config/database';
import { Prisma, User } from '@prisma/client';

export type UserWithDocuments = User & {
  documents: { id: string; userId: string; documentType: string; url: string; fileName: string; mimeType: string; status: string; createdAt: Date }[];
};

export class UserRepository {
  async findById(id: string): Promise<UserWithDocuments | null> {
    return prisma.user.findFirst({
      where: { id, isDeleted: false },
      include: { documents: true },
    });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { phone, isDeleted: false } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { email, isDeleted: false } });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<UserWithDocuments> {
    return prisma.user.update({
      where: { id },
      data,
      include: { documents: true },
    });
  }

  async findNearbyDonors(
    lat: number,
    lng: number,
    radiusKm: number,
    bloodGroup?: string
  ): Promise<UserWithDocuments[]> {
    const where: Prisma.UserWhereInput = {
      isDonor: true,
      willingToDonate: true,
      isActive: true,
      isDeleted: false,
      latitude: { not: null },
      longitude: { not: null },
      ...(bloodGroup && { bloodGroup }),
    };

    const users = await prisma.user.findMany({
      where,
      include: { documents: true },
      take: 100,
    });

    return users
      .filter((u) => {
        if (!u.latitude || !u.longitude) return false;
        const d = haversineKm(lat, lng, u.latitude, u.longitude);
        return d <= radiusKm;
      })
      .map((u) => ({ ...u, _distance: haversineKm(lat, lng, u.latitude!, u.longitude!) }))
      .sort((a, b) => (a as any)._distance - (b as any)._distance);
  }

  async findDonorsByFilter(bloodGroups?: string[], city?: string, excludeUserId?: string): Promise<UserWithDocuments[]> {
    console.log('[DonorDiscoveryBackend] source filter: importedDonor=true');
    console.log('[DonorDiscoveryBackend] requestedBloodGroups:', bloodGroups ?? 'all');
    console.log('[DonorDiscoveryBackend] city filter:', city ?? 'none');

    // Step 1 — raw imported count (no blood/city/self filter)
    const rawCount = await prisma.user.count({
      where: { isDonor: true, isActive: true, isDeleted: false, importedDonor: true },
    });
    console.log('[DonorDiscoveryBackend] raw imported count:', rawCount);

    // Step 2 — after blood group filter (+ self exclusion)
    const bloodFilterWhere: Prisma.UserWhereInput = {
      isDonor: true,
      isActive: true,
      isDeleted: false,
      importedDonor: true,
      ...(excludeUserId && { id: { not: excludeUserId } }),
      ...(bloodGroups && bloodGroups.length > 0 && { bloodGroup: { in: bloodGroups } }),
    };
    const bloodFilterCount = await prisma.user.count({ where: bloodFilterWhere });
    console.log('[DonorDiscoveryBackend] after blood filter:', bloodFilterCount);

    // Step 3 — final query with city filter; fall back to no-city if city returns zero
    const withCityWhere: Prisma.UserWhereInput = {
      ...bloodFilterWhere,
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
    };

    let donors = await prisma.user.findMany({
      where: withCityWhere,
      include: { documents: true },
      take: 150,
      orderBy: { createdAt: 'desc' },
    });

    console.log('[DonorDiscoveryBackend] after city/area filter:', donors.length);

    if (donors.length === 0 && city) {
      console.log('[DonorDiscoveryBackend] city produced zero — retrying without city:', city);
      donors = await prisma.user.findMany({
        where: bloodFilterWhere,
        include: { documents: true },
        take: 150,
        orderBy: { createdAt: 'desc' },
      });
      console.log('[DonorDiscoveryBackend] retry without city count:', donors.length);
    }

    if (excludeUserId) {
      console.log('[DonorDiscoveryBackend] excluded self userId:', excludeUserId);
    }
    console.log('[DonorDiscoveryBackend] final count after self exclusion:', donors.length);
    const first10 = donors.slice(0, 10).map(d => d.name);
    console.log('[DonorDiscoveryBackend] final first names:', first10);

    return donors;
  }

  async addDocument(
    userId: string,
    documentType: string,
    url: string,
    fileName: string,
    mimeType: string
  ): Promise<{ id: string; url: string; documentType: string }> {
    return prisma.userDocument.create({
      data: { userId, documentType, url, fileName, mimeType },
      select: { id: true, url: true, documentType: true },
    });
  }

  async softDelete(id: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { isDeleted: true, isActive: false },
    });
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

export const userRepository = new UserRepository();
