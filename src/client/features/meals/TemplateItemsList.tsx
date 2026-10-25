import { Box, Chip, Stack, Typography } from '@mui/material';
import { EstimateChip, fmt, formatQuantity } from '../foods/format';
import type { MealTemplate } from './types';

/** Read-only list of a template's items with ranges, optional badges and alternatives. */
export function TemplateItemsList({ template }: { template: MealTemplate }) {
  if (!template.items.length)
    return (
      <Typography variant="body2" color="text.secondary">
        No items yet.
      </Typography>
    );
  return (
    <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {template.items.map((i) => (
        <Box component="li" key={i.id}>
          <Stack direction="row" spacing={1} alignItems="baseline" justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                  {i.displayName}
                </Typography>
                {i.isOptional && <Chip label="Optional" size="small" variant="outlined" />}
                {i.food?.isEstimate && <EstimateChip />}
                {i.food?.archivedAt && <Chip label="Archived food" size="small" />}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {formatQuantity(i.quantity, i.unit, i.quantityMax)}
                {i.notes ? ` · ${i.notes}` : ''}
              </Typography>
              {i.unitError && (
                <Typography variant="body2" color="error">
                  {i.unitError}
                </Typography>
              )}
              {i.alternatives.map((a) => (
                <Typography key={a.id} variant="body2" color="text.secondary" sx={{ pl: 1.5, wordBreak: 'break-word' }}>
                  or {a.displayName} · {formatQuantity(a.quantity, a.unit, a.quantityMax)}
                </Typography>
              ))}
            </Box>
            {i.nutrition && (
              <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                {i.nutritionMax && i.nutritionMax.calories !== i.nutrition.calories
                  ? `${fmt(i.nutrition.calories, 0)}–${fmt(i.nutritionMax.calories, 0)}`
                  : fmt(i.nutrition.calories, 0)}{' '}
                kcal
              </Typography>
            )}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
