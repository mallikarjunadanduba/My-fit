import { Link as RouterLink } from 'react-router-dom';
import { Box, CircularProgress, LinearProgress, Link, Stack, Typography } from '@mui/material';
import type { TargetProgress } from '../../../shared/nutrition';
import { nutrientColors } from '../../theme/theme';
import { fmt } from '../foods/format';
import type { DiaryDay } from './types';

const track = (t: { palette: { mode: string } }) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(21,34,56,0.07)');

/** Calories ring: big number in the middle, coloured arc for % of target (amber when over the upper limit). */
export function CalorieRing({ kcal, progress, size = 96 }: { kcal: number | null; progress: TargetProgress | null; size?: number }) {
  const pct = progress ? Math.min(100, progress.percent) : 0;
  const over = progress?.status === 'over';
  return (
    <Box
      sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
      role="img"
      aria-label={kcal == null ? 'No calories logged' : `${fmt(kcal, 0)} kcal${progress ? `, ${progress.percent}% of ${fmt(progress.target, 0)}` : ''}`}
    >
      <CircularProgress variant="determinate" value={100} size={size} thickness={4.5} sx={{ position: 'absolute', inset: 0, color: track }} aria-hidden />
      <CircularProgress
        variant="determinate"
        value={pct}
        size={size}
        thickness={4.5}
        sx={{
          position: 'absolute',
          inset: 0,
          color: over ? 'warning.main' : nutrientColors.calories,
          '& circle': { strokeLinecap: 'round' },
        }}
        aria-hidden
      />
      <Stack sx={{ position: 'absolute', inset: 0 }} alignItems="center" justifyContent="center">
        <Typography sx={{ fontSize: size > 90 ? 24 : 20, fontWeight: 800, lineHeight: 1 }}>{kcal == null ? '—' : fmt(kcal, 0)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
          kcal
        </Typography>
      </Stack>
    </Box>
  );
}

export function MacroBar({ label, color, progress, actual }: { label: string; color: string; progress: TargetProgress | null; actual: number | null }) {
  const over = progress?.status === 'over';
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" fontWeight={700} sx={{ color, display: 'block', lineHeight: 1.4 }} noWrap>
        {label}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={progress ? Math.min(100, progress.percent) : 0}
        aria-label={`${label} ${progress ? `${progress.percent}% of target` : 'no target'}`}
        sx={{
          height: 6,
          my: 0.5,
          bgcolor: track,
          '& .MuiLinearProgress-bar': {
            bgcolor: over ? 'warning.main' : color,
          },
        }}
      />
      <Typography variant="caption" color={over ? 'warning.main' : 'text.secondary'} noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
        <Box
          component="span"
          sx={{
            color: over ? 'warning.main' : 'text.primary',
            fontWeight: 700,
          }}
        >
          {actual == null ? '—' : fmt(actual, 0)}
        </Box>
        {progress ? ` / ${fmt(progress.target, 0)} g` : ' g'}
      </Typography>
    </Box>
  );
}

/** Numbers-first daily summary: calories ring + remaining, and protein/carbs/fat bars in one compact block. */
export function DaySummary({ day }: { day: DiaryDay }) {
  const { totals, progress, target } = day;
  const cal = progress?.calories ?? null;
  const left = cal ? (cal.status === 'over' ? `${fmt(cal.over, 0)} over` : `${fmt(cal.remaining, 0)} left`) : null;
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <CalorieRing kcal={totals?.calories ?? null} progress={cal} />
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {target && left ? (
            <>
              <Box
                component="span"
                sx={{
                  color: cal?.status === 'over' ? 'warning.main' : 'text.primary',
                  fontWeight: 700,
                }}
              >
                {left}
              </Box>{' '}
              of {fmt(target.calories, 0)} kcal
            </>
          ) : target ? (
            `Target ${fmt(target.calories, 0)} kcal`
          ) : (
            <>
              No target ·{' '}
              <Link component={RouterLink} to="/settings">
                set one
              </Link>
            </>
          )}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1.25,
          }}
        >
          <MacroBar label="Protein" color={nutrientColors.protein} progress={progress?.protein ?? null} actual={totals?.protein ?? null} />
          <MacroBar label="Carbs" color={nutrientColors.carbs} progress={progress?.carbs ?? null} actual={totals?.carbs ?? null} />
          <MacroBar label="Fat" color={nutrientColors.fat} progress={progress?.fat ?? null} actual={totals?.fat ?? null} />
        </Box>
        <Typography variant="caption" color="text.secondary" noWrap>
          Fiber{' '}
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>
            {totals ? fmt(totals.fiber, 0) : '—'}
          </Box>
          {target ? ` / ${fmt(target.fiber, 0)} g` : ' g'}
        </Typography>
      </Stack>
    </Stack>
  );
}
