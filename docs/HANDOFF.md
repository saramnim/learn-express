# Learn daily-release handoff

## Release shape

- DB2 migration: `learn_daily_release_admin`.
- API runtime: `service-data` Edge Function.
- Seed course: `solo-founder-7-day-system` (7 lessons, first immediately available, following lessons at 09:00 Asia/Seoul).
- Runtime deployment identifiers and entitlement assignments are intentionally managed outside this public repository.

## Contracts

- Auth context: `EF-TWO-DB-1.0`
- Service envelope: `EF-SERVICE-0.1.0`
- Learn release/authoring: `EF-LEARN-DAILY-1.0`
- Edge base URL: supplied through `VITE_SERVICE_DATA_URL`.

Admin routes require a verified DB1 bearer and Learn `org_admin`:

- `GET /learn/admin/courses`
- `GET /learn/admin/courses/{slug}`
- `PUT /learn/admin/courses/{slug}` with `If-Match` and `Idempotency-Key`

## Operational behavior

Course and lesson publication is evaluated at read time. There is no scheduler dependency. A published lesson is learner-visible only when `publish_at <= clock_timestamp()`. Progress mutations repeat the same eligibility check, so a future lesson ID cannot be used to create progress early.

Admin course saves are atomic. Omitted lessons become `archived` and retain historical progress. The partial position index lets new active revisions reuse display positions without deleting archived rows.

## Deployment requirements

Vercel needs the four public client variables shown in `.env.example`. Only the DB1 publishable key is used in the browser. Supabase Edge secrets remain managed on DB2 and are not copied into Vercel.

## Release verification

Before each release, verify:

- Migration execution inside a rollback transaction before apply.
- Seed count: 1 course / 7 lessons / 1 initially released lesson.
- SQL contract: admin ACL, save/replay, version conflict, future visibility, released progress, future progress denial.
- Edge health `200`; unauthenticated learner and admin routes `401`.
- Supabase security advisor has no findings introduced by the migration.
- Frontend unit tests, TypeScript check, and production build pass.

## Rollback

Use `supabase/rollbacks/20260928032000_learn_daily_release_admin.down.sql` to disable authoring RPCs and admin policies. It deliberately preserves seeded content, `publish_at`, and the active-position index so scheduled content and learner progress are not destroyed.
