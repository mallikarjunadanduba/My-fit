import { useState } from 'react';
import { Box, ButtonBase, Card, CardContent, IconButton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import { ErrorState, LoadingState } from '../../components/common/States';
import { ResponsiveDialog } from '../../components/common/mobile';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../services/api';
import { formatDay, shiftDate, todayIn } from '../../services/dates';
import { nutrientColors } from '../../theme/theme';
import { fmt, scoreColor, scoreLabel, WORKOUT_DAY_STATUS } from '../reports/format';
import type { CalendarDay, CalendarMonth } from '../reports/types';
import { DaySummary } from './DaySummary';

const WEEK_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function describe(d: CalendarDay) {
  const parts = [formatDay(d.date, 'EEEE d MMMM'), d.dayType === 'GYM' ? 'gym day' : 'rest day'];
  if (d.future) parts.push('planned');
  else {
    parts.push(d.score != null ? `score ${d.score} (${scoreLabel(d.score)})` : 'no score');
    parts.push(d.logged.food ? `${fmt(d.calories, 0)} kcal` : 'no food log');
    if (d.logged.water) parts.push(`${d.waterMl} ml water`);
    parts.push(WORKOUT_DAY_STATUS[d.workoutStatus].toLowerCase());
    if (d.routinePct != null) parts.push(`routine ${d.routinePct}%`);
  }
  if (d.hasNotes) parts.push('has notes');
  return parts.join(', ');
}

function DayCell({ d, today, onOpen }: { d: CalendarDay; today: string; onOpen: () => void }) {
  const isToday = d.date === today;
  const color = scoreColor(d.score);
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={describe(d)}
      sx={{
        width: '100%',
        aspectRatio: { xs: '1 / 1.05', sm: '1 / 0.85' },
        minHeight: 44,
        borderRadius: '12px',
        border: 1,
        borderColor: isToday ? 'primary.main' : d.future ? 'divider' : 'transparent',
        borderWidth: isToday ? 2 : 1,
        bgcolor: d.score != null ? alpha(color, 0.12) : d.future ? 'transparent' : (t) => alpha(t.palette.text.primary, 0.04),
        borderStyle: d.future && !isToday ? 'dashed' : 'solid',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        position: 'relative',
        '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
        '&.Mui-focusVisible': {
          outline: 2,
          outlineStyle: 'solid',
          outlineColor: 'primary.main',
        },
      }}
    >
      <Typography variant="body2" fontWeight={isToday ? 800 : 600} color={d.future ? 'text.secondary' : 'text.primary'} sx={{ lineHeight: 1.1 }}>
        {Number(d.date.slice(8))}
      </Typography>
      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ height: 12 }} aria-hidden>
        {d.score != null && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color }} />}
        {d.workoutStatus === 'COMPLETED' && <FitnessCenterRoundedIcon sx={{ fontSize: 11, color: nutrientColors.protein }} />}
        {d.score != null && (
          <Typography
            component="span"
            sx={{
              fontSize: 10,
              fontWeight: 700,
              display: { xs: 'none', sm: 'inline' },
            }}
          >
            {d.score}
          </Typography>
        )}
      </Stack>
      {d.hasNotes && (
        <StickyNote2RoundedIcon
          sx={{
            fontSize: 10,
            color: 'text.secondary',
            position: 'absolute',
            top: 3,
            right: 3,
          }}
          aria-hidden
        />
      )}
    </ButtonBase>
  );
}

/** Month grid (Monday first). Tapping a day opens its daily summary in a full-screen sheet on phones. */
export function CalendarTab({ openDate, onOpenDate }: { openDate: string | null; onOpenDate: (date: string | null) => void }) {
  const { timezone } = useAuth();
  const today = todayIn(timezone);
  const [month, setMonth] = useState((openDate ?? today).slice(0, 7));
  const { data, error, loading, refreshing, reload } = useAsync(() => api.get<CalendarMonth>('/reports/calendar', { month }), [month]);

  const offset = data ? (data.days[0].weekday + 6) % 7 : 0; // Monday-first grid
  const elapsed = data?.days.filter((d) => !d.future) ?? [];
  const scored = elapsed.filter((d) => d.score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((s, d) => s + d.score!, 0) / scored.length) : null;
  const fresh = data && data.month === month;

  return (
    <>
      <Card>
        <CardContent sx={{ px: { xs: 1.5, sm: 2 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <IconButton aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeftIcon />
            </IconButton>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h6" component="h2" sx={{ fontSize: 17 }} aria-live="polite">
                {formatDay(`${month}-01`, 'MMMM yyyy')}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ minHeight: 18 }}>
                {fresh ? `Food ${elapsed.filter((d) => d.logged.food).length}/${elapsed.length} days · avg score ${avgScore ?? '—'}` : refreshing || loading ? 'Loading…' : ''}
              </Typography>
            </Box>
            <IconButton aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} disabled={shiftMonth(month, 1) > today.slice(0, 7)}>
              <ChevronRightIcon />
            </IconButton>
          </Stack>

          {error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !fresh ? (
            <LoadingState minHeight={320} label="Loading calendar…" />
          ) : (
            <>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  gap: { xs: 0.5, sm: 1 },
                  mt: 1,
                }}
                role="grid"
                aria-label={`Calendar for ${formatDay(`${month}-01`, 'MMMM yyyy')}`}
              >
                {WEEK_HEAD.map((w) => (
                  <Typography key={w} variant="caption" color="text.secondary" textAlign="center" fontWeight={700} role="columnheader" sx={{ pb: 0.5 }}>
                    {w.slice(0, 1)}
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                      {w.slice(1)}
                    </Box>
                  </Typography>
                ))}
                {Array.from({ length: offset }).map((_, i) => (
                  <Box key={`pad-${i}`} aria-hidden />
                ))}
                {data.days.map((d) => (
                  <Box key={d.date} role="gridcell">
                    <DayCell d={d} today={data.today} onOpen={() => onOpenDate(d.date)} />
                  </Box>
                ))}
              </Box>
              <Stack direction="row" spacing={1.5} rowGap={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 1.5, px: 0.5 }} aria-label="Legend">
                {[
                  { label: '≥ 80', color: scoreColor(90) },
                  { label: '50–79', color: scoreColor(60) },
                  { label: '< 50', color: scoreColor(10) },
                ].map((l) => (
                  <Stack key={l.label} direction="row" spacing={0.5} alignItems="center">
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: l.color,
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {l.label}
                    </Typography>
                  </Stack>
                ))}
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <FitnessCenterRoundedIcon sx={{ fontSize: 12, color: nutrientColors.protein }} />
                  <Typography variant="caption" color="text.secondary">
                    Workout
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Tap a day for details
                </Typography>
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      <ResponsiveDialog
        open={!!openDate}
        onClose={() => onOpenDate(null)}
        title={openDate ? formatDay(openDate, 'EEE, d MMM yyyy') : 'Daily summary'}
        headerAction={
          openDate ? (
            <Stack direction="row">
              <IconButton aria-label="Previous day" onClick={() => onOpenDate(shiftDate(openDate, -1))}>
                <ChevronLeftIcon />
              </IconButton>
              <IconButton aria-label="Next day" onClick={() => onOpenDate(shiftDate(openDate, 1))} disabled={openDate >= today}>
                <ChevronRightIcon />
              </IconButton>
            </Stack>
          ) : undefined
        }
      >
        {openDate && <DaySummary date={openDate} onChanged={reload} />}
      </ResponsiveDialog>
    </>
  );
}
