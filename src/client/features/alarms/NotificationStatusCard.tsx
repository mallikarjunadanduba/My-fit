import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Divider,
  IconButton,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsOffRoundedIcon from '@mui/icons-material/NotificationsOffRounded';
import NotificationsPausedRoundedIcon from '@mui/icons-material/NotificationsPausedRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded';
import BatteryAlertRoundedIcon from '@mui/icons-material/BatteryAlertRounded';
import { toApiError } from '../../services/api';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { useAlarms } from './AlarmProvider';
import { isAndroid, isIos, isStandalone } from './pushClient';
import { DELIVERY_STATUS } from './format';
import type { DeliveryOutcome } from './types';

type Tone = 'success' | 'warning' | 'error' | 'default';

/** A short, expandable tip (iOS install steps, Android battery note). */
function Tip({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Button
        fullWidth
        color="inherit"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        startIcon={icon}
        endIcon={<ExpandMoreRoundedIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />}
        sx={{ justifyContent: 'flex-start', minHeight: 44, px: 1, fontWeight: 600, fontSize: 14, '& .MuiButton-endIcon': { ml: 'auto' } }}
      >
        {title}
      </Button>
      <Collapse in={open}>
        <Box sx={{ px: 1, pb: 1, typography: 'body2', color: 'text.secondary' }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

/** Compact notification status: one status line, one clear action, short collapsible guidance. */
export function NotificationStatusCard({ onDevicesChanged }: { onDevicesChanged?: () => void }) {
  const { permission, pushSupported, pushConfigured, subscribed, subscribe, unsubscribe, sendTest } = useAlarms();
  const { settings } = useAuth();
  const { notify, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [results, setResults] = useState<DeliveryOutcome[] | null>(null);

  const ios = isIos();
  const needsInstall = ios && !isStandalone();
  const canEnable = pushSupported && pushConfigured && permission !== 'denied' && !subscribed && !needsInstall;

  const enable = async () => {
    setBusy(true);
    try {
      const ok = await subscribe();
      if (ok) {
        notify('Notifications are on for this device');
        onDevicesChanged?.();
      } else notify('Permission was not granted', 'warning');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not enable notifications', 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setMenuEl(null);
    if (!(await confirm({ title: 'Turn off notifications here?', message: 'Alarms still ring inside the app while it is open.', confirmLabel: 'Turn off' }))) return;
    setBusy(true);
    try {
      await unsubscribe();
      notify('Notifications turned off on this device', 'info');
      onDevicesChanged?.();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setMenuEl(null);
    setBusy(true);
    try {
      const out = await sendTest();
      setResults(out);
      const sent = out.filter((o) => o.status === 'SENT').length;
      notify(sent ? `Test sent to ${sent} device${sent === 1 ? '' : 's'}` : 'No device received the test', sent ? 'success' : 'warning');
      onDevicesChanged?.();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  let tone: Tone = 'default';
  let status = 'Off on this device';
  let detail = 'Get alarms even when the app is closed.';
  if (subscribed) {
    tone = 'success';
    status = 'On for this device';
    detail = 'Alarms arrive even when the app is closed.';
  } else if (needsInstall) {
    tone = 'warning';
    status = 'Install the app first';
    detail = 'iPhone shows notifications only for Home Screen apps.';
  } else if (!pushSupported) {
    tone = 'warning';
    status = 'Not supported here';
    detail = 'Alarms ring only while the app is open.';
  } else if (!pushConfigured) {
    tone = 'warning';
    status = 'Server push not set up';
    detail = 'Alarms ring only while the app is open.';
  } else if (permission === 'denied') {
    tone = 'error';
    status = 'Blocked in browser';
    detail = 'Allow notifications in site settings, then reload.';
  }
  const avatarColor = tone === 'success' ? 'success.main' : tone === 'warning' ? 'warning.main' : tone === 'error' ? 'error.main' : 'action.disabled';
  const AvatarIcon = tone === 'success' ? NotificationsActiveRoundedIcon : tone === 'default' ? NotificationsPausedRoundedIcon : NotificationsOffRoundedIcon;

  return (
    <Card component="section" aria-label="Notifications">
      <CardContent sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar sx={{ bgcolor: avatarColor, width: 40, height: 40 }}>
            <AvatarIcon fontSize="small" />
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={700} noWrap>
              {status}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {detail}
            </Typography>
          </Box>
          <IconButton aria-label="Notification options" onClick={(e) => setMenuEl(e.currentTarget)} disabled={busy} sx={{ width: 44, height: 44 }}>
            <MoreVertRoundedIcon />
          </IconButton>
        </Stack>

        {canEnable && (
          <Button fullWidth variant="contained" size="large" startIcon={<NotificationsActiveRoundedIcon />} onClick={() => void enable()} disabled={busy} sx={{ mt: 1.5, minHeight: 48 }}>
            Enable notifications
          </Button>
        )}

        {settings && !settings.notificationsEnabled && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            Turned off in{' '}
            <Link component={RouterLink} to="/settings">
              Settings
            </Link>
            . Push messages are skipped.
          </Alert>
        )}

        {results && results.length > 0 && (
          <Alert severity={results.some((r) => r.status === 'SENT') ? 'success' : 'warning'} onClose={() => setResults(null)} sx={{ mt: 1.5 }}>
            <List dense disablePadding>
              {results.map((r, i) => (
                <ListItem key={r.subscriptionId ?? i} disableGutters>
                  <ListItemText
                    primary={`${r.endpointHost ?? 'No device'} — ${DELIVERY_STATUS[r.status].label}${r.statusCode ? ` (${r.statusCode})` : ''}`}
                    secondary={r.error}
                  />
                </ListItem>
              ))}
            </List>
          </Alert>
        )}

        {(needsInstall || isAndroid()) && <Divider sx={{ mt: 1.5 }} />}
        {needsInstall && (
          <Tip icon={<IosShareRoundedIcon />} title="Add to Home Screen (iPhone)">
            <Box component="ol" sx={{ pl: 2.5, my: 0.5 }}>
              <li>Open this page in Safari (iOS 16.4+).</li>
              <li>
                Tap <b>Share</b>, then <b>Add to Home Screen</b>.
              </li>
              <li>Open MyFit from the new icon and tap “Enable notifications”.</li>
            </Box>
            Until then, alarms ring only while the app is open.
          </Tip>
        )}
        {isAndroid() && (
          <Tip icon={<BatteryAlertRoundedIcon />} title="Punctual alarms on Android">
            Battery saving can delay notifications. Open Settings → Apps → your browser → Battery and choose <b>Unrestricted</b> (wording varies), and let the browser&apos;s
            notifications make sound.
          </Tip>
        )}
      </CardContent>

      <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem sx={{ minHeight: 48 }} onClick={() => void test()} disabled={!pushConfigured}>
          <ListItemIcon>
            <SendRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Send test notification</ListItemText>
        </MenuItem>
        {subscribed && (
          <MenuItem sx={{ minHeight: 48 }} onClick={() => void disable()}>
            <ListItemIcon>
              <NotificationsOffRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Turn off on this device</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <Box sx={{ px: 2, py: 1, maxWidth: 300 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            Browser: {pushSupported ? 'supported' : 'not supported'} · Permission:{' '}
            {permission === 'unsupported' ? 'n/a' : permission === 'default' ? 'not asked' : permission === 'granted' ? 'granted' : 'blocked'} · Server push:{' '}
            {pushConfigured ? 'configured' : 'not configured'}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
            Delivery can be delayed by power saving, Do Not Disturb or network. Reminders processed 30+ min late are recorded as missed.
          </Typography>
        </Box>
      </Menu>
    </Card>
  );
}
