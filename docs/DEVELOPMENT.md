# Development conventions & cross-module contracts

This file is the source of truth for how modules fit together. Read it before changing code.

## Layout

- `src/server/` — Express 5 + Prisma API. Entry `src/server/index.ts`, app factory `src/server/app.ts`.
  - `routes/<area>.routes.ts` — one Express `Router` per API group, **default export**, mounted in `routes/index.ts`.
    Keep route handlers thin; put business logic in `services/<area>.service.ts` (or `services/<area>/…`).
    (`controllers/` is available if a route file grows large; not required.)
  - `middleware/` — `auth.ts` (`requireAuth`, `requireOwner`, `auth(req)`), `security.ts` (CSRF, rate limits), `error.ts`.
  - `lib/http.ts` — `AppError`, `badRequest/notFound/conflict/forbidden`, `ok/created/noContent`, `parseBody/parseQuery/parseParams`, `idParam`, `paginationQuery`, `pageMeta`.
  - `lib/dates.ts` — **all** date handling: `dateString`, `timeString`, `toDbDate`, `fromDbDate`, `todayIn`, `zonedToUtc`, `weekdayOf`, `addDays`, `dateRange`, `weekBounds`, `monthBounds`, `dateRangeQuery`.
  - `services/dayContext.ts` — `getDayType(userId, date, gymWeekdays)`, `getTargetForDate`, `getTargetsForRange`.
  - `scheduler/` — reminder scheduler (`startScheduler`, `stopScheduler` from `scheduler/index.ts`).
  - `storage/` — S3-compatible media storage adapter.
- `src/shared/` — pure TS shared by client and server (`nutrition.ts`).
- `src/client/` — React 19 + Vite + MUI 7 SPA.
  - `pages/<Name>Page.tsx` — **default export** page components (lazy-loaded in `App.tsx`).
  - `features/<area>/` — area-specific components/hooks.
  - `components/common/` — `PageHeader`, `LoadingState/ErrorState/EmptyState` (States.tsx), `useFeedback()` → `{ notify, confirm }` (Feedback.tsx), `DateNavigator`, `TargetProgressBar`.
  - `services/api.ts` — `api.get/post/put/patch/delete/getPaged/download` (unwraps `{data}`; throws `ApiError`).
  - `services/dates.ts` — `todayIn`, `shiftDate`, `formatDay`, `formatInstant`, `formatClock`, `WEEKDAYS_SHORT`.
  - `hooks/useAsync.ts` — `useAsync(fn, deps)` → `{ data, setData, error, loading, reload }`.
  - `features/auth/AuthContext.tsx` — `useAuth()` → `{ user, settings, timezone, refresh, logout }`.
  - `theme/theme.ts` — `brand`, `nutrientColors`.
- `tests/server/*.test.ts` — Vitest + Supertest against a dedicated Postgres (`TEST_DATABASE_URL`). Use `createTestUser()` from `tests/server/helpers.ts`; it returns `api.get/post/put/patch/delete` with session cookie + CSRF header already set. Each test file creates its own users — never truncate tables.
- `tests/client/*.test.tsx` — Vitest + Testing Library (jsdom).

## API conventions

- Base path `/api/<group>`. All groups except `/api/auth` and `/api/health` are behind `requireAuth` (already applied in `routes/index.ts`).
- Success: `{ data }` or `{ data, meta }` (pagination meta from `pageMeta`). Errors: `{ error: { code, message, details? } }` via thrown `AppError`.
  Express 5 forwards async errors automatically — just `throw`.
- Status codes: 200 read/update, 201 create, 204 delete, 400 validation, 401, 403, 404, 409, 413, 429.
- **Authorization:** every query is scoped by `userId: auth(req).userId`. Look up by `{ id, userId }` with `findFirst` and throw `notFound()` — never trust an id alone.
- Validation: zod schemas + `parseBody/parseQuery/parseParams`. Dates are `'YYYY-MM-DD'` strings (`dateString`); times `'HH:mm'` (`timeString`).
- Dates in responses: DATE columns → `'YYYY-MM-DD'` via `fromDbDate`; instants → ISO strings (default JSON).
- Multi-step writes use `prisma.$transaction`.
- State-changing requests require the CSRF header (handled by axios on the client and by test helpers).

