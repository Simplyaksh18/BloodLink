import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { authRateLimiter, otpRateLimiter } from '../middleware/rateLimiter.middleware';
import {
  registerSchema,
  loginSchema,
  sendOtpSchema,
  verifyOtpSchema,
  updateProfileSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  firebaseLoginSchema,
  firebaseIdTokenSchema,
  refreshTokenSchema,
  otpLoginSchema,
} from '../utils/validators';

const router = Router();

// ── Public auth endpoints ──────────────────────────────────────────────────────
router.post('/register', authRateLimiter, validate(registerSchema), authController.register);
router.post('/login', authRateLimiter, validate(loginSchema), authController.login);
router.post('/firebase', authRateLimiter, validate(firebaseLoginSchema), authController.firebaseLogin);
router.post('/refresh', authRateLimiter, validate(refreshTokenSchema), authController.refreshToken);

router.post('/send-otp', otpRateLimiter, validate(sendOtpSchema), authController.sendOtp);
router.post('/verify-otp', authRateLimiter, validate(verifyOtpSchema), authController.verifyOtp);
router.post('/forgot-password', otpRateLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(resetPasswordSchema), authController.resetPassword);

router.get('/check-email', authController.checkEmail);
router.get('/check-phone', authController.checkPhone);
router.post('/otp-login', authRateLimiter, validate(otpLoginSchema), authController.otpLogin);

// ── Firebase Phone OTP (Phase 5E) ─────────────────────────────────────────────
router.post('/firebase-login', authRateLimiter, validate(firebaseIdTokenSchema), authController.firebasePhoneLogin);
router.post('/firebase-register-verify', authRateLimiter, validate(firebaseIdTokenSchema), authController.firebaseRegisterVerify);
router.post('/forgot-password/firebase-verify', otpRateLimiter, validate(firebaseIdTokenSchema), authController.forgotPasswordFirebaseVerify);

// ── Protected endpoints ────────────────────────────────────────────────────────
router.get('/me', authenticate, authController.getMe);
router.put('/profile', authenticate, validate(updateProfileSchema), authController.updateMe);
router.post('/logout', authenticate, authController.logout);
router.delete('/me', authenticate, authController.deleteAccount);

router.post('/verify-email', authenticate, authController.sendVerifyEmail);
router.get('/verify-email', authenticate, authController.confirmVerifyEmail);

export default router;
