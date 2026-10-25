import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, IconButton, LinearProgress, Stack, Typography } from '@mui/material';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import { api, toApiError } from '../services/api';
import { formatDay, shiftDate, todayIn } from '../services/dates';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../features/auth/AuthContext';
import { useFeedback } from '../components/common/Feedback';
import { PageHeader } from '../components/common/PageHeader';
import { SectionTabs } from '../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { useAlarms } from '../features/alarms/AlarmProvider';
import { RoutineTimeline } from '../features/routine/RoutineTimeline';
import { EntrySheet, type EntryChange } from '../features/routine/EntryEditDialog';
import { TemplateEditor, type TemplateKind } from '../features/routine/TemplateEditor';
import { applyEntryChange, computeProgress, sortEntries, type RoutineDay, type RoutineEntry } from '../features/routine/types';

type TabKey = 'today' | TemplateKind;
const TAB_KEYS: TabKey[] = ['today', 'gym', 'rest', 'custom'];

/** Compact ‹ date › navigator; tapping the label opens the native date picker. */
function DayNav({ date, today, onChange }: { date: string; today: string; onChange: (d: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const label = date === today ? 'Today' : date === shiftDate(today, -1) ? 'Yesterday' : date === shiftDate(today, 1) ? 'Tomorrow' : formatDay(date, 'EEEE');
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <IconButton aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))} sx={{ width: 44, height: 44 }}>
        <ChevronLeftRoundedIcon />
      </IconButton>
      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <Button
          fullWidth
          color="inherit"
          startIcon={<CalendarMonthRoundedIcon />}
          onClick={() => {
            const el = inputRef.current;
            if (el && 'showPicker' in el) {
              try {
                el.showPicker();
                return;
              } catch {
                /* fall through to focus */
              }
            }
            el?.focus();
          }}
          sx={{ minHeight: 44, flexDirection: 'row', fontSize: 16 }}
        >
          <Box component="span" sx={{ fontWeight: 800 }}>
            {label}
          </Box>
          <Box component="span" sx={{ ml: 0.75, color: 'text.secondary', fontWeight: 500 }}>
            {formatDay(date, 'd MMM')}
          </Box>
        </Button>
        <Box
          component="input"
          ref={inputRef}
          type="date"
          value={date}
          aria-label="Select date"
          tabIndex={-1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => e.target.value && onChange(e.target.value)}
          sx={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%', border: 0 }}
        />
      </Box>
      <IconButton aria-label="Next day" onClick={() => onChange(shiftDate(date, 1))} sx={{ width: 44, height: 44 }}>
        <ChevronRightRoundedIcon />
      </IconButton>
    </Stack>
  );
}

