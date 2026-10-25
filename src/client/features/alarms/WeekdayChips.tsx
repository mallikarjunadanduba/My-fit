import { Chip, Stack } from '@mui/material';
import { WEEKDAYS_SHORT } from '../../services/dates';

/** Toggleable weekday chips (0 = Sunday … 6 = Saturday). Displayed Monday-first. */
export function WeekdayChips({
  value,
  onChange,
  disabled,
  label = 'Weekdays',
}: {
  value: number[];
  onChange: (v: number[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap role="group" aria-label={label}>
      {order.map((d) => {
        const on = value.includes(d);
        return (
          <Chip
            key={d}
            label={WEEKDAYS_SHORT[d]}
            color={on ? 'primary' : 'default'}
            variant={on ? 'filled' : 'outlined'}
            onClick={disabled ? undefined : () => toggle(d)}
            disabled={disabled}
            aria-pressed={on}
            sx={{ minWidth: 44, height: 44, borderRadius: 22, '& .MuiChip-label': { px: 1 } }}
          />
        );
      })}
    </Stack>
  );
}

/** "Every day", "Mon, Wed, Fri", "Weekdays", "Weekends". */
export function weekdaySummary(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Every day';
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => days.includes(d))
    .map((d) => WEEKDAYS_SHORT[d])
    .join(', ');
}
