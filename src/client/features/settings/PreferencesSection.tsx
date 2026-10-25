import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  ButtonBase,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import PaletteRoundedIcon from '@mui/icons-material/PaletteRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import SnoozeRoundedIcon from '@mui/icons-material/SnoozeRounded';
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { api, toApiError } from '../../services/api';
import { WEEKDAYS_SHORT } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { ResponsiveDialog } from '../../components/common/mobile';
import { TimezoneSelect } from './TimezoneSelect';
import { apiErrorMessage } from './formUtils';
import { RowIcon, SettingsGroup } from './SettingsGroup';
import type { ThemeMode, UserSettingsView } from './types';

const SNOOZE_OPTIONS = [5, 10, 15, 20, 30, 45, 60];
// Monday-first display order.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'SYSTEM', label: 'System' },
  { value: 'LIGHT', label: 'Light' },
  { value: 'DARK', label: 'Dark' },
];

type Patch = Partial<Pick<UserSettingsView, 'timezone' | 'theme' | 'gymWeekdays' | 'defaultSnoozeMinutes'>>;

const selectSx = {
  minWidth: 0,
  fontWeight: 600,
  color: 'text.secondary',
  '& .MuiSelect-select': { py: 1, pr: '28px !important', pl: 1, textAlign: 'right' },
  '& fieldset': { border: 'none' },
};

