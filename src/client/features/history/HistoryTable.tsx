import { useState, type ReactNode } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { usePhone } from '../../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../services/api';
import { formatDay, formatInstant, shiftDate, todayIn } from '../../services/dates';
import { fmt, fmtMl, SESSION_STATUS, STATUS_CHIP, titleCase } from '../reports/format';
import type { HistoryKind, SessionStatus } from '../reports/types';

type AnyRow = Record<string, unknown> & { id?: string; date?: string };

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: AnyRow, tz: string) => ReactNode;
}

const num =
  (k: string, unit = '', digits = 1) =>
  (r: AnyRow) => {
    const v = r[k] as number | null;
    return v == null ? '—' : `${fmt(v, digits)}${unit}`;
  };
const dateCol: Column = {
  key: 'date',
  label: 'Date',
  render: (r) => formatDay(r.date as string, 'EEE d MMM yyyy'),
};
const noLog = (r: AnyRow, content: ReactNode) =>
  r.logged === false ? (
    <Typography variant="caption" color="text.secondary">
      No log
    </Typography>
  ) : (
    content
  );
const statusChip = (s: string) => <Chip size="small" variant="outlined" label={titleCase(s)} color={STATUS_CHIP[s] ?? 'default'} />;

const COLUMNS: Record<HistoryKind, Column[]> = {
  nutrition: [
    dateCol,
    {
      key: 'calories',
      label: 'Calories',
      align: 'right',
      render: (r) => noLog(r, num('calories', '', 0)(r)),
    },
    {
      key: 'target',
      label: 'Target',
      align: 'right',
      render: num('calorieTarget', '', 0),
    },
    {
      key: 'protein',
      label: 'Protein',
      align: 'right',
      render: (r) => noLog(r, num('protein', ' g')(r)),
    },
    {
      key: 'carbs',
      label: 'Carbs',
      align: 'right',
      render: (r) => noLog(r, num('carbs', ' g')(r)),
    },
    {
      key: 'fat',
      label: 'Fat',
      align: 'right',
      render: (r) => noLog(r, num('fat', ' g')(r)),
    },
    {
      key: 'fiber',
      label: 'Fiber',
      align: 'right',
      render: (r) => noLog(r, num('fiber', ' g')(r)),
    },
    {
      key: 'range',
      label: 'In range',
      render: (r) =>
        r.withinCalorieRange == null ? (
          '—'
        ) : (
          <Chip size="small" variant="outlined" color={r.withinCalorieRange ? 'success' : 'warning'} label={r.withinCalorieRange ? 'Yes' : 'No'} />
        ),
    },
  ],
  diary: [
    dateCol,
    {
      key: 'slot',
      label: 'Meal',
      render: (r) => (r.slotName as string) ?? '—',
    },
    {
      key: 'food',
      label: 'Food',
      render: (r) => (
        <>
          {r.foodName as string}
          {r.brand ? (
            <Typography variant="caption" color="text.secondary" component="div">
              {r.brand as string}
            </Typography>
          ) : null}
        </>
      ),
    },
    {
      key: 'qty',
      label: 'Qty',
      align: 'right',
      render: (r) => `${fmt(r.quantity as number)} ${String(r.unit).toLowerCase()}`,
    },
    {
      key: 'calories',
      label: 'kcal',
      align: 'right',
      render: num('calories', '', 0),
    },
    {
      key: 'protein',
      label: 'P',
      align: 'right',
      render: num('protein', ' g'),
    },
    { key: 'carbs', label: 'C', align: 'right', render: num('carbs', ' g') },
    { key: 'fat', label: 'F', align: 'right', render: num('fat', ' g') },
    {
      key: 'fiber',
      label: 'Fiber',
      align: 'right',
      render: num('fiber', ' g'),
    },
  ],
  workouts: [
    dateCol,
    { key: 'name', label: 'Session', render: (r) => r.name as string },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        const s = SESSION_STATUS[r.status as SessionStatus];
        return <Chip size="small" label={s.label} color={s.color} variant="outlined" />;
      },
    },
    {
      key: 'ex',
      label: 'Exercises',
      align: 'right',
      render: (r) => `${r.completedExercises}/${r.totalExercises}`,
    },
    {
      key: 'sets',
      label: 'Sets',
      align: 'right',
      render: (r) => `${r.completedSets}/${r.totalSets}`,
    },
    {
      key: 'vol',
      label: 'Volume',
      align: 'right',
      render: num('volumeKg', ' kg', 0),
    },
    {
      key: 'dur',
      label: 'Duration',
      align: 'right',
      render: num('durationMin', ' min', 0),
    },
  ],
  water: [
    dateCol,
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      render: (r) => noLog(r, fmtMl(r.totalMl as number | null)),
    },
    {
      key: 'target',
      label: 'Target',
      align: 'right',
      render: (r) => fmtMl(r.targetMl as number | null),
    },
    {
      key: 'pct',
      label: '% of target',
      align: 'right',
      render: (r) => noLog(r, num('percent', '%', 0)(r)),
    },
    {
      key: 'n',
      label: 'Entries',
      align: 'right',
      render: (r) => String(r.entryCount),
    },
  ],
  routine: [
    dateCol,
    {
      key: 'pct',
      label: 'Completion',
      align: 'right',
      render: num('completionPct', '%', 0),
    },
    {
      key: 'done',
      label: 'Done',
      align: 'right',
      render: (r) => `${r.completed}/${r.total}`,
    },
    {
      key: 'skipped',
      label: 'Skipped',
      align: 'right',
      render: (r) => String(r.skipped),
    },
    {
      key: 'missed',
      label: 'Missed',
      align: 'right',
      render: (r) => String(r.missed),
    },
    {
      key: 'pending',
      label: 'Pending',
      align: 'right',
      render: (r) => String(r.pending),
    },
  ],
  reminders: [
    {
      key: 'when',
      label: 'Scheduled',
      render: (r, tz) => formatInstant(r.scheduledFor as string, tz, 'EEE d MMM yyyy, HH:mm'),
    },
    { key: 'title', label: 'Reminder', render: (r) => r.title as string },
    {
      key: 'cat',
      label: 'Category',
      render: (r) => titleCase(r.category as string),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => statusChip(r.status as string),
    },
    {
      key: 'fired',
      label: 'Fired',
      render: (r, tz) => formatInstant(r.firedAt as string | null, tz),
    },
    {
      key: 'acted',
      label: 'Acted',
      render: (r, tz) => formatInstant(r.actedAt as string | null, tz),
    },
  ],
  measurements: [
    dateCol,
    {
      key: 'w',
      label: 'Weight',
      align: 'right',
      render: num('weightKg', ' kg'),
    },
    {
      key: 'bf',
      label: 'Body fat',
      align: 'right',
      render: num('bodyFatPct', '%'),
    },
    {
      key: 'waist',
      label: 'Waist',
      align: 'right',
      render: num('waistCm', ' cm'),
    },
    {
      key: 'chest',
      label: 'Chest',
      align: 'right',
      render: num('chestCm', ' cm'),
    },
    {
      key: 'hips',
      label: 'Hips',
      align: 'right',
      render: num('hipsCm', ' cm'),
    },
    { key: 'arm', label: 'Arm', align: 'right', render: num('armCm', ' cm') },
    {
      key: 'thigh',
      label: 'Thigh',
      align: 'right',
      render: num('thighCm', ' cm'),
    },
    { key: 'notes', label: 'Notes', render: (r) => (r.notes as string) ?? '' },
  ],
};