## Data rules

- Never auto-change nutrition targets or the user's meal plan. Seeds run only once per user (`UserSettings.defaultsSeededAt`).
- Historical rows snapshot their source (FoodDiaryEntry nutrition basis, WorkoutSession/Entry names, DailyRoutineEntry title/time). Editing/deleting reusable records must not alter them (FKs are `SetNull`).
- **Missing ≠ zero.** A day with no diary entries reports `logged: false` and `null` totals, not zeros. Same for water and workouts.
- Day type (GYM/REST) for a date: `getDayType()` — `DailyLog.dayType` override, else `UserSettings.gymWeekdays`.
- Nutrient math only through `src/shared/nutrition.ts` (`nutrientsFor`, `sumNutrients`, `targetProgress`). Fiber and water are tracked separately from calories/macros.

## Cross-module contracts (do not change signatures without updating callers)

| Contract | Owner | Consumers |
|---|---|---|
| `GET /api/auth/status` → `{ setupRequired, user: {id,email,name,role}\|null, settings: {timezone,theme,gymWeekdays,defaultSnoozeMinutes,notificationsEnabled}\|null }`; also sets the `mf_csrf` cookie if absent | auth | client AuthContext |
| `PATCH /api/settings` partial `{ timezone?, theme?, gymWeekdays?, defaultSnoozeMinutes?, notificationsEnabled?, profileMediaId? }` | settings | ColorMode toggle, Settings page |
| `seedUserDefaults(tx, userId)` in `src/server/services/defaults/index.ts` | auth/settings | setup route, `prisma/seed.ts` |
| `ensureDailyRoutineEntries(userId, date, { timezone, gymWeekdays })` in `src/server/services/routines.service.ts` — idempotently materialises `DailyRoutineEntry` rows for a date | routines | dashboard, reports |
| `computeNextTrigger(reminder, { timezone, gymWeekdays, now, dayTypeOverrides? })` in `src/server/services/reminders.service.ts`; scheduler fills `nextTriggerAt` for enabled reminders where it is null | reminders | defaults seeding (leaves null) |
| `recomputeUserReminders(userId)` — call after timezone / gym weekdays / DailyLog day-type changes | reminders | settings, reports (daily log) |
| `POST /api/reminders/:id/ring { scheduledFor }` — open tab rings an alarm exactly on time (idempotent, only for current `nextTriggerAt`) | reminders | AlarmProvider |
| `storage` adapter in `src/server/storage/index.ts` (`isConfigured`, `putObject`, `getSignedGetUrl`, `deleteObject`) and `signedUrlForMedia(mediaId, userId)` in `src/server/services/media.service.ts` | media | foods, exercises, measurements, settings |
| `POST /api/media` multipart (`file`, `kind`) → `{ id, kind, mimeType, sizeBytes, url }`; `GET /api/media/:id` → same with fresh signed `url` | media | client |
| `<MediaUploadButton kind onUploaded(asset) />` and `<MediaImage mediaId />` in `src/client/features/media/` | media | settings, foods, measurements, workouts |
| `<AddFoodDialog open onClose date defaultSlotId? onSaved />` in `src/client/features/diary/AddFoodDialog.tsx` | diary | dashboard quick-add |
| `POST /api/water` `{ date, amountMl, loggedAt?, note? }` | water | dashboard quick-add |
| `POST /api/workouts/sessions` `{ date, workoutDayId? }` → session (client then navigates to `/workouts/session/:id`) | workouts | dashboard "Start workout" |
| `AlarmProvider` in `src/client/features/alarms/AlarmProvider.tsx` (mounted around the authenticated layout) | alarms | App.tsx |

## Mobile-app UI rules (the app is used on phones — 360–430px is the primary target)

