import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import AlarmRoundedIcon from '@mui/icons-material/AlarmRounded';
import RestaurantRoundedIcon from '@mui/icons-material/RestaurantRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import HotelRoundedIcon from '@mui/icons-material/HotelRounded';
import MonitorWeightRoundedIcon from '@mui/icons-material/MonitorWeightRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { useFeedback } from '../../components/common/Feedback';
import { api } from '../../services/api';
import { formatClock, formatInstant } from '../../services/dates';
import { nutrientColors } from '../../theme/theme';
import { fmt, fmtMl, MEAL_STATUS, SESSION_STATUS } from '../reports/format';
import type { ActivityItem, Dashboard } from '../reports/types';
import type { TargetProgress } from '../../../shared/nutrition';
import { ScoreRing } from './ScoreRing';

/** One dashboard section: compact header (icon, title, optional link/action) + content. */
export function DashCard({
  title,
  icon,
  action,
  children,
  accent,
  dense,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  accent?: string;
  /** No inner padding below the header (for edge-to-edge lists). */
  dense?: boolean;
}) {
  return (
    <Card sx={{ height: '100%' }} component="section" aria-label={title}>
      <CardContent
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          ...(dense ? { pb: '8px !important' } : null),
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 32 }}>
          {icon && (
            <Box
              aria-hidden
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 30,
                height: 30,
                borderRadius: 2,
                color: accent ?? 'primary.main',
                bgcolor: (t) => alpha(accent ?? t.palette.primary.main, 0.12),
                '& svg': { fontSize: 18 },
              }}
            >
              {icon}
            </Box>
          )}
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1, fontSize: 15 }} noWrap>
            {title}
          </Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

/** Small text link in a card header ("Diary ›"). */
function HeaderLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button size="small" component={RouterLink} to={to} endIcon={<ChevronRightRoundedIcon />} sx={{ mr: -1, minHeight: 36 }}>
      {children}
    </Button>
  );
}

const muted = (text: ReactNode) => (
  <Typography variant="body2" color="text.secondary">
    {text}
  </Typography>
);

const trackSx = {
  bgcolor: (t: { palette: { mode: string } }) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(21,34,56,0.06)'),
};

// ───────────────────────────── Hero: score + calories ─────────────────────────────

