import { BLOOD_GROUP_COMPATIBILITY, DONATION_COOLDOWN_DAYS } from './constants';
import { BloodGroup } from '../types';

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function isCompatibleDonor(donorBloodGroup: BloodGroup, requiredBloodGroup: BloodGroup): boolean {
  return BLOOD_GROUP_COMPATIBILITY[requiredBloodGroup]?.includes(donorBloodGroup) ?? false;
}

export function canDonateAgain(lastDonationDate: Date | null): boolean {
  if (!lastDonationDate) return true;
  const daysSince = (Date.now() - lastDonationDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= DONATION_COOLDOWN_DAYS;
}

export function generateOtp(length = 6): string {
  const digits = '0123456789';
  return Array.from({ length }, () => digits[Math.floor(Math.random() * 10)]).join('');
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return '****';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

export function paginate(page: number, limit: number): { skip: number; take: number } {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(Math.max(1, limit), 100);
  return { skip: (safePage - 1) * safeLimit, take: safeLimit };
}

export function sanitizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('91')) return `+${digits.slice(1)}`;
  return `+${digits}`;
}
