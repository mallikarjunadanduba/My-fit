import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, FormControlLabel, Grid, MenuItem, Switch, TextField, Typography } from '@mui/material';
import { ResponsiveDialog } from '../../components/common/mobile';
import { api, toApiError } from '../../services/api';
import { WEEKDAYS_SHORT } from '../../services/dates';
import { ExercisePicker, type PickedExercise } from './ExercisePicker';
import { numToField, optionalNumber, toNumOrNull, toStrOrNull } from './formUtils';
import type { DayExercise, Plan, WorkoutDay } from './types';

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Monday-first order for pickers.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const weekdayLabel = (w: number | null) => (w == null ? 'Unscheduled' : WEEKDAY_LONG[w]);
export const weekdayShort = (w: number | null) => (w == null ? '—' : WEEKDAYS_SHORT[w]);

function ServerError({ message }: { message: string | null }) {
  return message ? (
    <Typography color="error" variant="body2" role="alert" sx={{ mt: 2 }}>
      {message}
    </Typography>
  ) : null;
}

// ── Plan ──

const planSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(100), description: z.string().max(1000) });

export function PlanDialog({ open, plan, onClose, onSaved }: { open: boolean; plan: Plan | null; onClose: () => void; onSaved: (p: Plan) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<z.infer<typeof planSchema>>({ resolver: zodResolver(planSchema), defaultValues: { name: '', description: '' } });
  useEffect(() => {
    if (open) {
      setErr(null);
      reset({ name: plan?.name ?? '', description: plan?.description ?? '' });
    }
  }, [open, plan, reset]);
  const submit = handleSubmit(async (v) => {
    try {
      const body = { name: v.name.trim(), description: toStrOrNull(v.description) };
      onSaved(plan ? await api.patch<Plan>(`/workouts/plans/${plan.id}`, body) : await api.post<Plan>('/workouts/plans', body));
    } catch (e) {
      setErr(toApiError(e).message);
    }
  });
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={plan ? 'Edit plan' : 'New plan'}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plan-form-1" variant="contained" disabled={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="plan-form-1" onSubmit={submit} noValidate style={{ paddingTop: 8 }}>
          <Controller
            name="name"
            control={control}
            render={({ field, fieldState }) => <TextField {...field} size="medium" label="Plan name" required fullWidth autoFocus sx={{ mb: 2 }} error={!!fieldState.error} helperText={fieldState.error?.message} />}
          />
          <Controller name="description" control={control} render={({ field }) => <TextField {...field} size="medium" label="Description" fullWidth multiline minRows={2} />} />
          <ServerError message={err} />
      </form>
    </ResponsiveDialog>
  );
}

// ── Day ──

const daySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  weekday: z.string(),
  isRestDay: z.boolean(),
  notes: z.string().max(1000),
});

