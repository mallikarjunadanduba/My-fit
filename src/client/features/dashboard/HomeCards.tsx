import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { alpha, Box, Button, ButtonBase, Card, Chip, CircularProgress, LinearProgress, Stack, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import HotelRoundedIcon from '@mui/icons-material/HotelRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import AlarmRoundedIcon from '@mui/icons-material/AlarmRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import ContrastRoundedIcon from '@mui/icons-material/ContrastRounded';
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useFeedback } from '../../components/common/Feedback';
import { api } from '../../services/api';
import { formatClock, formatDay } from '../../services/dates';
import { brand, nutrientColors } from '../../theme/theme';
import type { Dashboard, MealDayStatus } from '../reports/types';

/**
 * Simple home screen blocks. One question per block:
 *   Hero  — how much can I still eat?     Tiles — water & workout at a glance.
 *   Up next — what's next on my routine?  Meals — which meals are done?   Week — how was my week?
 */

const n0 = (v: number) => Math.round(v).toLocaleString();
const fmtMl = (ml: number) => (ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} L` : `${Math.round(ml)} ml`);

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, px: 0.5 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 800 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

function SeeAll({ to, label = 'See all' }: { to: string; label?: string }) {
  return (
    <Button component={RouterLink} to={to} size="small" endIcon={<ChevronRightRoundedIcon />} sx={{ minHeight: 36, fontWeight: 700 }}>
      {label}
    </Button>
  );
}

// ───────────────────────────── Hero: calories + macros ─────────────────────────────

export function HeroCard({ d, onLogFood }: { d: Dashboard; onLogFood?: () => void }) {
  const n = d.nutrition;
  const target = n.target?.calories ?? null;
  const eaten = n.totals?.calories ?? 0;
  const pct = target ? Math.min(100, Math.round((eaten / target) * 100)) : 0;
  const over = n.progress?.calories.status === 'over';
  const left = n.remainingCalories;

  const macros = [
    { key: 'protein', label: 'Protein', color: '#A5B4FC' },
    { key: 'carbs', label: 'Carbs', color: '#FCD34D' },
    { key: 'fat', label: 'Fat', color: '#F9A8D4' },
    { key: 'fiber', label: 'Fiber', color: '#86EFAC' },
  ] as const;

  return (
    <Card
      sx={{
        border: 'none',
        color: '#fff',
        p: 2.25,
        borderRadius: '24px',
        background: `linear-gradient(145deg, ${brand.navy} 0%, #1D4E6B 55%, ${brand.teal} 140%)`,
        boxShadow: `0 16px 32px ${alpha(brand.navy, 0.28)}`,
      }}
    >
      <Stack direction="row" spacing={2.25} alignItems="center">
        {/* Calories ring */}
        <Box sx={{ position: 'relative', width: 124, height: 124, flexShrink: 0 }}>
          <CircularProgress variant="determinate" value={100} size={124} thickness={4.2} sx={{ color: 'rgba(255,255,255,0.14)', position: 'absolute' }} />
          <CircularProgress
            variant="determinate"
            value={pct}
            size={124}
            thickness={4.2}
            aria-label={`Calories ${pct}% of goal`}
            sx={{ color: over ? brand.warning : '#5EEAD4', position: 'absolute', '& circle': { strokeLinecap: 'round' } }}
          />
          <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0 }}>
            <Typography sx={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{left != null ? n0(Math.abs(left)) : '—'}</Typography>
            <Typography sx={{ fontSize: 12, opacity: 0.8, mt: 0.5 }}>{left != null && left < 0 ? 'kcal over' : 'kcal left'}</Typography>
          </Stack>
        </Box>

        {/* Eaten / goal */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 13, opacity: 0.75 }}>Eaten</Typography>
          <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
            {n.logged ? n0(eaten) : '—'} <Box component="span" sx={{ fontSize: 13, fontWeight: 600, opacity: 0.75 }}>kcal</Box>
          </Typography>
          <Typography sx={{ fontSize: 13, opacity: 0.75, mt: 1 }}>Goal</Typography>
          <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{target != null ? `${n0(target)} kcal` : 'Not set'}</Typography>
          {!n.logged && (
            <Typography sx={{ fontSize: 12, opacity: 0.75, mt: 0.75 }}>{d.greeting.isFuture ? 'Planned day' : 'Nothing logged yet'}</Typography>
          )}
        </Box>
      </Stack>

      {/* Macros */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2, rowGap: 1.25, mt: 2.25 }}>
        {macros.map((m) => {
          const p = n.progress?.[m.key];
          const actual = n.totals?.[m.key] ?? 0;
          const goal = n.target?.[m.key] ?? null;
          return (
            <Box key={m.key}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                <Typography sx={{ fontSize: 12.5, fontWeight: 600, opacity: 0.85 }}>{m.label}</Typography>
                <Typography sx={{ fontSize: 12.5, opacity: 0.85 }}>
                  <b>{n.logged ? Math.round(actual) : '—'}</b>
                  {goal != null ? ` / ${Math.round(goal)} g` : ''}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, p?.percent ?? 0)}
                aria-label={`${m.label} ${p?.percent ?? 0}% of goal`}
                sx={{ mt: 0.5, height: 6, bgcolor: 'rgba(255,255,255,0.14)', '& .MuiLinearProgress-bar': { bgcolor: p?.status === 'over' ? brand.warning : m.color } }}
              />
            </Box>
          );
        })}
      </Box>

      {onLogFood && (
        <Button
          fullWidth
          onClick={onLogFood}
          startIcon={<AddRoundedIcon />}
          sx={{
            mt: 2.25,
            minHeight: 50,
            borderRadius: '14px',
            bgcolor: '#fff',
            color: brand.navy,
            fontSize: 16,
            fontWeight: 800,
            '&:hover': { bgcolor: '#E8FBFB' },
          }}
        >
          Log food
        </Button>
      )}
    </Card>
  );
}

