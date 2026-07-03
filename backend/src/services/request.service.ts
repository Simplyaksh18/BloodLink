import { requestRepository } from '../repositories/request.repository';
import { ApiBloodRequest, BloodGroup, EmergencyLevel, UploadedDocument } from '../types';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/ApiError';
import { BLOOD_GROUP_COMPATIBILITY, EMERGENCY_LEVEL_MAP, PRIORITY_TO_LEVEL_MAP } from '../utils/constants';
import { BloodRequest, DonorResponseStatus, DonorStatus, EmergencyPriority, RequestStatus, RequestVerificationStatus } from '@prisma/client';
import { queueLifecycleNotification } from './notification.service';
import { createOrGetConversation } from './messages.service';
import { prisma } from '../config/database';

// Compute which REQUEST blood groups a given DONOR blood group can respond to.
// Inverse of BLOOD_GROUP_COMPATIBILITY (which maps request → compatible donors).
function getCompatibleRequestBloodGroups(donorBloodGroup: string): string[] {
  return Object.entries(BLOOD_GROUP_COMPATIBILITY)
    .filter(([, donors]) => donors.includes(donorBloodGroup))
    .map(([requestBg]) => requestBg);
}

// Expiry windows by urgency (Phase 4 rule)
const EXPIRY_HOURS: Record<string, number> = { RED: 6, YELLOW: 24, GREEN: 72 };

function computeExpiresAt(urgency: string): Date {
  const hours = EXPIRY_HOURS[urgency] ?? 24;
  return new Date(Date.now() + hours * 3_600_000);
}

type RequestWithRelations = BloodRequest & {
  requester: { id: string; name: string; phone: string };
  documents: { id: string; documentType: string; url: string }[];
};

