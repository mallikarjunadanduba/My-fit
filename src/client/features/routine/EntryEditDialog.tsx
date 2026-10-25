import { useEffect, useState } from 'react';
import { Box, Button, Chip, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SnoozeRoundedIcon from '@mui/icons-material/SnoozeRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import NotesRoundedIcon from '@mui/icons-material/NotesRounded';
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import { formatClock } from '../../services/dates';
import { ResponsiveDialog } from '../../components/common/mobile';
import { CATEGORY_META, CategoryIcon } from '../alarms/categories';
import { ROUTINE_STATUS, type RoutineEntry } from './types';
import type { EntryPatch } from './RoutineTimeline';

export type EntryEditMode = 'skip' | 'notes' | 'time';
export type EntryChange = EntryPatch & { skipReason?: string | null; notes?: string | null; scheduledTime?: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SNOOZE = [10, 15, 30, 60];
const TITLES: Record<EntryEditMode, string> = { skip: 'Skip', notes: 'Notes', time: 'Change time' };

/**
 * Action sheet for one routine entry: Complete / Skip with reason / Snooze / Edit time / Notes.
 * Full-screen sheet on phones (ResponsiveDialog). Calls `onApply` and closes immediately (optimistic).
 */
export function EntrySheet({ entry, onClose, onApply }: { entry: RoutineEntry | null; onClose: () => void; onApply: (e: RoutineEntry, change: EntryChange) => void }) {
  const [mode, setMode] = useState<EntryEditMode | null>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (entry) {
      setMode(null);
      setTouched(false);
    }
  }, [entry]);

  const startMode = (m: EntryEditMode) => {
    if (!entry) return;
    setMode(m);
    setTouched(false);
    setValue(m === 'notes' ? (entry.notes ?? '') : m === 'time' ? entry.scheduledTime : (entry.skipReason ?? ''));
  };

  const apply = (change: EntryChange) => {
    if (!entry) return;
    onApply(entry, change);
    onClose();
  };

  const error = !mode ? null : mode === 'time' ? (!TIME_RE.test(value) ? 'Enter a time' : null) : value.length > (mode === 'notes' ? 1000 : 500) ? 'Too long' : null;
  const submit = () => {
    setTouched(true);
    if (error || !mode) return;
    const v = value.trim();
    apply(mode === 'skip' ? { status: 'SKIPPED', skipReason: v || null } : mode === 'notes' ? { notes: v || null } : { scheduledTime: v });
  };

  const open = entry?.status === 'PENDING' || entry?.status === 'SNOOZED';
  const meta = entry ? CATEGORY_META[entry.category] : null;

  return (
    <ResponsiveDialog
      open={!!entry}
      onClose={onClose}
      maxWidth="xs"
      title={mode ? TITLES[mode] : (entry?.title ?? '')}
      actions={
        mode ? (
          <>
            <Button onClick={() => setMode(null)} sx={{ minHeight: 48 }}>
              Back
            </Button>
            <Button variant="contained" onClick={submit} sx={{ minHeight: 48 }}>
              {mode === 'skip' ? 'Skip' : 'Save'}
            </Button>
          </>
        ) : undefined
      }
    >
      {entry && meta && (
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Box sx={{ color: meta.color, display: 'flex', fontSize: 28 }}>
              <CategoryIcon category={entry.category} fontSize="inherit" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={700} noWrap>
                {mode ? entry.title : `${formatClock(entry.scheduledTime)} · ${meta.label}`}
              </Typography>
              {mode && (
                <Typography variant="body2" color="text.secondary">
                  Planned {formatClock(entry.scheduledTime)}
                </Typography>
              )}
            </Box>
            <Chip size="small" color={ROUTINE_STATUS[entry.status].color} label={ROUTINE_STATUS[entry.status].label} />
          </Stack>

          {mode === null ? (
            <>
              {open ? (
                <Button fullWidth size="large" variant="contained" startIcon={<CheckCircleRoundedIcon />} onClick={() => apply({ status: 'COMPLETED' })} sx={{ minHeight: 56, fontSize: 17, mb: 2 }}>
                  Complete
                </Button>
              ) : (
                <Button fullWidth size="large" variant="outlined" startIcon={<UndoRoundedIcon />} onClick={() => apply({ status: 'PENDING' })} sx={{ minHeight: 56, mb: 2 }}>
                  Mark as not done
                </Button>
              )}
              {open && (
                <Box sx={{ mb: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: 'text.secondary' }}>
                    <SnoozeRoundedIcon fontSize="small" />
                    <Typography variant="body2" fontWeight={600}>
                      Snooze
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    {SNOOZE.map((m) => (
                      <Button key={m} variant="outlined" onClick={() => apply({ snoozeMinutes: m })} sx={{ flex: 1, minHeight: 48, minWidth: 0 }}>
                        {m}m
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}
              <List disablePadding>
                {open && (
                  <ListItemButton onClick={() => startMode('skip')} sx={{ minHeight: 52, borderRadius: 2 }}>
                    <ListItemIcon>
                      <SkipNextRoundedIcon />
                    </ListItemIcon>
                    <ListItemText primary="Skip…" secondary="Optionally note why" />
                  </ListItemButton>
                )}
                <ListItemButton onClick={() => startMode('time')} sx={{ minHeight: 52, borderRadius: 2 }}>
                  <ListItemIcon>
                    <ScheduleRoundedIcon />
                  </ListItemIcon>
                  <ListItemText primary="Change time" secondary="Only for this day" />
                </ListItemButton>
                <ListItemButton onClick={() => startMode('notes')} sx={{ minHeight: 52, borderRadius: 2 }}>
                  <ListItemIcon>
                    <NotesRoundedIcon />
                  </ListItemIcon>
                  <ListItemText primary={entry.notes ? 'Edit notes' : 'Add notes'} secondary={entry.notes ?? undefined} secondaryTypographyProps={{ noWrap: true }} />
                </ListItemButton>
                {open && (
                  <ListItemButton onClick={() => apply({ status: 'MISSED' })} sx={{ minHeight: 52, borderRadius: 2 }}>
                    <ListItemIcon>
                      <EventBusyRoundedIcon />
                    </ListItemIcon>
                    <ListItemText primary="Mark missed" />
                  </ListItemButton>
                )}
              </List>
            </>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {mode === 'time' ? (
                <TextField
                  autoFocus
                  type="time"
                  size="medium"
                  label="Time"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  error={touched && !!error}
                  helperText={(touched && error) || 'Only this day changes; the routine stays the same.'}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60, style: { fontSize: 28, fontWeight: 800 } } }}
                />
              ) : (
                <TextField
                  autoFocus
                  multiline
                  size="medium"
                  minRows={mode === 'notes' ? 4 : 2}
                  label={mode === 'skip' ? 'Reason (optional)' : 'Notes'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  error={touched && !!error}
                  helperText={touched && error}
                />
              )}
            </form>
          )}
        </Box>
      )}
    </ResponsiveDialog>
  );
}
