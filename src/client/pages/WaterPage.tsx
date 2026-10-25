import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AlarmRoundedIcon from '@mui/icons-material/AlarmRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { formatClock, formatInstant, todayIn } from '../services/dates';
import { useAuth } from '../features/auth/AuthContext';
import { PageHeader } from '../components/common/PageHeader';
import { ErrorState, LoadingState } from '../components/common/States';
import { useFeedback } from '../components/common/Feedback';
import { BOTTOM_NAV_OFFSET } from '../components/common/mobile';
import { useDateParam } from '../features/diary/useDateParam';
import { DayBar, dayLabel } from '../features/diary/DayBar';
import { errorMessage } from '../features/foods/formHelpers';
import { ActionRow, OverflowMenu } from '../features/foods/mobile';
import { WaterRing } from '../features/water/WaterRing';
import { WaterHistoryChart } from '../features/water/WaterHistoryChart';
import { fmtMl, withWaterEntries, type WaterDayWithHistory, type WaterEntry } from '../features/water/types';

const QUICK = [150, 250, 500];
const MAX_ENTRY = 2000;
const HISTORY_DAYS = 14;

export default function WaterPage() {
  const { timezone } = useAuth();
  const navigate = useNavigate();
  const { notify, confirm } = useFeedback();
  const [date, setDate] = useDateParam();
  // One request: the day's log + target and the 14-day history for the chart.
  const day = useAsync(
    () =>
      api.get<WaterDayWithHistory>('/water', {
        date,
        historyDays: HISTORY_DAYS,
      }),
    [date],
  );
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<WaterEntry | null>(null);

  const change = (fn: (entries: WaterEntry[]) => WaterEntry[]) => day.setData((d) => (d ? withWaterEntries(d, fn(d.entries)) : d));

  const add = async (amountMl: number) => {
    if (!Number.isInteger(amountMl) || amountMl < 1 || amountMl > MAX_ENTRY) {
      notify(`Enter a whole amount between 1 and ${MAX_ENTRY} ml`, 'error');
      return;
    }
    setBusy(true);
    try {
      const entry = await api.post<WaterEntry>('/water', { date, amountMl });
      change((list) => [...list, entry]);
      setUndo(entry);
      setCustom('');
      const d = day.data;
      const newTotal = (d?.totalMl ?? 0) + amountMl;
      if (d?.maxMl != null && newTotal > d.maxMl) {
        notify(`That's ${fmtMl(newTotal)} today — above your ${fmtMl(d.maxMl)} upper limit. No need to drink more unless you're thirsty.`, 'warning');
      }
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeNow = async (entry: WaterEntry, message: string) => {
    change((list) => list.filter((x) => x.id !== entry.id));
    try {
      await api.delete(`/water/${entry.id}`);
      notify(message, 'info');
    } catch (err) {
      notify(errorMessage(err), 'error');
      void day.reload();
    }
  };

  const doUndo = () => {
    const entry = undo;
    setUndo(null);
    if (entry) void removeNow(entry, `Removed ${entry.amountMl} ml`);
  };

  const remove = async (e: WaterEntry) => {
    const ok = await confirm({
      title: `Remove ${e.amountMl} ml?`,
      message: `Logged at ${formatClock(formatInstant(e.loggedAt, timezone))}.`,
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (ok) await removeNow(e, `Removed ${e.amountMl} ml`);
  };

  const d = day.data;
  const entries = d ? [...d.entries].reverse() : [];
  const label = dayLabel(date, todayIn(timezone));

  return (
    <Box>
      <PageHeader title="Water" />

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: '5fr 7fr' },
          alignItems: 'start',
        }}
      >
        <Card sx={{ overflow: 'hidden' }}>
          <Box sx={{ height: 2 }}>{day.refreshing && <LinearProgress sx={{ height: 2, borderRadius: 0 }} aria-label="Refreshing" />}</Box>
          <Box sx={{ px: 1, pt: 0.5 }}>
            <DayBar
              date={date}
              onChange={setDate}
              trailing={
                <OverflowMenu
                  label="More water actions"
                  actions={[
                    {
                      label: 'Edit daily target',
                      icon: <TuneRoundedIcon fontSize="small" />,
                      onClick: () => navigate('/settings'),
                    },
                    {
                      label: 'Hydration reminders',
                      icon: <AlarmRoundedIcon fontSize="small" />,
                      onClick: () => navigate('/alarms'),
                    },
                  ]}
                />
              }
            />
          </Box>
          <CardContent sx={{ pt: 1 }}>
            {day.error && !d ? (
              <ErrorState error={day.error} onRetry={() => void day.reload()} />
            ) : !d ? (
              <LoadingState label="Loading water…" minHeight={260} />
            ) : (
              <>
                <WaterRing totalMl={d.totalMl} targetMl={d.targetMl} size={196} />
                <Typography textAlign="center" fontWeight={700} sx={{ mt: 1.5 }}>
                  {d.targetMl == null
                    ? 'Set a daily water target to track progress'
                    : d.remainingMl
                      ? `${fmtMl(d.remainingMl)} to go`
                      : 'Target reached — nicely done!'}
                </Typography>
                {d.minMl != null && d.maxMl != null && (
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    Healthy range {fmtMl(d.minMl)}–{fmtMl(d.maxMl)}
                  </Typography>
                )}
                {d.overMax && (
                  <Alert severity="warning" sx={{ mt: 2 }}>
                    Above your upper limit for today — sip only if thirsty.
                  </Alert>
                )}

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 1,
                    mt: 2.5,
                  }}
                >
                  {QUICK.map((ml) => (
                    <Button
                      key={ml}
                      variant="contained"
                      disabled={busy}
                      onClick={() => add(ml)}
                      aria-label={`Add ${ml} ml`}
                      sx={{
                        minHeight: 64,
                        flexDirection: 'column',
                        gap: 0.25,
                        borderRadius: '16px',
                        fontSize: 18,
                        fontWeight: 800,
                        lineHeight: 1.1,
                      }}
                    >
                      <WaterDropRoundedIcon sx={{ fontSize: 20 }} />
                      {ml}
                      <Box component="span" sx={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>
                        ml
                      </Box>
                    </Button>
                  ))}
                </Box>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mt: 1.5 }}
                  component="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void add(Number(custom));
                  }}
                >
                  <TextField
                    placeholder="Other amount"
                    size="medium"
                    type="number"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    slotProps={{
                      htmlInput: {
                        min: 1,
                        max: MAX_ENTRY,
                        step: 1,
                        inputMode: 'numeric',
                        'aria-label': 'Custom amount in ml',
                      },
                      input: {
                        endAdornment: <InputAdornment position="end">ml</InputAdornment>,
                      },
                    }}
                  />
                  <Button type="submit" variant="outlined" disabled={busy || !custom} sx={{ minWidth: 80, minHeight: 56 }}>
                    Add
                  </Button>
                </Stack>
              </>
            )}
          </CardContent>
        </Card>

        <Stack spacing={2}>
          {d && (
            <Card>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ px: 2, pt: 1.75, pb: 1 }}>
                <Typography component="h2" fontWeight={700} sx={{ fontSize: 17 }}>
                  {label === 'Today' ? "Today's log" : `Log · ${label}`}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {entries.length} {entries.length === 1 ? 'drink' : 'drinks'}
                </Typography>
              </Stack>
              <Divider />
              {entries.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2.5 }}>
                  Nothing logged yet. Tap a quick-add button when you drink.
                </Typography>
              ) : (
                <List disablePadding>
                  {entries.map((e, i) => (
                    <ActionRow
                      key={e.id}
                      divider={i > 0}
                      trailing={
                        <IconButton
                          aria-label={`Remove ${e.amountMl} ml logged at ${formatInstant(e.loggedAt, timezone)}`}
                          onClick={() => remove(e)}
                          sx={{ width: 44, height: 44 }}
                        >
                          <DeleteOutlineRoundedIcon />
                        </IconButton>
                      }
                    >
                      <WaterDropRoundedIcon sx={{ color: 'info.main' }} aria-hidden />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={700}>{fmtMl(e.amountMl)}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {formatClock(formatInstant(e.loggedAt, timezone))}
                          {e.note ? ` · ${e.note}` : ''}
                        </Typography>
                      </Box>
                    </ActionRow>
                  ))}
                </List>
              )}
            </Card>
          )}
          {d?.history && (
            <Card>
              <CardContent>
                <Typography component="h2" fontWeight={700} sx={{ fontSize: 17, mb: 1 }}>
                  Last {HISTORY_DAYS} days
                </Typography>
                <WaterHistoryChart range={d.history} />
              </CardContent>
            </Card>
          )}
        </Stack>
      </Box>

      <Snackbar
        open={!!undo}
        autoHideDuration={6000}
        onClose={(_, reason) => reason !== 'clickaway' && setUndo(null)}
        message={undo ? `Added ${undo.amountMl} ml` : ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{
          bottom: {
            xs: `calc(${BOTTOM_NAV_OFFSET} + 12px) !important`,
            md: 24,
          },
        }}
        action={
          <Button color="primary" onClick={doUndo} sx={{ minHeight: 44 }}>
            Undo
          </Button>
        }
      />
    </Box>
  );
}
