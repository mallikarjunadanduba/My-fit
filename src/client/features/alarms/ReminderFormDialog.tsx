import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Button,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  InputAdornment,
  Link,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { ResponsiveDialog } from '../../components/common/mobile';
import { api, toApiError } from '../../services/api';
import { todayIn } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { CATEGORY_META, CATEGORY_ORDER, CategoryIcon } from './categories';
import { DAY_TYPE_LABEL } from './format';
import { WeekdayChips } from './WeekdayChips';
import type { ActivityCategory, Reminder } from './types';

const schema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120, 'Keep it under 120 characters'),
    description: z.string().max(1000, 'Keep it under 1000 characters'),
    category: z.enum(CATEGORY_ORDER as [ActivityCategory, ...ActivityCategory[]]),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time (HH:mm)'),
    mode: z.enum(['repeat', 'once']),
    weekdays: z.array(z.number().int().min(0).max(6)),
    oneTimeDate: z.string(),
    dayType: z.enum(['ANY', 'GYM', 'REST']),
    snoozeMinutes: z.number({ invalid_type_error: 'Enter minutes' }).int('Whole minutes only').min(1, 'At least 1 minute').max(120, 'At most 120 minutes'),
    sound: z.boolean(),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(v.oneTimeDate)) ctx.addIssue({ code: 'custom', path: ['oneTimeDate'], message: 'Pick a date' });
  });

type Values = z.infer<typeof schema>;

function defaults(r: Reminder | null, snooze: number): Values {
  return {
    title: r?.title ?? '',
    description: r?.description ?? '',
    category: r?.category ?? 'CUSTOM',
    time: r?.time ?? '07:00',
    mode: r?.oneTimeDate ? 'once' : 'repeat',
    weekdays: r?.weekdays ?? [],
    oneTimeDate: r?.oneTimeDate ?? '',
    dayType: r?.dayType ?? 'ANY',
    snoozeMinutes: r?.snoozeMinutes ?? snooze,
    sound: r?.sound ?? true,
    enabled: r?.enabled ?? true,
  };
}

