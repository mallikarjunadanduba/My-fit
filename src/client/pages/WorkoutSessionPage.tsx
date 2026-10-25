import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Alert, Box, Button, Card, IconButton, LinearProgress, ListItemIcon, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { api, toApiError } from '../services/api';
import { formatDay } from '../services/dates';
import { useAsync } from '../hooks/useAsync';
import { useFeedback } from '../components/common/Feedback';
import { ResponsiveDialog, usePhone } from '../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { ExercisePicker, type PickedExercise } from '../features/workouts/ExercisePicker';
import { REST_BAR_SPACE, RestTimerPanel, type RestTimerHandle } from '../features/workouts/RestTimerPanel';
import { SessionEntryCard, type SetPatch } from '../features/workouts/SessionEntryCard';
import { formatCountdown } from '../features/workouts/useRestTimer';
import {
  TEMP_PREFIX,
  addTempSet,
  appendEntry,
  applySetPatch,
  isTempId,
  mergeEntryResponse,
  mergeSetResponse,
  patchEntryLocal,
  removeEntry,
  removeSet,
  replaceSet,
  type EntryPatchResponse,
  type SetPatchResponse,
} from '../features/workouts/sessionState';
import { STATUS_LABEL, formatDuration, formatKg, type ItemStatus, type Session, type SessionEntry, type WorkoutSet } from '../features/workouts/types';
import { useWakeLock } from '../features/workouts/mobile';

/** Live elapsed seconds for an in-progress session, computed from timestamps. */
function useElapsed(startedAt: string | null, finishedAt: string | null, live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!startedAt) return null;
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
}

function AddExerciseDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (p: PickedExercise, sets: number) => Promise<void> }) {
  const [picked, setPicked] = useState<PickedExercise | null>(null);
  const [sets, setSets] = useState('3');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setPicked(null);
      setSets('3');
    }
  }, [open]);
  const n = Number(sets);
  const valid = !!picked && Number.isInteger(n) && n >= 1 && n <= 20;
  const submit = async () => {
    if (!valid || !picked) return;
    setSaving(true);
    try {
      await onAdd(picked, n);
    } finally {
      setSaving(false);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      title="Add exercise"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-exercise-form" variant="contained" disabled={!valid || saving}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        id="add-exercise-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ExercisePicker value={picked} onChange={setPicked} allowFreeText autoFocus />
          <TextField
            label="Sets"
            size="medium"
            value={sets}
            onChange={(e) => setSets(e.target.value.replace(/\D/g, ''))}
            error={sets !== '' && !(Number.isInteger(n) && n >= 1 && n <= 20)}
            helperText="1–20"
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 2 } }}
          />
        </Stack>
      </form>
    </ResponsiveDialog>
  );
}

function EntryDialog({ entry, onClose, onSave }: { entry: SessionEntry | null; onClose: () => void; onSave: (e: SessionEntry, patch: { notes: string | null; restSec: number | null }) => void }) {
  const [notes, setNotes] = useState('');
  const [rest, setRest] = useState('');
  useEffect(() => {
    if (entry) {
      setNotes(entry.notes ?? '');
      setRest(entry.restSec == null ? '' : String(entry.restSec));
    }
  }, [entry]);
  const restNum = rest.trim() === '' ? null : Number(rest);
  const restValid = restNum == null || (Number.isInteger(restNum) && restNum >= 0 && restNum <= 3600);
  const save = () => {
    if (!entry || !restValid) return;
    onSave(entry, { notes: notes.trim() || null, restSec: restNum });
  };
  return (
    <ResponsiveDialog
      open={!!entry}
      onClose={onClose}
      maxWidth="xs"
      title={entry?.exerciseName ?? ''}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="entry-form" variant="contained" disabled={!restValid}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Rest between sets"
            size="medium"
            value={rest}
            onChange={(e) => setRest(e.target.value.replace(/\D/g, ''))}
            error={!restValid}
            helperText={restValid ? 'Seconds — the rest timer starts when you tick a set' : '0–3600 seconds'}
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 4 }, input: { endAdornment: <Typography color="text.secondary">sec</Typography> } }}
          />
          <Stack direction="row" spacing={1}>
            {[60, 90, 120, 180].map((s) => (
              <Button key={s} size="small" variant={restNum === s ? 'contained' : 'outlined'} onClick={() => setRest(String(s))} sx={{ flex: 1, minHeight: 40 }}>
                {s < 120 ? `${s}s` : `${s / 60}m`}
              </Button>
            ))}
          </Stack>
          <TextField label="Notes" size="medium" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} placeholder="e.g. seat height 4, slow negatives" />
        </Stack>
      </form>
    </ResponsiveDialog>
  );
}

