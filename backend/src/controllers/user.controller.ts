import { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError } from '../utils/ApiError';
import { prisma } from '../config/database';

export const getNearbyDonors = asyncHandler(async (req: Request, res: Response) => {
  const { lat, lng, radius = '20', bloodGroup } = req.query as Record<string, string>;
  const donors = await userService.getNearbyDonors(
    parseFloat(lat),
    parseFloat(lng),
    parseFloat(radius),
    bloodGroup
  );
  ApiResponse.success(res, donors);
});

export const updateDonorProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await userService.updateDonorProfile(req.user!.userId, req.body);
  ApiResponse.success(res, profile, 'Donor profile updated');
});

export const getDonorProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await userService.getDonorProfile(req.user!.userId);
  ApiResponse.success(res, profile);
});

export const getDonationHistory = asyncHandler(async (req: Request, res: Response) => {
  const history = await userService.getDonationHistory(req.user!.userId);
  ApiResponse.success(res, history);
});

export const getDonorsByFilter = asyncHandler(async (req: Request, res: Response) => {
  // Accept bloodGroup as a comma-separated list (for multi-group compatibility queries)
  // e.g. ?bloodGroup=O%2B,O- or repeated ?bloodGroup=O%2B&bloodGroup=O-
  const rawBg = req.query.bloodGroup;
  const { city } = req.query as Record<string, string>;

  let bloodGroups: string[] | undefined;
  if (Array.isArray(rawBg)) {
    bloodGroups = (rawBg as string[]).filter(Boolean);
  } else if (typeof rawBg === 'string' && rawBg) {
    bloodGroups = rawBg.split(',').map(s => s.trim()).filter(Boolean);
  }

  const donors = await userService.getDonorsByFilter(
    bloodGroups && bloodGroups.length > 0 ? bloodGroups : undefined,
    city || undefined,
    req.user?.userId,          // exclude the caller from their own compatible-donors list
  );
  ApiResponse.success(res, donors);
});

export const registerDeviceToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) throw new BadRequestError('Device token is required');
  await prisma.user.update({ where: { id: req.user!.userId }, data: { deviceToken: token } });
  ApiResponse.success(res, null, 'Device token registered');
});
