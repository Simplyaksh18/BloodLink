import { prisma } from '../config/database';
import { ApiBloodBank, BloodGroup, ApiLocation } from '../types';
import { NotFoundError, BadRequestError } from '../utils/ApiError';
import { haversineDistanceKm } from '../utils/helpers';
import { BloodBank, BloodInventory, BloodBankVerificationStatus, InventoryStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createNotification } from './notification.service';

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapBank(bank: BloodBank & { inventory?: BloodInventory[] }, distance?: number): ApiBloodBank {
  // Legacy stockJson for seeded/admin banks
  let legacyGroups: BloodGroup[] = [];
  try {
    const stock = JSON.parse(bank.stockJson) as Record<string, number>;
    legacyGroups = Object.entries(stock).filter(([, qty]) => qty > 0).map(([bg]) => bg) as BloodGroup[];
  } catch { /* ignore */ }

  // Phase 6 inventory groups (active, non-expired, units > 0)
  const inventoryGroups: BloodGroup[] = (bank.inventory ?? [])
    .filter(i => i.status === 'ACTIVE' && i.units > 0)
    .map(i => i.bloodGroup as BloodGroup);

  const availableBloodGroups = Array.from(new Set([...legacyGroups, ...inventoryGroups])) as BloodGroup[];

  const location: ApiLocation = {
    latitude: bank.latitude ?? 0,
    longitude: bank.longitude ?? 0,
    address: bank.address,
    city: bank.city,
    state: bank.state,
    pincode: bank.pincode,
  };

  const hours = bank.is24x7 ? '24x7' : (
    bank.operatingHoursStart && bank.operatingHoursEnd
      ? `${bank.operatingHoursStart} - ${bank.operatingHoursEnd}`
      : 'Hours not specified'
  );

  return {
    id: bank.id,
    name: bank.name,
    location,
    phone: bank.contactPhone,
    email: bank.email ?? undefined,
    operatingHours: hours,
    availableBloodGroups,
    isVerified: bank.isVerified || bank.verificationStatus === 'VERIFIED',
    verificationStatus: bank.verificationStatus,
    distance,
    ownerId: bank.ownerId ?? undefined,
    licenseNumber: bank.licenseNumber ?? bank.registrationNumber ?? undefined,
    rejectionReason: bank.rejectionReason ?? undefined,
  };
}

