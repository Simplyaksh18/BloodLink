import { create } from 'zustand';
import { User, AuthState } from '../types';
import { tokenStorage, userStorage, refreshTokenStorage } from '../services/apiClient';
import { authService } from '../services/authService';

interface AuthStore extends AuthState {
  setUser: (user: User) => void;
  setToken: (token: string, refreshToken?: string) => void;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  updateUser: (partial: Partial<User>) => void;
  setHasRegisteredAsDonor: (val: boolean) => void;
  setLastProfileUpdate: (val: number) => void;
  notifications: any[];
  addNotification: (notification: any) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  hasRegisteredAsDonor: false,
  lastProfileUpdate: null,
  notifications: [],

  addNotification: (notification) => set((state) => ({
    notifications: [notification, ...state.notifications],
  })),

  setUser: (user) => set({ user, isAuthenticated: true }),

  setToken: (token, refreshToken) => {
    tokenStorage.set(token);
    if (refreshToken) refreshTokenStorage.set(refreshToken);
    set({ token });
  },

  logout: async () => {
    await authService.logout();
    set({ user: null, token: null, isAuthenticated: false });
  },

  loadStoredAuth: async () => {
    try {
      const token = await tokenStorage.get();
      if (token) {
        set({ token, isLoading: true });
        const res = await authService.getProfile();
        if (res.success && res.data) {
          set({ user: res.data, isAuthenticated: true, token });
        } else {
          await tokenStorage.remove();
          await refreshTokenStorage.remove();
          set({ user: null, token: null, isAuthenticated: false });
        }
      }
    } catch {
      await tokenStorage.remove();
      await refreshTokenStorage.remove();
      set({ user: null, token: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  updateUser: (partial) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...partial } : null,
    })),

  setHasRegisteredAsDonor: (val) => set({ hasRegisteredAsDonor: val }),

  setLastProfileUpdate: (val) => set({ lastProfileUpdate: val }),
}));
