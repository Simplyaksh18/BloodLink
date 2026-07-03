// ─── Blood Types ─────────────────────────────────────────────────────────────

export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export type EmergencyLevel = 'critical' | 'moderate' | 'stable';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'under_review' | 'eligible' | 'not_eligible';

export type DocumentType = 'prescription' | 'lab_report' | 'blood_requirement_slip' | 'medical_report' | 'donation_certificate';

// ─── User ─────────────────────────────────────────────────────────────────────

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR' | 'BLOOD_BANK' | 'USER';

export interface DonationEligibility {
  canDonate: boolean;
  nextEligibleDate: string | null;
  daysRemaining: number;
  status: 'eligible' | 'not_eligible';
  message: string;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role?: UserRole;
  gender?: 'male' | 'female' | 'other';
  email?: string;
  password?: string;
  avatar?: string;
  profileEmoji?: string;
  medicalCertificate?: string;
  bloodGroup?: BloodGroup;
  location?: Location;
  emergencyContact?: EmergencyContact;
  donorProfile?: DonorProfile;
  recipientProfile?: RecipientProfile;
  livesSaved?: number;
  donationEligibility?: DonationEligibility;
  donationHistory?: DonationRecord[];
  // Document verification flags (from backend Phase 3)
  idVerified?: boolean;
  bloodGroupVerified?: boolean;
  medicalVerified?: boolean;
  // Phase 4 donor eligibility
  isDonor?: boolean;
  isDonorEligible?: boolean;
  donorEligibleSince?: string | null;
  donorEligibilityExpiry?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Phase 5 Stateful Donor Status ───────────────────────────────────────────

export type DonorStatus =
  | 'NEVER_DONATED'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'DEFERRED'
  | 'INELIGIBLE';

export interface DonorStatusData {
  donorStatus: DonorStatus;
  isEligible: boolean;
  nextEligibleDate: string | null;
  daysRemaining: number | null;
  deferralDate: string | null;
  deferralReason: string | null;
  totalDonations: number;
  lastDonationDate: string | null;
  reminderSet: boolean;
  canBecomeDonor: boolean;
}

// ─── Phase 4 Donor Eligibility API Types ──────────────────────────────────────

export interface EligibilityStatusData {
  eligible: boolean;
  lastChecked: string;
  eligibilityExpiry: string | null;
  donationCooldown: {
    onCooldown: boolean;
    lastDonationDate: string | null;
    daysSinceLastDonation: number | null;
    nextEligibleDate: string | null;
  };
  medicalScreening: {
    verified: boolean;
    expiryDate: string | null;
  };
  healthScreening: {
    completed: boolean;
    passed: boolean | null;
    date: string | null;
  };
}

export interface DocumentStatusEntry {
  id: string;
  verified: boolean;
  expiryDate: string | null;
}

export interface DocumentStatusData {
  documentsAvailable: boolean;
  existingDocuments: {
    idProof?: DocumentStatusEntry;
    bloodGroupProof?: DocumentStatusEntry;
    medicalScreening?: DocumentStatusEntry;
  };
  needsDocuments: string[];
  canProceed: boolean;
}

export interface HealthScreeningPayload {
  height?: number;
  weight?: number;
  bloodPressure?: string;
  hemoglobinLevel?: number;
  pulseRate?: number;
  temperature?: number;
  hasHeartDisease: boolean;
  hasDiabetes: boolean;
  hasHepatitis: boolean;
  hasHiv: boolean;
  hasTuberculosis: boolean;
  hasCancer: boolean;
  hasBleedingDisorder: boolean;
  hasSeizureDisorder: boolean;
  hasKidneyDisease: boolean;
  hasLiverDisease: boolean;
  hasRespiratoryDisease: boolean;
  hasAutoimmuneDisease: boolean;
  hasRecentSurgery: boolean;
  recentSurgeryDate?: string;
  hasRecentTattoo: boolean;
  recentTattooDate?: string;
  hasRecentPiercing: boolean;
  recentPiercingDate?: string;
  hasRecentTravel: boolean;
  recentTravelCountry?: string;
  hasRecentVaccination: boolean;
  recentVaccinationDate?: string;
  hasDonatedBefore: boolean;
  hasAdverseReaction: boolean;
  adverseReactionDetail?: string;
  isOnMedication: boolean;
  medicationDetails?: string;
  isPregnant: boolean;
  isBreastfeeding: boolean;
  hasConsumedAlcohol24h: boolean;
  hasFever: boolean;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relation: string;
}

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

// ─── Donor ────────────────────────────────────────────────────────────────────

export interface DonorProfile {
  id: string;
  userId: string;
  bloodGroup: BloodGroup;
  lastDonationDate: string | null;
  willingToDonate: boolean;
  verificationStatus: 'pending' | 'eligible' | 'under_review' | 'not_eligible';
  documents: UploadedDocument[];
  totalDonations: number;
}

export interface DonorCard {
  id: string;
  name: string;
  bloodGroup: BloodGroup;
  gender?: 'male' | 'female' | 'other';
  age?: number;
  location: Location;
  lastDonationDate: string | null;
  willingToDonate: boolean;
  verificationStatus: DonorProfile['verificationStatus'];
  distance?: number;
  // Availability fields (Bug 3: discovery filtering)
  donorStatus?: string | null;
  importedDonor?: boolean;
  isImportedVerified?: boolean;
  // Backend-authoritative availability (donor discovery mismatch fix)
  canRequestBlood?: boolean;
  availabilityLabel?: 'Available' | 'Contact Pending' | 'Under Review' | 'Deferred';
  accountClaimed?: boolean;
  verificationComplete?: boolean;
}

// ─── Recipient ──────────────────────────────────────────────────────────────────

export interface RecipientProfile {
  id: string;
  userId: string;
  bloodGroup: BloodGroup;
  lastReceivedDate: string | null;
  hospitalName?: string;
}

// ─── Blood Request ────────────────────────────────────────────────────────────

export type RawRequestStatus = 'OPEN' | 'ACTIVE' | 'IN_PROGRESS' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';

export interface BloodRequest {
  id: string;
  userId: string;
  requesterName: string;
  bloodGroup: BloodGroup;
  units: number;
  hospitalName: string;
  location: Location;
  emergencyLevel: EmergencyLevel;
  documents: UploadedDocument[];
  verificationStatus: 'pending' | 'approved' | 'rejected';
  status: 'open' | 'fulfilled' | 'cancelled';
  rawStatus?: RawRequestStatus;
  bloodBankId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Blood Bank ───────────────────────────────────────────────────────────────

export interface BloodBank {
  id: string;
  name: string;
  location: Location;
  phone: string;
  email?: string;
  operatingHours: string;
  availableBloodGroups: BloodGroup[];
  isVerified: boolean;
  verificationStatus?: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  distance?: number;
  ownerId?: string;
  licenseNumber?: string;
  rejectionReason?: string;
}

// ─── Document Upload ──────────────────────────────────────────────────────────

export interface UploadedDocument {
  id: string;
  type: DocumentType;
  uri: string;
  fileName: string;
  mimeType: string;
  uploadedAt: string;
  status: 'uploading' | 'uploaded' | 'failed';
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasRegisteredAsDonor: boolean;
  lastProfileUpdate: number | null;
}

export interface OtpRequest {
  phone: string;
}

export interface OtpVerify {
  phone: string;
  otp: string;
}

export interface RegisterRequest {
  name: string;
  phone: string;
  gender?: 'male' | 'female' | 'other';
  email?: string;
  password?: string;
  bloodGroup?: BloodGroup;
  location?: Location;
  emergencyContact?: EmergencyContact;
  role?: UserRole;
}

export interface LoginRequest {
  phone: string;
  password?: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ─── Map ──────────────────────────────────────────────────────────────────────

export interface MapFilter {
  bloodGroup?: BloodGroup;
  maxDistance?: number;
  showDonors: boolean;
  showBloodBanks: boolean;
  showRequests: boolean;
}

// ─── Forms ────────────────────────────────────────────────────────────────────

export interface RegisterForm {
  name: string;
  phone: string;
  email: string;
  gender: 'male' | 'female' | 'other';
  bloodGroup: BloodGroup;
  address: string;
  city: string;
  state: string;
  pincode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
}

export interface BloodRequestForm {
  bloodGroup: BloodGroup;
  units: number;
  hospitalName: string;
  address: string;
  city: string;
  emergencyLevel: EmergencyLevel;
  // Phase 4 fields
  urgency?: 'RED' | 'YELLOW' | 'GREEN';
  contactPhone?: string;
  hospitalLatitude?: number;
  hospitalLongitude?: number;
  requiredBy?: string;
  reason?: string;
  documents: UploadedDocument[];
}

export interface DonorForm {
  bloodGroup: BloodGroup;
  lastDonationDate: string | null;
  willingToDonate: boolean;
  documents: UploadedDocument[];
}

// ─── Donation History ─────────────────────────────────────────────────────────

export interface DonationRecord {
  id: string;
  date: string;
  hospital: string;
  recipient?: string;
  units: number;
  bloodGroup: BloodGroup;
}

export interface RequestRecord {
  id: string;
  date: string;
  bloodGroup: BloodGroup;
  units: number;
  hospital: string;
  status: BloodRequest['status'];
  verificationStatus: BloodRequest['verificationStatus'];
}
