import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Avatar,
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useScrollTrigger,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import RestaurantMenuRoundedIcon from '@mui/icons-material/RestaurantMenuRounded';
import EggAltRoundedIcon from '@mui/icons-material/EggAltRounded';
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import AlarmRoundedIcon from '@mui/icons-material/AlarmRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import MonitorWeightRoundedIcon from '@mui/icons-material/MonitorWeightRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import { useAuth } from '../features/auth/AuthContext';
import { useColorMode } from '../theme/ColorMode';
import { brand } from '../theme/theme';
import { useAlarms } from '../features/alarms/AlarmProvider';
import { InstallBanner, IosInstallDialog, PwaNotices, usePwa } from '../pwa/PwaPrompts';
import { isIosDevice, isStandaloneDisplay, promptInstall } from '../pwa/pwa';
import InstallMobileRoundedIcon from '@mui/icons-material/InstallMobileRounded';

interface NavItem {
  to: string;
  label: string;
  /** Short label for the phone "More" grid. */
  short: string;
  icon: ReactNode;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: <DashboardRoundedIcon /> },
  { to: '/diary', label: 'Food Diary', short: 'Diary', icon: <MenuBookRoundedIcon /> },
  { to: '/meals', label: 'Meal Plan', short: 'Meal Plan', icon: <RestaurantMenuRoundedIcon /> },
  { to: '/foods', label: 'Food Library', short: 'Food Library', icon: <EggAltRoundedIcon /> },
  { to: '/water', label: 'Water', short: 'Water', icon: <WaterDropRoundedIcon /> },
  { to: '/workouts', label: 'Workouts', short: 'Workout', icon: <FitnessCenterRoundedIcon /> },
  { to: '/routine', label: 'Daily Routine', short: 'Routine', icon: <ViewTimelineRoundedIcon /> },
  { to: '/alarms', label: 'Alarms & Reminders', short: 'Alarms', icon: <AlarmRoundedIcon /> },
  { to: '/history', label: 'History', short: 'History', icon: <CalendarMonthRoundedIcon /> },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: <InsightsRoundedIcon /> },
  { to: '/measurements', label: 'Body & Progress', short: 'Body & Progress', icon: <MonitorWeightRoundedIcon /> },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: <SettingsRoundedIcon /> },
];

const BOTTOM_ITEMS = ['/', '/diary', '/workouts', '/alarms'];
const MORE_ITEMS = NAV_ITEMS.filter((n) => !BOTTOM_ITEMS.includes(n.to));
/** Tint per destination for the "More" grid tiles. */
const TILE_COLORS: Record<string, string> = {
  '/meals': '#F59E0B',
  '/foods': '#16A34A',
  '/water': '#0EA5E9',
  '/routine': '#8B5CF6',
  '/history': '#6366F1',
  '/reports': '#EC4899',
  '/measurements': '#F97316',
  '/settings': '#64748B',
};
const SIDEBAR_WIDTH = 264;
const APP_BAR_HEIGHT = 56;
const NAV_HEIGHT = 64;

const isActive = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

// ───────────── Route loading indicator ─────────────
// Lazy page chunks report here; the shell shows a thin progress bar instead of a full-screen spinner.

let pendingPageLoads = 0;
const loadListeners = new Set<() => void>();
const emitLoads = () => queueMicrotask(() => loadListeners.forEach((l) => l()));

/** Wraps a lazy page import so the app shell can show a top progress bar while it downloads. */
export function trackPageLoad<T>(promise: Promise<T>): Promise<T> {
  pendingPageLoads++;
  emitLoads();
  return promise.finally(() => {
    pendingPageLoads--;
    emitLoads();
  });
}

function usePageLoading() {
  return useSyncExternalStore(
    (l) => {
      loadListeners.add(l);
      return () => loadListeners.delete(l);
    },
    () => pendingPageLoads > 0,
  );
}

/** Thin bar pinned under the app bar (phone) / at the top of the content (desktop). Fades in after a beat so fast loads don't flash. */
function RouteProgress() {
  return (
    <LinearProgress
      aria-label="Loading page"
      sx={{
        position: 'fixed',
        top: { xs: `calc(${APP_BAR_HEIGHT}px + env(safe-area-inset-top))`, md: 0 },
        left: { xs: 0, md: SIDEBAR_WIDTH },
        right: 0,
        zIndex: 1200,
        height: 3,
        borderRadius: 0,
        bgcolor: 'transparent',
        '& .MuiLinearProgress-bar': { borderRadius: 0 },
        '@keyframes routeProgressIn': { from: { opacity: 0 }, to: { opacity: 1 } },
        animation: 'routeProgressIn 200ms ease 150ms both',
      }}
    />
  );
}

