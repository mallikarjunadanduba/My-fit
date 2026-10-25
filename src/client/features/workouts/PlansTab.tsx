import { useState } from 'react';
import { alpha } from '@mui/material/styles';
import { Box, Button, Card, Chip, IconButton, List, ListItem, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import { api, toApiError } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useFeedback } from '../../components/common/Feedback';
import { FabSpacer, PrimaryAction } from '../../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { DayDialog, DayExerciseDialog, PlanDialog, weekdayLabel, weekdayShort } from './PlanDialogs';
import { RowMenu } from './RowMenu';
import { targetSummary, type DayExercise, type Plan, type PlanSummary, type WorkoutDay } from './types';

function PlanEditor({ planId, onBack, onChanged }: { planId: string; onBack: () => void; onChanged: () => void }) {
  const { notify, confirm } = useFeedback();
  const { data: plan, error, loading, reload, setData } = useAsync(() => api.get<Plan>(`/workouts/plans/${planId}`), [planId]);
  const [planDialog, setPlanDialog] = useState(false);
  const [dayDialog, setDayDialog] = useState<{ day: WorkoutDay | null } | null>(null);
  const [itemDialog, setItemDialog] = useState<{ dayId: string; item: DayExercise | null } | null>(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !plan) return <LoadingState label="Loading plan…" />;
  if (!plan) return null;

  const refresh = () => {
    void reload();
    onChanged();
  };
  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      notify(success);
      refresh();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const move = async (day: WorkoutDay, index: number, dir: -1 | 1) => {
    const ids = day.exercises.map((e) => e.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const byId = new Map(day.exercises.map((e) => [e.id, e]));
    // Optimistic reorder; the server answer is the same order.
    setData({ ...plan, days: plan.days.map((d) => (d.id === day.id ? { ...d, exercises: ids.map((id) => byId.get(id)!) } : d)) });
    try {
      await api.post<WorkoutDay>(`/workouts/days/${day.id}/exercises/reorder`, { ids });
    } catch (e) {
      notify(toApiError(e).message, 'error');
      void reload();
    }
  };

  const removePlan = async () => {
    if (!(await confirm({ title: `Delete "${plan.name}"?`, message: 'Days and planned exercises are removed. Logged workouts are kept.', destructive: true }))) return;
    try {
      await api.delete(`/workouts/plans/${plan.id}`);
      notify('Plan deleted');
      onChanged();
      onBack();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const takenWeekdays = plan.days.map((d) => d.weekday).filter((w): w is number => w != null);
  const mondayFirst = (w: number | null) => (w == null ? 7 : (w + 6) % 7);
  const sortedDays = [...plan.days].sort((a, b) => mondayFirst(a.weekday) - mondayFirst(b.weekday) || a.sortOrder - b.sortOrder);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1.5, mx: { xs: -1, md: 0 } }}>
        <IconButton aria-label="Back to plans" onClick={onBack}>
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={800} fontSize={19} noWrap>
            {plan.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {plan.isActive ? 'Active plan · drives your schedule' : 'Not active'}
            {plan.description ? ` · ${plan.description}` : ''}
          </Typography>
        </Box>
        <RowMenu
          label="Plan options"
          items={[
            { label: 'Edit details', icon: <EditOutlinedIcon fontSize="small" />, onClick: () => setPlanDialog(true) },
            {
              label: 'Make active plan',
              icon: <CheckCircleOutlineIcon fontSize="small" />,
              hidden: plan.isActive,
              onClick: () => run(() => api.post(`/workouts/plans/${plan.id}/activate`), 'Plan activated — your schedule now follows it'),
            },
            {
              label: 'Deactivate',
              icon: <PauseCircleOutlineIcon fontSize="small" />,
              hidden: !plan.isActive,
              onClick: () => run(() => api.post(`/workouts/plans/${plan.id}/deactivate`), 'Plan deactivated'),
            },
            { label: 'Delete plan', icon: <DeleteOutlineIcon fontSize="small" />, danger: true, onClick: removePlan },
          ]}
        />
      </Stack>

      {!plan.isActive && (
        <Button
          fullWidth
          variant="outlined"
          startIcon={<CheckCircleOutlineIcon />}
          onClick={() => run(() => api.post(`/workouts/plans/${plan.id}/activate`), 'Plan activated — your schedule now follows it')}
          sx={{ mb: 2, minHeight: 48 }}
        >
          Make this my active plan
        </Button>
      )}

      {sortedDays.length === 0 ? (
        <Card>
          <EmptyState title="No days yet" description="Add a day for each weekday you train (and rest days if you like)." />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {sortedDays.map((day) => (
            <Card key={day.id}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ pl: 2, pr: 1, py: 1.25 }}>
                <Box
                  sx={(t) => ({
                    minWidth: 44,
                    px: 0.5,
                    py: 0.5,
                    borderRadius: '10px',
                    textAlign: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    color: day.weekday == null ? 'text.secondary' : 'primary.main',
                    bgcolor: day.weekday == null ? alpha(t.palette.text.primary, 0.06) : alpha(t.palette.primary.main, 0.12),
                  })}
                >
                  {weekdayShort(day.weekday)}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={800} noWrap>
                    {day.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {day.isRestDay ? 'Rest day' : `${day.exercises.length} exercise${day.exercises.length === 1 ? '' : 's'}`} · {weekdayLabel(day.weekday)}
                  </Typography>
                </Box>
                <RowMenu
                  label={`Options for ${day.name}`}
                  items={[
                    { label: 'Edit day', icon: <EditOutlinedIcon fontSize="small" />, onClick: () => setDayDialog({ day }) },
                    {
                      label: 'Delete day',
                      icon: <DeleteOutlineIcon fontSize="small" />,
                      danger: true,
                      onClick: async () => {
                        if (await confirm({ title: `Delete "${day.name}"?`, message: 'Its planned exercises are removed. Logged workouts are kept.', destructive: true })) {
                          void run(() => api.delete(`/workouts/days/${day.id}`), 'Day deleted');
                        }
                      },
                    },
                  ]}
                />
              </Stack>
              {!day.isRestDay && (
                <List disablePadding sx={{ borderTop: 1, borderColor: 'divider' }}>
                  {day.exercises.map((item, i) => (
                    <ListItem
                      key={item.id}
                      divider
                      secondaryAction={
                        <RowMenu
                          label={`Options for ${item.exercise.name}`}
                          items={[
                            { label: 'Edit targets', icon: <EditOutlinedIcon fontSize="small" />, onClick: () => setItemDialog({ dayId: day.id, item }) },
                            { label: 'Move up', icon: <ArrowUpwardIcon fontSize="small" />, disabled: i === 0, onClick: () => void move(day, i, -1) },
                            { label: 'Move down', icon: <ArrowDownwardIcon fontSize="small" />, disabled: i === day.exercises.length - 1, onClick: () => void move(day, i, 1) },
                            {
                              label: 'Remove from day',
                              icon: <DeleteOutlineIcon fontSize="small" />,
                              danger: true,
                              onClick: async () => {
                                if (await confirm({ title: `Remove ${item.exercise.name} from ${day.name}?`, destructive: true, confirmLabel: 'Remove' })) {
                                  void run(() => api.delete(`/workouts/day-exercises/${item.id}`), 'Exercise removed from day');
                                }
                              },
                            },
                          ]}
                        />
                      }
                      sx={{ pl: 2, pr: 7 }}
                    >
                      <ListItemText
                        primary={`${item.exercise.name}${item.exercise.archivedAt ? ' (archived)' : ''}`}
                        secondary={targetSummary(item) + (item.notes ? ` · ${item.notes}` : '')}
                        slotProps={{ primary: { fontWeight: 600, noWrap: true }, secondary: { noWrap: true } }}
                      />
                    </ListItem>
                  ))}
                  <ListItemButton onClick={() => setItemDialog({ dayId: day.id, item: null })} sx={{ color: 'primary.main', pl: 2, minHeight: 48 }}>
                    <AddIcon fontSize="small" sx={{ mr: 1 }} />
                    <Typography fontWeight={700} fontSize={15}>
                      Add exercise
                    </Typography>
                  </ListItemButton>
                </List>
              )}
            </Card>
          ))}
        </Stack>
      )}

      <PrimaryAction icon={<AddIcon />} label="Add day" onClick={() => setDayDialog({ day: null })} />
      <FabSpacer />

      <PlanDialog
        open={planDialog}
        plan={plan}
        onClose={() => setPlanDialog(false)}
        onSaved={() => {
          setPlanDialog(false);
          notify('Plan saved');
          refresh();
        }}
      />
      <DayDialog
        open={!!dayDialog}
        planId={plan.id}
        day={dayDialog?.day ?? null}
        takenWeekdays={takenWeekdays}
        onClose={() => setDayDialog(null)}
        onSaved={() => {
          setDayDialog(null);
          notify('Day saved');
          refresh();
        }}
      />
      <DayExerciseDialog
        open={!!itemDialog}
        dayId={itemDialog?.dayId ?? ''}
        item={itemDialog?.item ?? null}
        onClose={() => setItemDialog(null)}
        onSaved={() => {
          setItemDialog(null);
          notify('Planned exercise saved');
          refresh();
        }}
      />
    </Box>
  );
}

