# Demo mode in the existing BATRASCO app

Run `npm run dev` and open `/tracker` or `/tracker-settings`. The existing application starts in labeled demo mode on a fresh browser. `/demo` is now a compatibility redirect to the existing dashboard; there is no separate demo page.

Dashboard, station pages, Fleet map, history, station timing, convoy spacing, tracking controls and Manage records share the same local simulation. No demo action calls the fleet API, authenticates to Supabase, or writes to the live database. External map tiles still need internet access.

Three starter vehicles run along the Batangas–Lipa corridor, stop for 45 simulation seconds and turn around. Vehicle edits, driver assignments, capacity, availability, archive and restore affect the existing screens. Added active vehicles on the selected route join the simulation. Routes and stations can be edited locally; a route needs at least two distinct stations along the existing corridor. This is not arbitrary-road route planning.

Playback starts at 20×, with 1× and 60× options. Pause/resume affects movement and the Fleet map master switch. Per-device tracking freezes that unit; report interval controls stored history samples. History retains up to 240 points per vehicle and 80 completed legs. Hidden tabs pause advancement. The selected route is the active demonstration scenario.

Records, settings, progress and history save in this browser's local storage; they are not shared between viewers. Restart trips preserves registry edits. Reset demo records asks before replacing local sample records and history. Neither touches production. Switch to live data explicitly to use the existing protected backend; live administrator permissions are still required.

Run `npm test` for simulation travel/dwell/turnarounds, local CRUD persistence, route assignment, controls, history limits and no-network demo checks. These do not validate actual GPS or production concurrency.
