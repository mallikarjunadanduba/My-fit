import { useEffect } from 'react';
import { Controller, useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { ResponsiveDialog } from '../../components/common/mobile';
import { CATEGORY_META, CATEGORY_ORDER, CategoryIcon } from '../alarms/categories';
import { DAY_TYPE_LABEL } from '../alarms/format';
import { WeekdayChips } from '../alarms/WeekdayChips';
import type { ActivityCategory } from '../alarms/types';
import type { RoutineItem, RoutineTemplate } from './types';

const reg = (r: UseFormRegisterReturn) => {
  const { ref, ...rest } = r;
  return { ...rest, inputRef: ref };
};

// ───────────── Template (name / day type / weekdays) ─────────────

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Keep it under 80 characters'),
  dayType: z.enum(['ANY', 'GYM', 'REST']),
  weekdays: z.array(z.number().int().min(0).max(6)),
});
export type TemplateValues = z.infer<typeof templateSchema>;

export function TemplateDialog({
  open,
  template,
  defaultDayType = 'GYM',
  onClose,
  onSubmit,
}: {
  open: boolean;
  template: RoutineTemplate | null;
  /** Day type for a new routine (from the tab it is created on). */
  defaultDayType?: 'ANY' | 'GYM' | 'REST';
  onClose: () => void;
  onSubmit: (v: TemplateValues) => Promise<void>;
}) {
  const { control, register, handleSubmit, reset, watch, formState } = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: '', dayType: 'GYM', weekdays: [] },
  });
  useEffect(() => {
    if (open) reset({ name: template?.name ?? '', dayType: template?.dayType ?? defaultDayType, weekdays: template?.weekdays ?? [] });
  }, [open, template, reset, defaultDayType]);
  const weekdays = watch('weekdays');

  return (
    <ResponsiveDialog
      open={open}
      onClose={formState.isSubmitting ? () => undefined : onClose}
      title={template ? 'Edit routine' : 'New routine'}
      actions={
        <>
          <Button onClick={onClose} disabled={formState.isSubmitting} sx={{ minHeight: 48 }}>
            Cancel
          </Button>
          <Button type="submit" form="template-form" variant="contained" disabled={formState.isSubmitting} sx={{ minHeight: 48 }}>
            Save
          </Button>
        </>
      }
    >
      <form id="template-form" noValidate onSubmit={handleSubmit(onSubmit)}>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Name" size="medium" required {...reg(register('name'))} error={!!formState.errors.name} helperText={formState.errors.name?.message} />
            <Stack spacing={1}>
              <FormLabel>Specific weekdays (optional)</FormLabel>
              <Controller name="weekdays" control={control} render={({ field }) => <WeekdayChips value={field.value} onChange={field.onChange} label="Specific weekdays" />} />
              <FormHelperText sx={{ mt: 0 }}>When weekdays are chosen, this routine applies on exactly those days and the day type below is ignored.</FormHelperText>
            </Stack>
            <Controller
              name="dayType"
              control={control}
              render={({ field }) => (
                <TextField select size="medium" label="Applies on" disabled={weekdays.length > 0} {...field} helperText="Gym days come from your gym weekdays in Settings (or a per-day override).">
                  {(Object.keys(DAY_TYPE_LABEL) as (keyof typeof DAY_TYPE_LABEL)[]).map((k) => (
                    <MenuItem key={k} value={k} sx={{ minHeight: 44 }}>
                      {DAY_TYPE_LABEL[k]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Stack>
      </form>
    </ResponsiveDialog>
  );
}

// ───────────── Item ─────────────

const itemSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Keep it under 120 characters'),
  category: z.enum(CATEGORY_ORDER as [ActivityCategory, ...ActivityCategory[]]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time (HH:mm)'),
  notes: z.string().max(1000, 'Keep it under 1000 characters'),
  reminderEnabled: z.boolean(),
  snoozeMinutes: z.number({ invalid_type_error: 'Enter minutes' }).int('Whole minutes only').min(1, 'At least 1 minute').max(120, 'At most 120 minutes'),
});
export type ItemValues = z.infer<typeof itemSchema>;

export function ItemDialog({
  open,
  item,
  defaultSnooze,
  onClose,
  onSubmit,
}: {
  open: boolean;
  item: RoutineItem | null;
  defaultSnooze: number;
  onClose: () => void;
  onSubmit: (v: ItemValues) => Promise<void>;
}) {
  const { control, register, handleSubmit, reset, formState } = useForm<ItemValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: { title: '', category: 'CUSTOM', time: '07:00', notes: '', reminderEnabled: true, snoozeMinutes: defaultSnooze },
  });
  useEffect(() => {
    if (open)
      reset({
        title: item?.title ?? '',
        category: item?.category ?? 'CUSTOM',
        time: item?.time ?? '07:00',
        notes: item?.notes ?? '',
        reminderEnabled: item?.reminderEnabled ?? true,
        snoozeMinutes: item?.snoozeMinutes ?? defaultSnooze,
      });
  }, [open, item, reset, defaultSnooze]);
  const { errors } = formState;

  return (
    <ResponsiveDialog
      open={open}
      onClose={formState.isSubmitting ? () => undefined : onClose}
      title={item ? 'Edit item' : 'Add item'}
      actions={
        <>
          <Button onClick={onClose} disabled={formState.isSubmitting} sx={{ minHeight: 48 }}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" variant="contained" disabled={formState.isSubmitting} sx={{ minHeight: 48 }}>
            Save
          </Button>
        </>
      }
    >
      <form id="item-form" noValidate onSubmit={handleSubmit(onSubmit)}>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField label="Title" size="medium" required {...reg(register('title'))} error={!!errors.title} helperText={errors.title?.message} />
            <Controller
              name="category"
              control={control}
              render={({ field }) => (
                <TextField select size="medium" label="Category" {...field}>
                  {CATEGORY_ORDER.map((c) => (
                    <MenuItem key={c} value={c} sx={{ minHeight: 44 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CategoryIcon category={c} />
                        <span>{CATEGORY_META[c].label}</span>
                      </Stack>
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <TextField
              label="Time"
              type="time"
              size="medium"
              {...reg(register('time'))}
              error={!!errors.time}
              helperText={errors.time?.message}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60 } }}
            />
            <TextField label="Notes (optional)" size="medium" multiline minRows={2} {...reg(register('notes'))} error={!!errors.notes} helperText={errors.notes?.message} />
            <Controller
              name="reminderEnabled"
              control={control}
              render={({ field }) => (
                <FormControlLabel control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />} label="Remind me (alarm + notification)" />
              )}
            />
            <TextField
              label="Snooze length"
              type="number"
              size="medium"
              {...reg(register('snoozeMinutes', { valueAsNumber: true }))}
              error={!!errors.snoozeMinutes}
              helperText={errors.snoozeMinutes?.message ?? '1–120 minutes'}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">min</InputAdornment> }, htmlInput: { min: 1, max: 120, inputMode: 'numeric' } }}
            />
          </Stack>
      </form>
    </ResponsiveDialog>
  );
}

// ───────────── Copy to weekdays ─────────────

const copySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one weekday'),
});
export type CopyValues = z.infer<typeof copySchema>;

export function CopyDialog({
  source,
  onClose,
  onSubmit,
}: {
  source: RoutineTemplate | null;
  onClose: () => void;
  onSubmit: (v: CopyValues) => Promise<void>;
}) {
  const { control, register, handleSubmit, reset, formState } = useForm<CopyValues>({ resolver: zodResolver(copySchema), defaultValues: { name: '', weekdays: [] } });
  useEffect(() => {
    if (source) reset({ name: `${source.name} (copy)`, weekdays: [] });
  }, [source, reset]);

  return (
    <ResponsiveDialog
      open={!!source}
      onClose={formState.isSubmitting ? () => undefined : onClose}
      title="Copy to weekdays"
      actions={
        <>
          <Button onClick={onClose} disabled={formState.isSubmitting} sx={{ minHeight: 48 }}>
            Cancel
          </Button>
          <Button type="submit" form="copy-form" variant="contained" disabled={formState.isSubmitting} sx={{ minHeight: 48 }}>
            Copy
          </Button>
        </>
      }
    >
      <form id="copy-form" noValidate onSubmit={handleSubmit(onSubmit)}>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <FormHelperText sx={{ mt: 0 }}>
              Creates a routine with the same items that applies on the chosen weekdays. If a routine with this name already exists, its items are replaced.
            </FormHelperText>
            <TextField label="Name" size="medium" required {...reg(register('name'))} error={!!formState.errors.name} helperText={formState.errors.name?.message} />
            <Stack spacing={1}>
              <FormLabel>Weekdays</FormLabel>
              <Controller name="weekdays" control={control} render={({ field }) => <WeekdayChips value={field.value} onChange={field.onChange} />} />
              {formState.errors.weekdays && <FormHelperText error>{formState.errors.weekdays.message}</FormHelperText>}
            </Stack>
          </Stack>
      </form>
    </ResponsiveDialog>
  );
}
