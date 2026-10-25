import { useState } from 'react';
import { alpha } from '@mui/material/styles';
import { Box, Card, Chip, InputAdornment, List, ListItem, ListItemAvatar, ListItemButton, ListItemText, Stack, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { api, toApiError } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { useFeedback } from '../../components/common/Feedback';
import { FabSpacer, PrimaryAction } from '../../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { MediaImage } from '../media/MediaImage';
import { ExerciseDialog } from './ExerciseDialog';
import { RowMenu } from './RowMenu';
import { useDebounced } from './useDebounced';
import { EXERCISE_TYPES, type Exercise, type ExerciseType } from './types';

/** Exercise library: search + type chips, list rows with ⋮ menus, FAB "New exercise". */
export function ExerciseLibraryTab() {
  const { notify, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<ExerciseType | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialog, setDialog] = useState<{ exercise: Exercise | null } | null>(null);

  const q = useDebounced(search.trim());
  const { data, error, loading, reload } = useAsync(
    () => api.get<Exercise[]>('/workouts/exercises', { search: q || undefined, type: type || undefined, includeArchived }),
    [q, type, includeArchived],
  );

  const toggleArchive = async (e: Exercise) => {
    try {
      await api.post(`/workouts/exercises/${e.id}/archive`, { archived: !e.archivedAt });
      notify(e.archivedAt ? 'Exercise restored' : 'Archived — hidden from pickers, history kept');
      void reload();
    } catch (err) {
      notify(toApiError(err).message, 'error');
    }
  };

  const remove = async (e: Exercise) => {
    const yes = await confirm({
      title: `Delete "${e.name}"?`,
      message: (
        <>
          It will be removed from {e.planUses ? `${e.planUses} plan day${e.planUses === 1 ? '' : 's'}` : 'your plans'}. Logged workouts keep the exercise name and sets.
          Archive instead if you only want to hide it.
        </>
      ),
      destructive: true,
    });
    if (!yes) return;
    try {
      await api.delete(`/workouts/exercises/${e.id}`);
      notify('Exercise deleted');
      void reload();
    } catch (err) {
      notify(toApiError(err).message, 'error');
    }
  };

  const chips: { value: ExerciseType | ''; label: string }[] = [{ value: '', label: 'All' }, ...EXERCISE_TYPES];

  return (
    <Box>
      <TextField
        placeholder="Search name, muscle or equipment"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="medium"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
            sx: { borderRadius: 3, bgcolor: 'background.paper' },
          },
          htmlInput: { 'aria-label': 'Search exercises', type: 'search', enterKeyHint: 'search' },
        }}
        sx={{ mb: 1.5 }}
      />
      <Stack direction="row" spacing={1} sx={{ mb: 2, overflowX: 'auto', mx: -2, px: 2, pb: 0.5, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        {chips.map((c) => (
          <Chip
            key={c.value || 'all'}
            label={c.label}
            onClick={() => setType(c.value)}
            color={type === c.value ? 'primary' : 'default'}
            variant={type === c.value ? 'filled' : 'outlined'}
            sx={{ height: 36, px: 0.5, flexShrink: 0 }}
          />
        ))}
        <Chip
          label="Archived"
          icon={<ArchiveOutlinedIcon />}
          onClick={() => setIncludeArchived((v) => !v)}
          color={includeArchived ? 'primary' : 'default'}
          variant={includeArchived ? 'filled' : 'outlined'}
          aria-pressed={includeArchived}
          sx={{ height: 36, px: 0.5, flexShrink: 0 }}
        />
      </Stack>

      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingState label="Loading exercises…" />
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<FitnessCenterIcon fontSize="inherit" />}
            title={search || type ? 'No exercises match' : 'Your exercise library is empty'}
            description={search || type ? 'Try a different search or filter.' : 'Add the exercises you do so you can plan and log them.'}
          />
        </Card>
      ) : (
        <Card>
          <List disablePadding>
            {data.map((e, i) => (
              <ListItem
                key={e.id}
                disablePadding
                divider={i < data.length - 1}
                secondaryAction={
                  <RowMenu
                    label={`Options for ${e.name}`}
                    items={[
                      { label: 'Edit', icon: <EditOutlinedIcon fontSize="small" />, onClick: () => setDialog({ exercise: e }) },
                      {
                        label: e.archivedAt ? 'Restore' : 'Archive',
                        icon: e.archivedAt ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />,
                        onClick: () => void toggleArchive(e),
                      },
                      { label: 'Delete', icon: <DeleteOutlineIcon fontSize="small" />, danger: true, onClick: () => void remove(e) },
                    ]}
                  />
                }
                sx={{ opacity: e.archivedAt ? 0.6 : 1 }}
              >
                <ListItemButton onClick={() => setDialog({ exercise: e })} sx={{ py: 1, pr: 7 }}>
                  <ListItemAvatar sx={{ minWidth: 60 }}>
                    {e.imageMediaId ? (
                      <Box sx={{ width: 44 }}>
                        <MediaImage mediaId={e.imageMediaId} alt={`${e.name} reference`} />
                      </Box>
                    ) : (
                      <Box
                        sx={(t) => ({
                          width: 44,
                          height: 44,
                          borderRadius: '12px',
                          bgcolor: alpha(t.palette.primary.main, 0.1),
                          display: 'grid',
                          placeItems: 'center',
                          color: 'primary.main',
                        })}
                      >
                        <FitnessCenterIcon fontSize="small" />
                      </Box>
                    )}
                  </ListItemAvatar>
                  <ListItemText
                    primary={`${e.name}${e.archivedAt ? ' · archived' : ''}`}
                    secondary={
                      [EXERCISE_TYPES.find((t) => t.value === e.type)?.label, e.muscleGroup, e.equipment, e.historyCount ? `logged ${e.historyCount}×` : null]
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    slotProps={{ primary: { fontWeight: 700, noWrap: true }, secondary: { noWrap: true } }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Card>
      )}

      <PrimaryAction icon={<AddIcon />} label="New exercise" onClick={() => setDialog({ exercise: null })} />
      <FabSpacer />
      <ExerciseDialog
        open={!!dialog}
        exercise={dialog?.exercise ?? null}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          void reload();
        }}
      />
    </Box>
  );
}
