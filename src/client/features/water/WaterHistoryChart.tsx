import { Box, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay } from '../../services/dates';
import { nutrientColors } from '../../theme/theme';
import { fmtMl, type WaterRange } from './types';

interface Row {
  date: string;
  label: string;
  logged: number;
  missing: number;
  totalMl: number | null;
  targetMl: number | null;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        px: 1.5,
        py: 1,
        boxShadow: 2,
      }}
    >
      <Typography variant="body2" fontWeight={700}>
        {formatDay(r.date, 'EEE d MMM')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {r.totalMl == null ? 'Not logged' : `${fmtMl(r.totalMl)}${r.targetMl ? ` of ${fmtMl(r.targetMl)}` : ''}`}
      </Typography>
    </Box>
  );
}

/**
 * Daily water totals. Logged days are solid bars; days with no entries get a short hatched stub
 * so "not logged" never reads as "drank nothing".
 */
export function WaterHistoryChart({ range }: { range: WaterRange }) {
  const theme = useTheme();
  const xs = useMediaQuery(theme.breakpoints.down('sm'));
  const target = range.days.find((d) => d.targetMl)?.targetMl ?? null;
  const maxLogged = Math.max(0, ...range.days.map((d) => d.totalMl ?? 0));
  const stub = Math.max(target ?? maxLogged, 1000) * 0.04;
  const rows: Row[] = range.days.map((d) => ({
    date: d.date,
    label: formatDay(d.date, xs ? 'd MMM' : 'EEE d'),
    logged: d.totalMl ?? 0,
    missing: d.logged ? 0 : stub,
    totalMl: d.totalMl,
    targetMl: d.targetMl,
  }));
  const ink = theme.palette.text.secondary;
  const missingColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(21,34,56,0.22)';
  const loggedCount = range.days.filter((d) => d.logged).length;

  return (
    <Box>
      <Box sx={{ width: '100%', height: xs ? 190 : 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barCategoryGap={xs ? '18%' : '24%'}>
            <defs>
              <pattern id="water-missing" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="transparent" />
                <line x1="0" y1="0" x2="0" y2="6" stroke={missingColor} strokeWidth="3" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke={theme.palette.divider} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: ink, fontSize: 12 }}
              interval={xs ? Math.max(0, Math.ceil(rows.length / 4) - 1) : 0}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: ink, fontSize: 12 }}
              tickCount={4}
              tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}L` : String(v))}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: theme.palette.action.hover }} />
            {target && <ReferenceLine y={target} stroke={ink} strokeDasharray="4 4" ifOverflow="extendDomain" />}
            <Bar dataKey="logged" stackId="w" fill={nutrientColors.water} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="missing" stackId="w" fill="url(#water-missing)" stroke={missingColor} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mt: 1, '& .MuiTypography-root': { fontSize: 13 } }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: 0.5,
              bgcolor: nutrientColors.water,
            }}
          />
          <Typography variant="body2" color="text.secondary">
            Logged {loggedCount}/{range.days.length}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: 0.5,
              border: 1,
              borderColor: missingColor,
              background: `repeating-linear-gradient(45deg, ${missingColor} 0 2px, transparent 2px 5px)`,
            }}
          />
          <Typography variant="body2" color="text.secondary">
            Not logged
          </Typography>
        </Stack>
        {target && (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 16, borderTop: `2px dashed ${ink}` }} />
            <Typography variant="body2" color="text.secondary">
              Target {fmtMl(target)}
            </Typography>
          </Stack>
        )}
      </Stack>
      {/* Screen-reader table view of the same data. */}
      <Box
        component="table"
        sx={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          m: '-1px',
          p: 0,
          border: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          clip: 'rect(0 0 0 0)',
        }}
      >
        <caption>Daily water intake</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <th scope="row">{r.date}</th>
              <td>{r.totalMl == null ? 'Not logged' : `${r.totalMl} ml`}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
