import { BloodGroup, EmergencyLevel } from '../types';

// ─── Colors ───────────────────────────────────────────────────────────────────

export const COLORS = {
  // Primary
  primary: '#C0392B',
  primaryDark: '#96281B',
  primaryLight: '#E74C3C',
  primarySurface: '#FDEDEC',

  // Emergency
  critical: '#E74C3C',
  criticalBg: '#FDEDEC',
  moderate: '#F39C12',
  moderateBg: '#FEF9E7',
  stable: '#27AE60',
  stableBg: '#EAFAF1',

  // Neutrals
  white: '#FFFFFF',
  background: '#F8F9FA',
  surface: '#FFFFFF',
  border: '#E8ECF0',
  borderLight: '#F0F3F6',

  // Text
  textPrimary: '#1A1D23',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',

  // Blood Groups
  bloodGroup: '#8E1C1C',

  // Status
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Shadows
  shadowColor: '#000000',
};

// ─── Typography ───────────────────────────────────────────────────────────────

export const FONTS = {
  regular: 'System',
  medium: 'System',
  semibold: 'System',
  bold: 'System',
};

export const FONT_SIZES = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
};

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 48,
};

// ─── Border Radius ────────────────────────────────────────────────────────────

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  '2xl': 24,
  full: 9999,
};

// ─── Blood Groups ─────────────────────────────────────────────────────────────

export const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const BLOOD_GROUP_COLORS: Record<BloodGroup, string> = {
  'A+': '#E74C3C',
  'A-': '#C0392B',
  'B+': '#8E44AD',
  'B-': '#6C3483',
  'AB+': '#2980B9',
  'AB-': '#1A5276',
  'O+': '#27AE60',
  'O-': '#1E8449',
};

// ─── Emergency Levels ─────────────────────────────────────────────────────────

export const EMERGENCY_LEVELS: { value: EmergencyLevel; label: string; color: string; emoji: string }[] = [
  { value: 'critical', label: 'Critical', color: COLORS.critical, emoji: '🔴' },
  { value: 'moderate', label: 'Moderate', color: COLORS.moderate, emoji: '🟡' },
  { value: 'stable', label: 'Stable', color: COLORS.stable, emoji: '🟢' },
];

// ─── Document Types ───────────────────────────────────────────────────────────

export const DOCUMENT_TYPES = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'lab_report', label: 'Lab Report' },
  { value: 'blood_requirement_slip', label: 'Blood Requirement Slip' },
  { value: 'medical_report', label: 'Medical Report' },
  { value: 'donation_certificate', label: 'Donation Certificate' },
] as const;

// ─── Relation Options ─────────────────────────────────────────────────────────

export const RELATION_OPTIONS = [
  'Parent', 'Spouse', 'Child', 'Sibling', 'Friend', 'Other',
];

// ─── Map Defaults ─────────────────────────────────────────────────────────────

export const MAP_DEFAULTS = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const QUERY_KEYS = {
  user: ['user'],
  donors: ['donors'],
  bloodBanks: ['bloodBanks'],
  requests: ['requests'],
  myRequests: ['myRequests'],
  myDonations: ['myDonations'],
  verificationStatus: ['verificationStatus'],
  nearbyDonors: (lat: number, lng: number) => ['nearbyDonors', lat, lng],
  nearbyBanks: (lat: number, lng: number) => ['nearbyBanks', lat, lng],
  emergencyFeed: ['emergencyFeed'],
};
