import { useEffect, useState } from 'react';
import { Box, Button, Card, Stack, TextField, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import { format } from 'date-fns';
import { api, toApiError } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { EmptyState, ErrorState } from '../../components/common/States';
import { useFeedback } from '../../components/common/Feedback';
import { ResponsiveDialog } from '../../components/common/mobile';
import { MediaImage } from './MediaImage';
import { MediaUploadButton } from './MediaUploadButton';
import { deleteMediaAsset, primeMediaCache, useMediaStatus, type MediaAsset } from './mediaApi';

const PAGE_SIZE = 24;

function photoDate(a: MediaAsset) {
  return format(new Date(a.takenAt ?? a.createdAt), 'd MMM yyyy');
}

/** Toggles between local datetime-input value and ISO. */
const toLocalInput = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '');

function PhotoDialog({ asset, onClose, onChanged, onDeleted }: { asset: MediaAsset | null; onClose: () => void; onChanged: (a: MediaAsset) => void; onDeleted: (id: string) => void }) {
  const { notify, confirm } = useFeedback();
  const [notes, setNotes] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotes(asset?.notes ?? '');
    setTakenAt(toLocalInput(asset?.takenAt ?? null));
  }, [asset]);

  const save = async () => {
    if (!asset) return;
    setSaving(true);
    try {
      const updated = await api.patch<MediaAsset>(`/media/${asset.id}`, {
        notes: notes.trim() || null,
        takenAt: takenAt ? new Date(takenAt).toISOString() : null,
      });
      primeMediaCache(updated);
      onChanged(updated);
      notify('Photo details saved');
    } catch (e) {
      notify(toApiError(e).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!asset) return;
    const yes = await confirm({
      title: 'Delete this photo?',
      message: 'The photo is permanently removed from storage. Measurements that used it keep their numbers but lose the photo.',
      destructive: true,
    });
    if (!yes) return;
    try {
      await deleteMediaAsset(asset.id);
      onDeleted(asset.id);
      notify('Photo deleted');
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  return (
    <ResponsiveDialog
      open={!!asset}
      onClose={onClose}
      maxWidth="md"
      title={asset ? `Progress photo · ${photoDate(asset)}` : ''}
      actions={
        <>
          <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={remove}>
            Delete
          </Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {asset && (
        <Stack spacing={2}>
          <MediaImage
            mediaId={asset.id}
            alt={`Progress photo from ${photoDate(asset)}`}
            fit="contain"
            sx={{ aspectRatio: 'auto', maxHeight: '55vh', bgcolor: 'action.hover' }}
          />
          <TextField
            label="Taken at"
            size="medium"
            type="datetime-local"
            value={takenAt}
            onChange={(e) => setTakenAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField label="Notes" size="medium" value={notes} onChange={(e) => setNotes(e.target.value)} multiline maxRows={4} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        </Stack>
      )}
    </ResponsiveDialog>
  );
}

/** Progress photos as a 3-column square grid (cached), with upload, details editing and delete. */
export function ProgressPhotoGallery({ refreshKey = 0, onDeleted }: { refreshKey?: number; onDeleted?: (id: string) => void }) {
  const { status } = useMediaStatus();
  const configured = status?.configured ?? false;
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const pageSize = Math.min(100, PAGE_SIZE * pages);
  const { data, setData, error, loading, refreshing, reload } = useAsync(
    async () => {
      if (!configured) return null;
      const res = await api.getPaged<MediaAsset[]>('/media', { kind: 'PROGRESS_PHOTO', page: 1, pageSize });
      res.data.forEach(primeMediaCache);
      return res;
    },
    [configured, pageSize, refreshKey],
  );
  const items = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const update = (fn: (list: MediaAsset[]) => MediaAsset[], delta = 0) =>
    setData((d) => (d ? { ...d, data: fn(d.data), meta: { ...d.meta, total: d.meta.total + delta } } : d));

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1, minHeight: 44 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={800}>
            Progress photos
          </Typography>
          {configured && total > 0 && (
            <Typography variant="caption" color="text.secondary">
              {total} photo{total === 1 ? '' : 's'} · private
            </Typography>
          )}
        </Box>
        {configured && (
          <MediaUploadButton
            kind="PROGRESS_PHOTO"
            label="Add photo"
            size="small"
            variant="text"
            onUploaded={(a) => {
              primeMediaCache(a);
              update((list) => [a, ...list], 1);
            }}
          />
        )}
      </Stack>
      {!status ? null : !configured ? (
        <Card>
          <EmptyState icon={<PhotoLibraryOutlinedIcon fontSize="inherit" />} title="Photo storage unavailable" description="Progress photos need the media bucket to be configured on the server." />
        </Card>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ aspectRatio: '1 / 1', borderRadius: 2, bgcolor: 'action.hover' }} />
          ))}
        </Box>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PhotoLibraryOutlinedIcon fontSize="inherit" />}
            title="No progress photos yet"
            description="Same light and pose every few weeks shows change the scale can't."
          />
        </Card>
      ) : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(4, 1fr)', md: 'repeat(6, 1fr)' }, gap: 0.75 }}>
            {items.map((a) => (
              <Box
                key={a.id}
                component="button"
                type="button"
                onClick={() => setSelected(a)}
                aria-label={`Open progress photo from ${photoDate(a)}`}
                sx={{
                  position: 'relative',
                  p: 0,
                  border: 0,
                  bgcolor: 'transparent',
                  width: '100%',
                  cursor: 'pointer',
                  borderRadius: 2,
                  overflow: 'hidden',
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                }}
              >
                <MediaImage mediaId={a.id} alt={`Progress photo from ${photoDate(a)}`} sx={{ borderRadius: 0 }} />
                <Typography
                  component="span"
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    px: 0.75,
                    py: 0.25,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#fff',
                    textAlign: 'left',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                  }}
                >
                  {format(new Date(a.takenAt ?? a.createdAt), 'd MMM')}
                </Typography>
              </Box>
            ))}
          </Box>
          {total > items.length && pageSize < 100 && (
            <Button fullWidth onClick={() => setPages((p) => p + 1)} disabled={refreshing} sx={{ mt: 1.5, minHeight: 44 }}>
              {refreshing ? 'Loading…' : 'Load more photos'}
            </Button>
          )}
        </>
      )}
      <PhotoDialog
        asset={selected}
        onClose={() => setSelected(null)}
        onChanged={(u) => {
          update((list) => list.map((x) => (x.id === u.id ? u : x)));
          setSelected(u);
        }}
        onDeleted={(id) => {
          update((list) => list.filter((x) => x.id !== id), -1);
          setSelected(null);
          onDeleted?.(id);
        }}
      />
    </Box>
  );
}