/** Downloads page chunks for likely next destinations once the browser is idle. */
function usePrefetch(prefetch?: () => void) {
  useEffect(() => {
    if (!prefetch) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(prefetch, 1500);
    return () => window.clearTimeout(t);
  }, [prefetch]);
}

// ───────────── Shared pieces ─────────────

function UserAvatar({ size = 34 }: { size?: number }) {
  const { user } = useAuth();
  return (
    <Avatar sx={{ bgcolor: brand.teal, color: '#fff', width: size, height: size, fontSize: size * 0.44, fontWeight: 700 }}>
      {user?.name?.[0]?.toUpperCase() ?? '?'}
    </Avatar>
  );
}

function useLogout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return async () => {
    await logout();
    navigate('/login', { replace: true });
  };
}

// ───────────── Desktop sidebar ─────────────

function SidebarContent() {
  const { user } = useAuth();
  const { mode, toggle } = useColorMode();
  const { pathname } = useLocation();
  const { overdueCount } = useAlarms();
  const logOut = useLogout();

  return (
    <Stack sx={{ height: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 2.5 }}>
        <Box component="img" src="/icon.svg" alt="" sx={{ width: 36, height: 36 }} />
        <Box>
          <Typography variant="subtitle1" fontWeight={800} lineHeight={1.1}>
            MyFit Routine
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Your daily companion
          </Typography>
        </Box>
      </Stack>
      <List component="nav" aria-label="Main navigation" sx={{ px: 1.5, flex: 1, overflowY: 'auto' }}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.to);
          return (
            <ListItemButton
              key={item.to}
              component={NavLink}
              to={item.to}
              end={item.to === '/'}
              selected={active}
              sx={{
                borderRadius: 2.5,
                mb: 0.25,
                '&.Mui-selected': { bgcolor: 'primary.main', color: '#fff', '& .MuiListItemIcon-root': { color: '#fff' } },
                '&.Mui-selected:hover': { bgcolor: 'primary.dark' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
                {item.to === '/alarms' ? (
                  <Badge badgeContent={overdueCount} color="warning" max={99}>
                    {item.icon}
                  </Badge>
                ) : (
                  item.icon
                )}
              </ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { fontWeight: active ? 700 : 500, fontSize: 14 } }} />
            </ListItemButton>
          );
        })}
      </List>
      <Divider />
      <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 2 }}>
        <UserAvatar />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} noWrap>
            {user?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {user?.email}
          </Typography>
        </Box>
        <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
          <IconButton size="small" onClick={toggle} aria-label="Toggle colour mode">
            {mode === 'dark' ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Log out">
          <IconButton size="small" aria-label="Log out" onClick={() => void logOut()}>
            <LogoutRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

// ───────────── Phone chrome ─────────────


/** Bottom sheet with the remaining destinations, account row, theme toggle and log out. */
function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { mode, toggle } = useColorMode();
  const { pathname } = useLocation();
  const logOut = useLogout();

  return (
    // Plain Drawer: SwipeableDrawer attaches document-wide touch handlers that blocked page scrolling on phones.
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-label': 'More destinations',
          sx: {
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            pb: 'calc(16px + env(safe-area-inset-bottom))',
            pl: 'env(safe-area-inset-left)',
            pr: 'env(safe-area-inset-right)',
            maxHeight: '88dvh',
          },
        },
      }}
    >
      <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'text.disabled', opacity: 0.5, mx: 'auto', mt: 1.25, mb: 1 }} />

      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2.5, py: 1.5 }}>
        <UserAvatar size={44} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>
            {user?.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {user?.email}
          </Typography>
        </Box>
        <IconButton onClick={toggle} aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} sx={{ bgcolor: 'action.hover' }}>
          {mode === 'dark' ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
        </IconButton>
      </Stack>

      <Divider sx={{ mx: 2.5 }} />

      <Box component="nav" aria-label="More destinations" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, px: 1.5, py: 2 }}>
        {MORE_ITEMS.map((item) => {
          const active = isActive(pathname, item.to);
          const color = TILE_COLORS[item.to] ?? brand.teal;
          return (
            <ButtonBase
              key={item.to}
              component={NavLink}
              to={item.to}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              sx={(t) => ({
                flexDirection: 'column',
                gap: 1,
                py: 1.5,
                px: 0.5,
                borderRadius: 4,
                minHeight: 92,
                bgcolor: active ? alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.18 : 0.1) : 'transparent',
                '&:active': { bgcolor: 'action.selected' },
              })}
            >
              <Box
                sx={(t) => ({
                  width: 48,
                  height: 48,
                  borderRadius: '16px',
                  display: 'grid',
                  placeItems: 'center',
                  color,
                  bgcolor: alpha(color, t.palette.mode === 'dark' ? 0.2 : 0.12),
                })}
              >
                {item.icon}
              </Box>
              <Typography
                component="span"
                sx={{ fontSize: 13, fontWeight: active ? 700 : 600, lineHeight: 1.2, textAlign: 'center', color: active ? 'primary.main' : 'text.primary' }}
              >
                {item.short}
              </Typography>
            </ButtonBase>
          );
        })}
      </Box>

      <Box sx={{ px: 2.5 }}>
        <InstallAppButton onDone={onClose} />
        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogoutRoundedIcon />}
          onClick={() => {
            onClose();
            void logOut();
          }}
          sx={{ minHeight: 48, borderRadius: 3 }}
        >
          Log out
        </Button>
      </Box>
    </Drawer>
  );
}

