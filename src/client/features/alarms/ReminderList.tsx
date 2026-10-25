import { useState } from 'react';
import { Box, ButtonBase, Card, IconButton, List, ListItem, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Switch, Typography } from '@mui/material';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import { api, toApiError } from '../../services/api';
import { formatInstant } from '../../services/dates';
import { useFeedback } from '../../components/common/Feedback';
import { CATEGORY_META, CATEGORY_ORDER, CategoryIcon } from './categories';
import { clockParts, scheduleSummary } from './format';
import { formatCountdown } from './schedule';
import type { DeliveryOutcome, Reminder } from './types';

interface Props {
  reminders: Reminder[];
  timezone: string;
  onEdit: (r: Reminder) => void;
  onChanged: (r: Reminder) => void;
  /** Local (optimistic) replacement of the whole list. */
  onReplaceAll: (list: Reminder[]) => void;
  onDeleted: (id: string) => void;
}

/** Reminders grouped by category: big time on the left, title + schedule, on/off switch and an overflow menu. */
export function ReminderList({ reminders, timezone, onEdit, onChanged, onReplaceAll, onDeleted }: Props) {
  const { notify, confirm } = useFeedback();
  const [menu, setMenu] = useState<{ el: HTMLElement; reminder: Reminder } | null>(null);

  const groups = CATEGORY_ORDER.map((c) => ({ category: c, items: reminders.filter((r) => r.category === c) })).filter((g) => g.items.length > 0);

  /** Optimistic on/off: the switch flips immediately and reverts if the server refuses. */
  const toggle = async (r: Reminder) => {
    onReplaceAll(reminders.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)));
    try {
      const updated = await api.post<Reminder>(`/reminders/${r.id}/${r.enabled ? 'pause' : 'resume'}`);
      if (updated) onChanged(updated);
    } catch (e) {
      onReplaceAll(reminders);
      notify(toApiError(e).message, 'error');
    }
  };

  const test = async (r: Reminder) => {
    try {
      const res = await api.post<{ deliveries: DeliveryOutcome[]; pushConfigured: boolean }>(`/reminders/${r.id}/test`);
      const sent = res?.deliveries.filter((d) => d.status === 'SENT').length ?? 0;
      if (sent > 0) notify(`Test sent to ${sent} device${sent === 1 ? '' : 's'}`);
      else notify(res?.deliveries[0]?.error ?? 'No device received the test', 'warning');
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const remove = async (r: Reminder) => {
    const ok = await confirm({
      title: `Delete "${r.title}"?`,
      message: r.routineItemId
        ? 'This reminder belongs to a routine item. To keep them in sync, turn the item’s reminder off in Daily Routine instead.'
        : 'Its history is removed too.',
      destructive: true,
    });
    if (!ok) return;
    onDeleted(r.id);
    try {
      await api.delete(`/reminders/${r.id}`);
      notify('Reminder deleted');
    } catch (e) {
      onReplaceAll(reminders);
      notify(toApiError(e).message, 'error');
    }
  };

  const m = menu?.reminder;
  const closeMenu = () => setMenu(null);

  return (
    <Stack spacing={2}>
      {groups.map(({ category, items }) => {
        const meta = CATEGORY_META[category];
        return (
          <Card key={category} component="section" aria-label={meta.label}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
              <Box sx={{ color: meta.color, display: 'flex' }}>
                <CategoryIcon category={category} />
              </Box>
              <Typography variant="subtitle2" component="h3" sx={{ flex: 1 }}>
                {meta.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {items.length}
              </Typography>
            </Stack>
            <List disablePadding>
              {items.map((r, i) => {
                const { time, suffix } = clockParts(r.time);
                const next = r.enabled && r.nextTriggerAt ? `next ${formatCountdown(r.nextTriggerAt)}` : r.enabled ? 'scheduling…' : 'off';
                return (
                  <ListItem key={r.id} divider={i < items.length - 1} disablePadding sx={{ pr: 0.5 }}>
                    <ButtonBase
                      onClick={() => onEdit(r)}
                      aria-label={`Edit ${r.title}`}
                      sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25, py: 1.25, pl: 2, pr: 0.5, textAlign: 'left', minHeight: 64 }}
                    >
                      <Box sx={{ width: 60, flexShrink: 0, opacity: r.enabled ? 1 : 0.45 }}>
                        <Typography component="div" sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                          {time}
                        </Typography>
                        <Typography component="div" variant="caption" color="text.secondary" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {suffix}
                        </Typography>
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1, opacity: r.enabled ? 1 : 0.6 }}>
                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                            {r.title}
                          </Typography>
                          {r.routineItemId && <ViewTimelineRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} aria-label="Routine item" />}
                          {!r.sound && <VolumeOffRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} aria-label="Sound off" />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {scheduleSummary(r)} · {next}
                        </Typography>
                      </Box>
                    </ButtonBase>
                    <Switch
                      checked={r.enabled}
                      onChange={() => void toggle(r)}
                      slotProps={{ input: { 'aria-label': r.enabled ? `Turn off ${r.title}` : `Turn on ${r.title}` } }}
                    />
                    <IconButton aria-label={`More actions for ${r.title}`} onClick={(e) => setMenu({ el: e.currentTarget, reminder: r })} sx={{ width: 44, height: 44 }}>
                      <MoreVertRoundedIcon />
                    </IconButton>
                  </ListItem>
                );
              })}
            </List>
          </Card>
        );
      })}

      <Menu anchorEl={menu?.el} open={!!menu} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {m && [
          <MenuItem key="edit" sx={{ minHeight: 48 }} onClick={() => (closeMenu(), onEdit(m))}>
            <ListItemIcon>
              <EditRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>,
          <MenuItem key="test" sx={{ minHeight: 48 }} onClick={() => (closeMenu(), void test(m))}>
            <ListItemIcon>
              <SendRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText secondary={m.lastOccurrence ? `Last fired ${formatInstant(m.lastOccurrence.scheduledFor, timezone, 'd MMM, h:mm a')}` : undefined}>Send test</ListItemText>
          </MenuItem>,
          <MenuItem key="delete" sx={{ minHeight: 48, color: 'error.main' }} onClick={() => (closeMenu(), void remove(m))}>
            <ListItemIcon sx={{ color: 'inherit' }}>
              <DeleteOutlineRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>,
        ]}
      </Menu>
    </Stack>
  );
}
