import { useId, type ReactNode } from 'react';
import { Box, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay } from '../../services/dates';
import { nutrientColors } from '../../theme/theme';
import { fmt, fmtMl } from './format';

/** One x-axis category. `value` null = nothing logged (missing ≠ zero). */
export interface MetricPoint {
  date: string;
  value: number | null;
  target: number | null;
  min?: number | null;
  max?: number | null;
  future: boolean;
}

interface Row extends MetricPoint {
  label: string;
  noLog: number | null;
  band: [number, number] | null;
}

export function useChartTheme() {
  const t = useTheme();
  return {
    grid: alpha(t.palette.text.primary, 0.08),
    axis: t.palette.text.secondary,
    ink: t.palette.text.primary,
    surface: t.palette.background.paper,
    neutral: alpha(t.palette.text.primary, 0.55),
    hatch: alpha(t.palette.text.primary, 0.22),
    band: alpha(t.palette.success.main, 0.14),
  };
}

/**
 * Phone sizing: charts are 200px tall with at most 5 x-axis ticks; legends stay on one short line.
 * Returns `{ phone, height, interval }` for a series of `n` categories.
 */
export function useChartSizing(n: number, desktopHeight: number) {
  const phone = useMediaQuery(useTheme().breakpoints.down('md'));
  return {
    phone,
    height: phone ? 200 : desktopHeight,
    interval: (phone ? Math.max(0, Math.ceil(n / 5) - 1) : 'preserveStartEnd') as number | 'preserveStartEnd',
  };
}

const axisProps = (color: string) => ({
  tick: { fill: color, fontSize: 12 },
  tickLine: false,
  axisLine: false,
});

/** Diagonal hatch used for "no log" days (texture, not colour, so it reads in every mode). */
function HatchDef({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2" />
      </pattern>
    </defs>
  );
}

