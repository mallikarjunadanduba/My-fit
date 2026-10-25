import { useState, type ReactNode } from 'react';
import { alpha } from '@mui/material/styles';
import { Box, Button, Card, Chip, List, ListItem, ListItemAvatar, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import StraightenIcon from '@mui/icons-material/Straighten';
import MonitorWeightOutlinedIcon from '@mui/icons-material/MonitorWeightOutlined';
import { api, toApiError, type PageMeta } from '../services/api';
import { formatDay, shiftDate, todayIn } from '../services/dates';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../features/auth/AuthContext';
import { useFeedback } from '../components/common/Feedback';
import { PageHeader } from '../components/common/PageHeader';
import { FabSpacer, PrimaryAction, usePhone, visuallyHiddenSx } from '../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { MediaImage } from '../features/media/MediaImage';
import { MediaStatusBanner } from '../features/media/MediaStatusBanner';
import { ProgressPhotoGallery } from '../features/media/ProgressPhotoGallery';
import { MeasurementDialog } from '../features/measurements/MeasurementDialog';
import { WeightTrendChart } from '../features/measurements/WeightTrendChart';
import { RowMenu } from '../features/workouts/RowMenu';
import { METRICS, fmtMetric, type LatestMeasurements, type Measurement, type WeightTrend } from '../features/measurements/types';

const RANGES = [
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
  { days: 180, label: '6M' },
  { days: 365, label: '1Y' },
];
const PAGE = 20;

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

function SectionTitle({ children, aside }: { children: string; aside?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, mb: 1, minHeight: 32 }}>
      <Typography variant="subtitle1" fontWeight={800}>
        {children}
      </Typography>
      {aside}
    </Stack>
  );
}

