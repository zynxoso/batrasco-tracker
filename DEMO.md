# Internal note: simulation feed

Run `npm run dev` and open `/tracker` or `/tracker-settings`. The built-in simulation remains the default feed on a fresh browser. The large demo toolbar and mode-switch buttons have been removed; a compact **Simulated locations** label identifies the feed. `/demo` now falls through to `/` like other unknown paths.

Dashboard, station pages, Fleet map, history, station timing, convoy spacing, tracking controls and Manage records share the same local simulation. Simulated fleet operations do not call the fleet API or write to the live database. Admin sign-in/out remains available through Supabase Auth and does not change the selected data feed. External map tiles still need internet access.

Three starter vehicles run along the Batangas–Lipa corridor, stop for 45 simulation seconds and turn around. Vehicle edits, driver assignments, capacity, availability, archive and restore affect the existing screens. Added active vehicles on the selected route join the simulation. Routes and stations can be edited locally; a route needs at least two distinct stations along the existing corridor. This is not arbitrary-road route planning.

Playback defaults to 20×, or uses the browser's saved rate. Rate, route selection, restart and reset controls are no longer exposed in the UI; the engine retains those methods unchanged. The existing Fleet map master switch still pauses/resumes movement. Per-device tracking freezes that unit; report interval controls stored history samples. History retains up to 240 points per vehicle and 80 completed legs. Hidden tabs pause advancement. The saved selected route remains the active simulation scenario.

Records, settings, progress and history save in this browser's local storage; they are not shared between viewers. Storage schema, persistence behavior, history limits and simulation logic are unchanged. The existing saved mode preference still controls the data pipeline; browsers previously set to live mode remain in that mode. There is no visible mode switch. Live backend operations still require the existing administrator permissions.

Run `npm test` for simulation travel/dwell/turnarounds, local CRUD persistence, route assignment, controls, history limits and no-network demo checks. These do not validate actual GPS or production concurrency.
