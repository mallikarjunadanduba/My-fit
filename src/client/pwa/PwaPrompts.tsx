import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Card, IconButton, Snackbar, Stack, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded';
import AddBoxOutlinedIcon from '@mui/icons-material/AddBoxOutlined';
import InstallMobileRoundedIcon from '@mui/icons-material/InstallMobileRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import { ResponsiveDialog } from '../components/common/mobile';
import { applyUpdate, dismissUpdate, isIosDevice, isStandaloneDisplay, promptInstall, pwaState, subscribePwa } from './pwa';

const DISMISS_KEY = 'myfit.installBanner.dismissedAt';
const DISMISS_DAYS = 14;

/** Snapshot of the PWA state for React (re-renders on install/update events). */
export function usePwa() {
  const version = useSyncExternalStore(subscribePwa, () => `${pwaState.needRefresh}|${!!pwaState.installEvent}|${pwaState.installed}`);
  return { ...pwaState, version };
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** iPhone/iPad: Safari has no install prompt — explain Add to Home Screen. */
export function IosInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const steps = [
    { icon: <IosShareRoundedIcon />, text: 'Open this page in Safari and tap the Share button.' },
    { icon: <AddBoxOutlinedIcon />, text: 'Scroll down and tap “Add to Home Screen”, then “Add”.' },
    { icon: <InstallMobileRoundedIcon />, text: 'Open MyFit from your Home Screen. Alarm notifications on iPhone only work from the installed app.' },
  ];
  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Install MyFit on iPhone" actions={<Button onClick={onClose}>Got it</Button>}>
      <Stack spacing={2.5} sx={{ py: 1 }}>
        {steps.map((s, i) => (
          <Stack key={i} direction="row" spacing={2} alignItems="center">
            <Box sx={{ width: 44, height: 44, borderRadius: 3, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'primary.main', flexShrink: 0 }}>
              {s.icon}
            </Box>
            <Typography>
              <b>{i + 1}.</b> {s.text}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </ResponsiveDialog>
  );
}

/** Install banner (only when installable and not already installed). Rendered at the top of the main area. */
export function InstallBanner() {
  const pwa = usePwa();
  const [hidden, setHidden] = useState(recentlyDismissed);
  const [iosHelp, setIosHelp] = useState(false);
  const ios = isIosDevice();
  const standalone = isStandaloneDisplay();
  const canPrompt = !!pwa.installEvent;

  if (standalone || pwa.installed || hidden || (!canPrompt && !ios)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* not persisted */
    }
    setHidden(true);
  };

  return (
    <>
      <Card sx={{ mb: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: 'primary.main', color: '#fff', border: 'none' }}>
        <Box component="img" src="/icon-192.png" alt="" sx={{ width: 40, height: 40, borderRadius: 2.5, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Install the MyFit app
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.9, display: 'block', lineHeight: 1.3 }}>
            Full screen, faster, and alarm notifications.
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          onClick={() => (canPrompt ? void promptInstall() : setIosHelp(true))}
          sx={{ bgcolor: '#fff', color: 'primary.dark', minHeight: 36, '&:hover': { bgcolor: '#E6F7F8' } }}
        >
          {canPrompt ? 'Install' : 'How?'}
        </Button>
        <IconButton aria-label="Dismiss install suggestion" onClick={dismiss} sx={{ color: '#fff', ml: -0.5 }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Card>
      <IosInstallDialog open={iosHelp} onClose={() => setIosHelp(false)} />
    </>
  );
}

/** Global PWA notices: new version available, and offline status. */
export function PwaNotices() {
  const pwa = usePwa();
  const online = useOnline();
  return (
    <>
      <Snackbar
        open={pwa.needRefresh}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ top: { xs: 'calc(64px + env(safe-area-inset-top))', md: 24 } }}
      >
        <Alert
          severity="info"
          variant="filled"
          onClose={dismissUpdate}
          action={
            <Button color="inherit" size="small" onClick={() => void applyUpdate()} sx={{ fontWeight: 700 }}>
              Update
            </Button>
          }
        >
          A new version of MyFit is ready.
        </Alert>
      </Snackbar>
      <Snackbar open={!online} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} sx={{ top: { xs: 'calc(64px + env(safe-area-inset-top))', md: 24 } }}>
        <Alert severity="warning" variant="filled" icon={<CloudOffRoundedIcon />}>
          You’re offline — showing saved screens. Changes need a connection.
        </Alert>
      </Snackbar>
    </>
  );
}
