import { User, UserDocument } from '@prisma/client';
import { userRepository } from '../repositories/user.repository';
import { ApiUser, ApiDonorProfile, ApiDonorCard, ApiLocation, BloodGroup, UploadedDocument } from '../types';
import { NotFoundError } from '../utils/ApiError';
import { haversineDistanceKm } from '../utils/helpers';
import { prisma } from '../config/database';
import { DONATION_COOLDOWN_DAYS } from '../utils/constants';

type UserWithDocs = User & { documents: UserDocument[] };

export function mapUserToApi(user: UserWithDocs): ApiUser {
  const location: ApiLocation | undefined =
    user.latitude && user.longitude
      ? {
          latitude: user.latitude,
          longitude: user.longitude,
          address: user.address ?? '',
          city: user.city ?? '',
          state: user.state ?? '',
          pincode: user.pincode ?? '',
        }
      : undefined;

  const donorProfile: ApiDonorProfile | undefined = user.isDonor
    ? {
        id: user.id,
        userId: user.id,
        bloodGroup: user.bloodGroup as BloodGroup,
        lastDonationDate: user.lastDonationDate?.toISOString() ?? null,
        willingToDonate: user.willingToDonate,
        verificationStatus: mapDonorStatus(user.donorVerificationStatus),
        documents: mapDocuments(user.documents),
        totalDonations: user.totalDonations,
      }
    : undefined;

  const isRecipient = (user as any).isRecipient ?? true;
  const recipientProfile = isRecipient ? { id: user.id, userId: user.id } : undefined;

  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as string,
    gender: user.gender as ApiUser['gender'],
    email: user.email ?? undefined,
    avatar: user.avatarUrl ?? undefined,
    profileEmoji: (user as any).profileEmoji ?? undefined,
    medicalCertificate: user.medicalCertificateUrl ?? undefined,
    bloodGroup: (user.bloodGroup as BloodGroup) ?? undefined,
    location,
    emergencyContact:
      user.emergencyContactName
        ? { name: user.emergencyContactName, phone: user.emergencyContactPhone ?? '', relation: user.emergencyContactRelation ?? '' }
        : undefined,
    donorProfile,
    recipientProfile,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function mapUserToDonorCard(user: UserWithDocs, fromLat?: number, fromLng?: number): ApiDonorCard {
  const distance =
    fromLat && fromLng && user.latitude && user.longitude
      ? Math.round(haversineDistanceKm(fromLat, fromLng, user.latitude, user.longitude) * 10) / 10
      : undefined;

  return {
    id: user.id,
    name: user.name,
    bloodGroup: user.bloodGroup as BloodGroup,
    gender: (user.gender as any) ?? undefined,
    age: (user as any).age ?? undefined,
    location: {
      latitude: user.latitude ?? 0,
      longitude: user.longitude ?? 0,
      address: user.address ?? '',
      city: user.city ?? '',
      state: user.state ?? '',
      pincode: user.pincode ?? '',
    },
    lastDonationDate: user.lastDonationDate?.toISOString() ?? null,
    willingToDonate: user.willingToDonate,
    verificationStatus: mapDonorStatus(user.donorVerificationStatus),
    distance,
    // Availability fields for client-side filtering (Bug 3)
    donorStatus: user.donorStatus ?? null,
    importedDonor: user.importedDonor ?? false,
    // isImportedVerified requires a separate explicit DB flag that does not yet exist — never auto-derive from importedDonor alone
    isImportedVerified: false,
    ...computeAvailability(user),
  };
}

// ─── Backend-authoritative availability ──────────────────────────────────────
// Single source of truth for the DonorCard button. Frontend must not derive
// availability from any other field.
//
// "accountClaimed" = the imported/CSV row has since been claimed by a real
// user completing app onboarding. We infer it from existing columns (no
// schema change): passwordHash set (registered) OR phoneVerified true
// (OTP login/verify). CSV-only rows have neither.
//
// Rules:
//   - Not-yet-claimed imported donor         → Contact Pending
//   - Claimed + docs verified + ACTIVE       → Available (Request Blood)
//   - Claimed but DEFERRED                   → Deferred
//   - Claimed but docs incomplete / status
//     not yet ACTIVE                         → Under Review
function computeAvailability(user: UserWithDocs): {
  canRequestBlood: boolean;
  availabilityLabel: 'Available' | 'Contact Pending' | 'Under Review' | 'Deferred';
  accountClaimed: boolean;
  verificationComplete: boolean;
} {
  const accountClaimed = !!((user as any).passwordHash) || user.phoneVerified === true;
  const verificationComplete = !!(user.idVerified && user.bloodGroupVerified && user.medicalVerified);

  if (user.importedDonor && !accountClaimed) {
    return { canRequestBlood: false, availabilityLabel: 'Contact Pending', accountClaimed, verificationComplete };
  }
  const active = user.donorStatus === 'ACTIVE' && user.isDonorEligible === true && verificationComplete;
  if (active) {
    return { canRequestBlood: true, availabilityLabel: 'Available', accountClaimed, verificationComplete };
  }
  if (user.donorStatus === 'DEFERRED') {
    return { canRequestBlood: false, availabilityLabel: 'Deferred', accountClaimed, verificationComplete };
  }
  return { canRequestBlood: false, availabilityLabel: 'Under Review', accountClaimed, verificationComplete };
}

function mapDonorStatus(status: string): ApiDonorProfile['verificationStatus'] {
  const map: Record<string, ApiDonorProfile['verificationStatus']> = {
    PENDING: 'pending',
    ELIGIBLE: 'eligible',
    UNDER_REVIEW: 'under_review',
    NOT_ELIGIBLE: 'not_eligible',
  };
  return map[status] ?? 'pending';
}

function mapDocuments(docs: UserDocument[]): UploadedDocument[] {
  return docs.map((d) => ({
    id: d.id,
    type: d.documentType as UploadedDocument['type'],
    uri: d.url,
    fileName: d.fileName,
    mimeType: d.mimeType,
    uploadedAt: d.createdAt.toISOString(),
    status: 'uploaded' as const,
  }));
}

export async function getProfile(userId: string): Promise<ApiUser> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const base = mapUserToApi(user);

  // Use verified donations from Donation table (not the denormalized User counter)
  const [donationAgg, lastVerifiedDonation, rawHistory] = await Promise.all([
    prisma.donation.aggregate({
      where: { donorId: userId, isVerified: true },
      _sum: { units: true },
      _count: true,
    }),
    prisma.donation.findFirst({
      where: { donorId: userId, isVerified: true },
      orderBy: { donationDate: 'desc' },
    }),
    prisma.donation.findMany({
      where: { donorId: userId },
      include: {
        bloodRequest: {
          select: { hospitalName: true, hospitalAddress: true, requester: { select: { name: true } } },
        },
      },
      orderBy: { donationDate: 'desc' },
    }),
  ]);

  const totalUnits = donationAgg._sum.units ?? 0;
  const livesSaved = totalUnits * 3;

  const donationHistory = rawHistory.map((d) => ({
    id: d.id,
    date: d.donationDate.toISOString(),
    hospital: d.bloodRequest?.hospitalName ?? 'Independent Donation',
    recipient: d.bloodRequest?.requester?.name,
    units: d.units,
    bloodGroup: d.bloodGroup,
  }));

  let donationEligibility: ApiUser['donationEligibility'];
  if (user.isDonor) {
    if (!lastVerifiedDonation) {
      donationEligibility = {
        canDonate: true,
        nextEligibleDate: null,
        daysRemaining: 0,
        status: 'eligible',
        message: 'Ready to donate',
      };
    } else {
      const nextDate = new Date(lastVerifiedDonation.donationDate);
      nextDate.setDate(nextDate.getDate() + DONATION_COOLDOWN_DAYS);
      const daysRemaining = Math.max(0, Math.ceil((nextDate.getTime() - Date.now()) / 86400000));
      const canDonate = daysRemaining === 0;
      donationEligibility = {
        canDonate,
        nextEligibleDate: nextDate.toISOString(),
        daysRemaining,
        status: canDonate ? 'eligible' : 'not_eligible',
        message: canDonate ? 'Ready to donate' : `${daysRemaining} days until eligible`,
      };
    }
  }

  return { ...base, livesSaved, donationEligibility, donationHistory } as any;
}

