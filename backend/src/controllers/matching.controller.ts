import { Request, Response } from 'express';
import { DonorResponseStatus } from '@prisma/client';
import * as donorMatchingService from '../services/donorMatching.service';
import { ApiResponse } from '../utils/ApiResponse';
import { BadRequestError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

export const getMyAcceptedRequests = asyncHandler(async (req: Request, res: Response) => {
  const donorId = req.user!.userId;
  const result = await donorMatchingService.getMyAcceptedRequests(donorId);
  ApiResponse.success(res, result);
});

export const getMyTargetedRequests = asyncHandler(async (req: Request, res: Response) => {
  const donorId = req.user!.userId;
  const result = await donorMatchingService.getMyTargetedRequests(donorId);
  ApiResponse.success(res, result);
});

export const submitProof = asyncHandler(async (req: Request, res: Response) => {
  const { id: requestId } = req.params;
  const donorId = req.user!.userId;
  const { proofImageUrl, proofNote } = req.body;
  const result = await donorMatchingService.submitDonationProof(
    donorId,
    requestId,
    proofImageUrl,
    proofNote
  );
  ApiResponse.success(res, result, 'Proof submitted');
});

export const getMatches = asyncHandler(async (req: Request, res: Response) => {
  const { id: requestId } = req.params;
  const radius = req.query.radius ? parseFloat(req.query.radius as string) : undefined;
  const result = await donorMatchingService.findMatchingDonors(requestId, radius);
  ApiResponse.success(res, result);
});

export const respondToRequest = asyncHandler(async (req: Request, res: Response) => {
  const { id: requestId } = req.params;
  const donorId = req.user!.userId;
  const { response, message } = req.body;

  if (!response || !Object.values(DonorResponseStatus).includes(response as DonorResponseStatus)) {
    throw new BadRequestError('response must be ACCEPTED or DECLINED');
  }

  const result = await donorMatchingService.respondToRequest(
    donorId,
    requestId,
    response as DonorResponseStatus,
    message
  );
  ApiResponse.success(res, result, result.wasUpdate ? 'Response updated' : 'Response recorded');
});

export const getResponses = asyncHandler(async (req: Request, res: Response) => {
  const { id: requestId } = req.params;
  const viewerId = req.user!.userId;
  const viewerRole = req.user!.role;
  const result = await donorMatchingService.getRequestResponses(requestId, viewerId, viewerRole);
  ApiResponse.success(res, result);
});
