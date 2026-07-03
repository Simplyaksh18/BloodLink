import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import apiClient from './apiClient';

// Controls how notifications are displayed when the app is in the foreground.
// Called once at module load — safe to run before any UI mounts.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Android 8+ (API 26+) requires an explicit notification channel before any
// push can display. Safe to call multiple times — Expo deduplicates by channel ID.
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('bloodlink_alerts', {
      name: 'Blood Requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E53935',
      sound: 'default',
    });
    console.log('[Push] Android notification channel ensured: bloodlink_alerts');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[Push] Android channel setup failed (non-fatal):', msg);
  }
}

// Request permission, retrieve Expo push token, and register it with the backend.
// All failures are caught and logged — this must NEVER block login or app startup.
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) {
      console.log('[Push] unavailable in simulator - physical device required for push tokens');
      return;
    }

    // Android 8+ requires channel before permissions request
    await ensureAndroidChannel();

    // Check / request permission
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] permission denied');
      return;
    }

    console.log('[Push] permission granted');

    // Read EAS projectId from app config (set by `eas init` in app.json extra.eas.projectId).
    // Required for getExpoPushTokenAsync to reach the Expo push service on local builds.
    const projectId = (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? undefined;
    if (!projectId) {
      console.log('[Push] EAS projectId not found in app config - run: eas init to link this project');
    }

    // Get Expo push token (ExponentPushToken[...]).
    // Wraps native FCM initialization — if google-services.json is missing or Firebase
    // fails to init, this throws. We catch and log rather than blocking app startup.
    let token: string;
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : {}
      );
      token = tokenData.data;
      console.log('[Push] Expo push token obtained');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('FirebaseApp') ||
        msg.includes('Firebase') ||
        msg.includes('google-services') ||
        msg.includes('FCM')
      ) {
        // Native Firebase (FCM) was not initialised — google-services.json may be missing,
        // or the prebuild step was skipped.
        // For local Android: run  npx expo prebuild --clean --platform android
        //                    then npx expo run:android
        console.log('[Push] native FCM unavailable, using Expo token fallback');
        console.log('[Push] fix: ensure google-services.json is present and run npx expo prebuild --clean --platform android');
      } else {
        console.log('[Push] token retrieval failed (non-fatal):', msg);
      }
      return;
    }

    // Always send ExponentPushToken as platform EXPO — the backend normalises this too.
    await apiClient.post('/notifications/device-token', {
      token,
      platform: 'EXPO',
    });
    console.log('[Push] registered Expo token with backend');
  } catch (err) {
    // Swallow all errors — this is a best-effort background operation
    const msg = err instanceof Error ? err.message : String(err);
    console.log('[Push] token registration failed (non-fatal):', msg);
  }
}

// Deactivate the current device's push token on logout.
// Silently ignores failures.
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const projectId = (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ?? undefined;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : {}
    ).catch(() => null);
    if (!tokenData) return;

    await apiClient.delete('/notifications/device-token', {
      data: { token: tokenData.data },
    });
    console.log('[Push] device token deactivated');
  } catch {
    // non-fatal
  }
}
