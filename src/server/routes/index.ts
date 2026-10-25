import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import authRoutes from './auth.routes';
import settingsRoutes from './settings.routes';
import dashboardRoutes from './dashboard.routes';
import foodsRoutes from './foods.routes';
import mealsRoutes from './meals.routes';
import foodDiaryRoutes from './foodDiary.routes';
import waterRoutes from './water.routes';
import workoutsRoutes from './workouts.routes';
import routinesRoutes from './routines.routes';
import remindersRoutes from './reminders.routes';
import notificationsRoutes from './notifications.routes';
import measurementsRoutes from './measurements.routes';
import reportsRoutes from './reports.routes';
import mediaRoutes from './media.routes';
import exportRoutes from './export.routes';

export const apiRouter = Router();

// Public (handles its own auth checks).
apiRouter.use('/auth', authRoutes);

// Everything below requires a signed-in user.
apiRouter.use(requireAuth);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/foods', foodsRoutes);
apiRouter.use('/meals', mealsRoutes);
apiRouter.use('/food-diary', foodDiaryRoutes);
apiRouter.use('/water', waterRoutes);
apiRouter.use('/workouts', workoutsRoutes);
apiRouter.use('/routines', routinesRoutes);
apiRouter.use('/reminders', remindersRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/measurements', measurementsRoutes);
apiRouter.use('/reports', reportsRoutes);
apiRouter.use('/media', mediaRoutes);
apiRouter.use('/export', exportRoutes);
