import admin from 'firebase-admin';
import { env } from './env';
import { logger } from './logger';

let initialized = false;
let firebaseApp: admin.app.App | null = null;

// Returns the initialized Firebase Admin app, or null if credentials are not configured.
// Never throws — callers must check for null.
export function getFirebaseApp(): admin.app.App | null {
  if (initialized) return firebaseApp;

  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    logger.warn('[Firebase] credentials not configured — push notifications disabled');
    initialized = true;
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    logger.info('[Firebase] Admin initialized');
  } catch (error: any) {
    const msg: string = error?.message ?? '';
    if (error?.code === 'app/duplicate-app' || msg.includes('already exists')) {
      // Initialized elsewhere (e.g., firebase.service.ts) — adopt the default app
      try { firebaseApp = admin.app(); } catch { /* ignore */ }
    } else {
      logger.error('[Firebase] initialization failed', { error });
    }
  }
  initialized = true;

  return firebaseApp;
}

// Keep legacy export name so existing call-sites (notification.service.ts) don't break.
export function getFirebaseAdmin(): admin.app.App {
  const app = getFirebaseApp();
  if (!app) throw new Error('[Firebase] not configured — push notifications disabled');
  return app;
}

export async function sendPushNotification(
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> {
  const app = getFirebaseApp();
  if (!app) {
    logger.debug('[Firebase] sendPushNotification skipped — not configured');
    return false;
  }

  try {
    await app.messaging().send({
      token: deviceToken,
      notification: { title, body },
      data,
      android: { priority: 'high', notification: { channelId: 'bloodlink_alerts' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
    return true;
  } catch (error) {
    logger.error('[Firebase] push notification failed', { error, deviceToken: deviceToken.slice(0, 10) + '...' });
    return false;
  }
}
