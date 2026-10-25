import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { buildTheme } from './theme';
import { useAuth } from '../features/auth/AuthContext';
import { api } from '../services/api';

interface ColorModeCtx {
  mode: 'light' | 'dark';
  toggle: () => void;
}

const Ctx = createContext<ColorModeCtx>({ mode: 'light', toggle: () => undefined });

/** Theme follows the saved setting (LIGHT/DARK/SYSTEM); toggling persists to /api/settings. */
export function ColorModeProvider({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const { settings, refresh } = useAuth();
  const [override, setOverride] = useState<'light' | 'dark' | null>(null);

  const saved = settings?.theme ?? 'SYSTEM';
  const mode: 'light' | 'dark' = override ?? (saved === 'SYSTEM' ? (prefersDark ? 'dark' : 'light') : saved === 'DARK' ? 'dark' : 'light');

  const value = useMemo<ColorModeCtx>(
    () => ({
      mode,
      toggle: () => {
        const next = mode === 'dark' ? 'light' : 'dark';
        setOverride(next);
        if (settings) {
          void api
            .patch('/settings', { theme: next === 'dark' ? 'DARK' : 'LIGHT' })
            .then(refresh)
            .then(() => setOverride(null))
            .catch(() => undefined);
        }
      },
    }),
    [mode, settings, refresh],
  );

  const theme = useMemo(() => buildTheme(mode), [mode]);
  return (
    <Ctx.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </Ctx.Provider>
  );
}

export const useColorMode = () => useContext(Ctx);
