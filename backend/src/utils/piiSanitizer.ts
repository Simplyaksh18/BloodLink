// PII sanitization helpers for safe logging.
// maskPhone("+918765400036") => "+91******0036"
// maskEmail("abc@test.com") => "a***@test.com"
// sanitizeBody strips passwords, tokens, OTPs before any logging.

export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') return '***';
  const cleaned = phone.replace(/\s/g, '');
  const last4 = cleaned.slice(-4);
  if (cleaned.startsWith('+')) {
    const prefix = cleaned.slice(0, 3); // e.g. +91
    return `${prefix}******${last4}`;
  }
  return `******${last4}`;
}

export function maskEmail(email: string): string {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const masked = local.length > 1 ? `${local[0]}***` : '***';
  return `${masked}@${domain}`;
}

const REDACTED_KEYS = new Set([
  'password', 'passwordHash', 'newPassword', 'oldPassword', 'confirmPassword',
  'otp', 'code', 'token', 'resetToken', 'firebaseToken', 'idToken',
  'accessToken', 'refreshToken', 'authorization', 'Authorization',
  'passwordResetTokenHash', 'medicalCertificateUrl', 'idToken',
  'x-firebase-id-token', 'firebase_id_token',
]);

export function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (REDACTED_KEYS.has(k) || REDACTED_KEYS.has(lower)) {
      out[k] = '[REDACTED]';
    } else if (lower === 'phone' && typeof v === 'string') {
      out[k] = maskPhone(v);
    } else if (lower === 'email' && typeof v === 'string') {
      out[k] = maskEmail(v);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeBody(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out = { ...headers };
  if (out['authorization']) out['authorization'] = '[REDACTED]';
  if (out['Authorization']) out['Authorization'] = '[REDACTED]';
  if (out['x-firebase-id-token']) out['x-firebase-id-token'] = '[REDACTED]';
  return out;
}
