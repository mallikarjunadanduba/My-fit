import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, Card, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import RestaurantRoundedIcon from '@mui/icons-material/RestaurantRounded';
import RestaurantMenuRoundedIcon from '@mui/icons-material/RestaurantMenuRounded';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useDateParam } from '../features/diary/useDateParam';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { useFeedback } from '../components/common/Feedback';
import { FabSpacer, PrimaryAction, TOP_BAR_OFFSET, usePhone } from '../components/common/mobile';
import { DAY_TYPE_LABELS, type MealSlot, type MealStatus, type MealTemplate } from '../features/meals/types';
import type { DiaryEntry } from '../features/diary/types';
import { AddFoodDialog } from '../features/diary/AddFoodDialog';
import { EditEntryDialog } from '../features/diary/EditEntryDialog';
import { LogPlannedMealDialog, type ApplyResult } from '../features/diary/LogPlannedMealDialog';
import { CopyDayDialog } from '../features/diary/CopyDayDialog';
import { MealSlotCard } from '../features/diary/MealSlotCard';
import { DaySummary } from '../features/diary/DaySummary';
import { DayBar } from '../features/diary/DayBar';
import { withEntries, withStatus, type DiaryWithPlan } from '../features/diary/dayMath';
import { fmt } from '../features/foods/format';
import { errorMessage } from '../features/foods/formHelpers';
import { OverflowMenu } from '../features/foods/mobile';