export function HeroCard({ d, onQuickAdd }: { d: Dashboard; onQuickAdd?: () => void }) {
  const { nutrition: n, greeting: g, completionScore: s } = d;
  const p = n.progress?.calories;
  const over = p?.status === 'over';
  return (
    <Card component="section" aria-label="Today at a glance" sx={{ height: '100%' }}>
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          height: '100%',
        }}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          {s ? (
            <ScoreRing score={s} size={104} />
          ) : (
            <Box
              sx={{
                width: 104,
                height: 104,
                borderRadius: '50%',
                border: 6,
                borderColor: 'divider',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                textAlign: 'center',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ px: 1, lineHeight: 1.2 }}>
                {g.isFuture ? 'Planned day' : 'No score yet'}
              </Typography>
            </Box>
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              {!n.target ? 'Calories eaten' : over ? 'Over limit' : 'Calories left'}
            </Typography>
            <Typography
              component="p"
              fontWeight={800}
              sx={{
                fontSize: 34,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: over ? 'warning.main' : 'text.primary',
              }}
            >
              {!n.target ? fmt(n.totals?.calories ?? null, 0) : over ? `+${fmt(p!.over, 0)}` : fmt(n.remainingCalories, 0)}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {n.target ? `${n.logged ? fmt(n.totals?.calories ?? 0, 0) : 0} / ${fmt(n.target.calories, 0)} kcal eaten` : 'No target set'}
            </Typography>
            {p && (
              <LinearProgress
                variant="determinate"
                value={Math.min(100, p.percent)}
                aria-label={`Calories ${p.percent}% of target`}
                sx={{
                  mt: 1,
                  height: 6,
                  ...trackSx,
                  '& .MuiLinearProgress-bar': {
                    bgcolor: over ? 'warning.main' : nutrientColors.calories,
                  },
                }}
              />
            )}
          </Box>
        </Stack>
        {!n.target && (
          <Typography variant="caption" color="text.secondary">
            <RouterLink to="/settings">Set nutrition targets</RouterLink> to track what's left.
          </Typography>
        )}
        {onQuickAdd && (
          <Button variant="contained" size="large" startIcon={<AddRoundedIcon />} onClick={onQuickAdd} fullWidth sx={{ minHeight: 48, mt: 'auto' }}>
            Add food
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────── Macros ─────────────────────────────

function ThinBar({ label, progress, color }: { label: string; progress: TargetProgress; color: string }) {
  const over = progress.status === 'over';
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={0.5}>
        <Typography variant="caption" fontWeight={700} noWrap>
          {label}
        </Typography>
        <Typography variant="caption" color={over ? 'warning.main' : 'text.secondary'} noWrap>
          <b>{fmt(progress.actual, 0)}</b>/{fmt(progress.target, 0)} g
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, progress.percent)}
        aria-label={`${label} ${progress.percent}% of target${over ? ', over limit' : ''}`}
        sx={{
          mt: 0.5,
          height: 5,
          ...trackSx,
          '& .MuiLinearProgress-bar': {
            bgcolor: over ? 'warning.main' : color,
          },
        }}
      />
    </Box>
  );
}

export function MacrosCard({ d }: { d: Dashboard }) {
  const p = d.nutrition.progress;
  return (
    <DashCard title="Macros" icon={<RestaurantRoundedIcon />} accent={nutrientColors.protein} action={<HeaderLink to={`/diary?date=${d.greeting.date}`}>Diary</HeaderLink>}>
      {!p ? (
        muted('Macro targets appear once a nutrition target is set.')
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            columnGap: 2,
            rowGap: 1.5,
          }}
        >
          <ThinBar label="Protein" progress={p.protein} color={nutrientColors.protein} />
          <ThinBar label="Carbs" progress={p.carbs} color={nutrientColors.carbs} />
          <ThinBar label="Fat" progress={p.fat} color={nutrientColors.fat} />
          <ThinBar label="Fiber" progress={p.fiber} color={nutrientColors.fiber} />
        </Box>
      )}
    </DashCard>
  );
}

// ───────────────────────────── Water ─────────────────────────────

export function WaterCard({ d, onChanged }: { d: Dashboard; onChanged: () => void }) {
  const { notify } = useFeedback();
  const [busy, setBusy] = useState<number | null>(null);
  const w = d.water;
  const canLog = !d.greeting.isFuture;
  const add = async (amountMl: number) => {
    setBusy(amountMl);
    try {
      await api.post('/water', { date: d.greeting.date, amountMl });
      notify(`Added ${amountMl} ml water`);
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not log water', 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <DashCard title="Water" icon={<WaterDropRoundedIcon />} accent={nutrientColors.water} action={<HeaderLink to="/water">Details</HeaderLink>}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="baseline" spacing={0.75}>
            <Typography component="p" fontWeight={800} sx={{ fontSize: 26, lineHeight: 1.15 }}>
              {w.logged ? fmtMl(w.totalMl) : '—'}
            </Typography>
            {w.targetMl != null && (
              <Typography variant="body2" color="text.secondary" noWrap>
                / {fmtMl(w.targetMl)}
              </Typography>
            )}
          </Stack>
          {w.progress && (
            <LinearProgress
              variant="determinate"
              value={Math.min(100, w.progress.percent)}
              aria-label={`Water ${w.progress.percent}% of target`}
              sx={{
                mt: 0.75,
                height: 6,
                ...trackSx,
                '& .MuiLinearProgress-bar': { bgcolor: nutrientColors.water },
              }}
            />
          )}
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }} noWrap>
            {w.logged
              ? w.progress
                ? `${w.progress.percent}% · ${fmtMl(w.progress.remaining)} to go`
                : `${w.entryCount} entries`
              : d.greeting.isFuture
                ? 'Planned day'
                : 'Nothing logged yet'}
          </Typography>
        </Box>
        {canLog && (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {[250, 500].map((ml) => (
              <Button
                key={ml}
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                disabled={busy != null}
                onClick={() => add(ml)}
                aria-label={`Add ${ml} millilitres of water`}
                sx={{
                  minHeight: 44,
                  minWidth: 0,
                  px: 1.25,
                  '& .MuiButton-startIcon': { mr: 0.25 },
                  borderColor: alpha(nutrientColors.water, 0.5),
                  color: nutrientColors.water,
                }}
              >
                {busy === ml ? '…' : `${ml}`}
              </Button>
            ))}
          </Stack>
        )}
      </Stack>
    </DashCard>
  );
}

