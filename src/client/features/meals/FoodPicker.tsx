import { useEffect, useState } from 'react';
import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { api } from '../../services/api';
import type { Food } from '../foods/types';
import { servingText } from '../foods/format';
import type { TemplateFood } from './types';

/** Async food search (name/brand) for picking a food from the library. */
export function FoodPicker({
  value,
  onChange,
  label = 'Food',
  error,
}: {
  value: TemplateFood | null;
  onChange: (f: TemplateFood | null) => void;
  label?: string;
  error?: string;
}) {
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<TemplateFood[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .getPaged<Food[]>('/foods', {
          search: input.trim() || undefined,
          pageSize: 25,
        })
        .then((r) => alive && setOptions(r.data))
        .catch(() => alive && setOptions([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [input, open]);

  return (
    <Autocomplete
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      options={value && !options.some((o) => o.id === value.id) ? [value, ...options] : options}
      filterOptions={(x) => x}
      loading={loading}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest}>
            <Box>
              <Typography variant="body2">{o.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {o.brand ? `${o.brand} · ` : ''}
                {servingText(o)} · {Math.round(o.calories)} kcal
              </Typography>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => <TextField {...params} label={label} error={!!error} helperText={error} placeholder="Search foods" />}
      noOptionsText={input ? 'No matching foods' : 'Type to search your library'}
    />
  );
}