/** Preferences as native settings rows; every change is saved immediately (optimistic). */
export function PreferencesSection({ settings, onSaved }: { settings: UserSettingsView; onSaved: (s: UserSettingsView) => void }) {
  const { refresh } = useAuth();
  const { notify } = useFeedback();
  const [local, setLocal] = useState(settings);
  const [tzOpen, setTzOpen] = useState(false);
  const [tzDraft, setTzDraft] = useState(settings.timezone);

  useEffect(() => setLocal(settings), [settings]);

  const save = async (patch: Patch): Promise<boolean> => {
    const prev = local;
    setLocal((cur) => ({ ...cur, ...patch }));
    try {
      const next = await api.patch<UserSettingsView>('/settings', patch);
      onSaved({ ...settings, ...next });
      // Theme / timezone / gym days are used app-wide (AuthContext).
      void refresh();
      return true;
    } catch (e) {
      setLocal(prev);
      notify(apiErrorMessage(toApiError(e)), 'error');
      return false;
    }
  };

  const toggleDay = (d: number) => {
    const next = local.gymWeekdays.includes(d) ? local.gymWeekdays.filter((x) => x !== d) : [...local.gymWeekdays, d];
    void save({ gymWeekdays: next.sort((a, b) => a - b) });
  };

  const restDays = WEEK_ORDER.filter((d) => !local.gymWeekdays.includes(d)).map((d) => WEEKDAYS_SHORT[d]);

  return (
    <>
      <SettingsGroup title="Appearance & time" footer="Timezone decides what “today” means for logs, reminders and reports.">
        <List disablePadding>
          <ListItem sx={{ minHeight: 60 }} secondaryAction={
            <Select
              size="small"
              value={local.theme}
              onChange={(e) => void save({ theme: e.target.value as ThemeMode })}
              inputProps={{ 'aria-label': 'Theme' }}
              sx={selectSx}
            >
              {THEMES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          }>
            <ListItemIcon sx={{ minWidth: 52 }}>
              <RowIcon color="#8B5CF6">
                <PaletteRoundedIcon />
              </RowIcon>
            </ListItemIcon>
            <ListItemText primary="Theme" slotProps={{ primary: { fontWeight: 600 } }} />
          </ListItem>
          <Divider component="li" variant="inset" />
          <ListItemButton
            sx={{ minHeight: 60 }}
            onClick={() => {
              setTzDraft(local.timezone);
              setTzOpen(true);
            }}
          >
            <ListItemIcon sx={{ minWidth: 52 }}>
              <RowIcon color="#0EA5E9">
                <PublicRoundedIcon />
              </RowIcon>
            </ListItemIcon>
            <ListItemText
              primary="Timezone"
              secondary={local.timezone.replace(/_/g, ' ')}
              slotProps={{ primary: { fontWeight: 600 }, secondary: { noWrap: true } }}
            />
            <ChevronRightRoundedIcon sx={{ color: 'text.disabled', ml: 0.5, mr: -0.5 }} />
          </ListItemButton>
        </List>
      </SettingsGroup>

      <SettingsGroup
        title="Training week"
        footer={
          restDays.length
            ? `Rest days: ${restDays.join(', ')}. You can still switch a single day between gym and rest from the dashboard or diary.`
            : 'Every day is a gym day. Tap a day to make it a rest day.'
        }
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
            <RowIcon color="#00AFB5">
              <FitnessCenterRoundedIcon />
            </RowIcon>
            <Box>
              <Typography fontWeight={600}>Gym days</Typography>
              <Typography variant="body2" color="text.secondary">
                {local.gymWeekdays.length} {local.gymWeekdays.length === 1 ? 'day' : 'days'} a week
              </Typography>
            </Box>
          </Stack>
          <Box role="group" aria-label="Gym weekdays" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75 }}>
            {WEEK_ORDER.map((d) => {
              const on = local.gymWeekdays.includes(d);
              return (
                <ButtonBase
                  key={d}
                  aria-pressed={on}
                  aria-label={`${WEEKDAYS_SHORT[d]} ${on ? 'gym day' : 'rest day'}`}
                  onClick={() => toggleDay(d)}
                  sx={(t) => ({
                    height: 44,
                    borderRadius: 3,
                    fontWeight: 700,
                    fontSize: 13,
                    border: 1,
                    borderColor: on ? 'primary.main' : 'divider',
                    bgcolor: on ? 'primary.main' : alpha(t.palette.text.primary, 0.03),
                    color: on ? 'primary.contrastText' : 'text.secondary',
                    transition: 'background-color 150ms ease, color 150ms ease',
                  })}
                >
                  {WEEKDAYS_SHORT[d].slice(0, 3)}
                </ButtonBase>
              );
            })}
          </Box>
        </Box>
      </SettingsGroup>

      <SettingsGroup title="Reminders" footer="Snooze length is used for new reminders and routine items.">
        <List disablePadding>
          <ListItem sx={{ minHeight: 60 }} secondaryAction={
            <Select
              size="small"
              value={local.defaultSnoozeMinutes}
              onChange={(e) => void save({ defaultSnoozeMinutes: Number(e.target.value) })}
              inputProps={{ 'aria-label': 'Default snooze' }}
              sx={selectSx}
            >
              {(SNOOZE_OPTIONS.includes(local.defaultSnoozeMinutes) ? SNOOZE_OPTIONS : [local.defaultSnoozeMinutes, ...SNOOZE_OPTIONS]).map((m) => (
                <MenuItem key={m} value={m}>
                  {m} min
                </MenuItem>
              ))}
            </Select>
          }>
            <ListItemIcon sx={{ minWidth: 52 }}>
              <RowIcon color="#F59E0B">
                <SnoozeRoundedIcon />
              </RowIcon>
            </ListItemIcon>
            <ListItemText primary="Default snooze" slotProps={{ primary: { fontWeight: 600 } }} />
          </ListItem>
          <Divider component="li" variant="inset" />
          <ListItemButton component={RouterLink} to="/alarms" sx={{ minHeight: 60 }}>
            <ListItemIcon sx={{ minWidth: 52 }}>
              <RowIcon color="#EC4899">
                <NotificationsActiveRoundedIcon />
              </RowIcon>
            </ListItemIcon>
            <ListItemText
              primary="Notifications & sounds"
              secondary="Managed on the Alarms page"
              slotProps={{ primary: { fontWeight: 600 }, secondary: { noWrap: true } }}
            />
            <ChevronRightRoundedIcon sx={{ color: 'text.disabled', mr: -0.5 }} />
          </ListItemButton>
        </List>
      </SettingsGroup>

      <ResponsiveDialog
        open={tzOpen}
        onClose={() => setTzOpen(false)}
        title="Timezone"
        actions={
          <>
            <Button onClick={() => setTzOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={tzDraft === local.timezone}
              onClick={() => {
                setTzOpen(false);
                void save({ timezone: tzDraft }).then((ok) => ok && notify('Timezone updated'));
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Box sx={{ pt: 1 }}>
          <TimezoneSelect
            value={tzDraft}
            onChange={setTzDraft}
            size="medium"
            helperText="Decides what “today” means for logs, reminders and reports. Past days keep the timezone they were logged in."
          />
        </Box>
      </ResponsiveDialog>
    </>
  );
}