// ───────────────────────────── Tiles: water + workout ─────────────────────────────

function Tile({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <Card sx={{ borderRadius: '18px', height: '100%' }}>
      <ButtonBase
        component="div"
        role="link"
        aria-label={label}
        onClick={onClick}
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', p: 1.75, height: '100%', gap: 1 }}
      >
        {children}
      </ButtonBase>
    </Card>
  );
}

function TileIcon({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Box sx={{ width: 36, height: 36, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.14), color }}>{children}</Box>
  );
}

export function WaterTile({ d, onChanged }: { d: Dashboard; onChanged: () => void }) {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [busy, setBusy] = useState(false);
  const w = d.water;
  const pct = Math.min(100, w.progress?.percent ?? 0);

  const add = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await api.post('/water', { date: d.greeting.date, amountMl: 250 });
      notify('Added 250 ml water');
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not log water', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tile label="Water details" onClick={() => navigate(`/water?date=${d.greeting.date}`)}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <TileIcon color={nutrientColors.water}>
          <WaterDropRoundedIcon fontSize="small" />
        </TileIcon>
        {!d.greeting.isFuture && (
          <Button
            size="small"
            variant="contained"
            disableElevation
            onClick={add}
            disabled={busy}
            aria-label="Add 250 millilitres of water"
            sx={{ minWidth: 0, minHeight: 34, px: 1.25, borderRadius: '999px', bgcolor: nutrientColors.water, '&:hover': { bgcolor: '#0284C7' } }}
          >
            {busy ? '…' : '+250'}
          </Button>
        )}
      </Stack>
      <Box>
        <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{w.logged && w.totalMl != null ? fmtMl(w.totalMl) : '—'}</Typography>
        <Typography variant="caption" color="text.secondary">
          {w.targetMl != null ? `of ${fmtMl(w.targetMl)} water` : 'Water'}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        aria-label={`Water ${pct}% of goal`}
        sx={{ height: 6, bgcolor: alpha(nutrientColors.water, 0.12), '& .MuiLinearProgress-bar': { bgcolor: nutrientColors.water } }}
      />
    </Tile>
  );
}

