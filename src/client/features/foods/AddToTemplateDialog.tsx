import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, CircularProgress, FormControlLabel, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useFeedback } from '../../components/common/Feedback';
import { ErrorState } from '../../components/common/States';
import { allowedUnits, nutrientsFor, UNIT_LABELS, type FoodUnit } from '../../../shared/nutrition';
import { DAY_TYPE_LABELS, type MealSlot, type MealTemplate } from '../meals/types';
import { templateItemsToInput } from '../meals/templateInput';
import type { Food } from './types';
import { MacroLine } from './format';
import { errorMessage } from './formHelpers';
import { ResponsiveDialog } from '../../components/common/mobile';

const NEW = '__new__';

/** Appends a food to an existing meal template (or a new one). Existing diary entries are unaffected. */
export function AddToTemplateDialog({ open, food, onClose }: { open: boolean; food: Food | null; onClose: () => void }) {
  const { notify } = useFeedback();
  const data = useAsync(
    () => (open ? Promise.all([api.get<MealTemplate[]>('/meals/templates'), api.get<MealSlot[]>('/meals/slots')]) : Promise.resolve(null)),
    [open],
  );
  const [templateId, setTemplateId] = useState('');
  const [newName, setNewName] = useState('');
  const [newSlotId, setNewSlotId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quantityMax, setQuantityMax] = useState('');
  const [unit, setUnit] = useState<FoodUnit>('G');
  const [optional, setOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && food) {
      setTemplateId('');
      setNewName('');
      setNewSlotId('');
      setQuantity(String(food.servingSize));
      setQuantityMax('');
      setUnit(food.servingUnit);
      setOptional(false);
      setError(null);
    }
  }, [open, food]);

  const [templates, slots] = data.data ?? [[], []];
  const slotName = (id: string | null) => slots.find((s) => s.id === id)?.name ?? 'No slot';
  const qty = Number(quantity);
  const max = quantityMax ? Number(quantityMax) : null;
  const preview = useMemo(() => {
    if (!food || !(qty > 0)) return null;
    try {
      return nutrientsFor(food, qty, unit);
    } catch {
      return null;
    }
  }, [food, qty, unit]);

  const save = async () => {
    if (!food) return;
    if (!(qty > 0)) return setError('Enter a quantity greater than 0');
    if (max != null && !(max >= qty)) return setError('Max must be at least the quantity');
    if (!templateId) return setError('Choose a meal template');
    if (templateId === NEW && !newName.trim()) return setError('Name the new template');
    setSaving(true);
    setError(null);
    const item = {
      foodId: food.id,
      customName: null,
      quantity: qty,
      quantityMax: max,
      unit,
      notes: null,
      isOptional: optional,
      alternatives: [],
    };
    try {
      if (templateId === NEW) {
        await api.post('/meals/templates', {
          name: newName.trim(),
          slotId: newSlotId || null,
          dayType: 'ANY',
          items: [item],
        });
        notify(`Created “${newName.trim()}” with ${food.name}`);
      } else {
        const t = await api.get<MealTemplate>(`/meals/templates/${templateId}`);
        await api.patch(`/meals/templates/${t.id}`, {
          items: [...templateItemsToInput(t), item],
        });
        notify(`Added ${food.name} to “${t.name}”`);
      }
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
      maxWidth="sm"
      title={<>Add {food?.name} to a meal</>}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving || data.loading}>
            {saving ? 'Saving…' : 'Add to meal'}
          </Button>
        </>
      }
    >
      {data.error ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : data.loading || !food ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} aria-label="Loading templates" />
        </Stack>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <TextField size="medium" select label="Meal template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name} · {slotName(t.slotId)} · {DAY_TYPE_LABELS[t.dayType]}
                  {t.isPlan ? ' (plan)' : ''}
                </MenuItem>
              ))}
              <MenuItem value={NEW}>
                <em>+ New template…</em>
              </MenuItem>
            </TextField>
          </Grid>
          {templateId === NEW && (
            <>
              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField size="medium" label="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField size="medium" select label="Meal slot" value={newSlotId} onChange={(e) => setNewSlotId(e.target.value)}>
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {slots.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </>
          )}
          <Grid size={{ xs: 4 }}>
            <TextField
              size="medium"
              label="Quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              slotProps={{
                htmlInput: { min: 0, step: 'any', inputMode: 'decimal' },
              }}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              size="medium"
              label="Max (optional)"
              type="number"
              value={quantityMax}
              onChange={(e) => setQuantityMax(e.target.value)}
              slotProps={{
                htmlInput: { min: 0, step: 'any', inputMode: 'decimal' },
              }}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField size="medium" select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as FoodUnit)}>
              {allowedUnits(food.servingUnit).map((u) => (
                <MenuItem key={u} value={u}>
                  {UNIT_LABELS[u]}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel control={<Checkbox checked={optional} onChange={(e) => setOptional(e.target.checked)} />} label="Optional item" />
          </Grid>
          <Grid size={{ xs: 12 }}>{preview ? <MacroLine n={preview} /> : <Typography variant="body2">Enter a quantity to see nutrition</Typography>}</Grid>
        </Grid>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </ResponsiveDialog>
  );
}
