import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Avatar, Box, Card, CardContent, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AlarmRoundedIcon from '@mui/icons-material/AlarmRounded';
import AlarmOffRoundedIcon from '@mui/icons-material/AlarmOffRounded';
import { api } from '../services/api';
import { formatInstant } from '../services/dates';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../features/auth/AuthContext';
import { PageHeader } from '../components/common/PageHeader';
import { FabSpacer, PrimaryAction, SectionTabs, usePhone } from '../components/common/mobile';
import { EmptyState, ErrorState, LoadingState } from '../components/common/States';
import { countOverdue, useAlarms } from '../features/alarms/AlarmProvider';
import { NotificationStatusCard } from '../features/alarms/NotificationStatusCard';
import { ReminderList } from '../features/alarms/ReminderList';
import { ReminderFormDialog } from '../features/alarms/ReminderFormDialog';
import { OverdueSection } from '../features/alarms/OverdueSection';
import { HistoryTab } from '../features/alarms/HistoryTab';
import { DevicesTab } from '../features/alarms/DevicesTab';
import { CATEGORY_META, CategoryIcon } from '../features/alarms/categories';
import { clockParts } from '../features/alarms/format';
import { formatCountdown } from '../features/alarms/schedule';
import type { Reminder } from '../features/alarms/types';

const TABS = ['reminders', 'overdue', 'history', 'devices'] as const;
type TabKey = (typeof TABS)[number];

/** Hero: next alarm time (big) with a live countdown. */
function NextAlarmHero({ timezone }: { timezone: string }) {
  const { nextReminder } = useAlarms();
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!nextReminder?.nextTriggerAt) {
    return (
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ bgcolor: 'action.selected', color: 'text.secondary' }}>
              <AlarmOffRoundedIcon />
            </Avatar>
            <Box>
              <Typography fontWeight={700}>No upcoming alarms</Typography>
              <Typography variant="body2" color="text.secondary">
                Add a reminder or turn one back on.
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    );
  }
  const meta = CATEGORY_META[nextReminder.category];
  const at = nextReminder.nextTriggerAt;
  const { time, suffix } = clockParts(formatInstant(at, timezone, 'HH:mm'));
  const msLeft = new Date(at).getTime() - Date.now();
  // Fill the bar over the last 12 hours before the alarm.
  const fill = Math.max(0, Math.min(100, 100 - (msLeft / (12 * 3600_000)) * 100));
  return (
    <Card
      component="section"
      aria-label="Next alarm"
      sx={{ background: (t) => `linear-gradient(135deg, ${meta.color}${t.palette.mode === 'dark' ? '33' : '22'}, ${t.palette.background.paper} 70%)` }}
    >
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            Next alarm
          </Typography>
          <Chip size="small" color="primary" label={formatCountdown(at)} sx={{ fontVariantNumeric: 'tabular-nums' }} />
        </Stack>
        <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.25 }}>
          <Typography component="p" sx={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
            {time}
          </Typography>
          <Typography component="span" sx={{ fontSize: 20, fontWeight: 700 }} color="text.secondary">
            {suffix}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, minWidth: 0 }}>
          <Box sx={{ color: meta.color, display: 'flex', flexShrink: 0 }}>
            <CategoryIcon category={nextReminder.category} />
          </Box>
          <Typography fontWeight={700} noWrap sx={{ minWidth: 0 }}>
            {nextReminder.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
            · {formatInstant(at, timezone, 'EEE d MMM')}
          </Typography>
        </Stack>
        <LinearProgress variant="determinate" value={fill} sx={{ mt: 1.5, height: 4 }} aria-hidden />
      </CardContent>
    </Card>
  );
}

export default function AlarmsPage() {
  const { timezone } = useAuth();
  const phone = usePhone();
  const { refresh: refreshAlarms, overdue } = useAlarms();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.includes(params.get('tab') as TabKey) ? (params.get('tab') as TabKey) : 'reminders';
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [devicesVersion, setDevicesVersion] = useState(0);
  const overdueCount = countOverdue(overdue);

  const { data: reminders, setData, error, loading, reload } = useAsync(() => api.get<Reminder[]>('/reminders'), []);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const upsert = (r: Reminder) => {
    setData((list) => {
      const rest = (list ?? []).filter((x) => x.id !== r.id);
      return [...rest, r].sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
    });
    void refreshAlarms();
  };

  const newReminder = <PrimaryAction icon={<AddRoundedIcon />} label="New reminder" onClick={openNew} />;

  return (
    <Box>
      <PageHeader title="Alarms & Reminders" actions={phone ? undefined : newReminder} />
      <Stack spacing={2}>
        <NextAlarmHero timezone={timezone} />
        <NotificationStatusCard onDevicesChanged={() => setDevicesVersion((v) => v + 1)} />
      </Stack>
      <Box sx={{ mt: 2 }}>
        <SectionTabs
          value={tab}
          onChange={(v) => setParams(v === 'reminders' ? {} : { tab: v }, { replace: true })}
          ariaLabel="Alarms sections"
          tabs={[
            { value: 'reminders', label: 'Reminders' },
            {
              value: 'overdue',
              label: 'Overdue',
              // Count bubble positioned over the tab's corner so the label never wraps at 360–390px.
              icon: overdueCount ? (
                <Box
                  component="span"
                  aria-label={`${overdueCount} overdue`}
                  sx={{ position: 'absolute', top: 4, right: 2, minWidth: 20, height: 20, px: 0.5, borderRadius: 10, bgcolor: 'warning.main', color: '#fff', fontSize: 12, fontWeight: 800, lineHeight: '20px', textAlign: 'center', m: '0 !important' }}
                >
                  {overdueCount > 99 ? '99+' : overdueCount}
                </Box>
              ) : undefined,
            },
            { value: 'history', label: 'History' },
            { value: 'devices', label: 'Devices' },
          ]}
        />
      </Box>

      {tab === 'reminders' &&
        (loading ? (
          <LoadingState />
        ) : error && !reminders ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !reminders || reminders.length === 0 ? (
          <Card>
            <EmptyState
              icon={<AlarmRoundedIcon fontSize="inherit" />}
              title="No reminders yet"
              description="Wake-up, meals, water, gym and bedtime. Routine items with a reminder appear here too."
            />
          </Card>
        ) : (
          <ReminderList
            reminders={reminders}
            timezone={timezone}
            onEdit={(r) => {
              setEditing(r);
              setFormOpen(true);
            }}
            onChanged={upsert}
            onReplaceAll={(list) => setData(list)}
            onDeleted={(id) => {
              setData((list) => (list ?? []).filter((x) => x.id !== id));
              void refreshAlarms();
            }}
          />
        ))}
      {tab === 'overdue' && <OverdueSection timezone={timezone} />}
      {tab === 'history' && <HistoryTab timezone={timezone} />}
      {tab === 'devices' && <DevicesTab timezone={timezone} version={devicesVersion} />}

      <ReminderFormDialog
        open={formOpen}
        reminder={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(r) => {
          setFormOpen(false);
          upsert(r);
        }}
      />
      {phone && newReminder}
      <FabSpacer />
    </Box>
  );
}