function mapRequest(r: RequestWithRelations): ApiBloodRequest {
  return {
    id: r.id,
    userId: r.requesterId,
    requesterName: r.requester.name,
    bloodGroup: r.bloodGroup as BloodGroup,
    units: r.units,
    hospitalName: r.hospitalName,
    location: {
      latitude: r.hospitalLatitude ?? 0,
      longitude: r.hospitalLongitude ?? 0,
      address: r.hospitalAddress,
      city: r.hospitalCity,
      state: '',
      pincode: '',
    },
    emergencyLevel: PRIORITY_TO_LEVEL_MAP[r.emergencyLevel] as EmergencyLevel,
    documents: r.documents.map((d) => ({
      id: d.id,
      type: d.documentType as UploadedDocument['type'],
      uri: d.url,
      fileName: d.url.split('/').pop() ?? '',
      mimeType: 'application/octet-stream',
      uploadedAt: new Date().toISOString(),
      status: 'uploaded' as const,
    })),
    verificationStatus: mapVerifStatus(r.verificationStatus),
    status: mapStatus(r.status),
    rawStatus: r.status as ApiBloodRequest['rawStatus'],
    bloodBankId: r.bloodBankId ?? undefined,
    targetedDonorId: r.targetedDonorId ?? undefined,
    // conversationId is set only on createRequest for targeted requests
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function mapStatus(s: RequestStatus): ApiBloodRequest['status'] {
  const m: Record<RequestStatus, ApiBloodRequest['status']> = {
    OPEN:        'open',
    ACTIVE:      'open',      // treated as open for frontend consumers
    IN_PROGRESS: 'open',      // still accepting donors
    FULFILLED:   'fulfilled',
    CANCELLED:   'cancelled',
    EXPIRED:     'cancelled', // expired requests are closed
  };
  return m[s] ?? 'open';
}

function mapVerifStatus(s: RequestVerificationStatus): ApiBloodRequest['verificationStatus'] {
  const m: Record<RequestVerificationStatus, ApiBloodRequest['verificationStatus']> = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  };
  return m[s];
}

export async function createRequest(
  requesterId: string,
  data: {
    bloodGroup: string;
    units: number;
    hospitalName: string;
    address: string;
    city: string;
    // Phase 4: urgency preferred; emergencyLevel kept for backward compat
    urgency?: string;
    emergencyLevel?: string;
    contactPhone: string;
    hospitalLatitude: number;
    hospitalLongitude: number;
    requiredBy: string;
    reason?: string;
    documents?: unknown[];
    patientName?: string;
    patientAge?: number;
    patientGender?: string;
    hospitalContact?: string;
    doctorName?: string;
    doctorContact?: string;
    notes?: string;
    targetedDonorId?: string;
  }
): Promise<ApiBloodRequest> {
  // Resolve urgency: prefer explicit 'urgency' (RED/YELLOW/GREEN), fall back to mapped emergencyLevel
  const rawUrgency = data.urgency ??
    (data.emergencyLevel ? EMERGENCY_LEVEL_MAP[data.emergencyLevel as keyof typeof EMERGENCY_LEVEL_MAP] : undefined) ??
    'YELLOW';
  const priority = rawUrgency as EmergencyPriority;
  const expiresAt = computeExpiresAt(rawUrgency);

  console.log('[BloodRequest] creating request — requesterId:', requesterId,
    '| bloodGroup:', data.bloodGroup,
    '| units:', data.units,
    '| hospitalName:', data.hospitalName);
  console.log('[BloodRequest] urgency:', rawUrgency,
    '| expiresAt:', expiresAt.toISOString(),
    '| requiredBy:', data.requiredBy);
  if (data.targetedDonorId) {
    console.log('[TargetedRequestCreate] using relation connect | donorId:', data.targetedDonorId);
  }

  const request = await requestRepository.create({
    requester:     { connect: { id: requesterId } },
    bloodGroup:    data.bloodGroup,
    units:         data.units,
    hospitalName:  data.hospitalName,
    hospitalAddress: data.address,
    hospitalCity:  data.city,
    emergencyLevel: priority,
    status:        RequestStatus.ACTIVE,
    expiresAt,
    hospitalLatitude:  data.hospitalLatitude,
    hospitalLongitude: data.hospitalLongitude,
    hospitalContact:   data.contactPhone,
    reason:        data.reason,
    notes:         data.notes,
    requiredBy:    new Date(data.requiredBy),
    patientName:   data.patientName,
    patientAge:    data.patientAge,
    patientGender: data.patientGender,
    doctorName:    data.doctorName,
    doctorContact: data.doctorContact,
    // Relation connect — Prisma CreateInput requires this form, not raw scalar
    ...(data.targetedDonorId
      ? { targetedDonor: { connect: { id: data.targetedDonorId } } }
      : {}),
  });

  console.log('[BloodRequest] created — id:', request.id,
    '| status:', request.status,
    '| expiresAt:', request.expiresAt?.toISOString() ?? 'null');

  let conversationId: string | undefined;
  if (data.targetedDonorId) {
    console.log('[TargetedRequestCreate] created:', request.id, '| targetedDonorId:', data.targetedDonorId);
    try {
      const conv = await createOrGetConversation(request.id, requesterId, data.targetedDonorId);
      conversationId = conv.conversationId;
      console.log('[TargetedRequestCreate] conversation created/reused:', conversationId);
    } catch (err) {
      console.log('[TargetedRequestCreate] conversation error (non-fatal):', (err as any)?.message ?? err);
    }
  }

  return { ...mapRequest(request), ...(conversationId && { conversationId }) };
}

export async function getRequests(
  page: number,
  limit: number,
  bloodGroup?: string,
  priority?: string,
  donorBloodGroup?: string,
  excludeRequesterId?: string,
  currentUserId?: string,
) {
  // If donor blood group provided, restrict results to requests the donor can respond to
  const donorCompatibleRequestGroups = donorBloodGroup
    ? getCompatibleRequestBloodGroups(donorBloodGroup)
    : undefined;

  const { items, total } = await requestRepository.findAll(
    page, limit, bloodGroup, priority, donorCompatibleRequestGroups, excludeRequesterId, currentUserId
  );
  return {
    data: items.map(mapRequest),
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}

export async function getFeed(page: number, limit: number, bloodGroup?: string) {
  const { items, total } = await requestRepository.findFeed(page, limit, bloodGroup);
  return {
    data: items.map(mapRequest),
    total,
    page,
    limit,
    hasMore: page * limit < total,
  };
}

export async function getMyRequests(requesterId: string): Promise<ApiBloodRequest[]> {
  const requests = await requestRepository.findByRequesterId(requesterId);
  return requests.map(mapRequest);
}

export async function getNearbyRequests(
  lat: number,
  lng: number,
  radiusKm: number,
  bloodGroup?: string
): Promise<ApiBloodRequest[]> {
  const requests = await requestRepository.findNearby(lat, lng, radiusKm, bloodGroup);
  return requests.map(mapRequest);
}

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

export async function cancelRequest(
  id: string,
  actorId: string,
  role: string
): Promise<ApiBloodRequest> {
  const request = await requestRepository.findById(id);
  if (!request) throw new NotFoundError('Request not found');

  const isOwner = request.requesterId === actorId;
  const isAdmin = ADMIN_ROLES.has(role);
  if (!isOwner && !isAdmin) throw new ForbiddenError('Only the requester or an admin can cancel this request');

  if (request.status === RequestStatus.FULFILLED) {
    throw new BadRequestError('Cannot cancel a request that has already been fulfilled');
  }
  if (request.status === RequestStatus.EXPIRED) {
    throw new BadRequestError('Cannot cancel an expired request');
  }
  if (request.status === RequestStatus.CANCELLED) {
    throw new BadRequestError('Request is already cancelled');
  }

  console.log(`[RequestLifecycle] cancel — requestId: ${id} | actor: ${actorId} | role: ${role}`);
  const updated = await requestRepository.updateStatus(id, RequestStatus.CANCELLED);
  queueLifecycleNotification(id, 'CANCELLED', actorId);
  return mapRequest(updated);
}

export async function markFulfilled(
  id: string,
  actorId: string,
  role: string
): Promise<ApiBloodRequest> {
  const request = await requestRepository.findById(id);
  if (!request) throw new NotFoundError('Request not found');

  const isOwner = request.requesterId === actorId;
  const isAdmin = ADMIN_ROLES.has(role);
  if (!isOwner && !isAdmin) throw new ForbiddenError('Only the requester or an admin can mark this request fulfilled');

  if (request.status === RequestStatus.CANCELLED) {
    throw new BadRequestError('Cannot fulfil a cancelled request');
  }
  if (request.status === RequestStatus.EXPIRED) {
    throw new BadRequestError('Cannot fulfil an expired request');
  }
  if (request.status === RequestStatus.FULFILLED) {
    throw new BadRequestError('Request is already fulfilled');
  }

  // Find accepted donor responses (with proof preferred)
  const acceptedResponses = await prisma.donorRequestResponse.findMany({
    where: { requestId: id, response: DonorResponseStatus.ACCEPTED },
    select: { donorId: true, proofSubmittedAt: true },
  });

  const withProof    = acceptedResponses.filter(r => r.proofSubmittedAt !== null);
  const toCredit     = withProof.length > 0 ? withProof : [];

  if (toCredit.length === 0) {
    throw new BadRequestError('Donation proof is required before marking fulfilled. No donor has submitted proof yet.');
  }

  const now          = new Date();
  const cooldownEnd  = new Date(now);
  cooldownEnd.setDate(cooldownEnd.getDate() + 90);

  console.log(`[RequestLifecycle] fulfill — requestId: ${id} | actor: ${actorId} | role: ${role} | creditingDonors: ${toCredit.map(r => r.donorId).join(', ')}`);

  // Credit each proven donor — increment donations + apply 90-day DEFERRED cooldown
  for (const { donorId } of toCredit) {
    await prisma.user.update({
      where: { id: donorId },
      data: {
        totalDonations:      { increment: 1 },
        lastDonationDate:    now,
        donorStatus:         DonorStatus.DEFERRED,
        isDonorEligible:     false,
        isDonor:             true,
        deferralReason:      'Recent blood donation — please wait before donating again.',
        deferralDate:        now,
        nextEligibleDate:    cooldownEnd,
        eligibilityCheckedAt: now,
      },
    });
    console.log(`[DonorCredit] donated — donorId: ${donorId} | nextEligibleDate: ${cooldownEnd.toISOString()}`);
  }

  const updated = await requestRepository.updateStatus(id, RequestStatus.FULFILLED);
  queueLifecycleNotification(id, 'FULFILLED', actorId);
  return mapRequest(updated);
}

export async function expireOldRequests(): Promise<number> {
  const expired = await requestRepository.findExpired();
  if (expired.length === 0) return 0;

  for (const r of expired) {
    await requestRepository.updateStatus(r.id, RequestStatus.EXPIRED);
    queueLifecycleNotification(r.id, 'EXPIRED', 'system');
  }

  console.log(`[RequestExpiry] expired ${expired.length} request(s)`);
  return expired.length;
}

export async function getRequestById(id: string): Promise<ApiBloodRequest> {
  const request = await requestRepository.findById(id);
  if (!request) throw new NotFoundError('Request not found');
  return mapRequest(request);
}
