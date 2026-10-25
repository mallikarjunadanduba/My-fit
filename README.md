# MyFit Routine

A personal fitness companion for following a coach's diet plan on time. It covers meals, calories and macros, water, workouts, the daily routine, alarms with push notifications, body progress, and daily/weekly/monthly reports. It is designed **phone-first** and installs to the home screen like an app.

One full-stack Node.js service: Express serves the REST API under `/api/*` and the built React app, and runs the reminder scheduler. PostgreSQL and the S3-compatible media bucket stay external.

---

## 1. Architecture

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TypeScript, MUI 7, React Router 7, Axios, React Hook Form + Zod, Recharts 3, date-fns / date-fns-tz |
| Backend | Node 22+, Express 5, TypeScript, Prisma 6, Zod validation, Argon2id, Helmet, express-rate-limit, web-push, AWS SDK v3 (S3) |
| Database | Existing PostgreSQL (Neon), Prisma migrations |
| Media | Existing Neon S3-compatible private bucket `my-gym`, random keys + signed URLs |
| Notifications | In-app alarms (tab open), Service Worker + Web Push/VAPID (app closed), server scheduler with PostgreSQL de-duplication |
| CI/CD | GitHub Actions → tests → GHCR image → guarded migrations → deploy hook → health verification |

```
Phone (PWA) ──HTTPS──▶  Node service (Docker)
                         ├─ Express /api/*  ──▶ PostgreSQL (Neon, MyGym)
                         ├─ static React app (dist/client)
                         └─ reminder scheduler ──▶ Web Push services ──▶ phone
                                             └──▶ S3 bucket "my-gym" (private, signed URLs)
```

### Folder structure

```
.github/workflows/ci-cd.yml        CI/CD pipeline
Dockerfile, .dockerignore          single production image
prisma/schema.prisma               31 models (users, foods, diary, workouts, reminders, media…)
prisma/migrations/                 versioned SQL migrations
prisma/seed.ts                     idempotent default-data seeding for existing users
public/                            web app manifest, app icons
src/client/sw.ts                   service worker (PWA app-shell cache + Web Push) → built to /sw.js
src/client/pwa/                    service-worker registration, install / update / offline prompts
scripts/                           destructive-migration guard, icon generator
docs/DEVELOPMENT.md                conventions + cross-module contracts
src/shared/nutrition.ts            nutrition maths used by client and server (+ tests)
src/server/
  index.ts / app.ts / env.ts       entry, app factory (helmet, CSRF, rate limits, static), env validation
  routes/                          auth, settings, dashboard, foods, meals, food-diary, water, workouts,
                                   routines, reminders, notifications, measurements, reports, media, export
  services/                        business logic (defaults/ = coach plan + food library seed data,
                                   reports/ = aggregation, workouts/ = plans, sessions, PR stats)
  middleware/                      auth/session, CSRF, rate limiting, central error handler
  scheduler/                       reminder scheduler (advisory-lock protected tick)
  storage/                         S3 adapter
  lib/                             HTTP helpers, timezone-safe date helpers
src/client/
  pages/                           16 pages (Dashboard, Diary, Meal Plan, Foods, Water, Workouts, Session,
                                   Routine, Alarms, History, Reports, Body & Progress, Settings, Login, Setup, Invite)
  features/                        per-area components (alarms, diary, meals, workouts, media, reports…)
  components/                      Layout (sidebar + phone bottom nav), shared states/dialogs/progress bars
  services/, hooks/, theme/        API client, date helpers, useAsync, light/dark theme
tests/server/                      API, persistence, authorization, scheduler, reports tests (Supertest)
tests/client/                      rest timer, alarm scheduling, add-food dialog tests
```

---

## 2. Local development

Requirements: Node 22+, npm, Docker (for the local test database).

```bash
npm install                     # also runs `prisma generate`
cp .env.example .env            # then fill in values (see §3)
npm run db:migrate:deploy       # apply migrations to DATABASE_URL
npm run dev                     # API on :3000 + Vite on :5173 (open http://localhost:5173)
```

Open the app. On the very first run you'll see **Create your account**. That creates the owner account and loads the coach's diet plan, nutrition targets, food library, routine and reminders.

To try it on your phone over Wi-Fi, run `npx vite --host` and open `http://<your-PC-IP>:5173`. Push notifications need HTTPS, so test those on the deployed site.

| Command | Purpose |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server |
| `npm run typecheck` / `npm run lint` | TypeScript (client + server) / ESLint |
| `npm test` (`test:server`, `test:client`) | Vitest suites |
| `npm run build` → `npm start` | production bundle (`dist/`), single service on `$PORT` |
| `npm run db:migrate:dev -- --name x` | create a new migration (development only) |
| `npm run db:migrate:deploy` | apply pending migrations |
| `npm run db:seed` | seed defaults for any user not yet seeded (never overwrites) |
| `npm run vapid:generate` | generate Web Push keys |