export interface LegendItem {
  label: string;
  color?: string;
  kind: 'bar' | 'line' | 'dashed' | 'band' | 'hatch';
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  const c = useChartTheme();
  return (
    <Stack
      direction="row"
      spacing={1.5}
      rowGap={0.5}
      useFlexGap
      flexWrap="wrap"
      sx={{ mt: 1 }}
      component="ul"
      aria-label="Chart legend"
      style={{ listStyle: 'none', padding: 0, margin: 0 }}
    >
      {items.map((it) => (
        <Stack key={it.label} component="li" direction="row" spacing={0.75} alignItems="center">
          <Box
            aria-hidden
            sx={{
              width: 14,
              height: it.kind === 'line' || it.kind === 'dashed' ? 0 : 10,
              borderRadius: it.kind === 'bar' ? '3px' : 0,
              bgcolor: it.kind === 'bar' ? it.color : it.kind === 'band' ? c.band : 'transparent',
              borderTop: it.kind === 'line' ? `2px solid ${it.color}` : it.kind === 'dashed' ? `2px dashed ${it.color ?? c.neutral}` : undefined,
              backgroundImage: it.kind === 'hatch' ? `repeating-linear-gradient(45deg, ${c.hatch} 0 2px, transparent 2px 5px)` : undefined,
              border: it.kind === 'hatch' ? `1px solid ${c.hatch}` : undefined,
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {it.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function TooltipCard({ title, rows }: { title: string; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <Paper elevation={6} sx={{ px: 1.5, py: 1, minWidth: 150 }}>
      <Typography variant="caption" fontWeight={700} component="div" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {rows.map((r) => (
        <Stack key={r.label} direction="row" spacing={1} justifyContent="space-between" alignItems="center">
          <Stack direction="row" spacing={0.75} alignItems="center">
            {r.color && (
              <Box
                aria-hidden
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '2px',
                  bgcolor: r.color,
                }}
              />
            )}
            <Typography variant="caption" color="text.secondary">
              {r.label}
            </Typography>
          </Stack>
          <Typography variant="caption" fontWeight={600}>
            {r.value}
          </Typography>
        </Stack>
      ))}
    </Paper>
  );
}

type TooltipRenderProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
};

function rowsOf(points: MetricPoint[], labelPattern: string): Row[] {
  const maxY = Math.max(1, ...points.flatMap((p) => [p.value ?? 0, p.target ?? 0, p.max ?? 0]));
  return points.map((p) => ({
    ...p,
    label: formatDay(p.date, labelPattern),
    noLog: p.value == null && !p.future ? maxY : null,
    band: p.min != null && p.max != null ? [p.min, p.max] : null,
  }));
}

/**
 * Daily metric bars with the per-day target as a dashed step line, optional target range band,
 * and hatched columns for elapsed days with no log.
 */
export function MetricBarChart({
  points,
  name,
  unit,
  color,
  height: desktopHeight = 220,
  showBand = false,
  labelPattern = 'EEE',
  ariaLabel,
}: {
  points: MetricPoint[];
  name: string;
  unit: 'kcal' | 'g' | 'ml';
  color: string;
  height?: number;
  showBand?: boolean;
  labelPattern?: string;
  ariaLabel: string;
}) {
  const c = useChartTheme();
  const hatchId = `hatch-${useId().replace(/:/g, '')}`;
  const data = rowsOf(points, labelPattern);
  const { height, interval, phone } = useChartSizing(data.length, desktopHeight);
  const show = (v: number | null) => (unit === 'ml' ? fmtMl(v) : v == null ? '—' : `${fmt(v)} ${unit}`);
  const hasTarget = data.some((d) => d.target != null);
  const hasMissing = data.some((d) => d.noLog != null);

  return (
    <Box role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <HatchDef id={hatchId} color={c.hatch} />
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.axis)} interval={interval} minTickGap={8} />
          <YAxis
            {...axisProps(c.axis)}
            tickCount={phone ? 4 : 5}
            width={unit === 'ml' ? 46 : 40}
            tickFormatter={(v: number) => (unit === 'ml' && v >= 1000 ? `${v / 1000}L` : fmt(v, 0))}
          />
          {showBand && <Area type="step" dataKey="band" stroke="none" fill={c.band} isAnimationActive={false} activeDot={false} connectNulls={false} />}
          <Bar dataKey="value" stackId="v" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          <Bar dataKey="noLog" stackId="v" fill={`url(#${hatchId})`} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          {hasTarget && <Line type="step" dataKey="target" stroke={c.neutral} strokeDasharray="5 4" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />}
          <Tooltip
            cursor={{ fill: c.grid }}
            content={({ active, payload }: TooltipRenderProps) => {
              const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!row) return null;
              return (
                <TooltipCard
                  title={formatDay(row.date)}
                  rows={[
                    {
                      label: name,
                      value: row.future ? 'Planned' : row.value == null ? 'No log' : show(row.value),
                      color,
                    },
                    ...(row.target != null ? [{ label: 'Target', value: show(row.target) }] : []),
                    ...(row.band
                      ? [
                          {
                            label: 'Range',
                            value: `${fmt(row.band[0], 0)}–${fmt(row.band[1], 0)} ${unit}`,
                          },
                        ]
                      : []),
                  ]}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { label: name, color, kind: 'bar' },
          ...(hasTarget ? [{ label: 'Target', kind: 'dashed' as const }] : []),
          ...(showBand && data.some((d) => d.band)
            ? [
                {
                  label: phone ? 'Range' : 'Target range',
                  kind: 'band' as const,
                },
              ]
            : []),
          ...(hasMissing ? [{ label: 'No log', kind: 'hatch' as const }] : []),
        ]}
      />
    </Box>
  );
}

/** Energy from each macro (protein/carbs × 4, fat × 9) stacked per day. */
export function MacroStackChart({
  points,
  height: desktopHeight = 240,
  labelPattern = 'd',
}: {
  points: {
    date: string;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    future: boolean;
  }[];
  height?: number;
  labelPattern?: string;
}) {
  const c = useChartTheme();
  const hatchId = `hatch-${useId().replace(/:/g, '')}`;
  const rows = points.map((p) => ({
    ...p,
    label: formatDay(p.date, labelPattern),
    pKcal: p.protein != null ? p.protein * 4 : null,
    cKcal: p.carbs != null ? p.carbs * 4 : null,
    fKcal: p.fat != null ? p.fat * 9 : null,
  }));
  const maxY = Math.max(1, ...rows.map((r) => (r.pKcal ?? 0) + (r.cKcal ?? 0) + (r.fKcal ?? 0)));
  const data = rows.map((r) => ({
    ...r,
    noLog: r.protein == null && !r.future ? maxY : null,
  }));
  const { height, interval, phone } = useChartSizing(data.length, desktopHeight);
  const series = [
    {
      key: 'pKcal',
      name: 'Protein',
      color: nutrientColors.protein,
      grams: 'protein' as const,
    },
    {
      key: 'cKcal',
      name: 'Carbs',
      color: nutrientColors.carbs,
      grams: 'carbs' as const,
    },
    {
      key: 'fKcal',
      name: 'Fat',
      color: nutrientColors.fat,
      grams: 'fat' as const,
    },
  ];
  return (
    <Box role="img" aria-label="Stacked bar chart of daily calories from protein, carbs and fat">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <HatchDef id={hatchId} color={c.hatch} />
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.axis)} interval={interval} minTickGap={8} />
          <YAxis {...axisProps(c.axis)} tickCount={phone ? 4 : 5} width={40} tickFormatter={(v: number) => fmt(v, 0)} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="m"
              fill={s.color}
              stroke={c.surface}
              strokeWidth={1}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={36}
              isAnimationActive={false}
            />
          ))}
          <Bar dataKey="noLog" stackId="m" fill={`url(#${hatchId})`} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          <Tooltip
            cursor={{ fill: c.grid }}
            content={({ active, payload }: TooltipRenderProps) => {
              const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!row) return null;
              if (row.protein == null)
                return (
                  <TooltipCard
                    title={formatDay(row.date)}
                    rows={[
                      {
                        label: 'Macros',
                        value: row.future ? 'Planned' : 'No log',
                      },
                    ]}
                  />
                );
              return (
                <TooltipCard
                  title={formatDay(row.date)}
                  rows={series.map((s) => ({
                    label: s.name,
                    value: `${fmt(row[s.grams])} g · ${fmt(row[s.key as 'pKcal'] ?? 0, 0)} kcal`,
                    color: s.color,
                  }))}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          ...series.map((s) => ({
            label: phone ? s.name : `${s.name} (kcal)`,
            color: s.color,
            kind: 'bar' as const,
          })),
          ...(data.some((d) => d.noLog != null) ? [{ label: 'No log', kind: 'hatch' as const }] : []),
        ]}
      />
    </Box>
  );
}

