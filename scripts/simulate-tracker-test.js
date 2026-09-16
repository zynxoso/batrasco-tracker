#!/usr/bin/env node
/**
 * Quick mock: keep realistic 5s physics/speeds, but publish sampled frames only.
 *
 * Example: 2 minutes has 24 realistic frames at 5s. Quick mode can publish only
 * 1 sampled frame (default: the first frame per 2-minute window), skipping the rest.
 *
 * Env:
 * - SIMULATE_QUICK_SEC (default 120): wall-clock runtime.
 * - SIMULATE_QUICK_SAMPLE_EVERY_TICKS (default 24): how many realistic frames to skip per publish.
 * - SIMULATE_QUICK_TRAFFIC_CYCLE_MIN (default 45): repeating congestion cycle length (minutes of sim time).
 *
 * Timestamps: each published row uses simulated time (5s per internal frame) so reported_at gaps
 * match the distance between sparse samples. speed_kmh is set to the implied speed over that window.
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in .env.local
 */

const fs = require('fs');
const path = require('path');
const {
  ROUTE_TOTAL_KM,
  percentDeltaForSpeed,
  routeBearingDegToLipa,
  routeBearingDegToBatangas,
} = require('./simulator-route.js');
const { upsertTrackerLatestRows } = require('./simulator-upsert.js');

const BEARING_TO_LIPA = routeBearingDegToLipa();
const BEARING_TO_BATANGAS = routeBearingDegToBatangas();

function loadEnv() {
  const root = path.resolve(__dirname, '..');
  for (const file of ['.env.local', '.env']) {
    const p = path.join(root, file);
    try {
      const content = fs.readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
      break;
    } catch (_) {}
  }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY. Set in .env.local or environment.');
  process.exit(1);
}

const STOP1 = { lat: 13.7641749, lng: 121.0562022 };
const STOP3 = { lat: 13.9394093, lng: 121.1228333 };

function positionToLatLng(positionPercent) {
  const p = Math.max(0, Math.min(100, positionPercent)) / 100;
  return {
    lat: STOP1.lat + (STOP3.lat - STOP1.lat) * p,
    lng: STOP1.lng + (STOP3.lng - STOP1.lng) * p,
  };
}

const TEST_VEHICLES = [
  { device_id: 'TEST-V01', vehicle_name: '482-KQJ', towardsBatangas: false, passengers: 8 },
  { device_id: 'TEST-V02', vehicle_name: '917-XLM', towardsBatangas: false, passengers: 16 },
  { device_id: 'TEST-V03', vehicle_name: '305-TRZ', towardsBatangas: false, passengers: 20 },
  { device_id: 'TEST-V04', vehicle_name: '864-PWB', towardsBatangas: true, passengers: 3 },
];

const INITIAL_POSITION = [12, 45, 65, 92];

const SAN_JOSE_POSITION = 50;
const SAN_JOSE_BAND = 2.5;
const SAN_JOSE_DWELL_TICKS = 3;

const INTERVAL_MS = 5000;
const INTERVAL_SEC = INTERVAL_MS / 1000;
const RUN_DURATION_SEC = Math.max(INTERVAL_SEC, parseInt(process.env.SIMULATE_QUICK_SEC || '120', 10));
const TICKS = Math.floor(RUN_DURATION_SEC / INTERVAL_SEC);
const SAMPLE_EVERY_TICKS_RAW = process.env.SIMULATE_QUICK_SAMPLE_EVERY_TICKS;
const SAMPLE_EVERY_TICKS_PARSED = parseInt(SAMPLE_EVERY_TICKS_RAW || '24', 10);
const SAMPLE_EVERY_TICKS = Number.isFinite(SAMPLE_EVERY_TICKS_PARSED)
  ? Math.max(1, SAMPLE_EVERY_TICKS_PARSED)
  : 24;
const SKIPPED_PER_PUBLISH = SAMPLE_EVERY_TICKS - 1;

const DWELL_TICKS = 3;
/** Min |Δ%| on route before trusting sparse-window implied speed (avoids 0 km/h at clamps → UI "N/A"). */
const IMPLIED_SPEED_MIN_DELTA_PCT = 0.04;
/** Private transport profile: faster than bus ops, still within non-expressway limits. */
const SPEED_CAP_KMH = 64;
const QUICK_TRAFFIC_CYCLE_MIN = Math.max(
  10,
  parseInt(process.env.SIMULATE_QUICK_TRAFFIC_CYCLE_MIN || '45', 10)
);
// Start the cycle near a congestion peak so you can see "traffic" quickly.
const QUICK_TRAFFIC_PHASE_OFFSET_MIN = Math.max(
  0,
  parseFloat(process.env.SIMULATE_QUICK_TRAFFIC_PHASE_OFFSET_MIN || '11')
);