/** Phone row: primary/secondary text + a trailing key metric (no wide tables on phones). */
interface MobileRow {
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
}

const day = (r: AnyRow) => formatDay(r.date as string, 'EEE d MMM');
const big = (v: ReactNode, unit?: string) => (
  <Typography component="span" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
    {v}
    {unit && (
      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.25 }}>
        {unit}
      </Typography>
    )}
  </Typography>
);
const noLogTag = (
  <Typography variant="caption" color="text.secondary">
    No log
  </Typography>
);

const MOBILE: Record<HistoryKind, (r: AnyRow, tz: string) => MobileRow> = {
  nutrition: (r) => ({
    primary: day(r),
    secondary:
      r.logged === false
        ? `Target ${num('calorieTarget', ' kcal', 0)(r)}`
        : `P ${num('protein', 'g', 0)(r)} · C ${num('carbs', 'g', 0)(r)} · F ${num('fat', 'g', 0)(r)} · of ${num('calorieTarget', '', 0)(r)}`,
    trailing:
      r.logged === false ? (
        noLogTag
      ) : (
        <Stack alignItems="flex-end">
          {big(num('calories', '', 0)(r), 'kcal')}
          {r.withinCalorieRange != null && (
            <Typography variant="caption" color={r.withinCalorieRange ? 'success.main' : 'warning.main'} fontWeight={700}>
              {r.withinCalorieRange ? 'In range' : 'Off range'}
            </Typography>
          )}
        </Stack>
      ),
  }),
  diary: (r) => ({
    primary: r.foodName as string,
    secondary: `${day(r)}${r.slotName ? ` · ${r.slotName as string}` : ''} · P ${num('protein', 'g', 0)(r)}`,
    trailing: big(num('calories', '', 0)(r), 'kcal'),
  }),
  workouts: (r) => {
    const s = SESSION_STATUS[r.status as SessionStatus];
    return {
      primary: r.name as string,
      secondary: `${day(r)} · ${r.completedSets}/${r.totalSets} sets${r.volumeKg ? ` · ${fmt(r.volumeKg as number, 0)} kg` : ''}${r.durationMin != null ? ` · ${r.durationMin as number} min` : ''}`,
      trailing: <Chip size="small" label={s.label} color={s.color} variant="outlined" />,
    };
  },
  water: (r) => ({
    primary: day(r),
    secondary:
      r.logged === false
        ? `Target ${fmtMl(r.targetMl as number | null)}`
        : `${r.entryCount as number} entries · ${num('percent', '%', 0)(r)} of ${fmtMl(r.targetMl as number | null)}`,
    trailing: r.logged === false ? noLogTag : big(fmtMl(r.totalMl as number | null)),
  }),
  routine: (r) => ({
    primary: day(r),
    secondary: `${r.completed}/${r.total} done${r.skipped ? ` · ${r.skipped} skipped` : ''}${r.missed ? ` · ${r.missed} missed` : ''}${r.pending ? ` · ${r.pending} pending` : ''}`,
    trailing: big(num('completionPct', '%', 0)(r)),
  }),
  reminders: (r, tz) => ({
    primary: r.title as string,
    secondary: `${formatInstant(r.scheduledFor as string, tz, 'EEE d MMM, HH:mm')} · ${titleCase(r.category as string)}`,
    trailing: statusChip(r.status as string),
  }),
  measurements: (r) => ({
    primary: day(r),
    secondary:
      [
        r.bodyFatPct != null && `BF ${fmt(r.bodyFatPct as number)}%`,
        r.waistCm != null && `Waist ${fmt(r.waistCm as number)} cm`,
        r.chestCm != null && `Chest ${fmt(r.chestCm as number)} cm`,
        r.armCm != null && `Arm ${fmt(r.armCm as number)} cm`,
        r.notes as string,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    trailing: r.weightKg != null ? big(fmt(r.weightKg as number), 'kg') : undefined,
  }),
};

const LABELS: Record<HistoryKind, string> = {
  nutrition: 'nutrition history',
  diary: 'food diary entries',
  workouts: 'workout sessions',
  water: 'water history',
  routine: 'routine adherence',
  reminders: 'reminder history',
  measurements: 'body measurements',
};

export function HistoryTable({ kind }: { kind: HistoryKind }) {
  const { timezone } = useAuth();
  const today = todayIn(timezone);
  const [from, setFrom] = useState(shiftDate(today, -29));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const spanDays = from && to ? (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 : 0;
  const invalid = !from || !to || from > to || spanDays > 400;

  const { data, error, loading, reload } = useAsync(
    () =>
      invalid
        ? Promise.resolve(null)
        : api.getPaged<AnyRow[]>(`/reports/history/${kind}`, {
            from,
            to,
            page: page + 1,
            pageSize,
          }),
    [kind, from, to, page, pageSize, invalid],
  );
  const columns = COLUMNS[kind];
  const phone = usePhone();

  return (
    <Card>
      <CardContent sx={{ pb: { xs: '4px !important', md: 2 } }}>
        <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ mb: 2 }} alignItems="center">
          <TextField
            type="date"
            label="From"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: to } }}
            size="medium"
            sx={{ flex: { xs: '1 1 0', sm: '0 0 190px' }, minWidth: 0 }}
          />
          <TextField
            type="date"
            label="To"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: from },
            }}
            size="medium"
            sx={{ flex: { xs: '1 1 0', sm: '0 0 190px' }, minWidth: 0 }}
          />
          {invalid && (
            <Typography variant="caption" color="error">
              Choose a valid range (from ≤ to, at most 400 days).
            </Typography>
          )}
        </Stack>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <LoadingState />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title={`No ${LABELS[kind]} in this range`} description="Try widening the date range." />
        ) : (
          <Box sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }} aria-busy={loading}>
            {phone ? (
              <List disablePadding aria-label={LABELS[kind]} sx={{ mx: -2 }}>
                {data.data.map((row, i) => {
                  const m = MOBILE[kind](row, timezone);
                  return (
                    <ListItem
                      key={(row.id as string) ?? `${row.date}-${i}`}
                      divider={i < data.data.length - 1}
                      secondaryAction={m.trailing}
                      sx={{
                        px: 2,
                        minHeight: 56,
                        opacity: row.logged === false ? 0.7 : 1,
                        '& .MuiListItemSecondaryAction-root': { right: 16 },
                      }}
                    >
                      <ListItemText
                        primary={m.primary}
                        secondary={m.secondary}
                        slotProps={{
                          primary: { fontWeight: 600, noWrap: true },
                          secondary: { noWrap: true },
                        }}
                        sx={{ my: 0.5, minWidth: 0, pr: 12 }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            ) : (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label={LABELS[kind]}>
                  <TableHead>
                    <TableRow>
                      {columns.map((c) => (
                        <TableCell key={c.key} align={c.align} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {c.label}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.data.map((row, i) => (
                      <TableRow key={(row.id as string) ?? `${row.date}-${i}`} hover sx={{ opacity: row.logged === false ? 0.75 : 1 }}>
                        {columns.map((c) => (
                          <TableCell
                            key={c.key}
                            align={c.align}
                            sx={{
                              whiteSpace: c.key === 'notes' || c.key === 'food' ? 'normal' : 'nowrap',
                            }}
                          >
                            {c.render(row, timezone)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            <TablePagination
              component="div"
              count={data.meta.total}
              page={Math.min(page, Math.max(0, data.meta.totalPages - 1))}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={phone ? [] : [10, 25, 50, 100]}
              sx={phone ? { mx: -2, '& .MuiTablePagination-toolbar': { pl: 2 } } : undefined}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
