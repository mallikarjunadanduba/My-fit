import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Autocomplete, Box, Button, Chip, FormControlLabel, Grid, InputAdornment, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { api } from '../../services/api';
import { useFeedback } from '../../components/common/Feedback';
import { caloriesFromMacros, FOOD_UNITS, UNIT_LABELS, type FoodUnit } from '../../../shared/nutrition';
import { MediaImage, MediaUploadButton } from '../media';
import type { Food, FoodCategory, FoodSource } from './types';
import { errorMessage, muiField, num } from './formHelpers';
import { fmt } from './format';
import { TAP } from './mobile';
import { ResponsiveDialog } from '../../components/common/mobile';

const nutrient = z.number({ invalid_type_error: 'Required' }).min(0, 'Must be 0 or more').max(100000);
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  brand: z.string().max(120),
  categoryIds: z.array(z.string()),
  servingSize: z.number({ invalid_type_error: 'Required' }).positive('Must be greater than 0'),
  servingUnit: z.enum(FOOD_UNITS as [FoodUnit, ...FoodUnit[]]),
  servingLabel: z.string().max(80),
  calories: nutrient,
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  fiber: nutrient,
  preparation: z.string().max(500),
  notes: z.string().max(1000),
  isEstimate: z.boolean(),
  source: z.enum(['SEED', 'CUSTOM', 'LABEL']),
  imageMediaId: z.string().nullable(),
});
type FormValues = z.infer<typeof schema>;

const toForm = (f?: Food | null): FormValues => ({
  name: f?.name ?? '',
  brand: f?.brand ?? '',
  categoryIds: f?.categories.map((c) => c.id) ?? [],
  servingSize: f?.servingSize ?? 100,
  servingUnit: f?.servingUnit ?? 'G',
  servingLabel: f?.servingLabel ?? '',
  calories: f?.calories ?? NaN,
  protein: f?.protein ?? NaN,
  carbs: f?.carbs ?? NaN,
  fat: f?.fat ?? NaN,
  fiber: f?.fiber ?? 0,
  preparation: f?.preparation ?? '',
  notes: f?.notes ?? '',
  isEstimate: f?.isEstimate ?? true,
  source: (f?.source ?? 'CUSTOM') as FoodSource,
  imageMediaId: f?.imageMediaId ?? null,
});

