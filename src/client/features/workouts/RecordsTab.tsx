import { useState } from 'react';
import { Box, Card, Collapse, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { api } from '../../services/api';
import { formatDay } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { formatDuration, formatKg, type ExerciseRecords, type RecordValue } from './types';

function MiniRecord({ title, rec, render, detail }: { title: string; rec: RecordValue | null; render: (r: RecordValue) => string; detail?: (r: RecordValue) => string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div" noWrap>
        {title}
      </Typography>
      <Typography fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {rec ? render(rec) : '—'}
      </Typography>
      {rec && (
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {detail && detail(rec) ? `${detail(rec)} · ` : ''}
          {formatDay(rec.date, 'd MMM yy')}
        </Typography>
      )}
    </Box>
  );
}

/** Personal records per exercise: one row each (key number on the right), tap to expand the details. */
export function RecordsTab() {
  const { data, error, loading, reload } = useAsync(() => api.get<ExerciseRecords[]>('/workouts/records'), []);
  const [open, setOpen] = useState<string | null>(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState label="Calculating records…" />;
  if (!data?.length) {
    return (
      <Card>
        <EmptyState icon={<EmojiEventsOutlinedIcon fontSize="inherit" />} title="No records yet" description="Tick sets during a workout and your bests appear here." />
      </Card>
    );
  }

  return (
    <Box>
      <Card>
        <List disablePadding>
          {data.map((r, i) => {
            const expanded = open === r.key;
            const headline = r.maxWeight ? formatKg(r.maxWeight.value) : r.maxReps ? `${r.maxReps.value} reps` : r.longestDurationSec ? formatDuration(r.longestDurationSec.value) : '—';
            return (
              <Box key={r.key} sx={{ borderBottom: i < data.length - 1 ? 1 : 0, borderColor: 'divider' }}>
                <ListItemButton onClick={() => setOpen(expanded ? null : r.key)} aria-expanded={expanded} sx={{ py: 1.25 }}>
                  <ListItemText
                    primary={r.exerciseName}
                    secondary={`${r.bestOneRepMax ? `1RM ${formatKg(r.bestOneRepMax.value)} · ` : ''}${r.sessionsCount} session${r.sessionsCount === 1 ? '' : 's'} · last ${formatDay(r.lastPerformed, 'd MMM')}`}
                    slotProps={{ primary: { fontWeight: 700, noWrap: true }, secondary: { noWrap: true } }}
                  />
                  <Box sx={{ textAlign: 'right', ml: 1, flexShrink: 0 }}>
                    <Typography fontWeight={800} fontSize={18} sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                      {headline}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.maxWeight ? 'max weight' : r.maxReps ? 'max reps' : 'longest'}
                    </Typography>
                  </Box>
                  <ExpandMoreRoundedIcon sx={{ ml: 0.5, color: 'text.disabled', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                </ListItemButton>
                <Collapse in={expanded} unmountOnExit>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, px: 2, pb: 2 }}>
                    <MiniRecord title="Max weight" rec={r.maxWeight} render={(x) => formatKg(x.value)} detail={(x) => (x.reps ? `× ${x.reps}` : '')} />
                    <MiniRecord title="Best est. 1RM" rec={r.bestOneRepMax} render={(x) => formatKg(x.value)} detail={(x) => `${formatKg(x.weightKg)} × ${x.reps}`} />
                    <MiniRecord title="Max reps" rec={r.maxReps} render={(x) => `${x.value} reps`} detail={(x) => (x.weightKg ? `@ ${formatKg(x.weightKg)}` : 'bodyweight')} />
                    <MiniRecord title="Best session volume" rec={r.maxSessionVolume} render={(x) => formatKg(x.value)} />
                    {r.longestDurationSec && <MiniRecord title="Longest set" rec={r.longestDurationSec} render={(x) => formatDuration(x.value)} />}
                    <Box>
                      <Typography variant="caption" color="text.secondary" component="div">
                        Total sets
                      </Typography>
                      <Typography fontWeight={800}>{r.totalSets}</Typography>
                    </Box>
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </List>
      </Card>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 0.5, mt: 1 }}>
        From ticked sets only. Est. 1RM = weight × (1 + reps ÷ 30).
      </Typography>
    </Box>
  );
}
