import { IconButton, Stack, TextField, Button, Tooltip } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { shiftDate, todayIn } from '../../services/dates';
import { useAuth } from '../../features/auth/AuthContext';

/** Prev / date picker / next / Today control for pages that show one local date. */
export function DateNavigator({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const { timezone } = useAuth();
  const today = todayIn(timezone);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Tooltip title="Previous day">
        <IconButton aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))}>
          <ChevronLeftIcon />
        </IconButton>
      </Tooltip>
      <TextField
        type="date"
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Select date' } }}
        sx={{ width: 170 }}
      />
      <Tooltip title="Next day">
        <IconButton aria-label="Next day" onClick={() => onChange(shiftDate(date, 1))}>
          <ChevronRightIcon />
        </IconButton>
      </Tooltip>
      {date !== today && (
        <Button size="small" onClick={() => onChange(today)}>
          Today
        </Button>
      )}
    </Stack>
  );
}
