import { prisma } from '../config/database';
import { DonorResponseStatus, RequestStatus } from '@prisma/client';
import { BLOOD_GROUP_COMPATIBILITY, DEFAULT_SEARCH_RADIUS_KM, DONATION_COOLDOWN_DAYS } from '../utils/constants';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/ApiError';
import { queueRequestNotification, createNotification, createBulkNotifications } from './notification.service';
import { createOrGetConversation } from './messages.service';
import { emitToUser } from '../socket/socketServer';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DonorMatch {
  donorId: string;
  name: string;
  bloodGroup: string;
  distanceKm: number;
  totalDonations: number;
  lastDonationDate: string | null;
  isEligible: boolean;
}

export interface MatchResult {
  requestId: string;
  matchedCount: number;
  matches: DonorMatch[];
  notifiedDonorIds: string[];
}

export interface DonorResponseResult {
  id: string;
  requestId: string;
  donorId: string;
  response: DonorResponseStatus;
  message: string | null;
  wasUpdate: boolean;
  requestStatus: RequestStatus;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResponsesResult {
  requestId: string;
  totalCount: number;
  acceptedCount: number;
  declinedCount: number;
  responses: {
    id: string;
    donorId: string;
    donorName: string;
    bloodGroup: string;
    response: DonorResponseStatus;
    message: string | null;
    respondedAt: string;
  }[];
}

// Active statuses that accept donor responses
const RESPONDABLE_STATUSES: RequestStatus[] = [
  RequestStatus.OPEN,
  RequestStatus.ACTIVE,
  RequestStatus.IN_PROGRESS,
];

// ── Haversine distance ─────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 1. Find matching donors ────────────────────────────────────────────────────

export async function findMatchingDonors(
  requestId: string,
  radiusKm = DEFAULT_SEARCH_RADIUS_KM
): Promise<MatchResult> {
  const request = await prisma.bloodRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      requesterId: true,
      bloodGroup: true,
      units: true,
      status: true,
      hospitalName: true,
      emergencyLevel: true,
      hospitalLatitude: true,
      hospitalLongitude: true,
    },
  });

  if (!request) throw new NotFoundError('Request not found');

  if (!RESPONDABLE_STATUSES.includes(request.status)) {
    throw new BadRequestError(`Request is not active (status: ${request.status})`);
  }

  const compatibleGroups = BLOOD_GROUP_COMPATIBILITY[request.bloodGroup] ?? [];
  if (compatibleGroups.length === 0) {
    return { requestId, matchedCount: 0, matches: [], notifiedDonorIds: [] };
  }

  // Donors who already responded to this request are excluded
  const alreadyResponded = await prisma.donorRequestResponse.findMany({
    where: { requestId },
    select: { donorId: true },
  });
  const excludedDonorIds = alreadyResponded.map((r) => r.donorId);

  const cooldownCutoff = new Date(Date.now() - DONATION_COOLDOWN_DAYS * 86_400_000);

  const candidates = await prisma.user.findMany({
    where: {
      donorStatus: 'ACTIVE',
      isDonorEligible: true,
      bloodGroup: { in: compatibleGroups },
      id: {
        not: request.requesterId,
        ...(excludedDonorIds.length > 0 && { notIn: excludedDonorIds }),
      },
      latitude: { not: null },
      longitude: { not: null },
      isActive: true,
      isDeleted: false,
      // nextEligibleDate must be null or in the past
      OR: [
        { nextEligibleDate: null },
        { nextEligibleDate: { lte: new Date() } },
      ],
      // lastDonationDate must be null or older than the 90-day cooldown window
      AND: [
        {
          OR: [
            { lastDonationDate: null },
            { lastDonationDate: { lte: cooldownCutoff } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      bloodGroup: true,
      latitude: true,
      longitude: true,
      totalDonations: true,
      lastDonationDate: true,
      isDonorEligible: true,
      willingToDonate: true,
    },
  });

  // Filter by radius and availability flag
  const reqLat = request.hospitalLatitude ?? 0;
  const reqLng = request.hospitalLongitude ?? 0;

  const matches: DonorMatch[] = candidates
    .filter((d) => {
      if (!d.latitude || !d.longitude) {
        console.log(`[NotificationMatch] skipped donor: ${d.id} | reason: no location`);
        return false;
      }
      if (!d.willingToDonate) {
        console.log(`[NotificationMatch] skipped donor: ${d.id} | reason: willingToDonate=false`);
        return false;
      }
      const dist = haversineKm(d.latitude, d.longitude, reqLat, reqLng);
      if (dist > radiusKm) {
        console.log(
          `[NotificationMatch] skipped donor: ${d.id}`,
          `| bloodGroup: ${d.bloodGroup} | reason: outside radius (${Math.round(dist)}km > ${radiusKm}km)`
        );
        return false;
      }
      return true;
    })
    .map((d) => ({
      donorId: d.id,
      name: d.name,
      bloodGroup: d.bloodGroup ?? '',
      distanceKm: Math.round(haversineKm(d.latitude!, d.longitude!, reqLat, reqLng) * 10) / 10,
      totalDonations: d.totalDonations,
      lastDonationDate: d.lastDonationDate?.toISOString() ?? null,
      isEligible: d.isDonorEligible,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // Log compatible vs. skipped (all candidates from DB are already blood-compatible;
  // the radius/willingToDonate filter below may shrink the set further)
  console.log(
    `[DonorMatching] requestId: ${requestId} | bloodGroup: ${request.bloodGroup}`,
    `| compatibleGroups: [${compatibleGroups.join(', ')}]`,
    `| candidates: ${candidates.length} | within ${radiusKm}km: ${matches.length}`
  );
  console.log(`[NotificationMatch] compatible donor count: ${matches.length}`);

  // Notify each matched donor.
  // Dedup: skip any donor who already has a REQUEST_MATCHED notification for this exact
  // request — regardless of when it was sent. This makes the function safe to call
  // multiple times (retrigger) without sending duplicates.
  let notifiedDonorIds: string[] = [];

  if (matches.length > 0) {
    try {
      const previouslyNotified = await prisma.notification.findMany({
        where: {
          notificationType: 'REQUEST_MATCHED',
          relatedRequestId: requestId,
        },
        select: { userId: true },
      });
      const alreadyNotifiedIds = new Set(previouslyNotified.map((n) => n.userId));

      const toNotify = matches
        .map((m) => m.donorId)
        .filter((id) => !alreadyNotifiedIds.has(id));

      if (toNotify.length > 0) {
        notifiedDonorIds = toNotify;
        console.log(`[NotificationMatch] notified donorIds: [${toNotify.join(', ')}]`);
        await createBulkNotifications(
          toNotify,
          'REQUEST_MATCHED',
          'Blood request near you',
          `${request.bloodGroup} blood needed at ${request.hospitalName ?? 'a nearby hospital'}`,
          { requestId, bloodGroup: request.bloodGroup, urgency: request.emergencyLevel }
        );
      } else {
        console.log(`[NotificationMatch] all matched donors already notified for requestId: ${requestId}`);
      }
    } catch (err) {
      console.log('[Notification] REQUEST_MATCHED error:', err);
    }
  }

  return { requestId, matchedCount: matches.length, matches, notifiedDonorIds };
}

// ── 1b. Targeted donor notification ──────────────────────────────────────────

export async function notifyTargetedDonor(
  requestId: string,
  targetedDonorId: string,
  bloodGroup: string,
  hospitalName: string
): Promise<void> {
  console.log('[TargetedRequest] notified only donorId:', targetedDonorId);
  await createNotification(
    targetedDonorId,
    'REQUEST_MATCHED',
    'You have been personally requested',
    `${bloodGroup} blood needed at ${hospitalName}`,
    { requestId, bloodGroup }
  );
}

// ── 2. Donor responds to a request ────────────────────────────────────────────

export async function respondToRequest(
  donorId: string,
  requestId: string,
  response: DonorResponseStatus,
  message?: string
): Promise<DonorResponseResult> {
  // Load request
  const request = await prisma.bloodRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requesterId: true, bloodGroup: true, units: true, status: true, targetedDonorId: true },
  });
  if (!request) throw new NotFoundError('Request not found');

  if (!RESPONDABLE_STATUSES.includes(request.status)) {
    throw new BadRequestError(`Request is not accepting responses (status: ${request.status})`);
  }

  // Donor cannot respond to their own request
  if (request.requesterId === donorId) {
    throw new ForbiddenError('You cannot respond to your own blood request');
  }

  // Targeted request guard: only the designated donor can accept/decline
  if (request.targetedDonorId && request.targetedDonorId !== donorId) {
    console.log(`[TargetedRequest] blocked non-target donor: ${donorId} | targetedDonorId: ${request.targetedDonorId}`);
    throw new ForbiddenError('This request is assigned to another donor');
  }

  // Verify donor eligibility
  const donor = await prisma.user.findUnique({
    where: { id: donorId },
    select: {
      id: true,
      donorStatus: true,
      isDonorEligible: true,
      bloodGroup: true,
      nextEligibleDate: true,
    },
  });
  if (!donor) throw new NotFoundError('Donor not found');

  if (donor.donorStatus !== 'ACTIVE' || !donor.isDonorEligible) {
    throw new ForbiddenError('You must be an active eligible donor to respond to requests');
  }

  // Cooldown check
  if (donor.nextEligibleDate && donor.nextEligibleDate > new Date()) {
    throw new ForbiddenError('You are currently in donation cooldown and cannot respond');
  }

  // Blood compatibility check
  const compatibleGroups = BLOOD_GROUP_COMPATIBILITY[request.bloodGroup] ?? [];
  const compatible = !!donor.bloodGroup && compatibleGroups.includes(donor.bloodGroup);
  console.log(`[DonorResponse] compatibility check donorBloodGroup: ${donor.bloodGroup ?? 'null'}`);
  console.log(`[DonorResponse] requestBloodGroup: ${request.bloodGroup}`);
  console.log(`[DonorResponse] compatible: ${compatible} | allowedDonors: [${compatibleGroups.join(', ')}]`);
  if (!compatible) {
    throw new ForbiddenError(
      `Your blood group (${donor.bloodGroup ?? 'unknown'}) is not compatible with this request (${request.bloodGroup})`
    );
  }

  // Upsert response
  const existing = await prisma.donorRequestResponse.findUnique({
    where: { requestId_donorId: { requestId, donorId } },
  });

  let donorResponse;
  if (existing) {
    donorResponse = await prisma.donorRequestResponse.update({
      where: { requestId_donorId: { requestId, donorId } },
      data: { response, message: message ?? null },
    });
    console.log(`[DonorResponse] updated — donorId: ${donorId} | requestId: ${requestId} | response: ${response}`);
  } else {
    donorResponse = await prisma.donorRequestResponse.create({
      data: { id: crypto.randomUUID(), requestId, donorId, response, message: message ?? null },
    });
    console.log(`[DonorResponse] created — donorId: ${donorId} | requestId: ${requestId} | response: ${response}`);
  }

  // Lifecycle: if accepted donors >= units requested, move to IN_PROGRESS
  let currentStatus = request.status;
  if (response === DonorResponseStatus.ACCEPTED) {
    const acceptedCount = await prisma.donorRequestResponse.count({
      where: { requestId, response: DonorResponseStatus.ACCEPTED },
    });
    if (
      acceptedCount >= request.units &&
      (request.status === RequestStatus.ACTIVE || request.status === RequestStatus.OPEN)
    ) {
      await prisma.bloodRequest.update({
        where: { id: requestId },
        data: { status: RequestStatus.IN_PROGRESS },
      });
      currentStatus = RequestStatus.IN_PROGRESS;
      console.log(
        `[DonorResponse] request ${requestId} moved to IN_PROGRESS`,
        `(${acceptedCount} accepted >= ${request.units} units)`
      );
    }
  }

  // Create conversation when donor accepts (idempotent — safe to call on re-accept)
  let conversationId: string | undefined;
  if (response === DonorResponseStatus.ACCEPTED) {
    try {
      const conv = await createOrGetConversation(requestId, request.requesterId, donorId);
      conversationId = conv.conversationId;
    } catch (err) {
      console.log('[Conversation] creation failed (non-fatal):', err);
    }
  }

  // Notify requester in real-time so their Activity tab refreshes without manual pull-to-refresh
  if (response === DonorResponseStatus.ACCEPTED) {
    try {
      emitToUser(request.requesterId, 'request:updated', { requestId, status: currentStatus });
      console.log(`[Socket] emitted request:updated to requester: ${request.requesterId} | status: ${currentStatus}`);
    } catch {
      // socket emit must never break the response flow
    }
  }

  // Notification placeholder
  queueRequestNotification(requestId, donorId, response);

  return {
    id: donorResponse.id,
    requestId: donorResponse.requestId,
    donorId: donorResponse.donorId,
    response: donorResponse.response,
    message: donorResponse.message,
    wasUpdate: !!existing,
    requestStatus: currentStatus,
    conversationId,
    createdAt: donorResponse.createdAt.toISOString(),
    updatedAt: donorResponse.updatedAt.toISOString(),
  };
}

// ── 3a. Targeted requests pending donor response ──────────────────────────────

export interface PendingTargetedRequest {
  requestId: string;
  requestStatus: string;
  bloodGroup: string;
  units: number;
  hospitalName: string;
  emergencyLevel: string;
  requesterName: string;
  createdAt: string;
  conversationId?: string;
  // Donor's own response to this targeted request (null = not yet responded)
  donorResponseStatus: string | null;
  responseId: string | null;
  proofSubmittedAt: string | null;
  proofNote: string | null;
}

export async function getMyTargetedRequests(donorId: string): Promise<PendingTargetedRequest[]> {
  console.log('[TargetedActivity] fetching for donorId:', donorId);

  const rows = await prisma.bloodRequest.findMany({
    where: {
      targetedDonorId: donorId,
      status: { in: [RequestStatus.OPEN, RequestStatus.ACTIVE, RequestStatus.IN_PROGRESS] },
    },
    include: {
      requester: { select: { name: true } },
      conversations: { select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log('[TargetedActivity] pending targeted count:', rows.length);

  if (rows.length === 0) return [];

  // Batch-fetch this donor's existing responses for all targeted requests in one query
  const existingResponses = await prisma.donorRequestResponse.findMany({
    where: { donorId, requestId: { in: rows.map(r => r.id) } },
    select: { id: true, requestId: true, response: true, proofSubmittedAt: true, proofNote: true },
  });
  const responseByReqId = new Map(existingResponses.map(r => [r.requestId, r]));

  return rows.map((r) => {
    console.log('[TargetedActivity] mapped requestId:', r.id);
    const dr = responseByReqId.get(r.id) ?? null;
    return {
      requestId:           r.id,
      requestStatus:       r.status,
      bloodGroup:          r.bloodGroup,
      units:               r.units,
      hospitalName:        r.hospitalName,
      emergencyLevel:      r.emergencyLevel,
      requesterName:       r.requester.name,
      createdAt:           r.createdAt.toISOString(),
      conversationId:      (r as any).conversations?.[0]?.id,
      donorResponseStatus: dr?.response ?? null,
      responseId:          dr?.id ?? null,
      proofSubmittedAt:    dr?.proofSubmittedAt?.toISOString() ?? null,
      proofNote:           dr?.proofNote ?? null,
    };
  });
}

// ── 3. Donor's accepted requests list (Phase 4.4) ─────────────────────────────

export interface AcceptedRequestItem {
  responseId: string;
  requestId: string;
  requestStatus: string;
  bloodGroup: string;
  units: number;
  hospitalName: string;
  emergencyLevel: string;
  requesterName: string;
  createdAt: string;
  respondedAt: string;
  proofSubmittedAt: string | null;
  proofNote: string | null;
}

export async function getMyAcceptedRequests(donorId: string): Promise<AcceptedRequestItem[]> {
  const rows = await prisma.donorRequestResponse.findMany({
    where: { donorId, response: DonorResponseStatus.ACCEPTED },
    include: {
      request: {
        include: { requester: { select: { name: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows.map((r) => ({
    responseId:      r.id,
    requestId:       r.requestId,
    requestStatus:   r.request.status,
    bloodGroup:      r.request.bloodGroup,
    units:           r.request.units,
    hospitalName:    r.request.hospitalName,
    emergencyLevel:  r.request.emergencyLevel,
    requesterName:   r.request.requester.name,
    createdAt:       r.request.createdAt.toISOString(),
    respondedAt:     r.updatedAt.toISOString(),
    proofSubmittedAt: r.proofSubmittedAt?.toISOString() ?? null,
    proofNote:        r.proofNote ?? null,
  }));
}

// ── 4. Submit donation proof (Phase 4.4) ──────────────────────────────────────

export interface ProofResult {
  responseId:      string;
  requestId:       string;
  proofImageUrl:   string | null;
  proofNote:       string | null;
  proofSubmittedAt: string;
}

export async function submitDonationProof(
  donorId: string,
  requestId: string,
  proofImageUrl?: string,
  proofNote?: string
): Promise<ProofResult> {
  if (!proofImageUrl) {
    throw new BadRequestError('Please upload donation proof photo.');
  }

  const existing = await prisma.donorRequestResponse.findUnique({
    where: { requestId_donorId: { requestId, donorId } },
  });
  if (!existing || existing.response !== DonorResponseStatus.ACCEPTED) {
    throw new ForbiddenError('You have not accepted this request');
  }

  const request = await prisma.bloodRequest.findUnique({
    where: { id: requestId },
    select: { status: true, requesterId: true, bloodGroup: true },
  });
  if (!request) throw new NotFoundError('Request not found');
  if (
    request.status !== RequestStatus.OPEN &&
    request.status !== RequestStatus.ACTIVE &&
    request.status !== RequestStatus.IN_PROGRESS
  ) {
    throw new BadRequestError('Proof can only be submitted for active or in-progress requests');
  }

  const now = new Date();
  const updated = await prisma.donorRequestResponse.update({
    where: { requestId_donorId: { requestId, donorId } },
    data: {
      proofImageUrl:    proofImageUrl ?? null,
      proofNote:        proofNote ?? null,
      proofSubmittedAt: now,
    },
  });

  console.log(`[DonationProof] backend success — requestId: ${requestId} | donorId: ${donorId}`);

  // Notify requester that proof was submitted — fire-and-forget, must not break flow
  createNotification(
    request.requesterId,
    'DONATION_PROOF_SUBMITTED',
    'Donation proof submitted',
    `A donor submitted proof for your ${request.bloodGroup} blood request`,
    { requestId, donorId }
  ).catch((err) => console.log('[Notification] DONATION_PROOF_SUBMITTED error:', err));

  return {
    responseId:      updated.id,
    requestId:       updated.requestId,
    proofImageUrl:   updated.proofImageUrl ?? null,
    proofNote:       updated.proofNote ?? null,
    proofSubmittedAt: now.toISOString(),
  };
}

// ── 5. Get responses for a request (requester or admin only) ──────────────────

export async function getRequestResponses(
  requestId: string,
  viewerId: string,
  viewerRole: string
): Promise<ResponsesResult> {
  const request = await prisma.bloodRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requesterId: true },
  });
  if (!request) throw new NotFoundError('Request not found');

  const isAdmin = viewerRole === 'ADMIN' || viewerRole === 'SUPER_ADMIN';
  if (request.requesterId !== viewerId && !isAdmin) {
    throw new ForbiddenError('Only the requester or an admin can view responses');
  }

  const rows = await prisma.donorRequestResponse.findMany({
    where: { requestId },
    include: {
      donor: { select: { id: true, name: true, bloodGroup: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const acceptedCount = rows.filter((r) => r.response === DonorResponseStatus.ACCEPTED).length;
  const declinedCount = rows.filter((r) => r.response === DonorResponseStatus.DECLINED).length;

  return {
    requestId,
    totalCount: rows.length,
    acceptedCount,
    declinedCount,
    responses: rows.map((r) => ({
      id: r.id,
      donorId: r.donorId,
      donorName: r.donor.name,
      bloodGroup: r.donor.bloodGroup ?? '',
      response: r.response,
      message: r.message,
      respondedAt: r.updatedAt.toISOString(),
    })),
  };
}