export function WorkoutTile({ d }: { d: Dashboard }) {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [starting, setStarting] = useState(false);
  const { workout: w, greeting: g } = d;
  const s = w.session;
  const rest = !s && (w.dayType === 'REST' || w.plannedDay?.isRestDay);
  const color = rest ? '#64748B' : nutrientColors.protein;

  const start = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (s) return navigate(`/workouts/session/${s.id}`);
    setStarting(true);
    try {
      const session = await api.post<{ id: string }>('/workouts/sessions', { date: g.date, workoutDayId: w.plannedDay?.id });
      navigate(`/workouts/session/${session.id}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not start workout', 'error');
      setStarting(false);
    }
  };

  const finished = s && (s.status === 'COMPLETED' || s.status === 'SKIPPED');
  const title = s ? s.name : rest ? 'Rest day' : (w.plannedDay?.name ?? 'Workout');
  const sub = s
    ? finished
      ? s.status === 'COMPLETED'
        ? 'Done — great job!'
        : 'Skipped'
      : `${s.completedSets}/${s.totalSets} sets`
    : rest
      ? 'Recover & stretch'
      : w.plannedDay
        ? `${w.plannedDay.exerciseCount} exercises`
        : 'No plan today';
  const pct = s && s.totalSets ? Math.round((s.completedSets / s.totalSets) * 100) : finished ? 100 : 0;
  const canAct = !g.isFuture && !rest && !finished && (s || w.plannedDay);

  return (
    <Tile label="Workouts" onClick={() => navigate(s ? `/workouts/session/${s.id}` : '/workouts')}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <TileIcon color={color}>{rest ? <HotelRoundedIcon fontSize="small" /> : <FitnessCenterRoundedIcon fontSize="small" />}</TileIcon>
        {canAct && (
          <Button
            size="small"
            variant="contained"
            disableElevation
            onClick={start}
            disabled={starting}
            startIcon={<PlayArrowRoundedIcon />}
            sx={{ minWidth: 0, minHeight: 34, px: 1.25, borderRadius: '999px', bgcolor: color, '& .MuiButton-startIcon': { mr: 0.25 } }}
          >
            {starting ? '…' : s ? 'Resume' : 'Start'}
          </Button>
        )}
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25 }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {sub}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={rest ? 0 : pct}
        aria-label={`Workout ${pct}% complete`}
        sx={{ height: 6, bgcolor: alpha(color, 0.12), '& .MuiLinearProgress-bar': { bgcolor: color } }}
      />
    </Tile>
  );
}

// ───────────────────────────── Up next ─────────────────────────────

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function inLabel(ms: number) {
  if (ms <= 60_000) return 'now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `in ${h} h ${rest} min` : `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}

export function UpNextCard({ d, onExpired }: { d: Dashboard; onExpired: () => void }) {
  const navigate = useNavigate();
  const now = useNow(30_000);
  const next = d.reminders.next;
  const overdue = d.reminders.overdue.length + d.routine.overdue.length;
  const due = next ? new Date(next.nextTriggerAt).getTime() - now : null;

  useEffect(() => {
    if (due != null && due < -60_000) onExpired();
  }, [due, onExpired]);

  return (
    <Card sx={{ borderRadius: '18px' }}>
      <ButtonBase
        component="div"
        role="link"
        aria-label="Open alarms"
        onClick={() => navigate('/alarms')}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.75, width: '100%', textAlign: 'left' }}
      >
        <TileIcon color={brand.warning}>
          <AlarmRoundedIcon fontSize="small" />
        </TileIcon>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.04em' }}>
            UP NEXT
          </Typography>
          <Typography noWrap sx={{ fontWeight: 800, fontSize: 16, lineHeight: 1.25 }}>
            {next ? next.title : 'All clear for today'}
          </Typography>
          {next && (
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {formatClock(next.time)} · {due != null ? inLabel(due) : ''}
            </Typography>
          )}
        </Box>
        {overdue > 0 ? (
          <Chip size="small" color="warning" label={`${overdue} overdue`} sx={{ fontWeight: 700 }} />
        ) : (
          <ChevronRightRoundedIcon color="action" />
        )}
      </ButtonBase>
    </Card>
  );
}

// ───────────────────────────── Meals checklist ─────────────────────────────

