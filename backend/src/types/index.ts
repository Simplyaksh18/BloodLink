export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
export type EmergencyLevel = 'critical' | 'moderate' | 'stable';
export type DonorVerificationStatus = 'pending' | 'eligible' | 'under_review' | 'not_eligible';
export type RequestVerificationStatus = 'pending' | 'approved' | 'rejected';
export type RequestStatus = 'open' | 'fulfilled' | 'cancelled';
export type DocumentType =
  | 'prescription'
  | 'lab_report'
  | 'blood_requirement_slip'
  | 'medical_report'
  | 'donation_certificate';

export interface ApiLocation {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface UploadedDocument {
  id: string;
  type: DocumentType;
  uri: string;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  status: 'uploading' | 'uploaded' | 'failed';
}

export interface ApiRecipientProfile {
  id: string;
  userId: string;
}

export interface ApiDonationEligibility {
  canDonate: boolean;
  nextEligibleDate: string | null;
  daysRemaining: number;
  status: 'eligible' | 'not_eligible';
  message: string;
}

export interface ApiDonationRecord {
  id: string;
  date: string;
  hospital: string;
  recipient?: string;
  units: number;
  bloodGroup: string;
}

export interface ApiUser {
  id: string;
  name: string;
  phone: string;
  role?: string;
  gender?: 'male' | 'female' | 'other';
  email?: string;
  avatar?: string;
  profileEmoji?: string;
  medicalCertificate?: string;
  bloodGroup?: BloodGroup;
  location?: ApiLocation;
  emergencyContact?: EmergencyContact;
  donorProfile?: ApiDonorProfile;
  recipientProfile?: ApiRecipientProfile;
  donationEligibility?: ApiDonationEligibility;
  donationHistory?: ApiDonationRecord[];
  livesSaved?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiDonorProfile {
  id: string;
  userId: string;
  bloodGroup: BloodGroup;
  lastDonationDate: string | null;
  willingToDonate: boolean;
  verificationStatus: DonorVerificationStatus;
  documents: UploadedDocument[];
  totalDonations: number;
}

export interface ApiDonorCard {
  id: string;
  name: string;
  bloodGroup: BloodGroup;
  gender?: 'male' | 'female' | 'other';
  age?: number;
  location: ApiLocation;
  lastDonationDate: string | null;
  willingToDonate: boolean;
  verificationStatus: DonorVerificationStatus;
  distance?: number;
  // Availability fields (Bug 3: donor discovery filtering)
  donorStatus?: string | null;
  importedDonor?: boolean;
  isImportedVerified?: boolean;
  // Backend-authoritative availability (donor discovery mismatch fix)
  canRequestBlood: boolean;
  availabilityLabel: 'Available' | 'Contact Pending' | 'Under Review' | 'Deferred';
  accountClaimed: boolean;
  verificationComplete: boolean;
}

export interface ApiBloodRequest {
  id: string;
  userId: string;
  requesterName: string;
  bloodGroup: BloodGroup;
  units: number;
  hospitalName: string;
  location: ApiLocation;
  emergencyLevel: EmergencyLevel;
  documents: UploadedDocument[];
  verificationStatus: RequestVerificationStatus;
  status: RequestStatus;
  // Phase 4.4: raw backend status for lifecycle UI (not collapsed to open/fulfilled/cancelled)
  rawStatus: 'OPEN' | 'ACTIVE' | 'IN_PROGRESS' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
  bloodBankId?: string;
  targetedDonorId?: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiBloodBank {
  id: string;
  name: string;
  location: ApiLocation;
  phone: string;
  email?: string;
  operatingHours: string;
  availableBloodGroups: BloodGroup[];
  isVerified: boolean;
  verificationStatus?: string;
  distance?: number;
  ownerId?: string;
  licenseNumber?: string;
  rejectionReason?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface JwtPayload {
  userId: string;
  phone: string;
  role: string;
  tokenVersion?: number;
  iat?: number;
  exp?: number;
}
