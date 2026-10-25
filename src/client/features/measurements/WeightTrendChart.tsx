import { Box, useTheme } from '@mui/material';
import { usePhone } from '../../components/common/mobile';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay } from '../../services/dates';
import { EmptyState } from '../../components/common/States';
import type { WeightTrend } from './types';

/** Single-series weight line; tooltip on hover, recessive grid/axes. */
export function WeightTrendChart({ trend }: { trend: WeightTrend }) {
  const theme = useTheme();
  const phone = usePhone();
  if (trend.points.length === 0) {
    return <EmptyState title="No weight entries in this range" description="Log your weight to see the trend." />;
  }
  const data = trend.points.map((p) => ({ ...p, label: formatDay(p.date, 'd MMM') }));
  const pad = Math.max(1, ((trend.max ?? 0) - (trend.min ?? 0)) * 0.15);
  const domain: [number, number] = [Math.floor((trend.min ?? 0) - pad), Math.ceil((trend.max ?? 0) + pad)];
  const summary =
    trend.change == null
      ? ''
      : `Weight changed ${trend.change > 0 ? '+' : ''}${trend.change} kg from ${trend.first?.weightKg} kg to ${trend.last?.weightKg} kg.`;
  return (
    <Box>
      <Box sx={{ height: phone ? 200 : 260 }} role="img" aria-label={`Weight trend chart. ${summary}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: phone ? -20 : -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.palette.divider} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: theme.palette.text.secondary }}
              tickLine={false}
              axisLine={{ stroke: theme.palette.divider }}
              tickMargin={6}
              interval={phone ? Math.max(0, Math.ceil(data.length / 4) - 1) : 'preserveStartEnd'}
              minTickGap={phone ? 8 : 24}
            />
            <YAxis domain={domain} width={phone ? 48 : 56} tickCount={4} tick={{ fontSize: 12, fill: theme.palette.text.secondary }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8, color: theme.palette.text.primary }}
              labelFormatter={(_l, p) => {
                const d = (p?.[0]?.payload as { date?: string } | undefined)?.date;
                return d ? formatDay(d) : '';
              }}
              formatter={(v) => [`${v} kg`, 'Weight']}
            />
            <Line
              type="monotone"
              dataKey="weightKg"
              stroke={theme.palette.primary.main}
              strokeWidth={2}
              dot={data.length <= 40 ? { r: 4, strokeWidth: 2, stroke: theme.palette.background.paper, fill: theme.palette.primary.main } : false}
              activeDot={{ r: 6, strokeWidth: 2, stroke: theme.palette.background.paper }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