/** Create / edit a reminder. Routine-linked reminders only allow alert settings; their schedule follows the routine item. */
export function ReminderFormDialog({ open, reminder, onClose, onSaved }: { open: boolean; reminder: Reminder | null; onClose: () => void; onSaved: (r: Reminder) => void }) {
  const { settings, timezone } = useAuth();
  const { notify } = useFeedback();
  const linked = Boolean(reminder?.routineItemId);
  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults(reminder, settings?.defaultSnoozeMinutes ?? 10) });

  useEffect(() => {
    if (open) reset(defaults(reminder, settings?.defaultSnoozeMinutes ?? 10));
  }, [open, reminder, reset, settings?.defaultSnoozeMinutes]);

  const mode = watch('mode');

  const onSubmit = async (v: Values) => {
    const common = { description: v.description.trim() || null, snoozeMinutes: v.snoozeMinutes, sound: v.sound, enabled: v.enabled };
    const schedule = linked
      ? {}
      : {
          title: v.title,
          category: v.category,
          time: v.time,
          weekdays: v.mode === 'repeat' ? v.weekdays : [],
          oneTimeDate: v.mode === 'once' ? v.oneTimeDate : null,
          dayType: v.mode === 'repeat' ? v.dayType : 'ANY',
        };
    try {
      const saved = reminder
        ? await api.patch<Reminder>(`/reminders/${reminder.id}`, { ...common, ...schedule })
        : await api.post<Reminder>('/reminders', { ...common, ...schedule });
      notify(reminder ? 'Reminder updated' : 'Reminder created');
      onSaved(saved);
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const reg = (name: keyof Values, opts?: Parameters<typeof register>[1]) => {
    const { ref, ...rest } = register(name, opts);
    return { ...rest, inputRef: ref };
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={isSubmitting ? () => undefined : onClose}
      title={reminder ? 'Edit reminder' : 'New reminder'}
      actions={
        <>
          <Button onClick={onClose} disabled={isSubmitting} sx={{ minHeight: 48 }}>
            Cancel
          </Button>
          <Button type="submit" form="reminder-form" variant="contained" disabled={isSubmitting} sx={{ minHeight: 48 }}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="reminder-form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {linked && (
              <Alert severity="info">
                This reminder belongs to an item of your{' '}
                <Link component={RouterLink} to="/routine?tab=gym">
                  daily routine
                </Link>
                . Change its title, time or days there; here you can adjust the alert itself.
              </Alert>
            )}
            <TextField
              label="Time"
              type="time"
              size="medium"
              disabled={linked}
              {...reg('time')}
              error={!!errors.time}
              helperText={errors.time?.message ?? `Your timezone: ${timezone}`}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60, style: { fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums' } } }}
            />
            <TextField label="Title" required size="medium" disabled={linked} {...reg('title')} error={!!errors.title} helperText={errors.title?.message} />
            <TextField
              label="Note (optional)"
              size="medium"
              multiline
              minRows={2}
              {...reg('description')}
              error={!!errors.description}
              helperText={errors.description?.message ?? 'Shown in the notification.'}
            />
              <Controller
                name="category"
                control={control}
                render={({ field }) => (
                  <TextField select label="Category" size="medium" disabled={linked} {...field}>
                    {CATEGORY_ORDER.map((c) => (
                      <MenuItem key={c} value={c}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <CategoryIcon category={c} />
                          <span>{CATEGORY_META[c].label}</span>
                        </Stack>
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />

            {!linked && (
              <Stack spacing={1.5}>
                <FormLabel id="repeat-mode">Repeat</FormLabel>
                <Controller
                  name="mode"
                  control={control}
                  render={({ field }) => (
                    <ToggleButtonGroup exclusive fullWidth color="primary" value={field.value} onChange={(_, v) => v && field.onChange(v)} aria-labelledby="repeat-mode">
                      <ToggleButton value="repeat" sx={{ minHeight: 44, px: 2 }}>
                        Repeating
                      </ToggleButton>
                      <ToggleButton value="once" sx={{ minHeight: 44, px: 2 }}>
                        One time
                      </ToggleButton>
                    </ToggleButtonGroup>
                  )}
                />
                {mode === 'repeat' ? (
                  <>
                    <Controller name="weekdays" control={control} render={({ field }) => <WeekdayChips value={field.value} onChange={field.onChange} label="Repeat on" />} />
                    <FormHelperText sx={{ mt: 0 }}>No day selected = every day.</FormHelperText>
                    <Controller
                      name="dayType"
                      control={control}
                      render={({ field }) => (
                        <TextField select label="Only on" size="medium" {...field} helperText="Gym/rest days follow your gym weekdays in Settings.">
                          {(Object.keys(DAY_TYPE_LABEL) as (keyof typeof DAY_TYPE_LABEL)[]).map((k) => (
                            <MenuItem key={k} value={k}>
                              {DAY_TYPE_LABEL[k]}
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    />
                  </>
                ) : (
                  <TextField
                    label="Date"
                    type="date"
                    size="medium"
                    {...reg('oneTimeDate')}
                    error={!!errors.oneTimeDate}
                    helperText={errors.oneTimeDate?.message}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayIn(timezone) } }}
                  />
                )}
              </Stack>
            )}

            <TextField
              label="Snooze length"
              type="number"
              size="medium"
              {...reg('snoozeMinutes', { valueAsNumber: true })}
              error={!!errors.snoozeMinutes}
              helperText={errors.snoozeMinutes?.message ?? '1–120 minutes'}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">min</InputAdornment> }, htmlInput: { min: 1, max: 120, inputMode: 'numeric' } }}
            />
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Controller
                name="sound"
                control={control}
                render={({ field }) => <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Play sound in app" />}
              />
              <Controller
                name="enabled"
                control={control}
                render={({ field }) => <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Enabled" />}
              />
            </Stack>
          </Stack>
      </form>
    </ResponsiveDialog>
  );
}
