import { prisma } from '../config/database';
import { sendPushNotification } from '../config/firebase';
import { env } from '../config/env';
import { logger } from '../config/logger';

function isFirebaseEnabled(): boolean {
  return !!(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
}

function isExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken') || token.startsWith('ExpoPushToken');
}

// Send a push notification via the Expo Push Service.
// Used for any token beginning with ExponentPushToken / ExpoPushToken.
// Never throws — all errors are caught and logged.
async function sendViaExpoPush(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> {
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        title,
        body,
        data: data ?? {},
        sound: 'default',
        priority: 'high',
        channelId: 'bloodlink_alerts',
      }),
    });

    const result = (await response.json()) as {
      data?: { status: string; message?: string };
    };

    if (result?.data?.status === 'error') {
      console.log(`[ExpoPush] failed | ${result.data.message ?? 'unknown error'}`);
      return false;
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[ExpoPush] failed | ${msg}`);
    return false;
  }
}

// Send push to all active device tokens for a user.
// Routing:
//   ExponentPushToken / ExpoPushToken → Expo Push Service (no Firebase needed)
//   Everything else                   → Firebase Admin (requires credentials)
// Priority: UserDeviceToken table → User.deviceToken (legacy fallback).
// Never throws — all errors are caught and logged.
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const rows = await prisma.userDeviceToken.findMany({
      where: { userId, isActive: true },
      select: { token: true, platform: true },
    });

    let tokens: { token: string; platform: string }[] = rows.map((r) => ({
      token: r.token,
      platform: r.platform as string,
    }));

    // Fall back to legacy single-token column on User if table has nothing
    if (tokens.length === 0) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { deviceToken: true },
      });
      if (user?.deviceToken) {
        tokens = [{ token: user.deviceToken, platform: 'UNKNOWN' }];
      }
    }

    if (tokens.length === 0) {
      console.log(
        `[FCMPlaceholder] would send push to userId: ${userId}`,
        `| title: "${title}" | no device token on file`
      );
      return;
    }

    // Deduplicate by token value — prevents double-send if a token appears in
    // both UserDeviceToken table and the legacy User.deviceToken fallback
    const seen = new Set<string>();
    const uniqueTokens = tokens.filter((t) => {
      if (seen.has(t.token)) return false;
      seen.add(t.token);
      return true;
    });
    console.log(`[Push] deduped token count: ${uniqueTokens.length} (raw: ${tokens.length}) userId: ${userId}`);

    for (const t of uniqueTokens) {
      if (isExpoToken(t.token)) {
        // Expo Push Service — does not require Firebase credentials
        console.log(`[ExpoPush] sending to userId: ${userId} | title: "${title}"`);
        const sent = await sendViaExpoPush(t.token, title, body, data);
        if (sent) {
          console.log(`[ExpoPush] sent | userId: ${userId}`);
        }
        // sendViaExpoPush already logs on failure
      } else {
        // Raw FCM registration token — requires Firebase Admin SDK
        if (!isFirebaseEnabled()) {
          console.log(
            `[FCMPlaceholder] would send push to userId: ${userId}`,
            `| platform: ${t.platform} | title: "${title}"`
          );
        } else {
          console.log(`[FCM] sending to userId: ${userId} | platform: ${t.platform}`);
          const sent = await sendPushNotification(t.token, title, body, data);
          if (sent) {
            logger.info('[FCM] push sent', { userId, platform: t.platform, title });
          }
        }
      }
    }
  } catch (err) {
    logger.error('[Push] sendPushToUser failed', { userId, err });
  }
}

// Log once at startup so the developer knows push state
if (!isFirebaseEnabled()) {
  console.log('[FCM] disabled - credentials missing (Expo push tokens will still work)');
}
