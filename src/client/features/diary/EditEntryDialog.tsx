import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Grid, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { allowedUnits, nutrientsFor, UNIT_LABELS, type FoodUnit } from '../../../shared/nutrition';
import type { MealSlot } from '../meals/types';
import { EstimateChip, MacroLine } from '../foods/format';
import { errorMessage, isoToTime, localToIso } from '../foods/formHelpers';
import type { DiaryEntry } from './types';
import { ResponsiveDialog } from '../../components/common/mobile';

/** Edit quantity/unit/time/meal/notes. Nutrition is recomputed from the entry's own snapshot. */
export function EditEntryDialog({
  entry,
  slots,
  onClose,
  onSaved,
}: {
  entry: DiaryEntry | null;
  slots: MealSlot[];
  onClose: () => void;
  onSaved: (e: DiaryEntry) => void;
}) {
  const { timezone } = useAuth();
  const { notify } = useFeedback();
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<FoodUnit>('G');
  const [slotId, setSlotId] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setQuantity(String(entry.quantity));
    setUnit(entry.unit);
    setSlotId(entry.slotId ?? '');
    setTime(entry.consumedAt ? isoToTime(entry.consumedAt, timezone) : '');
    setNotes(entry.notes ?? '');
    setError(null);
  }, [entry, timezone]);

  const qty = Number(quantity);
  const units = entry ? Array.from(new Set([...allowedUnits(entry.basis.servingUnit), entry.unit])) : [];
  const preview = useMemo(() => {
    if (!entry || !(qty > 0)) return { n: null, err: null as string | null };
    try {
      return { n: nutrientsFor(entry.basis, qty, unit), err: null };
    } catch (e) {
      return { n: null, err: (e as Error).message };
    }
  }, [entry, qty, unit]);

  const save = async () => {
    if (!entry) return;
    if (!(qty > 0)) return setError('Enter a quantity greater than 0');
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<DiaryEntry>(`/food-diary/${entry.id}`, {
        quantity: qty,
        unit,
        slotId: slotId || null,
        consumedAt: time ? localToIso(entry.date, time, timezone) : null,
        notes: notes.trim() || null,
      });
      notify('Entry updated');
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={!!entry}
      onClose={saving ? () => undefined : onClose}
      maxWidth="xs"
      title={
        <Stack direction="row" spacing={1} alignItems="center" component="span">
          <span>Edit {entry?.foodName}</span>
          <EstimateChip show={!!entry?.isEstimate} />
        </Stack>
      }
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving || !preview.n}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 7 }}>
          <TextField
            label="Quantity"
            size="medium"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            slotProps={{
              htmlInput: { min: 0, step: 'any', inputMode: 'decimal' },
            }}
          />
        </Grid>
        <Grid size={{ xs: 5 }}>
          <TextField size="medium" select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as FoodUnit)}>
            {units.map((u) => (
              <MenuItem key={u} value={u}>
                {UNIT_LABELS[u]}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 7 }}>
          <TextField size="medium" select label="Meal" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
            <MenuItem value="">
              <em>No meal (snack / other)</em>
            </MenuItem>
            {slots.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField
            size="medium"
            type="time"
            label="Time eaten"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField size="medium" label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ p: 1.5, mt: 2, bgcolor: 'action.hover' }} aria-live="polite">
        {preview.n ? <MacroLine n={preview.n} /> : <Typography variant="body2">{preview.err ?? 'Enter a quantity'}</Typography>}
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          Based on the values saved when this was logged.
        </Typography>
      </Paper>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </ResponsiveDialog>
  );
}
