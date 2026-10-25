import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  Button,
  Card,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import TrackChangesRoundedIcon from '@mui/icons-material/TrackChangesRounded';
import { api, toApiError } from '../../services/api';
import { formatDay, todayIn } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { EmptyState } from '../../components/common/States';
import { ResponsiveDialog } from '../../components/common/mobile';
import { nutrientColors } from '../../theme/theme';
import { apiErrorMessage, mui } from './formUtils';
import { RowMenu, SettingsGroup } from './SettingsGroup';
import type { NutritionTarget, TargetsBundle } from './types';

const ROWS = [
  { key: 'calories', min: 'caloriesMin', max: 'caloriesMax', label: 'Calories', unit: 'kcal', color: nutrientColors.calories, int: false },
  { key: 'protein', min: 'proteinMin', max: 'proteinMax', label: 'Protein', unit: 'g', color: nutrientColors.protein, int: false },
  { key: 'carbs', min: 'carbsMin', max: 'carbsMax', label: 'Carbs', unit: 'g', color: nutrientColors.carbs, int: false },
  { key: 'fat', min: 'fatMin', max: 'fatMax', label: 'Fat', unit: 'g', color: nutrientColors.fat, int: false },
  { key: 'fiber', min: 'fiberMin', max: 'fiberMax', label: 'Fiber', unit: 'g', color: nutrientColors.fiber, int: false },
  { key: 'waterMl', min: 'waterMinMl', max: 'waterMaxMl', label: 'Water', unit: 'ml', color: nutrientColors.water, int: true },
] as const;

type RowKey = (typeof ROWS)[number]['key'] | (typeof ROWS)[number]['min'] | (typeof ROWS)[number]['max'];

const isNum = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
const required = z.string().trim().min(1, 'Required').refine(isNum, 'Enter a number ≥ 0');
const optional = z.string().trim().refine((v) => v === '' || isNum(v), 'Enter a number ≥ 0');

const schema = z
  .object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
    notes: z.string().max(1000),
    calories: required,
    caloriesMin: optional,
    caloriesMax: optional,
    protein: required,
    proteinMin: optional,
    proteinMax: optional,
    carbs: required,
    carbsMin: optional,
    carbsMax: optional,
    fat: required,
    fatMin: optional,
    fatMax: optional,
    fiber: required,
    fiberMin: optional,
    fiberMax: optional,
    waterMl: required.refine((v) => Number.isInteger(Number(v)), 'Whole millilitres'),
    waterMinMl: optional.refine((v) => v === '' || Number.isInteger(Number(v)), 'Whole millilitres'),
    waterMaxMl: optional.refine((v) => v === '' || Number.isInteger(Number(v)), 'Whole millilitres'),
  })
  .superRefine((v, ctx) => {
    for (const r of ROWS) {
      const t = Number(v[r.key]);
      if (!isNum(v[r.key])) continue;
      if (isNum(v[r.min]) && Number(v[r.min]) > t) ctx.addIssue({ code: 'custom', path: [r.min], message: 'Min must be ≤ target' });
      if (isNum(v[r.max]) && Number(v[r.max]) < t) ctx.addIssue({ code: 'custom', path: [r.max], message: 'Max must be ≥ target' });
    }
  });
type Values = z.infer<typeof schema>;

const str = (n: number | null | undefined) => (n == null ? '' : String(n));
const fmt = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
function toValues(t: NutritionTarget | null, effectiveFrom: string): Values {
  const v = { effectiveFrom, notes: t?.notes ?? '' } as Values;
  for (const r of ROWS) {
    v[r.key] = str(t?.[r.key]);
    v[r.min] = str(t?.[r.min]);
    v[r.max] = str(t?.[r.max]);
  }
  return v;
}

/** Display value: kcal/g as-is, water in litres. */
const show = (key: (typeof ROWS)[number]['key'], n: number | null) => (key === 'waterMl' && n != null ? fmt(n / 1000) : fmt(n));
const showUnit = (r: (typeof ROWS)[number]) => (r.key === 'waterMl' ? 'L' : r.unit);
const rangeText = (t: NutritionTarget, r: (typeof ROWS)[number]) => {
  const lo = t[r.min];
  const hi = t[r.max];
  if (lo == null && hi == null) return null;
  if (lo === hi) return `exactly ${show(r.key, lo)}`;
  return `${show(r.key, lo)}–${show(r.key, hi)}`;
};