function round1(x) {
  return Math.round(x * 10) / 10;
}

/** Same idea as realistic mock: repeating rush-ish slowdowns + light jitter (per-vehicle phase). */
function quickTrafficMultiplier(simFrame, vehicleIndex) {
  const simMin = (simFrame * INTERVAL_SEC) / 60;
  const phase = ((simMin + vehicleIndex * 7 + QUICK_TRAFFIC_PHASE_OFFSET_MIN) % QUICK_TRAFFIC_CYCLE_MIN) / QUICK_TRAFFIC_CYCLE_MIN;
  const morningPeak = Math.exp(-Math.pow((phase - 0.25) / 0.14, 2));
  const eveningPeak = Math.exp(-Math.pow((phase - 0.72) / 0.15, 2));
  const peakPenalty = 0.38 * morningPeak + 0.29 * eveningPeak;
  // Strengthen how much the peaks slow vehicles so the UI's "In Traffic" threshold (<= 12 km/h)
  // is reached at least occasionally in short dev runs.
  const peakPenaltyMult = Math.max(
    0.1,
    parseFloat(process.env.SIMULATE_QUICK_TRAFFIC_PEAK_PENALTY_MULT || '2.2')
  );
  const wave = 0.08 * Math.sin((simMin + vehicleIndex * 4) * 0.65);
  // Lower floor so some frames reach <= 12 km/h (RouteMap marks "In Traffic" at <= 12).
  const trafficMinMultiplier = Math.max(0.05, Math.min(0.8, parseFloat(process.env.SIMULATE_QUICK_TRAFFIC_MIN_MULTIPLIER || '0.2')));
  return Math.max(trafficMinMultiplier, Math.min(1.0, 1 - peakPenalty * peakPenaltyMult + wave));
}

function clampSpeedKmh(v) {
  return Math.max(4, Math.min(SPEED_CAP_KMH, v));
}

function speedTestInbound(percent, prev, trafficMul) {
  let target = 36 + Math.random() * 10;
  if (percent > 94) target = Math.min(target, 12 + Math.random() * 8);
  else if (percent > 85) target = Math.min(target, 22 + Math.random() * 9);
  let s;
  if (prev === undefined) s = Math.max(10, Math.min(55, target));
  else s = Math.max(8, Math.min(58, prev + (target - prev) * 0.32 + (Math.random() - 0.5) * 4));
  return clampSpeedKmh(s * trafficMul);
}

function speedTestOutbound(percent, prev, trafficMul) {
  let target = 35 + Math.random() * 10;
  if (percent < 12) target = Math.min(target, 12 + Math.random() * 8);
  else if (percent < 22) target = Math.min(target, 21 + Math.random() * 9);
  let s;
  if (prev === undefined) s = Math.max(10, Math.min(55, target));
  else s = Math.max(8, Math.min(58, prev + (target - prev) * 0.32 + (Math.random() - 0.5) * 4));
  return clampSpeedKmh(s * trafficMul);
}

function speedTestCruise(percent, towardsLipa, prev, trafficMul) {
  const nearTerminal = towardsLipa ? 100 - percent : percent;
  let target = 33 + Math.random() * 12;
  if (nearTerminal < 5) target = Math.min(target, 10 + Math.random() * 9);
  else if (nearTerminal < 12) target = Math.min(target, 18 + Math.random() * 10);
  let s;
  if (prev === undefined) s = Math.max(9, Math.min(54, target));
  else s = Math.max(7, Math.min(57, prev + (target - prev) * 0.3 + (Math.random() - 0.5) * 4.5));
  return clampSpeedKmh(s * trafficMul);
}

