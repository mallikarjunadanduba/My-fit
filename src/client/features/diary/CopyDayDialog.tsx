import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, CircularProgress, FormControlLabel, FormGroup, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { formatDay, shiftDate } from '../../services/dates';
import { useFeedback } from '../../components/common/Feedback';
import { ErrorState } from '../../components/common/States';
import { fmt } from '../foods/format';
import { errorMessage } from '../foods/formHelpers';
import type { DiaryDay } from './types';
import { ResponsiveDialog } from '../../components/common/mobile';

/** Copies diary entries (and meal statuses) from an earlier day into `date`. */
export function CopyDayDialog({ open, date, onClose, onSaved }: { open: boolean; date: string; onClose: () => void; onSaved: () => void }) {
  const { notify } = useFeedback();
  const [fromDate, setFromDate] = useState(shiftDate(date, -1));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFromDate(shiftDate(date, -1));
      setError(null);
    }
  }, [open, date]);

  const source = useAsync(() => (open && fromDate ? api.get<DiaryDay>('/food-diary', { date: fromDate }) : Promise.resolve(null)), [open, fromDate]);
  const slotsWithEntries = (source.data?.slots ?? []).filter((s) => s.entries.length > 0);
  const unslottedCount = source.data?.unslotted.entries.length ?? 0;

  useEffect(() => {
    setSelected(new Set(slotsWithEntries.map((s) => s.slot.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.data]);

  const allSelected = selected.size === slotsWithEntries.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ copied: number }>('/meals/copy-day', {
        fromDate,
        toDate: date,
        // Copy everything (incl. snacks without a meal) when all meals are ticked.
        slotIds: allSelected ? undefined : [...selected],
      });
      notify(`Copied ${res.copied} item${res.copied === 1 ? '' : 's'} from ${formatDay(fromDate, 'EEE d MMM')}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={saving ? () => undefined : onClose}
      maxWidth="xs"
      title="Copy from another day"
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving || !source.data?.logged || (selected.size === 0 && slotsWithEntries.length > 0)}>
            {saving ? 'Copying…' : 'Copy'}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <TextField
          type="date"
          size="medium"
          label="Copy from"
          value={fromDate}
          onChange={(e) => e.target.value && setFromDate(e.target.value)}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { max: shiftDate(date, -1) },
          }}
        />
        {source.error ? (
          <ErrorState error={source.error} onRetry={source.reload} />
        ) : source.loading ? (
          <Stack alignItems="center" sx={{ py: 2 }}>
            <CircularProgress size={24} aria-label="Loading day" />
          </Stack>
        ) : !source.data?.logged ? (
          <Typography variant="body2" color="text.secondary">
            Nothing was logged on {formatDay(fromDate)}.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {fmt(source.data.totals?.calories ?? 0)} kcal logged. Choose which meals to copy — times eaten are left blank.
            </Typography>
            <FormGroup>
              {slotsWithEntries.map((s) => (
                <FormControlLabel
                  key={s.slot.id}
                  sx={{ minHeight: 48 }}
                  control={<Checkbox checked={selected.has(s.slot.id)} onChange={() => toggle(s.slot.id)} />}
                  label={`${s.slot.name} · ${s.entries.length} item${s.entries.length === 1 ? '' : 's'}`}
                />
              ))}
            </FormGroup>
            {unslottedCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {unslottedCount} item(s) without a meal are copied only when every meal is selected.
              </Typography>
            )}
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </ResponsiveDialog>
  );
}
