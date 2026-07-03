import { z } from 'zod';

const bloodGroupEnum = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const emergencyLevelEnum = z.enum(['critical', 'moderate', 'stable']);
const genderEnum = z.enum(['male', 'female', 'other']);

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(4).max(10),
});

const emergencyContactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  relation: z.string().min(1),
});

export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(10).max(15),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // verificationToken is a signed JWT issued by /verify-otp — not a UUID.
  verificationToken: z.string().min(1).optional(),
  role: z.enum(['USER', 'BLOOD_BANK']).optional(),
  gender: genderEnum.optional(),
  email: z.string().email().optional().or(z.literal('')),
  bloodGroup: bloodGroupEnum.optional(),
  location: locationSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),
});

export const loginSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  phone: z.string().min(10).max(15),
});

export const resetPasswordSchema = z.object({
  phone:      z.string().min(10).max(15).optional(),
  otp:        z.string().length(6).optional(),
  resetToken: z.string().min(32).optional(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
}).refine(
  d => (!!d.phone && !!d.otp) || !!d.resetToken,
  { message: 'Provide either (phone + otp) or resetToken for password reset' }
);

export const sendOtpSchema = z.object({
  phone: z.string().min(10).max(15),
});

export const firebaseLoginSchema = z.object({
  firebaseToken: z.string().min(1, 'Firebase token is required'),
});

export const firebaseIdTokenSchema = z.object({
  firebaseIdToken: z.string().min(1, 'Firebase ID token is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().uuid('Invalid refresh token'),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  gender: genderEnum.optional(),
  email: z.string().email().optional(),
  bloodGroup: bloodGroupEnum.optional(),
  location: locationSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),
  medicalCertificate: z.string().url().optional(),
  profileEmoji: z.string().emoji().max(8).optional(),
});

const urgencyEnum = z.enum(['RED', 'YELLOW', 'GREEN']);

export const createRequestSchema = z.object({
  bloodGroup:    bloodGroupEnum,
  units:         z.number().int().min(1).max(10),
  hospitalName:  z.string().min(2),
  address:       z.string().min(5),
  city:          z.string().min(1),
  // urgency (Phase 4 preferred) OR emergencyLevel (legacy) — one is required
  urgency:       urgencyEnum.optional(),
  emergencyLevel: emergencyLevelEnum.optional(),
  contactPhone:  z.string().min(10, 'Contact phone must be at least 10 digits'),
  hospitalLatitude:  z.number().min(-90).max(90),
  hospitalLongitude: z.number().min(-180).max(180),
  requiredBy: z
    .string()
    .datetime()
    .refine(val => new Date(val) > new Date(), { message: 'requiredBy must be a future date' }),
  reason:        z.string().optional(),
  documents:     z.array(z.any()).default([]),
  patientName:   z.string().optional(),
  patientAge:    z.number().int().min(0).max(150).optional(),
  patientGender: z.string().optional(),
  hospitalContact: z.string().optional(),
  doctorName:    z.string().optional(),
  doctorContact: z.string().optional(),
  notes:         z.string().optional(),
  // Targeted donor — when present, only this donor is notified and can respond
  targetedDonorId: z.string().uuid().optional(),
}).refine(
  d => d.urgency || d.emergencyLevel,
  { message: 'urgency (RED|YELLOW|GREEN) is required', path: ['urgency'] }
);

export const donorFormSchema = z.object({
  bloodGroup: bloodGroupEnum,
  lastDonationDate: z.string().nullable().optional(),
  willingToDonate: z.boolean(),
  documents: z.array(z.any()).default([]),
});

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(1).max(100).default(20),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
});

export const healthScreeningSchema = z.object({
  // Physical (optional — might not have readings at time of form submission)
  height:          z.number().min(50).max(300).optional(),
  weight:          z.number().min(10).max(500).optional(),
  bloodPressure:   z.string().regex(/^\d{2,3}\/\d{2,3}$/, 'Format must be "120/80"').optional(),
  hemoglobinLevel: z.number().min(1).max(30).optional(),
  pulseRate:       z.number().int().min(20).max(300).optional(),
  temperature:     z.number().min(30).max(45).optional(),

  // Medical history — all required booleans
  hasHeartDisease:      z.boolean(),
  hasDiabetes:          z.boolean(),
  hasHepatitis:         z.boolean(),
  hasHiv:               z.boolean(),
  hasTuberculosis:      z.boolean(),
  hasCancer:            z.boolean(),
  hasBleedingDisorder:  z.boolean(),
  hasSeizureDisorder:   z.boolean(),
  hasKidneyDisease:     z.boolean(),
  hasLiverDisease:      z.boolean(),
  hasRespiratoryDisease: z.boolean(),
  hasAutoimmuneDisease:  z.boolean(),

  // Temporary deferral conditions
  hasRecentSurgery:      z.boolean(),
  recentSurgeryDate:     z.string().datetime().optional(),
  hasRecentTattoo:       z.boolean(),
  recentTattooDate:      z.string().datetime().optional(),
  hasRecentPiercing:     z.boolean(),
  recentPiercingDate:    z.string().datetime().optional(),
  hasRecentTravel:       z.boolean(),
  recentTravelCountry:   z.string().max(100).optional(),
  hasRecentVaccination:  z.boolean(),
  recentVaccinationDate: z.string().datetime().optional(),

  // Donation specific
  hasDonatedBefore:      z.boolean(),
  hasAdverseReaction:    z.boolean(),
  adverseReactionDetail: z.string().max(500).optional(),
  isOnMedication:        z.boolean(),
  medicationDetails:     z.string().max(500).optional(),
  isPregnant:            z.boolean(),
  isBreastfeeding:       z.boolean(),
  hasConsumedAlcohol24h: z.boolean(),
  hasFever:              z.boolean(),
});

export const setReminderSchema = z.object({
  reminderDate: z.string().datetime('Must be a valid ISO date-time'),
});

export const mapQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  showDonors: z.string().transform((v) => v === 'true').default('true'),
  showBloodBanks: z.string().transform((v) => v === 'true').default('true'),
  showRequests: z.string().transform((v) => v === 'true').default('true'),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  radius: z.coerce.number().min(1).max(100).default(20),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
});

export const otpLoginSchema = z.object({
  phone: z.string().min(10).max(15),
  verificationToken: z.string().min(1, 'Verification token is required'),
});

export const checkPhoneSchema = z.object({
  phone: z.string().min(10).max(15),
});

export const bloodBankRequestSchema = z.object({
  bloodGroup: bloodGroupEnum,
  unitsRequired: z.number().int().min(1).max(10),
  priority: z.enum(['critical', 'moderate', 'normal']).optional(),
});
