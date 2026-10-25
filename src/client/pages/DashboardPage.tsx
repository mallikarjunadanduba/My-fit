import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, CircularProgress, Grid, IconButton, Skeleton, Stack, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarTodayRoundedIcon from '@mui/icons-material/CalendarTodayRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import HotelRoundedIcon from '@mui/icons-material/HotelRounded';
import { ErrorState } from '../components/common/States';
import { visuallyHiddenSx } from '../components/common/mobile';
import { useAuth } from '../features/auth/AuthContext';
import { AddFoodDialog } from '../features/diary/AddFoodDialog';
import { HeroCard, MealsList, UpNextCard, WaterTile, WeekStrip, WorkoutTile } from '../features/dashboard/HomeCards';
import type { Dashboard } from '../features/reports/types';
import { useAsync } from '../hooks/useAsync';
import { api } from '../services/api';
import { formatDay, formatInstant, shiftDate, todayIn } from '../services/dates';

function greetingFor(hour: number) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Compact date control: ‹ [📅 Today] › — the middle button opens the native date picker. */
function DateButton({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  const label = date === today ? 'Today' : date === shiftDate(today, -1) ? 'Yesterday' : date === shiftDate(today, 1) ? 'Tomorrow' : formatDay(date, 'd MMM');
  return (
    <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, position: 'relative' }}>
      <IconButton aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))} sx={{ width: 40, height: 44 }}>
        <ChevronLeftIcon />
      </IconButton>
      <Button
        variant="outlined"
        size="small"
        color="inherit"
        startIcon={<CalendarTodayRoundedIcon sx={{ fontSize: '16px !important' }} />}
        onClick={open}
        onDoubleClick={() => onChange(today)}
        aria-label={`Change date, showing ${formatDay(date, 'EEEE d MMMM yyyy')}`}
        sx={{
          minHeight: 36,
          borderColor: 'divider',
          px: 1.25,
          whiteSpace: 'nowrap',
          fontWeight: 700,
        }}
      >
        {label}
      </Button>
      <input
        ref={input}
        type="date"
        value={date}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.value && onChange(e.target.value)}
        style={{
          position: 'absolute',
          left: 40,
          bottom: 0,
          width: 1,
          height: 1,
          opacity: 0,
          border: 0,
          padding: 0,
          pointerEvents: 'none',
        }}
      />
      <IconButton aria-label="Next day" onClick={() => onChange(shiftDate(date, 1))} sx={{ width: 40, height: 44 }}>
        <ChevronRightIcon />
      </IconButton>
    </Stack>
  );
}

function DashboardSkeleton() {
  return (
    <Stack spacing={2} aria-busy="true" aria-label="Loading dashboard">
      {[300, 130, 80, 300].map((h, i) => (
        <Card key={i}>
          <CardContent>
            <Skeleton width="35%" height={24} />
            <Skeleton variant="rounded" height={h - 40} sx={{ mt: 1 }} />
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

export default function DashboardPage() {
  const { timezone, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIn(timezone);
  const date = params.get('date') ?? today;
  const setDate = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true });
  const [addOpen, setAddOpen] = useState(false);

  // Cached per date (stale-while-revalidate): revisiting home paints instantly, then refreshes quietly.
  const { data, error, loading, refreshing, reload } = useAsync(() => api.get<Dashboard>('/dashboard', { date }), [date]);
  const refresh = useCallback(() => void reload(), [reload]);

  const g = data?.greeting;
  const fresh = data && data.greeting.date === date;
  const firstName = (g?.name ?? user?.name ?? '').split(' ')[0];
  const hour = Number(formatInstant(new Date().toISOString(), timezone, 'H'));
  const title = date === today ? `${greetingFor(hour)}${firstName ? `, ${firstName}` : ''}` : formatDay(date, 'EEEE');
  const busy = refreshing || (loading && !!data);

  return (
    <Box>
      {/* Compact app-style header: greeting, date + day type, date control. */}
      <Box component="header" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h1" noWrap sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap>
              {formatDay(date, 'EEE, d MMM')}
            </Typography>
            {g && fresh && (
              <Chip
                size="small"
                icon={g.dayType === 'GYM' ? <FitnessCenterRoundedIcon /> : <HotelRoundedIcon />}
                label={g.dayType === 'GYM' ? 'Gym' : 'Rest'}
                color={g.dayType === 'GYM' ? 'primary' : 'default'}
                variant={g.dayType === 'GYM' ? 'filled' : 'outlined'}
                sx={{ height: 24 }}
              />
            )}
            {busy && <CircularProgress size={14} thickness={5} aria-label="Refreshing" />}
            <Box component="span" aria-live="polite" sx={visuallyHiddenSx}>
              {busy ? 'Refreshing' : ''}
            </Box>
          </Stack>
          <DateButton date={date} today={today} onChange={setDate} />
        </Stack>
      </Box>

      {error && !data ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : !data || !fresh ? (
        <DashboardSkeleton />
      ) : (
        <>
          {error && (
            <Box sx={{ mb: 2 }}>
              <ErrorState error={error} onRetry={refresh} />
            </Box>
          )}
          {g?.notes && (
            <Card sx={{ mb: 2 }}>
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Day notes
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {g.notes}
                </Typography>
              </CardContent>
            </Card>
          )}
          {/* Phone: one simple column. Wider screens: today on the left, meals + week on the right. */}
          <Grid container spacing={2} sx={{ maxWidth: 1100 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stack spacing={1.75}>
                <HeroCard d={data} onLogFood={data.greeting.isFuture ? undefined : () => setAddOpen(true)} />
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                  <WaterTile d={data} onChanged={refresh} />
                  <WorkoutTile d={data} />
                </Box>
                {data.greeting.isToday && <UpNextCard d={data} onExpired={refresh} />}
              </Stack>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stack spacing={2.25}>
                <MealsList d={data} />
                <WeekStrip d={data} />
              </Stack>
            </Grid>
          </Grid>
        </>
      )}

      <AddFoodDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        date={date}
        onSaved={() => {
          setAddOpen(false);
          refresh();
        }}
      />
    </Box>
  );
}
