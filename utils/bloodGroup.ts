import type { BloodGroup } from '../types';

// The 8 canonical blood groups in the display format the backend Zod schema expects ("A+", "O-", …).
export const VALID_BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Maps the verbose backend/enum-style format to display format, and vice-versa where needed.
const VERBOSE_TO_DISPLAY: Record<string, BloodGroup> = {
  A_POSITIVE: 'A+', A_NEGATIVE: 'A-',
  B_POSITIVE: 'B+', B_NEGATIVE: 'B-',
  AB_POSITIVE: 'AB+', AB_NEGATIVE: 'AB-',
  O_POSITIVE: 'O+', O_NEGATIVE: 'O-',
};

/**
 * Normalize any blood-group input to the canonical display format ("A+", "O-").
 * Accepts display format ("o+"), verbose enum format ("O_POSITIVE"), and is
 * whitespace/case tolerant. Returns null when the value is not a valid blood group.
 */
export function normalizeBloodGroup(input: unknown): BloodGroup | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toUpperCase();
  if (!raw) return null;

  // Verbose enum form, e.g. "O_POSITIVE"
  if (VERBOSE_TO_DISPLAY[raw]) return VERBOSE_TO_DISPLAY[raw];

  // Display form, e.g. "O+" — also accept "O POS"/"OPOS" style variants collapsed
  const candidate = raw.replace(/\s+/g, '') as BloodGroup;
  if (VALID_BLOOD_GROUPS.includes(candidate)) return candidate;

  return null;
}

export function isValidBloodGroup(input: unknown): input is BloodGroup {
  return normalizeBloodGroup(input) !== null;
}
