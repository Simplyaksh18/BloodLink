import { Request, Response } from 'express';
import * as requestService from '../services/request.service';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { prisma } from '../config/database';
import { findMatchingDonors, notifyTargetedDonor } from '../services/donorMatching.service';
import { auditFromRequest } from '../services/audit.service';
import { BLOOD_GROUP_COMPATIBILITY } from '../utils/constants';

export const getRequests = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const bloodGroup = req.query.bloodGroup as string | undefined;
  const priority = req.query.priority as string | undefined;
  const eligibleForMe = req.query.eligibleForMe === 'true';

  let donorBloodGroup: string | undefined;
  let excludeRequesterId: string | undefined;

  if (eligibleForMe && req.user) {
    const caller = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { bloodGroup: true, donorStatus: true, isDonorEligible: true, location: true },
    });

    const callerStatus = caller?.donorStatus ?? 'NEVER_DONATED';
    const callerIsEligible = caller?.isDonorEligible ?? false;
    donorBloodGroup = caller?.bloodGroup ?? undefined;
    excludeRequesterId = req.user.userId;

    const compatibleGroups = donorBloodGroup
      ? Object.entries(BLOOD_GROUP_COMPATIBILITY)
          .filter(([, donors]) => donors.includes(donorBloodGroup!))
          .map(([reqBg]) => reqBg)
      : [];

    console.log('[NearbyEligibleRequests] userId:', req.user.userId);
    console.log('[NearbyEligibleRequests] donorBloodGroup:', donorBloodGroup ?? 'unknown');
    console.log('[NearbyEligibleRequests] donorStatus:', callerStatus);
    console.log('[NearbyEligibleRequests] isDonorEligible:', callerIsEligible);
    console.log('[NearbyEligibleRequests] location:', caller?.location ? 'set' : 'unset');
    console.log('[NearbyEligibleRequests] compatibleGroups:', compatibleGroups);

    // Gate: donor must be ACTIVE and eligible — backend enforces, not just frontend
    if (callerStatus !== 'ACTIVE' || !callerIsEligible) {
      console.log('[NearbyEligibleRequests] rawCount: 0 (donor not ACTIVE/eligible)');
      console.log('[NearbyEligibleRequests] afterStatus: 0');
      console.log('[NearbyEligibleRequests] afterCompatibility: 0');
      console.log('[NearbyEligibleRequests] afterDistance: 0');
      console.log('[NearbyEligibleRequests] finalCount: 0');
      return ApiResponse.success(res, { data: [], total: 0, page, limit, hasMore: false });
    }
  }

  const result = await requestService.getRequests(
    page,
    limit,
    bloodGroup,
    priority,
    donorBloodGroup,
    excludeRequesterId,
    req.user?.userId // targeted filter: show this donor their targeted requests
  );

  if (eligibleForMe && req.user) {
    console.log('[NearbyEligibleRequests] rawCount:', result.total);
    console.log('[NearbyEligibleRequests] afterStatus:', result.total);
    console.log('[NearbyEligibleRequests] afterCompatibility:', result.total);
    console.log('[NearbyEligibleRequests] afterDistance:', result.total);
    console.log('[NearbyEligibleRequests] finalCount:', result.data.length);
  }

  return ApiResponse.success(res, result);
});

export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await requestService.createRequest(req.user!.userId, req.body);
  ApiResponse.created(res, request, 'Blood request created');

  // Audit — fire-and-forget, never blocks response
  auditFromRequest(req, request.targetedDonorId ? 'TARGETED_REQUEST_CREATED' : 'DONOR_REQUEST_CREATED', {
    entityType: 'BloodRequest',
    entityId: request.id,
    metadata: { bloodGroup: request.bloodGroup, hospitalName: request.hospitalName },
  });

  if (request.targetedDonorId) {
    // Targeted request — skip universal matching, notify only the designated donor
    console.log('[TargetedRequest] created requestId:', request.id, '| donorId:', request.targetedDonorId);
    notifyTargetedDonor(request.id, request.targetedDonorId, request.bloodGroup, request.hospitalName).catch(
      (err) => console.log('[TargetedRequest] notification error:', err?.message ?? err)
    );
  } else {
    // Universal request — fire-and-forget donor matching + notification
    console.log('[RequestCreate] matching donors for notification requestId:', request.id);
    findMatchingDonors(request.id).catch((err) =>
      console.log('[NotificationMatch] error:', err?.message ?? err)
    );
  }
  return;
});

export const getFeed = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const bloodGroup = req.query.bloodGroup as string | undefined;
  const feed = await requestService.getFeed(page, limit, bloodGroup);
  return ApiResponse.success(res, feed);
});

export const getMyRequests = asyncHandler(async (req: Request, res: Response) => {
  const requests = await requestService.getMyRequests(req.user!.userId);
  return ApiResponse.success(res, requests);
});

export const getNearbyRequests = asyncHandler(async (req: Request, res: Response) => {
  const { lat, lng, radius = '20', bloodGroup } = req.query as Record<string, string>;
  const requests = await requestService.getNearbyRequests(
    parseFloat(lat),
    parseFloat(lng),
    parseFloat(radius),
    bloodGroup
  );
  return ApiResponse.success(res, requests);
});

export const getRequestById = asyncHandler(async (req: Request, res: Response) => {
  const request = await requestService.getRequestById(req.params.id);
  return ApiResponse.success(res, request);
});

export const cancelRequest = asyncHandler(async (req: Request, res: Response) => {
  const updated = await requestService.cancelRequest(req.params.id, req.user!.userId, req.user!.role);
  return ApiResponse.success(res, updated, 'Request cancelled');
});

export const fulfillRequest = asyncHandler(async (req: Request, res: Response) => {
  const updated = await requestService.markFulfilled(req.params.id, req.user!.userId, req.user!.role);
  return ApiResponse.success(res, updated, 'Request marked as fulfilled');
});
