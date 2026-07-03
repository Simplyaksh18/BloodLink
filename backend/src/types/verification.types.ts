import { VerificationType, VerificationStatus } from '@prisma/client';

export { VerificationType, VerificationStatus };

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
] as const;

export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'] as const;

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;  // 5MB
export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;    // 10MB
export const PRESIGNED_URL_EXPIRY_SECONDS = 300;        // 5 min
export const DOCUMENT_VIEW_URL_EXPIRY_SECONDS = 3600;   // 1 hour
export const MEDICAL_SCREENING_VALIDITY_DAYS = 180;     // 6 months
export const BLOOD_GROUP_CERT_VALIDITY_DAYS = 365;      // 1 year
export const UPLOAD_RATE_LIMIT_PER_HOUR = 10;
export const FRAUD_SCORE_THRESHOLD = 60;
export const CONFIDENCE_APPROVE_THRESHOLD = 60;  // minimum confidence to auto-approve
export const RAPID_RESUBMIT_WINDOW_MINUTES = 5;
export const RAPID_RESUBMIT_MAX_COUNT = 3;

export interface PresignedUploadResult {
  uploadUrl: string;
  documentId: string;
  s3Key: string;
  expiresIn: number;
}

export interface AutoCheckResult {
  checkName: string;
  passed: boolean;
  message: string;
  suggestion?: string;
}

export interface RejectionDetail {
  check: string;
  message: string;
  suggestion: string;
}

// Confidence breakdown stored in autoCheckResults for each verified document
export interface ConfidenceBreakdown {
  totalConfidence: number;
  documentQuality: {
    score: number; maxScore: number;
    details: { sharpness: number; contrast: number; alignment: number; readability: number };
    issues: string[];
  };
  ocrExtraction: {
    score: number; maxScore: number;
    details: { fieldsExtracted: string; averageFieldConfidence: number; missingFields: string[] };
    issues: string[];
  };
  dataConsistency: {
    score: number; maxScore: number;
    details: { nameMatch: number; dobMatch: number; bloodGroupMatch: number; documentTypeMatch: number };
    issues: string[];
  };
  securityChecks: {
    score: number; maxScore: number;
    details: { isUnique: boolean; tamperingDetected: boolean; fraudFlagCount: number };
    issues: string[];
  };
  recommendedAction: string;
  processingTimeMs: number;
}

export interface AutoChecksOutput {
  passed: boolean;
  results: AutoCheckResult[];
  fraudIndicators: string[];
  fraudScoreDelta: number;
  confidenceBreakdown: ConfidenceBreakdown;
}

export interface ApiVerification {
  id: string;
  userId: string;
  verificationType: VerificationType;
  status: VerificationStatus;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  uploadedAt?: string;
  autoCheckPassed?: boolean;
  fraudScore: number;
  reviewedAt?: string;
  reviewNotes?: string;
  rejectionReason?: string;
  expiresAt?: string;
  isExpired: boolean;
  resubmissionCount: number;
  createdAt: string;
  updatedAt: string;
  documentUrl?: string;
  rejectionDetails?: RejectionDetail[];
  canResubmit?: boolean;
}

export interface ApiVerificationStatus {
  userId: string;
  idVerified: boolean;
  bloodGroupVerified: boolean;
  medicalVerified: boolean;
  overallStatus: 'UNVERIFIED' | 'PARTIALLY_VERIFIED' | 'FULLY_VERIFIED';
  verifications: Partial<Record<VerificationType, ApiVerification>>;
}

export interface ApiFraudAlert {
  id: string;
  verificationId: string;
  userId: string;
  alertType: string;
  severity: number;
  description: string;
  metadata?: Record<string, unknown>;
  isResolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface ApiVerificationQueueItem extends ApiVerification {
  user: {
    id: string;
    name: string;
    phone: string;
    bloodGroup: string | null;
  };
  fraudAlerts: ApiFraudAlert[];
}
