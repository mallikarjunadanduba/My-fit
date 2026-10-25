import { forwardRef, useImperativeHandle, useState } from 'react';
import { Box, Button, IconButton, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { usePhone } from '../../components/common/mobile';
import { formatCountdown, useRestTimer } from './useRestTimer';
import { playBeep, unlockAudio, vibrate } from './timerAlerts';

const SOUND_KEY = 'mf_rest_sound';

/**
 * Height of the phone bottom navigation (64px bar + 1px border) + safe area.
 * NOTE: `BOTTOM_NAV_OFFSET` in components/common/mobile.tsx still says 56px; the bar must not overlap the nav.
 */
const NAV_OFFSET = 'calc(65px + env(safe-area-inset-bottom))';
/** Space to reserve at the end of the page so the fixed bar never covers content. */
export const REST_BAR_SPACE = 76;

function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export interface RestTimerHandle {
  /** Starts (or restarts) the countdown. Call from a user gesture so audio can be unlocked. */
  start: (seconds: number, label?: string) => void;
}

/**
 * Rest timer bar. Phone: fixed just above the bottom navigation (thumb reach, never covers the set rows —
 * the page reserves `REST_BAR_SPACE`). Desktop: sticky at the bottom of the content column.
 * Beep + vibration at the end; time is computed from timestamps so it survives background tabs.
 */
export const RestTimerPanel = forwardRef<RestTimerHandle>(function RestTimerPanel(_props, ref) {
  const phone = usePhone();
  const [sound, setSound] = useState(readSoundPref);
  const [label, setLabel] = useState<string | null>(null);
  const timer = useRestTimer({
    onComplete: () => {
      if (sound) playBeep();
      vibrate();
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      start: (seconds, l) => {
        unlockAudio();
        setLabel(l ?? null);
        timer.start(seconds);
      },
    }),
    [timer],
  );

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    if (next) unlockAudio();
    try {
      localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    } catch {
      // preference just won't persist
    }
  };

  const quick = (s: number) => {
    unlockAudio();
    setLabel(null);
    timer.start(s);
  };

  const running = timer.status === 'running';
  const paused = timer.status === 'paused';
  const active = running || paused;
  const done = timer.status === 'done';
  const btn = { minHeight: 44, minWidth: 0, px: 1.25, fontWeight: 700, flexShrink: 0 } as const;

  return (
    <Paper
      elevation={0}
      role="region"
      aria-label="Rest timer"
      sx={(t) => ({
        position: phone ? 'fixed' : 'sticky',
        left: phone ? 0 : undefined,
        right: phone ? 0 : undefined,
        bottom: phone ? NAV_OFFSET : 16,
        zIndex: t.zIndex.appBar - 1,
        mt: phone ? 0 : 2,
        px: phone ? 1.5 : 2,
        py: 1,
        overflow: 'hidden',
        borderRadius: phone ? 0 : 3,
        border: phone ? 0 : 1,
        borderTop: 1,
        borderColor: done ? 'success.main' : active ? 'primary.main' : 'divider',
        bgcolor: 'background.paper',
        boxShadow: t.palette.mode === 'dark' ? '0 -6px 20px rgba(0,0,0,0.45)' : '0 -6px 20px rgba(21,34,56,0.08)',
      })}
    >
      {active && (
        <LinearProgress
          variant="determinate"
          value={Math.min(100, timer.progress * 100)}
          aria-label="Rest elapsed"
          sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: 0, '& .MuiLinearProgress-bar': { borderRadius: 0 } }}
        />
      )}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 52 }}>
        <IconButton
          aria-label={sound ? 'Turn rest timer sound off' : 'Turn rest timer sound on'}
          aria-pressed={sound}
          onClick={toggleSound}
          sx={{ color: 'text.secondary', ml: -0.5 }}
        >
          {sound ? <VolumeUpRoundedIcon /> : <VolumeOffRoundedIcon />}
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            component="div"
            aria-live={done ? 'assertive' : 'off'}
            sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', color: done ? 'success.main' : active ? 'text.primary' : 'text.secondary' }}
          >
            {formatCountdown(timer.remainingSec)}
          </Typography>
          <Typography variant="caption" color={done ? 'success.main' : 'text.secondary'} noWrap component="div" sx={{ fontWeight: done ? 700 : 500 }}>
            {done ? 'Rest over — next set!' : active ? `${paused ? 'Paused' : 'Resting'}${label ? ` · ${label}` : ''}` : 'Rest timer'}
          </Typography>
        </Box>

        {timer.status === 'idle' &&
          [60, 90, 120].map((sec) => (
            <Button key={sec} variant="outlined" color="inherit" onClick={() => quick(sec)} aria-label={`Start ${sec} second rest`} sx={{ ...btn, borderColor: 'divider' }}>
              {sec < 120 ? `${sec}s` : `${sec / 60}m`}
            </Button>
          ))}
        {(active || done) && (
          <Button variant="outlined" color="inherit" onClick={() => timer.addSeconds(15)} aria-label="Add 15 seconds" sx={{ ...btn, borderColor: 'divider' }}>
            +15s
          </Button>
        )}
        {running && (
          <Button variant="contained" onClick={timer.pause} aria-label="Pause rest timer" sx={{ ...btn, px: 1.5 }}>
            <PauseRoundedIcon />
          </Button>
        )}
        {paused && (
          <Button variant="contained" onClick={timer.resume} aria-label="Resume rest timer" sx={{ ...btn, px: 1.5 }}>
            <PlayArrowRoundedIcon />
          </Button>
        )}
        {done && (
          <Button variant="contained" color="success" onClick={() => (unlockAudio(), timer.restart())} sx={btn}>
            Again
          </Button>
        )}
        {active && (
          <IconButton onClick={timer.reset} aria-label="Reset rest timer">
            <RestartAltRoundedIcon />
          </IconButton>
        )}
        {done && (
          <IconButton onClick={timer.reset} aria-label="Dismiss rest timer">
            <CloseRoundedIcon />
          </IconButton>
        )}
      </Stack>
    </Paper>
  );
});
