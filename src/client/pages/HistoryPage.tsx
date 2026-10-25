import { useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { PageHeader } from '../components/common/PageHeader';
import { SectionTabs, usePhone } from '../components/common/mobile';
import { CalendarTab } from '../features/history/CalendarTab';
import { HistoryTable } from '../features/history/HistoryTable';
import type { HistoryKind } from '../features/reports/types';

const TABS = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'nutrition', label: 'Nutrition' },
  { value: 'diary', label: 'Diary' },
  { value: 'workouts', label: 'Workouts' },
  { value: 'water', label: 'Water' },
  { value: 'routine', label: 'Routine' },
  { value: 'reminders', label: 'Reminders' },
  { value: 'measurements', label: 'Body' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const phone = usePhone();
  const tabParam = params.get('tab');
  // Legacy `?tab=daily&date=…` links open that day's summary on the calendar.
  const legacyDaily = tabParam === 'daily' ? params.get('date') : null;
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : 'calendar';
  const openDate = params.get('day') ?? legacyDaily;

  const update = (next: Record<string, string | null>) => {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries({
      ...Object.fromEntries(params),
      ...next,
    }))
      if (v != null && k !== 'date') merged[k] = v;
    if (merged.tab === 'daily') merged.tab = 'calendar';
    setParams(merged, { replace: true });
  };

  return (
    <Box>
      <PageHeader title="History" subtitle={phone ? undefined : "Everything you've logged, day by day."} />
      <SectionTabs value={tab} onChange={(v) => update({ tab: v, day: null })} tabs={[...TABS]} ariaLabel="History sections" />
      <Box role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label}>
        {tab === 'calendar' ? <CalendarTab openDate={openDate} onOpenDate={(d) => update({ day: d })} /> : <HistoryTable key={tab} kind={tab as HistoryKind} />}
      </Box>
    </Box>
  );
}
