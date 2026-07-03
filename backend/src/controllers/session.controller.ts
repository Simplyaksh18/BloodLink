import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError } from '../utils/ApiError';

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user!.userId, isActive: true },
    select: {
      id: true,
      deviceInfo: true,
      ipAddress: true,
      lastActiveAt: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { lastActiveAt: 'desc' },
  });
  ApiResponse.success(res, sessions);
});

export const deleteSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session || session.userId !== req.user!.userId) {
    throw new NotFoundError('Session not found');
  }
  await prisma.session.update({ where: { id }, data: { isActive: false } });
  ApiResponse.success(res, null, 'Session terminated');
});

export const deleteAllOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  // Identify current session by refresh token header (optional), else revoke ALL others
  const currentSessionId = req.headers['x-session-id'] as string | undefined;

  await prisma.session.updateMany({
    where: {
      userId: req.user!.userId,
      isActive: true,
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    },
    data: { isActive: false },
  });

  ApiResponse.success(res, null, 'All other sessions terminated');
});
