import apiClient from './apiClient';

// All methods call endpoints that self-guard with NODE_ENV === 'production' → 403.
export const devQaService = {
  async forceActiveDonor() {
    const res = await apiClient.post('/dev/donor/force-active');
    return res.data;
  },

  async deferDonor() {
    const res = await apiClient.post('/dev/donor/defer');
    return res.data;
  },

  async markAllVerified() {
    const res = await apiClient.post('/dev/verification/mark-verified');
    return res.data;
  },

  async resetVerification() {
    const res = await apiClient.post('/dev/verification/reset');
    return res.data;
  },

  async expireRequest(requestId: string) {
    const res = await apiClient.post(`/dev/requests/${requestId}/expire`);
    return res.data;
  },
};
