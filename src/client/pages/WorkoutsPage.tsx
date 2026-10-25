import { useRef, type TouchEvent as ReactTouchEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { PageHeader } from '../components/common/PageHeader';
import { SectionTabs, usePhone, visuallyHiddenSx } from '../components/common/mobile';
import { TodayTab } from '../features/workouts/TodayTab';
import { WeekTab } from '../features/workouts/WeekTab';
import { PlansTab } from '../features/workouts/PlansTab';
import { ExerciseLibraryTab } from '../features/workouts/ExerciseLibraryTab';
import { HistoryTab } from '../features/workouts/HistoryTab';
import { RecordsTab } from '../features/workouts/RecordsTab';

const TABS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'plans', label: 'Plans' },
  { value: 'exercises', label: 'Exercises' },
  { value: 'history', label: 'History' },
  { value: 'records', label: 'Records' },
] as const;
type TabId = (typeof TABS)[number]['value'];
const LEGACY: Record<string, TabId> = { consistency: 'week' };

/** Horizontal swipe on the tab content switches tabs (ignores inputs, sliders and horizontal scrollers). */
function useSwipeTabs(tab: TabId, go: (t: TabId) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: ReactTouchEvent) => {
    const target = e.target as HTMLElement;
    if (e.touches.length !== 1 || target.closest('input, textarea, [role="slider"], .recharts-wrapper, [data-no-swipe]')) {
      start.current = null;
      return;
    }
    // Let horizontally scrollable rows (chip filters) scroll instead.
    for (let el: HTMLElement | null = target; el && el !== e.currentTarget; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).overflowX !== 'hidden') {
        start.current = null;
        return;
      }
    }
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - s.t > 600) return;
    const i = TABS.findIndex((x) => x.value === tab);
    const next = TABS[i + (dx < 0 ? 1 : -1)];
    if (next) go(next.value);
  };
  return { onTouchStart, onTouchEnd };
}

export default function WorkoutsPage() {
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? '';
  const tab: TabId = TABS.some((t) => t.value === raw) ? (raw as TabId) : (LEGACY[raw] ?? 'today');
  const go = (id: TabId) => {
    setParams(id === 'today' ? {} : { tab: id }, { replace: true });
    window.scrollTo({ top: 0 });
  };
  const swipe = useSwipeTabs(tab, go);

  return (
    <Box>
      {phone ? (
        <Typography component="h1" sx={visuallyHiddenSx}>
          Workouts
        </Typography>
      ) : (
        <PageHeader title="Workouts" />
      )}
      <SectionTabs value={tab} onChange={go} tabs={[...TABS]} ariaLabel="Workout sections" />
      <Box role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} {...swipe} sx={{ minHeight: '50vh' }}>
        {tab === 'today' && <TodayTab onGoToPlans={() => go('plans')} />}
        {tab === 'week' && <WeekTab onOpenPlans={() => go('plans')} />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'exercises' && <ExerciseLibraryTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'records' && <RecordsTab />}
      </Box>
    </Box>
  );
}
