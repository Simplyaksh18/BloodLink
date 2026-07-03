import apiClient from './apiClient';
import {
  ApiResponse,
  PaginatedResponse,
  BloodRequest,
  BloodRequestForm,
  BloodBank,
  DonorCard,
  DonorForm,
  DonorProfile,
  MapFilter,
  BloodGroup,
} from '../types';

// ─── Blood Requests ───────────────────────────────────────────────────────────

export const requestService = {
  async createRequest(data: BloodRequestForm): Promise<ApiResponse<BloodRequest>> {
    const res = await apiClient.post('/requests', data);
    return res.data;
  },

  async getMyRequests(): Promise<ApiResponse<BloodRequest[]>> {
    const res = await apiClient.get('/requests/mine');
    return res.data;
  },

  async getEmergencyFeed(page = 1, bloodGroup?: string): Promise<ApiResponse<PaginatedResponse<BloodRequest>>> {
    const params = new URLSearchParams({ page: String(page) });
    if (bloodGroup) params.append('bloodGroup', bloodGroup);
    const res = await apiClient.get(`/requests/feed?${params}`);
    return res.data;
  },

  async getFilteredRequests(bloodGroup?: string, priority?: string, page = 1, eligibleForMe = false): Promise<ApiResponse<PaginatedResponse<BloodRequest>>> {
    const params = new URLSearchParams({ page: String(page) });
    if (bloodGroup) params.append('bloodGroup', bloodGroup);
    if (priority) params.append('priority', priority);
    if (eligibleForMe) params.append('eligibleForMe', 'true');
    const url = `/requests?${params}`;
    console.log('[NearbyRequests] fetching:', url);
    const res = await apiClient.get(url);
    const count = res.data?.data?.data?.length ?? 0;
    console.log('[NearbyRequests] response count:', count);
    return res.data;
  },

  async getNearbyRequests(lat: number, lng: number, radius = 20): Promise<ApiResponse<BloodRequest[]>> {
    const res = await apiClient.get(`/requests/nearby?lat=${lat}&lng=${lng}&radius=${radius}`);
    return res.data;
  },

  async cancelRequest(requestId: string): Promise<ApiResponse<any>> {
    const res = await apiClient.patch(`/requests/${requestId}/cancel`);
    return res.data;
  },

  async fulfillRequest(requestId: string): Promise<ApiResponse<any>> {
    const res = await apiClient.patch(`/requests/${requestId}/fulfill`);
    return res.data;
  },

  async getAcceptedRequests(): Promise<ApiResponse<any[]>> {
    const res = await apiClient.get('/requests/accepted');
    return res.data;
  },

  async getTargetedRequests(): Promise<ApiResponse<any[]>> {
    const res = await apiClient.get('/requests/targeted-for-me');
    return res.data;
  },

  async submitProof(
    requestId: string,
    proofNote?: string,
    proofImageUrl?: string
  ): Promise<ApiResponse<any>> {
    const res = await apiClient.post(`/requests/${requestId}/proof`, { proofNote, proofImageUrl });
    return res.data;
  },

  async respondToRequest(
    requestId: string,
    response: 'ACCEPTED' | 'DECLINED',
    message?: string
  ): Promise<ApiResponse<any>> {
    const res = await apiClient.post(`/requests/${requestId}/respond`, { response, message });
    return res.data;
  },
};

// ─── Donors ───────────────────────────────────────────────────────────────────

export const donorService = {
  async updateDonorProfile(data: DonorForm): Promise<ApiResponse<DonorProfile>> {
    const res = await apiClient.put('/donors/profile', data);
    return res.data;
  },

  async getDonorProfile(): Promise<ApiResponse<DonorProfile>> {
    const res = await apiClient.get('/donors/profile');
    return res.data;
  },

  async getNearbyDonors(lat: number, lng: number, bloodGroup?: BloodGroup): Promise<ApiResponse<DonorCard[]>> {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    if (bloodGroup) params.append('bloodGroup', bloodGroup);
    const res = await apiClient.get(`/donors/nearby?${params}`);
    return res.data;
  },

  async getDonationHistory(): Promise<ApiResponse<any[]>> {
    const res = await apiClient.get('/donors/history');
    return res.data;
  },

  // City / compatible-blood-group donor search.
  // Accepts multiple blood groups (backend filters by importedDonor=true + IN clause).
  async getDonorsByFilter(bloodGroups?: string[], city?: string): Promise<ApiResponse<DonorCard[]>> {
    const params = new URLSearchParams();
    if (bloodGroups && bloodGroups.length > 0) {
      // Send as comma-separated: bloodGroup=O%2B,O-
      params.append('bloodGroup', bloodGroups.join(','));
    }
    if (city) params.append('city', city);
    const query = params.toString();
    const res = await apiClient.get(`/donors${query ? `?${query}` : ''}`);
    return res.data;
  },
};

