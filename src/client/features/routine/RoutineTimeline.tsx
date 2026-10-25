import { Box, ButtonBase, Card, IconButton, Stack, Typography } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { formatInstant } from '../../services/dates';
import { CATEGORY_META } from '../alarms/categories';
import { clockParts } from '../alarms/format';
import { timelineFlags, type RoutineEntry } from './types';

export type EntryPatch = { status?: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'MISSED'; snoozeMinutes?: number };

interface Props {
  entries: RoutineEntry[];
  timezone: string;
  isToday: boolean;
  now: number;
  onOpen: (e: RoutineEntry) => void;
  onComplete: (e: RoutineEntry) => void;
}

function statusLine(e: RoutineEntry, timezone: string, overdue: boolean, next: boolean): string {
  const meta = CATEGORY_META[e.category];
  switch (e.status) {
    case 'COMPLETED':
      return e.completedAt ? `Done at ${formatInstant(e.completedAt, timezone, 'h:mm a')}` : 'Done';
    case 'SKIPPED':
      return e.skipReason ? `Skipped · ${e.skipReason}` : 'Skipped';
    case 'MISSED':
      return 'Missed';
    case 'SNOOZED':
      return e.snoozedUntil ? `Snoozed until ${formatInstant(e.snoozedUntil, timezone, 'h:mm a')}` : 'Snoozed';
    default:
      return overdue ? 'Overdue' : next ? 'Up next' : meta.label === e.title ? 'Pending' : meta.label;
  }
}

/** Vertical timeline: time | dot + line | title/status. Tap a row for actions; the check completes in one tap. */
export function RoutineTimeline({ entries, timezone, isToday, now, onOpen, onComplete }: Props) {
  const { overdue, nextId } = timelineFlags(entries, now, isToday);

  return (
    <Card>
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, py: 0.5 }} aria-label="Routine timeline">
        {entries.map((e, i) => {
          const meta = CATEGORY_META[e.category];
          const isOverdue = overdue.has(e.id);
          const isNext = e.id === nextId;
          const done = e.status === 'COMPLETED';
          const closed = e.status === 'SKIPPED' || e.status === 'MISSED';
          const open = e.status === 'PENDING' || e.status === 'SNOOZED';
          const { time, suffix } = clockParts(e.scheduledTime);
          const dotColor = done ? 'success.main' : isOverdue ? 'warning.main' : closed ? 'text.disabled' : meta.color;
          return (
            <Box component="li" key={e.id} sx={{ display: 'flex', alignItems: 'stretch', bgcolor: isNext ? 'action.hover' : undefined }}>
              <ButtonBase
                onClick={() => onOpen(e)}
                aria-label={`${e.title}, ${time} ${suffix}. Open actions`}
                sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-start', textAlign: 'left', pl: 1.5 }}
              >
                {/* Time */}
                <Box sx={{ width: 58, flexShrink: 0, pt: 1.6, textAlign: 'right' }}>
                  <Typography
                    component="div"
                    sx={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', color: closed ? 'text.disabled' : isOverdue ? 'warning.main' : 'text.primary' }}
                  >
                    {time}
                  </Typography>
                  <Typography component="div" variant="caption" color="text.secondary" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {suffix}
                  </Typography>
                </Box>
                {/* Rail */}
                <Stack alignItems="center" sx={{ width: 32, flexShrink: 0 }} aria-hidden>
                  <Box sx={{ width: 2, height: 16, bgcolor: i === 0 ? 'transparent' : 'divider' }} />
                  <Box
                    sx={{
                      width: isNext || isOverdue ? 16 : 12,
                      height: isNext || isOverdue ? 16 : 12,
                      borderRadius: '50%',
                      bgcolor: done || isOverdue ? dotColor : 'background.paper',
                      border: 3,
                      borderColor: dotColor,
                      boxShadow: isNext ? (t) => `0 0 0 4px ${t.palette.primary.main}33` : 'none',
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ width: 2, flex: 1, minHeight: 8, bgcolor: i === entries.length - 1 ? 'transparent' : 'divider' }} />
                </Stack>
                {/* Content */}
                <Box sx={{ flex: 1, minWidth: 0, py: 1.25, pr: 1 }}>
                  <Typography
                    fontWeight={isNext ? 800 : 600}
                    noWrap
                    sx={{ textDecoration: e.status === 'SKIPPED' ? 'line-through' : 'none', color: closed ? 'text.secondary' : 'text.primary' }}
                  >
                    {e.title}
                  </Typography>
                  <Typography variant="body2" noWrap sx={{ color: isOverdue ? 'warning.main' : isNext ? 'primary.main' : 'text.secondary', fontWeight: isOverdue || isNext ? 600 : 400 }}>
                    {statusLine(e, timezone, isOverdue, isNext)}
                  </Typography>
                  {e.notes && (
                    <Typography variant="caption" color="text.secondary" component="div" noWrap>
                      {e.notes}
                    </Typography>
                  )}
                </Box>
              </ButtonBase>
              <Box sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
                {open ? (
                  <IconButton aria-label={`Mark ${e.title} done`} onClick={() => onComplete(e)} sx={{ width: 44, height: 44, color: isOverdue ? 'warning.main' : 'text.secondary' }}>
                    <RadioButtonUncheckedRoundedIcon />
                  </IconButton>
                ) : done ? (
                  <Box sx={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'success.main' }} aria-label="Done">
                    <CheckRoundedIcon />
                  </Box>
                ) : (
                  <Box sx={{ width: 44 }} />
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}
