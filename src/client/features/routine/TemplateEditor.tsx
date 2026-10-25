import { useState } from 'react';
import {
  Box,
  ButtonBase,
  Card,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import AlarmOnRoundedIcon from '@mui/icons-material/AlarmOnRounded';
import AlarmOffRoundedIcon from '@mui/icons-material/AlarmOffRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import ViewTimelineRoundedIcon from '@mui/icons-material/ViewTimelineRounded';
import { api, toApiError } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { FabSpacer, PrimaryAction, usePhone } from '../../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { CATEGORY_META, CategoryIcon } from '../alarms/categories';
import { DAY_TYPE_LABEL, clockParts } from '../alarms/format';
import { weekdaySummary } from '../alarms/WeekdayChips';
import { useAlarms } from '../alarms/AlarmProvider';
import { CopyDialog, ItemDialog, TemplateDialog, type CopyValues, type ItemValues, type TemplateValues } from './TemplateDialogs';
import type { RoutineItem, RoutineTemplate } from './types';

export type TemplateKind = 'gym' | 'rest' | 'custom';

/** Which tab a template belongs to: plain gym-day / rest-day routines, everything else is custom. */
export function templateKind(t: Pick<RoutineTemplate, 'weekdays' | 'dayType'>): TemplateKind {
  if (t.weekdays.length === 0 && t.dayType === 'GYM') return 'gym';
  if (t.weekdays.length === 0 && t.dayType === 'REST') return 'rest';
  return 'custom';
}

const KIND_COPY: Record<TemplateKind, { empty: string; description: string; dayType: 'GYM' | 'REST' | 'ANY' }> = {
  gym: { empty: 'No gym-day routine yet', description: 'Wake up, meals, pre-workout, gym and bedtime on training days.', dayType: 'GYM' },
  rest: { empty: 'No rest-day routine yet', description: 'Your day on non-training days.', dayType: 'REST' },
  custom: { empty: 'No custom routines', description: 'Routines for specific weekdays or every day.', dayType: 'ANY' },
};

function appliesLabel(t: RoutineTemplate) {
  return t.weekdays.length ? weekdaySummary(t.weekdays) : DAY_TYPE_LABEL[t.dayType];
}

type MenuState = { el: HTMLElement; kind: 'template'; template: RoutineTemplate } | { el: HTMLElement; kind: 'item'; template: RoutineTemplate; index: number };

/** Template editor for one tab (gym day / rest day / custom): routines as cards, items as list rows. */
export function TemplateEditor({ kind, onChanged }: { kind: TemplateKind; onChanged: () => void }) {
  const { settings } = useAuth();
  const phone = usePhone();
  const { refresh: refreshAlarms } = useAlarms();
  const { notify, confirm } = useFeedback();
  const { data, setData, error, loading, reload } = useAsync(() => api.get<RoutineTemplate[]>('/routines/templates'), []);
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; template: RoutineTemplate | null }>({ open: false, template: null });
  const [itemDialog, setItemDialog] = useState<{ templateId: string; item: RoutineItem | null } | null>(null);
  const [copySource, setCopySource] = useState<RoutineTemplate | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const visible = (data ?? []).filter((t) => templateKind(t) === kind);
  const replace = (t: RoutineTemplate) => setData((list) => (list ?? []).map((x) => (x.id === t.id ? t : x)));
  const afterChange = () => {
    onChanged();
    void refreshAlarms();
  };

  /** Runs a mutation after an optional optimistic update; restores the previous list on failure. */
  const run = async (fn: () => Promise<void>, optimistic?: (list: RoutineTemplate[]) => RoutineTemplate[]) => {
    const before = data;
    if (optimistic && before) setData(optimistic(before));
    try {
      await fn();
      afterChange();
    } catch (e) {
      if (before) setData(before);
      notify(toApiError(e).message, 'error');
    }
  };

  const saveTemplate = async (v: TemplateValues) => {
    try {
      const t = templateDialog.template;
      if (t) {
        replace(await api.patch<RoutineTemplate>(`/routines/templates/${t.id}`, v));
        notify('Routine updated');
      } else {
        const created = await api.post<RoutineTemplate>('/routines/templates', v);
        setData((list) => [...(list ?? []), created]);
        notify('Routine created');
      }
      setTemplateDialog({ open: false, template: null });
      afterChange();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const saveItem = async (v: ItemValues) => {
    if (!itemDialog) return;
    try {
      const body = { ...v, notes: v.notes.trim() || null };
      const t = itemDialog.item
        ? await api.patch<RoutineTemplate>(`/routines/items/${itemDialog.item.id}`, body)
        : await api.post<RoutineTemplate>(`/routines/templates/${itemDialog.templateId}/items`, body);
      replace(t);
      notify(itemDialog.item ? 'Item updated' : 'Item added');
      setItemDialog(null);
      afterChange();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const copy = async (v: CopyValues) => {
    if (!copySource) return;
    try {
      await api.post(`/routines/templates/${copySource.id}/copy`, v);
      notify(`Copied to “${v.name}” (Custom)`);
      setCopySource(null);
      await reload();
      afterChange();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const toggleActive = (t: RoutineTemplate) =>
    run(
      async () => replace(await api.patch<RoutineTemplate>(`/routines/templates/${t.id}`, { isActive: !t.isActive })),
      (list) => list.map((x) => (x.id === t.id ? { ...x, isActive: !t.isActive } : x)),
    );

  const deleteTemplate = async (t: RoutineTemplate) => {
    const ok = await confirm({ title: `Delete “${t.name}”?`, message: 'Its items and reminders are deleted. Past days keep what was recorded.', destructive: true });
    if (!ok) return;
    await run(
      async () => {
        await api.delete(`/routines/templates/${t.id}`);
        notify('Routine deleted');
      },
      (list) => list.filter((x) => x.id !== t.id),
    );
  };

  const deleteItem = async (i: RoutineItem) => {
    if (!(await confirm({ title: `Delete “${i.title}”?`, message: 'Its reminder is deleted too. Past days keep what was recorded.', destructive: true }))) return;
    await run(
      async () => {
        await api.delete(`/routines/items/${i.id}`);
        notify('Item deleted');
      },
      (list) => list.map((t) => (t.id === i.templateId ? { ...t, items: t.items.filter((x) => x.id !== i.id) } : t)),
    );
  };

  const toggleReminder = (i: RoutineItem) =>
    run(
      async () => {
        replace(await api.patch<RoutineTemplate>(`/routines/items/${i.id}`, { reminderEnabled: !i.reminderEnabled }));
        notify(i.reminderEnabled ? 'Reminder off' : 'Reminder on', 'info');
      },
      (list) => list.map((t) => (t.id === i.templateId ? { ...t, items: t.items.map((x) => (x.id === i.id ? { ...x, reminderEnabled: !i.reminderEnabled } : x)) } : t)),
    );

  const move = (t: RoutineTemplate, index: number, dir: -1 | 1) => {
    const items = [...t.items];
    [items[index], items[index + dir]] = [items[index + dir], items[index]];
    return run(
      async () => replace(await api.post<RoutineTemplate>(`/routines/templates/${t.id}/items/reorder`, { ids: items.map((i) => i.id) })),
      (list) => list.map((x) => (x.id === t.id ? { ...x, items: items.map((i, idx) => ({ ...i, sortOrder: idx })) } : x)),
    );
  };

  const closeMenu = () => setMenu(null);
  const newRoutine = <PrimaryAction icon={<AddRoundedIcon />} label="New routine" onClick={() => setTemplateDialog({ open: true, template: null })} />;

  if (loading) return <LoadingState />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Typography variant="body2" color="text.secondary">
          Changes apply from today; past days keep what was recorded.
        </Typography>
        {!phone && newRoutine}
      </Stack>

      {visible.length === 0 ? (
        <Card>
          <EmptyState icon={<ViewTimelineRoundedIcon fontSize="inherit" />} title={KIND_COPY[kind].empty} description={KIND_COPY[kind].description} />
        </Card>
      ) : (
        visible.map((t) => (
          <Card key={t.id} component="section" aria-label={t.name}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ pl: 2, pr: 0.5, py: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" noWrap>
                  {t.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {appliesLabel(t)} · {t.items.length} item{t.items.length === 1 ? '' : 's'}
                  {t.isActive ? '' : ' · off'}
                </Typography>
              </Box>
              <Switch checked={t.isActive} onChange={() => void toggleActive(t)} slotProps={{ input: { 'aria-label': t.isActive ? `Turn off ${t.name}` : `Turn on ${t.name}` } }} />
              <IconButton aria-label={`More actions for ${t.name}`} onClick={(e) => setMenu({ el: e.currentTarget, kind: 'template', template: t })} sx={{ width: 44, height: 44 }}>
                <MoreVertRoundedIcon />
              </IconButton>
            </Stack>
            <Divider />
            <List disablePadding sx={{ opacity: t.isActive ? 1 : 0.6 }}>
              {t.items.map((i, idx) => {
                const { time, suffix } = clockParts(i.time);
                return (
                  <ListItem key={i.id} divider disablePadding sx={{ pr: 0.5 }}>
                    <ButtonBase
                      onClick={() => setItemDialog({ templateId: t.id, item: i })}
                      aria-label={`Edit ${i.title}`}
                      sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.5, py: 1.25, pl: 2, textAlign: 'left', minHeight: 60 }}
                    >
                      <Box sx={{ width: 52, flexShrink: 0 }}>
                        <Typography component="div" sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
                          {time}
                        </Typography>
                        <Typography component="div" variant="caption" color="text.secondary" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {suffix}
                        </Typography>
                      </Box>
                      <Box sx={{ color: CATEGORY_META[i.category].color, display: 'flex', flexShrink: 0 }}>
                        <CategoryIcon category={i.category} />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography fontWeight={600} noWrap>
                          {i.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {CATEGORY_META[i.category].label}
                        </Typography>
                      </Box>
                      {i.reminderEnabled ? (
                        <AlarmOnRoundedIcon fontSize="small" color="primary" aria-label="Reminder on" />
                      ) : (
                        <AlarmOffRoundedIcon fontSize="small" sx={{ color: 'text.disabled' }} aria-label="Reminder off" />
                      )}
                    </ButtonBase>
                    <IconButton aria-label={`More actions for ${i.title}`} onClick={(e) => setMenu({ el: e.currentTarget, kind: 'item', template: t, index: idx })} sx={{ width: 44, height: 44 }}>
                      <MoreVertRoundedIcon />
                    </IconButton>
                  </ListItem>
                );
              })}
              <ListItemButton onClick={() => setItemDialog({ templateId: t.id, item: null })} sx={{ minHeight: 52, color: 'primary.main' }}>
                <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
                  <AddRoundedIcon />
                </ListItemIcon>
                <ListItemText primary="Add item" slotProps={{ primary: { fontWeight: 600 } }} />
              </ListItemButton>
            </List>
          </Card>
        ))
      )}

      <Menu anchorEl={menu?.el} open={!!menu} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {menu?.kind === 'template' && [
          <MenuItem key="edit" sx={{ minHeight: 48 }} onClick={() => (closeMenu(), setTemplateDialog({ open: true, template: menu.template }))}>
            <ListItemIcon>
              <EditRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit routine</ListItemText>
          </MenuItem>,
          <MenuItem key="copy" sx={{ minHeight: 48 }} onClick={() => (closeMenu(), setCopySource(menu.template))}>
            <ListItemIcon>
              <ContentCopyRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Copy to weekdays</ListItemText>
          </MenuItem>,
          <MenuItem key="delete" sx={{ minHeight: 48, color: 'error.main' }} onClick={() => (closeMenu(), void deleteTemplate(menu.template))}>
            <ListItemIcon sx={{ color: 'inherit' }}>
              <DeleteOutlineRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Delete routine</ListItemText>
          </MenuItem>,
        ]}
        {menu?.kind === 'item' &&
          (() => {
            const t = menu.template;
            const i = t.items[menu.index];
            if (!i) return null;
            return [
              <MenuItem key="edit" sx={{ minHeight: 48 }} onClick={() => (closeMenu(), setItemDialog({ templateId: t.id, item: i }))}>
                <ListItemIcon>
                  <EditRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Edit</ListItemText>
              </MenuItem>,
              <MenuItem key="up" sx={{ minHeight: 48 }} disabled={menu.index === 0} onClick={() => (closeMenu(), void move(t, menu.index, -1))}>
                <ListItemIcon>
                  <ArrowUpwardRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Move up</ListItemText>
              </MenuItem>,
              <MenuItem key="down" sx={{ minHeight: 48 }} disabled={menu.index === t.items.length - 1} onClick={() => (closeMenu(), void move(t, menu.index, 1))}>
                <ListItemIcon>
                  <ArrowDownwardRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Move down</ListItemText>
              </MenuItem>,
              <MenuItem key="rem" sx={{ minHeight: 48 }} onClick={() => (closeMenu(), void toggleReminder(i))}>
                <ListItemIcon>{i.reminderEnabled ? <AlarmOffRoundedIcon fontSize="small" /> : <AlarmOnRoundedIcon fontSize="small" />}</ListItemIcon>
                <ListItemText>{i.reminderEnabled ? 'Turn reminder off' : 'Turn reminder on'}</ListItemText>
              </MenuItem>,
              <MenuItem key="delete" sx={{ minHeight: 48, color: 'error.main' }} onClick={() => (closeMenu(), void deleteItem(i))}>
                <ListItemIcon sx={{ color: 'inherit' }}>
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Delete</ListItemText>
              </MenuItem>,
            ];
          })()}
      </Menu>

      <TemplateDialog
        open={templateDialog.open}
        template={templateDialog.template}
        defaultDayType={KIND_COPY[kind].dayType}
        onClose={() => setTemplateDialog({ open: false, template: null })}
        onSubmit={saveTemplate}
      />
      <ItemDialog open={!!itemDialog} item={itemDialog?.item ?? null} defaultSnooze={settings?.defaultSnoozeMinutes ?? 10} onClose={() => setItemDialog(null)} onSubmit={saveItem} />
      <CopyDialog source={copySource} onClose={() => setCopySource(null)} onSubmit={copy} />
      {phone && newRoutine}
      <FabSpacer />
    </Stack>
  );
}
