import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Box, Button, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { ResponsiveDialog } from '../../components/common/mobile';
import { api, toApiError } from '../../services/api';
import { useFeedback } from '../../components/common/Feedback';
import { MediaImage } from '../media/MediaImage';
import { MediaUploadButton } from '../media/MediaUploadButton';
import { EXERCISE_TYPES, type Exercise, type ExerciseType } from './types';
import { toStrOrNull } from './formUtils';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  type: z.enum(['STRENGTH', 'CARDIO', 'MOBILITY', 'OTHER']),
  muscleGroup: z.string().max(60),
  equipment: z.string().max(60),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

export function ExerciseDialog({
  open,
  exercise,
  onClose,
  onSaved,
}: {
  open: boolean;
  exercise: Exercise | null;
  onClose: () => void;
  onSaved: (e: Exercise) => void;
}) {
  const { notify } = useFeedback();
  const [imageMediaId, setImageMediaId] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const { control, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'STRENGTH', muscleGroup: '', equipment: '', notes: '' },
  });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setImageMediaId(exercise?.imageMediaId ?? null);
    reset({
      name: exercise?.name ?? '',
      type: exercise?.type ?? 'STRENGTH',
      muscleGroup: exercise?.muscleGroup ?? '',
      equipment: exercise?.equipment ?? '',
      notes: exercise?.notes ?? '',
    });
  }, [open, exercise, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    const body = {
      name: v.name.trim(),
      type: v.type as ExerciseType,
      muscleGroup: toStrOrNull(v.muscleGroup),
      equipment: toStrOrNull(v.equipment),
      notes: toStrOrNull(v.notes),
      imageMediaId,
    };
    try {
      const saved = exercise ? await api.patch<Exercise>(`/workouts/exercises/${exercise.id}`, body) : await api.post<Exercise>('/workouts/exercises', body);
      notify(exercise ? 'Exercise updated' : 'Exercise added');
      onSaved(saved);
    } catch (e) {
      setServerError(toApiError(e).message);
    }
  });

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={exercise ? 'Edit exercise' : 'New exercise'}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="exercise-form" variant="contained" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="exercise-form" onSubmit={onSubmit} noValidate>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={{ xs: 12, sm: 8 }}>
              <Controller
                name="name"
                control={control}
                render={({ field, fieldState }) => (
                  <TextField {...field} size="medium" label="Name" required fullWidth autoFocus error={!!fieldState.error} helperText={fieldState.error?.message} />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <TextField {...field} size="medium" select label="Type" fullWidth>
                    {EXERCISE_TYPES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller name="muscleGroup" control={control} render={({ field }) => <TextField {...field} size="medium" label="Muscle group" placeholder="e.g. Chest" fullWidth />} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller name="equipment" control={control} render={({ field }) => <TextField {...field} size="medium" label="Equipment" placeholder="e.g. Barbell" fullWidth />} />
            </Grid>
            <Grid size={12}>
              <Controller
                name="notes"
                control={control}
                render={({ field, fieldState }) => (
                  <TextField {...field} size="medium" label="Form cues / notes" multiline minRows={2} fullWidth error={!!fieldState.error} helperText={fieldState.error?.message} />
                )}
              />
            </Grid>
            <Grid size={12}>
              <Typography variant="subtitle2" gutterBottom>
                Reference image
              </Typography>
              <Stack direction="row" spacing={2} alignItems="flex-start">
                {imageMediaId && (
                  <Box sx={{ width: 96, flexShrink: 0 }}>
                    <MediaImage mediaId={imageMediaId} alt="Exercise reference" />
                  </Box>
                )}
                <Stack spacing={1}>
                  <MediaUploadButton kind="WORKOUT_REFERENCE" label={imageMediaId ? 'Replace image' : 'Add image'} size="small" onUploaded={(a) => setImageMediaId(a.id)} />
                  {imageMediaId && (
                    <Button size="small" color="inherit" onClick={() => setImageMediaId(null)}>
                      Remove image
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Grid>
          </Grid>
          {serverError && (
            <Typography color="error" variant="body2" sx={{ mt: 2 }} role="alert">
              {serverError}
            </Typography>
          )}
      </form>
    </ResponsiveDialog>
  );
}
