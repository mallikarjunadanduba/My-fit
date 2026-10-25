import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  MenuItem,
  Pagination,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import EggAltRoundedIcon from '@mui/icons-material/EggAltRounded';
import NoteAddRoundedIcon from '@mui/icons-material/NoteAddRounded';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { todayIn } from '../services/dates';
import { useAuth } from '../features/auth/AuthContext';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { useFeedback } from '../components/common/Feedback';
import { FabSpacer, PrimaryAction, ResponsiveDialog } from '../components/common/mobile';
import { MediaImage } from '../features/media';
import type { Food, FoodCategory, FoodSort } from '../features/foods/types';
import { fmt, servingText } from '../features/foods/format';
import { errorMessage } from '../features/foods/formHelpers';
import { FoodFormDialog } from '../features/foods/FoodFormDialog';
import { CategoryManagerDialog } from '../features/foods/CategoryManagerDialog';
import { AddToTemplateDialog } from '../features/foods/AddToTemplateDialog';
import { AddFoodDialog } from '../features/diary/AddFoodDialog';
import { MacroMini } from '../features/diary/MealSlotCard';
import { ActionRow, HScroll, OverflowMenu } from '../features/foods/mobile';
import { nutrientColors } from '../theme/theme';

const PAGE_SIZE = 30;
const SORTS: { value: FoodSort; label: string }[] = [
  { value: 'name', label: 'Name (favourites first)' },
  { value: 'protein', label: 'Most protein' },
  { value: 'fiber', label: 'Most fiber' },
  { value: 'calories', label: 'Fewest calories' },
  { value: 'recent', label: 'Recently updated' },
];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** One food as a list row: name/serving/macros on the left, kcal + favourite + ⋮ on the right. Tap logs it. */
function FoodRow({
  food,
  onOpen,
  onFavorite,
  onEdit,
  onDiary,
  onTemplate,
  onArchive,
  onDelete,
  divider,
}: {
  divider?: boolean;
  food: Food;
  onOpen: () => void;
  onFavorite: () => void;
  onEdit: () => void;
  onDiary: () => void;
  onTemplate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const archived = !!food.archivedAt;
  return (
    <ActionRow
      onClick={onOpen}
      dim={archived}
      divider={divider}
      trailing={
        <>
          <IconButton
            onClick={onFavorite}
            aria-label={food.isFavorite ? `Unfavourite ${food.name}` : `Favourite ${food.name}`}
            aria-pressed={food.isFavorite}
            sx={{
              width: 44,
              height: 44,
              color: food.isFavorite ? 'warning.main' : 'text.disabled',
            }}
          >
            {food.isFavorite ? <StarRoundedIcon /> : <StarBorderRoundedIcon />}
          </IconButton>
          <OverflowMenu
            label={`More actions for ${food.name}`}
            actions={[
              {
                label: 'Add to diary',
                icon: <NoteAddRoundedIcon fontSize="small" />,
                onClick: onDiary,
                hidden: archived,
              },
              {
                label: 'Edit',
                icon: <EditRoundedIcon fontSize="small" />,
                onClick: onEdit,
              },
              {
                label: 'Add to meal template',
                icon: <PlaylistAddRoundedIcon fontSize="small" />,
                onClick: onTemplate,
                hidden: archived,
              },
              {
                label: archived ? 'Unarchive' : 'Archive',
                icon: archived ? <UnarchiveOutlinedIcon fontSize="small" /> : <ArchiveOutlinedIcon fontSize="small" />,
                onClick: onArchive,
              },
              {
                label: 'Delete',
                icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                onClick: onDelete,
                destructive: true,
              },
            ]}
          />
        </>
      }
    >
      {food.imageMediaId && <MediaImage mediaId={food.imageMediaId} alt="" sx={{ width: 44, height: 44, borderRadius: 2, flexShrink: 0 }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={600} sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>
          {food.name}
          {food.isEstimate && (
            <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.75 }}>
              est.
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {food.brand ? `${food.brand} · ` : ''}
          {servingText(food)}
        </Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <MacroMini n={food} />
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography fontWeight={800} sx={{ fontSize: 18, lineHeight: 1.1, color: nutrientColors.calories }}>
          {fmt(food.calories, 0)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          kcal
        </Typography>
      </Box>
    </ActionRow>
  );
}

export default function FoodsPage() {
  const { timezone } = useAuth();
  const { notify, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<FoodSort>('name');
  const [showFilters, setShowFilters] = useState(false);
  const [minProtein, setMinProtein] = useState('');
  const [minFiber, setMinFiber] = useState('');
  const [maxCalories, setMaxCalories] = useState('');
  const nutrientFilter = useDebounced({ minProtein, minFiber, maxCalories }, 400);
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Food | null | undefined>(undefined); // undefined = closed, null = new
  const [catOpen, setCatOpen] = useState(false);
  const [diaryFood, setDiaryFood] = useState<Food | null>(null);
  const [templateFood, setTemplateFood] = useState<Food | null>(null);

  const categories = useAsync(() => api.get<FoodCategory[]>('/foods/categories'), []);
  const numOrUndef = (s: string) => (s !== '' && Number(s) >= 0 ? Number(s) : undefined);
  const foods = useAsync(
    () =>
      api.getPaged<Food[]>('/foods', {
        search: q || undefined,
        categoryId: categoryId ?? undefined,
        favorites: favorites ? 'true' : undefined,
        archivedOnly: archived ? 'true' : undefined,
        sort,
        minProtein: numOrUndef(nutrientFilter.minProtein),
        minFiber: numOrUndef(nutrientFilter.minFiber),
        maxCalories: numOrUndef(nutrientFilter.maxCalories),
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, categoryId, favorites, archived, sort, nutrientFilter, page],
  );

  // Back to page 1 whenever the filters change.
  useEffect(() => setPage(1), [q, categoryId, favorites, archived, sort, nutrientFilter]);

  const activeFilters =
    [nutrientFilter.minProtein, nutrientFilter.minFiber, nutrientFilter.maxCalories].filter((v) => v !== '').length +
    (archived ? 1 : 0) +
    (sort !== 'name' ? 1 : 0);

  const replace = (f: Food) => foods.setData((d) => (d ? { ...d, data: d.data.map((x) => (x.id === f.id ? f : x)) } : d));
  const drop = (id: string) =>
    foods.setData((d) =>
      d
        ? {
            ...d,
            data: d.data.filter((x) => x.id !== id),
            meta: { ...d.meta, total: d.meta.total - 1 },
          }
        : d,
    );

  const toggleFavorite = async (f: Food) => {
    replace({ ...f, isFavorite: !f.isFavorite }); // optimistic
    try {
      replace(
        await api.post<Food>(`/foods/${f.id}/favorite`, {
          isFavorite: !f.isFavorite,
        }),
      );
    } catch (e) {
      replace(f);
      notify(errorMessage(e), 'error');
    }
  };

  const toggleArchive = async (f: Food) => {
    try {
      await api.post(`/foods/${f.id}/${f.archivedAt ? 'unarchive' : 'archive'}`);
      drop(f.id); // it moves to the other (archived / active) list
      notify(f.archivedAt ? `${f.name} restored` : `${f.name} archived — it stays in past diary days`);
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const remove = async (f: Food) => {
    const ok = await confirm({
      title: `Delete ${f.name}?`,
      message:
        'This permanently removes the food from your library. Past diary entries keep their logged nutrition; meal template items lose the link. Archiving hides it instead.',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/foods/${f.id}`);
      drop(f.id);
      notify(`${f.name} deleted`);
      void categories.reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
  };

  const list = foods.data?.data ?? [];
  const meta = foods.data?.meta;
  const filtered = !!(q || categoryId || favorites || activeFilters);

  return (
    <Box>
      <PageHeader
        title="Food library"
        subtitle={meta ? `${meta.total} food${meta.total === 1 ? '' : 's'} · nutrition per serving` : 'Nutrition per serving'}
        actions={
          <>
            <PrimaryAction icon={<AddRoundedIcon />} label="New food" onClick={() => setEditing(null)} />
            <IconButton aria-label="Manage categories" onClick={() => setCatOpen(true)} sx={{ width: 44, height: 44 }}>
              <CategoryOutlinedIcon />
            </IconButton>
          </>
        }
      />

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <TextField
          placeholder="Search foods or brands"
          size="medium"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search foods' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon />
                </InputAdornment>
              ),
              sx: { borderRadius: 3, bgcolor: 'background.paper' },
            },
          }}
        />
        <IconButton
          aria-label="Sort and filters"
          onClick={() => setShowFilters(true)}
          sx={{
            width: 48,
            height: 48,
            flexShrink: 0,
            border: 1,
            borderColor: 'divider',
            borderRadius: 3,
            bgcolor: 'background.paper',
          }}
        >
          <Badge color="primary" badgeContent={activeFilters} invisible={!activeFilters}>
            <TuneRoundedIcon />
          </Badge>
        </IconButton>
      </Stack>

      <Box sx={{ mb: 1.5 }}>
        <HScroll label="Filter by category">
          <Chip
            label="All"
            color={!categoryId && !favorites ? 'primary' : 'default'}
            onClick={() => {
              setCategoryId(null);
              setFavorites(false);
            }}
          />
          <Chip
            icon={<StarRoundedIcon />}
            label="Favourites"
            color={favorites ? 'primary' : 'default'}
            onClick={() => setFavorites((v) => !v)}
            aria-pressed={favorites}
          />
          {(categories.data ?? []).map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              color={categoryId === c.id ? 'primary' : 'default'}
              onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
            />
          ))}
        </HScroll>
      </Box>

      {foods.error ? (
        <ErrorState error={foods.error} onRetry={foods.reload} />
      ) : foods.loading && !foods.data ? (
        <LoadingState label="Loading foods…" />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<EggAltRoundedIcon fontSize="inherit" />}
            title={filtered ? 'No foods match' : archived ? 'No archived foods' : 'Your library is empty'}
            description={filtered ? 'Try another search or clear the filters.' : 'Add the foods you eat regularly with their nutrition per serving.'}
            action={
              !archived && !filtered ? (
                <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setEditing(null)} sx={{ minHeight: 44 }}>
                  New food
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card sx={{ overflow: 'hidden' }}>
            <Box sx={{ height: 2 }}>{(foods.refreshing || foods.loading) && <LinearProgress sx={{ height: 2, borderRadius: 0 }} aria-label="Loading" />}</Box>
            <List disablePadding>
              {list.map((f, i) => (
                <FoodRow
                  key={f.id}
                  divider={i > 0}
                  food={f}
                  onOpen={() => (f.archivedAt ? setEditing(f) : setDiaryFood(f))}
                  onFavorite={() => toggleFavorite(f)}
                  onEdit={() => setEditing(f)}
                  onDiary={() => setDiaryFood(f)}
                  onTemplate={() => setTemplateFood(f)}
                  onArchive={() => toggleArchive(f)}
                  onDelete={() => remove(f)}
                />
              ))}
            </List>
          </Card>
          {meta && meta.totalPages > 1 && (
            <Stack alignItems="center" sx={{ mt: 2 }}>
              <Pagination count={meta.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" siblingCount={0} />
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary" component="p" textAlign="center" sx={{ mt: 1.5 }}>
            Tap a food to log it. Edits never change what you&apos;ve already logged.
          </Typography>
        </>
      )}
      <FabSpacer />

      <ResponsiveDialog
        open={showFilters}
        onClose={() => setShowFilters(false)}
        maxWidth="xs"
        title="Sort & filter"
        actions={
          <>
            <Button
              disabled={!activeFilters}
              onClick={() => {
                setMinProtein('');
                setMinFiber('');
                setMaxCalories('');
                setArchived(false);
                setSort('name');
              }}
            >
              Reset
            </Button>
            <Button variant="contained" onClick={() => setShowFilters(false)}>
              Show foods
            </Button>
          </>
        }
      >
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField select size="medium" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as FoodSort)}>
            {SORTS.map((s) => (
              <MenuItem key={s.value} value={s.value} sx={{ minHeight: 48 }}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="subtitle2" color="text.secondary">
            Per serving
          </Typography>
          {(
            [
              ['Min protein', minProtein, setMinProtein, 'g'],
              ['Min fiber', minFiber, setMinFiber, 'g'],
              ['Max calories', maxCalories, setMaxCalories, 'kcal'],
            ] as const
          ).map(([label, value, set, unit]) => (
            <TextField
              key={label}
              label={label}
              size="medium"
              type="number"
              value={value}
              onChange={(e) => set(e.target.value)}
              slotProps={{
                htmlInput: { min: 0, inputMode: 'decimal' },
                input: {
                  endAdornment: <InputAdornment position="end">{unit}</InputAdornment>,
                },
              }}
            />
          ))}
          <FormControlLabel
            control={<Switch checked={archived} onChange={(e) => setArchived(e.target.checked)} />}
            label="Show archived foods only"
            sx={{ minHeight: 48 }}
          />
        </Stack>
      </ResponsiveDialog>

      <FoodFormDialog
        open={editing !== undefined}
        food={editing ?? null}
        categories={categories.data ?? []}
        onClose={() => setEditing(undefined)}
        onSaved={(saved) => {
          if (editing) replace(saved);
          else void foods.reload();
          void categories.reload();
        }}
      />
      <CategoryManagerDialog
        open={catOpen}
        categories={categories.data ?? []}
        onClose={() => setCatOpen(false)}
        onChanged={() => {
          void categories.reload();
          void foods.reload();
        }}
      />
      <AddFoodDialog open={!!diaryFood} onClose={() => setDiaryFood(null)} date={todayIn(timezone)} initialFood={diaryFood} onSaved={() => undefined} />
      <AddToTemplateDialog open={!!templateFood} food={templateFood} onClose={() => setTemplateFood(null)} />
    </Box>
  );
}