function RenameDialog({ open, name, onClose, onSave }: { open: boolean; name: string; onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [value, setValue] = useState(name);
  useEffect(() => {
    if (open) setValue(name);
  }, [open, name]);
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      title="Rename workout"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="rename-form" variant="contained" disabled={!value.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="rename-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (value.trim() && (await onSave(value.trim()))) onClose();
        }}
      >
        <TextField
          autoFocus
          size="medium"
          label="Name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={!value.trim()}
          helperText={!value.trim() ? 'Name is required' : undefined}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          sx={{ mt: 1 }}
        />
      </form>
    </ResponsiveDialog>
  );
}

export default function WorkoutSessionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const phone = usePhone();
  const { notify, confirm } = useFeedback();
  const { data: session, setData, error, loading, reload } = useAsync(() => api.get<Session>(`/workouts/sessions/${id}`), [id]);
  const timerRef = useRef<RestTimerHandle>(null);
  const setVersions = useRef(new Map<string, number>());
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<SessionEntry | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setNotes(session?.notes ?? ''), [session?.notes]);

  const live = session?.status === 'IN_PROGRESS';
  const elapsed = useElapsed(session?.startedAt ?? null, session?.finishedAt ?? null, live);
  useWakeLock(live);

  // Latest session for stable callbacks (the entry cards are memoised).
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const fail = useCallback(
    (e: unknown) => {
      notify(toApiError(e).message, 'error');
      void reload();
    },
    [notify, reload],
  );

  /** Header-level actions return the full session. */
  const runFull = async (fn: () => Promise<Session>, success?: string, headerOnly = false) => {
    try {
      const next = await fn();
      // Rename/notes only touch the header — don't let the response overwrite set edits still in flight.
      setData((cur) => (headerOnly && cur ? { ...cur, name: next.name, notes: next.notes, date: next.date } : next));
      if (success) notify(success);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  // ── Set & entry edits: optimistic, then merge the (small) server response ──

  const patchSet = useCallback(
    (entry: SessionEntry, set: WorkoutSet, patch: SetPatch) => {
      if (isTempId(set.id)) return;
      const s = sessionRef.current;
      if (patch.completed && entry.restSec && entry.restSec > 0 && s?.status !== 'COMPLETED') {
        timerRef.current?.start(entry.restSec, entry.exerciseName); // user gesture → audio unlocked
      }
      setData((cur) => cur && applySetPatch(cur, set.id, patch));
      const version = (setVersions.current.get(set.id) ?? 0) + 1;
      setVersions.current.set(set.id, version);
      api
        .patch<SetPatchResponse>(`/workouts/sets/${set.id}`, patch)
        // A newer edit of the same set is in flight → keep the local values, merge only statuses.
        .then((r) => setData((cur) => cur && mergeSetResponse(cur, r, { includeSet: setVersions.current.get(set.id) === version })))
        .catch(fail);
    },
    [setData, fail],
  );

  const addSet = useCallback(
    (entry: SessionEntry) => {
      const tempId = `${TEMP_PREFIX}${Math.random().toString(36).slice(2)}`;
      setData((cur) => cur && addTempSet(cur, entry.id, tempId));
      api
        .post<{ entryId: string; set: WorkoutSet }>(`/workouts/entries/${entry.id}/sets`, {})
        .then((r) => setData((cur) => cur && replaceSet(cur, entry.id, tempId, r.set)))
        .catch(fail);
    },
    [setData, fail],
  );

  const deleteSet = useCallback(
    (_entry: SessionEntry, set: WorkoutSet) => {
      setData((cur) => cur && removeSet(cur, set.id));
      api.delete(`/workouts/sets/${set.id}`).catch(fail);
    },
    [setData, fail],
  );

  const patchEntry = useCallback(
    (entry: SessionEntry, patch: { status?: ItemStatus; notes?: string | null; restSec?: number | null }) => {
      setData((cur) => cur && patchEntryLocal(cur, entry.id, patch));
      api
        .patch<EntryPatchResponse>(`/workouts/entries/${entry.id}`, patch)
        .then((r) => setData((cur) => cur && mergeEntryResponse(cur, r)))
        .catch(fail);
    },
    [setData, fail],
  );

  const setStatus = useCallback((entry: SessionEntry, status: ItemStatus) => patchEntry(entry, { status }), [patchEntry]);

  const removeExercise = useCallback(
    async (entry: SessionEntry) => {
      if (!(await confirm({ title: `Remove ${entry.exerciseName}?`, message: 'Its logged sets in this workout are deleted.', destructive: true, confirmLabel: 'Remove' }))) return;
      setData((cur) => cur && removeEntry(cur, entry.id));
      api.delete(`/workouts/entries/${entry.id}`).then(() => notify('Exercise removed'), fail);
    },
    [confirm, setData, notify, fail],
  );

  if (error) {
    return (
      <Box>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate('/workouts')} sx={{ mb: 2 }}>
          Workouts
        </Button>
        <ErrorState error={error.status === 404 ? 'This workout was not found.' : error} onRetry={error.status === 404 ? undefined : reload} />
      </Box>
    );
  }
  if (loading && !session) return <LoadingState label="Loading workout…" minHeight={300} />;
  if (!session) return null;

  const readOnly = session.status === 'SKIPPED';
  const showTimer = !readOnly && session.status !== 'COMPLETED';
  const { completedSets: doneSets, totalSets } = session.stats;
  const progress = totalSets ? (doneSets / totalSets) * 100 : 0;

  const start = async () => {
    setBusy(true);
    await runFull(() => api.post<Session>(`/workouts/sessions/${session.id}/start`), 'Workout started');
    setBusy(false);
  };
  const finish = async () => {
    if (doneSets < totalSets) {
      const left = totalSets - doneSets;
      const yes = await confirm({
        title: 'Finish workout?',
        message: `${left} set${left === 1 ? ' is' : 's are'} not ticked. Unticked sets won't count toward volume or records.`,
        confirmLabel: 'Finish',
      });
      if (!yes) return;
    }
    setBusy(true);
    await runFull(() => api.post<Session>(`/workouts/sessions/${session.id}/finish`), 'Workout finished — nice work!');
    setBusy(false);
  };
  const skip = async () => {
    if (!(await confirm({ title: 'Skip this workout?', message: 'It will be recorded as skipped. You can start it again later.', confirmLabel: 'Skip workout' }))) return;
    await runFull(() => api.post<Session>(`/workouts/sessions/${session.id}/skip`), 'Workout skipped');
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this workout log?', message: 'All logged sets for this session are permanently deleted.', destructive: true }))) return;
    try {
      await api.delete(`/workouts/sessions/${session.id}`);
      notify('Workout deleted');
      navigate('/workouts?tab=history', { replace: true });
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const meta = [formatDay(session.date, 'EEE d MMM'), session.workoutDay?.plan.name].filter(Boolean).join(' · ');
  const canFinish = session.status === 'IN_PROGRESS';
  const canStart = session.status === 'PLANNED' || session.status === 'SKIPPED';

  return (
    <Box>
      {/* Compact header: back · name · Finish · ⋮ */}
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1.5, mx: { xs: -1, md: 0 } }}>
        <IconButton aria-label="Back to workouts" onClick={() => navigate('/workouts')}>
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h1" noWrap sx={{ fontSize: { xs: 19, md: 26 }, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            {session.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {meta}
            {session.status !== 'IN_PROGRESS' ? ` · ${STATUS_LABEL[session.status]}` : ''}
          </Typography>
        </Box>
        {canFinish && (
          <Button variant="contained" color="success" startIcon={<FlagRoundedIcon />} onClick={finish} disabled={busy} sx={{ minHeight: 44, flexShrink: 0, borderRadius: 999, px: 2 }}>
            Finish
          </Button>
        )}
        <IconButton aria-label="Workout options" onClick={(e) => setMenu(e.currentTarget)}>
          <MoreVertIcon />
        </IconButton>
      </Stack>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => (setMenu(null), setRenaming(true))}>
          <ListItemIcon>
            <EditOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Rename
        </MenuItem>
        {(session.status === 'IN_PROGRESS' || session.status === 'PLANNED') && (
          <MenuItem onClick={() => (setMenu(null), void skip())}>
            <ListItemIcon>
              <SkipNextRoundedIcon fontSize="small" />
            </ListItemIcon>
            Skip workout
          </MenuItem>
        )}
        <MenuItem onClick={() => (setMenu(null), void remove())} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          Delete workout
        </MenuItem>
      </Menu>

      {/* Progress strip: numbers first */}
      <Card
        sx={(t) => ({
          mb: 2,
          px: 2,
          pt: 1.5,
          pb: 1.75,
          bgcolor: live ? alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.14 : 0.07) : 'background.paper',
          borderColor: live ? alpha(t.palette.primary.main, 0.35) : 'divider',
        })}
      >
        <Stack direction="row" alignItems="flex-end" justifyContent="space-between" spacing={1}>
          <Box>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
              <TimerOutlinedIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" fontWeight={600}>
                {live ? 'Elapsed' : 'Duration'}
              </Typography>
            </Stack>
            <Typography sx={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }} aria-live="off">
              {elapsed == null ? '–:–' : live ? formatCountdown(elapsed) : formatDuration(elapsed)}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
              {doneSets}
              <Typography component="span" color="text.secondary" sx={{ fontSize: 15, fontWeight: 700 }}>
                /{totalSets} sets
              </Typography>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {session.stats.volumeKg > 0 ? `${formatKg(session.stats.volumeKg)} volume` : `${session.stats.completedEntries}/${session.entries.length} exercises`}
            </Typography>
          </Box>
        </Stack>
        <LinearProgress variant="determinate" value={progress} color={progress === 100 ? 'success' : 'primary'} sx={{ mt: 1.25, height: 6 }} aria-label="Sets completed" />
      </Card>

      {canStart && (
        <Button fullWidth variant="contained" size="large" startIcon={<PlayArrowRoundedIcon />} onClick={start} disabled={busy} sx={{ mb: 2, minHeight: 52, fontSize: 17, borderRadius: 3 }}>
          {session.status === 'SKIPPED' ? 'Start anyway' : 'Start workout'}
        </Button>
      )}
      {session.status === 'SKIPPED' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This workout was skipped. Start it to log sets.
        </Alert>
      )}
      {session.status === 'COMPLETED' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Done in {formatDuration(session.durationSec)} · {session.stats.completedSets} sets. You can still correct sets below.
        </Alert>
      )}

      <Stack spacing={1.5}>
        {session.entries.length === 0 ? (
          <Card>
            <EmptyState title="No exercises yet" description="Add the exercises you're doing to log sets." />
          </Card>
        ) : (
          session.entries.map((entry, i) => (
            <SessionEntryCard
              key={entry.id}
              entry={entry}
              index={i}
              readOnly={readOnly}
              onPatchSet={patchSet}
              onAddSet={addSet}
              onDeleteSet={deleteSet}
              onSetStatus={setStatus}
              onEdit={setEditing}
              onRemove={removeExercise}
            />
          ))
        )}
        {!readOnly && (
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ minHeight: 48, borderStyle: 'dashed', borderRadius: 3 }}>
            Add exercise
          </Button>
        )}
        <TextField
          label="Workout notes"
          size="medium"
          multiline
          minRows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() =>
            notes.trim() !== (session.notes ?? '') && void runFull(() => api.patch<Session>(`/workouts/sessions/${session.id}`, { notes: notes.trim() || null }), 'Notes saved', true)
          }
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
      </Stack>

      {showTimer && (
        <>
          {phone && <Box sx={{ height: REST_BAR_SPACE }} aria-hidden />}
          <RestTimerPanel ref={timerRef} />
        </>
      )}

      <AddExerciseDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={async (p, sets) => {
          try {
            const entry = await api.post<SessionEntry>(
              `/workouts/sessions/${session.id}/entries`,
              'exercise' in p ? { exerciseId: p.exercise.id, sets } : { exerciseName: p.name, sets },
            );
            setData((cur) => cur && appendEntry(cur, entry));
            setAdding(false);
          } catch (e) {
            notify(toApiError(e).message, 'error');
          }
        }}
      />
      <EntryDialog
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={(entry, patch) => {
          setEditing(null);
          patchEntry(entry, patch);
        }}
      />
      <RenameDialog
        open={renaming}
        name={session.name}
        onClose={() => setRenaming(false)}
        onSave={(name) => runFull(() => api.patch<Session>(`/workouts/sessions/${session.id}`, { name }), undefined, true)}
      />
    </Box>
  );
}
