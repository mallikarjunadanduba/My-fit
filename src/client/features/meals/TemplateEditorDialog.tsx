import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { api } from '../../services/api';
import { useFeedback } from '../../components/common/Feedback';
import { allowedUnits, FOOD_UNITS, nutrientsFor, sumNutrients, UNIT_LABELS, type FoodUnit, type Nutrients } from '../../../shared/nutrition';
import { MacroLine } from '../foods/format';
import { errorMessage } from '../foods/formHelpers';
import { FoodPicker } from './FoodPicker';
import type { ItemInput } from './templateInput';
import { DAY_TYPE_LABELS, type DayType, type MealSlot, type MealTemplate, type TemplateFood, type TemplateItem } from './types';
import { OverflowMenu, TAP } from '../foods/mobile';
import { ResponsiveDialog } from '../../components/common/mobile';

interface EditItem {
  key: string;
  mode: 'food' | 'custom';
  food: TemplateFood | null;
  customName: string;
  quantity: string;
  quantityMax: string;
  unit: FoodUnit;
  isOptional: boolean;
  notes: string;
  alternatives: EditItem[];
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const blankItem = (): EditItem => ({
  key: newKey(),
  mode: 'food',
  food: null,
  customName: '',
  quantity: '',
  quantityMax: '',
  unit: 'G',
  isOptional: false,
  notes: '',
  alternatives: [],
});

const fromItem = (i: TemplateItem, alts: TemplateItem[] = []): EditItem => ({
  key: newKey(),
  mode: i.foodId ? 'food' : 'custom',
  food: i.food,
  customName: i.customName ?? (i.foodId ? '' : i.displayName),
  quantity: String(i.quantity),
  quantityMax: i.quantityMax != null ? String(i.quantityMax) : '',
  unit: i.unit,
  isOptional: i.isOptional,
  notes: i.notes ?? '',
  alternatives: alts.map((a) => fromItem(a)),
});

function nutritionOf(i: EditItem, which: 'min' | 'max'): Nutrients | null {
  if (i.mode !== 'food' || !i.food) return null;
  const q = Number(which === 'max' && i.quantityMax ? i.quantityMax : i.quantity);
  if (!(q > 0)) return null;
  try {
    return nutrientsFor(i.food, q, i.unit);
  } catch {
    return null;
  }
}

/** Validates and converts one edited item; returns an error message or the request shape. */
function toInput(i: EditItem, label: string): Omit<ItemInput, 'alternatives' | 'isOptional'> | string {
  if (i.mode === 'food' && !i.food) return `${label}: choose a food`;
  if (i.mode === 'custom' && !i.customName.trim()) return `${label}: enter a name`;
  const q = Number(i.quantity);
  if (!(q > 0)) return `${label}: enter a quantity greater than 0`;
  const max = i.quantityMax ? Number(i.quantityMax) : null;
  if (max != null && !(max >= q)) return `${label}: max must be at least ${q}`;
  if (i.mode === 'food' && i.food && !allowedUnits(i.food.servingUnit).includes(i.unit)) return `${label}: unit not valid for ${i.food.name}`;
  return {
    foodId: i.mode === 'food' ? i.food!.id : null,
    customName: i.mode === 'custom' ? i.customName.trim() : null,
    quantity: q,
    quantityMax: max,
    unit: i.unit,
    notes: i.notes.trim() || null,
  };
}

function ItemFields({
  item,
  onChange,
  alternative,
  label,
}: {
  item: EditItem;
  onChange: (patch: Partial<EditItem>) => void;
  alternative?: boolean;
  label: string;
}) {
  const units = item.mode === 'food' && item.food ? allowedUnits(item.food.servingUnit) : FOOD_UNITS;
  const n = nutritionOf(item, 'min');
  const nMax = item.quantityMax ? nutritionOf(item, 'max') : null;
  return (
    <Grid container spacing={1.5}>
      <Grid size={{ xs: 12 }}>
        <ToggleButtonGroup
          sx={{ '& .MuiToggleButton-root': { minHeight: 44 } }}
          exclusive
          value={item.mode}
          onChange={(_, v) => v && onChange({ mode: v })}
          aria-label={`${label} type`}
        >
          <ToggleButton value="food">From library</ToggleButton>
          <ToggleButton value="custom">Free text</ToggleButton>
        </ToggleButtonGroup>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        {item.mode === 'food' ? (
          <FoodPicker
            label={alternative ? 'Alternative food' : 'Food'}
            value={item.food}
            onChange={(f) =>
              onChange({
                food: f,
                ...(f
                  ? {
                      unit: f.servingUnit,
                      quantity: item.quantity || String(f.servingSize),
                    }
                  : {}),
              })
            }
          />
        ) : (
          <TextField
            size="medium"
            label="Name"
            placeholder="e.g. Mixed vegetables"
            value={item.customName}
            onChange={(e) => onChange({ customName: e.target.value })}
            helperText="Not tracked for nutrition"
          />
        )}
      </Grid>
      <Grid size={{ xs: 4, sm: 2 }}>
        <TextField
          size="medium"
          label="Qty"
          type="number"
          value={item.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          slotProps={{
            htmlInput: {
              min: 0,
              step: 'any',
              inputMode: 'decimal',
              'aria-label': `${label} quantity`,
            },
          }}
        />
      </Grid>
      <Grid size={{ xs: 4, sm: 2 }}>
        <TextField
          size="medium"
          label="Max"
          type="number"
          value={item.quantityMax}
          onChange={(e) => onChange({ quantityMax: e.target.value })}
          slotProps={{
            htmlInput: {
              min: 0,
              step: 'any',
              inputMode: 'decimal',
              'aria-label': `${label} maximum quantity (optional)`,
            },
          }}
        />
      </Grid>
      <Grid size={{ xs: 4, sm: 2 }}>
        <TextField
          size="medium"
          select
          label="Unit"
          value={units.includes(item.unit) ? item.unit : ''}
          onChange={(e) => onChange({ unit: e.target.value as FoodUnit })}
        >
          {units.map((u) => (
            <MenuItem key={u} value={u}>
              {UNIT_LABELS[u]}
            </MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid size={{ xs: 12, sm: alternative ? 12 : 8 }}>
        <TextField
          size="medium"
          label="Notes (optional)"
          value={item.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
      </Grid>
      {!alternative && (
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControlLabel control={<Checkbox checked={item.isOptional} onChange={(e) => onChange({ isOptional: e.target.checked })} />} label="Optional" />
        </Grid>
      )}
      {n && (
        <Grid size={{ xs: 12 }}>
          <MacroLine n={n} max={nMax} dense />
        </Grid>
      )}
    </Grid>
  );
}

/** Create or edit a meal template; items are replaced atomically on save. */
export function TemplateEditorDialog({
  open,
  template,
  slots,
  defaults,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Template to edit; null creates a new one. */
  template: MealTemplate | null;
  slots: MealSlot[];
  defaults?: { slotId?: string | null; dayType?: DayType };
  onClose: () => void;
  onSaved: (t: MealTemplate) => void;
}) {
  const { notify, confirm } = useFeedback();
  const [name, setName] = useState('');
  const [slotId, setSlotId] = useState('');
  const [dayType, setDayType] = useState<DayType>('ANY');
  const [notes, setNotes] = useState('');
  const [preparation, setPreparation] = useState('');
  const [items, setItems] = useState<EditItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setSlotId(template ? (template.slotId ?? '') : (defaults?.slotId ?? ''));
    setDayType(template?.dayType ?? defaults?.dayType ?? 'ANY');
    setNotes(template?.notes ?? '');
    setPreparation(template?.preparation ?? '');
    setItems(template ? template.items.map((i) => fromItem(i, i.alternatives)) : [blankItem()]);
    setError(null);
  }, [open, template, defaults?.slotId, defaults?.dayType]);

  const updateItem = (idx: number, patch: Partial<EditItem>) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const updateAlt = (idx: number, aIdx: number, patch: Partial<EditItem>) =>
    setItems((list) =>
      list.map((it, i) =>
        i === idx
          ? {
              ...it,
              alternatives: it.alternatives.map((a, j) => (j === aIdx ? { ...a, ...patch } : a)),
            }
          : it,
      ),
    );
  const move = (idx: number, dir: -1 | 1) =>
    setItems((list) => {
      const next = [...list];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return list;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const totals = useMemo(() => {
    const req = items.filter((i) => !i.isOptional);
    return {
      min: sumNutrients(req.map((i) => nutritionOf(i, 'min') ?? {})),
      max: sumNutrients(req.map((i) => nutritionOf(i, 'max') ?? {})),
    };
  }, [items]);

  const save = async () => {
    if (!name.trim()) return setError('Give the meal a name');
    const payload: ItemInput[] = [];
    for (const [i, it] of items.entries()) {
      const p = toInput(it, `Item ${i + 1}`);
      if (typeof p === 'string') return setError(p);
      const alternatives: Omit<ItemInput, 'alternatives' | 'isOptional'>[] = [];
      for (const [j, a] of it.alternatives.entries()) {
        const ai = toInput(a, `Item ${i + 1}, alternative ${j + 1}`);
        if (typeof ai === 'string') return setError(ai);
        alternatives.push(ai);
      }
      payload.push({ ...p, isOptional: it.isOptional, alternatives });
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      slotId: slotId || null,
      dayType,
      notes: notes.trim() || null,
      preparation: preparation.trim() || null,
      items: payload,
    };
    try {
      const saved = template ? await api.patch<MealTemplate>(`/meals/templates/${template.id}`, body) : await api.post<MealTemplate>('/meals/templates', body);
      notify(template ? 'Meal template saved' : 'Meal template created');
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (idx: number) => {
    const it = items[idx];
    const filled = it.food || it.customName || it.alternatives.length;
    if (
      filled &&
      !(await confirm({
        title: 'Remove this item?',
        message: 'It will be removed from the template when you save.',
        destructive: true,
        confirmLabel: 'Remove',
      }))
    )
      return;
    setItems((list) => list.filter((_, i) => i !== idx));
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={saving ? () => undefined : onClose}
      maxWidth="md"
      title={<>{template ? `Edit ${template.name}` : 'New meal'}</>}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save meal'}
          </Button>
        </>
      }
    >
      {template && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Changes apply from now on. Meals already logged in your diary are not changed.
        </Alert>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            size="medium"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField size="medium" select label="Meal slot" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
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
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField size="medium" select label="Day type" value={dayType} onChange={(e) => setDayType(e.target.value as DayType)}>
            {(['ANY', 'GYM', 'REST'] as DayType[]).map((d) => (
              <MenuItem key={d} value={d}>
                {DAY_TYPE_LABELS[d]}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
      </Grid>

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Items
      </Typography>
      <Stack spacing={1.5}>
        {items.map((it, idx) => (
          <Paper key={it.key} variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>
                Item {idx + 1}
              </Typography>
              <OverflowMenu
                label={`Actions for item ${idx + 1}`}
                actions={[
                  {
                    label: 'Move up',
                    icon: <ArrowUpwardRoundedIcon fontSize="small" />,
                    onClick: () => move(idx, -1),
                    disabled: idx === 0,
                  },
                  {
                    label: 'Move down',
                    icon: <ArrowDownwardRoundedIcon fontSize="small" />,
                    onClick: () => move(idx, 1),
                    disabled: idx === items.length - 1,
                  },
                  {
                    label: 'Remove item',
                    icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                    onClick: () => void removeItem(idx),
                    destructive: true,
                  },
                ]}
              />
            </Stack>
            <ItemFields item={it} label={`Item ${idx + 1}`} onChange={(p) => updateItem(idx, p)} />
            {it.alternatives.map((a, aIdx) => (
              <Box
                key={a.key}
                sx={{
                  mt: 1.5,
                  pl: { xs: 1, sm: 2 },
                  borderLeft: 3,
                  borderColor: 'primary.light',
                }}
              >
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="body2" fontWeight={700} color="text.secondary" sx={{ flex: 1 }}>
                    OR alternative {aIdx + 1}
                  </Typography>
                  <IconButton
                    aria-label={`Remove alternative ${aIdx + 1} of item ${idx + 1}`}
                    onClick={() =>
                      updateItem(idx, {
                        alternatives: it.alternatives.filter((_, j) => j !== aIdx),
                      })
                    }
                    sx={TAP}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <ItemFields item={a} alternative label={`Item ${idx + 1} alternative ${aIdx + 1}`} onChange={(p) => updateAlt(idx, aIdx, p)} />
              </Box>
            ))}
            <Button
              sx={{ mt: 1 }}
              startIcon={<AddRoundedIcon />}
              onClick={() =>
                updateItem(idx, {
                  alternatives: [...it.alternatives, blankItem()],
                })
              }
            >
              Add alternative
            </Button>
          </Paper>
        ))}
        <Button startIcon={<AddRoundedIcon />} onClick={() => setItems((l) => [...l, blankItem()])} sx={{ alignSelf: 'flex-start' }}>
          Add item
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5, mt: 2, bgcolor: 'action.hover' }} aria-live="polite">
        <Typography variant="body2" color="text.secondary" component="div">
          Planned nutrition (required items)
        </Typography>
        <MacroLine n={totals.min} max={totals.max} />
      </Paper>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField size="medium" label="Preparation (optional)" multiline minRows={2} value={preparation} onChange={(e) => setPreparation(e.target.value)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField size="medium" label="Notes (optional)" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