function mapInventoryItem(item: BloodInventory) {
  const now = new Date();
  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const expired = item.expiryDate ? new Date(item.expiryDate) < now : false;
  const expiringSoon = item.expiryDate ? new Date(item.expiryDate) <= sevenDaysOut && !expired : false;
  const lowStock = item.units <= 3;

  if (expired && item.status === 'ACTIVE') {
    console.warn(`[BloodBank] Inventory item ${item.id} (${item.bloodGroup}) expired — mark as EXPIRED`);
  }
  if (lowStock && item.units > 0) {
    console.warn(`[BloodBank] Low stock alert: bankId=${item.bloodBankId} bloodGroup=${item.bloodGroup} units=${item.units}`);
  }

  return {
    id: item.id,
    bloodBankId: item.bloodBankId,
    bloodGroup: item.bloodGroup,
    units: item.units,
    expiryDate: item.expiryDate ? item.expiryDate.toISOString() : null,
    status: item.status,
    lowStock,
    expiringSoon,
    expired,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

// Public discovery: only banks that are verified AND have an active owner.
// Unowned/legacy-seeded banks remain in the DB but are excluded from discovery.
const verifiedFilter = {
  isActive: true,
  ownerId: { not: null },
  OR: [
    { isVerified: true },
    { verificationStatus: 'VERIFIED' as BloodBankVerificationStatus },
  ],
};

// ─── Public read endpoints ─────────────────────────────────────────────────────

export async function getAllBanks(filters?: { city?: string; bloodGroup?: string }): Promise<ApiBloodBank[]> {
  const where: any = { ...verifiedFilter };
  if (filters?.city) where.city = { contains: filters.city, mode: 'insensitive' };

  const banks = await prisma.bloodBank.findMany({
    where,
    include: { inventory: { where: { status: 'ACTIVE' } } },
  });

  let results = banks.map(b => mapBank(b));

  if (filters?.bloodGroup) {
    const bg = filters.bloodGroup;
    results = results.filter(b => b.availableBloodGroups.includes(bg as BloodGroup));
  }

  return results;
}

export async function getNearbyBanks(lat: number, lng: number, radiusKm: number): Promise<ApiBloodBank[]> {
  const banks = await prisma.bloodBank.findMany({
    where: verifiedFilter,
    include: { inventory: { where: { status: 'ACTIVE' } } },
  });
  return banks
    .map(b => {
      const d = haversineDistanceKm(lat, lng, b.latitude ?? 0, b.longitude ?? 0);
      return { bank: b, distance: d };
    })
    .filter(({ distance }) => distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .map(({ bank, distance }) => mapBank(bank, Math.round(distance * 10) / 10));
}

export async function getBankById(id: string, requesterId?: string): Promise<ApiBloodBank> {
  const bank = await prisma.bloodBank.findUnique({
    where: { id },
    include: { inventory: { where: { status: 'ACTIVE' } } },
  });
  if (!bank) throw new NotFoundError('Blood bank not found');
  const isOwner = requesterId && bank.ownerId === requesterId;
  const isVerified = bank.verificationStatus === 'VERIFIED' || bank.isVerified;
  // Non-owners can only view banks that are verified AND owned
  if (!isOwner && (!isVerified || !bank.ownerId)) {
    throw new NotFoundError('Blood bank not found');
  }
  return mapBank(bank);
}

export async function getPublicInventory(bankId: string) {
  const bank = await prisma.bloodBank.findUnique({ where: { id: bankId } });
  if (!bank || (bank.verificationStatus !== 'VERIFIED' && !bank.isVerified)) {
    throw new NotFoundError('Blood bank not found');
  }
  const items = await prisma.bloodInventory.findMany({
    where: { bloodBankId: bankId, status: 'ACTIVE', units: { gt: 0 } },
    orderBy: { bloodGroup: 'asc' },
  });
  return items.map(mapInventoryItem);
}

export async function requestBloodFromBank(
  bankId: string,
  requesterId: string,
  data: { bloodGroup: BloodGroup; unitsRequired: number; priority?: string }
): Promise<{ id: string }> {
  const bank = await prisma.bloodBank.findUnique({ where: { id: bankId } });
  if (!bank) throw new NotFoundError('Blood bank not found');
  if (!bank.ownerId) throw new BadRequestError('This blood bank is not yet managed and cannot accept requests');

  const emergencyLevel =
    data.priority === 'critical' ? 'RED' : data.priority === 'moderate' ? 'YELLOW' : 'GREEN';

  const request = await prisma.bloodRequest.create({
    data: {
      requesterId,
      bloodGroup: data.bloodGroup,
      units: data.unitsRequired,
      hospitalName: bank.name,
      hospitalAddress: bank.address,
      hospitalCity: bank.city,
      hospitalLatitude: bank.latitude,
      hospitalLongitude: bank.longitude,
      hospitalContact: bank.contactPhone,
      emergencyLevel: emergencyLevel as any,
      bloodBankId: bankId,
      status: 'ACTIVE',
      notes: `Requested via BloodLink app from ${bank.name}`,
    },
  });

  // Notify blood bank owner
  if (bank.ownerId) {
    createNotification(
      bank.ownerId,
      'BLOOD_BANK_REQUEST_NEW',
      'New blood request',
      `${data.bloodGroup} blood requested (${data.unitsRequired} unit${data.unitsRequired > 1 ? 's' : ''}) at ${bank.name}`,
      { requestId: request.id, bloodBankId: bank.id }
    ).catch(() => {});
  }

  return { id: request.id };
}

export async function getMapData(
  lat: number,
  lng: number,
  filters: {
    showDonors: boolean;
    showBloodBanks: boolean;
    showRequests: boolean;
    bloodGroup?: string;
    radius: number;
  }
) {
  const [donorsResult, banksResult, requestsResult] = await Promise.all([
    filters.showDonors
      ? import('./user.service').then(m => m.getNearbyDonors(lat, lng, filters.radius, filters.bloodGroup))
      : Promise.resolve([]),
    filters.showBloodBanks ? getNearbyBanks(lat, lng, filters.radius) : Promise.resolve([]),
    filters.showRequests
      ? import('./request.service').then(m => m.getNearbyRequests(lat, lng, filters.radius, filters.bloodGroup))
      : Promise.resolve([]),
  ]);

  return { donors: donorsResult, bloodBanks: banksResult, requests: requestsResult };
}

// ─── Owner CRUD ────────────────────────────────────────────────────────────────

export interface CreateBankInput {
  name: string;
  licenseNumber: string;
  contactPhone: string;
  email?: string;
  address: string;
  city: string;
  state: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  is24x7?: boolean;
  operatingHoursStart?: string;
  operatingHoursEnd?: string;
}

export async function createBank(ownerId: string, data: CreateBankInput) {
  if (!data.name || !data.licenseNumber || !data.contactPhone || !data.address || !data.city || !data.state) {
    throw new BadRequestError('name, licenseNumber, contactPhone, address, city, state are required');
  }

  const existing = await prisma.bloodBank.findFirst({ where: { ownerId } });
  if (existing) throw new BadRequestError('You already have a blood bank registered');

  const licConflict = await prisma.bloodBank.findFirst({ where: { licenseNumber: data.licenseNumber } });
  if (licConflict) throw new BadRequestError('A blood bank with this license number already exists');

  const bank = await prisma.bloodBank.create({
    data: {
      id: randomUUID(),
      ownerId,
      licenseNumber: data.licenseNumber,
      name: data.name,
      contactPhone: data.contactPhone,
      email: data.email ?? null,
      address: data.address,
      city: data.city,
      state: data.state,
      pincode: data.pincode ?? '',
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      is24x7: data.is24x7 ?? false,
      operatingHoursStart: data.operatingHoursStart ?? null,
      operatingHoursEnd: data.operatingHoursEnd ?? null,
      verificationStatus: 'PENDING_REVIEW',
    },
  });

  console.log(`[BloodBank] Registered bankId=${bank.id} owner=${ownerId} license=${data.licenseNumber}`);
  return mapBank(bank);
}

export async function getMyBank(ownerId: string) {
  const bank = await prisma.bloodBank.findFirst({
    where: { ownerId },
    include: { inventory: { where: { status: 'ACTIVE' }, orderBy: { bloodGroup: 'asc' } } },
  });
  if (!bank) throw new NotFoundError('You have not registered a blood bank yet');
  return mapBank(bank);
}

export async function getMyBanks(ownerId: string) {
  const banks = await prisma.bloodBank.findMany({
    where: { ownerId },
    include: { inventory: { where: { status: 'ACTIVE' } } },
    orderBy: { createdAt: 'asc' },
  });

  return Promise.all(banks.map(async (bank) => {
    const [pendingRequests, fulfilledRequests] = await Promise.all([
      prisma.bloodRequest.count({ where: { bloodBankId: bank.id, status: { in: ['ACTIVE', 'OPEN', 'IN_PROGRESS'] } } }),
      prisma.bloodRequest.count({ where: { bloodBankId: bank.id, status: 'FULFILLED' } }),
    ]);
    return {
      ...mapBank(bank),
      inventoryCount: bank.inventory.length,
      inventoryUnits: bank.inventory.reduce((s, i) => s + i.units, 0),
      pendingRequests,
      fulfilledRequests,
      lastUpdated: bank.updatedAt.toISOString(),
    };
  }));
}

export async function updateMyBank(ownerId: string, data: Partial<CreateBankInput>, bankId?: string) {
  const bank = bankId
    ? await prisma.bloodBank.findFirst({ where: { id: bankId, ownerId } })
    : await prisma.bloodBank.findFirst({ where: { ownerId } });
  if (!bank) throw new NotFoundError('Blood bank not found');

  if (data.licenseNumber && data.licenseNumber !== bank.licenseNumber) {
    const conflict = await prisma.bloodBank.findFirst({
      where: { licenseNumber: data.licenseNumber, NOT: { id: bank.id } },
    });
    if (conflict) throw new BadRequestError('License number already in use');
  }

  const updated = await prisma.bloodBank.update({
    where: { id: bank.id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.licenseNumber !== undefined && { licenseNumber: data.licenseNumber }),
      ...(data.contactPhone !== undefined && { contactPhone: data.contactPhone }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.state !== undefined && { state: data.state }),
      ...(data.pincode !== undefined && { pincode: data.pincode }),
      ...(data.latitude !== undefined && { latitude: data.latitude }),
      ...(data.longitude !== undefined && { longitude: data.longitude }),
      ...(data.is24x7 !== undefined && { is24x7: data.is24x7 }),
      ...(data.operatingHoursStart !== undefined && { operatingHoursStart: data.operatingHoursStart }),
      ...(data.operatingHoursEnd !== undefined && { operatingHoursEnd: data.operatingHoursEnd }),
    },
    include: { inventory: { where: { status: 'ACTIVE' } } },
  });

  return mapBank(updated);
}

// ─── Inventory CRUD ────────────────────────────────────────────────────────────

export interface AddInventoryInput {
  bloodGroup: string;
  units: number;
  expiryDate?: string;
}

async function resolveOwnerBankId(ownerId: string, bankId?: string): Promise<string> {
  if (bankId) {
    const bank = await prisma.bloodBank.findFirst({ where: { id: bankId, ownerId } });
    if (!bank) throw new NotFoundError('Blood bank not found or access denied');
    return bank.id;
  }
  const bank = await prisma.bloodBank.findFirst({ where: { ownerId } });
  if (!bank) throw new NotFoundError('You have not registered a blood bank yet');
  return bank.id;
}

export async function addInventory(ownerId: string, data: AddInventoryInput, bankId?: string) {
  if (!VALID_BLOOD_GROUPS.includes(data.bloodGroup)) {
    throw new BadRequestError(`bloodGroup must be one of: ${VALID_BLOOD_GROUPS.join(', ')}`);
  }
  if (typeof data.units !== 'number' || data.units < 0) {
    throw new BadRequestError('units must be a non-negative number');
  }

  const resolvedBankId = await resolveOwnerBankId(ownerId, bankId);

  const item = await prisma.bloodInventory.create({
    data: {
      id: randomUUID(),
      bloodBankId: resolvedBankId,
      bloodGroup: data.bloodGroup,
      units: data.units,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      status: 'ACTIVE',
    },
  });

  return mapInventoryItem(item);
}

export async function getMyInventory(ownerId: string, bankId?: string) {
  const resolvedBankId = await resolveOwnerBankId(ownerId, bankId);
  const items = await prisma.bloodInventory.findMany({
    where: { bloodBankId: resolvedBankId },
    orderBy: [{ status: 'asc' }, { bloodGroup: 'asc' }],
  });
  return items.map(mapInventoryItem);
}

export async function updateInventory(
  ownerId: string,
  inventoryId: string,
  data: { units?: number; expiryDate?: string | null; status?: InventoryStatus },
  bankId?: string
) {
  const resolvedBankId = await resolveOwnerBankId(ownerId, bankId);
  const item = await prisma.bloodInventory.findFirst({ where: { id: inventoryId, bloodBankId: resolvedBankId } });
  if (!item) throw new NotFoundError('Inventory item not found');

  if (data.units !== undefined && (typeof data.units !== 'number' || data.units < 0)) {
    throw new BadRequestError('units must be a non-negative number');
  }

  const updated = await prisma.bloodInventory.update({
    where: { id: inventoryId },
    data: {
      ...(data.units !== undefined && { units: data.units }),
      ...(data.expiryDate !== undefined && {
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });

  return mapInventoryItem(updated);
}

export async function deleteInventory(ownerId: string, inventoryId: string, bankId?: string) {
  const resolvedBankId = await resolveOwnerBankId(ownerId, bankId);
  const item = await prisma.bloodInventory.findFirst({ where: { id: inventoryId, bloodBankId: resolvedBankId } });
  if (!item) throw new NotFoundError('Inventory item not found');
  await prisma.bloodInventory.delete({ where: { id: inventoryId } });
}

// ─── Owner-link (existing seeded banks) ───────────────────────────────────────

export async function getUnownedBanks(city?: string) {
  const where: any = { ownerId: null, isActive: true };
  if (city) where.city = { contains: city, mode: 'insensitive' };
  const banks = await prisma.bloodBank.findMany({ where, include: { inventory: { where: { status: 'ACTIVE' } } } });
  return banks.map(b => mapBank(b));
}

export async function linkBankOwner(bankId: string, userId: string) {
  const bank = await prisma.bloodBank.findUnique({ where: { id: bankId } });
  if (!bank) throw new NotFoundError('Blood bank not found');
  if (bank.ownerId && bank.ownerId !== userId) throw new BadRequestError('This blood bank already has an owner');

  const updated = await prisma.bloodBank.update({
    where: { id: bankId },
    data: { ownerId: userId },
    include: { inventory: { where: { status: 'ACTIVE' } } },
  });
  console.log(`[BloodBank] bankId=${bankId} linked to owner=${userId}`);
  return mapBank(updated);
}

// ─── Bank-request bridge ───────────────────────────────────────────────────────

type RequestWithRequester = {
  id: string;
  bloodGroup: string;
  units: number;
  emergencyLevel: string;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  bloodBankId: string | null;
  requester: { id: string; name: string; phone: string };
};

function mapBankRequest(req: RequestWithRequester) {
  return {
    id: req.id,
    bloodGroup: req.bloodGroup,
    units: req.units,
    emergencyLevel: req.emergencyLevel,
    status: req.status,
    notes: req.notes,
    createdAt: req.createdAt.toISOString(),
    updatedAt: req.updatedAt.toISOString(),
    bloodBankId: req.bloodBankId,
    requester: req.requester,
  };
}

async function resolveOwnerBank(ownerId: string, bankId?: string) {
  if (bankId) {
    const bank = await prisma.bloodBank.findFirst({ where: { id: bankId, ownerId } });
    if (!bank) throw new NotFoundError('Blood bank not found or access denied');
    return bank;
  }
  const bank = await prisma.bloodBank.findFirst({ where: { ownerId } });
  if (!bank) throw new NotFoundError('You do not own a blood bank');
  return bank;
}

export async function getBankRequests(ownerId: string, bankId?: string) {
  const bank = await resolveOwnerBank(ownerId, bankId);
  const requests = await prisma.bloodRequest.findMany({
    where: { bloodBankId: bank.id },
    include: { requester: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return requests.map(r => mapBankRequest(r as any));
}

export async function acceptBankRequest(ownerId: string, requestId: string, bankId?: string) {
  const bank = await resolveOwnerBank(ownerId, bankId);
  const req = await prisma.bloodRequest.findFirst({
    where: { id: requestId, bloodBankId: bank.id },
    include: { requester: { select: { id: true, name: true, phone: true } } },
  });
  if (!req) throw new NotFoundError('Request not found');
  if (!['ACTIVE', 'OPEN'].includes(req.status)) throw new BadRequestError(`Cannot accept a request with status ${req.status}`);

  const updated = await prisma.bloodRequest.update({
    where: { id: requestId },
    data: { status: 'IN_PROGRESS' },
    include: { requester: { select: { id: true, name: true, phone: true } } },
  });

  createNotification(
    req.requesterId,
    'BLOOD_BANK_REQUEST_ACCEPTED',
    'Your request was accepted',
    `${bank.name} accepted your ${req.bloodGroup} blood request and is preparing it now`,
    { requestId, bloodBankId: bank.id }
  ).catch(() => {});

  return mapBankRequest(updated as any);
}

export async function rejectBankRequest(ownerId: string, requestId: string, bankId?: string) {
  const bank = await resolveOwnerBank(ownerId, bankId);
  const req = await prisma.bloodRequest.findFirst({
    where: { id: requestId, bloodBankId: bank.id },
    include: { requester: { select: { id: true, name: true, phone: true } } },
  });
  if (!req) throw new NotFoundError('Request not found');
  if (!['ACTIVE', 'OPEN'].includes(req.status)) throw new BadRequestError(`Cannot reject a request with status ${req.status}`);

  const updated = await prisma.bloodRequest.update({
    where: { id: requestId },
    data: { status: 'CANCELLED', notes: (req.notes ? req.notes + ' [Bank declined]' : '[Bank declined]') },
    include: { requester: { select: { id: true, name: true, phone: true } } },
  });

  createNotification(
    req.requesterId,
    'BLOOD_BANK_REQUEST_REJECTED',
    'Your request was declined',
    `${bank.name} could not fulfil your ${req.bloodGroup} blood request`,
    { requestId, bloodBankId: bank.id }
  ).catch(() => {});

  return mapBankRequest(updated as any);
}

export async function completeBankRequest(
  ownerId: string,
  requestId: string,
  proof?: { proofNote?: string; proofImageUrl?: string },
  bankId?: string
) {
  const bank = await resolveOwnerBank(ownerId, bankId);
  const req = await prisma.bloodRequest.findFirst({
    where: { id: requestId, bloodBankId: bank.id },
    include: { requester: { select: { id: true, name: true, phone: true } } },
  });
  if (!req) throw new NotFoundError('Request not found');
  if (req.status !== 'IN_PROGRESS') throw new BadRequestError(`Cannot complete a request with status ${req.status}`);

  // Inventory deduction — FIFO across batches (soonest expiry first)
  const invItems = await prisma.bloodInventory.findMany({
    where: { bloodBankId: bank.id, bloodGroup: req.bloodGroup, status: 'ACTIVE', units: { gt: 0 } },
    orderBy: { expiryDate: 'asc' },
  });

  if (invItems.length > 0) {
    const totalAvailable = invItems.reduce((s, i) => s + i.units, 0);
    if (totalAvailable < req.units) {
      throw new BadRequestError(
        `Not enough inventory to complete. Available: ${totalAvailable} unit${totalAvailable !== 1 ? 's' : ''}, Required: ${req.units}.`
      );
    }
    let remaining = req.units;
    for (const item of invItems) {
      if (remaining <= 0) break;
      const deduct = Math.min(item.units, remaining);
      await prisma.bloodInventory.update({ where: { id: item.id }, data: { units: item.units - deduct } });
      remaining -= deduct;
    }
    console.log(`[BloodBank] Deducted ${req.units}x${req.bloodGroup} from bank ${bank.id}`);
  } else {
    console.log(`[BloodBank] No inventory records for ${req.bloodGroup} in bank ${bank.id} — completing without deduction`);
  }

  // Proof of delivery
  const proofNote = proof?.proofNote?.trim();
  const proofImageUrl = proof?.proofImageUrl?.trim();

  const notesUpdate = proofNote
    ? (req.notes ? `${req.notes} | Proof: ${proofNote}` : `Proof: ${proofNote}`)
    : req.notes ?? undefined;

  const updated = await prisma.bloodRequest.update({
    where: { id: requestId },
    data: {
      status: 'FULFILLED',
      fulfilledAt: new Date(),
      ...(notesUpdate !== undefined && { notes: notesUpdate }),
    },
    include: { requester: { select: { id: true, name: true, phone: true } } },
  });

  // Store proof image as RequestDocument
  if (proofImageUrl) {
    await prisma.requestDocument.create({
      data: {
        id: randomUUID(),
        requestId,
        documentType: 'BLOOD_BANK_PROOF',
        url: proofImageUrl,
      },
    }).catch(() => {});
  }

  createNotification(
    req.requesterId,
    'BLOOD_BANK_REQUEST_FULFILLED',
    'Blood request fulfilled',
    `${bank.name} has fulfilled your ${req.bloodGroup} blood request`,
    { requestId, bloodBankId: bank.id }
  ).catch(() => {});

  return mapBankRequest(updated as any);
}

// ─── Dev-only ──────────────────────────────────────────────────────────────────

export async function devVerifyBank(bankId: string) {
  const bank = await prisma.bloodBank.findUnique({ where: { id: bankId } });
  if (!bank) throw new NotFoundError('Blood bank not found');
  const updated = await prisma.bloodBank.update({
    where: { id: bankId },
    data: { verificationStatus: 'VERIFIED', isVerified: true, rejectionReason: null },
  });
  console.log(`[DEV] Blood bank ${bankId} verified`);
  return mapBank(updated);
}