// ─── Blood Banks ──────────────────────────────────────────────────────────────

export const bloodBankService = {
  // Public — read
  async getNearbyBanks(lat: number, lng: number, radius = 20): Promise<ApiResponse<BloodBank[]>> {
    const res = await apiClient.get(`/blood-banks/nearby?lat=${lat}&lng=${lng}&radius=${radius}`);
    return res.data;
  },

  async getAllBanks(filters?: { city?: string; bloodGroup?: string }): Promise<ApiResponse<BloodBank[]>> {
    const params = new URLSearchParams();
    if (filters?.city) params.append('city', filters.city);
    if (filters?.bloodGroup) params.append('bloodGroup', filters.bloodGroup);
    const query = params.toString();
    const res = await apiClient.get(`/blood-banks${query ? `?${query}` : ''}`);
    return res.data;
  },

  async getBankById(id: string): Promise<ApiResponse<BloodBank>> {
    const res = await apiClient.get(`/blood-banks/${id}`);
    return res.data;
  },

  async getPublicInventory(bankId: string): Promise<ApiResponse<InventoryItem[]>> {
    const res = await apiClient.get(`/blood-banks/${bankId}/inventory`);
    return res.data;
  },

  async requestBloodFromBank(
    bankId: string,
    data: { bloodGroup: BloodGroup; unitsRequired: number; priority?: string }
  ): Promise<ApiResponse<any>> {
    const res = await apiClient.post(`/blood-banks/${bankId}/request-blood`, data);
    return res.data;
  },

  // Owner — bank profile
  async createMyBank(data: CreateBankPayload): Promise<ApiResponse<BloodBank>> {
    const res = await apiClient.post('/blood-banks', data);
    return res.data;
  },

  async getMyBank(): Promise<ApiResponse<BloodBank>> {
    const res = await apiClient.get(`/blood-banks/me?_t=${Date.now()}`);
    return res.data;
  },

  async getMyBanks(): Promise<ApiResponse<BankWithStats[]>> {
    const res = await apiClient.get(`/blood-banks/me/all?_t=${Date.now()}`);
    return res.data;
  },

  async updateMyBank(data: Partial<CreateBankPayload>, bankId?: string): Promise<ApiResponse<BloodBank>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.patch(`/blood-banks/me${q}`, data);
    return res.data;
  },

  // Owner — inventory (all accept optional bankId for multi-bank support)
  async addInventory(data: { bloodGroup: string; units: number; expiryDate?: string }, bankId?: string): Promise<ApiResponse<InventoryItem>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.post(`/blood-banks/me/inventory${q}`, data);
    return res.data;
  },

  async getMyInventory(bankId?: string): Promise<ApiResponse<InventoryItem[]>> {
    const q = `?_t=${Date.now()}${bankId ? `&bankId=${bankId}` : ''}`;
    const res = await apiClient.get(`/blood-banks/me/inventory${q}`);
    return res.data;
  },

  async updateInventory(
    inventoryId: string,
    data: { units?: number; expiryDate?: string | null; status?: string },
    bankId?: string
  ): Promise<ApiResponse<InventoryItem>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.patch(`/blood-banks/me/inventory/${inventoryId}${q}`, data);
    return res.data;
  },

  async deleteInventory(inventoryId: string, bankId?: string): Promise<ApiResponse<null>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.delete(`/blood-banks/me/inventory/${inventoryId}${q}`);
    return res.data;
  },

  // Owner-link (existing unowned seeded banks)
  async getUnownedBanks(city?: string): Promise<ApiResponse<BloodBank[]>> {
    const params = city ? `?city=${encodeURIComponent(city)}` : '';
    const res = await apiClient.get(`/blood-banks/unowned${params}`);
    return res.data;
  },

  async linkBankOwner(bankId: string): Promise<ApiResponse<BloodBank>> {
    const res = await apiClient.patch(`/blood-banks/${bankId}/link-owner`);
    return res.data;
  },

  // Bank-request bridge
  async getMyBankRequests(bankId?: string): Promise<ApiResponse<BankRequest[]>> {
    const q = `?_t=${Date.now()}${bankId ? `&bankId=${bankId}` : ''}`;
    const res = await apiClient.get(`/blood-banks/me/requests${q}`);
    return res.data;
  },

  async acceptBankRequest(requestId: string, bankId?: string): Promise<ApiResponse<BankRequest>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.patch(`/blood-banks/me/requests/${requestId}/accept${q}`);
    return res.data;
  },

  async rejectBankRequest(requestId: string, bankId?: string): Promise<ApiResponse<BankRequest>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.patch(`/blood-banks/me/requests/${requestId}/reject${q}`);
    return res.data;
  },

  async completeBankRequest(
    requestId: string,
    proof?: { proofNote?: string; proofImageUrl?: string },
    bankId?: string
  ): Promise<ApiResponse<BankRequest>> {
    const q = bankId ? `?bankId=${bankId}` : '';
    const res = await apiClient.patch(`/blood-banks/me/requests/${requestId}/complete${q}`, proof ?? {});
    return res.data;
  },

  // Dev-only
  async devVerify(bankId: string): Promise<ApiResponse<BloodBank>> {
    const res = await apiClient.patch(`/blood-banks/${bankId}/dev-verify`);
    return res.data;
  },
};