export function DayDialog({
  open,
  planId,
  day,
  takenWeekdays,
  onClose,
  onSaved,
}: {
  open: boolean;
  planId: string;
  day: WorkoutDay | null;
  takenWeekdays: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<z.infer<typeof daySchema>>({
    resolver: zodResolver(daySchema),
    defaultValues: { name: '', weekday: '', isRestDay: false, notes: '' },
  });
  useEffect(() => {
    if (open) {
      setErr(null);
      reset({ name: day?.name ?? '', weekday: day?.weekday == null ? '' : String(day.weekday), isRestDay: day?.isRestDay ?? false, notes: day?.notes ?? '' });
    }
  }, [open, day, reset]);
  const submit = handleSubmit(async (v) => {
    const body = { name: v.name.trim(), weekday: v.weekday === '' ? null : Number(v.weekday), isRestDay: v.isRestDay, notes: toStrOrNull(v.notes) };
    try {
      if (day) await api.patch(`/workouts/days/${day.id}`, body);
      else await api.post(`/workouts/plans/${planId}/days`, body);
      onSaved();
    } catch (e) {
      setErr(toApiError(e).message);
    }
  });
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={day ? 'Edit day' : 'Add day'}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plan-form-2" variant="contained" disabled={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="plan-form-2" onSubmit={submit} noValidate style={{ paddingTop: 8 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 7 }}>
              <Controller
                name="name"
                control={control}
                render={({ field, fieldState }) => (
                  <TextField {...field} size="medium" label="Day name" placeholder="e.g. Push, Legs, Rest" required fullWidth autoFocus error={!!fieldState.error} helperText={fieldState.error?.message} />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <Controller
                name="weekday"
                control={control}
                render={({ field }) => (
                  <TextField {...field} size="medium" select label="Weekday" fullWidth>
                    <MenuItem value="">Unscheduled</MenuItem>
                    {WEEKDAY_ORDER.map((w) => (
                      <MenuItem key={w} value={String(w)} disabled={takenWeekdays.includes(w) && day?.weekday !== w}>
                        {WEEKDAY_LONG[w]}
                        {takenWeekdays.includes(w) && day?.weekday !== w ? ' (used)' : ''}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid size={12}>
              <Controller
                name="isRestDay"
                control={control}
                render={({ field }) => <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Rest day" />}
              />
            </Grid>
            <Grid size={12}>
              <Controller name="notes" control={control} render={({ field }) => <TextField {...field} size="medium" label="Notes" fullWidth multiline minRows={2} />} />
            </Grid>
          </Grid>
          <ServerError message={err} />
      </form>
    </ResponsiveDialog>
  );
}

// ── Day exercise (targets) ──

const targetSchema = z.object({
  targetSets: optionalNumber(1, 20, { integer: true }),
  targetReps: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\w\s\-–+/x]*$/i, 'Use something like "8-10", "12" or "AMRAP"'),
  targetWeightKg: optionalNumber(0, 1000),
  targetDurationSec: optionalNumber(0, 86400, { integer: true }),
  restSec: optionalNumber(0, 3600, { integer: true }),
  notes: z.string().max(500),
});

export function DayExerciseDialog({
  open,
  dayId,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  dayId: string;
  item: DayExercise | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedExercise | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<z.infer<typeof targetSchema>>({
    resolver: zodResolver(targetSchema),
    defaultValues: { targetSets: '3', targetReps: '8-12', targetWeightKg: '', targetDurationSec: '', restSec: '90', notes: '' },
  });
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setPicked(item ? { exercise: { ...item.exercise, equipment: null, notes: null } } : null);
    reset(
      item
        ? {
            targetSets: numToField(item.targetSets),
            targetReps: item.targetReps ?? '',
            targetWeightKg: numToField(item.targetWeightKg),
            targetDurationSec: numToField(item.targetDurationSec),
            restSec: numToField(item.restSec),
            notes: item.notes ?? '',
          }
        : { targetSets: '3', targetReps: '8-12', targetWeightKg: '', targetDurationSec: '', restSec: '90', notes: '' },
    );
  }, [open, item, reset]);

  const submit = handleSubmit(async (v) => {
    if (!picked || !('exercise' in picked)) {
      setErr('Choose an exercise from your library (add new ones in the Exercise library tab).');
      return;
    }
    const body = {
      exerciseId: picked.exercise.id,
      targetSets: toNumOrNull(v.targetSets),
      targetReps: toStrOrNull(v.targetReps),
      targetWeightKg: toNumOrNull(v.targetWeightKg),
      targetDurationSec: toNumOrNull(v.targetDurationSec),
      restSec: toNumOrNull(v.restSec),
      notes: toStrOrNull(v.notes),
    };
    try {
      if (item) await api.patch(`/workouts/day-exercises/${item.id}`, body);
      else await api.post(`/workouts/days/${dayId}/exercises`, body);
      onSaved();
    } catch (e) {
      setErr(toApiError(e).message);
    }
  });

  const num = (name: 'targetSets' | 'targetWeightKg' | 'targetDurationSec' | 'restSec', label: string, step = '1') => (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <TextField {...field} size="medium" label={label} type="number" fullWidth error={!!fieldState.error} helperText={fieldState.error?.message} slotProps={{ htmlInput: { min: 0, step, inputMode: 'decimal' } }} />
      )}
    />
  );

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={item ? 'Edit planned exercise' : 'Add exercise to day'}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="plan-form-3" variant="contained" disabled={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="plan-form-3" onSubmit={submit} noValidate style={{ paddingTop: 8 }}>
          <Grid container spacing={2}>
            <Grid size={12}>
              <ExercisePicker value={picked} onChange={setPicked} autoFocus={!item} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>{num('targetSets', 'Sets')}</Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <Controller
                name="targetReps"
                control={control}
                render={({ field, fieldState }) => <TextField {...field} size="medium" label="Reps" placeholder="8-12" fullWidth error={!!fieldState.error} helperText={fieldState.error?.message} />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>{num('targetWeightKg', 'Weight (kg)', '0.5')}</Grid>
            <Grid size={{ xs: 6, sm: 6 }}>{num('targetDurationSec', 'Duration (sec)')}</Grid>
            <Grid size={{ xs: 12, sm: 6 }}>{num('restSec', 'Rest between sets (sec)', '5')}</Grid>
            <Grid size={12}>
              <Controller name="notes" control={control} render={({ field }) => <TextField {...field} size="medium" label="Notes" fullWidth />} />
            </Grid>
          </Grid>
          <ServerError message={err} />
      </form>
    </ResponsiveDialog>
  );
}
