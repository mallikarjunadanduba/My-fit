import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Box, Button, Card, Chip, List, ListItemButton, ListItemText, Stack } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { api, type PageMeta } from '../../services/api';
import { formatDay } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { STATUS_LABEL, WORKOUT_SESSION_PATH, formatDuration, formatKg, type SessionStatus, type SessionSummary } from './types';

const PAGE = 20;
const STATUS_ICON: Record<SessionStatus, { icon: ReactElement; color: 'success' | 'info' | 'warning' | 'primary' }> = {
  COMPLETED: { icon: <CheckRoundedIcon />, color: 'success' },
  IN_PROGRESS: { icon: <PlayArrowRoundedIcon />, color: 'info' },
  SKIPPED: { icon: <SkipNextRoundedIcon />, color: 'warning' },
  PLANNED: { icon: <EventRoundedIcon />, color: 'primary' },
};

/** Logged workouts as list rows (newest first) with status filter chips and "Load more". */
export function HistoryTab() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SessionStatus | ''>('');
  const [pages, setPages] = useState(1);
  const pageSize = Math.min(100, PAGE * pages);
  const { data, error, loading, refreshing, reload } = useAsync(
    () => api.getPaged<SessionSummary[]>('/workouts/sessions', { page: 1, pageSize, status: status || undefined }),
    [pageSize, status],
  );
  const rows = data?.data ?? [];
  const meta = data?.meta as PageMeta | undefined;
  const chips: { value: SessionStatus | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'IN_PROGRESS', label: 'In progress' },
    { value: 'SKIPPED', label: 'Skipped' },
  ];

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: 'auto', mx: -2, px: 2, pb: 0.5, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        {chips.map((c) => (
          <Chip
            key={c.value || 'all'}
            label={c.label}
            onClick={() => {
              setStatus(c.value);
              setPages(1);
            }}
            color={status === c.value ? 'primary' : 'default'}
            variant={status === c.value ? 'filled' : 'outlined'}
            sx={{ height: 36, px: 0.5, flexShrink: 0 }}
          />
        ))}
      </Stack>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingState label="Loading history…" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<HistoryIcon fontSize="inherit" />} title="No workouts logged" description="Workouts you start or finish show up here." />
        </Card>
      ) : (
        <>
          <Card>
            <List disablePadding>
              {rows.map((s, i) => {
                const st = STATUS_ICON[s.status];
                const stats =
                  s.status === 'SKIPPED'
                    ? 'Skipped'
                    : [formatDuration(s.durationSec), `${s.stats.completedSets}/${s.stats.totalSets} sets`, s.stats.volumeKg > 0 ? formatKg(s.stats.volumeKg) : null]
                        .filter((x) => x && x !== '—')
                        .join(' · ');
                return (
                  <ListItemButton key={s.id} divider={i < rows.length - 1} onClick={() => navigate(WORKOUT_SESSION_PATH(s.id))} sx={{ py: 1.25 }}>
                    <Box
                      sx={(t) => ({
                        width: 40,
                        height: 40,
                        mr: 1.5,
                        flexShrink: 0,
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        color: `${st.color}.main`,
                        bgcolor: alpha(t.palette[st.color].main, 0.12),
                      })}
                      aria-label={STATUS_LABEL[s.status]}
                    >
                      {st.icon}
                    </Box>
                    <ListItemText
                      primary={s.name}
                      secondary={`${formatDay(s.date, 'EEE d MMM')} · ${stats}`}
                      slotProps={{ primary: { fontWeight: 700, noWrap: true }, secondary: { noWrap: true } }}
                    />
                    <ChevronRightRoundedIcon sx={{ color: 'text.disabled', ml: 1 }} />
                  </ListItemButton>
                );
              })}
            </List>
          </Card>
          {meta && meta.total > rows.length && pageSize < 100 && (
            <Button fullWidth onClick={() => setPages((p) => p + 1)} disabled={refreshing} sx={{ mt: 1.5, minHeight: 48 }}>
              {refreshing ? 'Loading…' : `Load more (${meta.total - rows.length} older)`}
            </Button>
          )}
        </>
      )}
    </Box>
  );
}