function simulateOneFrame({ positions, prevSpeed, v01, cruiseState, offlineCycle, reportedAtIso, simFrameCounter }) {
  const simFrame = simFrameCounter.n++;
  const now = reportedAtIso;
  const rows = TEST_VEHICLES.map((v, i) => {
    let positionPercent = positions[i];
    let speed_kmh;
    const trafficMul = quickTrafficMultiplier(simFrame, i);

    if (i === 0) {
      if (v01.phase === 'dwell') {
        speed_kmh = round1(2 + Math.random() * 3);
        positionPercent = 100;
        v01.dwellLeft -= 1;
        if (v01.dwellLeft <= 0) v01.phase = 'outbound';
      } else if (v01.phase === 'inbound') {
        speed_kmh = speedTestInbound(positionPercent, prevSpeed[v.device_id], trafficMul);
        const d = percentDeltaForSpeed(speed_kmh, INTERVAL_MS);
        if (positionPercent + d >= 100) {
          positionPercent = 100;
          v01.phase = 'dwell';
          v01.dwellLeft = DWELL_TICKS;
        } else {
          positionPercent += d;
        }
      } else {
        speed_kmh = speedTestOutbound(positionPercent, prevSpeed[v.device_id], trafficMul);
        const d = percentDeltaForSpeed(speed_kmh, INTERVAL_MS);
        positionPercent = Math.max(0, positionPercent - d);
      }
    } else {
      const st = cruiseState[i];
      if (st.dwell > 0) {
        st.dwell -= 1;
        speed_kmh = round1(2 + Math.random() * 4);
        positionPercent = st.clampedAt === 'max' ? 100 : 0;
      } else if (st.sanJoseDwell > 0) {
        st.sanJoseDwell -= 1;
        speed_kmh = round1(1 + Math.random() * 3);
        positionPercent = SAN_JOSE_POSITION;
      } else {
        const towardsLipa = st.dir === 1;
        speed_kmh = speedTestCruise(positionPercent, towardsLipa, prevSpeed[v.device_id], trafficMul);
        const d = percentDeltaForSpeed(speed_kmh, INTERVAL_MS);
        const next = positionPercent + st.dir * d;
        positionPercent = st.dir === 1 ? Math.min(100, next) : Math.max(0, next);
        if (st.dir === 1 && positionPercent >= 99.85) {
          positionPercent = 100;
          st.clampedAt = 'max';
          st.dwell = 2 + (i % 3);
          st.dir = -1;
        } else if (st.dir === -1 && positionPercent <= 0.15) {
          positionPercent = 0;
          st.clampedAt = 'min';
          st.dwell = 2 + ((i + 1) % 3);
          st.dir = 1;
        }
        if (st.sanJoseDwell === 0 && Math.abs(positionPercent - SAN_JOSE_POSITION) <= SAN_JOSE_BAND) {
          positionPercent = SAN_JOSE_POSITION;
          st.sanJoseDwell = SAN_JOSE_DWELL_TICKS;
          speed_kmh = round1(1 + Math.random() * 3);
        }
      }
    }

    prevSpeed[v.device_id] = speed_kmh;
    positions[i] = positionPercent;

    const { lat, lng } = positionToLatLng(positionPercent);
    let headingTowardLipa;
    let directionDeg;
    if (i === 0) {
      if (v01.phase === 'dwell') {
        headingTowardLipa = false;
        directionDeg = BEARING_TO_BATANGAS;
      } else if (v01.phase === 'inbound') {
        headingTowardLipa = true;
        directionDeg = BEARING_TO_LIPA;
      } else {
        headingTowardLipa = false;
        directionDeg = BEARING_TO_BATANGAS;
      }
    } else {
      const st = cruiseState[i];
      const towardsLipa = st.dir === 1;
      headingTowardLipa = towardsLipa;
      directionDeg = towardsLipa ? BEARING_TO_LIPA : BEARING_TO_BATANGAS;
    }

    // V03 (i===2) cycles offline periodically
    let vehicleStatus = 'online';
    if (i === 2) {
      offlineCycle.ticksUntilToggle -= 1;
      if (offlineCycle.ticksUntilToggle <= 0) {
        offlineCycle.isOffline = !offlineCycle.isOffline;
        offlineCycle.ticksUntilToggle = offlineCycle.isOffline
          ? 8 + Math.floor(Math.random() * 5)
          : 25 + Math.floor(Math.random() * 15);
      }
      if (offlineCycle.isOffline) vehicleStatus = 'offline';
    }

    return {
      device_id: v.device_id,
      vehicle_name: v.vehicle_name,
      latitude: lat,
      longitude: lng,
      speed_kmh: round1(speed_kmh),
      position_percent: round1(positionPercent),
      direction: round1(directionDeg),
      heading_toward_lipa: headingTowardLipa,
      status: vehicleStatus,
      reported_at: now,
      updated_at: now,
    };
  });
  return rows;
}

function impliedSpeedKmhForWindow(prevPct, currPct, dtMs) {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return null;
  const km = (Math.abs(currPct - prevPct) / 100) * ROUTE_TOTAL_KM;
  const h = dtMs / 3600000;
  const v = km / h;
  return Number.isFinite(v) ? Math.min(SPEED_CAP_KMH, Math.max(0, v)) : null;
}

