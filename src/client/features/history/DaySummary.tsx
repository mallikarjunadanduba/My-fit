import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, Chip, Divider, Grid, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { ErrorState, LoadingState } from '../../components/common/States';
import { TargetProgressBar } from '../../components/common/TargetProgressBar';
import { useFeedback } from '../../components/common/Feedback';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../services/api';
import { formatDay, formatInstant } from '../../services/dates';
import { nutrientColors } from '../../theme/theme';
import { ScoreRing } from '../dashboard/ScoreRing';
import { fmt, fmtMl, MEAL_STATUS, SESSION_STATUS, STATUS_CHIP, titleCase } from '../reports/format';
import type { DailyReport, DayKind } from '../reports/types';

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" component="h3" sx={{ flex: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}

/** Notes + day-type override for a date (PUT /api/reports/daily/:date). */
export function DayLogEditor({ report, onSaved }: { report: DailyReport; onSaved: () => void }) {
  const { notify } = useFeedback();
  const [notes, setNotes] = useState(report.notes ?? '');
  const [dayType, setDayType] = useState<DayKind | 'AUTO'>(report.dayTypeOverride ?? 'AUTO');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setNotes(report.notes ?? '');
    setDayType(report.dayTypeOverride ?? 'AUTO');
  }, [report.date, report.notes, report.dayTypeOverride]);

  const dirty = notes !== (report.notes ?? '') || dayType !== (report.dayTypeOverride ?? 'AUTO');
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/reports/daily/${report.date}`, {
        notes: notes.trim() ? notes : null,
        dayType: dayType === 'AUTO' ? null : dayType,
      });
      notify('Day log saved');
      onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      <TextField
        select
        size="medium"
        label="Day type"
        value={dayType}
        onChange={(e) => setDayType(e.target.value as DayKind | 'AUTO')}
        helperText={
          dayType === 'AUTO'
            ? `Automatic from your gym weekdays (${report.dayTypeOverride ? 'currently overridden' : report.dayType === 'GYM' ? 'gym day' : 'rest day'})`
            : 'Overrides your weekly schedule for this date'
        }
      >
        <MenuItem value="AUTO">Automatic (weekly schedule)</MenuItem>
        <MenuItem value="GYM">Gym day</MenuItem>
        <MenuItem value="REST">Rest day</MenuItem>
      </TextField>
      <TextField
        label="Notes"
        size="medium"
        multiline
        minRows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        slotProps={{ htmlInput: { maxLength: 5000 } }}
        placeholder="How did the day go? Energy, sleep, cravings…"
      />
      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="contained" onClick={save} disabled={!dirty || saving} sx={{ minHeight: 44, minWidth: 96 }}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {dirty && (
          <Button
            onClick={() => {
              setNotes(report.notes ?? '');
              setDayType(report.dayTypeOverride ?? 'AUTO');
            }}
          >
            Reset
          </Button>
        )}
        {report.log && (
          <Typography variant="caption" color="text.secondary">
            Updated {formatInstant(report.log.updatedAt, report.timezone, 'd MMM yyyy, HH:mm')}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

export function DaySummaryView({ report, onChanged }: { report: DailyReport; onChanged: () => void }) {
  const n = report.nutrition;
  const tz = report.timezone;
  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={2} alignItems="center">
        {report.score ? <ScoreRing score={report.score} size={88} /> : <Chip label={report.isFuture ? 'Planned day' : 'No score'} variant="outlined" />}
        <Box>
          <Typography variant="subtitle1" component="p">
            {formatDay(report.date, 'EEEE, d MMMM')}
          </Typography>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
            <Chip size="small" color={report.dayType === 'GYM' ? 'primary' : 'default'} label={report.dayType === 'GYM' ? 'Gym day' : 'Rest day'} />
            {report.dayTypeOverride && <Chip size="small" variant="outlined" label="Override" />}
            <Chip size="small" variant="outlined" label={report.timezone} />
          </Stack>
        </Box>
      </Stack>

      <Section
        title="Nutrition"
        action={
          <Button size="small" component={RouterLink} to={`/diary?date=${report.date}`}>
            Open diary
          </Button>
        }
      >
        {!n.logged && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {report.isFuture ? 'Planned day — nothing logged yet.' : 'No food logged for this day.'}
          </Typography>
        )}
        {n.progress ? (
          <Grid container spacing={2}>
            {(
              [
                ['Calories', 'calories', 'kcal'],
                ['Protein', 'protein', 'g'],
                ['Carbs', 'carbs', 'g'],
                ['Fat', 'fat', 'g'],
                ['Fiber', 'fiber', 'g'],
              ] as const
            ).map(([label, key, unit]) => (
              <Grid key={key} size={{ xs: 12, sm: 6 }}>
                <TargetProgressBar label={label} progress={n.progress![key]} unit={unit} color={nutrientColors[key]} />
              </Grid>
            ))}
          </Grid>
        ) : (
          n.totals && (
            <Typography variant="body2">
              {fmt(n.totals.calories, 0)} kcal · P {fmt(n.totals.protein)} g · C {fmt(n.totals.carbs)} g · F {fmt(n.totals.fat)} g · Fiber {fmt(n.totals.fiber)} g
            </Typography>
          )
        )}
      </Section>

      {report.meals.length > 0 && (
        <Section title="Meals">
          <Card variant="outlined" sx={{ borderRadius: '14px' }}>
            <List disablePadding aria-label="Meals for the day">
              {report.meals.map((m, i) => (
                <ListItem key={m.slotId} divider={i < report.meals.length - 1 || !!n.unslotted} sx={{ py: 0.75, minHeight: 52 }}>
                  <ListItemText
                    primary={m.name}
                    secondary={
                      (m.totals
                        ? [`${fmt(m.totals.calories, 0)} kcal`, `P ${fmt(m.totals.protein)} g`, `${m.entryCount} item${m.entryCount === 1 ? '' : 's'}`]
                        : [m.plannedMeal?.name]
                      )
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    slotProps={{
                      primary: { fontWeight: 600, noWrap: true },
                      secondary: { noWrap: true },
                    }}
                    sx={{ my: 0, minWidth: 0 }}
                  />
                  <Chip size="small" label={MEAL_STATUS[m.status].label} color={MEAL_STATUS[m.status].color} variant="outlined" sx={{ ml: 1, flexShrink: 0 }} />
                </ListItem>
              ))}
              {n.unslotted && (
                <ListItem sx={{ py: 0.75 }}>
                  <ListItemText
                    primary="Other"
                    secondary={`${n.unslotted.entryCount} item${n.unslotted.entryCount === 1 ? '' : 's'} · ${fmt(n.unslotted.totals.calories, 0)} kcal · P ${fmt(n.unslotted.totals.protein)} g`}
                    slotProps={{ primary: { fontWeight: 600 } }}
                    sx={{ my: 0 }}
                  />
                </ListItem>
              )}
            </List>
          </Card>
        </Section>
      )}

      <Section title="Water">
        <Typography variant="body2">
          {report.water.logged ? (
            <>
              <b>{fmtMl(report.water.totalMl)}</b>
              {report.water.targetMl != null && ` of ${fmtMl(report.water.targetMl)} (${report.water.progress?.percent ?? 0}%)`} · {report.water.entries.length} entr
              {report.water.entries.length === 1 ? 'y' : 'ies'}
            </>
          ) : (
            <Typography component="span" variant="body2" color="text.secondary">
              No water logged.
            </Typography>
          )}
        </Typography>
      </Section>

      <Section title="Workout">
        {report.workouts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {report.dayType === 'REST' ? 'Rest day — no workout planned.' : 'No workout logged.'}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {report.workouts.map((w) => (
              <Box key={w.id}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body1" fontWeight={600} sx={{ flex: 1 }}>
                    {w.name}
                  </Typography>
                  <Chip size="small" label={SESSION_STATUS[w.status].label} color={SESSION_STATUS[w.status].color} />
                  <Button size="small" component={RouterLink} to={`/workouts/session/${w.id}`}>
                    Open
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {w.completedExercises}/{w.totalExercises} exercises · {w.completedSets}/{w.totalSets} sets
                  {w.volumeKg > 0 ? ` · ${fmt(w.volumeKg, 0)} kg volume` : ''}
                  {w.startedAt ? ` · started ${formatInstant(w.startedAt, tz)}` : ''}
                </Typography>
                {w.exercises.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                    {w.exercises.map((e) => (
                      <Typography key={e.id} component="li" variant="body2">
                        {e.name}{' '}
                        <Typography component="span" variant="caption" color="text.secondary">
                          {e.sets.length
                            ? e.sets
                                .map(
                                  (s) =>
                                    (s.reps != null ? `${s.reps}${s.weightKg != null ? `×${s.weightKg}kg` : ''}` : s.durationSec != null ? `${s.durationSec}s` : '—') +
                                    (s.completed ? '' : '*'),
                                )
                                .join(', ')
                            : titleCase(e.status)}
                        </Typography>
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
            <Typography variant="caption" color="text.secondary">
              * set not completed
            </Typography>
          </Stack>
        )}
      </Section>

      <Section title="Routine">
        {report.routine.total === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No routine entries for this day.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <b>{report.routine.completionPct}%</b> complete — {report.routine.completed} of {report.routine.total} done
            </Typography>
            <Stack spacing={0.5}>
              {report.routineEntries.map((e) => (
                <Stack key={e.id} direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 48 }}>
                    {e.scheduledTime}
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {e.title}
                  </Typography>
                  <Chip size="small" variant="outlined" label={titleCase(e.status)} color={STATUS_CHIP[e.status] ?? 'default'} />
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </Section>

      {report.measurement && (
        <Section title="Body measurement">
          <Typography variant="body2">
            {[
              report.measurement.weightKg != null && `Weight ${fmt(report.measurement.weightKg)} kg`,
              report.measurement.bodyFatPct != null && `Body fat ${fmt(report.measurement.bodyFatPct)}%`,
              report.measurement.waistCm != null && `Waist ${fmt(report.measurement.waistCm)} cm`,
              report.measurement.chestCm != null && `Chest ${fmt(report.measurement.chestCm)} cm`,
              report.measurement.armCm != null && `Arm ${fmt(report.measurement.armCm)} cm`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Recorded'}
          </Typography>
        </Section>
      )}

      <Divider />
      <Section title="Day log">
        <DayLogEditor report={report} onSaved={onChanged} />
      </Section>
    </Stack>
  );
}

/** Loads and renders the daily summary for `date`. */
export function DaySummary({ date, onChanged }: { date: string; onChanged?: () => void }) {
  const { data, error, loading, reload } = useAsync(() => api.get<DailyReport>(`/reports/daily/${date}`), [date]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && (!data || data.date !== date)) return <LoadingState label="Loading day…" />;
  if (!data) return null;
  return (
    <DaySummaryView
      report={data}
      onChanged={() => {
        void reload();
        onChanged?.();
      }}
    />
  );
}
