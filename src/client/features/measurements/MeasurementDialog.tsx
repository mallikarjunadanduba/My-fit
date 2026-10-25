import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Grid, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { ResponsiveDialog } from '../../components/common/mobile';
import { api, toApiError } from '../../services/api';
import { useFeedback } from '../../components/common/Feedback';
import { MediaImage } from '../media/MediaImage';
import { MediaUploadButton } from '../media/MediaUploadButton';
import { useMediaStatus } from '../media/mediaApi';
import { optionalNumber, numToField, toNumOrNull } from '../workouts/formUtils';
import { METRICS, type Measurement, type MetricKey } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z
  .object({
    date: z.string().regex(DATE_RE, 'Pick a date'),
    notes: z.string().max(1000),
    ...(Object.fromEntries(METRICS.map((m) => [m.key, optionalNumber(m.min, m.max)])) as Record<MetricKey, ReturnType<typeof optionalNumber>>),
  });
type FormValues = z.infer<typeof schema>;

const emptyValues = (date: string): FormValues => ({
  date,
  notes: '',
  ...(Object.fromEntries(METRICS.map((m) => [m.key, ''])) as Record<MetricKey, string>),
});

export function MeasurementDialog({
  open,
  measurement,
  defaultDate,
  onClose,
  onSaved,
}: {
  open: boolean;
  measurement: Measurement | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useFeedback();
  const { status: mediaStatus } = useMediaStatus();
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: emptyValues(defaultDate) });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setPhotoId(measurement?.photoMediaId ?? null);
    reset(
      measurement
        ? {
            date: measurement.date,
            notes: measurement.notes ?? '',
            ...(Object.fromEntries(METRICS.map((m) => [m.key, numToField(measurement[m.key])])) as Record<MetricKey, string>),
          }
        : emptyValues(defaultDate),
    );
  }, [open, measurement, defaultDate, reset]);

  const submit = handleSubmit(async (v) => {
    setServerError(null);
    const metrics = Object.fromEntries(METRICS.map((m) => [m.key, toNumOrNull(v[m.key])])) as Record<MetricKey, number | null>;
    if (Object.values(metrics).every((x) => x == null) && !photoId) {
      setServerError('Enter at least one measurement or attach a progress photo.');
      return;
    }
    const body = { date: v.date, notes: v.notes.trim() || null, photoMediaId: photoId, ...metrics };
    try {
      if (measurement) await api.patch(`/measurements/${measurement.id}`, body);
      else await api.post('/measurements', body);
      notify(measurement ? 'Measurement updated' : 'Measurement saved');
      onSaved();
    } catch (e) {
      setServerError(toApiError(e).message);
    }
  });

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={measurement ? 'Edit measurement' : 'Add measurement'}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="measurement-form" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="measurement-form" onSubmit={submit} noValidate style={{ paddingTop: 8 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                name="date"
                control={control}
                render={({ field, fieldState }) => (
                  <TextField {...field} size="medium" type="date" label="Date" required fullWidth error={!!fieldState.error} helperText={fieldState.error?.message} slotProps={{ inputLabel: { shrink: true } }} />
                )}
              />
            </Grid>
            {METRICS.map((m) => (
              <Grid key={m.key} size={{ xs: m.key === 'weightKg' ? 12 : 6, sm: m.key === 'weightKg' ? 6 : 4 }}>
                <Controller
                  name={m.key}
                  control={control}
                  render={({ field, fieldState }) => (
                    <TextField
                      {...field}
                      label={m.label}
                      size="medium"
                      type="number"
                      fullWidth
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message}
                      slotProps={{
                        input: { endAdornment: <InputAdornment position="end">{m.unit}</InputAdornment> },
                        htmlInput: { min: m.min, max: m.max, step: m.step, inputMode: 'decimal' },
                      }}
                    />
                  )}
                />
              </Grid>
            ))}
            <Grid size={12}>
              <Controller name="notes" control={control} render={({ field }) => <TextField {...field} size="medium" label="Notes" fullWidth multiline minRows={2} placeholder="e.g. morning, before breakfast" />} />
            </Grid>
            <Grid size={12}>
              <Typography variant="subtitle2" gutterBottom>
                Progress photo (optional)
              </Typography>
              {mediaStatus && !mediaStatus.configured ? (
                <Alert severity="info">Photo storage isn't configured on the server, so photos can't be attached right now.</Alert>
              ) : (
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  {photoId && (
                    <Box sx={{ width: 110, flexShrink: 0 }}>
                      <MediaImage mediaId={photoId} alt="Attached progress photo" />
                    </Box>
                  )}
                  <Stack spacing={1}>
                    <MediaUploadButton kind="PROGRESS_PHOTO" label={photoId ? 'Replace photo' : 'Attach photo'} onUploaded={(a) => setPhotoId(a.id)} />
                    {photoId && (
                      <Button size="small" color="inherit" onClick={() => setPhotoId(null)}>
                        Detach photo
                      </Button>
                    )}
                    {photoId && (
                      <Typography variant="caption" color="text.secondary">
                        Detaching keeps the photo in your gallery.
                      </Typography>
                    )}
                  </Stack>
                </Stack>
              )}
            </Grid>
          </Grid>
          {serverError && (
            <Alert severity="error" sx={{ mt: 2 }} role="alert">
              {serverError}
            </Alert>
          )}
      </form>
    </ResponsiveDialog>
  );
}
