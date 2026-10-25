import { useEffect, useState } from 'react';
import { Alert, Button, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { api } from '../../services/api';
import { useFeedback } from '../../components/common/Feedback';
import { fmt } from '../foods/format';
import { errorMessage } from '../foods/formHelpers';
import { TAP } from '../foods/mobile';
import { DAY_TYPE_LABELS, type DayType, type MealSlot, type MealTemplate } from './types';
import { ResponsiveDialog } from '../../components/common/mobile';

/** Pick which template is the plan for a slot on a day type (PUT /api/meals/plan/:slotId). */
export function ChoosePlanDialog({
  open,
  slot,
  dayType,
  currentId,
  templates,
  onClose,
  onSaved,
  onCreate,
}: {
  open: boolean;
  slot: MealSlot | null;
  dayType: DayType;
  currentId: string | null;
  templates: MealTemplate[];
  onClose: () => void;
  onSaved: () => void;
  onCreate: () => void;
}) {
  const { notify } = useFeedback();
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChoice(currentId ?? '');
      setError(null);
    }
  }, [open, currentId]);

  // Templates for this slot first, then the rest.
  const sorted = [...templates.filter((t) => !t.archivedAt)].sort(
    (a, b) => Number(b.slotId === slot?.id) - Number(a.slotId === slot?.id) || a.name.localeCompare(b.name),
  );

  const save = async (templateId: string | null) => {
    if (!slot) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/meals/plan/${slot.id}`, { templateId, dayType });
      notify(templateId ? `${slot.name} plan updated for ${DAY_TYPE_LABELS[dayType].toLowerCase()}s` : `${slot.name} plan cleared`);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={saving ? () => undefined : onClose}
      maxWidth="xs"
      title={
        <>
          {slot?.name} · {DAY_TYPE_LABELS[dayType]}
        </>
      }
      actions={
        <>
          <Button onClick={onCreate} disabled={saving} sx={TAP}>
            New meal
          </Button>
          {currentId && (
            <Button color="error" onClick={() => save(null)} disabled={saving} sx={TAP}>
              Clear plan
            </Button>
          )}
          <Button variant="contained" onClick={() => save(choice)} disabled={saving || !choice || choice === currentId} sx={TAP}>
            Use as plan
          </Button>
        </>
      }
    >
      {sorted.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No meal templates yet. Create one first.
        </Typography>
      ) : (
        <RadioGroup value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Meal template">
          {sorted.map((t) => (
            <FormControlLabel
              key={t.id}
              value={t.id}
              control={<Radio />}
              sx={{
                py: 0.5,
                alignItems: 'flex-start',
                '& .MuiRadio-root': { mt: -0.5 },
              }}
              label={
                <Stack>
                  <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>
                    {t.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {DAY_TYPE_LABELS[t.dayType]} · {t.items.length} item
                    {t.items.length === 1 ? '' : 's'} · ~{fmt(t.planned.min.calories, 0)} kcal
                    {t.slotId && t.slotId !== slot?.id ? ' · other slot' : ''}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        A template already used as another day type&apos;s plan is copied so both plans stay intact.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </ResponsiveDialog>
  );
}
