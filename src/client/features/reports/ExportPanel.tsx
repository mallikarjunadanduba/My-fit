import { useEffect, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { useFeedback } from '../../components/common/Feedback';
import { ResponsiveDialog } from '../../components/common/mobile';
import { api } from '../../services/api';
import { EXPORT_DATASETS, type ExportDataset } from './types';

const DATASET_LABELS: Record<ExportDataset, string> = {
  all: 'Everything (JSON only)',
  diary: 'Food diary',
  water: 'Water',
  workouts: 'Workouts (one row per set)',
  measurements: 'Body measurements',
  routine: 'Daily routine',
  reminders: 'Reminder history',
  targets: 'Nutrition targets',
  foods: 'Food library',
};

/** Export sheet: dataset + format + range → GET /api/export (downloaded as a file). */
export function ExportDialog({ open, onClose, defaultFrom, defaultTo }: { open: boolean; onClose: () => void; defaultFrom: string; defaultTo: string }) {
  const { notify } = useFeedback();
  const [dataset, setDataset] = useState<ExportDataset>('diary');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [busy, setBusy] = useState(false);

  // Each time the sheet opens, start from the period being viewed.
  useEffect(() => {
    if (open) {
      setFrom(defaultFrom);
      setTo(defaultTo);
    }
  }, [open, defaultFrom, defaultTo]);

  const csvAll = dataset === 'all' && format === 'csv';
  const invalid = !from || !to || from > to;

  const download = async () => {
    setBusy(true);
    try {
      await api.download('/export', { dataset, format, from, to }, `myfit-${dataset}-${from}-to-${to}.${format}`);
      notify('Export downloaded');
      onClose();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title="Export data"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" startIcon={<DownloadRoundedIcon />} onClick={download} disabled={busy || invalid || csvAll}>
            {busy ? 'Preparing…' : 'Download'}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: { sm: 1 } }}>
        <Typography variant="body2" color="text.secondary">
          A copy of your records for spreadsheets or backup. Only your own data is included.
        </Typography>
        <TextField
          select
          size="medium"
          label="Dataset"
          value={dataset}
          onChange={(e) => {
            const v = e.target.value as ExportDataset;
            setDataset(v);
            if (v === 'all') setFormat('json');
          }}
          helperText={
            dataset === 'foods'
              ? 'The food library is exported in full (not filtered by date).'
              : dataset === 'targets'
                ? 'Every target version in force up to the end date.'
                : undefined
          }
        >
          {EXPORT_DATASETS.map((d) => (
            <MenuItem key={d} value={d}>
              {DATASET_LABELS[d]}
            </MenuItem>
          ))}
        </TextField>
        <Stack direction="row" spacing={1.5}>
          <TextField type="date" size="medium" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="date" size="medium" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>
        <div>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
            File format
          </Typography>
          <ToggleButtonGroup fullWidth exclusive value={format} onChange={(_, v: 'csv' | 'json' | null) => v && setFormat(v)} aria-label="File format">
            <ToggleButton value="csv" disabled={dataset === 'all'} sx={{ minHeight: 44 }}>
              CSV
            </ToggleButton>
            <ToggleButton value="json" sx={{ minHeight: 44 }}>
              JSON
            </ToggleButton>
          </ToggleButtonGroup>
        </div>
        {invalid && <Alert severity="warning">The start date must be on or before the end date.</Alert>}
      </Stack>
    </ResponsiveDialog>
  );
}
