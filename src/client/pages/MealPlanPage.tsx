import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  ButtonBase,
  Card,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded';
import RestaurantMenuRoundedIcon from '@mui/icons-material/RestaurantMenuRounded';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { formatClock } from '../services/dates';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { useFeedback } from '../components/common/Feedback';
import { FabSpacer, PrimaryAction, SectionTabs } from '../components/common/mobile';
import { nutrientColors } from '../theme/theme';
import { DAY_TYPE_LABELS, type DayType, type MealPlan, type MealSlot, type MealTemplate } from '../features/meals/types';
import { TemplateEditorDialog } from '../features/meals/TemplateEditorDialog';
import { SlotManagerDialog } from '../features/meals/SlotManagerDialog';
import { ChoosePlanDialog } from '../features/meals/ChoosePlanDialog';
import { fmt, formatQuantity } from '../features/foods/format';
import { errorMessage } from '../features/foods/formHelpers';
import { ActionRow, OverflowMenu, type OverflowAction } from '../features/foods/mobile';
import { CalorieRing, MacroBar } from '../features/diary/DaySummary';

type EditorState = {
  template: MealTemplate | null;
  defaults?: { slotId?: string | null; dayType?: DayType };
  planAfterSave?: boolean;
} | null;
type Section = 'plan' | 'meals';

const kcalRange = (min: number, max: number) => (Math.round(min) === Math.round(max) ? fmt(min, 0) : `${fmt(min, 0)}–${fmt(max, 0)}`);

