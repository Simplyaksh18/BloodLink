import { Request, Response } from 'express';
import * as bloodBankService from '../services/bloodBank.service';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError } from '../utils/ApiError';

// ─── Public ────────────────────────────────────────────────────────────────────

export const getAllBanks = asyncHandler(async (req: Request, res: Response) => {
  const { city, bloodGroup } = req.query as Record<string, string>;
  const banks = await bloodBankService.getAllBanks({ city, bloodGroup });
  ApiResponse.success(res, banks);
});

export const getNearbyBanks = asyncHandler(async (req: Request, res: Response) => {
  const { lat, lng, radius = '20' } = req.query as Record<string, string>;
  const banks = await bloodBankService.getNearbyBanks(parseFloat(lat), parseFloat(lng), parseFloat(radius));
  ApiResponse.success(res, banks);
});

export const getBankById = asyncHandler(async (req: Request, res: Response) => {
  const requesterId = req.user?.userId;
  const bank = await bloodBankService.getBankById(req.params.id, requesterId);
  ApiResponse.success(res, bank);
});

export const getPublicInventory = asyncHandler(async (req: Request, res: Response) => {
  const inventory = await bloodBankService.getPublicInventory(req.params.id);
  ApiResponse.success(res, inventory);
});

export const getMapData = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string>;
  const data = await bloodBankService.getMapData(parseFloat(q.lat), parseFloat(q.lng), {
    showDonors: q.showDonors !== 'false',
    showBloodBanks: q.showBloodBanks !== 'false',
    showRequests: q.showRequests !== 'false',
    bloodGroup: q.bloodGroup,
    radius: parseFloat(q.radius) || 20,
  });
  ApiResponse.success(res, data);
});

// ─── Authenticated — request blood ────────────────────────────────────────────

export const requestBloodFromBank = asyncHandler(async (req: Request, res: Response) => {
  const result = await bloodBankService.requestBloodFromBank(req.params.id, req.user!.userId, req.body);
  ApiResponse.created(res, result, 'Blood request submitted successfully');
});

// ─── Owner — bank profile ──────────────────────────────────────────────────────

export const createBank = asyncHandler(async (req: Request, res: Response) => {
  const bank = await bloodBankService.createBank(req.user!.userId, req.body);
  ApiResponse.created(res, bank, 'Blood bank registered successfully. Pending review.');
});

export const getMyBank = asyncHandler(async (req: Request, res: Response) => {
  const bank = await bloodBankService.getMyBank(req.user!.userId);
  ApiResponse.success(res, bank);
});

export const getMyBanks = asyncHandler(async (req: Request, res: Response) => {
  const banks = await bloodBankService.getMyBanks(req.user!.userId);
  ApiResponse.success(res, banks);
});

export const updateMyBank = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const bank = await bloodBankService.updateMyBank(req.user!.userId, req.body, bankId);
  ApiResponse.success(res, bank, 'Blood bank updated');
});

// ─── Owner — inventory ─────────────────────────────────────────────────────────

export const addInventoryItem = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const item = await bloodBankService.addInventory(req.user!.userId, req.body, bankId);
  ApiResponse.created(res, item, 'Inventory item added');
});

export const getMyInventory = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const items = await bloodBankService.getMyInventory(req.user!.userId, bankId);
  ApiResponse.success(res, items);
});

export const updateInventoryItem = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const item = await bloodBankService.updateInventory(req.user!.userId, req.params.inventoryId, req.body, bankId);
  ApiResponse.success(res, item, 'Inventory item updated');
});

export const deleteInventoryItem = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  await bloodBankService.deleteInventory(req.user!.userId, req.params.inventoryId, bankId);
  ApiResponse.success(res, null, 'Inventory item deleted');
});

// ─── Owner-link ────────────────────────────────────────────────────────────────

export const getUnownedBanks = asyncHandler(async (req: Request, res: Response) => {
  const { city } = req.query as Record<string, string>;
  const banks = await bloodBankService.getUnownedBanks(city);
  ApiResponse.success(res, banks);
});

export const linkBankOwner = asyncHandler(async (req: Request, res: Response) => {
  const bank = await bloodBankService.linkBankOwner(req.params.id, req.user!.userId);
  ApiResponse.success(res, bank, 'Blood bank linked to your account');
});

// ─── Bank-request bridge ───────────────────────────────────────────────────────

export const getMyBankRequests = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const requests = await bloodBankService.getBankRequests(req.user!.userId, bankId);
  ApiResponse.success(res, requests);
});

export const acceptBankRequest = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const request = await bloodBankService.acceptBankRequest(req.user!.userId, req.params.requestId, bankId);
  ApiResponse.success(res, request, 'Request accepted');
});

export const rejectBankRequest = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const request = await bloodBankService.rejectBankRequest(req.user!.userId, req.params.requestId, bankId);
  ApiResponse.success(res, request, 'Request declined');
});

export const completeBankRequest = asyncHandler(async (req: Request, res: Response) => {
  const bankId = req.query.bankId as string | undefined;
  const { proofNote, proofImageUrl } = req.body ?? {};
  const request = await bloodBankService.completeBankRequest(
    req.user!.userId,
    req.params.requestId,
    { proofNote, proofImageUrl },
    bankId
  );
  ApiResponse.success(res, request, 'Request marked as fulfilled');
});

// ─── Dev-only ──────────────────────────────────────────────────────────────────

export const devVerify = asyncHandler(async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    throw new BadRequestError('Not available in production');
  }
  const bank = await bloodBankService.devVerifyBank(req.params.id);
  ApiResponse.success(res, bank, 'Blood bank verified (dev)');
});