export default function DiaryPage() {
  const { notify, confirm } = useFeedback();
  const navigate = useNavigate();
  const phone = usePhone();
  const [date, setDate] = useDateParam();
  // One request: the diary day plus that day's plan (for "Log planned meal").
  const data = useAsync(() => api.get<DiaryWithPlan>('/food-diary', { date, withPlan: 'true' }), [date]);
  const [addFor, setAddFor] = useState<{ slotId: string | null } | null>(null);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [logPlan, setLogPlan] = useState<{
    slot: MealSlot;
    template: MealTemplate;
    existing: number;
  } | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const day = data.data;
  const planFor = (slotId: string) => day?.plan?.slots.find((s) => s.slot.id === slotId)?.template ?? null;
  const activeSlots = (day?.slots ?? []).map((s) => s.slot).filter((s) => !s.archivedAt);
  const update = (fn: (d: DiaryWithPlan) => DiaryWithPlan) => data.setData((d) => (d ? fn(d) : d));

  const setStatus = async (slotId: string, status: MealStatus) => {
    update((d) => withStatus(d, slotId, status));
    try {
      await api.put('/meals/status', { date, slotId, status });
    } catch (e) {
      notify(errorMessage(e), 'error');
      void data.reload();
    }
  };

  const removeEntry = async (e: DiaryEntry) => {
    const ok = await confirm({
      title: `Remove ${e.foodName}?`,
      message: 'This deletes the entry from this day.',
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    update((d) => withEntries(d, { remove: [e.id] }));
    try {
      await api.delete(`/food-diary/${e.id}`);
      notify(`${e.foodName} removed`);
    } catch (err) {
      notify(errorMessage(err), 'error');
      void data.reload();
    }
  };

  const onPlanLogged = (slotId: string, res: ApplyResult) => update((d) => withStatus(withEntries(d, { add: res.entries }), slotId, res.status.status));

  const planned = day?.plan?.totals?.min.calories;

  return (
    <Box>
      <PageHeader
        title="Food diary"
        subtitle={
          day ? (
            <Stack direction="row" spacing={1} alignItems="center" component="span">
              <Chip size="small" label={DAY_TYPE_LABELS[day.dayType]} color={day.dayType === 'GYM' ? 'primary' : 'default'} sx={{ height: 24 }} />
              {planned ? <span>Plan ~{fmt(planned, 0)} kcal</span> : null}
            </Stack>
          ) : undefined
        }
        actions={
          <>
            <PrimaryAction icon={<AddRoundedIcon />} label="Add food" onClick={() => setAddFor({ slotId: null })} />
            <OverflowMenu
              label="More diary actions"
              actions={[
                {
                  label: 'Copy from another day',
                  icon: <ContentCopyRoundedIcon fontSize="small" />,
                  onClick: () => setCopyOpen(true),
                },
                {
                  label: 'Edit meal plan',
                  icon: <RestaurantMenuRoundedIcon fontSize="small" />,
                  onClick: () => navigate('/meals'),
                },
              ]}
            />
          </>
        }
      />

      <Card
        sx={{
          mb: 2,
          overflow: 'hidden',
          position: phone ? 'sticky' : 'static',
          top: phone ? `calc(${TOP_BAR_OFFSET} + 8px)` : undefined,
          zIndex: 4,
          boxShadow: phone ? '0 6px 16px -12px rgba(0,0,0,.35)' : undefined,
        }}
      >
        <Box sx={{ height: 2 }}>{data.refreshing && <LinearProgress sx={{ height: 2, borderRadius: 0 }} aria-label="Refreshing" />}</Box>
        <Box sx={{ px: 1, pt: 0.5 }}>
          <DayBar date={date} onChange={setDate} />
        </Box>
        <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
          {day ? (
            <DaySummary day={day} />
          ) : data.error ? (
            <ErrorState error={data.error} onRetry={() => void data.reload()} />
          ) : (
            <LoadingState label="Loading your diary…" minHeight={96} />
          )}
        </Box>
      </Card>

      {day &&
        (day.slots.length === 0 && day.unslotted.entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={<RestaurantRoundedIcon fontSize="inherit" />}
              title="No meals set up yet"
              description="Add your meals (breakfast, lunch, …) on the meal plan, or just add food."
              action={
                <Button component={RouterLink} to="/meals" variant="outlined" sx={{ minHeight: 44 }}>
                  Set up meals
                </Button>
              }
            />
          </Card>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              alignItems: 'start',
            }}
          >
            {day.slots.map((s) => {
              const tpl = s.slot.archivedAt ? null : planFor(s.slot.id);
              return (
                <MealSlotCard
                  key={s.slot.id}
                  slot={s.slot}
                  status={s.status}
                  entries={s.entries}
                  totals={s.totals}
                  plan={tpl}
                  onStatus={(st) => setStatus(s.slot.id, st)}
                  onAdd={() => setAddFor({ slotId: s.slot.id })}
                  onLogPlan={
                    tpl
                      ? () =>
                          setLogPlan({
                            slot: s.slot,
                            template: tpl,
                            existing: s.entries.length,
                          })
                      : undefined
                  }
                  onEdit={setEditing}
                  onDelete={removeEntry}
                />
              );
            })}
            {day.unslotted.entries.length > 0 && (
              <MealSlotCard
                slot={null}
                status={null}
                entries={day.unslotted.entries}
                totals={day.unslotted.totals}
                plan={null}
                onAdd={() => setAddFor({ slotId: null })}
                onEdit={setEditing}
                onDelete={removeEntry}
              />
            )}
          </Box>
        ))}
      {day && !day.logged && day.slots.length > 0 && (
        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 2 }}>
          Nothing logged for this day yet.
        </Typography>
      )}

      <FabSpacer />

      <AddFoodDialog
        open={!!addFor}
        onClose={() => setAddFor(null)}
        date={date}
        defaultSlotId={addFor?.slotId}
        onSaved={(entry) => update((d) => withEntries(d, { add: [entry] }))}
      />
      <EditEntryDialog entry={editing} slots={activeSlots} onClose={() => setEditing(null)} onSaved={(e) => update((d) => withEntries(d, { replace: e }))} />
      <LogPlannedMealDialog
        open={!!logPlan}
        date={date}
        slot={logPlan?.slot ?? null}
        template={logPlan?.template ?? null}
        existingCount={logPlan?.existing ?? 0}
        onClose={() => setLogPlan(null)}
        onSaved={(res) => logPlan && onPlanLogged(logPlan.slot.id, res)}
      />
      <CopyDayDialog open={copyOpen} date={date} onClose={() => setCopyOpen(false)} onSaved={() => void data.reload()} />
    </Box>
  );
}