Test database (never production):
```bash
docker run -d --name myfit-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=myfit_test -p 55432:5432 postgres:16-alpine
# .env: TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/myfit_test
```

---

## 3. Environment variables (`.env.example`)

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | yes | `production` on the host (enables secure cookies) |
| `PORT` | no | default 3000 |
| `APP_URL` | no | public URL (informational) |
| `TRUST_PROXY` | prod | `true` behind Render/Fly/Railway proxies so rate limiting sees real IPs |
| `DATABASE_URL` | yes | runtime connection: Neon **pooled** host (`…-pooler…`) |
| `DIRECT_URL` | yes | migrations: Neon **direct** host (no `-pooler`), keep `connect_timeout=30` (Neon cold starts) |
| `TEST_DATABASE_URL` | tests | disposable DB for automated tests |
| `SESSION_SECRET` | yes | ≥ 32 random chars; HMAC key for session tokens |
| `SESSION_TTL_DAYS` | no | default 60, sliding (renews while you use the app) |
| `SETUP_TOKEN` | recommended | if set, the first-run form must supply it (prevents a stranger claiming a fresh deployment) |
| `DEFAULT_TIMEZONE` | no | default `Asia/Kolkata` |
| `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | media | Neon storage credentials |
| `S3_BUCKET` | media | `my-gym`. Empty disables uploads (UI explains why) |
| `S3_FORCE_PATH_STYLE` | no | `true` for Neon |
| `MEDIA_MAX_BYTES` / `SIGNED_URL_TTL_SECONDS` | no | 8 MB / 900 s |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push | Web Push keys + `mailto:` contact |
| `SCHEDULER_ENABLED` | no | `true`; the scheduler sleeps until the next due alarm (max 15 min), so the database can auto-suspend between alarms |

Secrets never reach the browser bundle. The client only ever receives the VAPID **public** key and short-lived signed media URLs.

---

## 4. Database (existing PostgreSQL)

- Set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct). Run `npm run db:migrate:deploy`. The `init` migration has already been applied to `MyGym`.
- Deployments only run `prisma migrate deploy`. CI blocks any pending migration containing `DROP`, `TRUNCATE` or `DELETE FROM` unless you re-run manually with `allow_destructive_migrations=true` after taking a backup.
- Default data is seeded **once per user** (`UserSettings.defaultsSeededAt`), at account creation. Restarts and redeploys never reset your plan.
- History is snapshotted. Diary entries keep the nutrition values they were logged with, workout sessions keep exercise names, and routine entries keep titles and times. Nutrition targets are versioned by effective date. Editing foods, templates or plans never rewrites past records.
- "Not logged" is stored and reported separately from genuine zero.

### Backup & restore

Neon keeps point-in-time history (restore a branch to any moment within your plan's retention window from the Neon console). For portable backups:

```bash
# Backup (use the DIRECT host)
pg_dump "$DIRECT_URL" --format=custom --no-owner --file=myfit-$(date +%F).dump
# Restore into an empty database
pg_restore --dbname="$TARGET_DIRECT_URL" --no-owner --clean --if-exists myfit-YYYY-MM-DD.dump
```

You can also download your data at any time from **Reports → Export** (CSV per dataset, or JSON for everything). Bucket objects are not included in `pg_dump`. Copy them with any S3 tool (`aws s3 sync s3://my-gym ./my-gym-backup --endpoint-url $AWS_ENDPOINT_URL_S3`).

---

## 5. Media bucket

- Provider: Neon S3-compatible storage. These operations were verified to work: PutObject, HeadObject, GetObject (presigned), presigned PUT, DeleteObject and ListObjects. Object ACLs are **not** supported.
- Uploads go through the backend (`POST /api/media`, multipart). It enforces an 8 MB limit and accepts JPEG/PNG/WebP only, checked against the file's actual bytes rather than its declared type. Object keys are random (`users/<id>/<kind>/<yyyy>/<mm>/<uuid>.<ext>`), and metadata lives in `MediaAsset`. Delete removes the object and clears references. `POST /api/media/cleanup` removes abandoned uploads.
- The `my-gym` bucket is **private**: it has no bucket policy, so unsigned requests return 403 Access Denied, while signed URLs return 200 (verified). The app only hands out 15-minute signed URLs. If a public-read policy is ever added to the bucket, the Body & Progress page shows a warning (`GET /api/media/status`).

---

## 6. Alarms, reminders & push notifications

