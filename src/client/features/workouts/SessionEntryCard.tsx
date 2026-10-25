import { memo, useEffect, useRef, useState } from 'react';
import { alpha } from '@mui/material/styles';
import { Box, Button, ButtonBase, Card, Checkbox, Chip, IconButton, ListItemIcon, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { MediaImage } from '../media/MediaImage';
import { isTempId } from './sessionState';
import type { ItemStatus, SessionEntry, WorkoutSet } from './types';

export interface SetPatch {
  reps?: number | null;
  weightKg?: number | null;
  durationSec?: number | null;
  completed?: boolean;
}

const parseField = (v: string, integer: boolean): number | null | 'invalid' => {
  const t = v.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) return 'invalid';
  return n;
};

/** Numeric cell: text input with the numeric/decimal keypad; commits on blur or Enter. */
function NumberCell({
  value,
  onCommit,
  label,
  integer = true,
  max,
  disabled,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  label: string;
  integer?: boolean;
  max: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);
  const parsed = parseField(text, integer);
  const invalid = parsed === 'invalid' || (typeof parsed === 'number' && parsed > max);
  return (
    <TextField
      value={text}
      disabled={disabled}
      error={invalid}
      placeholder="–"
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (invalid) {
          setText(value == null ? '' : String(value));
          return;
        }
        if (parsed !== value) onCommit(parsed as number | null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      slotProps={{
        htmlInput: {
          'aria-label': label,
          inputMode: integer ? 'numeric' : 'decimal',
          enterKeyHint: 'done',
          autoComplete: 'off',
          maxLength: 7,
          style: { textAlign: 'center' },
        },
      }}
      sx={{
        '& .MuiInputBase-root': { borderRadius: '10px', bgcolor: 'background.default' },
        '& .MuiInputBase-input': { px: 0.5, py: '11px', fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
      }}
    />
  );
}

const CheckBox = ({ checked }: { checked: boolean }) => (
  <Box
    sx={(t) => ({
      width: 44,
      height: 44,
      borderRadius: '12px',
      display: 'grid',
      placeItems: 'center',
      bgcolor: checked ? 'success.main' : alpha(t.palette.text.primary, 0.06),
      color: checked ? '#fff' : alpha(t.palette.text.primary, 0.35),
      border: 1,
      borderColor: checked ? 'success.main' : 'divider',
      transition: 'background-color 120ms ease, transform 120ms ease',
      transform: checked ? 'scale(1)' : 'scale(0.96)',
    })}
  >
    <CheckRoundedIcon sx={{ fontSize: 28 }} />
  </Box>
);

const STATUS_CHIP: Partial<Record<ItemStatus, { label: string; color: 'success' | 'warning' }>> = {
  COMPLETED: { label: 'Done', color: 'success' },
  SKIPPED: { label: 'Skipped', color: 'warning' },
};

/**
 * One exercise of the session: header (name, progress, ⋮ menu) and set rows that fit a 360px screen:
 * set number (tap for options) · kg · reps · (sec) · big tick.
 */
export const SessionEntryCard = memo(function SessionEntryCard({
  entry,
  index,
  readOnly,
  onPatchSet,
  onAddSet,
  onDeleteSet,
  onSetStatus,
  onEdit,
  onRemove,
}: {
  entry: SessionEntry;
  index: number;
  readOnly: boolean;
  onPatchSet: (entry: SessionEntry, set: WorkoutSet, patch: SetPatch) => void;
  onAddSet: (entry: SessionEntry) => void;
  onDeleteSet: (entry: SessionEntry, set: WorkoutSet) => void;
  onSetStatus: (entry: SessionEntry, status: ItemStatus) => void;
  onEdit: (entry: SessionEntry) => void;
  onRemove: (entry: SessionEntry) => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [setMenu_, setSetMenu] = useState<{ el: HTMLElement; set: WorkoutSet } | null>(null);
  const type = entry.exercise?.type;
  const showDuration = type === 'CARDIO' || type === 'MOBILITY' || entry.sets.some((s) => s.durationSec != null);
  const showWeight = type !== 'CARDIO' || entry.sets.some((s) => s.weightKg != null);
  const showReps = type !== 'CARDIO' || entry.sets.some((s) => s.reps != null) || !showDuration;
  const chip = STATUS_CHIP[entry.status];
  const doneSets = entry.sets.filter((s) => s.completed).length;
  const valueCols = (showWeight ? 1 : 0) + (showReps ? 1 : 0) + (showDuration ? 1 : 0);
  const cols = `34px repeat(${valueCols}, minmax(0, 1fr)) 48px`;
  const allDone = entry.sets.length > 0 && doneSets === entry.sets.length;

  return (
    <Card sx={{ opacity: entry.status === 'SKIPPED' ? 0.6 : 1, overflow: 'visible' }}>
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ pl: 1.5, pr: 0.5, pt: 1.25, pb: 0.5 }}>
        {entry.exercise?.imageMediaId ? (
          <Box sx={{ width: 40, flexShrink: 0 }}>
            <MediaImage mediaId={entry.exercise.imageMediaId} alt={`${entry.exerciseName} reference`} />
          </Box>
        ) : (
          <Box
            sx={(t) => ({
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 14,
              bgcolor: allDone ? 'success.main' : alpha(t.palette.primary.main, 0.14),
              color: allDone ? '#fff' : 'primary.main',
            })}
            aria-hidden
          >
            {allDone ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : index + 1}
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={800} noWrap sx={{ lineHeight: 1.25 }}>
            {entry.exerciseName}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            {doneSets}/{entry.sets.length} sets{entry.restSec ? ` · rest ${entry.restSec}s` : ''}
            {entry.notes ? ` · ${entry.notes}` : ''}
          </Typography>
        </Box>
        {chip && <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />}
        {!readOnly && (
          <IconButton aria-label={`Options for ${entry.exerciseName}`} onClick={(e) => setMenu(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
        )}
      </Stack>
      {!readOnly && (
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
          <MenuItem onClick={() => (setMenu(null), onEdit(entry))}>
            <ListItemIcon>
              <TuneRoundedIcon fontSize="small" />
            </ListItemIcon>
            Notes & rest time
          </MenuItem>
          {entry.status !== 'COMPLETED' && (
            <MenuItem onClick={() => (setMenu(null), onSetStatus(entry, 'COMPLETED'))}>
              <ListItemIcon>
                <CheckCircleOutlineIcon fontSize="small" />
              </ListItemIcon>
              Mark exercise done
            </MenuItem>
          )}
          {entry.status !== 'SKIPPED' && (
            <MenuItem onClick={() => (setMenu(null), onSetStatus(entry, 'SKIPPED'))}>
              <ListItemIcon>
                <SkipNextOutlinedIcon fontSize="small" />
              </ListItemIcon>
              Skip exercise
            </MenuItem>
          )}
          {entry.status !== 'PENDING' && (
            <MenuItem onClick={() => (setMenu(null), onSetStatus(entry, 'PENDING'))}>
              <ListItemIcon>
                <UndoIcon fontSize="small" />
              </ListItemIcon>
              Mark as to do
            </MenuItem>
          )}
          <MenuItem onClick={() => (setMenu(null), onRemove(entry))} sx={{ color: 'error.main' }}>
            <ListItemIcon sx={{ color: 'inherit' }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            Remove exercise
          </MenuItem>
        </Menu>
      )}

      {/* Set rows: CSS grid that always fits the card (360px phones included) — no horizontal scroll. */}
      <Box role="table" aria-label={`Sets for ${entry.exerciseName}`} sx={{ px: 1.5, pb: readOnly ? 1.5 : 0.5 }}>
        <Box
          role="row"
          sx={{ display: 'grid', gridTemplateColumns: cols, columnGap: 1, alignItems: 'center', color: 'text.secondary', py: 0.5 }}
        >
          <Typography role="columnheader" variant="caption" fontWeight={700} align="center">
            SET
          </Typography>
          {showWeight && (
            <Typography role="columnheader" variant="caption" fontWeight={700} align="center">
              KG
            </Typography>
          )}
          {showReps && (
            <Typography role="columnheader" variant="caption" fontWeight={700} align="center">
              REPS
            </Typography>
          )}
          {showDuration && (
            <Typography role="columnheader" variant="caption" fontWeight={700} align="center">
              SEC
            </Typography>
          )}
          <Typography role="columnheader" variant="caption" fontWeight={700} align="center">
            DONE
          </Typography>
        </Box>
        {entry.sets.map((s) => {
          const pending = isTempId(s.id);
          const disabled = readOnly || pending;
          return (
            <Box
              role="row"
              key={s.id}
              sx={(t) => ({
                display: 'grid',
                gridTemplateColumns: cols,
                columnGap: 1,
                alignItems: 'center',
                py: 0.5,
                mx: -0.75,
                px: 0.75,
                borderRadius: '12px',
                bgcolor: s.completed ? alpha(t.palette.success.main, t.palette.mode === 'dark' ? 0.16 : 0.1) : 'transparent',
                opacity: pending ? 0.6 : 1,
                transition: 'background-color 150ms ease',
              })}
            >
              <Box role="cell" sx={{ display: 'flex', justifyContent: 'center' }}>
                <ButtonBase
                  disabled={disabled}
                  onClick={(e) => setSetMenu({ el: e.currentTarget, set: s })}
                  aria-label={`Set ${s.setNumber} options`}
                  sx={{ width: 34, height: 44, borderRadius: '10px', fontWeight: 800, fontSize: 15, color: s.completed ? 'success.main' : 'text.secondary' }}
                >
                  {s.setNumber}
                </ButtonBase>
              </Box>
              {showWeight && (
                <Box role="cell">
                  <NumberCell value={s.weightKg} max={1000} integer={false} label={`Set ${s.setNumber} weight in kg`} disabled={disabled} onCommit={(v) => onPatchSet(entry, s, { weightKg: v })} />
                </Box>
              )}
              {showReps && (
                <Box role="cell">
                  <NumberCell value={s.reps} max={1000} label={`Set ${s.setNumber} reps`} disabled={disabled} onCommit={(v) => onPatchSet(entry, s, { reps: v })} />
                </Box>
              )}
              {showDuration && (
                <Box role="cell">
                  <NumberCell value={s.durationSec} max={86400} label={`Set ${s.setNumber} duration in seconds`} disabled={disabled} onCommit={(v) => onPatchSet(entry, s, { durationSec: v })} />
                </Box>
              )}
              <Box role="cell" sx={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox
                  checked={s.completed}
                  disabled={disabled}
                  onChange={(e) => onPatchSet(entry, s, { completed: e.target.checked })}
                  icon={<CheckBox checked={false} />}
                  checkedIcon={<CheckBox checked />}
                  disableRipple
                  slotProps={{ input: { 'aria-label': `Set ${s.setNumber} completed` } }}
                  sx={{ p: 0.25 }}
                />
              </Box>
            </Box>
          );
        })}
      </Box>
      {!readOnly && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Button fullWidth startIcon={<AddIcon />} onClick={() => onAddSet(entry)} sx={{ minHeight: 44, color: 'text.secondary' }}>
            Add set
          </Button>
        </Box>
      )}
      <Menu anchorEl={setMenu_?.el} open={!!setMenu_} onClose={() => setSetMenu(null)}>
        <MenuItem
          onClick={() => {
            const s = setMenu_?.set;
            setSetMenu(null);
            if (s) onDeleteSet(entry, s);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon sx={{ color: 'inherit' }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          Delete set {setMenu_?.set.setNumber}
        </MenuItem>
      </Menu>
    </Card>
  );
});
