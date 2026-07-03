import apiClient, { tokenStorage, userStorage, refreshTokenStorage } from './apiClient';
import { ApiResponse, OtpRequest, OtpVerify, RegisterRequest, User, LoginRequest } from '../types';
import { normalizeBloodGroup } from '../utils/bloodGroup';

// Builds a clean profile-update payload that satisfies the backend Zod schema.
// The backend rejects empty strings on optional `email` (.email()) and
// `medicalCertificate` (.url()) with a 422 — so we OMIT any field that is empty
// or invalid rather than sending a blank value.
function sanitizeProfilePayload(data: Partial<RegisterRequest>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (typeof data.name === 'string' && data.name.trim().length >= 2) {
    out.name = data.name.trim();
  }

  if (typeof data.email === 'string') {
    const email = data.email.trim();
    // Only include a syntactically valid email; omit empty/invalid to avoid 422
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = email;
  }

  if (data.bloodGroup != null && String(data.bloodGroup).trim() !== '') {
    const bg = normalizeBloodGroup(data.bloodGroup);
    if (bg) out.bloodGroup = bg; // normalized to "A+" display format
  }

  if ((data as any).gender) out.gender = (data as any).gender;
  if ((data as any).location) out.location = (data as any).location;
  if ((data as any).emergencyContact) out.emergencyContact = (data as any).emergencyContact;

  const cert = (data as any).medicalCertificate;
  if (typeof cert === 'string' && cert.trim()) {
    // Backend requires a valid URL. Only forward http(s) URLs — local file:// /
    // content:// URIs from the document picker are not yet uploaded to storage.
    if (/^https?:\/\//i.test(cert.trim())) out.medicalCertificate = cert.trim();
  }

  return out;
}

export const authService = {
  async sendOtp(data: OtpRequest): Promise<ApiResponse<{ message: string; expiresIn: number; otp?: string }>> {
    const res = await apiClient.post('/auth/send-otp', data);
    return res.data;
  },

  async verifyOtp(
    data: OtpVerify
  ): Promise<ApiResponse<{ verified: boolean; verificationToken: string; isNewUser: boolean }>> {
    const res = await apiClient.post('/auth/verify-otp', data);
    return res.data;
  },

  async register(
    data: RegisterRequest & { verificationToken?: string }
  ): Promise<ApiResponse<{ token: string; refreshToken: string; user: User }>> {
    const res = await apiClient.post('/auth/register', data);
    return res.data;
  },

  async loginWithPassword(
    data: LoginRequest
  ): Promise<ApiResponse<{ token: string; refreshToken: string; user: User }>> {
    const res = await apiClient.post('/auth/login', data);
    return res.data;
  },

  async firebaseLogin(
    firebaseToken: string
  ): Promise<ApiResponse<{ token: string; refreshToken: string; user: User }>> {
    const res = await apiClient.post('/auth/firebase', { firebaseToken });
    return res.data;
  },

  // Phase 5E — Firebase Phone OTP
  async firebasePhoneLogin(
    firebaseIdToken: string
  ): Promise<ApiResponse<{ token: string; refreshToken: string; user: User }>> {
    const res = await apiClient.post('/auth/firebase-login', { firebaseIdToken });
    return res.data;
  },

  async firebaseRegisterVerify(
    firebaseIdToken: string
  ): Promise<ApiResponse<{ verified: boolean; phone: string; verificationToken: string; isNewUser: boolean }>> {
    const res = await apiClient.post('/auth/firebase-register-verify', { firebaseIdToken });
    return res.data;
  },

  async forgotPasswordVerifyOtp(
    firebaseIdToken: string
  ): Promise<ApiResponse<{ resetToken: string }>> {
    const res = await apiClient.post('/auth/forgot-password/firebase-verify', { firebaseIdToken });
    return res.data;
  },

  async resetPasswordWithToken(
    resetToken: string,
    newPassword: string
  ): Promise<ApiResponse<null>> {
    const res = await apiClient.post('/auth/reset-password', { resetToken, newPassword });
    return res.data;
  },

  async refreshToken(
    refreshToken: string
  ): Promise<ApiResponse<{ token: string; refreshToken: string }>> {
    const res = await apiClient.post('/auth/refresh', { refreshToken });
    return res.data;
  },

  async getProfile(): Promise<ApiResponse<User>> {
    const token = await tokenStorage.get();
    if (!token) {
      return { success: false, data: null as any, message: 'No token' };
    }
    const res = await apiClient.get('/auth/me');
    return res.data;
  },

  async updateProfile(data: Partial<RegisterRequest>): Promise<ApiResponse<User>> {
    const payload = sanitizeProfilePayload(data);
    const res = await apiClient.put('/auth/profile', payload);
    return res.data;
  },

  async updateEmoji(emoji: string): Promise<ApiResponse<User>> {
    const res = await apiClient.put('/auth/profile', { profileEmoji: emoji });
    return res.data;
  },

  async forgotPassword(phone: string): Promise<ApiResponse<{ message: string; expiresIn: number; otp?: string }>> {
    const res = await apiClient.post('/auth/forgot-password', { phone });
    return res.data;
  },

  async resetPassword(
    phone: string,
    otp: string,
    newPassword: string
  ): Promise<ApiResponse<null>> {
    const res = await apiClient.post('/auth/reset-password', { phone, otp, newPassword });
    return res.data;
  },

  async sendEmailVerification(): Promise<ApiResponse<null>> {
    const res = await apiClient.post('/auth/verify-email');
    return res.data;
  },

  async checkEmailAvailability(email: string): Promise<ApiResponse<{ available: boolean }>> {
    const res = await apiClient.get(`/auth/check-email?email=${encodeURIComponent(email)}`);
    return res.data;
  },

  async checkPhone(phone: string): Promise<ApiResponse<{ exists: boolean }>> {
    const res = await apiClient.get(`/auth/check-phone?phone=${encodeURIComponent(phone)}`);
    return res.data;
  },

  async otpLogin(phone: string, verificationToken: string): Promise<ApiResponse<{ token: string; refreshToken: string; user: User }>> {
    const res = await apiClient.post('/auth/otp-login', { phone, verificationToken });
    return res.data;
  },

  async logout(): Promise<void> {
    try {
      const refreshToken = await refreshTokenStorage.get();
      await apiClient.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } catch {
      /* best-effort */
    } finally {
      await tokenStorage.remove();
      await refreshTokenStorage.remove();
      await userStorage.remove();
    }
  },
};
