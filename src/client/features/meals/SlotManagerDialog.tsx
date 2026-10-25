import { useEffect, useState } from 'react';
import { Alert, Box, Button, Divider, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useFeedback } from '../../components/common/Feedback';
import { ErrorState, LoadingState } from '../../components/common/States';
import { errorMessage } from '../foods/formHelpers';
import { TAP } from '../foods/mobile';
import type { MealSlot } from './types';
import { ResponsiveDialog } from '../../components/common/mobile';

function SlotRow({
  slot,
  first,
  last,
  busy,
  onSave,
  onMove,
  onDelete,
}: {
  slot: MealSlot;
  first: boolean;
  last: boolean;
  busy: boolean;
  onSave: (patch: { name: string; defaultTime: string | null }) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(slot.name);
  const [time, setTime] = useState(slot.defaultTime ?? '');
  useEffect(() => {
    setName(slot.name);
    setTime(slot.defaultTime ?? '');
  }, [slot]);
  const dirty = name.trim() !== slot.name || (time || null) !== slot.defaultTime;
  return (
    <Box sx={{ py: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField size="medium" label="Name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
        <TextField
          size="medium"
          type="time"
          label="Time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: 130, flexShrink: 0 }}
        />
      </Stack>
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 0.5 }}>
        <Tooltip title="Move up">
          <span>
            <IconButton aria-label={`Move ${slot.name} up`} disabled={first || busy} onClick={() => onMove(-1)} sx={TAP}>
              <ArrowUpwardRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Move down">
          <span>
            <IconButton aria-label={`Move ${slot.name} down`} disabled={last || busy} onClick={() => onMove(1)} sx={TAP}>
              <ArrowDownwardRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton aria-label={`Delete ${slot.name}`} disabled={busy} onClick={onDelete} sx={TAP}>
            <DeleteOutlineRoundedIcon />
          </IconButton>
        </Tooltip>
        <Button
          startIcon={<CheckRoundedIcon />}
          disabled={!dirty || !name.trim() || busy}
          onClick={() => onSave({ name: name.trim(), defaultTime: time || null })}
          sx={TAP}
        >
          Save
        </Button>
      </Stack>
    </Box>
  );
}

/** Rename, retime, reorder, add and remove meal slots. Slots with history are archived, not deleted. */
export function SlotManagerDialog({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const { notify, confirm } = useFeedback();
  const slots = useAsync(() => (open ? api.get<MealSlot[]>('/meals/slots', { includeArchived: 'true' }) : Promise.resolve([])), [open]);
  const [newName, setNewName] = useState('');
  const [newTime, setNewTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = (slots.data ?? []).filter((s) => !s.archivedAt);
  const archived = (slots.data ?? []).filter((s) => s.archivedAt);

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (msg) notify(msg);
      await slots.reload();
      onChanged();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const ids = active.map((s) => s.id);
    [ids[idx], ids[idx + dir]] = [ids[idx + dir], ids[idx]];
    void run(() => api.post('/meals/slots/reorder', { ids }));
  };

  const remove = async (s: MealSlot) => {
    const ok = await confirm({
      title: `Remove ${s.name}?`,
      message: 'If this meal has logged history it will be archived (kept on past days) instead of deleted. Its templates are kept.',
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (ok) await run(() => api.delete(`/meals/slots/${s.id}`), `${s.name} removed`);
  };

  const add = async () => {
    if (!newName.trim()) return;
    if (
      await run(
        () =>
          api.post('/meals/slots', {
            name: newName.trim(),
            defaultTime: newTime || null,
          }),
        `${newName.trim()} added`,
      )
    ) {
      setNewName('');
      setNewTime('');
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      maxWidth="sm"
      title={<>Meal slots</>}
      actions={
        <>
          <Button onClick={onClose} disabled={busy} sx={TAP}>
            Done
          </Button>
        </>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {slots.error ? (
        <ErrorState error={slots.error} onRetry={slots.reload} />
      ) : slots.loading && !slots.data ? (
        <LoadingState />
      ) : (
        <>
          <Stack divider={<Divider flexItem />}>
            {active.map((s, i) => (
              <SlotRow
                key={s.id}
                slot={s}
                first={i === 0}
                last={i === active.length - 1}
                busy={busy}
                onSave={(patch) => run(() => api.patch(`/meals/slots/${s.id}`, patch), 'Meal slot saved')}
                onMove={(d) => move(i, d)}
                onDelete={() => remove(s)}
              />
            ))}
          </Stack>
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Add a meal slot
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <TextField size="medium" label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
            <TextField
              size="medium"
              type="time"
              label="Time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 130, flexShrink: 0 }}
            />
          </Stack>
          <Button variant="outlined" onClick={add} disabled={busy || !newName.trim()} sx={{ mt: 1, ...TAP }}>
            Add slot
          </Button>
          {archived.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
                Archived
              </Typography>
              {archived.map((s) => (
                <Stack key={s.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.5 }}>
                  <Typography variant="body2">{s.name}</Typography>
                  <Button onClick={() => run(() => api.post(`/meals/slots/${s.id}/unarchive`), `${s.name} restored`)} disabled={busy} sx={TAP}>
                    Restore
                  </Button>
                </Stack>
              ))}
            </>
          )}
        </>
      )}
    </ResponsiveDialog>
  );
}