const MEAL_ICON: Record<MealDayStatus, { icon: ReactNode; label: string }> = {
  COMPLETED: { icon: <CheckCircleRoundedIcon sx={{ color: 'primary.main' }} />, label: 'Done' },
  LOGGED: { icon: <CheckCircleRoundedIcon sx={{ color: 'primary.main' }} />, label: 'Logged' },
  PARTIAL: { icon: <ContrastRoundedIcon sx={{ color: 'warning.main' }} />, label: 'Partly' },
  SKIPPED: { icon: <RemoveCircleOutlineRoundedIcon sx={{ color: 'text.disabled' }} />, label: 'Skipped' },
  PENDING: { icon: <RadioButtonUncheckedRoundedIcon sx={{ color: 'text.disabled' }} />, label: 'To do' },
  NOT_LOGGED: { icon: <RadioButtonUncheckedRoundedIcon sx={{ color: 'text.disabled' }} />, label: 'Not logged' },
};

export function MealsList({ d }: { d: Dashboard }) {
  const navigate = useNavigate();
  const done = d.meals.filter((m) => ['COMPLETED', 'LOGGED', 'PARTIAL'].includes(m.status)).length;
  return (
    <Section title={`Meals · ${done}/${d.meals.length}`} action={<SeeAll to={`/diary?date=${d.greeting.date}`} label="Diary" />}>
      <Card sx={{ borderRadius: '18px' }}>
        {d.meals.map((m, i) => {
          const s = MEAL_ICON[m.status];
          return (
            <ButtonBase
              key={m.slotId}
              component="div"
              role="link"
              aria-label={`${m.name}: ${s.label}`}
              onClick={() => navigate(`/diary?date=${d.greeting.date}`)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                width: '100%',
                px: 1.75,
                py: 1.25,
                minHeight: 52,
                textAlign: 'left',
                borderTop: i ? 1 : 0,
                borderColor: 'divider',
              }}
            >
              {s.icon}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 700, fontSize: 15 }}>
                  {m.name}
                </Typography>
                {m.defaultTime && (
                  <Typography variant="caption" color="text.secondary">
                    {formatClock(m.defaultTime)}
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" color={m.calories != null ? 'text.primary' : 'text.disabled'} sx={{ fontWeight: 700 }}>
                {m.calories != null ? `${n0(m.calories)} kcal` : s.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Card>
    </Section>
  );
}

// ───────────────────────────── Week strip ─────────────────────────────

export function WeekStrip({ d }: { d: Dashboard }) {
  const days = d.weekly.days;
  const max = Math.max(1, ...days.map((p) => Math.max(p.calories ?? 0, p.calorieTarget ?? 0)));
  const logged = days.filter((p) => !p.future && p.foodLogged).length;
  const workouts = days.filter((p) => p.workoutStatus === 'COMPLETED').length;
  return (
    <Section title="This week" action={<SeeAll to="/reports" label="Reports" />}>
      <Card sx={{ borderRadius: '18px', p: 1.75 }}>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.25 }}>
          Food logged {logged} of 7 days · {workouts} workout{workouts === 1 ? '' : 's'}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, alignItems: 'end' }} role="list" aria-label="Calories per day this week">
          {days.map((p) => {
            const isSelected = p.date === d.greeting.date;
            const h = p.calories != null ? Math.max(6, Math.round((p.calories / max) * 72)) : 6;
            const over = p.calories != null && p.calorieMax != null && p.calories > p.calorieMax;
            const color = p.calories == null ? 'action.disabledBackground' : over ? 'warning.main' : 'primary.main';
            return (
              <Stack key={p.date} alignItems="center" spacing={0.75} role="listitem" aria-label={`${formatDay(p.date, 'EEEE')}: ${p.calories != null ? `${n0(p.calories)} kcal` : 'not logged'}`}>
                <Box sx={{ height: 72, display: 'flex', alignItems: 'flex-end' }}>
                  <Box sx={{ width: 18, height: h, borderRadius: '6px', bgcolor: color }} />
                </Box>
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 800,
                    bgcolor: isSelected ? 'secondary.main' : 'transparent',
                    color: isSelected ? 'background.paper' : p.future ? 'text.disabled' : 'text.secondary',
                  }}
                >
                  {formatDay(p.date, 'EEEEE')}
                </Box>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: p.workoutStatus === 'COMPLETED' ? nutrientColors.protein : 'transparent' }} />
              </Stack>
            );
          })}
        </Box>
      </Card>
    </Section>
  );
}