// ───────────────────────────── Meals (horizontal row) ─────────────────────────────

export function MealsCard({ d }: { d: Dashboard }) {
  const linkTo = `/diary?date=${d.greeting.date}`;
  const done = d.meals.filter((m) => m.status === 'COMPLETED' || m.status === 'LOGGED' || m.status === 'PARTIAL').length;
  return (
    <DashCard
      title={d.meals.length ? `Meals · ${done}/${d.meals.length}` : 'Meals'}
      icon={<RestaurantRoundedIcon />}
      accent={nutrientColors.carbs}
      action={<HeaderLink to={linkTo}>Diary</HeaderLink>}
    >
      {d.meals.length === 0 ? (
        muted(
          <>
            No meal slots yet. <RouterLink to="/meals">Set up your meal plan</RouterLink>.
          </>,
        )
      ) : (
        <Box
          component="ul"
          aria-label="Meals for the day"
          sx={{
            display: 'flex',
            gap: 1,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            listStyle: 'none',
            m: 0,
            p: 0,
            mx: -2,
            px: 2,
            pb: 0.5,
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {d.meals.map((m) => {
            const st = MEAL_STATUS[m.status];
            const filled = m.status !== 'PENDING' && m.status !== 'NOT_LOGGED';
            return (
              <Box component="li" key={m.slotId} sx={{ flex: '0 0 auto', scrollSnapAlign: 'start' }}>
                <ButtonBase
                  component={RouterLink}
                  to={linkTo}
                  aria-label={`${m.name}: ${st.label}${m.calories != null ? `, ${fmt(m.calories, 0)} kcal` : ''}`}
                  sx={{
                    width: 124,
                    minHeight: 92,
                    p: 1.25,
                    borderRadius: '14px',
                    border: 1,
                    borderColor: filled ? 'transparent' : 'divider',
                    bgcolor: (t) => (filled ? alpha(t.palette[st.color === 'default' ? 'primary' : st.color].main, 0.1) : 'transparent'),
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    textAlign: 'left',
                  }}
                >
                  <Box sx={{ width: '100%' }}>
                    <Typography variant="body2" fontWeight={700} noWrap>
                      {m.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {m.calories != null ? `${fmt(m.calories, 0)} kcal` : m.defaultTime ? formatClock(m.defaultTime) : '—'}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={st.label}
                    color={st.color}
                    variant={filled ? 'filled' : 'outlined'}
                    icon={m.status === 'COMPLETED' ? <CheckCircleRoundedIcon /> : undefined}
                    sx={{
                      mt: 1,
                      height: 22,
                      fontSize: 11,
                      pointerEvents: 'none',
                    }}
                  />
                </ButtonBase>
              </Box>
            );
          })}
        </Box>
      )}
    </DashCard>
  );
}

// ───────────────────────────── Workout ─────────────────────────────

export function WorkoutCard({ d }: { d: Dashboard }) {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [starting, setStarting] = useState(false);
  const { workout: w, greeting: g } = d;
  const s = w.session;
  const rest = w.dayType === 'REST' || w.plannedDay?.isRestDay;

  const start = async () => {
    setStarting(true);
    try {
      const session = await api.post<{ id: string }>('/workouts/sessions', {
        date: g.date,
        workoutDayId: w.plannedDay?.id,
      });
      navigate(`/workouts/session/${session.id}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not start workout', 'error');
      setStarting(false);
    }
  };

  let title: string;
  let sub: ReactNode;
  let cta: ReactNode = null;
  let progress: number | null = null;
  if (s) {
    progress = s.totalSets ? Math.round((s.completedSets / s.totalSets) * 100) : s.totalExercises ? Math.round((s.completedExercises / s.totalExercises) * 100) : 0;
    title = s.name;
    sub = `${s.completedExercises}/${s.totalExercises} exercises · ${s.completedSets}/${s.totalSets} sets${s.volumeKg > 0 ? ` · ${fmt(s.volumeKg, 0)} kg` : ''}`;
    const finished = s.status === 'COMPLETED' || s.status === 'SKIPPED';
    cta = (
      <Button
        fullWidth
        size="large"
        variant={finished ? 'outlined' : 'contained'}
        startIcon={finished ? undefined : <PlayArrowRoundedIcon />}
        onClick={() => navigate(`/workouts/session/${s.id}`)}
        sx={{ minHeight: 48 }}
      >
        {finished ? 'View session' : 'Resume workout'}
      </Button>
    );
  } else if (rest) {
    title = 'Rest day';
    sub = 'Recover well — hydrate, stretch and sleep.';
  } else {
    title = w.plannedDay ? w.plannedDay.name : 'Gym day';
    sub = w.plannedDay
      ? `${w.plannedDay.exerciseCount} exercise${w.plannedDay.exerciseCount === 1 ? '' : 's'}${w.plan ? ` · ${w.plan.name}` : ''}`
      : w.plan
        ? `Nothing scheduled in ${w.plan.name} today`
        : 'No active workout plan';
    cta = g.isFuture ? (
      <Typography variant="caption" color="text.secondary">
        Planned — start it on the day.
      </Typography>
    ) : (
      <Button fullWidth size="large" variant="contained" onClick={start} disabled={starting} startIcon={<PlayArrowRoundedIcon />} sx={{ minHeight: 48 }}>
        {starting ? 'Starting…' : 'Start workout'}
      </Button>
    );
  }

  return (
    <DashCard
      title="Workout"
      icon={rest && !s ? <HotelRoundedIcon /> : <FitnessCenterRoundedIcon />}
      accent={nutrientColors.protein}
      action={<HeaderLink to="/workouts">Plans</HeaderLink>}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="p" noWrap sx={{ fontSize: 17 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {sub}
          </Typography>
        </Box>
        {s && <Chip size="small" label={SESSION_STATUS[s.status].label} color={SESSION_STATUS[s.status].color} />}
      </Stack>
      {progress != null && <LinearProgress variant="determinate" value={progress} aria-label={`Workout ${progress}% complete`} sx={{ height: 6, ...trackSx }} />}
      {cta && <Box sx={{ mt: 'auto' }}>{cta}</Box>}
    </DashCard>
  );
}

// ───────────────────────────── Next alarm + overdue ─────────────────────────────

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function countdown(ms: number) {
  if (ms <= 0) return 'due now';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m`;
  return `in ${Math.max(1, Math.floor(ms / 1000))}s`;
}

export function AlarmCard({ d, onExpired }: { d: Dashboard; onExpired: () => void }) {
  const now = useNow(1000);
  const next = d.reminders.next;
  const tz = d.greeting.timezone;
  const msLeft = next ? new Date(next.nextTriggerAt).getTime() - now : null;
  // When the alarm passes, refresh once (a few seconds later, after the scheduler advances it).
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (next && msLeft != null && msLeft < -5000 && refreshedFor.current !== next.nextTriggerAt) {
      refreshedFor.current = next.nextTriggerAt;
      onExpired();
    }
  }, [msLeft, next, onExpired]);
  const overdue = d.reminders.overdue;

  return (
    <Card component="section" aria-label="Next alarm" sx={{ height: '100%' }}>
      <List disablePadding>
        <ListItem disablePadding>
          <ListItemButton component={RouterLink} to="/alarms" sx={{ py: 1.25, px: 2 }}>
            <ListItemAvatar sx={{ minWidth: 46 }}>
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#8B5CF6',
                  bgcolor: alpha('#8B5CF6', 0.12),
                }}
                aria-hidden
              >
                <AlarmRoundedIcon sx={{ fontSize: 20 }} />
              </Box>
            </ListItemAvatar>
            <ListItemText
              primary={next ? next.title : 'No upcoming alarms'}
              secondary={next ? `${formatInstant(next.nextTriggerAt, tz, 'EEE d MMM')} · ${countdown(msLeft ?? 0)}` : 'Tap to create a reminder'}
              slotProps={{
                primary: { noWrap: true, fontWeight: 700 },
                secondary: { noWrap: true },
              }}
              sx={{ minWidth: 0 }}
            />
            {next && (
              <Typography
                component="span"
                fontWeight={800}
                sx={{ fontSize: 22, ml: 1, fontVariantNumeric: 'tabular-nums' }}
                aria-label={`at ${formatInstant(next.nextTriggerAt, tz, 'HH:mm')}`}
              >
                {formatInstant(next.nextTriggerAt, tz, 'HH:mm')}
              </Typography>
            )}
          </ListItemButton>
        </ListItem>
        {overdue.length > 0 && (
          <>
            <Divider component="li" />
            <ListItem disablePadding>
              <ListItemButton component={RouterLink} to="/alarms" sx={{ py: 1, px: 2 }}>
                <WarningAmberRoundedIcon color="warning" sx={{ mr: 1.5, fontSize: 20 }} aria-hidden />
                <ListItemText
                  primary={`${overdue.length} reminder${overdue.length === 1 ? '' : 's'} awaiting action`}
                  secondary={overdue
                    .slice(0, 2)
                    .map((o) => `${formatInstant(o.scheduledFor, tz)} ${o.title}`)
                    .join(' · ')}
                  slotProps={{
                    primary: { variant: 'body2', fontWeight: 700 },
                    secondary: { noWrap: true },
                  }}
                  sx={{ minWidth: 0 }}
                />
                <ChevronRightRoundedIcon color="action" aria-hidden />
              </ListItemButton>
            </ListItem>
          </>
        )}
      </List>
    </Card>
  );
}

// ───────────────────────────── Routine ─────────────────────────────

export function RoutineCard({ d }: { d: Dashboard }) {
  const r = d.routine;
  const tz = d.greeting.timezone;
  // Overdue items first (they need attention), then what's next — 3 rows max.
  const rows = [...r.overdue.map((e) => ({ ...e, late: true })), ...r.upcoming.map((e) => ({ ...e, late: false }))].slice(0, 3);
  return (
    <DashCard
      title="Routine"
      icon={<ViewTimelineRoundedIcon />}
      accent={nutrientColors.fiber}
      dense
      action={
        r.total > 0 ? (
          <Typography variant="body2" fontWeight={700} color="text.secondary" sx={{ mr: 0.5 }}>
            {r.completed}/{r.total}
          </Typography>
        ) : undefined
      }
    >
      {r.total === 0 ? (
        <Box sx={{ pb: 1 }}>
          {muted(
            <>
              No routine items for this day. <RouterLink to="/routine">Build your routine</RouterLink>.
            </>,
          )}
        </Box>
      ) : (
        <>
          <LinearProgress
            variant="determinate"
            value={r.completionPct ?? 0}
            aria-label={`Routine ${r.completionPct ?? 0}% complete`}
            sx={{
              height: 6,
              ...trackSx,
              '& .MuiLinearProgress-bar': { bgcolor: nutrientColors.fiber },
            }}
          />
          {rows.length === 0 ? (
            <Box sx={{ pb: 1 }}>{muted(d.greeting.isPast ? `${r.completionPct ?? 0}% completed this day.` : 'All done for today.')}</Box>
          ) : (
            <List disablePadding sx={{ mx: -2 }}>
              {rows.map((e) => (
                <ListItem key={e.id} disablePadding>
                  <ListItemButton component={RouterLink} to="/routine" sx={{ px: 2, minHeight: 48 }}>
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      color={e.late ? 'warning.main' : 'text.secondary'}
                      sx={{
                        width: 72,
                        flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {e.status === 'SNOOZED' && e.snoozedUntil ? formatInstant(e.snoozedUntil, tz) : formatClock(e.scheduledTime)}
                    </Typography>
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {e.title}
                    </Typography>
                    {e.late ? (
                      <Chip size="small" label="Overdue" color="warning" variant="outlined" sx={{ ml: 1, height: 22 }} />
                    ) : e.status === 'SNOOZED' ? (
                      <Chip size="small" label="Snoozed" color="warning" variant="outlined" sx={{ ml: 1, height: 22 }} />
                    ) : null}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
          {r.overdue.length + r.upcoming.length > rows.length && (
            <Button component={RouterLink} to="/routine" size="small" sx={{ alignSelf: 'flex-start', minHeight: 36 }}>
              {r.overdue.length + r.upcoming.length - rows.length} more
            </Button>
          )}
        </>
      )}
    </DashCard>
  );
}

// ───────────────────────────── Recent activity ─────────────────────────────

const ACTIVITY_ICON: Record<ActivityItem['type'], { icon: ReactNode; color: string }> = {
  food: {
    icon: <RestaurantRoundedIcon fontSize="small" />,
    color: nutrientColors.calories,
  },
  water: {
    icon: <WaterDropRoundedIcon fontSize="small" />,
    color: nutrientColors.water,
  },
  workout: {
    icon: <FitnessCenterRoundedIcon fontSize="small" />,
    color: nutrientColors.protein,
  },
  routine: {
    icon: <ViewTimelineRoundedIcon fontSize="small" />,
    color: nutrientColors.fiber,
  },
  measurement: {
    icon: <MonitorWeightRoundedIcon fontSize="small" />,
    color: nutrientColors.fat,
  },
};

export function ActivityCard({ d }: { d: Dashboard }) {
  const tz = d.greeting.timezone;
  const [all, setAll] = useState(false);
  const items = all ? d.recentActivity : d.recentActivity.slice(0, 5);
  return (
    <DashCard
      title="Recent activity"
      icon={<ViewTimelineRoundedIcon />}
      dense
      action={
        d.recentActivity.length > 5 ? (
          <Button size="small" onClick={() => setAll((v) => !v)} sx={{ mr: -1, minHeight: 36 }} aria-expanded={all}>
            {all ? 'Show less' : 'See all'}
          </Button>
        ) : undefined
      }
    >
      {d.recentActivity.length === 0 ? (
        <Box sx={{ pb: 1 }}>{muted('Nothing logged yet. Food, water, workouts and routine check-ins appear here.')}</Box>
      ) : (
        <List disablePadding sx={{ mx: -2 }}>
          {items.map((a, i) => {
            const meta = ACTIVITY_ICON[a.type];
            return (
              <ListItem key={`${a.type}-${a.id}`} divider={i < items.length - 1} sx={{ px: 2, py: 0.75, minHeight: 52 }}>
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <Box
                    aria-hidden
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      color: meta.color,
                      bgcolor: alpha(meta.color, 0.14),
                    }}
                  >
                    {meta.icon}
                  </Box>
                </ListItemAvatar>
                <ListItemText
                  primary={a.title}
                  secondary={`${formatInstant(a.at, tz, 'd MMM, HH:mm')}${a.detail ? ` · ${a.detail}` : ''}`}
                  slotProps={{
                    primary: {
                      variant: 'body2',
                      fontWeight: 600,
                      noWrap: true,
                    },
                    secondary: { noWrap: true },
                  }}
                  sx={{ my: 0, minWidth: 0 }}
                />
              </ListItem>
            );
          })}
        </List>
      )}
    </DashCard>
  );
}