export async function updateProfile(
  userId: string,
  data: {
    name?: string;
    gender?: string;
    email?: string;
    bloodGroup?: string;
    location?: ApiLocation;
    emergencyContact?: { name: string; phone: string; relation: string };
    medicalCertificate?: string;
    profileEmoji?: string;
  }
): Promise<ApiUser> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const updated = await userRepository.update(userId, {
    ...(data.name && { name: data.name }),
    ...(data.gender && { gender: data.gender }),
    ...(data.email && { email: data.email }),
    ...(data.bloodGroup && { bloodGroup: data.bloodGroup, isDonor: true }),
    ...(data.location && {
      latitude: data.location.latitude,
      longitude: data.location.longitude,
      address: data.location.address,
      city: data.location.city,
      state: data.location.state,
      pincode: data.location.pincode,
    }),
    ...(data.emergencyContact && {
      emergencyContactName: data.emergencyContact.name,
      emergencyContactPhone: data.emergencyContact.phone,
      emergencyContactRelation: data.emergencyContact.relation,
    }),
    ...(data.medicalCertificate && { medicalCertificateUrl: data.medicalCertificate }),
    ...(data.profileEmoji !== undefined && { profileEmoji: data.profileEmoji }),
    lastActiveAt: new Date(),
  });

  return mapUserToApi(updated);
}

