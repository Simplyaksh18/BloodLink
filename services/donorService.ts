import apiClient from './apiClient';
import {
  ApiResponse,
  EligibilityStatusData,
  DocumentStatusData,
  HealthScreeningPayload,
} from '../types';

export interface HealthScreeningResult {
  screeningPassed: boolean;
  disqualifyingFactors: string[];
  screeningDate: string;
  eligibility: {
    eligible: boolean;
    reasons: string[];
    nextEligibleDate: string | null;
    eligibilityExpiry: string | null;
  };
}

export interface BecomeDonorResult {
  isDonorEligible: boolean;
  donorEligibleSince: string;
  donorEligibilityExpiry: string;
  warnings: string[];
}

export interface SetReminderResult {
  reminderDate: string;
}

export const donorService = {
  async getEligibilityStatus(): Promise<ApiResponse<EligibilityStatusData>> {
    const res = await apiClient.get('/donors/eligibility');
    return res.data;
  },

  async getDocumentStatus(): Promise<ApiResponse<DocumentStatusData>> {
    const res = await apiClient.get('/donors/document-status');
    return res.data;
  },

  async submitHealthScreening(
    payload: HealthScreeningPayload
  ): Promise<ApiResponse<HealthScreeningResult>> {
    console.log('[donorService] POST /donors/health-screening payload', JSON.stringify(payload));
    const res = await apiClient.post('/donors/health-screening', payload);
    return res.data;
  },

  async becomeDonor(): Promise<ApiResponse<BecomeDonorResult>> {
    const res = await apiClient.put('/donors/become-donor');
    return res.data;
  },

  async setReminder(reminderDate: string): Promise<ApiResponse<SetReminderResult>> {
    const res = await apiClient.post('/donors/set-reminder', { reminderDate });
    return res.data;
  },
};
