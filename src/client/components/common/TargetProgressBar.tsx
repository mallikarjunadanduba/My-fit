import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import type { TargetProgress } from '../../../shared/nutrition';

/**
 * Labeled progress bar for a nutrient/water target.
 * Shows actual / target, remaining, and a warning when the upper bound is exceeded.
 */
export function TargetProgressBar({
  label,
  progress,
  unit,
  color,
}: {
  label: string;
  progress: TargetProgress;
  unit: string;
  color: string;
}) {
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
  const range = progress.min != null && progress.max != null ? ` (range ${fmt(progress.min)}–${fmt(progress.max)} ${unit})` : '';
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {progress.status === 'over' && (
            <Tooltip title={`${fmt(progress.over)} ${unit} over your upper limit`}>
              <WarningAmberRoundedIcon color="warning" sx={{ fontSize: 18 }} aria-label="Over target" />
            </Tooltip>
          )}
          <Typography variant="body2" color="text.secondary">
            <b>{fmt(progress.actual)}</b> / {fmt(progress.target)} {unit}
          </Typography>
        </Stack>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, progress.percent)}
        aria-label={`${label} ${progress.percent}% of target${range}`}
        sx={{
          bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(21,34,56,0.06)'),
          '& .MuiLinearProgress-bar': { bgcolor: progress.status === 'over' ? 'warning.main' : color },
        }}
      />
      <Typography variant="caption" color={progress.status === 'over' ? 'warning.main' : 'text.secondary'}>
        {progress.status === 'over'
          ? `${fmt(progress.over)} ${unit} over limit`
          : `${fmt(progress.remaining)} ${unit} remaining · ${progress.percent}%`}
      </Typography>
    </Box>
  );
}
