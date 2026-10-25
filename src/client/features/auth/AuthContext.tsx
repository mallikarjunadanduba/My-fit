import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../../services/api';
import { clearAsyncCache } from '../../hooks/useAsync';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'MEMBER';
}

export interface SessionSettings {
  timezone: string;
  theme: 'LIGHT' | 'DARK' | 'SYSTEM';
  gymWeekdays: number[];
  defaultSnoozeMinutes: number;
  notificationsEnabled: boolean;
}

/** Shape of GET /api/auth/status */
export interface AuthStatus {
  setupRequired: boolean;
  /** Only on first run: whether the server requires SETUP_TOKEN. */
  setupTokenRequired?: boolean;
  user: SessionUser | null;
  settings: SessionSettings | null;
}

interface AuthContextValue {
  status: AuthStatus | null;
  user: SessionUser | null;
  settings: SessionSettings | null;
  /** Timezone to use for all date math in the UI. */
  timezone: string;
  loading: boolean;
  /** Set when /auth/status itself failed (server or database unreachable). */
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.get<AuthStatus>('/auth/status'));
      setError(null);
    } catch (e) {
      // Don't pretend the user is logged out when the server/database is unreachable.
      setError(e instanceof Error ? e.message : 'Unable to reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Never show one account's cached screens to the next person who signs in.
      clearAsyncCache();
      setStatus((s) => (s ? { ...s, user: null, settings: null } : s));
    }
  }, []);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => setStatus((s) => (s?.user ? { ...s, user: null, settings: null } : s)));
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status?.user ?? null,
      settings: status?.settings ?? null,
      timezone: status?.settings?.timezone ?? 'Asia/Kolkata',
      loading,
      error,
      refresh,
      logout,
    }),
    [status, loading, error, refresh, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