How delivery works:
1. **App open:** the page arms timers for the next reminder and rings an in-app alarm with sound and vibration (Done / Snooze / Dismiss).
2. **App closed:** the server scheduler sleeps until the next reminder, snooze or hourly maintenance is due (at most 15 min), so the database can auto-suspend between alarms; creating or editing a reminder wakes it. Due reminders are claimed in PostgreSQL (unique per reminder+time, and per device for deliveries), so you never get duplicates, even if two server instances run. Each claimed reminder is then sent via Web Push to every subscribed device.
3. **Missed:** if the server was asleep and a reminder is more than 30 min late, it is recorded as *missed* instead of spamming late alerts. Overdue items show on the dashboard and as a badge on the Alarms tab.

Delivery is **best effort, not guaranteed to the minute**. Browsers, phone OS power saving, Do Not Disturb, revoked permissions, network outages and a sleeping host can all delay or prevent notifications.

Setup and testing:
1. `npm run vapid:generate`, then put the keys into `.env` and the host's environment. Keep the same keys afterwards, because rotating them invalidates existing subscriptions.
2. Open the deployed **HTTPS** site on your phone:
   - **Android (Chrome):** Alarms → Enable notifications → Send test notification. Then exclude Chrome from battery optimisation for reliable timing.
   - **iPhone (iOS 16.4+):** Safari → Share → **Add to Home Screen**. Open MyFit from the home-screen icon, then Alarms → Enable notifications → Send test. iOS only allows push for installed web apps.
3. Create a reminder 2 minutes ahead, lock the phone, and wait for the notification. **Alarms → History** shows each occurrence and the outcome for every device.

Reminders support weekdays, one-time dates, gym-day / rest-day / any-day schedules, snooze, sound, pause/resume and completion. Routine items create and update their linked reminders automatically.

---

## 7. Deployment

GitHub Actions is the CI/CD runner, **not** the host. GitHub Pages **cannot** run this app: it has no Express backend, no scheduler and no Web Push. No hosting target existed in this repository, so the workflow is ready for any container host and triggers it through a deploy hook.

### Hosting requirements
- Runs one Docker container (`Dockerfile`), with Node 22 and port `$PORT`. Health check: `GET /api/health`.
- **Must stay always-on** for server-side alarms. Free tiers that sleep (e.g. Render Free, which sleeps after 15 min) will stop push reminders while asleep; the app then marks those reminders *missed*. Use an always-on plan (e.g. Render Starter, Railway, Fly.io with `min_machines_running = 1`, Koyeb).
- HTTPS (all of the hosts above provide it). It is required for service workers and push.
- Run a **single instance**. Multiple instances are safe, because the scheduler uses a Postgres advisory lock, but a single instance is enough.

### Recommended: Render (Docker web service)
1. Push this repo to GitHub. In Render choose **New → Blueprint** and pick the repo. `render.yaml` defines everything: a Docker web service in **Ohio** (same region as Neon), the always-on **Starter** plan, health check `/api/health`, auto-deploy off, and the env vars.
2. Render prompts for the secret values: `DATABASE_URL`, `DIRECT_URL`, the `AWS_*` keys and the `VAPID_*` keys. `SESSION_SECRET` and `SETUP_TOKEN` are generated automatically. Copy `SETUP_TOKEN` from the service's Environment tab, because the first-run "Create account" screen asks for it.
3. Copy the service's **Deploy Hook** URL (Settings → Deploy Hook) for GitHub Actions.

Don't put the front end on GitHub Pages. A Pages front end calling a Render API would be cross-site, so the login cookie becomes a third-party cookie, which iPhone Safari blocks, and CSRF protection breaks. Render already serves the front end from the same service.

### GitHub configuration (Settings → Environments → `production`)

| Kind | Name | Value |
|---|---|---|
| Secret | `DATABASE_URL` | pooled Neon URL |
| Secret | `DIRECT_URL` | direct Neon URL (used for migrations) |
| Secret | `DEPLOY_HOOK_URL` | host deploy hook (Render/Railway/Koyeb) |
| Variable | `APP_URL` | e.g. `https://myfit.onrender.com` (used to verify health) |

App runtime secrets (session, bucket, VAPID) live in the **host's** environment, not GitHub.

### Pipeline (`.github/workflows/ci-cd.yml`)
Triggers: push to `main`, pull requests, manual run.
1. **verify:** `npm ci` → Prisma validate → migration/schema drift check → lint → typecheck → backend tests (Postgres service container) → frontend tests → build → production smoke test.
2. **image** (main only): build and push `ghcr.io/<owner>/<repo>:<sha>` + `:latest`.
3. **migrate** (main, `production` environment): destructive-SQL guard → `prisma migrate deploy`.
4. **deploy:** call the deploy hook, then poll `APP_URL/api/health` for up to 10 minutes. The job summary states clearly whether it ran, whether it was healthy, or whether no target is configured. Credentials are never printed.

