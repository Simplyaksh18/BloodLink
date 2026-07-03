import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { userRepository } from '../repositories/user.repository';
import { BadRequestError, ConflictError, UnauthorizedError, NotFoundError } from '../utils/ApiError';
import { JwtPayload } from '../types';
import { generateOtp, sanitizePhone } from '../utils/helpers';
import { OTP_PREFIX, TOKEN_BLACKLIST_PREFIX } from '../utils/constants';
import { logger } from '../config/logger';
import { mapUserToApi } from './user.service';
import { prisma } from '../config/database';
import { verifyFirebaseToken } from './firebase.service';
import { Prisma } from '@prisma/client';

const VERIFICATION_TOKEN_PREFIX = 'bl:vt:';
const VERIFICATION_TOKEN_TTL = 15 * 60; // 15 minutes
const EMAIL_VERIFY_PREFIX = 'bl:ev:';
const EMAIL_VERIFY_TTL = 24 * 60 * 60; // 24 hours

// ─── JWT ──────────────────────────────────────────────────────────────────────

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

function signRefreshToken(): string {
  return uuidv4();
}

// ─── Session helpers ──────────────────────────────────────────────────────────

interface DeviceInfo {
  platform?: string;
  version?: string;
  model?: string;
}

async function createSession(userId: string, deviceInfo?: DeviceInfo, ipAddress?: string): Promise<string> {
  const refreshToken = signRefreshToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await prisma.session.create({
    data: { userId, refreshToken, deviceInfo: (deviceInfo ?? {}) as Prisma.InputJsonValue, ipAddress, expiresAt },
  });

  return refreshToken;
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

export async function sendOtp(phone: string): Promise<{ message: string; expiresIn: number; otp?: string }> {
  const normalizedPhone = sanitizePhone(phone);
  const otp = generateOtp(6);
  const ttl = env.OTP_EXPIRY_MINUTES * 60;

  let user = await userRepository.findByPhone(normalizedPhone);
  if (!user) {
    user = await userRepository.create({ phone: normalizedPhone, name: 'Unregistered' });
  }

  await prisma.otpCode.updateMany({
    where: { phone: normalizedPhone, used: false },
    data: { used: true },
  });
  await prisma.otpCode.create({
    data: { userId: user.id, phone: normalizedPhone, code: otp, expiresAt: new Date(Date.now() + ttl * 1000) },
  });
  await redis.set(`${OTP_PREFIX}${normalizedPhone}`, otp, ttl);

  if (env.SMS_PROVIDER === 'console') {
    logger.info(`[DEV OTP] Phone: ${normalizedPhone} → OTP: ${otp}`);
  }

  return {
    message: 'OTP sent successfully',
    expiresIn: ttl,
    ...(env.USE_DUMMY_DATA && { otp }),
  };
}

export async function verifyOtp(
  phone: string,
  otp: string
): Promise<{ verified: true; verificationToken: string; isNewUser: boolean }> {
  const normalizedPhone = sanitizePhone(phone);
  console.log('[OTPVerify] normalizedPhone:', normalizedPhone);

  const cachedOtp = await redis.get(`${OTP_PREFIX}${normalizedPhone}`);
  const otpValid = cachedOtp === otp;

  if (!otpValid) {
    const dbOtp = await prisma.otpCode.findFirst({
      where: { phone: normalizedPhone, code: otp, used: false, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!dbOtp) throw new BadRequestError('Invalid or expired OTP');
    await prisma.otpCode.update({ where: { id: dbOtp.id }, data: { used: true } });
  } else {
    await redis.del(`${OTP_PREFIX}${normalizedPhone}`);
  }

  console.log('[OTPVerify] otpValid:', true); // reached here means OTP passed

  const user = await userRepository.findByPhone(normalizedPhone);
  const isNewUser = !user || user.name === 'Unregistered';

  // Stateless signed token — no Redis dependency for this step.
  // otpLogin and register both verify this JWT directly; no storage needed.
  const verificationToken = jwt.sign(
    { phone: normalizedPhone, purpose: 'OTP_LOGIN' },
    env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  console.log('[OTPVerify] signedTokenIssued: true');

  // DB fallback: persist phoneVerified so register works (belt-and-suspenders for the register flow)
  if (user) {
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true, phoneVerifiedAt: new Date() },
      });
      console.log('[OTPVerify] dbFallbackMarked: true for userId:', user.id);
    } catch (dbErr) {
      console.log('[OTPVerify] dbFallbackMarked: failed —', (dbErr as Error).message);
    }
  } else {
    console.log('[OTPVerify] dbFallbackMarked: skipped — new user (OtpCode fallback covers register)');
  }

  return { verified: true, verificationToken, isNewUser };
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(
  data: {
    name: string;
    phone: string;
    password: string;
    verificationToken?: string;
    email?: string;
    gender?: string;
    bloodGroup?: string;
    role?: string;
    location?: { latitude: number; longitude: number; address: string; city: string; state: string; pincode: string };
    emergencyContact?: { name: string; phone: string; relation: string };
  },
  deviceInfo?: DeviceInfo,
  ipAddress?: string
) {
  const phone = sanitizePhone(data.phone);

  console.log('[RegisterVerify] normalizedPhone:', phone);
  console.log('[RegisterVerify] tokenReceived:', !!data.verificationToken);

  if (data.verificationToken) {
    const storedToken = await redis.get(`${VERIFICATION_TOKEN_PREFIX}${phone}`);
    const redisTokenFound = storedToken !== null;
    const redisValid = storedToken === data.verificationToken;
    console.log('[RegisterVerify] redisTokenFound:', redisTokenFound, '| redisValid:', redisValid);

    let verified = redisValid;

    if (!verified) {
      // DB Fallback 1: phoneVerified flag set by verifyOtp — use explicit select to avoid stale type issues
      const verifiedRow = await prisma.user.findFirst({
        where: { phone, isDeleted: false },
        select: { id: true, phoneVerified: true, phoneVerifiedAt: true },
      });
      const dbFlagValid =
        verifiedRow?.phoneVerified === true &&
        verifiedRow.phoneVerifiedAt instanceof Date &&
        Date.now() - verifiedRow.phoneVerifiedAt.getTime() < VERIFICATION_TOKEN_TTL * 1000;

      // DB Fallback 2: recently-used OtpCode (verifyOtp marks it used=true; valid within original OTP TTL)
      const recentUsedOtp = await prisma.otpCode.findFirst({
        where: { phone, used: true, expiresAt: { gte: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      const otpFallbackValid = recentUsedOtp !== null;

      verified = dbFlagValid || otpFallbackValid;
      console.log('[RegisterVerify] dbFallbackValid:', verified, '| dbFlag:', dbFlagValid, '| otpFallback:', otpFallbackValid);
    }

    console.log('[RegisterVerify] finalVerified:', verified);

    if (!verified) {
      throw new BadRequestError('Phone number not verified. Please verify OTP first.');
    }
  }

  const existing = await userRepository.findByPhone(phone);
  if (existing && existing.name !== 'Unregistered' && existing.passwordHash) {
    throw new ConflictError('An account with this phone number already exists');
  }

  if (data.email) {
    const emailExists = await userRepository.findByEmail(data.email);
    if (emailExists && emailExists.phone !== phone) {
      throw new ConflictError('Email already registered');
    }
  }

  if (!data.password || data.password.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  let user;
  if (existing) {
    user = await userRepository.update(existing.id, {
      name: data.name,
      email: data.email,
      passwordHash,
      gender: data.gender,
      bloodGroup: data.bloodGroup,
      isDonor: !!data.bloodGroup,
      ...(data.role && { role: data.role as any }),
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
      address: data.location?.address,
      city: data.location?.city,
      state: data.location?.state,
      pincode: data.location?.pincode,
      emergencyContactName: data.emergencyContact?.name,
      emergencyContactPhone: data.emergencyContact?.phone,
      emergencyContactRelation: data.emergencyContact?.relation,
    });
  } else {
    user = await userRepository.create({
      phone,
      email: data.email,
      passwordHash,
      name: data.name,
      gender: data.gender,
      bloodGroup: data.bloodGroup,
      isDonor: !!data.bloodGroup,
      ...(data.role && { role: data.role as any }),
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
      address: data.location?.address,
      city: data.location?.city,
      state: data.location?.state,
      pincode: data.location?.pincode,
      emergencyContactName: data.emergencyContact?.name,
      emergencyContactPhone: data.emergencyContact?.phone,
      emergencyContactRelation: data.emergencyContact?.relation,
    });
  }

  await redis.del(`${VERIFICATION_TOKEN_PREFIX}${phone}`);

  console.log('[AuthRole] register stored role:', user.role, '(requested:', data.role ?? 'USER', ')');
  const refreshToken = await createSession(user.id, deviceInfo, ipAddress);
  const token = signToken({ userId: user.id, phone: user.phone, role: user.role, tokenVersion: 0 });
  return { token, refreshToken, user: mapUserToApi(user as any) };
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(
  phone: string,
  password: string,
  deviceInfo?: DeviceInfo,
  ipAddress?: string
) {
  const normalizedPhone = sanitizePhone(phone);
  const user = await userRepository.findByPhone(normalizedPhone);

  if (!user || user.name === 'Unregistered') {
    throw new NotFoundError('No account found with this phone number. Please register first.');
  }

  if (!user.passwordHash) {
    throw new UnauthorizedError('This account uses OTP login. Please use OTP to sign in.');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new UnauthorizedError('Invalid phone number or password');

  await userRepository.update(user.id, { lastLoginAt: new Date(), lastActiveAt: new Date() });

  console.log('[AuthRole] login stored role:', user.role);
  const refreshToken = await createSession(user.id, deviceInfo, ipAddress);
  const fullUser = await userRepository.findById(user.id);
  const token = signToken({
    userId: user.id,
    phone: user.phone,
    role: user.role,
    tokenVersion: (user as any).tokenVersion ?? 0,
  });
  return { token, refreshToken, user: mapUserToApi(fullUser as any) };
}

// ─── Firebase Login ───────────────────────────────────────────────────────────

export async function firebaseLogin(
  firebaseToken: string,
  deviceInfo?: DeviceInfo,
  ipAddress?: string
) {
  const decoded = await verifyFirebaseToken(firebaseToken);

  const phone = decoded.phone_number ? sanitizePhone(decoded.phone_number) : null;

  // Try to find user by firebaseUid first, then by phone
  let user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });

  if (!user && phone) {
    const byPhone = await userRepository.findByPhone(phone);
    if (byPhone && byPhone.name !== 'Unregistered') {
      user = await prisma.user.update({
        where: { id: byPhone.id },
        data: { firebaseUid: decoded.uid },
      });
    }
  }

  if (!user) {
    // New user via Firebase
    user = await prisma.user.create({
      data: {
        phone: phone ?? `firebase_${decoded.uid}`,
        email: decoded.email,
        name: decoded.name ?? 'User',
        firebaseUid: decoded.uid,
        emailVerified: !!decoded.email,
      },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastActiveAt: new Date() },
  });

  const refreshToken = await createSession(user.id, deviceInfo, ipAddress);
  const fullUser = await userRepository.findById(user.id);
  const token = signToken({
    userId: user.id,
    phone: user.phone,
    role: user.role,
    tokenVersion: (user as any).tokenVersion ?? 0,
  });
  return { token, refreshToken, user: mapUserToApi(fullUser as any) };
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

export async function refreshAccessToken(
  refreshToken: string,
  deviceInfo?: DeviceInfo,
  ipAddress?: string
) {
  const session = await prisma.session.findUnique({ where: { refreshToken } });

  if (!session || !session.isActive || session.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token. Please log in again.');
  }

  const user = await userRepository.findById(session.userId);
  if (!user || !user.isActive || user.isDeleted) {
    throw new UnauthorizedError('Account not found or deactivated');
  }

  // Rotate: revoke old session, create new one
  await prisma.session.update({ where: { id: session.id }, data: { isActive: false } });
  const newRefreshToken = await createSession(user.id, deviceInfo ?? (session.deviceInfo as DeviceInfo), ipAddress);

  const token = signToken({
    userId: user.id,
    phone: user.phone,
    role: user.role,
    tokenVersion: (user as any).tokenVersion ?? 0,
  });
  return { token, refreshToken: newRefreshToken };
}

// ─── Email verification ───────────────────────────────────────────────────────

export async function sendEmailVerification(userId: string): Promise<void> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  if (!user.email) throw new BadRequestError('No email address on file');
  if ((user as any).emailVerified) throw new BadRequestError('Email already verified');

  const token = uuidv4();
  await redis.set(`${EMAIL_VERIFY_PREFIX}${userId}`, token, EMAIL_VERIFY_TTL);

  const { sendEmailVerification: sendVerifyEmail } = await import('./email.service');
  await sendVerifyEmail(user.email, token);
}

export async function confirmEmailVerification(token: string, userId: string): Promise<void> {
  const stored = await redis.get(`${EMAIL_VERIFY_PREFIX}${userId}`);
  if (!stored || stored !== token) {
    throw new BadRequestError('Invalid or expired verification link');
  }
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  await redis.del(`${EMAIL_VERIFY_PREFIX}${userId}`);
}

export async function checkEmailAvailability(email: string): Promise<{ available: boolean }> {
  const existing = await userRepository.findByEmail(email);
  return { available: !existing };
}

// ─── Forgot / Reset Password ──────────────────────────────────────────────────

export async function forgotPassword(phone: string): Promise<{ message: string; expiresIn: number; otp?: string }> {
  const normalizedPhone = sanitizePhone(phone);
  const user = await userRepository.findByPhone(normalizedPhone);

  if (!user || user.name === 'Unregistered') {
    throw new NotFoundError('No account found with this phone number');
  }

  return sendOtp(normalizedPhone);
}

export async function resetPassword(phone: string, otp: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }

  const normalizedPhone = sanitizePhone(phone);

  const cachedOtp = await redis.get(`${OTP_PREFIX}${normalizedPhone}`);
  const otpValid = cachedOtp === otp;

  if (!otpValid) {
    const dbOtp = await prisma.otpCode.findFirst({
      where: { phone: normalizedPhone, code: otp, used: false, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!dbOtp) throw new BadRequestError('Invalid or expired OTP');
    await prisma.otpCode.update({ where: { id: dbOtp.id }, data: { used: true } });
  } else {
    await redis.del(`${OTP_PREFIX}${normalizedPhone}`);
  }

  const user = await userRepository.findByPhone(normalizedPhone);
  if (!user) throw new NotFoundError('User not found');

  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Increment tokenVersion to invalidate all existing JWTs
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });

  // Revoke all active sessions
  await prisma.session.updateMany({ where: { userId: user.id }, data: { isActive: false } });
}

// ─── Logout ───────────────────────────────────────────────────────────────────

// ─── OTP Login (passwordless) ─────────────────────────────────────────────────

export async function otpLogin(
  phone: string,
  verificationToken: string,
  deviceInfo?: DeviceInfo,
  ipAddress?: string
) {
  const normalizedPhone = sanitizePhone(phone);
  console.log('[OTPLogin] normalizedPhone:', normalizedPhone);
  console.log('[OTPLogin] verificationTokenReceived:', !!verificationToken);

  // Verify the signed JWT issued by verifyOtp — no Redis dependency
  let payload: { phone: string; purpose: string };
  try {
    payload = jwt.verify(verificationToken, env.JWT_SECRET) as { phone: string; purpose: string };
  } catch {
    console.log('[OTPLogin] tokenValid: false (JWT verify failed — expired or tampered)');
    console.log('[OTPLogin] loginAllowed: false');
    throw new UnauthorizedError('Invalid or expired verification token. Please verify OTP first.');
  }

  const tokenPhoneMatches = payload.phone === normalizedPhone;
  const tokenPurposeValid = payload.purpose === 'OTP_LOGIN';
  console.log('[OTPLogin] tokenValid: true');
  console.log('[OTPLogin] tokenPhoneMatches:', tokenPhoneMatches);

  if (!tokenPhoneMatches || !tokenPurposeValid) {
    console.log('[OTPLogin] loginAllowed: false (phone mismatch or wrong purpose)');
    throw new UnauthorizedError('Invalid or expired verification token. Please verify OTP first.');
  }
  console.log('[OTPLogin] loginAllowed: true');

  const user = await userRepository.findByPhone(normalizedPhone);
  if (!user || user.name === 'Unregistered') {
    throw new NotFoundError('No account found with this phone number. Please register first.');
  }

  // JWT is stateless — nothing to delete from Redis
  await userRepository.update(user.id, { lastLoginAt: new Date(), lastActiveAt: new Date() });

  const refreshToken = await createSession(user.id, deviceInfo, ipAddress);
  const fullUser = await userRepository.findById(user.id);
  const token = signToken({
    userId: user.id,
    phone: user.phone,
    role: user.role,
    tokenVersion: (user as any).tokenVersion ?? 0,
  });
  return { token, refreshToken, user: mapUserToApi(fullUser as any) };
}

// ─── Check Phone ──────────────────────────────────────────────────────────────

export async function checkPhone(phone: string): Promise<{ exists: boolean }> {
  const normalizedPhone = sanitizePhone(phone);
  const user = await userRepository.findByPhone(normalizedPhone);
  const exists = !!(user && user.name !== 'Unregistered' && user.passwordHash);
  return { exists };
}

export async function logout(token: string, refreshToken?: string): Promise<void> {
  try {
    const payload = jwt.decode(token) as JwtPayload | null;
    if (payload?.exp) {
      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.set(`${TOKEN_BLACKLIST_PREFIX}${token}`, '1', ttl);
      }
    }
  } catch {
    /* ignore */
  }

  if (refreshToken) {
    await prisma.session.updateMany({
      where: { refreshToken },
      data: { isActive: false },
    });
  }
}

// ─── Firebase Phone OTP Auth (Phase 5E) ──────────────────────────────────────

async function resolveFirebasePhone(firebaseIdToken: string): Promise<string> {
  let decoded;
  try {
    decoded = await verifyFirebaseToken(firebaseIdToken);
  } catch (err: any) {
    const msg: string = err?.message ?? '';
    if (msg.includes('not configured')) {
      const e: any = new Error('Firebase OTP is not available on this server');
      e.statusCode = 503;
      throw e;
    }
    throw new UnauthorizedError('Invalid or expired Firebase ID token');
  }
  const phone = decoded.phone_number ? sanitizePhone(decoded.phone_number) : null;
  if (!phone) throw new BadRequestError('Firebase token does not contain a verified phone number');
  console.log(`[OTP] firebase token verified phone: ${phone}`);
  return phone;
}

// POST /auth/firebase-login — verify Firebase token, login existing user (404 if not found)
export async function firebasePhoneLogin(
  firebaseIdToken: string,
  deviceInfo?: DeviceInfo,
  ipAddress?: string
) {
  const phone = await resolveFirebasePhone(firebaseIdToken);
  const user = await userRepository.findByPhone(phone);
  if (!user || user.name === 'Unregistered') {
    throw new NotFoundError('No account found for this phone number. Please register first.');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), lastActiveAt: new Date(), phoneVerified: true, phoneVerifiedAt: new Date() },
  });
  const refreshToken = await createSession(user.id, deviceInfo, ipAddress);
  const fullUser = await userRepository.findById(user.id);
  const token = signToken({ userId: user.id, phone: user.phone, role: user.role, tokenVersion: (user as any).tokenVersion ?? 0 });
  console.log(`[OTP] firebase-login success userId: ${user.id}`);
  return { token, refreshToken, user: mapUserToApi(fullUser as any) };
}

// POST /auth/firebase-register-verify — verify Firebase token for registration
export async function firebaseRegisterVerify(
  firebaseIdToken: string
): Promise<{ verified: true; phone: string; verificationToken: string; isNewUser: boolean }> {
  const phone = await resolveFirebasePhone(firebaseIdToken);
  const user = await userRepository.findByPhone(phone);
  const isNewUser = !user || user.name === 'Unregistered';
  if (user && !isNewUser) {
    await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerified: true, phoneVerifiedAt: new Date() },
    });
    console.log(`[OTP] register phone verified userId: ${user.id}`);
  }
  const verificationToken = uuidv4();
  await redis.set(`${VERIFICATION_TOKEN_PREFIX}${phone}`, verificationToken, VERIFICATION_TOKEN_TTL);
  return { verified: true, phone, verificationToken, isNewUser };
}

// POST /auth/forgot-password/firebase-verify — verify Firebase token, issue secure reset token
export async function forgotPasswordFirebaseVerify(
  firebaseIdToken: string
): Promise<{ resetToken: string }> {
  const phone = await resolveFirebasePhone(firebaseIdToken);
  const user = await userRepository.findByPhone(phone);
  if (!user || user.name === 'Unregistered') {
    throw new NotFoundError('No account found for this phone number.');
  }
  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash: resetTokenHash, passwordResetExpiresAt: expiresAt },
  });
  console.log(`[OTP] password reset token issued userId: ${user.id}`);
  return { resetToken };
}

// POST /auth/reset-password (token branch) — validate reset token, set new password
export async function resetPasswordWithToken(resetToken: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }
  const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const user = await prisma.user.findFirst({
    where: { passwordResetTokenHash: resetTokenHash, passwordResetExpiresAt: { gte: new Date() } },
  });
  if (!user) throw new BadRequestError('Invalid or expired reset token');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });
  await prisma.session.updateMany({ where: { userId: user.id }, data: { isActive: false } });
  console.log(`[OTP] password reset success userId: ${user.id}`);
}
