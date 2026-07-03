import { UserRole, User } from '../types';

// Internal backend role types — kept for type safety, not shown in UI
export type { UserRole };

export function getUserDisplayRole(user?: User | null): string {
  const isDonor = !!user?.donorProfile;
  const isRecipient = !!user?.recipientProfile;
  if (isDonor && isRecipient) return 'Donor & Recipient';
  if (isDonor) return 'Donor';
  if (isRecipient) return 'Recipient';
  return 'Member';
}

export function getUserRoleColor(user?: User | null): string {
  const isDonor = !!user?.donorProfile;
  const isRecipient = !!user?.recipientProfile;
  if (isDonor && isRecipient) return '#8E44AD';
  if (isDonor) return '#E74C3C';
  if (isRecipient) return '#2980B9';
  return '#95A5A6';
}

export function isDonor(user?: User | null): boolean {
  return !!user?.donorProfile;
}

export function isRecipient(user?: User | null): boolean {
  return !!user?.recipientProfile;
}

export function canDonate(user?: User | null): boolean {
  return !!user?.donorProfile?.willingToDonate;
}
