import { useState } from 'react';
import { Box, Card, Chip, List, ListItem, Pagination, Stack, TextField, Tooltip, Typography } from '@mui/material';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { api } from '../../services/api';
import { formatInstant, shiftDate, todayIn } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { CATEGORY_META, CategoryIcon } from './categories';
import { CHANNEL_LABEL, DELIVERY_STATUS, OCCURRENCE_STATUS } from './format';
import { deviceLabel } from './schedule';
import type { HistoryItem } from './types';

const PAGE_SIZE = 20;

export function HistoryTab({ timezone }: { timezone: string }) {
  const today = todayIn(timezone);
  const [from, setFrom] = useState(shiftDate(today, -6));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const invalid = from > to;

  const { data, error, loading, reload } = useAsync(
    () => (invalid ? Promise.resolve(null) : api.getPaged<HistoryItem[]>('/reminders/history', { from, to, page, pageSize: PAGE_SIZE })),
    [from, to, page, invalid],
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5}>
        <TextField
          type="date"
          label="From"
          value={from}
          onChange={(e) => {
            if (e.target.value) {
              setFrom(e.target.value);
              setPage(1);
            }
          }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          type="date"
          label="To"
          value={to}
          onChange={(e) => {
            if (e.target.value) {
              setTo(e.target.value);
              setPage(1);
            }
          }}
          error={invalid}
          helperText={invalid ? '“To” must be on or after “From”' : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      {loading ? (
        <LoadingState />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data || data.data.length === 0 ? (
        <Card>
          <EmptyState icon={<HistoryRoundedIcon fontSize="inherit" />} title="No reminder activity in this range" description="Fired, snoozed, completed and missed reminders appear here." />
        </Card>
      ) : (
        <>
          <Card>
            <List disablePadding>
              {data.data.map((o) => (
                <ListItem key={o.id} divider sx={{ display: 'block', py: 1.25 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box sx={{ color: CATEGORY_META[o.reminder.category].color, display: 'flex', flexShrink: 0 }}>
                      <CategoryIcon category={o.reminder.category} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={600} noWrap>
                        {o.reminder.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {formatInstant(o.scheduledFor, timezone, 'EEE d MMM, h:mm a')}
                      </Typography>
                    </Box>
                    <Chip size="small" color={OCCURRENCE_STATUS[o.status].color} label={OCCURRENCE_STATUS[o.status].label} sx={{ flexShrink: 0 }} />
                  </Stack>
                  {o.deliveries.length > 0 && (
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75, pl: 4.5 }}>
                      {o.deliveries.map((d) => (
                        <Tooltip key={d.id} title={[d.device ? deviceLabel(d.device) : null, d.error, formatInstant(d.createdAt, timezone, 'd MMM HH:mm:ss')].filter(Boolean).join(' · ')}>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={DELIVERY_STATUS[d.status].color}
                            label={`${CHANNEL_LABEL[d.channel]}: ${d.status === 'SENT' ? 'sent' : DELIVERY_STATUS[d.status].label.toLowerCase()}`}
                          />
                        </Tooltip>
                      ))}
                    </Stack>
                  )}
                </ListItem>
              ))}
            </List>
          </Card>
          {data.meta.totalPages > 1 && (
            <Stack alignItems="center">
              <Pagination count={data.meta.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
