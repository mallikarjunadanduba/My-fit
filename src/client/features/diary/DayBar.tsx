import { useRef } from 'react';
import { Box, Button, ButtonBase, IconButton, Stack, Typography } from '@mui/material';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import { formatDay, shiftDate, todayIn } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import { visuallyHiddenSx } from '../../components/common/mobile';

/** Relative label: Today / Yesterday / Tomorrow, else "Mon 20 Oct". */
export function dayLabel(date: string, today: string) {
  if (date === today) return 'Today';
  if (date === shiftDate(today, -1)) return 'Yesterday';
  if (date === shiftDate(today, 1)) return 'Tomorrow';
  return formatDay(date, date.slice(0, 4) === today.slice(0, 4) ? 'EEE d MMM' : 'd MMM yyyy');
}

/**
 * Compact phone date navigation: ‹  Today · Sat 25 Oct  ›. Tapping the label opens the native date picker.
 */
export function DayBar({ date, onChange, trailing }: { date: string; onChange: (d: string) => void; trailing?: React.ReactNode }) {
  const { timezone } = useAuth();
  const today = todayIn(timezone);
  const input = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  const relative = dayLabel(date, today);
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minHeight: 48 }}>
      <IconButton aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))} sx={{ width: 44, height: 44 }}>
        <ChevronLeftRoundedIcon />
      </IconButton>
      <ButtonBase
        onClick={open}
        aria-label={`Change date, ${formatDay(date)}`}
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          borderRadius: 2,
          px: 1,
          justifyContent: 'center',
          gap: 0.75,
          position: 'relative',
        }}
      >
        <CalendarMonthRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Typography component="span" fontWeight={700} noWrap>
          {relative}
        </Typography>
        {['Today', 'Yesterday', 'Tomorrow'].includes(relative) && (
          <Typography component="span" variant="body2" color="text.secondary" noWrap>
            {formatDay(date, 'EEE d MMM')}
          </Typography>
        )}
        <Box
          component="input"
          ref={input}
          type="date"
          value={date}
          tabIndex={-1}
          aria-hidden
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => e.target.value && onChange(e.target.value)}
          sx={{ ...visuallyHiddenSx, bottom: 0, left: '50%' }}
        />
      </ButtonBase>
      <IconButton aria-label="Next day" onClick={() => onChange(shiftDate(date, 1))} sx={{ width: 44, height: 44 }}>
        <ChevronRightRoundedIcon />
      </IconButton>
      {date !== today && (
        <Button size="small" onClick={() => onChange(today)} sx={{ minHeight: 36, minWidth: 0, px: 1.25 }}>
          Today
        </Button>
      )}
      {trailing}
    </Stack>
  );
}
