import { useState } from 'react';
import { Alert, Avatar, Button, Dialog, Menu, MenuItem, Stack, Typography } from '@mui/material';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import SnoozeRoundedIcon from '@mui/icons-material/SnoozeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { formatInstant } from '../../services/dates';
import { usePhone } from '../../components/common/mobile';
import { CATEGORY_META, CategoryIcon } from './categories';
import { clockParts } from './format';
import type { Occurrence } from './types';

export const SNOOZE_CHOICES = [5, 10, 15, 30, 60];

interface Props {
  occurrence: Occurrence | null;
  timezone: string;
  queued: number;
  soundBlocked: boolean;
  busy: boolean;
  onPlaySound: () => void;
  onDone: () => void;
  onSnooze: (minutes?: number) => void;
  onDismiss: () => void;
}

/** The ringing alarm: full screen on phones, very large Done / Snooze / Dismiss in thumb reach. */
export function AlarmDialog({ occurrence, timezone, queued, soundBlocked, busy, onPlaySound, onDone, onSnooze, onDismiss }: Props) {
  const fullScreen = usePhone();
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const o = occurrence;
  const meta = o ? CATEGORY_META[o.reminder.category] : null;
  const snoozed = o?.status === 'SNOOZED';
  const { time, suffix } = clockParts(o ? formatInstant(o.dueAt, timezone, 'HH:mm') : '00:00');

  return (
    <Dialog
      open={!!o}
      fullScreen={fullScreen}
      maxWidth="xs"
      fullWidth
      aria-labelledby="alarm-title"
      aria-describedby="alarm-desc"
      disableEscapeKeyDown
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: (t) => (meta ? `linear-gradient(180deg, ${meta.color}${t.palette.mode === 'dark' ? '40' : '2e'} 0%, ${t.palette.background.paper} 55%)` : 'none'),
            pt: fullScreen ? 'env(safe-area-inset-top)' : 0,
            pb: 'env(safe-area-inset-bottom)',
          },
        },
      }}
    >
      {o && meta && (
        <Stack sx={{ minHeight: fullScreen ? '100%' : 520, px: 3, pt: 4, pb: 3 }}>
          <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ flex: 1, textAlign: 'center' }}>
            <Avatar sx={{ bgcolor: meta.color, width: 88, height: 88, fontSize: 46, boxShadow: `0 0 0 12px ${meta.color}26` }}>
              <CategoryIcon category={o.reminder.category} fontSize="inherit" />
            </Avatar>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ pt: 1.5 }}>
              <Typography component="p" sx={{ fontSize: 76, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums' }}>
                {time}
              </Typography>
              <Typography component="span" sx={{ fontSize: 24, fontWeight: 700 }} color="text.secondary">
                {suffix}
              </Typography>
            </Stack>
            <Typography id="alarm-title" variant="h5" component="h2" sx={{ fontWeight: 800, wordBreak: 'break-word', maxWidth: 360 }}>
              {o.reminder.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {meta.label}
              {snoozed ? ' · snoozed' : ''}
            </Typography>
            <Stack spacing={1.5} id="alarm-desc" role="alert" sx={{ width: '100%', maxWidth: 360, pt: 1 }}>
              {o.reminder.description && (
                <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>
                  {o.reminder.description}
                </Typography>
              )}
              {soundBlocked && o.reminder.sound && (
                <Alert
                  severity="info"
                  sx={{ textAlign: 'left' }}
                  action={
                    <Button color="inherit" startIcon={<VolumeUpRoundedIcon />} onClick={onPlaySound} sx={{ minHeight: 44 }}>
                      Play
                    </Button>
                  }
                >
                  Tap Play to hear the alarm.
                </Alert>
              )}
              {queued > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {queued} more reminder{queued === 1 ? '' : 's'} waiting
                </Typography>
              )}
            </Stack>
          </Stack>

          <Stack spacing={1.5} sx={{ width: '100%', maxWidth: 420, mx: 'auto', pt: 3 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<CheckRoundedIcon sx={{ fontSize: '30px !important' }} />}
              onClick={onDone}
              disabled={busy}
              autoFocus
              sx={{ minHeight: 76, fontSize: 22, fontWeight: 800, borderRadius: 5 }}
            >
              Done
            </Button>
            <Stack direction="row" spacing={1.5}>
              <Button
                variant="outlined"
                size="large"
                startIcon={<SnoozeRoundedIcon />}
                onClick={() => onSnooze()}
                disabled={busy}
                sx={{ flex: 1, minHeight: 64, fontSize: 18, fontWeight: 700, borderRadius: 5, borderWidth: 2, '&:hover': { borderWidth: 2 } }}
              >
                Snooze {o.reminder.snoozeMinutes}m
              </Button>
              <Button
                variant="outlined"
                size="large"
                aria-label="Choose snooze length"
                aria-haspopup="menu"
                onClick={(e) => setMenuEl(e.currentTarget)}
                disabled={busy}
                sx={{ minHeight: 64, minWidth: 64, px: 0, borderRadius: 5, borderWidth: 2, '&:hover': { borderWidth: 2 } }}
              >
                <ArrowDropDownRoundedIcon fontSize="large" />
              </Button>
            </Stack>
            <Button size="large" color="inherit" startIcon={<CloseRoundedIcon />} onClick={onDismiss} disabled={busy} sx={{ minHeight: 60, fontSize: 18, fontWeight: 700, borderRadius: 5 }}>
              Dismiss
            </Button>
          </Stack>
          <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)}>
            {SNOOZE_CHOICES.map((m) => (
              <MenuItem
                key={m}
                sx={{ minHeight: 52, fontSize: 17 }}
                onClick={() => {
                  setMenuEl(null);
                  onSnooze(m);
                }}
              >
                Snooze {m} min
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      )}
    </Dialog>
  );
}