export async function updateDonorProfile(
  userId: string,
  data: { bloodGroup: string; lastDonationDate?: string | null; willingToDonate: boolean }
): Promise<ApiDonorProfile> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const updated = await userRepository.update(userId, {
    bloodGroup: data.bloodGroup,
    isDonor: true,
    willingToDonate: data.willingToDonate,
    lastDonationDate: data.lastDonationDate ? new Date(data.lastDonationDate) : null,
    donorVerificationStatus: 'UNDER_REVIEW',
  });

  return mapUserToApi(updated).donorProfile!;
}

export async function getDonorProfile(userId: string): Promise<ApiDonorProfile> {
  const user = await userRepository.findById(userId);
  if (!user || !user.isDonor) throw new NotFoundError('Donor profile not found');
  return mapUserToApi(user).donorProfile!;
}

export async function getNearbyDonors(
  lat: number,
  lng: number,
  radiusKm: number,
  bloodGroup?: string
): Promise<ApiDonorCard[]> {
  const donors = await userRepository.findNearbyDonors(lat, lng, radiusKm, bloodGroup);
  return donors.map((d) => mapUserToDonorCard(d, lat, lng));
}

export async function getDonorsByFilter(bloodGroups?: string[], city?: string, excludeUserId?: string): Promise<ApiDonorCard[]> {
  console.log('[DonorDiscoveryBackend] source filter: importedDonor=true');
  console.log('[DonorDiscoveryBackend] requestedBloodGroup:', bloodGroups?.join(',') ?? 'all');
  console.log('[DonorDiscoveryBackend] compatibleGroups:', bloodGroups ?? []);
  const donors = await userRepository.findDonorsByFilter(bloodGroups, city, excludeUserId);
  const cards = donors.map((d) => mapUserToDonorCard(d));
  const firstNames = cards.slice(0, 10).map(c => c.name);
  console.log('[DonorDiscoveryBackend] first imported names:', firstNames);
  return cards;
}

export async function getDonationHistory(userId: string) {
  const donations = await prisma.donation.findMany({
    where: { donorId: userId },
    include: { bloodRequest: { select: { hospitalName: true, hospitalAddress: true, requester: { select: { name: true } } } } },
    orderBy: { donationDate: 'desc' },
  });

  return donations.map((d) => ({
    id: d.id,
    date: d.donationDate.toISOString(),
    hospital: d.bloodRequest?.hospitalName ?? 'Independent Donation',
    recipient: d.bloodRequest?.requester?.name,
    units: d.units,
    bloodGroup: d.bloodGroup,
  }));
}
