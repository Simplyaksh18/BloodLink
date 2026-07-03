import { Request, Response } from 'express';
import * as notificationService from '../services/notification.service';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { prisma } from '../config/database';

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const result = await notificationService.getUserNotifications(req.user!.userId, page, limit);
  ApiResponse.success(res, result);
});

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.getUnreadCount(req.user!.userId);
  ApiResponse.success(res, { count });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markRead(req.params.id, req.user!.userId);
  ApiResponse.success(res, null, 'Marked as read');
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markAllRead(req.user!.userId);
  ApiResponse.success(res, null, 'All marked as read');
});

export const deleteNotification = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.deleteNotification(req.params.id, req.user!.userId);
  ApiResponse.success(res, null, 'Notification deleted');
});

// POST /v1/notifications/device-token
// Upsert a push device token for the authenticated user.
export const registerDeviceToken = asyncHandler(async (req: Request, res: Response) => {
  const { token, platform, deviceId } = req.body as {
    token?: string;
    platform?: string;
    deviceId?: string;
  };

  if (!token || typeof token !== 'string') {
    res.status(400).json({ success: false, message: 'token is required' });
    return;
  }

  const userId = req.user!.userId;
  const validPlatforms = ['IOS', 'ANDROID', 'WEB', 'EXPO', 'UNKNOWN'] as const;
  type ValidPlatform = typeof validPlatforms[number];

  // Auto-detect EXPO platform from token prefix regardless of what the client sent.
  // ExponentPushToken / ExpoPushToken are always routed through Expo's push service.
  const isExpoToken =
    token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken');
  const resolvedPlatform: ValidPlatform = isExpoToken
    ? 'EXPO'
    : validPlatforms.includes((platform ?? '') as ValidPlatform)
      ? (platform as ValidPlatform)
      : 'UNKNOWN';

  const now = new Date();
  await prisma.userDeviceToken.upsert({
    where: { userId_token: { userId, token } },
    create: {
      userId,
      token,
      platform: resolvedPlatform,
      deviceId: deviceId ?? null,
      isActive: true,
      lastSeenAt: now,
    },
    update: {
      platform: resolvedPlatform,
      deviceId: deviceId ?? null,
      isActive: true,
      lastSeenAt: now,
    },
  });

  console.log(`[Push] device token registered userId: ${userId} | platform: ${resolvedPlatform}`);
  ApiResponse.success(res, null, 'Device token registered');
});

// DELETE /v1/notifications/device-token
// Deactivate a specific token (body.token) or all tokens for the user.
export const removeDeviceToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  const userId = req.user!.userId;

  await prisma.userDeviceToken.updateMany({
    where: { userId, ...(token ? { token } : {}) },
    data: { isActive: false },
  });

  console.log(`[Push] device token deactivated userId: ${userId} | specific: ${!!token}`);
  ApiResponse.success(res, null, 'Device token deactivated');
});
