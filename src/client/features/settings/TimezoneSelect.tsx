import { useMemo } from 'react';
import { Autocomplete, TextField } from '@mui/material';

const FALLBACK = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];

export function listTimezones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones?.length) return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    // Older browsers: fall through.
  }
  return FALLBACK;
}

export function TimezoneSelect({
  value,
  onChange,
  error,
  helperText,
  label = 'Timezone',
  disabled,
  size = 'small',
}: {
  value: string;
  onChange: (tz: string) => void;
  error?: boolean;
  helperText?: string;
  label?: string;
  disabled?: boolean;
  size?: 'small' | 'medium';
}) {
  const options = useMemo(() => {
    const zones = listTimezones();
    return value && !zones.includes(value) ? [value, ...zones] : zones;
  }, [value]);
  return (
    <Autocomplete
      options={options}
      value={value}
      disabled={disabled}
      size={size}
      disableClearable
      autoHighlight
      onChange={(_e, v) => v && onChange(v)}
      renderInput={(params) => <TextField {...params} label={label} error={error} helperText={helperText} />}
    />
  );
}
