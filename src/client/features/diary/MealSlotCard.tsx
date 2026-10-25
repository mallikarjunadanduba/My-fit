import { useState } from 'react';
import { Box, Button, ButtonBase, Card, Chip, Collapse, Divider, List, Menu, MenuItem, Stack, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { formatClock, formatInstant } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import type { Nutrients } from '../../../shared/nutrition';
import { nutrientColors } from '../../theme/theme';
import { STATUS_META, type MealSlot, type MealStatus, type MealTemplate } from '../meals/types';
import { fmt, formatQuantity } from '../foods/format';
import { ActionRow, OverflowMenu } from '../foods/mobile';
import type { DiaryEntry } from './types';

/** "P 20 · C 30 · F 8" with nutrient-coloured letters. */
export function MacroMini({ n }: { n: Nutrients }) {
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
      {(['protein', 'carbs', 'fat'] as const).map((k, i) => (
        <Box component="span" key={k}>
          {i > 0 && ' · '}
          <Box component="span" sx={{ color: nutrientColors[k], fontWeight: 700 }}>
            {k[0].toUpperCase()}
          </Box>{' '}
          {fmt(n[k], 0)}
        </Box>
      ))}
    </Box>
  );
}

export function EntryRow({ entry, onEdit, onDelete, divider }: { entry: DiaryEntry; onEdit: () => void; onDelete: () => void; divider?: boolean }) {
  const { timezone } = useAuth();
  const time = entry.consumedAt ? formatClock(formatInstant(entry.consumedAt, timezone)) : null;
  return (
    <ActionRow
      onClick={onEdit}
      divider={divider}
      trailing={
        <OverflowMenu
          label={`Actions for ${entry.foodName}`}
          actions={[
            {
              label: 'Edit',
              icon: <EditRoundedIcon fontSize="small" />,
              onClick: onEdit,
            },
            {
              label: 'Delete',
              icon: <DeleteOutlineRoundedIcon fontSize="small" />,
              onClick: onDelete,
              destructive: true,
            },
          ]}
        />
      }
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere', lineHeight: 1.3 }}>
          {entry.foodName}
          {entry.isEstimate && (
            <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.75 }}>
              est.
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {formatQuantity(entry.quantity, entry.unit)}
          {time ? ` · ${time}` : ''} · <MacroMini n={entry} />
        </Typography>
        {entry.notes && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {entry.notes}
          </Typography>
        )}
      </Box>
      <Typography fontWeight={700} sx={{ flexShrink: 0 }}>
        {fmt(entry.calories, 0)}
        <Typography component="span" variant="caption" color="text.secondary">
          {' '}
          kcal
        </Typography>
      </Typography>
    </ActionRow>
  );
}

const STATUSES: MealStatus[] = ['PENDING', 'COMPLETED', 'PARTIAL', 'SKIPPED'];

export function StatusChip({ status, onChange, label }: { status: MealStatus; onChange?: (s: MealStatus) => void; label: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const meta = STATUS_META[status];
  if (!onChange) return <Chip size="small" label={meta.label} color={meta.color} />;
  return (
    <>
      <Chip
        size="small"
        label={meta.label}
        color={meta.color}
        variant={status === 'PENDING' ? 'outlined' : 'filled'}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        onDelete={(e) => {
          e.stopPropagation();
          setAnchor((e.currentTarget as HTMLElement).parentElement);
        }}
        deleteIcon={<ArrowDropDownRoundedIcon />}
        aria-label={`${label} status: ${meta.label}. Change status`}
        aria-haspopup="menu"
        sx={{ height: 32, borderRadius: 16, flexShrink: 0 }}
      />
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        {STATUSES.map((s) => (
          <MenuItem
            key={s}
            selected={s === status}
            sx={{ minHeight: 48 }}
            onClick={() => {
              setAnchor(null);
              if (s !== status) onChange(s);
            }}
          >
            {s === status && <CheckRoundedIcon fontSize="small" sx={{ mr: 1 }} />}
            {STATUS_META[s].label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** One meal of the day as a collapsible section: header (name, time, kcal, status) + entry rows + quick actions. */
export function MealSlotCard({
  slot,
  status,
  entries,
  totals,
  plan,
  onStatus,
  onAdd,
  onLogPlan,
  onEdit,
  onDelete,
}: {
  slot: MealSlot | null;
  status: MealStatus | null;
  entries: DiaryEntry[];
  totals: Nutrients | null;
  plan: MealTemplate | null;
  onStatus?: (s: MealStatus) => void;
  onAdd: () => void;
  onLogPlan?: () => void;
  onEdit: (e: DiaryEntry) => void;
  onDelete: (e: DiaryEntry) => void;
}) {
  const name = slot?.name ?? 'Other / snacks';
  const plannedKcal = plan?.planned.min.calories;
  const [open, setOpen] = useState(entries.length > 0 || status === 'PENDING' || !status);
  const id = `meal-${slot?.id ?? 'other'}`;
  const meta = [
    slot?.defaultTime ? formatClock(slot.defaultTime) : null,
    totals ? `${fmt(totals.calories, 0)} kcal` : plan && plannedKcal ? `Plan ~${fmt(plannedKcal, 0)} kcal` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card component="section" aria-labelledby={`${id}-title`}>
      <Stack direction="row" alignItems="center" sx={{ pr: 1.5 }}>
        <ButtonBase
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          sx={{
            flex: 1,
            minWidth: 0,
            justifyContent: 'flex-start',
            textAlign: 'left',
            px: 2,
            py: 1.25,
            minHeight: 60,
            gap: 1,
          }}
        >
          <ExpandMoreRoundedIcon
            sx={{
              color: 'text.secondary',
              transition: 'transform .2s',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
              flexShrink: 0,
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography id={`${id}-title`} component="h2" fontWeight={700} sx={{ fontSize: 17, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {name}
              {slot?.archivedAt && (
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                  archived
                </Typography>
              )}
            </Typography>
            {meta && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {meta}
              </Typography>
            )}
          </Box>
        </ButtonBase>
        {status && <StatusChip status={status} onChange={onStatus} label={name} />}
      </Stack>
      <Collapse in={open} id={`${id}-body`}>
        <Divider />
        {entries.length > 0 ? (
          <List disablePadding>
            {entries.map((e, i) => (
              <EntryRow key={e.id} divider={i > 0} entry={e} onEdit={() => onEdit(e)} onDelete={() => onDelete(e)} />
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 1.5 }}>
            {status === 'SKIPPED' ? 'Skipped.' : plan ? `Planned: ${plan.name}` : 'Nothing logged yet.'}
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ px: 1, pt: 0.5, pb: 1 }}>
          {onLogPlan && plan && (
            <Button
              variant={entries.length ? 'text' : 'contained'}
              startIcon={<PlaylistAddCheckRoundedIcon />}
              onClick={onLogPlan}
              sx={{ minHeight: 44, flex: entries.length ? undefined : 1 }}
            >
              Log planned meal
            </Button>
          )}
          <Button startIcon={<AddRoundedIcon />} onClick={onAdd} sx={{ minHeight: 44 }} aria-label={`Add food to ${name}`}>
            Add food
          </Button>
        </Stack>
      </Collapse>
    </Card>
  );
}
