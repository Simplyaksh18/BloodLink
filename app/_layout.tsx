import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import 'react-native-reanimated';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

import {
  Poppins_300Light,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import * as Notifications from 'expo-notifications';

const queryClient = new QueryClient();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

import { useAuthStore } from '../store/authStore';
import { useRouter, useSegments } from 'expo-router';
import { connectSocket, disconnectSocket } from '../services/socketService';
import { registerPushToken, unregisterPushToken } from '../services/pushService';
import { ThemeProvider as AppThemeProvider, useTheme } from '../context/ThemeContext';

// Stores a pending notification route across the auth-loading gap so it
// isn't overwritten by the auth redirect before we can navigate.
const pendingNotifRoute = { current: null as string | null };

export default function RootLayout() {
  const [loaded] = useFonts({
    Poppins_300Light,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const { isAuthenticated, isLoading, loadStoredAuth, token } = useAuthStore();
  const user = useAuthStore(state => state.user);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    loadStoredAuth();
  }, []);

  useEffect(() => {
    if (loaded && !isLoading) {
      SplashScreen.hideAsync();
    }
  }, [loaded, isLoading]);

  useEffect(() => {
    if (!loaded || isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to the login page.
      router.replace('/(auth)/sign-in');
    } else if (isAuthenticated && inAuthGroup) {
      console.log('[RoleRoute] userRole:', user?.role ?? 'USER');
      if (user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') {
        console.log('[RoleRoute] rendering: ADMIN');
        router.replace('/(admin)/dashboard');
      } else if (user?.role === 'BLOOD_BANK') {
        console.log('[RoleRoute] rendering: BLOOD_BANK');
        router.replace('/(tabs)/blood-bank-dashboard');
      } else {
        console.log('[RoleRoute] rendering: DONOR_RECIPIENT');
        router.replace('/(tabs)');
      }
    }
  }, [isAuthenticated, segments, loaded, isLoading]);

  // Connect socket on login, disconnect on logout.
  // Register push token on login (best-effort, never blocks).
  useEffect(() => {
    if (isAuthenticated && token) {
      connectSocket(token);
      registerPushToken(); // fire-and-forget
    } else {
      unregisterPushToken(); // fire-and-forget
      disconnectSocket();
    }
  }, [isAuthenticated, token]);

  // Notification tap-to-open: stores the target route, then navigates once auth has settled.
  // Navigating immediately on cold start would be overwritten by the auth guard redirect,
  // so we buffer in a module-level ref and flush it in the effect below.
  useEffect(() => {
    console.log('[NotificationTap] listener registered — isLoading:', isLoading, '| isAuthenticated:', isAuthenticated);
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = (response.notification.request.content.data ?? {}) as {
        type?: string;
        requestId?: string;
        bloodBankId?: string;
        conversationId?: string;
      };
      console.log('[NotificationTap] raw notification:', JSON.stringify(response.notification.request.content));
      console.log('[NotificationTap] type:', data.type ?? '(none)');
      console.log('[NotificationTap] data:', JSON.stringify(data));
      console.log('[NotificationTap] bankId:', data.bloodBankId ?? '(none)');
      console.log('[NotificationTap] requestId:', data.requestId ?? '(none)');

      let route: string;
      if (data.type?.startsWith('BLOOD_BANK')) {
        route = data.bloodBankId
          ? `/blood-bank/bank-manage?bankId=${data.bloodBankId}`
          : '/blood-bank/my-bank';
      } else if (data.type === 'NEW_MESSAGE' || data.conversationId) {
        route = '/(tabs)/inbox';
      } else if (
        data.type === 'DONOR_ACCEPTED' ||
        data.type === 'DONATION_PROOF_SUBMITTED' ||
        data.type === 'REQUEST_FULFILLED' ||
        data.type === 'REQUEST_CANCELLED' ||
        data.type === 'REQUEST_EXPIRED' ||
        data.type === 'REQUEST_MATCHED' ||
        data.requestId
      ) {
        route = '/(tabs)/request';
      } else {
        route = '/(modals)/notifications';
      }
      console.log('[NotificationTap] resolved route:', route);

      if (!isLoading && isAuthenticated) {
        console.log('[NotificationTap] navigating:', route);
        try {
          router.push(route as any);
          console.log('[NotificationTap] navigation success:', route);
        } catch (err: any) {
          console.log('[NotificationTap] navigation failed:', err?.message ?? err);
        }
      } else {
        console.log('[NotificationTap] buffering route until auth settles:', route);
        pendingNotifRoute.current = route;
      }
    });
    return () => sub.remove();
  }, [isLoading, isAuthenticated]);

  // Flush buffered notification route once auth finishes loading.
  useEffect(() => {
    if (!isLoading && isAuthenticated && pendingNotifRoute.current) {
      const route = pendingNotifRoute.current;
      pendingNotifRoute.current = null;
      console.log('[NotificationTap] flushing buffered route:', route);
      router.push(route as any);
    }
  }, [isLoading, isAuthenticated]);

  if (!loaded) {
    return null;
  }

  return (
    <AppThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppNavigator />
      </QueryClientProvider>
    </AppThemeProvider>
  );
}

// Separate component so it can read from AppThemeProvider via useTheme()
function AppNavigator() {
  const { isDark } = useTheme();
  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(admin)" />
        <Stack.Screen name="+not-found" options={{ headerShown: true, title: 'Oops!' }} />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
