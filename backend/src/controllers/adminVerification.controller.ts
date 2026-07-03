import { Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import * as verificationService from '../services/verification.service';
import { FRAUD_SCORE_THRESHOLD } from '../types/verification.types';

const DEPRECATED = {
  message: 'Manual review has been deprecated. All verifications are now automated.',
  pendingCount: 0,
};

export const getQueue = asyncHandler(async (_req: Request, res: Response) => {
  ApiResponse.success(res, { ...DEPRECATED, items: [], total: 0, page: 1, limit: 20, hasMore: false });
});

export const getVerificationDetail = asyncHandler(async (req: Request, res: Response) => {
  const result = await verificationService.getVerificationDetail(req.params.id);
  ApiResponse.success(res, result);
});

export const approve = asyncHandler(async (_req: Request, res: Response) => {
  ApiResponse.success(res, DEPRECATED);
});

export const reject = asyncHandler(async (_req: Request, res: Response) => {
  ApiResponse.success(res, DEPRECATED);
});

export const assign = asyncHandler(async (_req: Request, res: Response) => {
  ApiResponse.success(res, DEPRECATED);
});

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await verificationService.getStats();
  ApiResponse.success(res, stats);
});

export const getFraudAlerts = asyncHandler(async (req: Request, res: Response) => {
  const minScore = parseInt(req.query.minScore as string) || FRAUD_SCORE_THRESHOLD;
  const onlyUnresolved = req.query.resolved !== 'true';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const result = await verificationService.getFraudAlerts(minScore, onlyUnresolved, page, limit);
  ApiResponse.success(res, result);
});

export const resolveFraudAlert = asyncHandler(async (req: Request, res: Response) => {
  const result = await verificationService.resolveFraudAlert(req.params.alertId, req.user!.userId);
  ApiResponse.success(res, result, 'Fraud alert resolved');
});

export const getHighFraudVerifications = asyncHandler(async (req: Request, res: Response) => {
  const minScore = parseInt(req.query.minScore as string) || FRAUD_SCORE_THRESHOLD;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const result = await verificationService.getHighFraudVerifications(minScore, page, limit);
  ApiResponse.success(res, result);
});
