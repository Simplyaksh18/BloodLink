import apiClient from './apiClient';
import { ApiResponse } from '../types';

export type DocVerificationStatus = 'NOT_SUBMITTED' | 'UPLOADED' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'
  | 'AUTO_VERIFICATION_PASSED' | 'AUTO_VERIFICATION_FAILED' | 'PENDING_REVIEW';

export type DocVerificationType = 'ID_PROOF' | 'BLOOD_GROUP_PROOF' | 'MEDICAL_SCREENING' | 'LICENSE';

export interface RejectionDetail {
  check: string;
  message: string;
  suggestion: string;
}

export interface VerificationDoc {
  id: string;
  userId: string;
  verificationType: DocVerificationType;
  status: DocVerificationStatus;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  uploadedAt?: string;
  autoCheckPassed?: boolean;
  fraudScore: number;
  rejectionReason?: string;
  rejectionDetails?: RejectionDetail[];
  canResubmit?: boolean;
  expiresAt?: string;
  isExpired: boolean;
  resubmissionCount: number;
  createdAt: string;
  updatedAt: string;
  documentUrl?: string;
}

export interface VerificationStatusResponse {
  userId: string;
  idVerified: boolean;
  bloodGroupVerified: boolean;
  medicalVerified: boolean;
  overallStatus: 'UNVERIFIED' | 'PARTIALLY_VERIFIED' | 'FULLY_VERIFIED';
  verifications: Partial<Record<DocVerificationType, VerificationDoc>>;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  documentId: string;
  s3Key: string;
  expiresIn: number;
}

export const verificationService = {
  async getStatus(): Promise<ApiResponse<VerificationStatusResponse>> {
    const res = await apiClient.get('/verification/status');
    return res.data;
  },

  async getStatusByType(type: DocVerificationType): Promise<ApiResponse<VerificationDoc | null>> {
    const res = await apiClient.get(`/verification/status/${type}`);
    return res.data;
  },

  async getDocuments(): Promise<ApiResponse<VerificationDoc[]>> {
    const res = await apiClient.get('/verification/documents');
    return res.data;
  },

  async requestUploadUrl(
    documentType: DocVerificationType,
    fileName: string,
    fileType: string,
    fileSize?: number
  ): Promise<ApiResponse<PresignedUploadResult>> {
    const res = await apiClient.post('/verification/upload-url', { documentType, fileName, fileType, fileSize });
    return res.data;
  },

  async confirmUpload(
    documentId: string,
    s3Key: string,
    fileSize?: number
  ): Promise<ApiResponse<VerificationDoc>> {
    const res = await apiClient.post('/verification/confirm-upload', { documentId, s3Key, fileSize });
    return res.data;
  },

  async resubmit(
    verificationId: string,
    s3Key: string,
    reason: string
  ): Promise<ApiResponse<VerificationDoc>> {
    const res = await apiClient.post('/verification/resubmit', { verificationId, s3Key, reason });
    return res.data;
  },
};
