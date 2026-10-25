import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Box, Button, Card, IconButton, List, ListItem, ListItemButton, Stack, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import HotelRoundedIcon from '@mui/icons-material/HotelRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { api } from '../../services/api';
import { formatDay, shiftDate, todayIn, WEEKDAYS_SHORT } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../auth/AuthContext';
import { ErrorState, LoadingState } from '../../components/common/States';
import { WORKOUT_SESSION_PATH, type Consistency, type WeekDayStatus, type WeekView } from './types';

type Tone = 'success' | 'info' | 'warning' | 'error' | 'primary' | 'text';
const STATUS_META: Record<WeekDayStatus, { label: string; tone: Tone; icon: ReactElement }> = {
  COMPLETED: { label: 'Done', tone: 'success', icon: <CheckCircleRoundedIcon /> },
  IN_PROGRESS: { label: 'In progress', tone: 'info', icon: <PlayCircleRoundedIcon /> },
  SKIPPED: { label: 'Skipped', tone: 'warning', icon: <SkipNextRoundedIcon /> },
  MISSED: { label: 'Missed', tone: 'error', icon: <ErrorOutlineRoundedIcon /> },
  PLANNED: { label: 'Planned', tone: 'primary', icon: <EventRoundedIcon /> },
  UPCOMING: { label: 'Upcoming', tone: 'text', icon: <RadioButtonUncheckedRoundedIcon /> },
  REST: { label: 'Rest', tone: 'text', icon: <HotelRoundedIcon /> },
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {label}
      </Typography>
    </Box>
  );
}

/** This week as 7 compact rows (tap a logged day to open it) + a 12-week consistency strip. */
export function WeekTab({ onOpenPlans }: { onOpenPlans: () => void }) {
  const { timezone } = useAuth();
  const navigate = useNavigate();
  const today = todayIn(timezone);
  const [anchor, setAnchor] = useState(today);
  const { data, error, loading, reload } = useAsync(() => api.get<WeekView>('/workouts/week', { date: anchor }), [anchor]);
  const consistency = useAsync(() => api.get<Consistency>('/workouts/consistency', { from: shiftDate(today, -83), to: today }), [today]);
  const c = consistency.data;

  return (
    <Stack spacing={2}>
      {c && (
        <Card sx={{ py: 1.5, px: 1 }}>
          <Stack direction="row" divider={<Box sx={{ width: '1px', bgcolor: 'divider', my: 0.5 }} />}>
            <Stat value={c.percent == null ? '—' : `${c.percent}%`} label="12-wk consistency" />
            <Stat value={String(c.currentStreak)} label="Current streak" />
            <Stat value={String(c.longestStreak)} label="Best streak" />
          </Stack>
        </Card>
      )}

      <Box>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <IconButton aria-label="Previous week" onClick={() => setAnchor(shiftDate(anchor, -7))}>
            <ChevronLeftIcon />
          </IconButton>
          <Box sx={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <Typography fontWeight={800} noWrap>
              {data ? `${formatDay(data.from, 'd MMM')} – ${formatDay(data.to, 'd MMM')}` : 'This week'}
            </Typography>
            {data && (
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {data.plan ? data.plan.name : 'No active plan'}
              </Typography>
            )}
          </Box>
          <IconButton aria-label="Next week" onClick={() => setAnchor(shiftDate(anchor, 7))}>
            <ChevronRightIcon />
          </IconButton>
        </Stack>

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <LoadingState label="Loading week…" />
        ) : data ? (
          <Card>
            <List disablePadding>
              {data.days.map((d, i) => {
                const meta = STATUS_META[d.status];
                const session = d.sessions[0];
                const title =
                  session?.name ?? (d.plannedDay && !d.plannedDay.isRestDay ? d.plannedDay.name : d.dayType === 'REST' || d.plannedDay?.isRestDay ? 'Rest day' : 'No workout planned');
                const sub =
                  d.plannedDay && !d.plannedDay.isRestDay ? `${d.plannedDay.exerciseCount} exercise${d.plannedDay.exerciseCount === 1 ? '' : 's'} · ${meta.label}` : meta.label;
                const color = meta.tone === 'text' ? 'text.disabled' : `${meta.tone}.main`;
                const row = (
                  <>
                    <Box
                      sx={(t) => ({
                        width: 44,
                        flexShrink: 0,
                        mr: 1.5,
                        py: 0.5,
                        borderRadius: '12px',
                        textAlign: 'center',
                        bgcolor: d.isToday ? 'primary.main' : alpha(t.palette.text.primary, 0.05),
                        color: d.isToday ? '#fff' : 'text.primary',
                      })}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.3, opacity: 0.85 }}>{WEEKDAYS_SHORT[d.weekday].toUpperCase()}</Typography>
                      <Typography sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{Number(d.date.slice(8))}</Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap sx={{ color: d.status === 'REST' ? 'text.secondary' : 'text.primary' }}>
                        {title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {sub}
                      </Typography>
                    </Box>
                    <Box sx={{ color, display: 'flex', ml: 1 }} aria-label={meta.label}>
                      {meta.icon}
                    </Box>
                  </>
                );
                return session ? (
                  <ListItemButton
                    key={d.date}
                    divider={i < data.days.length - 1}
                    onClick={() => navigate(WORKOUT_SESSION_PATH(session.id))}
                    aria-label={`Open ${session.name} on ${formatDay(d.date)}`}
                    sx={{ py: 1 }}
                  >
                    {row}
                  </ListItemButton>
                ) : (
                  <ListItem key={d.date} divider={i < data.days.length - 1} sx={{ py: 1, minHeight: 60 }}>
                    {row}
                  </ListItem>
                );
              })}
            </List>
          </Card>
        ) : null}
        <Stack direction="row" justifyContent="center" spacing={1} sx={{ mt: 1 }}>
          {anchor !== today && <Button onClick={() => setAnchor(today)}>This week</Button>}
          <Button onClick={onOpenPlans}>{data?.plan ? 'Edit plan' : 'Set up a plan'}</Button>
        </Stack>
      </Box>
    </Stack>
  );
}