function PlanSummary({ plan }: { plan: MealPlan }) {
  const t = plan.totals;
  if (!t)
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No meals planned for {DAY_TYPE_LABELS[plan.dayType].toLowerCase()}s yet.
      </Typography>
    );
  const p = plan.progress;
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ p: 2 }}>
      <CalorieRing kcal={t.min.calories} progress={p?.calories ?? null} size={88} />
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>
            {kcalRange(t.min.calories, t.max.calories)} kcal
          </Box>
          {plan.target ? ` · target ${fmt(plan.target.calories, 0)}` : ''}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 1.25,
          }}
        >
          <MacroBar label="Protein" color={nutrientColors.protein} progress={p?.protein ?? null} actual={t.min.protein} />
          <MacroBar label="Carbs" color={nutrientColors.carbs} progress={p?.carbs ?? null} actual={t.min.carbs} />
          <MacroBar label="Fat" color={nutrientColors.fat} progress={p?.fat ?? null} actual={t.min.fat} />
        </Box>
        {!plan.target && (
          <Typography variant="caption" color="text.secondary">
            <Link component={RouterLink} to="/settings">
              Set targets
            </Link>{' '}
            to compare your plan.
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function SlotPlanCard({ s, dayType, actions, onChoose }: { s: MealPlan['slots'][number]; dayType: DayType; actions: OverflowAction[]; onChoose: () => void }) {
  const t = s.template;
  return (
    <Card component="section" aria-labelledby={`plan-${s.slot.id}`}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 2, pr: 1, py: 1 }}>
        <ButtonBase
          onClick={onChoose}
          sx={{
            flex: 1,
            minWidth: 0,
            justifyContent: 'flex-start',
            textAlign: 'left',
            borderRadius: 2,
            minHeight: 48,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography id={`plan-${s.slot.id}`} component="h3" fontWeight={700} sx={{ fontSize: 17, overflowWrap: 'anywhere' }}>
              {s.slot.name}
              {s.slot.defaultTime && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                  {formatClock(s.slot.defaultTime)}
                </Typography>
              )}
            </Typography>
            <Typography variant="body2" color={t ? 'text.secondary' : 'text.disabled'} noWrap>
              {t ? t.name : 'No plan'}
              {s.inherited && t ? ` · ${DAY_TYPE_LABELS[t.dayType].toLowerCase()} plan` : ''}
            </Typography>
          </Box>
        </ButtonBase>
        {t && (
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography fontWeight={800} sx={{ lineHeight: 1.1 }}>
              {kcalRange(t.planned.min.calories, t.planned.max.calories)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              kcal
            </Typography>
          </Box>
        )}
        <OverflowMenu label={`Actions for ${s.slot.name}`} actions={actions} />
      </Stack>
      {t ? (
        t.items.length > 0 && (
          <>
            <Divider />
            <List dense disablePadding sx={{ py: 0.5 }}>
              {t.items.map((i) => (
                <ListItem key={i.id} sx={{ px: 2, py: 0.25, alignItems: 'baseline' }}>
                  <ListItemText
                    primary={
                      <>
                        {i.displayName}
                        {i.isOptional && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {' '}
                            · optional
                          </Typography>
                        )}
                      </>
                    }
                    secondary={
                      <>
                        {formatQuantity(i.quantity, i.unit, i.quantityMax)}
                        {i.alternatives.length > 0 && ` · or ${i.alternatives.map((a) => a.displayName).join(', ')}`}
                      </>
                    }
                    slotProps={{
                      primary: { variant: 'body2', fontWeight: 600 },
                      secondary: { variant: 'caption' },
                    }}
                    sx={{ my: 0.25 }}
                  />
                  {i.nutrition && (
                    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                      {fmt(i.nutrition.calories, 0)}
                    </Typography>
                  )}
                </ListItem>
              ))}
            </List>
          </>
        )
      ) : (
        <>
          <Divider />
          <Button fullWidth startIcon={<EventAvailableRoundedIcon />} onClick={onChoose} sx={{ minHeight: 48, borderRadius: 0 }}>
            Set {DAY_TYPE_LABELS[dayType].toLowerCase()} plan
          </Button>
        </>
      )}
    </Card>
  );
}

export default function MealPlanPage() {
  const { notify, confirm } = useFeedback();
  const [section, setSection] = useState<Section>('plan');
  const [dayType, setDayType] = useState<DayType>('GYM');
  const [showArchived, setShowArchived] = useState(false);
  const plan = useAsync(() => api.get<MealPlan>('/meals/plan', { dayType }), [dayType]);
  const templates = useAsync(
    () =>
      api.get<MealTemplate[]>('/meals/templates', {
        includeArchived: showArchived ? 'true' : undefined,
      }),
    [showArchived],
  );
  const [editor, setEditor] = useState<EditorState>(null);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [choosing, setChoosing] = useState<{
    slot: MealSlot;
    currentId: string | null;
  } | null>(null);

  const reloadAll = () => {
    void plan.reload();
    void templates.reload();
  };
  const slots = plan.data?.slots.map((s) => s.slot) ?? [];
  const slotName = (id: string | null) => slots.find((s) => s.id === id)?.name ?? 'Any meal';
  const newMeal = () => setEditor({ template: null, defaults: { dayType } });

  const duplicate = async (t: MealTemplate) => {
    try {
      const copy = await api.post<MealTemplate>(`/meals/templates/${t.id}/duplicate`, {});
      notify(`Created “${copy.name}”`);
      templates.setData((list) => (list ? [...list, copy] : list));
      setEditor({ template: copy });
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const toggleArchive = async (t: MealTemplate) => {
    if (!t.archivedAt && t.isPlan) {
      const ok = await confirm({
        title: `Archive ${t.name}?`,
        message: 'It is currently a plan; archiving removes it from your meal plan. Logged meals are not affected.',
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    try {
      await api.post(`/meals/templates/${t.id}/${t.archivedAt ? 'unarchive' : 'archive'}`);
      notify(t.archivedAt ? `${t.name} restored` : `${t.name} archived`);
      reloadAll();
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const remove = async (t: MealTemplate) => {
    const ok = await confirm({
      title: `Delete ${t.name}?`,
      message: 'The meal is removed permanently. Meals you already logged from it stay in your diary.',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/meals/templates/${t.id}`);
      notify(`${t.name} deleted`);
      templates.setData((list) => list?.filter((x) => x.id !== t.id));
      if (t.isPlan) void plan.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const templateActions = (t: MealTemplate): OverflowAction[] => [
    {
      label: 'Edit meal',
      icon: <EditRoundedIcon fontSize="small" />,
      onClick: () => setEditor({ template: t }),
    },
    {
      label: 'Duplicate',
      icon: <ContentCopyRoundedIcon fontSize="small" />,
      onClick: () => void duplicate(t),
    },
    {
      label: t.archivedAt ? 'Unarchive' : 'Archive',
      icon: t.archivedAt ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />,
      onClick: () => void toggleArchive(t),
    },
    {
      label: 'Delete',
      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
      onClick: () => void remove(t),
      destructive: true,
    },
  ];

  const data = plan.data;

  return (
    <Box>
      <PageHeader
        title="Meal plan"
        subtitle="Planned meals — log them from the diary"
        actions={
          <>
            <PrimaryAction icon={<AddRoundedIcon />} label="New meal" onClick={newMeal} />
            <IconButton aria-label="Edit meal slots" onClick={() => setSlotsOpen(true)} sx={{ width: 44, height: 44 }}>
              <TuneRoundedIcon />
            </IconButton>
          </>
        }
      />
      <SectionTabs<Section>
        value={section}
        onChange={setSection}
        ariaLabel="Meal plan sections"
        tabs={[
          { value: 'plan', label: 'Day plan' },
          { value: 'meals', label: 'Saved meals' },
        ]}
      />

      {section === 'plan' ? (
        <>
          <ToggleButtonGroup
            exclusive
            color="primary"
            value={dayType}
            onChange={(_, v) => v && setDayType(v)}
            aria-label="Day type"
            fullWidth
            size="small"
            sx={{
              mb: 2,
              maxWidth: 480,
              bgcolor: 'background.paper',
              '& .MuiToggleButton-root': { minHeight: 44, fontWeight: 600 },
            }}
          >
            {(['GYM', 'REST', 'ANY'] as DayType[]).map((d) => (
              <ToggleButton key={d} value={d}>
                {DAY_TYPE_LABELS[d]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {plan.error ? (
            <ErrorState error={plan.error} onRetry={plan.reload} />
          ) : !data ? (
            <LoadingState label="Loading meal plan…" />
          ) : (
            <Stack spacing={1.5}>
              <Card sx={{ overflow: 'hidden' }}>
                <Box sx={{ height: 2 }}>{plan.refreshing && <LinearProgress sx={{ height: 2, borderRadius: 0 }} aria-label="Refreshing" />}</Box>
                <PlanSummary plan={data} />
              </Card>
              {data.slots.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<RestaurantMenuRoundedIcon fontSize="inherit" />}
                    title="No meal slots yet"
                    description="Add your meals (breakfast, lunch, …) to start planning."
                    action={
                      <Button variant="contained" onClick={() => setSlotsOpen(true)} sx={{ minHeight: 44 }}>
                        Add meal slots
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
                  {data.slots.map((s) => {
                    const choose = () =>
                      setChoosing({
                        slot: s.slot,
                        currentId: s.inherited ? null : (s.template?.id ?? null),
                      });
                    const t = s.template;
                    return (
                      <SlotPlanCard
                        key={s.slot.id}
                        s={s}
                        dayType={dayType}
                        onChoose={choose}
                        actions={[
                          {
                            label: t && !s.inherited ? 'Change plan' : 'Set plan',
                            icon: <EventAvailableRoundedIcon fontSize="small" />,
                            onClick: choose,
                          },
                          ...(t ? templateActions(t) : []),
                        ]}
                      />
                    );
                  })}
                </Box>
              )}
              <Typography variant="caption" color="text.secondary" textAlign="center">
                Ranges use low–high amounts; optional items aren&apos;t counted.
              </Typography>
            </Stack>
          )}
        </>
      ) : (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {templates.data ? `${templates.data.length} saved meal${templates.data.length === 1 ? '' : 's'}` : ''}
            </Typography>
            <FormControlLabel
              control={<Switch checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
              label="Archived"
              labelPlacement="start"
            />
          </Stack>
          {templates.error ? (
            <ErrorState error={templates.error} onRetry={templates.reload} />
          ) : !templates.data ? (
            <LoadingState />
          ) : templates.data.length === 0 ? (
            <Card>
              <EmptyState
                title="No saved meals yet"
                description="Create reusable meals like “Gym breakfast” or “Light dinner” and set them as your plan."
                action={
                  <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={newMeal} sx={{ minHeight: 44 }}>
                    New meal
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card>
              <List disablePadding>
                {templates.data.map((t, i) => (
                  <ActionRow
                    key={t.id}
                    divider={i > 0}
                    dim={!!t.archivedAt}
                    onClick={() => setEditor({ template: t })}
                    trailing={<OverflowMenu label={`More actions for ${t.name}`} actions={templateActions(t)} />}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                          {t.name}
                        </Typography>
                        {t.isPlan && <Chip size="small" color="primary" label={`${DAY_TYPE_LABELS[t.dayType]} plan`} sx={{ height: 22 }} />}
                        {t.archivedAt && <Chip size="small" label="Archived" sx={{ height: 22 }} />}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {slotName(t.slotId)} · {DAY_TYPE_LABELS[t.dayType]} · {t.items.length} item{t.items.length === 1 ? '' : 's'} · ~
                        {fmt(t.planned.min.calories, 0)} kcal
                      </Typography>
                    </Box>
                  </ActionRow>
                ))}
              </List>
            </Card>
          )}
        </>
      )}
      <FabSpacer />

      <TemplateEditorDialog
        open={!!editor}
        template={editor?.template ?? null}
        defaults={editor?.defaults}
        slots={slots}
        onClose={() => setEditor(null)}
        onSaved={async (t) => {
          if (editor?.planAfterSave && t.slotId) {
            try {
              await api.put(`/meals/plan/${t.slotId}`, {
                templateId: t.id,
                dayType: t.dayType,
              });
              notify(`${t.name} is now your ${DAY_TYPE_LABELS[t.dayType].toLowerCase()} plan`);
            } catch (e) {
              notify(errorMessage(e), 'error');
            }
          }
          reloadAll();
        }}
      />
      <SlotManagerDialog open={slotsOpen} onClose={() => setSlotsOpen(false)} onChanged={reloadAll} />
      <ChoosePlanDialog
        open={!!choosing}
        slot={choosing?.slot ?? null}
        dayType={dayType}
        currentId={choosing?.currentId ?? null}
        templates={templates.data ?? []}
        onClose={() => setChoosing(null)}
        onSaved={() => void plan.reload()}
        onCreate={() => {
          const slotId = choosing?.slot.id;
          setChoosing(null);
          setEditor({
            template: null,
            defaults: { slotId, dayType },
            planAfterSave: true,
          });
        }}
      />
    </Box>
  );
}