export function FoodFormDialog({
  open,
  food,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Food to edit; null/undefined creates a new one. */
  food?: Food | null;
  categories: FoodCategory[];
  onClose: () => void;
  onSaved: (food: Food) => void;
}) {
  const { notify } = useFeedback();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toForm(food),
  });

  useEffect(() => {
    if (open) {
      reset(toForm(food));
      setError(null);
    }
  }, [open, food, reset]);

  const [protein, carbs, fat, calories, source, imageMediaId] = useWatch({
    control,
    name: ['protein', 'carbs', 'fat', 'calories', 'source', 'imageMediaId'],
  });
  const macroKcal = [protein, carbs, fat].every((v) => Number.isFinite(v)) ? caloriesFromMacros({ protein, carbs, fat }) : null;
  const kcalMismatch = macroKcal != null && Number.isFinite(calories) && calories > 0 && Math.abs(macroKcal - calories) / calories > 0.2;

  const submit = handleSubmit(async (v) => {
    setError(null);
    const body = {
      ...v,
      brand: v.brand.trim() || null,
      servingLabel: v.servingLabel.trim() || null,
      preparation: v.preparation.trim() || null,
      notes: v.notes.trim() || null,
    };
    try {
      const saved = food
        ? await api.patch<Food>(`/foods/${food.id}`, body)
        : await api.post<Food>('/foods', {
            ...body,
            source: v.source === 'SEED' ? 'CUSTOM' : v.source,
          });
      notify(food ? 'Food updated' : 'Food added to your library');
      onSaved(saved);
      onClose();
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
    <ResponsiveDialog
      open={open}
      onClose={isSubmitting ? () => undefined : onClose}
      maxWidth="md"
      title={<>{food ? `Edit ${food.name}` : 'New food'}</>}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="food-form" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : food ? 'Save changes' : 'Add food'}
          </Button>
        </>
      }
    >
      <Box component="form" id="food-form" onSubmit={submit} noValidate>
        {food && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Changes apply to future logs and meal plans. Foods already in your diary keep the values they were logged with.
          </Alert>
        )}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 7 }}>
            <TextField size="medium" label="Name" {...muiField(register('name'))} error={!!errors.name} helperText={errors.name?.message} autoFocus />
          </Grid>
          <Grid size={{ xs: 12, sm: 5 }}>
            <TextField size="medium" label="Brand (optional)" {...muiField(register('brand'))} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Controller
              control={control}
              name="categoryIds"
              render={({ field }) => (
                <Autocomplete
                  multiple
                  options={categories}
                  getOptionLabel={(o) => o.name}
                  value={categories.filter((c) => field.value.includes(c.id))}
                  onChange={(_, v) => field.onChange(v.map((c) => c.id))}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderValue={(value, getItemProps) =>
                    value.map((option, index) => {
                      const { key, ...itemProps } = getItemProps({ index });
                      return <Chip key={key} label={option.name} size="small" {...itemProps} />;
                    })
                  }
                  renderInput={(params) => <TextField {...params} label="Categories" placeholder="Choose categories" />}
                />
              )}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Serving — nutrition below is per one serving
            </Typography>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField
              size="medium"
              label="Serving size"
              type="number"
              {...muiField(register('servingSize', { setValueAs: num }))}
              error={!!errors.servingSize}
              helperText={errors.servingSize?.message}
              slotProps={{
                htmlInput: { min: 0, step: 'any', inputMode: 'decimal' },
              }}
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Controller
              control={control}
              name="servingUnit"
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
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField size="medium" label="Serving label (optional)" placeholder="e.g. 1 large egg, 1 cup" {...muiField(register('servingLabel'))} />
          </Grid>

          {numField('calories', 'Calories', 'kcal')}
          {numField('protein', 'Protein', 'g')}
          {numField('carbs', 'Carbs', 'g')}
          {numField('fat', 'Fat', 'g')}
          {numField('fiber', 'Fiber', 'g')}
          {kcalMismatch && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="warning">
                Macros add up to about {fmt(macroKcal)} kcal (4/4/9 kcal per g), which differs from the {fmt(calories)} kcal entered. Double-check the label.
              </Alert>
            </Grid>
          )}

          <Grid size={{ xs: 12, sm: 6 }}>
            <Controller
              control={control}
              name="source"
              render={({ field }) => (
                <TextField size="medium" select label="Source" {...field}>
                  <MenuItem value="CUSTOM">Custom / homemade</MenuItem>
                  <MenuItem value="LABEL">Nutrition label</MenuItem>
                  {source === 'SEED' && <MenuItem value="SEED">Built-in</MenuItem>}
                </TextField>
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
            <Controller
              control={control}
              name="isEstimate"
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                  label="Values are an estimate"
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField size="medium" label="Preparation (optional)" multiline minRows={2} {...muiField(register('preparation'))} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField size="medium" label="Notes (optional)" multiline minRows={2} {...muiField(register('notes'))} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Reference photo (optional)
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              {imageMediaId && <MediaImage mediaId={imageMediaId} alt="Food photo" sx={{ width: 88, height: 88 }} />}
              <MediaUploadButton
                kind="FOOD_REFERENCE"
                label={imageMediaId ? 'Replace photo' : 'Upload photo'}
                size="small"
                onUploaded={(a) => setValue('imageMediaId', a.id, { shouldDirty: true })}
              />
              {imageMediaId && (
                <Button color="inherit" onClick={() => setValue('imageMediaId', null, { shouldDirty: true })} sx={TAP}>
                  Remove photo
                </Button>
              )}
            </Stack>
          </Grid>
        </Grid>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Box>
    </ResponsiveDialog>
  );
}