// ─── Blood Bank payload types ──────────────────────────────────────────────────

export interface CreateBankPayload {
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

export interface BankWithStats extends BloodBank {
  inventoryCount: number;
  inventoryUnits: number;
  pendingRequests: number;
  fulfilledRequests: number;
  lastUpdated: string;
}

export interface BankRequest {
  id: string;
  bloodGroup: string;
  units: number;
  emergencyLevel: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  bloodBankId: string | null;
  requester: { id: string; name: string; phone: string };
}

export interface InventoryItem {
  id: string;
  bloodBankId: string;
  bloodGroup: string;
  units: number;
  expiryDate: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'RESERVED';
  lowStock: boolean;
  expiringSoon: boolean;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Map Data ─────────────────────────────────────────────────────────────────

export const mapService = {
  async getMapData(lat: number, lng: number, filters: MapFilter): Promise<
    ApiResponse<{
      donors: DonorCard[];
      bloodBanks: BloodBank[];
      requests: BloodRequest[];
    }>
  > {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      showDonors: String(filters.showDonors),
      showBloodBanks: String(filters.showBloodBanks),
      showRequests: String(filters.showRequests),
    });
    if (filters.bloodGroup) params.append('bloodGroup', filters.bloodGroup);
    if (filters.maxDistance) params.append('radius', String(filters.maxDistance));
    const res = await apiClient.get(`/map?${params}`);
    return res.data;
  },
};

// ─── Donations ───────────────────────────────────────────────────────────────

export const donationService = {
  async getHistory(): Promise<ApiResponse<any[]>> {
    const res = await apiClient.get('/donations/history');
    return res.data;
  },
};

// ─── Upload ───────────────────────────────────────────────────────────────────

export const uploadService = {
  async uploadDocument(
    uri: string,
    type: string,
    mimeType: string
  ): Promise<ApiResponse<{ url: string; documentId: string }>> {
    const formData = new FormData();
    formData.append('file', {
      uri,
      type: mimeType,
      name: `document_${Date.now()}.${mimeType.split('/')[1]}`,
    } as any);
    formData.append('documentType', type);

    const res = await apiClient.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminService = {
  async addDonor(data: any): Promise<ApiResponse<void>> {
    const res = await apiClient.post('/admin/donors', data);
    return res.data;
  },

  async removeDonor(id: string): Promise<ApiResponse<void>> {
    const res = await apiClient.delete(`/admin/donors/${id}`);
    return res.data;
  },

  async addBloodBank(data: any): Promise<ApiResponse<void>> {
    const res = await apiClient.post('/admin/blood-banks', data);
    return res.data;
  },

  async removeBloodBank(id: string): Promise<ApiResponse<void>> {
    const res = await apiClient.delete(`/admin/blood-banks/${id}`);
    return res.data;
  },

  async getPendingVerifications(): Promise<ApiResponse<any[]>> {
    const res = await apiClient.get('/admin/verifications');
    return res.data;
  },

  async reviewDocument(id: string, action: 'approve' | 'reject', reason?: string): Promise<ApiResponse<void>> {
    const res = await apiClient.put(`/admin/verifications/${id}`, { action, reason });
    return res.data;
  },

  async listBloodBanks(status?: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED'): Promise<ApiResponse<{
    banks: any[]; stats: Record<string, number>; total: number;
  }>> {
    const q = status ? `?status=${status}` : '';
    const res = await apiClient.get(`/admin/blood-banks${q}`);
    return res.data;
  },

  async getBloodBankDetail(id: string): Promise<ApiResponse<any>> {
    const res = await apiClient.get(`/admin/blood-banks/${id}`);
    return res.data;
  },
};