---

## 8. Security

- First-run setup creates a single owner (optionally gated by `SETUP_TOKEN`); additional accounts only by owner invitation links (hashed, 7-day, single use).
- Argon2id password hashing, generic login errors with timing equalisation, rate-limited auth endpoints, a global API rate limit.
- Sessions live in PostgreSQL. The browser only holds an HTTP-only, `SameSite=Strict`, `Secure` (production) cookie, and the server stores only an HMAC of the token. Logout and password changes revoke sessions, and active sessions can be revoked from Settings. Nothing sensitive goes in `localStorage`.
- CSRF double-submit token on every state-changing request; Helmet security headers + CSP.
- Every private endpoint requires authentication. Every query is scoped to the signed-in user, and other users' IDs return 404.
- Zod validation on client and server; JSON body limit; upload size/MIME/magic-byte checks.
- No credentials in the frontend; `.env` is git-ignored.
- ⚠️ The database and bucket credentials in your local `.env` were shared in a chat. **Rotate them** (Neon console → reset password / regenerate storage key) before going live, and only put the new values in the host and GitHub secrets.

---

## 9. Verification performed

- `npm run lint`: clean. `npm run typecheck`: clean (client + server).
- `npm test`: **23 files, 228 tests passed, 1 skipped**. The skipped test is the "bucket not configured" case, which runs only when `S3_BUCKET` is empty. Coverage includes nutrition maths, API authorization (401/403/404 across users), CSRF, persistence and history snapshots, meal states, water, workouts and PRs, the rest timer, reminder scheduling (DST, gym/rest days, duplicates, snooze, missed), push subscription handling, daily/weekly/monthly reports, export escaping, and a **real upload → signed download → delete against the private `my-gym` bucket**.
- `npm run build`: client + server bundles build. The production bundle was started and exercised end-to-end. Setup, plan logging, water, workout start and measurements all worked, with no console errors or failed requests.
- **Phone audit:** every page and its dialogs were rendered in Chrome at 390×844 (light and dark). No horizontal page scrolling, and every page scrolls vertically. Tabs and chip rows that don't fit swipe sideways by design.
- **PWA:** Chrome reports no installability errors. The service worker activates and controls the page, and the app shell opens offline.
- **Speed** (`scripts/bench-api.ts` against a database with 400 ms simulated latency per round trip, about the India→Neon us-east-2 link):
  - dashboard 9.3 s → 1.2 s;
  - diary 3.2 s → 0.8 s; meal plan 4.4 s → 0.8 s;
  - foods, water, routine, workouts, measurements and reports 2–4.4 s → about 0.4 s;
  - logging a workout set 5–7 s → 0.4 s; routine item save 8.9 s → about 1.2 s.
  - Hosted in the same region as the database, each of these takes a few milliseconds.
- Migrations applied to the real `MyGym` database; `prisma migrate diff` shows no drift.

## 10. Installable app (PWA)

- The app is an installable PWA (`vite-plugin-pwa`, `injectManifest`). `src/client/sw.ts` precaches the app shell, falls back to `index.html` for navigations, and handles Web Push.
- API responses are **not** cached by the service worker. They contain personal data, and the app keeps its own in-memory cache.
- What users see:
  - An **Install** banner on the dashboard and an **Install MyFit app** button in the More sheet. On iPhone these show the Add to Home Screen steps.
  - A "new version ready — **Update**" prompt when a new build is deployed.
  - An offline notice. When the app starts without a connection, it shows "You're offline" and reconnects automatically.
- The service worker is generated by production builds only (`npm run build`), not in `vite` dev mode.
- Phones only allow install, offline mode and push notifications on **HTTPS**, or on `localhost`. To test over Wi-Fi on Android before deploying:
  1. Run `npm run build`, then start the server with `NODE_ENV=development npm start`. NODE_ENV=development is needed because cookies are `Secure` in production.
  2. On the phone, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` and add `http://<PC-IP>:<port>`.
  3. Relaunch Chrome and install the app.
- iPhone needs the real HTTPS deployment.

## 11. Still needs configuration

1. **Hosting target**: create the always-on container service and set `DEPLOY_HOOK_URL` + `APP_URL` (§7). Not deployed yet.
2. **VAPID keys** for closed-app push (§6). In-app alarms work without them.
3. **Rotate** the database password and storage key that were shared in chat (§8).
4. Real-device push delivery has not been tested yet. It needs the HTTPS deployment.
