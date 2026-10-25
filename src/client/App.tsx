import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './features/auth/AuthContext';
import { ColorModeProvider } from './theme/ColorMode';
import { FeedbackProvider } from './components/common/Feedback';
import { Box, Button } from '@mui/material';
import { EmptyState, LoadingState } from './components/common/States';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import { Layout, trackPageLoad } from './components/Layout';
import { AlarmProvider } from './features/alarms/AlarmProvider';

/** Lazy page whose chunk download is reported to the app shell (thin top progress bar), with a `preload()` for prefetching. */
function page(load: () => Promise<{ default: ComponentType }>) {
  return Object.assign(
    lazy(() => trackPageLoad(load())),
    { preload: load },
  );
}

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SetupPage = lazy(() => import('./pages/SetupPage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const DashboardPage = page(() => import('./pages/DashboardPage'));
const DiaryPage = page(() => import('./pages/DiaryPage'));
const MealPlanPage = page(() => import('./pages/MealPlanPage'));
const FoodsPage = page(() => import('./pages/FoodsPage'));
const WaterPage = page(() => import('./pages/WaterPage'));
const WorkoutsPage = page(() => import('./pages/WorkoutsPage'));
const WorkoutSessionPage = page(() => import('./pages/WorkoutSessionPage'));
const RoutinePage = page(() => import('./pages/RoutinePage'));
const AlarmsPage = page(() => import('./pages/AlarmsPage'));
const HistoryPage = page(() => import('./pages/HistoryPage'));
const ReportsPage = page(() => import('./pages/ReportsPage'));
const MeasurementsPage = page(() => import('./pages/MeasurementsPage'));
const SettingsPage = page(() => import('./pages/SettingsPage'));

/** Bottom-nav destinations first, then the rest; fetched one by one when the browser is idle. */
const PREFETCH = [DashboardPage, DiaryPage, WorkoutsPage, AlarmsPage, WaterPage, MealPlanPage, RoutinePage, SettingsPage];
const prefetchPages = () => {
  void PREFETCH.reduce<Promise<unknown>>((chain, p) => chain.then(() => p.preload()).catch(() => undefined), Promise.resolve());
};

function ServerUnavailable() {
  const { error, refresh } = useAuth();
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  // Retry automatically as soon as the phone is back online.
  useEffect(() => {
    const retry = () => void refresh();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [refresh]);
  return (
    <Box sx={{ p: 3, maxWidth: 480, mx: 'auto', mt: 10 }}>
      <EmptyState
        icon={<CloudOffRoundedIcon fontSize="inherit" />}
        title={offline ? 'You’re offline' : 'Can’t reach MyFit right now'}
        description={
          offline
            ? 'Your data lives on the server, so MyFit needs a connection. It will reconnect automatically.'
            : `${error ?? 'The server did not respond.'} It will retry when you tap below.`
        }
        action={
          <Button variant="contained" onClick={() => void refresh()} sx={{ minHeight: 48, px: 4 }}>
            Try again
          </Button>
        }
      />
    </Box>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, loading, error } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState minHeight={400} />;
  if (!status) return error ? <ServerUnavailable /> : <LoadingState minHeight={400} />;
  if (status.setupRequired) return <Navigate to="/setup" replace />;
  if (!status.user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { status, loading, error } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <LoadingState minHeight={400} />;
  if (!status) return error ? <ServerUnavailable /> : <LoadingState minHeight={400} />;
  if (status.user) return <Navigate to="/" replace />;
  // First run: send /login (and invite links) to account creation until an owner exists.
  if (status.setupRequired && pathname !== '/setup') return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ColorModeProvider>
          <FeedbackProvider>
            {/* Only the public (login/setup) pages suspend here; signed-in pages load inside the shell. */}
            <Suspense fallback={<LoadingState minHeight={400} />}>
              <Routes>
                <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
                <Route path="/setup" element={<PublicOnly><SetupPage /></PublicOnly>} />
                <Route path="/invite/:token" element={<PublicOnly><AcceptInvitePage /></PublicOnly>} />
                <Route
                  element={
                    <RequireAuth>
                      <AlarmProvider>
                        <Layout prefetch={prefetchPages} />
                      </AlarmProvider>
                    </RequireAuth>
                  }
                >
                  <Route index element={<DashboardPage />} />
                  <Route path="diary" element={<DiaryPage />} />
                  <Route path="meals" element={<MealPlanPage />} />
                  <Route path="foods" element={<FoodsPage />} />
                  <Route path="water" element={<WaterPage />} />
                  <Route path="workouts" element={<WorkoutsPage />} />
                  <Route path="workouts/session/:id" element={<WorkoutSessionPage />} />
                  <Route path="routine" element={<RoutinePage />} />
                  <Route path="alarms" element={<AlarmsPage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="measurements" element={<MeasurementsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </FeedbackProvider>
        </ColorModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
