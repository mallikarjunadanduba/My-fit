import { useEffect, useState } from 'react';
import { Box, Card, CardContent, Chip, IconButton, List, ListItem, Pagination, Stack, Tooltip, Typography } from '@mui/material';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ReceiptLongRoundedIcon from '@mui/icons-material/ReceiptLongRounded';
import { api, toApiError } from '../../services/api';
import { formatInstant } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { useFeedback } from '../../components/common/Feedback';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { useAlarms } from './AlarmProvider';
import { getBrowserSubscription } from './pushClient';
import { deviceLabel } from './schedule';
import { CHANNEL_LABEL, DELIVERY_STATUS } from './format';
import type { DeliveryChannel, DeliveryStatus, PushSubscriptionRow } from './types';

interface DeliveryRow {
  id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  statusCode: number | null;
  error: string | null;
  createdAt: string;
  reminder: { id: string; title: string } | null;
  device: string | null;
}

export function DevicesTab({ timezone, version }: { timezone: string; version: number }) {
  const { notify, confirm } = useFeedback();
  const { refresh: refreshAlarms, unsubscribe } = useAlarms();
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const subs = useAsync(() => api.get<PushSubscriptionRow[]>('/notifications/subscriptions'), [version]);
  const logs = useAsync(() => api.getPaged<DeliveryRow[]>('/notifications/deliveries', { page, pageSize: 15 }), [page, version]);

  useEffect(() => {
    void getBrowserSubscription().then((s) => setThisEndpoint(s?.endpoint ?? null));
  }, [version]);

  const remove = async (s: PushSubscriptionRow) => {
    const isThis = s.endpoint === thisEndpoint;
    const ok = await confirm({
      title: 'Remove this device?',
      message: isThis ? 'This is the browser you are using now. It will stop receiving push notifications.' : `${deviceLabel(s.userAgent)} will stop receiving push notifications.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isThis) {
        await unsubscribe();
        setThisEndpoint(null);
      } else await api.delete(`/notifications/subscriptions/${s.id}`);
      notify('Device removed');
      subs.reload();
      void refreshAlarms();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ pb: 0 }}>
          <Typography variant="h6">Subscribed devices</Typography>
          <Typography variant="body2" color="text.secondary">
            Browsers that receive push notifications for your account.
          </Typography>
        </CardContent>
        {subs.loading ? (
          <LoadingState minHeight={120} />
        ) : subs.error ? (
          <Box sx={{ p: 2 }}>
            <ErrorState error={subs.error} onRetry={subs.reload} />
          </Box>
        ) : !subs.data || subs.data.length === 0 ? (
          <EmptyState icon={<DevicesRoundedIcon fontSize="inherit" />} title="No devices yet" description="Use “Enable notifications” on the Reminders tab on each phone or computer you want alerts on." />
        ) : (
          <List>
            {subs.data.map((s) => (
              <ListItem
                key={s.id}
                divider
                secondaryAction={
                  <Tooltip title="Remove device">
                    <IconButton edge="end" sx={{ width: 44, height: 44 }} aria-label={`Remove ${deviceLabel(s.userAgent)}`} onClick={() => void remove(s)}>
                      <DeleteOutlineRoundedIcon />
                    </IconButton>
                  </Tooltip>
                }
              >
                <Box sx={{ pr: 6, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={600}>{deviceLabel(s.userAgent)}</Typography>
                    {s.endpoint === thisEndpoint && <Chip size="small" color="primary" label="This device" />}
                    {s.active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" color="error" variant="outlined" label="Revoked" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {s.endpointHost ?? 'Unknown push service'} · added {formatInstant(s.createdAt, timezone, 'd MMM yyyy')}
                    {s.lastSuccessAt ? ` · last delivered ${formatInstant(s.lastSuccessAt, timezone, 'd MMM HH:mm')}` : ''}
                    {s.failureCount > 0 ? ` · ${s.failureCount} recent failure${s.failureCount === 1 ? '' : 's'}` : ''}
                    {s.revokedAt ? ` · revoked ${formatInstant(s.revokedAt, timezone, 'd MMM HH:mm')}` : ''}
                  </Typography>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </Card>

      <Card>
        <CardContent sx={{ pb: 0 }}>
          <Typography variant="h6">Delivery log</Typography>
          <Typography variant="body2" color="text.secondary">
            “Sent” means the browser’s push service accepted the message; the device shows it when it is online.
          </Typography>
        </CardContent>
        {logs.loading ? (
          <LoadingState minHeight={120} />
        ) : logs.error ? (
          <Box sx={{ p: 2 }}>
            <ErrorState error={logs.error} onRetry={logs.reload} />
          </Box>
        ) : !logs.data || logs.data.data.length === 0 ? (
          <EmptyState icon={<ReceiptLongRoundedIcon fontSize="inherit" />} title="No deliveries yet" />
        ) : (
          <>
            <List disablePadding>
              {logs.data.data.map((d) => (
                <ListItem key={d.id} divider sx={{ gap: 1.5 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {d.reminder?.title ?? (d.channel === 'TEST' ? 'Test notification' : 'Reminder')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {formatInstant(d.createdAt, timezone, 'd MMM HH:mm')} · {CHANNEL_LABEL[d.channel]}
                      {d.device ? ` · ${deviceLabel(d.device)}` : ''}
                    </Typography>
                    {d.error && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
                        {d.error}
                      </Typography>
                    )}
                  </Box>
                  <Chip size="small" color={DELIVERY_STATUS[d.status].color} label={d.status === 'SENT' ? 'Sent' : DELIVERY_STATUS[d.status].label} sx={{ flexShrink: 0 }} />
                </ListItem>
              ))}
            </List>
            {logs.data.meta.totalPages > 1 && (
              <Stack alignItems="center" sx={{ pb: 2 }}>
                <Pagination count={logs.data.meta.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" size="small" />
              </Stack>
            )}
          </>
        )}
      </Card>
    </Stack>
  );
}
