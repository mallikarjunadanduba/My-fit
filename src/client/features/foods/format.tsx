import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { UNIT_LABELS, type FoodUnit, type Nutrients } from '../../../shared/nutrition';
import { nutrientColors } from '../../theme/theme';

export const fmt = (n: number | null | undefined, digits = 1) => {
  if (n == null || Number.isNaN(n)) return '—';
  if (digits === 0 || Number.isInteger(n)) return Math.round(n).toLocaleString();
  return n.toFixed(digits).replace(/\.0+$/, '');
};

/** "150 g", "150–180 g", "2 pieces" */
export function formatQuantity(quantity: number, unit: FoodUnit, quantityMax?: number | null) {
  const label = UNIT_LABELS[unit];
  const plural = (unit === 'PIECE' || unit === 'SCOOP' || unit === 'SERVING') && (quantityMax ?? quantity) !== 1 ? `${label}s` : label;
  const q = quantityMax != null && quantityMax !== quantity ? `${fmt(quantity)}–${fmt(quantityMax)}` : fmt(quantity);
  return `${q} ${plural}`;
}

export function servingText(f: { servingSize: number; servingUnit: FoodUnit; servingLabel: string | null }) {
  const base = formatQuantity(f.servingSize, f.servingUnit);
  if (!f.servingLabel) return base;
  // Labels often already state the amount ("1 cup (240 ml)", "1 whole almond (≈1.2 g)"); don't repeat it.
  const label = f.servingLabel.toLowerCase().replace(/\s+/g, '');
  const amount = base.toLowerCase().replace(/\s+/g, '');
  const unitWord = base.split(' ').slice(1).join(' ').toLowerCase();
  const redundant = label.includes(amount) || label.includes(`(${amount})`) || /\(|≈/.test(f.servingLabel) || (unitWord && label.includes(unitWord));
  return redundant ? f.servingLabel : `${f.servingLabel} (${base})`;
}

export const MACRO_LABELS: {
  key: keyof Nutrients;
  label: string;
  short: string;
  unit: string;
}[] = [
  { key: 'calories', label: 'Calories', short: 'kcal', unit: 'kcal' },
  { key: 'protein', label: 'Protein', short: 'P', unit: 'g' },
  { key: 'carbs', label: 'Carbs', short: 'C', unit: 'g' },
  { key: 'fat', label: 'Fat', short: 'F', unit: 'g' },
  { key: 'fiber', label: 'Fiber', short: 'Fib', unit: 'g' },
];

/** Compact "250 kcal · P 20 · C 30 · F 8 · Fib 4" line, optionally showing a max range. */
export function MacroLine({ n, max, dense }: { n: Nutrients; max?: Nutrients | null; dense?: boolean }) {
  const range = (k: keyof Nutrients) => (max && max[k] !== n[k] ? `${fmt(n[k])}–${fmt(max[k])}` : fmt(n[k]));
  return (
    <Stack direction="row" spacing={dense ? 1 : 1.5} flexWrap="wrap" useFlexGap component="span" sx={{ alignItems: 'baseline' }}>
      <Typography component="span" variant="body2" fontWeight={700} sx={{ color: nutrientColors.calories }}>
        {range('calories')} kcal
      </Typography>
      {(['protein', 'carbs', 'fat', 'fiber'] as const).map((k) => (
        <Typography key={k} component="span" variant="body2" color="text.secondary">
          <Box component="span" sx={{ color: nutrientColors[k], fontWeight: 700 }}>
            {MACRO_LABELS.find((m) => m.key === k)!.short}
          </Box>{' '}
          {range(k)}g
        </Typography>
      ))}
    </Stack>
  );
}

export function EstimateChip({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <Tooltip title="Nutrition values are an estimate, not from a label">
      <Chip label="Estimate" size="small" color="warning" variant="outlined" sx={{ height: 22 }} />
    </Tooltip>
  );
}
