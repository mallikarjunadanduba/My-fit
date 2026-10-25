import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Divider, Grid, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { api } from '../../services/api';
import { todayIn } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { allowedUnits, nutrientsFor, sumNutrients, UNIT_LABELS, type FoodUnit, type Nutrients } from '../../../shared/nutrition';
import type { MealSlot, MealTemplate, TemplateItem } from '../meals/types';
import { EstimateChip, formatQuantity, MacroLine } from '../foods/format';
import { errorMessage, localToIso, nowTimeIn } from '../foods/formHelpers';
import { ResponsiveDialog } from '../../components/common/mobile';
import type { MealStatus } from '../meals/types';
import type { DiaryEntry } from './types';

/** POST /api/meals/apply-template response. */
export interface ApplyResult {
  status: { status: MealStatus };
  entries: DiaryEntry[];
}

interface RowState {
  checked: boolean;
  /** Id of the chosen item: the primary or one of its alternatives. */
  choiceId: string;
  quantity: string;
  unit: FoodUnit;
}

function itemNutrients(item: TemplateItem, quantity: number, unit: FoodUnit): Nutrients | null {
  if (!item.food || !(quantity > 0)) return null;
  try {
    return nutrientsFor(item.food, quantity, unit);
  } catch {
    return null;
  }
}

/**
 * Explicitly logs a planned meal: user ticks what they ate, picks alternatives and adjusts amounts,
 * then POST /api/meals/apply-template creates the diary entries and marks the meal completed/partial.
 */
