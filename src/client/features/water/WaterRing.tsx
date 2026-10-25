import { Box, CircularProgress, Typography } from '@mui/material';
import { nutrientColors } from '../../theme/theme';
import { fmtMl } from './types';

/** Large circular progress for the day's water intake. */
export function WaterRing({ totalMl, targetMl, size = 200 }: { totalMl: number | null; targetMl: number | null; size?: number }) {
  const pct = totalMl != null && targetMl ? Math.round((totalMl / targetMl) * 100) : 0;
  return (
    <Box
      sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}
      role="img"
      aria-label={totalMl == null ? 'No water logged yet' : `${totalMl} ml of ${targetMl ?? '?'} ml, ${pct}%`}
    >
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={4}
        sx={{
          position: 'absolute',
          inset: 0,
          color: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(21,34,56,0.07)'),
        }}
        aria-hidden
      />
      <CircularProgress
        variant="determinate"
        value={Math.min(100, pct)}
        size={size}
        thickness={4}
        sx={{
          position: 'absolute',
          inset: 0,
          color: nutrientColors.water,
          '& .MuiCircularProgress-circle': { strokeLinecap: 'round' },
        }}
        aria-hidden
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {totalMl == null ? (
          <>
            <Typography variant="h5" component="p" color="text.secondary">
              —
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Nothing logged yet
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="h4" component="p">
              {fmtMl(totalMl)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {targetMl ? `of ${fmtMl(targetMl)} · ${pct}%` : 'no target set'}
            </Typography>
          </>
        )}
      </Box>
    </Box>
  );
}
