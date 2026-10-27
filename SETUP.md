**BATRASCO setup and release checklist**

Use the existing React/Vite + Vercel + Supabase project. No paid upgrade is required to run the local simulated demo. Do not deploy the new admin/API version before completing database setup.

The existing screens default to the simulation feed for a fresh browser, identified by a compact **Simulated locations** label. The large demo toolbar and visible mode switch have been removed; the saved mode preference still selects the data pipeline. See `DEMO.md` for controls and persistence. Live-mode database setup below is still required for real fleet operations.

**Database setup — required**

1. Export a backup of the existing database before applying schema/access changes.
2. In the correct Supabase project's SQL Editor, run `supabase/migrations/202610270001_fleet_management.sql`. It adds fleet tables, seeds the existing route and stops, enables administrator policies, and restricts direct access to raw tracker tables. It does not delete telemetry records. Existing trackers are imported as inactive vehicles pending review.
3. Create or identify an administrator in Supabase Authentication → Users. Set the user's password privately through the dashboard or the normal recovery flow. Do not put it in source code or a VITE variable.
4. Grant that existing user fleet access through the SQL Editor:

```sql
-- Replace the UUID with the selected user's Auth ID.
insert into public.fleet_admins(user_id)
values ('REPLACE-WITH-AUTH-USER-UUID')
on conflict do nothing;
```

Only a project owner/service administrator should grant or remove these roles. The browser cannot promote users. Supabase Auth signup settings can be disabled if accounts are provisioned by the owner.

**Environment and local run**

Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public key only).

Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. These existing values stay private.

`npm install`, then `npm run dev`. Vite serves the local API using the same handlers as Vercel; there is no need to proxy writes to production. The configured database is still the real configured project: use a separate test project for editing test records.

- `/demo`: no dedicated route; falls through to `/` without changing the saved mode.
- `/tracker`: public route information and sanitized vehicle snapshots.
- `/manage`: administrator vehicle/driver/route/station records, search, pagination, archive and restore.
- `/tracker-settings`: administrator map, history and collection settings.

`node scripts/check-setup.mjs` performs read-only table readiness checks and prints no credentials or record contents.

**Data behavior**

- Fleet records save to Supabase; failed requests remain errors and do not show a success notice.
- Public GPS IDs are registry UUIDs. Driver names, phone numbers and device IDs are not included in public vehicle responses.
- Existing vehicles must be reviewed, assigned a public plate/label, activated and assigned to BAT-LIP-001 before appearing on the public tracker.
- The route geometry is still the existing Batangas–Lipa corridor. Other registered routes are not automatically given public maps. Station coordinates affect the public stop view; demo stops are an isolated demonstration dataset.
- GPS timestamps older than five minutes, missing timestamps and implausibly future timestamps are not treated as fresh. No fresh ETA is promised for these records.
- Passenger occupancy is unavailable rather than synthesized. Vehicle capacity is maintained separately.
- The global toggle persists in Supabase and controls scheduled collection. Individual ingest settings remain unchanged when collection pauses.
- Station-to-station estimates still come from observations in the current browser. Demo mode uses simulated travel time and its own records; live mode uses the existing live observations. Neither is a central trip-reporting system.

**Actual GPS — not activated by this release**

Collection defaults to disabled. Configure the actual supported gateway only after verifying the hardware/protocol and authorization. `/api/ingest`, `/api/device` and `/api/tracker` require a server-side `TRACKER_INGEST_SECRET` sent as a Bearer token. Gateway batches are limited to 100 reports. Never embed this secret in the frontend.

Public viewers no longer initiate SinoTrack collection. A scheduler/worker must call `/api/trackers-poll` with `TRACKER_POLL_SECRET` in `X-Tracker-Poll-Secret`, or `CRON_SECRET` as a Bearer token. A verified administrator can also call it. An impersonated cron user-agent grants no access. Real GPS end-to-end validation and a permanent collection scheduler remain deployment work.

**History and the 500 MB allowance**

The schema stores a configurable `history_days` value, initially 7. It supplies the service-only `prune_tracker_history()` function, but does not execute it or schedule deletion automatically. Before enabling retention, agree on the retention period and export records that must be kept. Schedule the function only after that decision. Monitor actual table/index size in Supabase; a retention window is not a guarantee that 500 MB is sufficient.

**Validation and deployment**

`npm test` covers administrator authentication/authorization, input validation, freshness/backoff, route timing, a real embedded-PostgreSQL migration/RLS test, and simulation travel/dwell/turnarounds. All database tests use an isolated in-memory database, not production.

`npm run typecheck` checks the shipped frontend entry graph and all API handlers. The older repository-wide tsconfig also includes unused generated UI scaffolding with unresolved optional dependencies; it is not the release check.

`npm run build` bundles the frontend and regenerates the committed `api/*.js` files. Set the same server environment on Vercel, then verify protected endpoints return 401 without a token and confirm authorized CRUD with a dedicated test record in staging. Verify refresh persistence, mobile layout and rollback before replacing the production deployment.

**Remaining release gates**

- Owner applies the migration and provisions an Auth administrator.
- Authorized CRUD and storage usage are verified against the intended Supabase project.
- Production deployment/domain setup is performed and checked.
- Actual GPS, central trip reports, multi-route maps and 400k-concurrent load certification are separate unfinished capabilities; the demo does not validate them.