/** Hero card: the targets in force today, numbers first. */
function CurrentTargets({ target, onEdit }: { target: NutritionTarget; onEdit: () => void }) {
  const [cal, ...rest] = ROWS;
  const calRange = rangeText(target, cal);
  return (
    <Card sx={{ mb: 3 }}>
      <Box sx={{ p: 2, pb: 1.5 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={600}>
              In force since {formatDay(target.effectiveFrom, 'd MMM yyyy')}
            </Typography>
            <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.5 }}>
              <Typography sx={{ fontSize: 40, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', color: cal.color }}>
                {fmt(target.calories)}
              </Typography>
              <Typography color="text.secondary" fontWeight={700}>
                kcal
              </Typography>
            </Stack>
            {calRange && (
              <Typography variant="body2" color="text.secondary">
                Range {calRange} kcal
              </Typography>
            )}
          </Box>
          <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={onEdit} sx={{ flexShrink: 0, minHeight: 40 }}>
            Edit
          </Button>
        </Stack>
      </Box>
      <Divider />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' } }}>
        {rest.map((r, i) => {
          const rr = rangeText(target, r);
          const lastOdd = i === rest.length - 1 && rest.length % 2 === 1;
          return (
            <Box
              key={r.key}
              sx={{
                p: 1.75,
                borderColor: 'divider',
                borderStyle: 'solid',
                borderWidth: 0,
                borderTopWidth: { xs: i >= 2 ? 1 : 0, sm: 0 },
                borderLeftWidth: { xs: i % 2 === 1 ? 1 : 0, sm: i > 0 ? 1 : 0 },
                gridColumn: { xs: lastOdd ? 'span 2' : 'auto', sm: 'auto' },
              }}
            >
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: r.color }} aria-hidden />
                <Typography variant="body2" color="text.secondary" fontWeight={600}>
                  {r.label}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 22, fontWeight: 800, mt: 0.25 }}>
                {show(r.key, target[r.key])}
                <Typography component="span" color="text.secondary" fontWeight={600} sx={{ fontSize: 14, ml: 0.5 }}>
                  {showUnit(r)}
                </Typography>
              </Typography>
              {rr && (
                <Typography variant="caption" color="text.secondary">
                  {rr} {showUnit(r)}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}

export function TargetsSection({ targets, onChanged }: { targets: TargetsBundle; onChanged: () => void }) {
  const current = targets.current;
  const { timezone } = useAuth();
  const { notify, confirm } = useFeedback();
  const today = todayIn(timezone);
  const [editorOpen, setEditorOpen] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(current, today) });

  const effectiveFrom = watch('effectiveFrom');
  const waterMl = watch('waterMl');
  const replacing = useMemo(() => targets.history.find((t) => t.effectiveFrom === effectiveFrom), [targets.history, effectiveFrom]);

  const openEditor = (t: NutritionTarget | null, date: string) => {
    reset(toValues(t, date));
    setEditorOpen(true);
  };

  const onSubmit = async (v: Values) => {
    const body: Record<string, unknown> = { effectiveFrom: v.effectiveFrom, notes: v.notes.trim() || null };
    for (const r of ROWS) {
      body[r.key] = Number(v[r.key]);
      body[r.min] = v[r.min] === '' ? null : Number(v[r.min]);
      body[r.max] = v[r.max] === '' ? null : Number(v[r.max]);
    }
    try {
      await api.post('/settings/targets', body);
      notify(replacing ? `Target effective ${formatDay(v.effectiveFrom)} updated` : `New target saved from ${formatDay(v.effectiveFrom)}`);
      setEditorOpen(false);
      onChanged();
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const remove = async (t: NutritionTarget) => {
    const ok = await confirm({
      title: 'Delete this target version?',
      message: `Days from ${formatDay(t.effectiveFrom)} will fall back to the previous version. This cannot be undone.`,
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/targets/${t.id}`);
      notify('Target version deleted');
      onChanged();
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const field = (name: RowKey, label: string, emphasis = false) => (
    <TextField
      label={label}
      size="medium"
      {...mui(register(name))}
      error={!!errors[name]}
      helperText={errors[name]?.message}
      slotProps={{
        htmlInput: { inputMode: 'decimal', enterKeyHint: 'next', autoComplete: 'off' },
        inputLabel: { shrink: true },
      }}
      sx={emphasis ? { '& .MuiInputBase-input': { fontWeight: 700 } } : undefined}
    />
  );

  const submit = handleSubmit(onSubmit);

  return (
    <>
      {current ? (
        <CurrentTargets target={current} onEdit={() => openEditor(current, today)} />
      ) : (
        <Card sx={{ mb: 3 }}>
          <EmptyState
            icon={<TrackChangesRoundedIcon fontSize="inherit" />}
            title="No nutrition targets yet"
            description="Enter the targets from your coach to start tracking progress."
            action={
              <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openEditor(null, today)} sx={{ minHeight: 44 }}>
                Set targets
              </Button>
            }
          />
        </Card>
      )}

      {targets.history.length > 0 && (
        <SettingsGroup
          title="Versions"
          action={
            <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => openEditor(current, today)} sx={{ minHeight: 36 }}>
              New version
            </Button>
          }
          footer="Targets never change automatically. Each save applies from its date — past days keep the target that was in force then."
        >
          <List disablePadding>
            {targets.history.map((t, i) => {
              const inForce = current?.id === t.id;
              return (
                <Box component="li" key={t.id} sx={{ listStyle: 'none' }}>
                  {i > 0 && <Divider />}
                  <ListItem
                    component="div"
                    disablePadding
                    secondaryAction={
                      <RowMenu
                        label={`Options for target effective ${t.effectiveFrom}`}
                        items={[
                          { label: 'Edit this version', icon: <EditRoundedIcon fontSize="small" />, onClick: () => openEditor(t, t.effectiveFrom) },
                          {
                            label: 'Delete version',
                            icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                            destructive: true,
                            disabled: targets.history.length <= 1,
                            onClick: () => void remove(t),
                          },
                        ]}
                      />
                    }
                  >
                    <ListItemButton onClick={() => openEditor(t, t.effectiveFrom)} sx={{ minHeight: 64, pr: 7 }}>
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography component="span" fontWeight={700}>
                              {formatDay(t.effectiveFrom, 'd MMM yyyy')}
                            </Typography>
                            {inForce && <Chip size="small" color="primary" label="In force" />}
                            {t.effectiveFrom > today && <Chip size="small" label="Scheduled" />}
                          </Stack>
                        }
                        secondary={
                          <>
                            {fmt(t.calories)} kcal · P {fmt(t.protein)} · C {fmt(t.carbs)} · F {fmt(t.fat)} · Fib {fmt(t.fiber)} · {fmt(t.waterMl / 1000)} L
                            {t.notes && (
                              <Box component="span" sx={{ display: 'block', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.notes}
                              </Box>
                            )}
                          </>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                </Box>
              );
            })}
          </List>
        </SettingsGroup>
      )}

      <ResponsiveDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={replacing ? 'Edit targets' : 'New targets'}
        headerAction={
          <Button onClick={() => void submit()} disabled={isSubmitting} sx={{ fontWeight: 700, minHeight: 44 }}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        }
        actions={
          <>
            <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => void submit()} disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : replacing ? 'Update version' : 'Save new version'}
            </Button>
          </>
        }
      >
        <Box component="form" onSubmit={submit} noValidate>
          <TextField
            label="Effective from"
            type="date"
            size="medium"
            {...mui(register('effectiveFrom'))}
            error={!!errors.effectiveFrom}
            helperText={
              errors.effectiveFrom?.message ??
              (replacing ? `Replaces the version from ${formatDay(effectiveFrom, 'd MMM yyyy')}` : 'Creates a new version from this date')
            }
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ mt: 1 }}
          />

          {ROWS.map((r) => (
            <Box key={r.key} component="fieldset" sx={{ border: 0, p: 0, m: 0, mt: 2.5, minWidth: 0 }}>
              <Stack component="legend" direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25, p: 0 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: r.color }} aria-hidden />
                <Typography component="span" fontWeight={700}>
                  {r.label}
                </Typography>
                <Typography component="span" variant="body2" color="text.secondary">
                  {r.unit}
                </Typography>
              </Stack>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: 1 }}>
                {field(r.min, 'Min')}
                {field(r.key, 'Target', true)}
                {field(r.max, 'Max')}
              </Box>
              {r.key === 'waterMl' && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25 }}>
                  <Typography variant="body2" color="text.secondary">
                    Quick:
                  </Typography>
                  {[2500, 3000, 3500].map((ml) => (
                    <Chip
                      key={ml}
                      label={`${ml / 1000} L`}
                      color={Number(waterMl) === ml ? 'primary' : 'default'}
                      variant={Number(waterMl) === ml ? 'filled' : 'outlined'}
                      onClick={() => setValue('waterMl', String(ml), { shouldDirty: true, shouldValidate: true })}
                    />
                  ))}
                </Stack>
              )}
            </Box>
          ))}

          <Controller
            control={control}
            name="notes"
            render={({ field: f }) => (
              <TextField {...f} size="medium" label="Notes (optional)" multiline minRows={2} placeholder="e.g. Updated by coach after check-in" sx={{ mt: 3 }} />
            )}
          />
          {/* Lets the keyboard's "Go" key submit the form. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </Box>
      </ResponsiveDialog>
    </>
  );
}
