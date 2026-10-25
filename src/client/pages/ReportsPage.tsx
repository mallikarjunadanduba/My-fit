import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  Chip,
  Collapse,
  Grid,
  IconButton,
  LinearProgress,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import TrendingFlatRoundedIcon from '@mui/icons-material/TrendingFlatRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState, ErrorState } from '../components/common/States';
import { useAuth } from '../features/auth/AuthContext';
import { shiftMonth } from '../features/history/CalendarTab';
import { MacroStackChart, MetricBarChart, WeightChart } from '../features/reports/charts';
import { ExportDialog } from '../features/reports/ExportPanel';
import { usePhone } from '../components/common/mobile';
import { fmt, fmtMl, fmtPct, scoreColor } from '../features/reports/format';
import type { PeriodReport } from '../features/reports/types';
import { useAsync } from '../hooks/useAsync';
import { api } from '../services/api';
import { formatDay, shiftDate, todayIn } from '../services/dates';
import { nutrientColors } from '../theme/theme';

type Kind = 'weekly' | 'monthly';

function Kpi({ label, value, sub, color, progress }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; progress?: number | null }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent
        sx={{
          p: { xs: 1.5, md: 2 },
          '&:last-child': { pb: { xs: 1.5, md: 2 } },
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center">
          {color && (
            <Box
              aria-hidden
              sx={{
                width: 8,
                height: 8,
                borderRadius: '2px',
                bgcolor: color,
                flexShrink: 0,
              }}
            />
          )}
          <Typography variant="caption" color="text.secondary" fontWeight={600} noWrap>
            {label}
          </Typography>
        </Stack>
        <Typography component="p" fontWeight={800} sx={{ mt: 0.25, fontSize: { xs: 20, md: 24 }, lineHeight: 1.25 }} noWrap>
          {value}
        </Typography>
        {progress != null && (
          <LinearProgress
            variant="determinate"
            value={Math.min(100, progress)}
            aria-label={`${label} ${Math.round(progress)}%`}
            sx={{
              my: 0.75,
              height: 5,
              bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(21,34,56,0.06)'),
              '& .MuiLinearProgress-bar': color ? { bgcolor: color } : undefined,
            }}
          />
        )}
        {sub && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: 1.35,
            }}
          >
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card sx={{ height: '100%' }} component="section" aria-label={title}>
      <CardContent>
        <Typography variant="subtitle1" component="h2">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
            {subtitle}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

const vsTarget = (avg: number | null, target: number | null, unit: string, pct: number | null) =>
  avg == null ? 'No logged days' : target == null ? 'No target set' : `${fmtPct(pct)} of ${fmt(target, 0)} ${unit}`;

/** Collapsible list of elapsed days with no food log (tap a day to open the diary). */
function MissingDays({ r }: { r: PeriodReport }) {
  const [open, setOpen] = useState(false);
  const n = r.missingLogDates.length;
  return (
    <Card component="section" aria-label="Days missing food logs">
      <ButtonBase
        onClick={() => setOpen((v) => !v)}
        disabled={n === 0}
        aria-expanded={open}
        sx={{
          width: '100%',
          textAlign: 'left',
          px: 2,
          py: 1.5,
          minHeight: 56,
          display: 'flex',
          gap: 1,
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2">
            Days missing food logs
          </Typography>
          <Typography variant="caption" color={n ? 'text.secondary' : 'success.main'}>
            {n ? `${n} of ${r.daysElapsed} elapsed days` : r.daysElapsed ? 'Every elapsed day has a food log' : 'This period has not started yet'}
          </Typography>
        </Box>
        {n > 0 && (
          <ExpandMoreRoundedIcon
            sx={{
              transition: 'transform .2s',
              transform: open ? 'rotate(180deg)' : 'none',
              color: 'text.secondary',
            }}
          />
        )}
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ px: 2, pb: 2 }}>
          {r.missingLogDates.map((d) => (
            <Chip key={d} variant="outlined" clickable component={RouterLink} to={`/diary?date=${d}`} label={formatDay(d, 'EEE d MMM')} sx={{ height: 36 }} />
          ))}
        </Stack>
      </Collapse>
    </Card>
  );
}

function ReportBody({ r }: { r: PeriodReport }) {
  const phone = usePhone();
  const a = r.averages;
  const t = r.averageTargets;
  const monthly = r.kind === 'monthly';
  const labelPattern = monthly ? 'd' : 'EEE';
  const anyFood = r.daysWithFoodLogs > 0;
  const weightIcon =
    r.weight.change == null ? null : r.weight.change < 0 ? (
      <TrendingDownRoundedIcon fontSize="small" />
    ) : r.weight.change > 0 ? (
      <TrendingUpRoundedIcon fontSize="small" />
    ) : (
      <TrendingFlatRoundedIcon fontSize="small" />
    );

  return (
    <Stack spacing={2}>
      <Typography variant="caption" color="text.secondary">
        {r.daysElapsed < r.daysInPeriod ? `${r.daysElapsed}/${r.daysInPeriod} days elapsed · ` : ''}
        Averages over {r.loggedDays.food} day
        {r.loggedDays.food === 1 ? '' : 's'} with food logs ({r.loggedDays.water} with water) — missing days aren't zeros.
      </Typography>

      <Grid container spacing={{ xs: 1.5, md: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg calories"
            color={nutrientColors.calories}
            value={a.calories != null ? `${fmt(a.calories, 0)} kcal` : '—'}
            progress={r.vsTargetPct.calories}
            sub={vsTarget(a.calories, t.calories, 'kcal', r.vsTargetPct.calories)}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg protein"
            color={nutrientColors.protein}
            value={a.protein != null ? `${fmt(a.protein)} g` : '—'}
            progress={r.vsTargetPct.protein}
            sub={vsTarget(a.protein, t.protein, 'g', r.vsTargetPct.protein)}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg carbs"
            color={nutrientColors.carbs}
            value={a.carbs != null ? `${fmt(a.carbs)} g` : '—'}
            progress={r.vsTargetPct.carbs}
            sub={vsTarget(a.carbs, t.carbs, 'g', r.vsTargetPct.carbs)}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg fat"
            color={nutrientColors.fat}
            value={a.fat != null ? `${fmt(a.fat)} g` : '—'}
            progress={r.vsTargetPct.fat}
            sub={vsTarget(a.fat, t.fat, 'g', r.vsTargetPct.fat)}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg fiber"
            color={nutrientColors.fiber}
            value={a.fiber != null ? `${fmt(a.fiber)} g` : '—'}
            progress={r.vsTargetPct.fiber}
            sub={vsTarget(a.fiber, t.fiber, 'g', r.vsTargetPct.fiber)}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg water"
            color={nutrientColors.water}
            value={fmtMl(a.waterMl)}
            progress={r.vsTargetPct.waterMl}
            sub={a.waterMl == null ? 'No logged days' : `${fmtPct(r.vsTargetPct.waterMl)} of ${fmtMl(t.waterMl)}`}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Workouts"
            value={`${r.workoutsCompleted}`}
            progress={r.workoutConsistencyPct}
            sub={r.plannedGymDays ? `${r.gymDaysWithWorkout}/${r.plannedGymDays} gym days` : 'No gym days yet'}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi label="Calorie range" value={anyFood ? `${r.daysWithinCalorieRange}/${r.daysWithFoodLogs}` : '—'} sub="Logged days in range" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi label="Meal adherence" value={fmtPct(r.mealAdherencePct)} progress={r.mealAdherencePct} sub="Meals completed" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Routine"
            value={fmtPct(r.routineCompletionPct)}
            progress={r.routineCompletionPct}
            sub={r.routineCompletionPct == null ? 'No routine entries' : 'Items done'}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Weight change"
            value={
              r.weight.change == null ? (
                '—'
              ) : (
                <Stack direction="row" spacing={0.5} alignItems="center" component="span">
                  {weightIcon}
                  <span>
                    {r.weight.change > 0 ? '+' : ''}
                    {fmt(r.weight.change)} kg
                  </span>
                </Stack>
              )
            }
            sub={
              r.weight.first && r.weight.last
                ? `${fmt(r.weight.first.weightKg)} → ${fmt(r.weight.last.weightKg)} kg`
                : r.weight.series.length === 1
                  ? `One reading: ${fmt(r.weight.series[0].weightKg)} kg`
                  : 'No weigh-ins'
            }
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Kpi
            label="Avg day score"
            value={r.averageScore != null ? Math.round(r.averageScore) : '—'}
            color={r.averageScore != null ? scoreColor(r.averageScore) : undefined}
            progress={r.averageScore}
            sub="Across elapsed days"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard title="Daily calories" subtitle="Logged vs target (dashed) and range (band).">
            <MetricBarChart
              name="Calories"
              unit="kcal"
              color={nutrientColors.calories}
              showBand
              labelPattern={labelPattern}
              ariaLabel={`Bar chart of daily calories from ${formatDay(r.from)} to ${formatDay(r.to)} against the target range`}
              points={r.series.map((p) => ({
                date: p.date,
                value: p.calories,
                target: p.calorieTarget,
                min: p.calorieMin,
                max: p.calorieMax,
                future: p.future,
              }))}
            />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard title="Macro split" subtitle="kcal from protein, carbs (4/g) and fat (9/g).">
            <MacroStackChart
              labelPattern={labelPattern}
              points={r.series.map((p) => ({
                date: p.date,
                protein: p.protein,
                carbs: p.carbs,
                fat: p.fat,
                future: p.future,
              }))}
            />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard title="Water" subtitle="Daily intake against the water target.">
            <MetricBarChart
              name="Water"
              unit="ml"
              color={nutrientColors.water}
              labelPattern={labelPattern}
              ariaLabel={`Bar chart of daily water intake from ${formatDay(r.from)} to ${formatDay(r.to)}`}
              points={r.series.map((p) => ({
                date: p.date,
                value: p.waterMl,
                target: p.waterTarget,
                future: p.future,
              }))}
            />
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <ChartCard title="Weight trend" subtitle="Last weigh-in of each day.">
            {r.weight.series.length >= 2 ? (
              <WeightChart series={r.weight.series} />
            ) : phone ? (
              <Typography variant="body2" color="text.secondary">
                {r.weight.series.length ? 'Only one weigh-in this period. ' : 'No weigh-ins this period. '}
                <RouterLink to="/measurements">Record a measurement</RouterLink>
              </Typography>
            ) : (
              <EmptyState
                title={r.weight.series.length ? 'Only one weigh-in this period' : 'No weigh-ins this period'}
                description={<RouterLink to="/measurements">Record a body measurement</RouterLink>}
              />
            )}
          </ChartCard>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChartCard title="Most consistent days" subtitle="Weekdays ranked by average completion score.">
            {r.mostConsistentWeekdays.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Not enough data yet.
              </Typography>
            ) : (
              <Stack spacing={1} component="ol" sx={{ p: 0, m: 0, listStyle: 'none' }}>
                {r.mostConsistentWeekdays.map((w) => (
                  <Stack key={w.weekday} component="li" direction="row" spacing={1.5} alignItems="center">
                    <Typography variant="body2" fontWeight={700} sx={{ width: 20 }} color="text.secondary">
                      {w.rank}
                    </Typography>
                    <Typography variant="body2" sx={{ width: { xs: 40, sm: 96 } }}>
                      {phone ? w.label.slice(0, 3) : w.label}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={w.averageScore}
                      aria-label={`${w.label} average score ${Math.round(w.averageScore)}`}
                      sx={{
                        flex: 1,
                        height: 8,
                        '& .MuiLinearProgress-bar': {
                          bgcolor: scoreColor(w.averageScore),
                        },
                      }}
                    />
                    <Typography variant="body2" fontWeight={700} sx={{ width: 36, textAlign: 'right' }}>
                      {Math.round(w.averageScore)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 44, textAlign: 'right' }}>
                      {w.days} day{w.days === 1 ? '' : 's'}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </ChartCard>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <MissingDays r={r} />
        </Grid>
      </Grid>
    </Stack>
  );
}

export default function ReportsPage() {
  const { timezone } = useAuth();
  const today = todayIn(timezone);
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('view') === 'monthly' ? 'monthly' : 'weekly';
  const [anchor, setAnchor] = useState(today);
  const month = anchor.slice(0, 7);

  const phone = usePhone();
  const [exportOpen, setExportOpen] = useState(false);
  const { data, error, loading, refreshing, reload } = useAsync(
    () => (kind === 'weekly' ? api.get<PeriodReport>('/reports/weekly', { date: anchor }) : api.get<PeriodReport>('/reports/monthly', { month })),
    [kind, kind === 'weekly' ? anchor : month],
  );

  const shift = (dir: 1 | -1) => setAnchor(kind === 'weekly' ? shiftDate(anchor, 7 * dir) : `${shiftMonth(month, dir)}-01`);
  const nextDisabled =
    kind === 'weekly' ? shiftDate(anchor, 7) > shiftDate(today, 6 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)) : shiftMonth(month, 1) > today.slice(0, 7);
  const periodLabel =
    data && data.kind === kind
      ? kind === 'weekly'
        ? `${formatDay(data.from, 'd MMM')} – ${formatDay(data.to, 'd MMM')}`
        : formatDay(data.from, 'MMMM yyyy')
      : kind === 'weekly'
        ? 'Week'
        : formatDay(`${month}-01`, 'MMMM yyyy');
  const fresh = data && data.kind === kind && (kind === 'monthly' ? data.from.slice(0, 7) === month : anchor >= data.from && anchor <= data.to);

  return (
    <Box>
      <PageHeader
        title="Reports"
        subtitle={phone ? undefined : 'Averages, adherence and trends — against the targets in force each day.'}
        actions={
          phone ? undefined : (
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => setExportOpen(true)} sx={{ minHeight: 40 }}>
              Export
            </Button>
          )
        }
      />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <ToggleButtonGroup
          exclusive
          fullWidth={phone}
          size={phone ? 'medium' : 'small'}
          value={kind}
          onChange={(_, v: Kind | null) =>
            v &&
            setParams(v === 'monthly' ? { view: 'monthly' } : {}, {
              replace: true,
            })
          }
          aria-label="Report period"
          sx={{
            flex: phone ? 1 : undefined,
            '& .MuiToggleButton-root': { minHeight: 44, fontWeight: 700 },
          }}
        >
          <ToggleButton value="weekly">Weekly</ToggleButton>
          <ToggleButton value="monthly">Monthly</ToggleButton>
        </ToggleButtonGroup>
        {phone && (
          <IconButton
            aria-label="Export data"
            onClick={() => setExportOpen(true)}
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: '12px',
              width: 48,
              height: 46,
            }}
          >
            <DownloadRoundedIcon />
          </IconButton>
        )}
      </Stack>
      <Stack direction="row" alignItems="center" justifyContent={phone ? 'space-between' : 'flex-start'} spacing={1} sx={{ mb: 1.5 }}>
        <Tooltip title={kind === 'weekly' ? 'Previous week' : 'Previous month'}>
          <IconButton aria-label={kind === 'weekly' ? 'Previous week' : 'Previous month'} onClick={() => shift(-1)}>
            <ChevronLeftIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ textAlign: 'center', minWidth: { md: 200 } }}>
          <Typography variant="subtitle1" component="h2" aria-live="polite" sx={{ lineHeight: 1.3 }}>
            {periodLabel}
          </Typography>
          {anchor !== today ? (
            <Button size="small" onClick={() => setAnchor(today)} sx={{ minHeight: 28, py: 0 }}>
              {kind === 'weekly' ? 'Back to this week' : 'Back to this month'}
            </Button>
          ) : (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ minHeight: 28, lineHeight: '28px' }}>
              {refreshing ? 'Updating…' : kind === 'weekly' ? 'This week' : 'This month'}
            </Typography>
          )}
        </Box>
        <Tooltip title={kind === 'weekly' ? 'Next week' : 'Next month'}>
          <span>
            <IconButton aria-label={kind === 'weekly' ? 'Next week' : 'Next month'} onClick={() => shift(1)} disabled={nextDisabled}>
              <ChevronRightIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data || (loading && !fresh) ? (
        <Grid container spacing={2} aria-busy="true" aria-label="Loading report">
          {Array.from({ length: 8 }).map((_, i) => (
            <Grid key={i} size={{ xs: 6, md: 3 }}>
              <Skeleton variant="rounded" height={96} />
            </Grid>
          ))}
          {Array.from({ length: 2 }).map((_, i) => (
            <Grid key={`c${i}`} size={{ xs: 12, lg: 6 }}>
              <Skeleton variant="rounded" height={260} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Box>
          <ReportBody r={data} />
        </Box>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        defaultFrom={data?.from ?? shiftDate(today, -29)}
        defaultTo={data ? (data.to < today ? data.to : today) : today}
      />
    </Box>
  );
}