export default function RoutinePage() {
  const { timezone } = useAuth();
  const { notify } = useFeedback();
  const { refresh: refreshAlarms } = useAlarms();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: TabKey = rawTab === 'templates' ? 'gym' : TAB_KEYS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'today';
  const today = todayIn(timezone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today;
  const [now, setNow] = useState(Date.now());
  const [sheet, setSheet] = useState<RoutineEntry | null>(null);
  const [templatesVersion, setTemplatesVersion] = useState(0);

  const { data, setData, error, loading, refreshing, reload } = useAsync(() => api.get<RoutineDay>('/routines/day', { date }), [date, templatesVersion]);

  // Re-evaluate overdue / up-next highlighting every 30 s.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const replaceEntry = (entry: RoutineEntry) =>
    setData((d) => {
      if (!d) return d;
      const entries = sortEntries(d.entries.map((x) => (x.id === entry.id ? entry : x)));
      return { ...d, entries, progress: computeProgress(entries) };
    });

  /** Optimistic: the timeline updates instantly; the PATCH (one DB round trip) runs in the background. */
  const apply = async (entry: RoutineEntry, change: EntryChange) => {
    const before = data?.entries.find((x) => x.id === entry.id) ?? entry;
    replaceEntry(applyEntryChange(before, change));
    if (change.status === 'COMPLETED') notify(`Done: ${entry.title}`);
    else if (change.snoozeMinutes) notify(`Snoozed ${change.snoozeMinutes} min`, 'info');
    else if (change.status === 'SKIPPED') notify('Skipped', 'info');
    else if (change.status === 'MISSED') notify('Marked missed', 'info');
    try {
      const updated = await api.patch<RoutineEntry>(`/routines/entries/${entry.id}`, change);
      if (updated) replaceEntry(updated);
      void refreshAlarms();
    } catch (e) {
      replaceEntry(before);
      notify(toApiError(e).message, 'error');
    }
  };

  const progress = data?.progress;

  return (
    <Box>
      <PageHeader title="Daily Routine" />
      <SectionTabs
        value={tab}
        onChange={(v) => setParam('tab', v === 'today' ? null : v)}
        ariaLabel="Routine sections"
        tabs={[
          { value: 'today', label: 'Today' },
          { value: 'gym', label: 'Gym day' },
          { value: 'rest', label: 'Rest day' },
          { value: 'custom', label: 'Custom' },
        ]}
      />

      {tab === 'today' ? (
        <Stack spacing={1.5}>
          <DayNav date={date} today={today} onChange={(d) => setParam('date', d === today ? null : d)} />
          {loading && !data ? (
            <LoadingState />
          ) : error && !data ? (
            <ErrorState error={error} onRetry={reload} />
          ) : data ? (
            <>
              <Card>
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" alignItems="baseline" spacing={0.75}>
                        <Typography component="p" sx={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                          {progress?.completed ?? 0}
                          <Box component="span" sx={{ color: 'text.secondary', fontSize: 20, fontWeight: 700 }}>
                            /{progress?.total ?? 0}
                          </Box>
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          done
                        </Typography>
                      </Stack>
                      {progress && progress.total > 0 && (
                        <Typography variant="caption" color="text.secondary" component="div">
                          {progress.pending} to go
                          {progress.skipped ? ` · ${progress.skipped} skipped` : ''}
                          {progress.missed ? ` · ${progress.missed} missed` : ''}
                        </Typography>
                      )}
                    </Box>
                    <Stack alignItems="flex-end" spacing={0.5}>
                      <Chip size="small" label={data.dayType === 'GYM' ? 'Gym day' : 'Rest day'} color={data.dayType === 'GYM' ? 'primary' : 'default'} />
                      <Typography variant="h6" component="p" aria-label={progress?.percent == null ? 'No progress yet' : `${progress.percent}% complete`}>
                        {progress?.percent == null ? '—' : `${progress.percent}%`}
                      </Typography>
                    </Stack>
                  </Stack>
                  <LinearProgress
                    variant={refreshing && !progress?.total ? 'indeterminate' : 'determinate'}
                    value={progress?.percent ?? 0}
                    color="success"
                    sx={{ mt: 1.5 }}
                    aria-hidden
                  />
                </CardContent>
              </Card>

              {data.entries.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<ViewTimelineRoundedIcon fontSize="inherit" />}
                    title={date < today ? 'Nothing was recorded' : 'No routine for this day'}
                    description={date < today ? 'Past days only show what was tracked at the time.' : 'Add items to your Gym-day or Rest-day routine.'}
                    action={
                      date >= today ? (
                        <Button variant="outlined" onClick={() => setParam('tab', data.dayType === 'GYM' ? 'gym' : 'rest')} sx={{ minHeight: 44 }}>
                          Edit {data.dayType === 'GYM' ? 'gym-day' : 'rest-day'} routine
                        </Button>
                      ) : undefined
                    }
                  />
                </Card>
              ) : (
                <RoutineTimeline
                  entries={data.entries}
                  timezone={timezone}
                  isToday={date === today}
                  now={now}
                  onOpen={setSheet}
                  onComplete={(e) => void apply(e, { status: 'COMPLETED' })}
                />
              )}
            </>
          ) : null}
        </Stack>
      ) : (
        <TemplateEditor kind={tab} onChanged={() => setTemplatesVersion((v) => v + 1)} />
      )}

      <EntrySheet entry={sheet} onClose={() => setSheet(null)} onApply={(e, c) => void apply(e, c)} />
    </Box>
  );
}
