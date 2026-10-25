import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { todayIn } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { ErrorState } from '../../components/common/States';
import { allowedUnits, FOOD_UNITS, nutrientsFor, UNIT_LABELS, type FoodUnit, type Nutrients } from '../../../shared/nutrition';
import type { Food, FoodCategory } from '../foods/types';
import { EstimateChip, MacroLine, servingText } from '../foods/format';
import { errorMessage, localToIso, muiField, nowTimeIn, num } from '../foods/formHelpers';
import { slotForTime, useSlots } from '../meals/useSlots';
import type { MealSlot } from '../meals/types';
import type { DiaryEntry } from './types';
import { HScroll, TAP } from '../foods/mobile';
import { ResponsiveDialog } from '../../components/common/mobile';

/** Both tabs submit through this form id so the dialog's pinned footer button can submit them. */
const FORM_ID = 'add-food-form';
type TabState = { ready: boolean; busy: boolean };

export interface AddFoodDialogProps {
  open: boolean;
  onClose: () => void;
  /** Local date 'YYYY-MM-DD' the entry is logged on. */
  date: string;
  defaultSlotId?: string | null;
  onSaved: (entry: DiaryEntry) => void;
  /** Preselect a food (e.g. "Add to diary" from the food library). */
  initialFood?: Food | null;
}

type Filter = 'all' | 'favorites' | string;

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function defaultTimeFor(date: string, tz: string, slot?: MealSlot) {
  if (date === todayIn(tz)) return nowTimeIn(tz);
  return slot?.defaultTime ?? '12:00';
}

