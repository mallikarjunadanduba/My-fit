import { Autocomplete, TextField } from '@mui/material';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Exercise } from './types';

export type PickedExercise = { exercise: Exercise } | { name: string };

/**
 * Autocomplete over the (non-archived) exercise library.
 * With `allowFreeText`, a typed name that matches nothing can be used as-is (ad-hoc session entries).
 */
export function ExercisePicker({
  value,
  onChange,
  allowFreeText = false,
  label = 'Exercise',
  autoFocus,
}: {
  value: PickedExercise | null;
  onChange: (v: PickedExercise | null) => void;
  allowFreeText?: boolean;
  label?: string;
  autoFocus?: boolean;
}) {
  const { data, loading, error } = useAsync(() => api.get<Exercise[]>('/workouts/exercises'), []);
  const selected = value && 'exercise' in value ? value.exercise : value && 'name' in value ? value.name : null;

  return (
    <Autocomplete<Exercise | string, false, false, boolean>
      freeSolo={allowFreeText}
      options={data ?? []}
      loading={loading}
      value={selected}
      groupBy={(o) => (typeof o === 'string' ? '' : (o.muscleGroup ?? 'Other'))}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
      isOptionEqualToValue={(o, v) => (typeof o === 'string' || typeof v === 'string' ? o === v : o.id === v.id)}
      onChange={(_e, v) => {
        if (v == null || v === '') onChange(null);
        else if (typeof v === 'string') {
          const match = data?.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
          onChange(match ? { exercise: match } : { name: v.trim() });
        } else onChange({ exercise: v });
      }}
      onInputChange={(_e, text, reason) => {
        if (allowFreeText && reason === 'input') {
          const t = text.trim();
          const match = data?.find((x) => x.name.toLowerCase() === t.toLowerCase());
          onChange(t ? (match ? { exercise: match } : { name: t }) : null);
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          error={!!error}
          helperText={error ? error.message : allowFreeText ? 'Pick from your library or type any name' : undefined}
        />
      )}
    />
  );
}