export default function MeasurementsPage() {
  const { timezone } = useAuth();
  const phone = usePhone();
  const { notify, confirm } = useFeedback();
  const today = todayIn(timezone);
  const [rangeDays, setRangeDays] = useState(90);
  const [pages, setPages] = useState(1);
  const [dialog, setDialog] = useState<{ m: Measurement | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [galleryKey, setGalleryKey] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const from = shiftDate(today, -(rangeDays - 1));
  const pageSize = Math.min(100, PAGE * pages);
  const latest = useAsync(() => api.get<LatestMeasurements>('/measurements/latest'), [version]);
  const trend = useAsync(() => api.get<WeightTrend>('/measurements/trend', { from, to: today }), [from, today, version]);
  const list = useAsync(() => api.getPaged<Measurement[]>('/measurements', { page: 1, pageSize }), [pageSize, version]);
  const rows = list.data?.data ?? [];
  const meta = list.data?.meta as PageMeta | undefined;

  const remove = async (m: Measurement) => {
    const yes = await confirm({
      title: `Delete measurement from ${formatDay(m.date)}?`,
      message: m.photoMediaId ? 'The attached progress photo stays in your gallery — delete it there if you no longer want it.' : undefined,
      destructive: true,
    });
    if (!yes) return;
    try {
      await api.delete(`/measurements/${m.id}`);
      notify('Measurement deleted');
      bump();
    } catch (e) {
      notify(toApiError(e).message, 'error');
    }
  };

  const weight = latest.data?.metrics.weightKg;
  const others = METRICS.filter((m) => m.key !== 'weightKg' && latest.data?.metrics[m.key]);
  const t = trend.data;

  return (
    <Box>
      {phone ? (
        <Typography component="h1" sx={visuallyHiddenSx}>
          Body measurements
        </Typography>
      ) : (
        <PageHeader title="Body measurements" />
      )}
      <MediaStatusBanner />

      <Stack spacing={2.5}>
        {/* Hero: latest weight, numbers first */}
        {latest.error ? (
          <ErrorState error={latest.error} onRetry={latest.reload} />
        ) : latest.loading && !latest.data ? (
          <LoadingState label="Loading latest…" minHeight={140} />
        ) : latest.data && !latest.data.entry ? (
          <Card>
            <EmptyState
              icon={<StraightenIcon fontSize="inherit" />}
              title="No measurements yet"
              description="Weigh in once a week, same time of day, for a reliable trend."
              action={
                <Button variant="contained" onClick={() => setDialog({ m: null })}>
                  Add your first measurement
                </Button>
              }
            />
          </Card>
        ) : latest.data ? (
          <Card sx={{ p: 2 }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  Latest weight
                </Typography>
                <Typography sx={{ fontSize: 40, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                  {weight ? (Number.isInteger(weight.value) ? weight.value : weight.value.toFixed(1)) : '—'}
                  <Typography component="span" sx={{ fontSize: 18, fontWeight: 700, color: 'text.secondary', ml: 0.5 }}>
                    kg
                  </Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {weight ? formatDay(weight.date, 'EEE d MMM') : 'No weight logged'}
                </Typography>
              </Box>
              {t?.change != null && (
                <Chip
                  label={`${signed(t.change)} kg · ${RANGES.find((r) => r.days === rangeDays)?.label}`}
                  sx={(th) => ({ fontWeight: 800, bgcolor: alpha(th.palette.primary.main, 0.12), color: 'primary.main' })}
                />
              )}
            </Stack>
            {others.length > 0 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1, mt: 2 }}>
                {others.map((m) => {
                  const v = latest.data!.metrics[m.key]!;
                  return (
                    <Box key={m.key} sx={(th) => ({ p: 1, borderRadius: '12px', bgcolor: alpha(th.palette.text.primary, 0.04), minWidth: 0 })}>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {m.label}
                      </Typography>
                      <Typography fontWeight={800} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMetric(v.value, m.unit)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Card>
        ) : null}

        {/* Weight trend */}
        <Box>
          <SectionTitle
            aside={
              <Stack direction="row" spacing={0.5} role="group" aria-label="Trend range">
                {RANGES.map((r) => (
                  <Chip
                    key={r.days}
                    label={r.label}
                    size="small"
                    onClick={() => setRangeDays(r.days)}
                    color={rangeDays === r.days ? 'primary' : 'default'}
                    variant={rangeDays === r.days ? 'filled' : 'outlined'}
                    aria-pressed={rangeDays === r.days}
                    sx={{ minWidth: 44, height: 32 }}
                  />
                ))}
              </Stack>
            }
          >
            Weight trend
          </SectionTitle>
          <Card sx={{ px: 1, pt: 2, pb: 1 }}>
            {trend.error ? (
              <ErrorState error={trend.error} onRetry={trend.reload} />
            ) : trend.loading && !t ? (
              <LoadingState label="Loading trend…" minHeight={200} />
            ) : t ? (
              <>
                <WeightTrendChart trend={t} />
                {t.average != null && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 1, pt: 0.5 }}>
                    Avg {t.average} kg · range {t.min}–{t.max} kg
                  </Typography>
                )}
              </>
            ) : null}
          </Card>
        </Box>

        {/* Entries */}
        <Box>
          <SectionTitle
            aside={
              meta ? (
                <Typography variant="caption" color="text.secondary">
                  {meta.total} total
                </Typography>
              ) : undefined
            }
          >
            Entries
          </SectionTitle>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.loading && !list.data ? (
            <LoadingState label="Loading entries…" />
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState title="No entries yet" />
            </Card>
          ) : (
            <Card>
              <List disablePadding>
                {rows.map((r, i) => {
                  const values = METRICS.filter((m) => r[m.key] != null);
                  return (
                    <ListItem
                      key={r.id}
                      disablePadding
                      divider={i < rows.length - 1}
                      secondaryAction={
                        <RowMenu
                          label={`Options for measurement from ${formatDay(r.date)}`}
                          items={[
                            { label: 'Edit', icon: <EditOutlinedIcon fontSize="small" />, onClick: () => setDialog({ m: r }) },
                            { label: 'Delete', icon: <DeleteOutlineIcon fontSize="small" />, danger: true, onClick: () => void remove(r) },
                          ]}
                        />
                      }
                    >
                      <ListItemButton onClick={() => setDialog({ m: r })} sx={{ py: 1, pr: 7 }}>
                        <ListItemAvatar sx={{ minWidth: 56 }}>
                          {r.photoMediaId ? (
                            <Box sx={{ width: 44 }}>
                              <MediaImage mediaId={r.photoMediaId} alt={`Progress photo for ${formatDay(r.date)}`} />
                            </Box>
                          ) : (
                            <Box
                              sx={(th) => ({
                                width: 44,
                                height: 44,
                                borderRadius: '12px',
                                display: 'grid',
                                placeItems: 'center',
                                color: 'primary.main',
                                bgcolor: alpha(th.palette.primary.main, 0.1),
                              })}
                            >
                              <MonitorWeightOutlinedIcon fontSize="small" />
                            </Box>
                          )}
                        </ListItemAvatar>
                        <ListItemText
                          primary={r.weightKg != null ? fmtMetric(r.weightKg, 'kg') : formatDay(r.date, 'EEE d MMM')}
                          secondary={[
                            r.weightKg != null ? formatDay(r.date, 'EEE d MMM') : null,
                            ...values.filter((m) => m.key !== 'weightKg').map((m) => `${m.label} ${fmtMetric(r[m.key], m.unit)}`),
                            !values.length ? 'Photo only' : null,
                            r.notes,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                          slotProps={{ primary: { fontWeight: 800, sx: { fontVariantNumeric: 'tabular-nums' } }, secondary: { noWrap: true } }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Card>
          )}
          {meta && meta.total > rows.length && pageSize < 100 && (
            <Button fullWidth onClick={() => setPages((p) => p + 1)} disabled={list.refreshing} sx={{ mt: 1.5, minHeight: 44 }}>
              {list.refreshing ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </Box>

        <ProgressPhotoGallery refreshKey={galleryKey} onDeleted={bump} />
      </Stack>

      <PrimaryAction icon={<AddIcon />} label="Add measurement" onClick={() => setDialog({ m: null })} />
      <FabSpacer />

      <MeasurementDialog
        open={!!dialog}
        measurement={dialog?.m ?? null}
        defaultDate={today}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          bump();
          setGalleryKey((k) => k + 1);
        }}
      />
    </Box>
  );
}
