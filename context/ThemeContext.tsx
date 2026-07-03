import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Colors } from '../constants/Colors';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: typeof Colors.light;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  colors: Colors.light,
  isDark: false,
  toggleTheme: () => {},
});

const STORE_KEY = 'app_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY).then(val => {
      if (val === 'dark') setMode('dark');
    }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(prev => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      console.log('[Theme] changed:', next);
      SecureStore.setItemAsync(STORE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{
      mode,
      colors: Colors[mode],
      isDark: mode === 'dark',
      toggleTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