export function WeightChart({ series, height: desktopHeight = 220 }: { series: { date: string; weightKg: number }[]; height?: number }) {
  const c = useChartTheme();
  const { height, interval } = useChartSizing(series.length, desktopHeight);
  const t = useTheme();
  const color = t.palette.secondary.main;
  const values = series.map((s) => s.weightKg);
  const lo = Math.floor(Math.min(...values) - 1);
  const hi = Math.ceil(Math.max(...values) + 1);
  const data = series.map((s) => ({ ...s, label: formatDay(s.date, 'd MMM') }));
  return (
    <Box role="img" aria-label={`Line chart of body weight from ${fmt(values[0])} kg to ${fmt(values[values.length - 1])} kg`}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.axis)} interval={interval} minTickGap={12} />
          <YAxis {...axisProps(c.axis)} width={44} domain={[lo, hi]} tickFormatter={(v: number) => fmt(v, 0)} />
          <Line
            type="monotone"
            dataKey="weightKg"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, fill: color, stroke: c.surface, strokeWidth: 2 }}
            activeDot={{ r: 6, stroke: c.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Tooltip
            cursor={{ stroke: c.neutral, strokeDasharray: '3 3' }}
            content={({ active, payload }: TooltipRenderProps) => {
              const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return row ? (
                <TooltipCard
                  title={formatDay(row.date)}
                  rows={[
                    {
                      label: 'Weight',
                      value: `${fmt(row.weightKg)} kg`,
                      color,
                    },
                  ]}
                />
              ) : null;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
