import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, IconButton, List, ListItem, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SnoozeRoundedIcon from '@mui/icons-material/SnoozeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import { api, toApiError } from '../../services/api';
import { formatClock, formatInstant } from '../../services/dates';
import { useFeedback } from '../../components/common/Feedback';
import { EmptyState } from '../../components/common/States';
import { CATEGORY_META, CategoryIcon } from './categories';
import { useAlarms } from './AlarmProvider';
import { OCCURRENCE_STATUS } from './format';
import type { ActivityCategory } from './types';

interface Row {
  id: string;
  kind: 'occurrence' | 'routine';
  title: string;
  category: ActivityCategory;
  when: string;
  snoozeMinutes?: number;
}

/** Fired-but-open reminders and overdue routine items for today. Actions are optimistic. */
export function OverdueSection({ timezone }: { timezone: string }) {
  const { overdue, refresh, forget } = useAlarms();
  const { notify } = useFeedback();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ el: HTMLElement; row: Row } | null>(null);

  const covered = new Set(overdue.occurrences.map((o) => o.reminder.routineItemId).filter(Boolean));
  const rows: Row[] = [
    ...overdue.occurrences.map((o) => ({
      id: o.id,
      kind: 'occurrence' as const,
      title: o.reminder.title,
      category: o.reminder.category,
      when: `Due ${formatInstant(o.dueAt, timezone, 'EEE h:mm a')} · ${OCCURRENCE_STATUS[o.status].label}`,
      snoozeMinutes: o.reminder.snoozeMinutes,
    })),
    ...overdue.routineEntries
      .filter((e) => !e.routineItemId || !covered.has(e.routineItemId))
      .map((e) => ({
        id: e.id,
        kind: 'routine' as const,
        title: e.title,
        category: e.category,
        when: `Routine · planned ${formatClock(e.scheduledTime)}${e.status === 'SNOOZED' ? ' · snoozed' : ''}`,
      })),
  ];

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<TaskAltRoundedIcon fontSize="inherit" />} title="All caught up" description="Nothing is overdue right now." />
      </Card>
    );
  }

  const act = async (row: Row, action: 'complete' | 'snooze' | 'dismiss') => {
    setMenu(null);
    forget(row.id);
    notify(action === 'complete' ? `Done: ${row.title}` : action === 'snooze' ? `Snoozed ${row.snoozeMinutes ?? 10} min` : 'Dismissed', action === 'complete' ? 'success' : 'info');
    try {
      if (row.kind === 'routine') await api.patch(`/routines/entries/${row.id}`, action === 'complete' ? { status: 'COMPLETED' } : { snoozeMinutes: 10 });
      else await api.post(`/reminders/occurrences/${row.id}/${action}`, action === 'snooze' ? {} : undefined);
    } catch (e) {
      notify(toApiError(e).message, 'error');
      void refresh();
    }
  };

  const m = menu?.row;
  return (
    <Card component="section" aria-label="Overdue">
      <List disablePadding>
        {rows.map((r, i) => (
          <ListItem key={r.id} divider={i < rows.length - 1} sx={{ gap: 1, py: 1.25, pl: 2, pr: 1 }}>
            <Box sx={{ color: CATEGORY_META[r.category].color, display: 'flex', flexShrink: 0 }}>
              <CategoryIcon category={r.category} fontSize="medium" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={600} noWrap>
                {r.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {r.when}
              </Typography>
            </Box>
            <Button variant="contained" onClick={() => void act(r, 'complete')} sx={{ minHeight: 40, flexShrink: 0 }}>
              Done
            </Button>
            <IconButton aria-label={`More actions for ${r.title}`} onClick={(e) => setMenu({ el: e.currentTarget, row: r })} sx={{ width: 44, height: 44 }}>
              <MoreVertRoundedIcon />
            </IconButton>
          </ListItem>
        ))}
      </List>
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {m && [
          <MenuItem key="snooze" sx={{ minHeight: 48 }} onClick={() => void act(m, 'snooze')}>
            <ListItemIcon>
              <SnoozeRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Snooze {m.snoozeMinutes ?? 10} min</ListItemText>
          </MenuItem>,
          m.kind === 'occurrence' ? (
            <MenuItem key="dismiss" sx={{ minHeight: 48 }} onClick={() => void act(m, 'dismiss')}>
              <ListItemIcon>
                <CloseRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Dismiss</ListItemText>
            </MenuItem>
          ) : (
            <MenuItem key="open" sx={{ minHeight: 48 }} onClick={() => (setMenu(null), navigate('/routine'))}>
              <ListItemIcon>
                <ViewTimelineRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Open routine</ListItemText>
            </MenuItem>
          ),
        ]}
      </Menu>
    </Card>
  );
}
