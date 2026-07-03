import { haversineDistanceKm, isCompatibleDonor, canDonateAgain, generateOtp, sanitizePhone } from '../../src/utils/helpers';

describe('haversineDistanceKm', () => {
  it('returns 0 for same coordinates', () => {
    expect(haversineDistanceKm(28.6, 77.2, 28.6, 77.2)).toBeCloseTo(0, 1);
  });

  it('calculates reasonable distance between Delhi and Mumbai', () => {
    const dist = haversineDistanceKm(28.6139, 77.209, 19.076, 72.8777);
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1500);
  });
});

describe('isCompatibleDonor', () => {
  it('O- can donate to all blood groups', () => {
    const groups: Array<'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'> = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    for (const g of groups) {
      expect(isCompatibleDonor('O-', g)).toBe(true);
    }
  });

  it('AB+ can only receive from all but donate to AB+', () => {
    expect(isCompatibleDonor('AB+', 'AB+')).toBe(true);
    expect(isCompatibleDonor('AB+', 'O+')).toBe(false);
  });
});

describe('canDonateAgain', () => {
  it('returns true if no previous donation', () => {
    expect(canDonateAgain(null)).toBe(true);
  });

  it('returns false if donated within 90 days', () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(canDonateAgain(recent)).toBe(false);
  });

  it('returns true if last donation was over 90 days ago', () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    expect(canDonateAgain(old)).toBe(true);
  });
});

describe('generateOtp', () => {
  it('generates 6-digit OTP', () => {
    const otp = generateOtp(6);
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });
});

describe('sanitizePhone', () => {
  it('adds +91 prefix to 10-digit number', () => {
    expect(sanitizePhone('9876543210')).toBe('+919876543210');
  });

  it('handles existing country code', () => {
    expect(sanitizePhone('+919876543210')).toBe('+919876543210');
  });
});