/** "Install app" action in the More sheet (hidden once installed, or when the browser can't install). */
function InstallAppButton({ onDone }: { onDone: () => void }) {
  const pwa = usePwa();
  const [iosHelp, setIosHelp] = useState(false);
  const ios = isIosDevice();
  if (isStandaloneDisplay() || pwa.installed || (!pwa.installEvent && !ios)) return null;
  return (
    <>
      <Button
        fullWidth
        variant="contained"
        startIcon={<InstallMobileRoundedIcon />}
        onClick={() => (pwa.installEvent ? void promptInstall().then(onDone) : setIosHelp(true))}
        sx={{ minHeight: 48, borderRadius: 3, mb: 1.5 }}
      >
        Install MyFit app
      </Button>
      <IosInstallDialog open={iosHelp} onClose={() => setIosHelp(false)} />
    </>
  );
}

function PhoneTopBar({ title, onAccount }: { title: string; onAccount: () => void }) {
  const scrolled = useScrollTrigger({ disableHysteresis: true, threshold: 4 });
  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={(t) => ({
        pt: 'env(safe-area-inset-top)',
        pl: 'env(safe-area-inset-left)',
        pr: 'env(safe-area-inset-right)',
        bgcolor: alpha(t.palette.background.default, scrolled ? 0.82 : 1),
        backdropFilter: 'saturate(180%) blur(16px)',
        WebkitBackdropFilter: 'saturate(180%) blur(16px)',
        boxShadow: scrolled
          ? `0 1px 0 ${t.palette.divider}, 0 4px 16px ${alpha('#000', t.palette.mode === 'dark' ? 0.35 : 0.06)}`
          : 'none',
        transition: 'box-shadow 200ms ease, background-color 200ms ease',
      })}
    >
      <Toolbar disableGutters sx={{ minHeight: `${APP_BAR_HEIGHT}px !important`, height: APP_BAR_HEIGHT, pl: 2, pr: 1, gap: 1 }}>
        <Typography component="div" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>
          {title}
        </Typography>
        <IconButton aria-label="Account and more" onClick={onAccount} sx={{ p: 0.5 }}>
          <UserAvatar size={32} />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}

function NavIcon({ children, badge }: { children: ReactNode; badge?: number }) {
  return (
    <Box className="nav-pill" sx={{ width: 56, height: 32, borderRadius: 4, display: 'grid', placeItems: 'center', transition: 'background-color 200ms ease' }}>
      {badge ? (
        <Badge badgeContent={badge} color="warning" max={99}>
          {children}
        </Badge>
      ) : (
        children
      )}
    </Box>
  );
}

