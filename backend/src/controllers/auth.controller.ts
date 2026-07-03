import { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import * as userService from '../services/user.service';
import { ApiResponse } from '../utils/ApiResponse';
import { asyncHandler } from '../utils/asyncHandler';
import { auditFromRequest } from '../services/audit.service';
import { maskPhone } from '../utils/piiSanitizer';

function deviceInfo(req: Request) {
  return {
    platform: req.headers['x-platform'] as string | undefined,
    version: req.headers['x-app-version'] as string | undefined,
    model: req.headers['x-device-model'] as string | undefined,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body, deviceInfo(req), req.ip);
  auditFromRequest(req, 'REGISTER', { userId: (result as any)?.user?.id });
  ApiResponse.created(res, result, 'Registration successful');
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body;
  try {
    const result = await authService.login(phone, req.body.password, deviceInfo(req), req.ip);
    auditFromRequest(req, 'LOGIN_SUCCESS', { userId: (result as any)?.user?.id });
    ApiResponse.success(res, result, 'Login successful');
  } catch (err) {
    auditFromRequest(req, 'LOGIN_FAILURE', { metadata: { maskedPhone: maskPhone(phone ?? '') } });
    throw err;
  }
});

export const firebaseLogin = asyncHandler(async (req: Request, res: Response) => {
  const { firebaseToken } = req.body;
  const result = await authService.firebaseLogin(firebaseToken, deviceInfo(req), req.ip);
  ApiResponse.success(res, result, 'Firebase login successful');
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;
  const result = await authService.refreshAccessToken(token, deviceInfo(req), req.ip);
  ApiResponse.success(res, result, 'Token refreshed');
});

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.sendOtp(req.body.phone);
  ApiResponse.success(res, result);
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyOtp(req.body.phone, req.body.otp);
  ApiResponse.success(res, result, 'OTP verified successfully');
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.forgotPassword(req.body.phone);
  auditFromRequest(req, 'PASSWORD_RESET_REQUEST', { metadata: { maskedPhone: maskPhone(req.body.phone ?? '') } });
  ApiResponse.success(res, result, 'OTP sent for password reset');
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { phone, otp, newPassword, resetToken } = req.body;
  if (resetToken) {
    await authService.resetPasswordWithToken(resetToken, newPassword);
  } else {
    await authService.resetPassword(phone, otp, newPassword);
  }
  auditFromRequest(req, 'PASSWORD_RESET_COMPLETE');
  ApiResponse.success(res, null, 'Password reset successful');
});

export const sendVerifyEmail = asyncHandler(async (req: Request, res: Response) => {
  await authService.sendEmailVerification(req.user!.userId);
  ApiResponse.success(res, null, 'Verification email sent');
});

export const confirmVerifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.query as { token: string };
  await authService.confirmEmailVerification(token, req.user!.userId);
  ApiResponse.success(res, null, 'Email verified successfully');
});

export const checkEmail = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.query as { email: string };
  const result = await authService.checkEmailAvailability(email);
  ApiResponse.success(res, result);
});

export const otpLogin = asyncHandler(async (req: Request, res: Response) => {
  const { phone, verificationToken } = req.body;
  const result = await authService.otpLogin(phone, verificationToken, deviceInfo(req), req.ip);
  ApiResponse.success(res, result, 'Login successful');
});

export const checkPhone = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.query as { phone: string };
  const result = await authService.checkPhone(phone);
  ApiResponse.success(res, result);
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getProfile(req.user!.userId);
  ApiResponse.success(res, user);
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateProfile(req.user!.userId, req.body);
  auditFromRequest(req, 'PROFILE_UPDATE', { userId: req.user!.userId });
  ApiResponse.success(res, user, 'Profile updated');
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.headers.authorization!.slice(7);
  const refreshToken = req.body?.refreshToken as string | undefined;
  await authService.logout(token, refreshToken);
  auditFromRequest(req, 'LOGOUT', { userId: req.user!.userId });
  ApiResponse.success(res, null, 'Logged out successfully');
});

export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const { userRepository } = await import('../repositories/user.repository');
  await userRepository.softDelete(req.user!.userId);
  const token = req.headers.authorization!.slice(7);
  await authService.logout(token);
  ApiResponse.success(res, null, 'Account deleted');
});

// ─── Firebase Phone OTP handlers (Phase 5E) ───────────────────────────────────

function replyFirebaseUnavailable(err: any, res: Response): boolean {
  if ((err?.statusCode === 503) || (err?.message ?? '').includes('not configured')) {
    res.status(503).json({ success: false, message: 'Firebase OTP is not available on this server.' });
    return true;
  }
  return false;
}

export const firebasePhoneLogin = asyncHandler(async (req: Request, res: Response) => {
  const { firebaseIdToken } = req.body;
  try {
    const result = await authService.firebasePhoneLogin(firebaseIdToken, deviceInfo(req), req.ip);
    ApiResponse.success(res, result, 'Login successful');
  } catch (err: any) {
    if (replyFirebaseUnavailable(err, res)) return;
    throw err;
  }
});

export const firebaseRegisterVerify = asyncHandler(async (req: Request, res: Response) => {
  const { firebaseIdToken } = req.body;
  try {
    const result = await authService.firebaseRegisterVerify(firebaseIdToken);
    ApiResponse.success(res, result, 'Phone verified');
  } catch (err: any) {
    if (replyFirebaseUnavailable(err, res)) return;
    throw err;
  }
});

export const forgotPasswordFirebaseVerify = asyncHandler(async (req: Request, res: Response) => {
  const { firebaseIdToken } = req.body;
  try {
    const result = await authService.forgotPasswordFirebaseVerify(firebaseIdToken);
    ApiResponse.success(res, result, 'Reset token issued');
  } catch (err: any) {
    if (replyFirebaseUnavailable(err, res)) return;
    throw err;
  }
});
