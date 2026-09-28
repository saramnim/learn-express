# Encoreflare Learn agent rules

## Boundaries

- DB1 (Auth project) owns Auth, common identity, and app entitlements.
- DB2 (service-data project) owns Learn content and progress.
- Keep `EF-TWO-DB-1.0`, `EF-SERVICE-0.1.0`, and `EF-LEARN-DAILY-1.0` backward compatible.
- Never place service-role, secret, or coordinator credentials in browser code or committed environment files.
- Browser code must use the `service-data` Edge Function instead of DB2 tables or RPCs directly.

## Database changes

- Add timestamped forward migrations and explicit safe rollback files.
- Preserve existing Learn, Pantry, and YEOYU data.
- Keep RLS and FORCE RLS enabled; narrow execution to `service_role` and owner roles.
- Mutations require idempotency and optimistic concurrency.
- Run contract SQL tests plus Supabase security and performance advisors after DDL.

## Product and UI

- Use FLARE semantic tokens: Midnight `#0E0F12`, Flare Gold `#C9A07A`, Cloud `#F8F7F4`, Stone `#EAE3DA`, Sage `#6B7A73`, Mauve `#B993A1`.
- Use a 4px spacing grid with 8px controls, 12px cards, and 16px dialogs.
- Support light/dark themes, keyboard focus, mobile layout, and reduced motion.
- Prefer clear hierarchy and purposeful surfaces over generic card grids, glass, glow, or decorative gradients.

## Verification

- Run `npm test`, `npm run typecheck`, and `npm run build`.
- Verify public 401, learner, admin, scheduled-release, progress-conflict, and mobile browser paths.