export function LogPlannedMealDialog({
  open,
  date,
  slot,
  template,
  existingCount,
  onClose,
  onSaved,
}: {
  open: boolean;
  date: string;
  slot: MealSlot | null;
  template: MealTemplate | null;
  existingCount: number;
  onClose: () => void;
  onSaved: (res: ApplyResult) => void;
}) {
  const { timezone } = useAuth();
  const { notify } = useFeedback();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !template) return;
    const init: Record<string, RowState> = {};
    for (const p of template.items)
      init[p.id] = {
        checked: !p.isOptional,
        choiceId: p.id,
        quantity: String(p.quantity),
        unit: p.unit,
      };
    setRows(init);
    setTime(date === todayIn(timezone) ? nowTimeIn(timezone) : (slot?.defaultTime ?? '12:00'));
    setError(null);
  }, [open, template, date, timezone, slot]);

  const choiceOf = (p: MealTemplate['items'][number], r: RowState) => (r.choiceId === p.id ? p : (p.alternatives.find((a) => a.id === r.choiceId) ?? p));

  const total = useMemo(() => {
    if (!template) return null;
    const list: Nutrients[] = [];
    for (const p of template.items) {
      const r = rows[p.id];
      if (!r?.checked) continue;
      const n = itemNutrients(choiceOf(p, r), Number(r.quantity), r.unit);
      if (n) list.push(n);
    }
    return sumNutrients(list);
  }, [rows, template]);

  const update = (id: string, patch: Partial<RowState>) => setRows((rs) => ({ ...rs, [id]: { ...rs[id], ...patch } }));

  const save = async () => {
    if (!template || !slot) return;
    const itemIds: string[] = [];
    const overrides: { itemId: string; quantity: number; unit: FoodUnit }[] = [];
    for (const p of template.items) {
      const r = rows[p.id];
      if (!r?.checked) continue;
      const chosen = choiceOf(p, r);
      itemIds.push(chosen.id);
      if (chosen.food) {
        const q = Number(r.quantity);
        if (!(q > 0)) return setError(`Enter an amount for ${chosen.displayName}`);
        overrides.push({ itemId: chosen.id, quantity: q, unit: r.unit });
      }
    }
    if (!itemIds.length) return setError('Tick at least one item you ate');
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<ApplyResult>('/meals/apply-template', {
        date,
        slotId: slot.id,
        templateId: template.id,
        itemIds,
        overrides,
        consumedAt: time ? localToIso(date, time, timezone) : undefined,
      });
      notify(`${slot.name} logged${res.status.status === 'PARTIAL' ? ' as partial' : ''} · ${res.entries.length} item${res.entries.length === 1 ? '' : 's'}`);
      onSaved(res);
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
      title={`Log ${slot?.name ?? 'meal'}`}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? 'Logging…' : `Log meal${total ? ` · ${Math.round(total.calories)} kcal` : ''}`}
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        From “{template?.name}”. Untick anything you skipped and adjust amounts.
      </Typography>
      {existingCount > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This meal already has {existingCount} logged item
          {existingCount === 1 ? '' : 's'}. Logging the plan adds more entries.
        </Alert>
      )}
      <Stack spacing={1.5} divider={<Divider flexItem />}>
        {template?.items.map((p) => {
          const r = rows[p.id];
          if (!r) return null;
          const chosen = choiceOf(p, r);
          const n = r.checked ? itemNutrients(chosen, Number(r.quantity), r.unit) : null;
          const labelId = `plan-item-${p.id}`;
          return (
            <Box key={p.id}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Checkbox
                  checked={r.checked}
                  onChange={(e) => update(p.id, { checked: e.target.checked })}
                  slotProps={{ input: { 'aria-labelledby': labelId } }}
                  sx={{ mt: -0.5 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography id={labelId} variant="body1" fontWeight={600}>
                      {chosen.displayName}
                    </Typography>
                    {p.isOptional && <Chip label="Optional" size="small" variant="outlined" sx={{ height: 20 }} />}
                    {chosen.food?.isEstimate && <EstimateChip />}
                    <Typography variant="body2" color="text.secondary">
                      plan: {formatQuantity(chosen.quantity, chosen.unit, chosen.quantityMax)}
                    </Typography>
                  </Stack>
                  {p.alternatives.length > 0 && (
                    <TextField
                      size="medium"
                      select
                      label="Choose"
                      value={r.choiceId}
                      disabled={!r.checked}
                      onChange={(e) => {
                        const next = e.target.value === p.id ? p : p.alternatives.find((a) => a.id === e.target.value)!;
                        update(p.id, {
                          choiceId: next.id,
                          quantity: String(next.quantity),
                          unit: next.unit,
                        });
                      }}
                      sx={{ mt: 1, maxWidth: 320 }}
                    >
                      <MenuItem value={p.id}>{p.displayName}</MenuItem>
                      {p.alternatives.map((a) => (
                        <MenuItem key={a.id} value={a.id}>
                          or {a.displayName}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                  {chosen.food ? (
                    <Grid container spacing={1} sx={{ mt: 1 }}>
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <TextField
                          size="medium"
                          label="Amount"
                          type="number"
                          value={r.quantity}
                          disabled={!r.checked}
                          onChange={(e) => update(p.id, { quantity: e.target.value })}
                          slotProps={{
                            htmlInput: {
                              min: 0,
                              step: 'any',
                              inputMode: 'decimal',
                            },
                          }}
                        />
                      </Grid>
                      <Grid size={{ xs: 6, sm: 4 }}>
                        <TextField
                          size="medium"
                          select
                          label="Unit"
                          value={r.unit}
                          disabled={!r.checked}
                          onChange={(e) => update(p.id, { unit: e.target.value as FoodUnit })}
                        >
                          {Array.from(new Set([...allowedUnits(chosen.food.servingUnit), chosen.unit])).map((u) => (
                            <MenuItem key={u} value={u}>
                              {UNIT_LABELS[u]}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }} sx={{ display: 'flex', alignItems: 'center' }}>
                        {n ? (
                          <Typography variant="body2" fontWeight={700}>
                            {Math.round(n.calories)} kcal · P {n.protein}g
                          </Typography>
                        ) : (
                          r.checked && (
                            <Typography variant="body2" color="error">
                              Check amount/unit
                            </Typography>
                          )
                        )}
                      </Grid>
                    </Grid>
                  ) : (
                    <Typography variant="body2" color="text.secondary" component="div">
                      Not linked to a food — counts as eaten, no nutrition tracked.
                    </Typography>
                  )}
                  {chosen.notes && (
                    <Typography variant="body2" color="text.secondary" component="div">
                      {chosen.notes}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          );
        })}
      </Stack>
      <Grid container spacing={2} sx={{ mt: 2 }}>
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
        <Grid size={{ xs: 12, sm: 7 }}>
          <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }} aria-live="polite">
            <Typography variant="body2" color="text.secondary" component="div">
              Selected total
            </Typography>
            {total && <MacroLine n={total} dense />}
          </Paper>
        </Grid>
      </Grid>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </ResponsiveDialog>
  );
}
