import auth from '@react-native-firebase/auth';

// Module-level confirmation — holds the in-progress Firebase phone auth session.
// Cleared after successful verification or when a new sendFirebaseOtp call replaces it.
type PhoneConfirmation = Awaited<ReturnType<ReturnType<typeof auth>['signInWithPhoneNumber']>>;
let _pendingConfirmation: PhoneConfirmation | null = null;

export function getFirebaseOtpErrorMessage(err: any): string {
  const code: string = err?.code ?? '';
  if (code === 'auth/invalid-phone-number') return 'Invalid phone number format.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  if (code === 'auth/invalid-verification-code') return 'Incorrect verification code. Please try again.';
  if (code === 'auth/session-expired' || code === 'auth/code-expired') return 'Code expired. Please request a new one.';
  if (code === 'auth/quota-exceeded') return 'SMS quota exceeded. Please try again later.';
  return err?.message ?? 'An error occurred. Please try again.';
}

export async function sendFirebaseOtp(phoneNumber: string): Promise<void> {
  console.log('[OTP] sending code');
  _pendingConfirmation = await auth().signInWithPhoneNumber(phoneNumber);
  console.log('[OTP] code sent');
}

export async function verifyFirebaseOtp(code: string): Promise<string> {
  if (!_pendingConfirmation) {
    throw new Error('No pending verification. Please request a code first.');
  }
  const result = await _pendingConfirmation.confirm(code);
  if (!result?.user) throw new Error('OTP verification failed.');
  const idToken = await result.user.getIdToken();
  console.log('[OTP] verification success');
  _pendingConfirmation = null;
  return idToken;
}
