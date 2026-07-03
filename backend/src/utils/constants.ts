export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export const BLOOD_GROUP_COMPATIBILITY: Record<string, string[]> = {
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'A-': ['A-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'AB+': ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  'AB-': ['A-', 'B-', 'AB-', 'O-'],
  'O+': ['O+', 'O-'],
  'O-': ['O-'],
};

export const EMERGENCY_LEVEL_MAP = {
  critical: 'RED',
  moderate: 'YELLOW',
  stable: 'GREEN',
} as const;

export const PRIORITY_TO_LEVEL_MAP = {
  RED: 'critical',
  YELLOW: 'moderate',
  GREEN: 'stable',
} as const;

export const DEFAULT_SEARCH_RADIUS_KM = 20;
export const MAX_SEARCH_RADIUS_KM = 100;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const DONATION_COOLDOWN_DAYS = 90;

export const OTP_LENGTH = 6;

export const TOKEN_BLACKLIST_PREFIX = 'bl:token:';
export const OTP_PREFIX = 'bl:otp:';
export const RATE_LIMIT_PREFIX = 'bl:rl:';
