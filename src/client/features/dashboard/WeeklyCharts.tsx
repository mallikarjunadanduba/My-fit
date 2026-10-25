import { useState } from 'react';
import { Box, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HotelRoundedIcon from '@mui/icons-material/HotelRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import ScheduleRoundedIcon from '@mui/icons-material/ScheduleRounded';
import { formatDay } from '../../services/dates';
import { brand, nutrientColors } from '../../theme/theme';
import { MetricBarChart } from '../reports/charts';
import type { WeeklyPoint } from '../reports/types';
import { DashCard } from './DashboardCards';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';

type Metric = 'calories' | 'protein' | 'water' | 'workouts';

/** Last-7-days strip of workout status per day (icon + label, never colour alone). */
function WorkoutStrip({ days }: { days: WeeklyPoint[] }) {
  return (
    <Stack direction="row" spacing={0.5} justifyContent="space-between" sx={{ py: 2 }} component="ul" style={{ listStyle: 'none', margin: 0, paddingLeft: 0 }}>
      {days.map((d) => {
        let icon = <MoreHorizRoundedIcon />;
        let label = 'Planned';
        let color: string = 'text.disabled';
        if (!d.future) {
          if (d.workoutStatus === 'COMPLETED') [icon, label, color] = [<CheckRoundedIcon key="c" />, 'Workout done', brand.success];
          else if (d.workoutStatus === 'IN_PROGRESS') [icon, label, color] = [<ScheduleRoundedIcon key="p" />, 'In progress', brand.warning];
          else if (d.dayType === 'REST') [icon, label, color] = [<HotelRoundedIcon key="r" />, 'Rest day', 'text.secondary'];
          else [icon, label, color] = [<CloseRoundedIcon key="m" />, 'No workout on a gym day', brand.error];
        }
        return (
          <Tooltip key={d.date} title={`${formatDay(d.date)} — ${label}`}>
            <Stack component="li" alignItems="center" spacing={0.75} sx={{ flex: 1 }} tabIndex={0} aria-label={`${formatDay(d.date)}: ${label}`}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  color,
                  border: 2,
                  borderColor: d.future ? 'divider' : color,
                  borderStyle: d.future ? 'dashed' : 'solid',
                }}
              >
                {icon}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {formatDay(d.date, 'EEE')}
              </Typography>
            </Stack>
          </Tooltip>
        );
      })}
    </Stack>
  );
}

export function WeeklyCharts({ days }: { days: WeeklyPoint[] }) {
  const [metric, setMetric] = useState<Metric>('calories');
  const logged = days.filter((d) => !d.future && d.foodLogged).length;
  const elapsed = days.filter((d) => !d.future).length;
  const workouts = days.filter((d) => d.workoutDone).length;
  const gymDays = days.filter((d) => !d.future && d.dayType === 'GYM').length;

  return (
    <DashCard title="Last 7 days" icon={<InsightsRoundedIcon />}>
      <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
        Food {logged}/{elapsed} days · {workouts} workout
        {workouts === 1 ? '' : 's'} / {gymDays} gym day
        {gymDays === 1 ? '' : 's'}
      </Typography>
      <Tabs
        value={metric}
        onChange={(_, v: Metric) => setMetric(v)}
        variant="fullWidth"
        aria-label="Weekly metric"
        sx={{
          minHeight: 40,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': {
            minHeight: 40,
            minWidth: 0,
            px: 0.5,
            fontSize: 13,
          },
        }}
      >
        <Tab value="calories" label="Calories" />
        <Tab value="protein" label="Protein" />
        <Tab value="water" label="Water" />
        <Tab value="workouts" label="Workouts" />
      </Tabs>
      {metric === 'calories' && (
        <MetricBarChart
          name="Calories"
          unit="kcal"
          color={nutrientColors.calories}
          showBand
          ariaLabel="Bar chart of calories per day for the last 7 days against the target"
          points={days.map((d) => ({
            date: d.date,
            value: d.calories,
            target: d.calorieTarget,
            min: d.calorieMin,
            max: d.calorieMax,
            future: d.future,
          }))}
        />
      )}
      {metric === 'protein' && (
        <MetricBarChart
          name="Protein"
          unit="g"
          color={nutrientColors.protein}
          ariaLabel="Bar chart of protein per day for the last 7 days against the minimum"
          points={days.map((d) => ({
            date: d.date,
            value: d.protein,
            target: d.proteinTarget,
            future: d.future,
          }))}
        />
      )}
      {metric === 'water' && (
        <MetricBarChart
          name="Water"
          unit="ml"
          color={nutrientColors.water}
          ariaLabel="Bar chart of water intake per day for the last 7 days against the target"
          points={days.map((d) => ({
            date: d.date,
            value: d.waterMl,
            target: d.waterTarget,
            future: d.future,
          }))}
        />
      )}
      {metric === 'workouts' && <WorkoutStrip days={days} />}
    </DashCard>
  );
}
