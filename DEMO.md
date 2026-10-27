# Bus route demo

Run `npm run dev` and open `/demo` on the local Vite address. After deploying the application, the same `/demo` path is available on that deployment.

This page uses simulated GPS, clearly labeled in the banner, map and bus details. It does not connect to SinoTrack or Supabase, start the main app's tracker polling, or write demo positions into the live fleet. External OpenStreetMap tiles need internet access; the route progress view and simulation work without those tiles.

Three sample buses follow the existing route between Batangas City, San Jose and the last passenger stop in Lipa. They dwell for 45 simulation seconds at each stop and turn around at the termini. Their speeds differ by route leg. ETA is the remaining travel time to the next stop in simulation minutes and seconds, not a prediction for a real vehicle.

Playback starts at 20×. Use 1× for real-time pacing or 60× for a quick walkthrough. Select a bus on the map, route strip or fleet list; pause, resume, restart or follow it on the map. Hidden tabs pause advancement. Sessions are local to each browser and are not synchronized between viewers.

Run `npm run test:demo` to check distance/ETA consistency, dwell time, turnarounds, circuit continuity and route bounds. This does not test production GPS or concurrent-user capacity.