/** Plans as list rows; tap a plan to edit its days and exercises. */
export function PlansTab() {
  const { notify, confirm } = useFeedback();
  const { data: plans, error, loading, reload } = useAsync(() => api.get<PlanSummary[]>('/workouts/plans'), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ plan: Plan | null } | null>(null);

  if (selectedId) {
    return <PlanEditor key={selectedId} planId={selectedId} onBack={() => setSelectedId(null)} onChanged={() => void reload()} />;
  }
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !plans) return <LoadingState label="Loading plans…" />;

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      notify(success);
      void reload();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  return (
    <Box>
      {plans?.length === 0 ? (
        <Card>
          <EmptyState icon={<EventNoteOutlinedIcon fontSize="inherit" />} title="No plans yet" description="Create a weekly plan to get a daily workout schedule." />
        </Card>
      ) : (
        <>
          <Card>
            <List disablePadding>
              {plans?.map((p, i) => (
                <ListItem
                  key={p.id}
                  disablePadding
                  divider={i < plans.length - 1}
                  secondaryAction={
                    <RowMenu
                      label={`Options for ${p.name}`}
                      items={[
                        {
                          label: 'Edit details',
                          icon: <EditOutlinedIcon fontSize="small" />,
                          onClick: () => setDialog({ plan: { id: p.id, name: p.name, description: p.description, isActive: p.isActive, days: [] } }),
                        },
                        {
                          label: 'Make active plan',
                          icon: <CheckCircleOutlineIcon fontSize="small" />,
                          hidden: p.isActive,
                          onClick: () => run(() => api.post(`/workouts/plans/${p.id}/activate`), 'Plan activated'),
                        },
                        {
                          label: 'Deactivate',
                          icon: <PauseCircleOutlineIcon fontSize="small" />,
                          hidden: !p.isActive,
                          onClick: () => run(() => api.post(`/workouts/plans/${p.id}/deactivate`), 'Plan deactivated'),
                        },
                        {
                          label: 'Delete plan',
                          icon: <DeleteOutlineIcon fontSize="small" />,
                          danger: true,
                          onClick: async () => {
                            if (await confirm({ title: `Delete "${p.name}"?`, message: 'Days and planned exercises are removed. Logged workouts are kept.', destructive: true })) {
                              void run(() => api.delete(`/workouts/plans/${p.id}`), 'Plan deleted');
                            }
                          },
                        },
                      ]}
                    />
                  }
                >
                  <ListItemButton onClick={() => setSelectedId(p.id)} sx={{ py: 1.5, pr: 7 }}>
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center" component="span">
                          <Box component="span" sx={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                          </Box>
                          {p.isActive && <Chip size="small" color="success" label="Active" />}
                        </Stack>
                      }
                      secondary={`${p.trainingDays} training day${p.trainingDays === 1 ? '' : 's'} · ${p.exerciseCount} exercises${
                        p.scheduledWeekdays.length ? ` · ${p.scheduledWeekdays.map((w) => weekdayShort(w)).join(' ')}` : ''
                      }`}
                      slotProps={{ secondary: { noWrap: true } }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Card>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 0.5, mt: 1 }}>
            Only the active plan drives your schedule. Sample plans are yours to edit.
          </Typography>
        </>
      )}

      <PrimaryAction icon={<AddIcon />} label="New plan" onClick={() => setDialog({ plan: null })} />
      <FabSpacer />
      <PlanDialog
        open={!!dialog}
        plan={dialog?.plan ?? null}
        onClose={() => setDialog(null)}
        onSaved={(p) => {
          const isNew = !dialog?.plan;
          setDialog(null);
          notify(isNew ? 'Plan created' : 'Plan saved');
          void reload();
          if (isNew) setSelectedId(p.id);
        }}
      />
    </Box>
  );
}
