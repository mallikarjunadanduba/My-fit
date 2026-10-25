-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('ANY', 'GYM', 'REST');

-- CreateEnum
CREATE TYPE "FoodUnit" AS ENUM ('G', 'ML', 'PIECE', 'SCOOP', 'SERVING');

-- CreateEnum
CREATE TYPE "FoodSource" AS ENUM ('SEED', 'CUSTOM', 'LABEL');

-- CreateEnum
CREATE TYPE "MealStatus" AS ENUM ('PENDING', 'COMPLETED', 'PARTIAL', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('STRENGTH', 'CARDIO', 'MOBILITY', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkoutSessionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('WAKE_UP', 'MORNING_WATER', 'BREAKFAST', 'MID_MORNING', 'LUNCH', 'PRE_WORKOUT', 'GYM', 'POST_WORKOUT', 'WATER', 'DINNER', 'BEFORE_BED', 'BEDTIME', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RoutineStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'MISSED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('PENDING', 'SENT', 'COMPLETED', 'DISMISSED', 'SNOOZED', 'MISSED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('WEB_PUSH', 'IN_APP', 'TEST');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED', 'EXPIRED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PROGRESS_PHOTO', 'WORKOUT_REFERENCE', 'FOOD_REFERENCE', 'PROFILE', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'DELETED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "theme" "ThemeMode" NOT NULL DEFAULT 'SYSTEM',
    "gymWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "defaultSnoozeMinutes" INTEGER NOT NULL DEFAULT 10,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "profileMediaId" UUID,
    "defaultsSeededAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionTarget" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "caloriesMin" DOUBLE PRECISION,
    "caloriesMax" DOUBLE PRECISION,
    "protein" DOUBLE PRECISION NOT NULL,
    "proteinMin" DOUBLE PRECISION,
    "proteinMax" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION NOT NULL,
    "carbsMin" DOUBLE PRECISION,
    "carbsMax" DOUBLE PRECISION,
    "fat" DOUBLE PRECISION NOT NULL,
    "fatMin" DOUBLE PRECISION,
    "fatMax" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION NOT NULL,
    "fiberMin" DOUBLE PRECISION,
    "fiberMax" DOUBLE PRECISION,
    "waterMl" INTEGER NOT NULL,
    "waterMinMl" INTEGER,
    "waterMaxMl" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NutritionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "dayType" "DayType",
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodCategory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FoodCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItem" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "preparation" TEXT,
    "notes" TEXT,
    "servingSize" DOUBLE PRECISION NOT NULL,
    "servingUnit" "FoodUnit" NOT NULL,
    "servingLabel" TEXT,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "source" "FoodSource" NOT NULL DEFAULT 'CUSTOM',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "imageMediaId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodItemCategory" (
    "foodId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "FoodItemCategory_pkey" PRIMARY KEY ("foodId","categoryId")
);

-- CreateTable
CREATE TABLE "MealSlot" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" "ActivityCategory" NOT NULL DEFAULT 'CUSTOM',
    "name" TEXT NOT NULL,
    "defaultTime" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MealSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealTemplate" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slotId" UUID,
    "name" TEXT NOT NULL,
    "dayType" "DayType" NOT NULL DEFAULT 'ANY',
    "isPlan" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "preparation" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MealTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealTemplateItem" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "foodId" UUID,
    "customName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "quantityMax" DOUBLE PRECISION,
    "unit" "FoodUnit" NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "alternativeOfId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MealTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodDiaryEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slotId" UUID,
    "foodId" UUID,
    "templateItemId" UUID,
    "foodName" TEXT NOT NULL,
    "brand" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" "FoodUnit" NOT NULL,
    "basisServingSize" DOUBLE PRECISION NOT NULL,
    "basisServingUnit" "FoodUnit" NOT NULL,
    "basisCalories" DOUBLE PRECISION NOT NULL,
    "basisProtein" DOUBLE PRECISION NOT NULL,
    "basisCarbs" DOUBLE PRECISION NOT NULL,
    "basisFat" DOUBLE PRECISION NOT NULL,
    "basisFiber" DOUBLE PRECISION NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "consumedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FoodDiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMealStatus" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slotId" UUID NOT NULL,
    "templateId" UUID,
    "status" "MealStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyMealStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaterEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amountMl" INTEGER NOT NULL,
    "loggedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WaterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ExerciseType" NOT NULL DEFAULT 'STRENGTH',
    "muscleGroup" TEXT,
    "equipment" TEXT,
    "notes" TEXT,
    "imageMediaId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPlan" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutDay" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "weekday" INTEGER,
    "name" TEXT NOT NULL,
    "isRestDay" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutDayExercise" (
    "id" UUID NOT NULL,
    "workoutDayId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "targetSets" INTEGER,
    "targetReps" TEXT,
    "targetWeightKg" DOUBLE PRECISION,
    "targetDurationSec" INTEGER,
    "restSec" INTEGER DEFAULT 90,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutDayExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "workoutDayId" UUID,
    "name" TEXT NOT NULL,
    "status" "WorkoutSessionStatus" NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExerciseEntry" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "exerciseId" UUID,
    "exerciseName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "restSec" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutExerciseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "reps" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "durationSec" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "waistCm" DOUBLE PRECISION,
    "chestCm" DOUBLE PRECISION,
    "hipsCm" DOUBLE PRECISION,
    "armCm" DOUBLE PRECISION,
    "thighCm" DOUBLE PRECISION,
    "notes" TEXT,
    "photoMediaId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineTemplate" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dayType" "DayType" NOT NULL DEFAULT 'ANY',
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoutineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineItem" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ActivityCategory" NOT NULL DEFAULT 'CUSTOM',
    "time" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "snoozeMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoutineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRoutineEntry" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "routineItemId" UUID,
    "title" TEXT NOT NULL,
    "category" "ActivityCategory" NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "RoutineStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),
    "snoozedUntil" TIMESTAMPTZ(3),
    "skipReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyRoutineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "ActivityCategory" NOT NULL DEFAULT 'CUSTOM',
    "time" TEXT NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "oneTimeDate" DATE,
    "dayType" "DayType" NOT NULL DEFAULT 'ANY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "snoozeMinutes" INTEGER NOT NULL DEFAULT 10,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMPTZ(3),
    "nextTriggerAt" TIMESTAMPTZ(3),
    "routineItemId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderOccurrence" (
    "id" UUID NOT NULL,
    "reminderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "firedAt" TIMESTAMPTZ(3),
    "actedAt" TIMESTAMPTZ(3),
    "snoozedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReminderOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDeliveryLog" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reminderId" UUID,
    "occurrenceId" UUID,
    "subscriptionId" UUID,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "takenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NutritionTarget_userId_effectiveFrom_key" ON "NutritionTarget"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_userId_date_key" ON "DailyLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FoodCategory_userId_slug_key" ON "FoodCategory"("userId", "slug");

-- CreateIndex
CREATE INDEX "FoodItem_userId_name_idx" ON "FoodItem"("userId", "name");

-- CreateIndex
CREATE INDEX "FoodItem_userId_archivedAt_idx" ON "FoodItem"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "FoodItemCategory_categoryId_idx" ON "FoodItemCategory"("categoryId");

-- CreateIndex
CREATE INDEX "MealSlot_userId_sortOrder_idx" ON "MealSlot"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "MealTemplate_userId_slotId_dayType_idx" ON "MealTemplate"("userId", "slotId", "dayType");

-- CreateIndex
CREATE INDEX "MealTemplateItem_templateId_idx" ON "MealTemplateItem"("templateId");

-- CreateIndex
CREATE INDEX "FoodDiaryEntry_userId_date_idx" ON "FoodDiaryEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "FoodDiaryEntry_userId_slotId_date_idx" ON "FoodDiaryEntry"("userId", "slotId", "date");

-- CreateIndex
CREATE INDEX "DailyMealStatus_userId_date_idx" ON "DailyMealStatus"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMealStatus_userId_date_slotId_key" ON "DailyMealStatus"("userId", "date", "slotId");

-- CreateIndex
CREATE INDEX "WaterEntry_userId_date_idx" ON "WaterEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_userId_name_key" ON "Exercise"("userId", "name");

-- CreateIndex
CREATE INDEX "WorkoutPlan_userId_idx" ON "WorkoutPlan"("userId");

-- CreateIndex
CREATE INDEX "WorkoutDay_planId_weekday_idx" ON "WorkoutDay"("planId", "weekday");

-- CreateIndex
CREATE INDEX "WorkoutDayExercise_workoutDayId_idx" ON "WorkoutDayExercise"("workoutDayId");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_date_idx" ON "WorkoutSession"("userId", "date");

-- CreateIndex
CREATE INDEX "WorkoutExerciseEntry_sessionId_idx" ON "WorkoutExerciseEntry"("sessionId");

-- CreateIndex
CREATE INDEX "WorkoutExerciseEntry_exerciseId_idx" ON "WorkoutExerciseEntry"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSet_entryId_setNumber_key" ON "WorkoutSet"("entryId", "setNumber");

-- CreateIndex
CREATE INDEX "BodyMeasurement_userId_date_idx" ON "BodyMeasurement"("userId", "date");

-- CreateIndex
CREATE INDEX "RoutineTemplate_userId_idx" ON "RoutineTemplate"("userId");

-- CreateIndex
CREATE INDEX "RoutineItem_templateId_sortOrder_idx" ON "RoutineItem"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "DailyRoutineEntry_userId_date_idx" ON "DailyRoutineEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRoutineEntry_userId_date_routineItemId_key" ON "DailyRoutineEntry"("userId", "date", "routineItemId");

-- CreateIndex
CREATE INDEX "Reminder_enabled_nextTriggerAt_idx" ON "Reminder"("enabled", "nextTriggerAt");

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "Reminder"("userId");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_userId_scheduledFor_idx" ON "ReminderOccurrence"("userId", "scheduledFor");

-- CreateIndex
CREATE INDEX "ReminderOccurrence_status_snoozedUntil_idx" ON "ReminderOccurrence"("status", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderOccurrence_reminderId_scheduledFor_key" ON "ReminderOccurrence"("reminderId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_userId_createdAt_idx" ON "NotificationDeliveryLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDeliveryLog_occurrenceId_subscriptionId_channel_key" ON "NotificationDeliveryLog"("occurrenceId", "subscriptionId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");

-- CreateIndex
CREATE INDEX "MediaAsset_userId_kind_createdAt_idx" ON "MediaAsset"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_status_createdAt_idx" ON "MediaAsset"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionTarget" ADD CONSTRAINT "NutritionTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodCategory" ADD CONSTRAINT "FoodCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItem" ADD CONSTRAINT "FoodItem_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItemCategory" ADD CONSTRAINT "FoodItemCategory_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodItemCategory" ADD CONSTRAINT "FoodItemCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FoodCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealSlot" ADD CONSTRAINT "MealSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealTemplate" ADD CONSTRAINT "MealTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealTemplate" ADD CONSTRAINT "MealTemplate_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "MealSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealTemplateItem" ADD CONSTRAINT "MealTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MealTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealTemplateItem" ADD CONSTRAINT "MealTemplateItem_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealTemplateItem" ADD CONSTRAINT "MealTemplateItem_alternativeOfId_fkey" FOREIGN KEY ("alternativeOfId") REFERENCES "MealTemplateItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodDiaryEntry" ADD CONSTRAINT "FoodDiaryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodDiaryEntry" ADD CONSTRAINT "FoodDiaryEntry_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "MealSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodDiaryEntry" ADD CONSTRAINT "FoodDiaryEntry_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodDiaryEntry" ADD CONSTRAINT "FoodDiaryEntry_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "MealTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMealStatus" ADD CONSTRAINT "DailyMealStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMealStatus" ADD CONSTRAINT "DailyMealStatus_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "MealSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyMealStatus" ADD CONSTRAINT "DailyMealStatus_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MealTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaterEntry" ADD CONSTRAINT "WaterEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutPlan" ADD CONSTRAINT "WorkoutPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDay" ADD CONSTRAINT "WorkoutDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDayExercise" ADD CONSTRAINT "WorkoutDayExercise_workoutDayId_fkey" FOREIGN KEY ("workoutDayId") REFERENCES "WorkoutDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutDayExercise" ADD CONSTRAINT "WorkoutDayExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_workoutDayId_fkey" FOREIGN KEY ("workoutDayId") REFERENCES "WorkoutDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExerciseEntry" ADD CONSTRAINT "WorkoutExerciseEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExerciseEntry" ADD CONSTRAINT "WorkoutExerciseEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WorkoutExerciseEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_photoMediaId_fkey" FOREIGN KEY ("photoMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineTemplate" ADD CONSTRAINT "RoutineTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineItem" ADD CONSTRAINT "RoutineItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RoutineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRoutineEntry" ADD CONSTRAINT "DailyRoutineEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRoutineEntry" ADD CONSTRAINT "DailyRoutineEntry_routineItemId_fkey" FOREIGN KEY ("routineItemId") REFERENCES "RoutineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_routineItemId_fkey" FOREIGN KEY ("routineItemId") REFERENCES "RoutineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderOccurrence" ADD CONSTRAINT "ReminderOccurrence_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderOccurrence" ADD CONSTRAINT "ReminderOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "ReminderOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
