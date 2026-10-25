import { Box, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import type { CompletionScore } from '../reports/types';
import { scoreColor, scoreLabel } from '../reports/format';

/** Circular 0–100 completion score with a per-component breakdown tooltip. */
export function ScoreRing({ score, size = 132 }: { score: CompletionScore; size?: number }) {
  const color = scoreColor(score.score);
  const breakdown = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="caption" fontWeight={700} component="div" sx={{ mb: 0.5 }}>
        How today is scored
      </Typography>
      {score.components.map((c) => (
        <Stack key={c.key} direction="row" justifyContent="space-between" spacing={2}>
          <Typography variant="caption">{c.label}</Typography>
          <Typography variant="caption" fontWeight={700}>
            {c.points} / {c.maxPoints}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
  return (
    <Tooltip title={breakdown} arrow placement="bottom">
      <Box
        tabIndex={0}
        role="img"
        aria-label={`Completion score ${score.score} out of 100 (${scoreLabel(score.score)}). ${score.components
          .map((c) => `${c.label}: ${c.points} of ${c.maxPoints} points`)
          .join('; ')}`}
        sx={{
          position: 'relative',
          width: size,
          height: size,
          display: 'inline-flex',
          borderRadius: '50%',
          '&:focus-visible': {
            outline: 2,
            outlineColor: 'primary.main',
            outlineStyle: 'solid',
            outlineOffset: 4,
          },
        }}
      >
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={4}
          sx={{
            color: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(21,34,56,0.07)'),
            position: 'absolute',
          }}
        />
        <CircularProgress
          variant="determinate"
          value={Math.max(score.score, 1)}
          size={size}
          thickness={4}
          sx={{
            color,
            '& .MuiCircularProgress-circle': { strokeLinecap: 'round' },
          }}
        />
        <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0 }}>
          <Typography variant="h4" component="span" lineHeight={1}>
            {score.score}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {scoreLabel(score.score)}
          </Typography>
        </Stack>
      </Box>
    </Tooltip>
  );
}