function PhoneBottomNav({ value, onMore }: { value: string; onMore: () => void }) {
  const navigate = useNavigate();
  const { overdueCount } = useAlarms();
  return (
    <Paper
      component="nav"
      aria-label="Main navigation"
      elevation={0}
      square
      sx={(t) => ({
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1100,
        pb: 'env(safe-area-inset-bottom)',
        pl: 'env(safe-area-inset-left)',
        pr: 'env(safe-area-inset-right)',
        bgcolor: alpha(t.palette.background.paper, 0.9),
        backdropFilter: 'saturate(180%) blur(16px)',
        WebkitBackdropFilter: 'saturate(180%) blur(16px)',
        borderTop: 1,
        borderColor: 'divider',
      })}
    >
      <BottomNavigation
        showLabels
        value={value}
        onChange={(_, v: string) => (v === 'more' ? onMore() : navigate(v))}
        sx={(t) => ({
          height: NAV_HEIGHT,
          bgcolor: 'transparent',
          '& .MuiBottomNavigationAction-root': { pt: '8px', pb: '6px', gap: '4px', color: 'text.secondary', justifyContent: 'flex-start' },
          '& .MuiBottomNavigationAction-label, & .MuiBottomNavigationAction-label.Mui-selected': { fontSize: 12, fontWeight: 600, lineHeight: 1.2 },
          '& .Mui-selected': { color: 'text.primary' },
          '& .Mui-selected .MuiBottomNavigationAction-label': { fontWeight: 800 },
          '& .Mui-selected .nav-pill': {
            bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.24 : 0.16),
            color: t.palette.mode === 'dark' ? t.palette.primary.light : t.palette.primary.dark,
          },
        })}
      >
        <BottomNavigationAction value="/" label="Home" icon={<NavIcon><DashboardRoundedIcon /></NavIcon>} />
        <BottomNavigationAction value="/diary" label="Diary" icon={<NavIcon><MenuBookRoundedIcon /></NavIcon>} />
        <BottomNavigationAction value="/workouts" label="Workout" icon={<NavIcon><FitnessCenterRoundedIcon /></NavIcon>} />
        <BottomNavigationAction
          value="/alarms"
          label="Alarms"
          aria-label={overdueCount ? `Alarms, ${overdueCount} overdue` : 'Alarms'}
          icon={
            <NavIcon badge={overdueCount}>
              <AlarmRoundedIcon />
            </NavIcon>
          }
        />
        <BottomNavigationAction value="more" label="More" aria-haspopup="dialog" icon={<NavIcon><GridViewRoundedIcon /></NavIcon>} />
      </BottomNavigation>
    </Paper>
  );
}

// ───────────── Layout ─────────────

export function Layout({ overlay, prefetch }: { overlay?: ReactNode; /** Called once when idle to warm likely page chunks. */ prefetch?: () => void }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const current = NAV_ITEMS.find((n) => isActive(pathname, n.to));
  const bottomValue = moreOpen ? 'more' : (BOTTOM_ITEMS.find((to) => isActive(pathname, to)) ?? 'more');
  const pageLoading = usePageLoading();
  usePrefetch(prefetch);

  // Close the sheet on navigation (e.g. browser back).
  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{ position: 'absolute', left: -9999, '&:focus': { left: 16, top: 16, zIndex: 2000, bgcolor: 'background.paper', p: 1 } }}
      >
        Skip to content
      </Box>
      {desktop ? (
        <Drawer
          variant="permanent"
          sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, borderRight: 1, borderColor: 'divider' } }}
        >
          <SidebarContent />
        </Drawer>
      ) : (
        <>
          <PhoneTopBar title={current?.label ?? 'MyFit Routine'} onAccount={() => setMoreOpen(true)} />
          <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
        </>
      )}

      {pageLoading && <RouteProgress />}

      <Box
        component="main"
        id="main"
        tabIndex={-1}
        sx={{
          flex: 1,
          minWidth: 0,
          px: { xs: 2, sm: 3, lg: 4 },
          pt: { xs: `calc(${APP_BAR_HEIGHT + 12}px + env(safe-area-inset-top))`, md: 4 },
          pb: { xs: `calc(${NAV_HEIGHT + 24}px + env(safe-area-inset-bottom))`, md: 6 },
          // `clip` (not `hidden`) so sticky section tabs inside pages keep working.
          overflowX: 'clip',
          maxWidth: 1440,
          mx: 'auto',
          width: '100%',
          outline: 'none',
        }}
      >
        {overlay}
        {pathname === '/' && <InstallBanner />}
        <Suspense fallback={<RouteProgress />}>
          <Outlet />
        </Suspense>
      </Box>

      {!desktop && <PhoneBottomNav value={bottomValue} onMore={() => setMoreOpen(true)} />}
      <PwaNotices />
    </Box>
  );
}
