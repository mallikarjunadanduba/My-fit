import type { ReactElement } from 'react';
import WbSunnyRoundedIcon from '@mui/icons-material/WbSunnyRounded';
import LocalDrinkRoundedIcon from '@mui/icons-material/LocalDrinkRounded';
import FreeBreakfastRoundedIcon from '@mui/icons-material/FreeBreakfastRounded';
import AppleIcon from '@mui/icons-material/Apple';
import LunchDiningRoundedIcon from '@mui/icons-material/LunchDiningRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import SportsGymnasticsRoundedIcon from '@mui/icons-material/SportsGymnasticsRounded';
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded';
import DinnerDiningRoundedIcon from '@mui/icons-material/DinnerDiningRounded';
import NightsStayRoundedIcon from '@mui/icons-material/NightsStayRounded';
import BedtimeRoundedIcon from '@mui/icons-material/BedtimeRounded';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import type { ActivityCategory } from './types';

interface CategoryMeta {
  label: string;
  color: string;
  Icon: (props: { fontSize?: 'small' | 'medium' | 'inherit' }) => ReactElement;
}

/** Display order follows a typical day. */
export const CATEGORY_META: Record<ActivityCategory, CategoryMeta> = {
  WAKE_UP: { label: 'Wake up', color: '#F59E0B', Icon: (p) => <WbSunnyRoundedIcon {...p} /> },
  MORNING_WATER: { label: 'Morning water', color: '#0EA5E9', Icon: (p) => <LocalDrinkRoundedIcon {...p} /> },
  BREAKFAST: { label: 'Breakfast', color: '#F97316', Icon: (p) => <FreeBreakfastRoundedIcon {...p} /> },
  MID_MORNING: { label: 'Mid-morning', color: '#84CC16', Icon: (p) => <AppleIcon {...p} /> },
  LUNCH: { label: 'Lunch', color: '#EAB308', Icon: (p) => <LunchDiningRoundedIcon {...p} /> },
  PRE_WORKOUT: { label: 'Pre-workout', color: '#A855F7', Icon: (p) => <BoltRoundedIcon {...p} /> },
  GYM: { label: 'Gym', color: '#00AFB5', Icon: (p) => <FitnessCenterRoundedIcon {...p} /> },
  POST_WORKOUT: { label: 'Post-workout', color: '#6366F1', Icon: (p) => <SportsGymnasticsRoundedIcon {...p} /> },
  WATER: { label: 'Water', color: '#0EA5E9', Icon: (p) => <WaterDropRoundedIcon {...p} /> },
  DINNER: { label: 'Dinner', color: '#EC4899', Icon: (p) => <DinnerDiningRoundedIcon {...p} /> },
  BEFORE_BED: { label: 'Before bed', color: '#8B5CF6', Icon: (p) => <NightsStayRoundedIcon {...p} /> },
  BEDTIME: { label: 'Bedtime', color: '#475569', Icon: (p) => <BedtimeRoundedIcon {...p} /> },
  CUSTOM: { label: 'Custom', color: '#64748B', Icon: (p) => <NotificationsRoundedIcon {...p} /> },
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_META) as ActivityCategory[];

export function CategoryIcon({ category, fontSize = 'small' }: { category: ActivityCategory; fontSize?: 'small' | 'medium' | 'inherit' }) {
  const { Icon } = CATEGORY_META[category] ?? CATEGORY_META.CUSTOM;
  return <Icon fontSize={fontSize} />;
}