Treat every screen as a native mobile app screen, not a shrunken web page. Use `src/client/components/common/mobile.tsx`:
- `PageHeader` — on phones the top app bar shows the page title; PageHeader only renders the subtitle + compact actions. Don't add your own big `<h1>`.
- `ResponsiveDialog` — **all** dialogs/forms: full-screen sheet on phones (close ✕, title, optional header Save, actions pinned at the bottom). Never a raw `<Dialog>`.
- `PrimaryAction` — the screen's main action ("Add food", "New reminder", "Add measurement"): a FAB above the bottom nav on phones, a normal button on desktop. Add `<FabSpacer />` at the end of the page.
- `SectionTabs` — sub-sections: sticky under the app bar, full-width when ≤ 4 tabs.
- `usePhone()` (< md, bottom nav visible), `useSmallScreen()` (< sm), `BOTTOM_NAV_OFFSET`, `TOP_BAR_OFFSET`.

Layout rules:
- No horizontal page scroll at 360px. No wide tables on phones — use `List`/stacked rows (`ListItem` with primary/secondary text and a trailing action).
- Lists over nested cards: a section is one `Card` containing `List` rows with dividers, not cards inside cards.
- Touch targets ≥ 44px; destructive/secondary actions in an overflow `⋮` menu on rows instead of 3 icon buttons side by side.
- Numbers first: the key metric large, labels small. Keep copy short (one line where possible).
- Inputs: `size="medium"` in forms, native `type="date"`/`type="time"`, `inputMode="decimal"|"numeric"` for quantities, 16px font (theme).
- Charts on phones: height 180–220, ≤ 5 x-axis ticks, no legends that wrap to 3 lines.
- Don't rely on hover (tooltips are long-press only); every icon button needs an `aria-label`.
- Verify with screenshots at 390×844 (see "Phone screenshots" below), in light **and** dark mode.

## Performance rules (high-latency database)

Each DB round trip from the user's PC to Neon (us-east-2) costs ~400 ms, so latency is dominated by the
**number of sequential round trips**, not query cost:
- Target ≤ 2 sequential round trips per GET endpoint. Run independent queries with `Promise.all`.
- Fetch related data with `include`/`select` in one query instead of N follow-up queries; never query inside a loop.
- Avoid interactive `$transaction(async tx => …)` for reads; for multi-writes prefer batch `$transaction([...])`, `createMany`, `updateMany` or a single SQL statement (BEGIN/COMMIT cost round trips too).
- Don't re-validate ownership with a separate query when the main query can filter by `userId`.
- Sessions are cached in-process (`getSessionCached`) — don't add per-request DB lookups to middleware.
- Client: `useAsync` caches responses (stale-while-revalidate) — show cached data immediately; use `refreshing` for a subtle indicator, never a full-page spinner when data exists. Prefer one aggregated endpoint per screen over several parallel calls.
- Measure: `BENCH_DATABASE_URL=postgresql://postgres:test@localhost:55433/myfit_slow npx tsx scripts/bench-api.ts [--only=substr,…]`
  (that container adds 400 ms latency per round trip; output is ms + query count per endpoint).

## Phone screenshots

Run an API + Vite pair on your own ports against the audit DB (user `demo@example.com` / `demo-password-123`):
```
DATABASE_URL=postgresql://postgres:test@localhost:55432/myfit_audit PORT=31xx SCHEDULER_ENABLED=false npx tsx src/server/index.ts
API_PORT=31xx npx vite --port 51xx --strictPort
MSYS_NO_PATHCONV=1 node <scratchpad>/shots/phone-shots.mjs http://localhost:51xx <outDir> /diary /water
```

## Commands

- `npm run dev` — API on :3000 (tsx watch) + Vite on :5173 (proxies `/api`).
- `npm run typecheck`, `npm run lint`, `npm test` (`--project server` / `--project client`).
- `npm run build` then `npm start` — single production service on `$PORT` serving `dist/client` + `/api`.
- Do **not** run `prisma generate` / `prisma migrate` casually: the client is generated in `postinstall`, and migrations are created deliberately (`npm run db:migrate:dev -- --name <change>`).
