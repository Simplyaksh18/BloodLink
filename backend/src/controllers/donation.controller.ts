import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiResponse } from '../utils/ApiResponse';
import { prisma } from '../config/database';
import { DonorResponseStatus, RequestStatus } from '@prisma/client';

export const getDonationHistory = asyncHandler(async (req: Request, res: Response) => {
  const donorId = req.user!.userId;

  const rows = await prisma.donorRequestResponse.findMany({
    where: {
      donorId,
      response:        DonorResponseStatus.ACCEPTED,
      proofSubmittedAt: { not: null },
      request: { status: RequestStatus.FULFILLED },
    },
    select: {
      id:              true,
      proofImageUrl:   true,
      proofNote:       true,
      proofSubmittedAt: true,
      request: {
        select: {
          id:           true,
          bloodGroup:   true,
          hospitalName: true,
          units:        true,
          updatedAt:    true,
          status:       true,
        },
      },
    },
    orderBy: { proofSubmittedAt: 'desc' },
  });

  const data = rows.map(r => ({
    responseId:      r.id,
    requestId:       r.request.id,
    hospitalName:    r.request.hospitalName,
    bloodGroup:      r.request.bloodGroup,
    units:           r.request.units,
    donatedAt:       r.proofSubmittedAt!.toISOString(),
    fulfilledAt:     r.request.updatedAt.toISOString(),
    proofSubmittedAt: r.proofSubmittedAt!.toISOString(),
    proofImageUrl:   r.proofImageUrl ?? null,
    proofNote:       r.proofNote ?? null,
    status:          r.request.status,
  }));

  ApiResponse.success(res, data);
});
