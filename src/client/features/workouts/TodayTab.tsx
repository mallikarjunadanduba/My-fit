import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Box, Button, Card, LinearProgress, List, ListItem, ListItemAvatar, ListItemText, Stack, Typography } from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SelfImprovementRoundedIcon from '@mui/icons-material/SelfImprovementRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { api, toApiError } from '../../services/api';
import { formatDay, todayIn } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { ErrorState, LoadingState } from '../../components/common/States';
import { brand } from '../../theme/theme';
import { MediaImage } from '../media/MediaImage';
import { WORKOUT_SESSION_PATH, formatDuration, formatKg, targetSummary, type Schedule, type Session } from './types';

const heroSx = {
  p: 2.5,
  border: 0,
  color: '#fff',
  background: `linear-gradient(135deg, ${brand.teal} 0%, #00838A 100%)`,
  boxShadow: '0 10px 28px rgba(0,175,181,0.28)',
} as const;

const heroButtonSx = {
  minHeight: 52,
  fontSize: 17,
  fontWeight: 800,
  borderRadius: 3,
  bgcolor: '#fff',
  color: '#00747A',
  '&:hover': { bgcolor: alpha('#fff', 0.9) },
} as const;

/** Today's workout: hero card with the planned day and one big Start/Resume button, then the exercise list. */
export function TodayTab({ onGoToPlans }: { onGoToPlans: () => void }) {
  const { timezone } = useAuth();
  const navigate = useNavigate();
  const { notify, confirm } = useFeedback();
  const date = todayIn(timezone);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get<Schedule>('/workouts/schedule', { date }), [date]);

  const act = async (fn: () => Promise<Session | undefined>, navigateAfter = true) => {
    setBusy(true);
    try {
      const s = await fn();
      if (s && navigateAfter) navigate(WORKOUT_SESSION_PATH(s.id));
      else void reload();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Loading today…" />;
  if (!data) return null;

  const { day, session, plan } = data;
  const trainingDay = !!day && !day.isRestDay;
  const isRest = data.dayType === 'REST' || !!day?.isRestDay;

  const startPlanned = () =>
    act(async () => {
      if (session && session.workoutDayId === day?.id && (session.status === 'PLANNED' || session.status === 'SKIPPED')) {
        return api.post<Session>(`/workouts/sessions/${session.id}/start`);
      }
      return api.post<Session>('/workouts/sessions', { date, workoutDayId: day?.id ?? null, start: true });
    });
  const startFree = () => act(() => api.post<Session>('/workouts/sessions', { date, name: 'Workout', start: true }));
  const skip = async () => {
    if (!(await confirm({ title: 'Skip today’s workout?', message: 'It will be recorded as skipped. You can still start it later.', confirmLabel: 'Skip workout' }))) return;
    await act(async () => {
      const s = session?.status === 'PLANNED' ? session : await api.post<Session>('/workouts/sessions', { date, workoutDayId: day?.id ?? null });
      await api.post(`/workouts/sessions/${s.id}/skip`);
      notify('Workout marked as skipped');
      return undefined;
    }, false);
  };

  const dateLine = formatDay(date, 'EEEE d MMM');
  const setCount = day?.exercises.reduce((n, e) => n + Math.max(1, e.targetSets ?? 1), 0) ?? 0;

  // ── Hero ──
  let hero: ReactNode;
  if (session && (session.status === 'IN_PROGRESS' || session.status === 'COMPLETED' || !trainingDay)) {
    const done = session.status === 'COMPLETED';
    const pct = session.stats.totalSets ? (session.stats.completedSets / session.stats.totalSets) * 100 : 0;
    hero = (
      <Card sx={heroSx}>
        <Typography variant="overline" sx={{ opacity: 0.85, fontWeight: 700, letterSpacing: '0.08em' }}>
          {done ? 'Done today' : session.status === 'IN_PROGRESS' ? 'In progress' : 'Today'} · {dateLine}
        </Typography>
        <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.15, mt: 0.25 }}>{session.name}</Typography>
        <Typography sx={{ opacity: 0.9, mt: 0.5, fontWeight: 500 }}>
          {done
            ? `${formatDuration(session.durationSec)} · ${session.stats.completedSets} sets${session.stats.volumeKg ? ` · ${formatKg(session.stats.volumeKg)}` : ''}`
            : `${session.stats.completedSets}/${session.stats.totalSets} sets done`}
        </Typography>
        {!done && (
          <LinearProgress
            variant="determinate"
            value={pct}
            sx={{ mt: 1.5, height: 6, bgcolor: alpha('#fff', 0.25), '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }}
            aria-label="Sets completed"
          />
        )}
        <Button
          fullWidth
          size="large"
          startIcon={done ? <CheckCircleRoundedIcon /> : <PlayArrowRoundedIcon />}
          onClick={() => (session.status === 'PLANNED' || session.status === 'SKIPPED' ? startPlanned() : navigate(WORKOUT_SESSION_PATH(session.id)))}
          disabled={busy}
          sx={{ ...heroButtonSx, mt: 2 }}
        >
          {done ? 'View workout' : session.status === 'IN_PROGRESS' ? 'Resume workout' : 'Start workout'}
        </Button>
      </Card>
    );
  } else if (!plan) {
    hero = (
      <Card sx={{ p: 2.5 }}>
        <FitnessCenterRoundedIcon color="primary" sx={{ fontSize: 36 }} />
        <Typography sx={{ fontSize: 22, fontWeight: 800, mt: 1 }}>No active plan</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Set up a weekly plan to get a workout for each day — or just log a free workout.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" size="large" onClick={onGoToPlans} sx={{ flex: 1, minHeight: 48 }}>
            Set up a plan
          </Button>
          <Button variant="outlined" size="large" onClick={startFree} disabled={busy} sx={{ flex: 1, minHeight: 48 }}>
            Free workout
          </Button>
        </Stack>
      </Card>
    );
  } else if (!trainingDay) {
    hero = (
      <Card sx={{ p: 2.5 }}>
        <SelfImprovementRoundedIcon color="primary" sx={{ fontSize: 36 }} />
        <Typography variant="overline" color="text.secondary" component="div" sx={{ fontWeight: 700, mt: 0.5 }}>
          {dateLine}
        </Typography>
        <Typography sx={{ fontSize: 24, fontWeight: 800 }}>{isRest ? 'Rest day' : 'Nothing planned'}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {isRest ? 'Recovery is part of the plan. Feel like moving anyway?' : `“${plan.name}” has no workout today.`}
        </Typography>
        <Button fullWidth variant="outlined" size="large" startIcon={<PlayArrowRoundedIcon />} onClick={startFree} disabled={busy} sx={{ mt: 2, minHeight: 48 }}>
          Log a free workout
        </Button>
      </Card>
    );
  } else {
    hero = (
      <Card sx={heroSx}>
        <Typography variant="overline" sx={{ opacity: 0.85, fontWeight: 700, letterSpacing: '0.08em' }}>
          Today · {dateLine}
        </Typography>
        <Typography sx={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, mt: 0.25 }}>{day.name}</Typography>
        <Typography sx={{ opacity: 0.9, mt: 0.5, fontWeight: 500 }}>
          {day.exercises.length} exercise{day.exercises.length === 1 ? '' : 's'} · {setCount} sets · {plan.name}
        </Typography>
        {session?.status === 'SKIPPED' && <Typography sx={{ mt: 1, fontWeight: 700 }}>Marked as skipped</Typography>}
        <Button fullWidth size="large" startIcon={<PlayArrowRoundedIcon />} onClick={startPlanned} disabled={busy} sx={{ ...heroButtonSx, mt: 2 }}>
          {session?.status === 'SKIPPED' ? 'Start anyway' : 'Start workout'}
        </Button>
        {session?.status !== 'SKIPPED' && (
          <Button fullWidth onClick={skip} disabled={busy} sx={{ mt: 0.5, color: alpha('#fff', 0.9), minHeight: 44 }}>
            Skip today
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      {hero}
      {trainingDay && day.exercises.length > 0 && (
        <Box>
          <Typography variant="subtitle2" color="text.secondary" sx={{ px: 0.5, mb: 1, fontWeight: 700 }}>
            {day.name} · exercises
          </Typography>
          <Card>
            <List disablePadding>
              {day.exercises.map((item, i) => (
                <ListItem key={item.id} divider={i < day.exercises.length - 1} sx={{ py: 1.25 }}>
                  <ListItemAvatar sx={{ minWidth: 52 }}>
                    {item.exercise.imageMediaId ? (
                      <Box sx={{ width: 40 }}>
                        <MediaImage mediaId={item.exercise.imageMediaId} alt={`${item.exercise.name} reference`} />
                      </Box>
                    ) : (
                      <Box
                        sx={(t) => ({
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          color: 'primary.main',
                          bgcolor: alpha(t.palette.primary.main, 0.12),
                        })}
                      >
                        {i + 1}
                      </Box>
                    )}
                  </ListItemAvatar>
                  <ListItemText
                    primary={item.exercise.name}
                    secondary={targetSummary(item) + (item.notes ? ` · ${item.notes}` : '')}
                    slotProps={{ primary: { fontWeight: 700, noWrap: true }, secondary: { noWrap: true } }}
                  />
                </ListItem>
              ))}
            </List>
          </Card>
        </Box>
      )}
      {trainingDay && day.exercises.length === 0 && (
        <Typography color="text.secondary" sx={{ px: 0.5 }}>
          No exercises on this day yet — add some in Plans.
        </Typography>
      )}
    </Stack>
  );
}