async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const positions = INITIAL_POSITION.map((p) => p);
  const prevSpeed = {};
  const v01 = { phase: 'inbound', dwellLeft: 0 };
  const cruiseState = {
    1: { dir: !TEST_VEHICLES[1].towardsBatangas ? 1 : -1, dwell: 0, clampedAt: null, sanJoseDwell: 0 },
    2: { dir: !TEST_VEHICLES[2].towardsBatangas ? 1 : -1, dwell: 0, clampedAt: null, sanJoseDwell: 0 },
    3: { dir: !TEST_VEHICLES[3].towardsBatangas ? 1 : -1, dwell: 0, clampedAt: null, sanJoseDwell: 0 },
  };
  const offlineCycle = { ticksUntilToggle: 30, isOffline: false };
  const runStartedMs = Date.now();
  let simMs = 0;
  const advanceSimIso = () => {
    simMs += INTERVAL_MS;
    return new Date(runStartedMs + simMs).toISOString();
  };

  let prevPublishedPct = INITIAL_POSITION.map((p) => p);
  const simFrameCounter = { n: 0 };

  console.log(`[quick] ${ROUTE_TOTAL_KM} km · ${INTERVAL_SEC}s realistic frames · ${RUN_DURATION_SEC}s wall (${TICKS} publishes).`);
  console.log(`  Sampling: publish 1 frame, skip ${SKIPPED_PER_PUBLISH} frames (every ${SAMPLE_EVERY_TICKS} realistic ticks).`);
  console.log('  V01: Lipa terminal cycle; V02–V04: Lipa ↔ Batangas with staggered dwells.');
  console.log(
    `  Speed: about 28–${SPEED_CAP_KMH} km/h (private transport profile) + ${QUICK_TRAFFIC_CYCLE_MIN}m traffic cycle.`
  );
  console.log('  Real-time all-frame mode: `npm run simulate-tracker-realistic`.');
  console.log('');

  for (let publishTick = 0; publishTick < TICKS; publishTick++) {
    const reportedAtIso = advanceSimIso();
    let rows = simulateOneFrame({
      positions,
      prevSpeed,
      v01,
      cruiseState,
      offlineCycle,
      reportedAtIso,
      simFrameCounter,
    });

    const dtMs = publishTick === 0 ? INTERVAL_MS : SAMPLE_EVERY_TICKS * INTERVAL_MS;
    for (let i = 0; i < rows.length; i++) {
      const dPct = Math.abs(rows[i].position_percent - prevPublishedPct[i]);
      const implied = impliedSpeedKmhForWindow(prevPublishedPct[i], rows[i].position_percent, dtMs);
      if (implied !== null && dPct >= IMPLIED_SPEED_MIN_DELTA_PCT) {
        rows[i].speed_kmh = round1(clampSpeedKmh(implied));
      }
      /* else: keep last-frame simulated speed so clamps / dwell don’t publish 0 km/h → client ETA "N/A". */
    }

    const { error } = await upsertTrackerLatestRows(supabase, rows);
    if (error) {
      console.error('Tick', publishTick + 1, 'upsert error:', error.message);
      if (String(error.message || '').includes('heading_toward_lipa')) {
        console.error('  Run migration: supabase/migrations/20250324_add_heading_toward_lipa_to_tracker_latest.sql');
      }
      process.exit(1);
    }

    const v01row = rows.find((r) => r.device_id === 'TEST-V01');
    const kmApprox = (v01row.position_percent / 100) * ROUTE_TOTAL_KM;
    const wallSec = publishTick * INTERVAL_SEC;
    const simSec = simMs / 1000;
    console.log(
      `Tick ${publishTick + 1}/${TICKS} (wall ${wallSec}s · sim t≈${round1(simSec)}s): V01 ${v01row.position_percent}% (~${round1(kmApprox)} km) ${v01.phase} ${v01row.speed_kmh} km/h`
    );

    for (let skipped = 0; skipped < SKIPPED_PER_PUBLISH; skipped++) {
      simulateOneFrame({
        positions,
        prevSpeed,
        v01,
        cruiseState,
        offlineCycle,
        reportedAtIso: advanceSimIso(),
        simFrameCounter,
      });
    }

    prevPublishedPct = rows.map((r) => r.position_percent);

    if (publishTick < TICKS - 1) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  console.log('');
  console.log('Done. Check your tracker UI.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