function SlotTimeFields({
  slots,
  slotId,
  onSlot,
  time,
  onTime,
}: {
  slots: MealSlot[];
  slotId: string;
  onSlot: (id: string) => void;
  time: string;
  onTime: (t: string) => void;
}) {
  return (
    <>
      <Grid size={{ xs: 12, sm: 7 }}>
        <TextField size="medium" select label="Meal" value={slotId} onChange={(e) => onSlot(e.target.value)}>
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
          onChange={(e) => onTime(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Grid>
    </>
  );
}

// ───────────────────────────── Library tab ─────────────────────────────

function LibraryTab({
  open,
  date,
  slots,
  initialSlotId,
  initialFood,
  onSaved,
  onState,
}: {
  open: boolean;
  date: string;
  slots: MealSlot[];
  initialSlotId: string;
  initialFood?: Food | null;
  onSaved: (e: DiaryEntry) => void;
  onState: (s: TabState) => void;
}) {
  const { timezone } = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const q = useDebounced(search.trim());
  const [food, setFood] = useState<Food | null>(initialFood ?? null);
  const [quantity, setQuantity] = useState(initialFood ? String(initialFood.servingSize) : '');
  const [unit, setUnit] = useState<FoodUnit>(initialFood?.servingUnit ?? 'G');
  const [slotId, setSlotId] = useState(initialSlotId);
  const [time, setTime] = useState(() =>
    defaultTimeFor(
      date,
      timezone,
      slots.find((s) => s.id === initialSlotId),
    ),
  );
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useAsync(() => (open ? api.get<FoodCategory[]>('/foods/categories') : Promise.resolve([])), [open]);
  const results = useAsync(
    () =>
      open
        ? api.getPaged<Food[]>('/foods', {
            search: q || undefined,
            favorites: filter === 'favorites' ? 'true' : undefined,
            categoryId: filter !== 'all' && filter !== 'favorites' ? filter : undefined,
            pageSize: 40,
          })
        : Promise.resolve(null),
    [open, q, filter],
  );

  const pick = (f: Food) => {
    setFood(f);
    setUnit(f.servingUnit);
    setQuantity(String(f.servingSize));
    setError(null);
  };

  const qty = Number(quantity);
  const preview = useMemo<{ n: Nutrients | null; err: string | null }>(() => {
    if (!food || !quantity || !(qty > 0)) return { n: null, err: null };
    try {
      return { n: nutrientsFor(food, qty, unit), err: null };
    } catch (e) {
      return { n: null, err: (e as Error).message };
    }
  }, [food, quantity, qty, unit]);

  useEffect(() => onState({ ready: !!food && !!preview.n, busy: saving }), [food, preview.n, saving, onState]);

  const save = async () => {
    if (!food) return;
    if (!(qty > 0)) {
      setError('Enter a quantity greater than 0');
      return;
    }
    if (preview.err) {
      setError(preview.err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entry = await api.post<DiaryEntry>('/food-diary', {
        date,
        slotId: slotId || null,
        foodId: food.id,
        quantity: qty,
        unit,
        consumedAt: time ? localToIso(date, time, timezone) : undefined,
        notes: notes.trim() || null,
      });
      onSaved(entry);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (food) {
    const units = allowedUnits(food.servingUnit);
    return (
      <Stack
        spacing={2}
        component="form"
        id={FORM_ID}
        noValidate
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton aria-label="Back to food search" onClick={() => setFood(null)} sx={TAP}>
            <ArrowBackRoundedIcon />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" noWrap>
                {food.name}
              </Typography>
              <EstimateChip show={food.isEstimate} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {food.brand ? `${food.brand} · ` : ''}per {servingText(food)}
            </Typography>
          </Box>
        </Stack>
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
              autoFocus
            />
          </Grid>
          <Grid size={{ xs: 5 }}>
            <TextField select size="medium" label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as FoodUnit)}>
              {units.map((u) => (
                <MenuItem key={u} value={u}>
                  {u === 'SERVING' && food.servingLabel ? `serving (${food.servingLabel})` : UNIT_LABELS[u]}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <SlotTimeFields slots={slots} slotId={slotId} onSlot={setSlotId} time={time} onTime={setTime} />
          <Grid size={{ xs: 12 }}>
            <TextField
              size="medium"
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </Grid>
        </Grid>
        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }} aria-live="polite">
          <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
            You&apos;ll log
          </Typography>
          {preview.n ? <MacroLine n={preview.n} /> : <Typography variant="body2">{preview.err ?? 'Enter a quantity to see nutrition'}</Typography>}
        </Paper>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <TextField
        placeholder="Search foods or brands"
        size="medium"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
        slotProps={{
          htmlInput: { 'aria-label': 'Search foods' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />
      <HScroll label="Filter by category">
        <Chip label="All" color={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')} />
        <Chip icon={<StarRoundedIcon />} label="Favourites" color={filter === 'favorites' ? 'primary' : 'default'} onClick={() => setFilter('favorites')} />
        {(categories.data ?? []).map((c) => (
          <Chip key={c.id} label={c.name} color={filter === c.id ? 'primary' : 'default'} onClick={() => setFilter(c.id)} />
        ))}
      </HScroll>
      {results.error ? (
        <ErrorState error={results.error} onRetry={results.reload} />
      ) : results.loading && !results.data ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} aria-label="Loading foods" />
        </Stack>
      ) : results.data?.data.length ? (
        <List
          disablePadding
          sx={{
            maxHeight: { xs: 'none', sm: 360 },
            overflowY: 'auto',
            mx: { xs: -2, sm: 0 },
          }}
        >
          {results.data.data.map((f, i) => (
            <Box component="li" key={f.id} sx={{ listStyle: 'none' }}>
              {i > 0 && <Divider sx={{ ml: 2 }} />}
              <ListItemButton onClick={() => pick(f)} sx={{ minHeight: 56, px: 2 }}>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={0.75} alignItems="center" component="span">
                      {f.isFavorite && <StarRoundedIcon sx={{ fontSize: 16, color: 'warning.main' }} aria-label="Favourite" />}
                      <span>{f.name}</span>
                      {f.isEstimate && (
                        <Typography component="span" variant="body2" color="warning.main">
                          est.
                        </Typography>
                      )}
                    </Stack>
                  }
                  secondary={
                    <>
                      {f.brand ? `${f.brand} · ` : ''}
                      {servingText(f)} · P {f.protein}g
                    </>
                  }
                  slotProps={{
                    primary: { fontWeight: 600 },
                    secondary: { component: 'span' },
                  }}
                />
                <Typography fontWeight={700} sx={{ flexShrink: 0, ml: 1 }}>
                  {Math.round(f.calories)}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {' '}
                    kcal
                  </Typography>
                </Typography>
              </ListItemButton>
            </Box>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
          {q ? `No foods match “${q}”. Try the Nutrition label tab to log it once.` : 'No foods here yet. Add foods in the Food Library.'}
        </Typography>
      )}
    </Stack>
  );
}

// ───────────────────────────── Manual label tab ─────────────────────────────

const nutrient = z.number({ invalid_type_error: 'Required' }).min(0, 'Must be 0 or more');
const manualSchema = z.object({
  foodName: z.string().trim().min(1, 'Name is required').max(120),
  brand: z.string().max(120),
  quantity: z.number({ invalid_type_error: 'Required' }).positive('Must be greater than 0'),
  unit: z.enum(FOOD_UNITS as [FoodUnit, ...FoodUnit[]]),
  calories: nutrient,
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  fiber: nutrient,
  isEstimate: z.boolean(),
  notes: z.string().max(500),
});
type ManualForm = z.infer<typeof manualSchema>;

function ManualTab({
  date,
  slots,
  initialSlotId,
  onSaved,
  onState,
}: {
  date: string;
  slots: MealSlot[];
  initialSlotId: string;
  onSaved: (e: DiaryEntry) => void;
  onState: (s: TabState) => void;
}) {
  const { timezone } = useAuth();
  const [slotId, setSlotId] = useState(initialSlotId);
  const [time, setTime] = useState(() =>
    defaultTimeFor(
      date,
      timezone,
      slots.find((s) => s.id === initialSlotId),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ManualForm>({
    resolver: zodResolver(manualSchema),
    defaultValues: {
      foodName: '',
      brand: '',
      quantity: 1,
      unit: 'SERVING',
      isEstimate: false,
      notes: '',
      fiber: 0,
    },
  });

  useEffect(() => onState({ ready: true, busy: isSubmitting }), [isSubmitting, onState]);

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const entry = await api.post<DiaryEntry>('/food-diary/manual', {
        ...v,
        brand: v.brand.trim() || null,
        notes: v.notes.trim() || null,
        date,
        slotId: slotId || null,
        consumedAt: time ? localToIso(date, time, timezone) : undefined,
      });
      onSaved(entry);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  const numField = (name: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', label: string, unit: string) => (
    <Grid size={{ xs: 6, sm: name === 'calories' ? 12 : 3 }}>
      <TextField
        size="medium"
        label={label}
        type="number"
        {...muiField(register(name, { setValueAs: num }))}
        error={!!errors[name]}
        helperText={errors[name]?.message}
        slotProps={{
          htmlInput: { min: 0, step: 'any', inputMode: 'decimal' },
          input: {
            endAdornment: <InputAdornment position="end">{unit}</InputAdornment>,
          },
        }}
      />
    </Grid>
  );

  return (
    <Box component="form" id={FORM_ID} onSubmit={submit} noValidate>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Log something once from its nutrition label without adding it to your library. Enter the values for the amount you ate.
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 7 }}>
          <TextField size="medium" label="Food name" {...muiField(register('foodName'))} error={!!errors.foodName} helperText={errors.foodName?.message} />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField size="medium" label="Brand (optional)" {...muiField(register('brand'))} />
        </Grid>
        <Grid size={{ xs: 7 }}>
          <TextField
            size="medium"
            label="Amount eaten"
            type="number"
            {...muiField(register('quantity', { setValueAs: num }))}
            error={!!errors.quantity}
            helperText={errors.quantity?.message}
            slotProps={{
              htmlInput: { min: 0, step: 'any', inputMode: 'decimal' },
            }}
          />
        </Grid>
        <Grid size={{ xs: 5 }}>
          <Controller
            control={control}
            name="unit"
            render={({ field }) => (
              <TextField size="medium" select label="Unit" {...field}>
                {FOOD_UNITS.map((u) => (
                  <MenuItem key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        </Grid>
        {numField('calories', 'Calories', 'kcal')}
        {numField('protein', 'Protein', 'g')}
        {numField('carbs', 'Carbs', 'g')}
        {numField('fat', 'Fat', 'g')}
        {numField('fiber', 'Fiber', 'g')}
        <SlotTimeFields slots={slots} slotId={slotId} onSlot={setSlotId} time={time} onTime={setTime} />
        <Grid size={{ xs: 12 }}>
          <TextField size="medium" label="Notes (optional)" {...muiField(register('notes'))} />
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Controller
            control={control}
            name="isEstimate"
            render={({ field }) => (
              <FormControlLabel
                control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label="These values are an estimate"
              />
            )}
          />
        </Grid>
      </Grid>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

// ───────────────────────────── Dialog ─────────────────────────────

/** Contract component: log a food (library or one-off label) to the diary for `date`. */
export function AddFoodDialog({ open, onClose, date, defaultSlotId, onSaved, initialFood }: AddFoodDialogProps) {
  const { timezone } = useAuth();
  const { notify } = useFeedback();
  const [tab, setTab] = useState(0);
  const [state, setState] = useState<TabState>({ ready: false, busy: false });
  const [session, setSession] = useState(0);
  const slots = useSlots(open);

  useEffect(() => {
    if (open) {
      setTab(0);
      setSession((s) => s + 1);
    }
  }, [open]);

  const initialSlotId = useMemo(() => {
    const list = slots.data ?? [];
    if (defaultSlotId && list.some((s) => s.id === defaultSlotId)) return defaultSlotId;
    if (date === todayIn(timezone)) return slotForTime(list, nowTimeIn(timezone))?.id ?? '';
    return '';
  }, [slots.data, defaultSlotId, date, timezone]);

  const handleSaved = (entry: DiaryEntry) => {
    notify(`Logged ${entry.foodName}`);
    onSaved(entry);
    onClose();
  };
  const { busy } = state;

  return (
    <ResponsiveDialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Add food"
      actions={
        state.ready ? (
          <Button type="submit" form={FORM_ID} variant="contained" size="large" disabled={busy}>
            {busy ? 'Saving…' : 'Add to diary'}
          </Button>
        ) : undefined
      }
    >
      <Box
        sx={{
          position: 'sticky',
          top: { xs: -16, sm: -20 },
          zIndex: 2,
          bgcolor: 'background.paper',
          mx: { xs: -2, sm: -3 },
          mt: { xs: -2, sm: -2.5 },
          mb: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" aria-label="How to add food">
          <Tab label="Food library" sx={{ minHeight: 48 }} />
          <Tab label="Nutrition label" sx={{ minHeight: 48 }} />
        </Tabs>
      </Box>
      <Box sx={{ minHeight: 320 }}>
        {slots.error ? (
          <ErrorState error={slots.error} onRetry={slots.reload} />
        ) : slots.loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={28} aria-label="Loading" />
          </Stack>
        ) : tab === 0 ? (
          <LibraryTab
            key={`lib-${session}-${initialSlotId}`}
            open={open}
            date={date}
            slots={slots.data ?? []}
            initialSlotId={initialSlotId}
            initialFood={initialFood}
            onSaved={handleSaved}
            onState={setState}
          />
        ) : (
          <ManualTab
            key={`man-${session}-${initialSlotId}`}
            date={date}
            slots={slots.data ?? []}
            initialSlotId={initialSlotId}
            onSaved={handleSaved}
            onState={setState}
          />
        )}
      </Box>
    </ResponsiveDialog>
  );
}

export default AddFoodDialog;
