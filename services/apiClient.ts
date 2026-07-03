import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from "axios";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

// URL resolution order:
//   1. EXPO_PUBLIC_API_URL   — set by EAS profile (preview/production) at build time.
//   2. expoConfig.extra.apiBaseUrl — set by app.json (also fed by EXPO_PUBLIC_API_URL).
//   3. Legacy dev fallback   — used only for local dev when neither is set.
//                              Logged loudly so it can't leak silently.
const DEV_FALLBACK_URL = "https://whacky-wriggly-brunch.ngrok-free.dev/v1";
const ENV_URL = process.env.EXPO_PUBLIC_API_URL;
const EXTRA_URL = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
const API_BASE_URL = ENV_URL ?? EXTRA_URL ?? DEV_FALLBACK_URL;

const BUILD_PROFILE =
  (Constants.expoConfig?.extra?.eas as any)?.buildProfile ??
  (process.env.EAS_BUILD_PROFILE as string | undefined) ??
  (__DEV__ ? 'development' : 'production');

console.log('[Config] API_URL:', API_BASE_URL);
console.log('[Config] buildProfile:', BUILD_PROFILE);
console.log('[Config] environment:', __DEV__ ? 'development' : 'production');

if (!__DEV__ && API_BASE_URL === DEV_FALLBACK_URL) {
  console.error('[Config] WARNING: production build fell back to dev URL. Set EXPO_PUBLIC_API_URL in eas.json.');
}

const TOKEN_KEY = "bloodlink_auth_token";
const REFRESH_TOKEN_KEY = "bloodlink_refresh_token";

// ─── Token Helpers ────────────────────────────────────────────────────────────

export const tokenStorage = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  async remove(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};

export const refreshTokenStorage = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },
  async remove(): Promise<void> {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};

const USER_KEY = "bloodlink_auth_user";

export const userStorage = {
  async get(): Promise<any | null> {
    try {
      const userStr = await SecureStore.getItemAsync(USER_KEY);
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  },
  async set(user: any): Promise<void> {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },
  async remove(): Promise<void> {
    await SecureStore.deleteItemAsync(USER_KEY);
  },
};

// ─── Axios Client ─────────────────────────────────────────────────────────────

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Request interceptor — attach JWT token
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await tokenStorage.get();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Track whether we are currently refreshing to avoid infinite loops
let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

function processPending(token: string) {
  pendingRequests.forEach((cb) => cb(token));
  pendingRequests = [];
}

// Response interceptor — attempt token refresh on 401 before giving up
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (isRefreshing) {
        // Queue this request until the refresh completes
        return new Promise((resolve) => {
          pendingRequests.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const storedRefreshToken = await refreshTokenStorage.get();
        if (!storedRefreshToken) throw new Error("No refresh token");

        // Use a plain axios instance to avoid interceptor loops
        const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken: storedRefreshToken,
        });

        const { token: newToken, refreshToken: newRefreshToken } = res.data.data;
        await tokenStorage.set(newToken);
        await refreshTokenStorage.set(newRefreshToken);

        processPending(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch {
        // Refresh failed — clear all stored credentials
        await tokenStorage.remove();
        await refreshTokenStorage.remove();
        await userStorage.remove();
        pendingRequests = [];
        // Navigation to login handled by authStore's loadStoredAuth
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
