import apiClient from './apiClient';
import { ApiResponse, DonorStatusData } from '../types';

export const donorStatusService = {
  async getStatus(): Promise<ApiResponse<DonorStatusData>> {
    const res = await apiClient.get('/donor/status');
    return res.data;
  },

  async register(): Promise<ApiResponse<DonorStatusData>> {
    const res = await apiClient.post('/donor/register');
    return res.data;
  },

  async setReminder(): Promise<ApiResponse<{ reminderSet: boolean }>> {
    const res = await apiClient.post('/donor/set-reminder');
    return res.data;
  },

  async cancelReminder(): Promise<ApiResponse<{ reminderSet: boolean }>> {
    const res = await apiClient.delete('/donor/reminder');
    return res.data;
  },

  async reactivate(): Promise<ApiResponse<DonorStatusData>> {
    const res = await apiClient.put('/donor/reactivate');
    return res.data;
  },

  async devReset(): Promise<ApiResponse<{ message: string }>> {
    const res = await apiClient.post('/donor/dev-reset');
    return res.data;
  },
};
