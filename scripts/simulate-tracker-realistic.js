#!/usr/bin/env node
/**
 * Realistic mock (5 s interval): gradual speed changes, stop-aware pacing + 21 km physics.
 * Default run: 1800 s (~30 min) so a bus can reach Lipa (~100%) at plausible speeds from ~12%.
 *
 * Env: SIMULATE_REALISTIC_SEC (preferred), or SIMULATE_DURATION_SEC, default 1800.
 * Optional traffic tuning:
 *   SIMULATE_TRAFFIC_CYCLE_MIN (default 60, repeats congestion pattern every N mins)
 *   SIMULATE_TRAFFIC_SPIKE_CHANCE (default 0.04 per tick while moving)
 * Pairing: simulate-tracker-test.js = quick 2‑minute-style default with choppier speeds.
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
  { device_id: 'TEST-V01', vehicle_name: '482-KQJ', baseSpeed: 44, towardsBatangas: false, passengers: 8 },
  { device_id: 'TEST-V02', vehicle_name: '917-XLM', baseSpeed: 42, towardsBatangas: false, passengers: 16 },
  { device_id: 'TEST-V03', vehicle_name: '305-TRZ', baseSpeed: 46, towardsBatangas: false, passengers: 20 },
  { device_id: 'TEST-V04', vehicle_name: '864-PWB', baseSpeed: 43, towardsBatangas: true, passengers: 3 },
];

const INITIAL_POSITION = [12, 45, 65, 92];

/** San Jose mid-station band: position_percent within this of 50% triggers a brief dwell. */
const SAN_JOSE_POSITION = 50;
const SAN_JOSE_BAND = 2.5;
const SAN_JOSE_DWELL_TICKS = 4;

const INTERVAL_MS = 5000;
const RUN_DURATION_SEC = Math.max(
  INTERVAL_MS / 1000,
  parseInt(process.env.SIMULATE_REALISTIC_SEC || process.env.SIMULATE_DURATION_SEC || '1800', 10)
);
const TICKS = Math.floor(RUN_DURATION_SEC / (INTERVAL_MS / 1000));
const INTERVAL_SEC = INTERVAL_MS / 1000;
const TRAFFIC_CYCLE_MIN = Math.max(10, parseInt(process.env.SIMULATE_TRAFFIC_CYCLE_MIN || '60', 10));
// Start the traffic cycle near a congestion peak so "traffic" is visible quickly during short runs.
const TRAFFIC_PHASE_OFFSET_MIN = Math.max(0, parseFloat(process.env.SIMULATE_TRAFFIC_PHASE_OFFSET_MIN || '13'));
const TRAFFIC_SPIKE_CHANCE = Math.max(
  0,
  Math.min(0.25, parseFloat(process.env.SIMULATE_TRAFFIC_SPIKE_CHANCE || '0.055'))
);

/** Private transport profile: faster than buses, still non-expressway. */
const SPEED_CAP_KMH = 64;

const DWELL_TICKS = 3;

function round1(x) {
  return Math.round(x * 10) / 10;
}

function trafficMultiplier(tick, vehicleIndex) {
  const simMin = (tick * INTERVAL_SEC) / 60;
  const phase = ((simMin + vehicleIndex * 5 + TRAFFIC_PHASE_OFFSET_MIN) % TRAFFIC_CYCLE_MIN) / TRAFFIC_CYCLE_MIN;

  // Two daily-like peaks inside a repeating traffic cycle (stronger = more time in slow traffic).
  const morningPeak = Math.exp(-Math.pow((phase - 0.22) / 0.12, 2));
  const eveningPeak = Math.exp(-Math.pow((phase - 0.74) / 0.14, 2));
  const peakPenalty = 0.42 * morningPeak + 0.31 * eveningPeak;

  // Stop-and-go baseline jitter so speed is never perfectly smooth.
  const wave = 0.09 * Math.sin((simMin + vehicleIndex * 3) * 0.72);
  // Lower floor so some frames reliably cross the UI traffic threshold.
  const trafficMinMultiplier = Math.max(0.05, Math.min(0.7, parseFloat(process.env.SIMULATE_TRAFFIC_MIN_MULTIPLIER || '0.2')));
  return Math.max(trafficMinMultiplier, Math.min(0.98, 1 - peakPenalty + wave));
}

function nextTrafficSpikeTicks(previous, moving) {
  if (previous > 0) return previous - 1;
  if (!moving) return 0;
  if (Math.random() < TRAFFIC_SPIKE_CHANCE) {
    return 7 + Math.floor(Math.random() * 12); // ~35–95s micro-jam
  }
  return 0;
}

function calculateSpeed(positionPercent, baseSpeed, previousSpeed, trafficFactor, jamTicks) {
  const distanceFromStop = Math.min(positionPercent, 100 - positionPercent);
  const positionModifier = Math.max(0.6, Math.min(1.0, distanceFromStop / 24));
  const jamFactor = jamTicks > 0 ? 0.36 : 1;
  const targetSpeed = baseSpeed * positionModifier * trafficFactor * jamFactor;

  if (previousSpeed === undefined) {
    const variation = (Math.random() - 0.5) * 5;
    return Math.max(8, Math.min(SPEED_CAP_KMH, targetSpeed + variation));
  }

  const speedDiff = targetSpeed - previousSpeed;
  const changeRate = 0.28;
  const newSpeed = previousSpeed + speedDiff * changeRate;
  const randomVariation = (Math.random() - 0.5) * 3.5;
  return Math.max(7, Math.min(SPEED_CAP_KMH, newSpeed + randomVariation));
}

async function run() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const positions = INITIAL_POSITION.map((p) => p);
  const previousSpeeds = {};
  const trafficSpikeById = {};
  const v01 = { phase: 'inbound', dwellLeft: 0 };

  /** V02–V04: ping-pong with terminal + mid-station dwell (like quick mock). */
  const cruiseState = {
    1: { dir: !TEST_VEHICLES[1].towardsBatangas ? 1 : -1, dwell: 0, clampedAt: null, sanJoseDwell: 0 },
    2: { dir: !TEST_VEHICLES[2].towardsBatangas ? 1 : -1, dwell: 0, clampedAt: null, sanJoseDwell: 0 },
    3: { dir: !TEST_VEHICLES[3].towardsBatangas ? 1 : -1, dwell: 0, clampedAt: null, sanJoseDwell: 0 },
  };

  /** V03 goes offline periodically to demonstrate the offline state. */
  const offlineCycle = { ticksUntilToggle: 80, isOffline: false };

  console.log(
    `[realistic] ${ROUTE_TOTAL_KM} km · ${INTERVAL_MS / 1000}s interval · ${RUN_DURATION_SEC}s (${TICKS} ticks) · cap ${SPEED_CAP_KMH} km/h`
  );
  console.log(
    `  Traffic: cyclical congestion (${TRAFFIC_CYCLE_MIN}m cycle) + micro-jams · base cruise ~42–46 km/h before traffic.`
  );
  console.log('  V01: Lipa terminal cycle; V02–V04: stop-aware cruise with traffic.');
  console.log('');

  for (let tick = 0; tick < TICKS; tick++) {
    const now = new Date().toISOString();
    const rows = TEST_VEHICLES.map((v, i) => {
      let positionPercent = positions[i];
      let speed_kmh;
      const trafficFactor = trafficMultiplier(tick, i);
      const isMoving = i !== 0 || v01.phase !== 'dwell';
      trafficSpikeById[v.device_id] = nextTrafficSpikeTicks(trafficSpikeById[v.device_id] || 0, isMoving);
      const jamTicks = trafficSpikeById[v.device_id] || 0;

      if (i === 0) {
        const v1 = TEST_VEHICLES[0];
        if (v01.phase === 'dwell') {
          speed_kmh = 2 + Math.random() * 4;
          positionPercent = 100;
          v01.dwellLeft -= 1;
          if (v01.dwellLeft <= 0) v01.phase = 'outbound';
        } else if (v01.phase === 'inbound') {
          speed_kmh = calculateSpeed(positionPercent, v1.baseSpeed, previousSpeeds[v.device_id], trafficFactor, jamTicks);
          const d = percentDeltaForSpeed(speed_kmh, INTERVAL_MS);
          if (positionPercent + d >= 100) {
            positionPercent = 100;
            v01.phase = 'dwell';
            v01.dwellLeft = DWELL_TICKS;
          } else {
            positionPercent += d;
          }
        } else {
          speed_kmh = calculateSpeed(positionPercent, v1.baseSpeed, previousSpeeds[v.device_id], trafficFactor, jamTicks);
          const d = percentDeltaForSpeed(speed_kmh, INTERVAL_MS);
          positionPercent = Math.max(0, positionPercent - d);
        }
      } else {
        const st = cruiseState[i];
        if (st.dwell > 0) {
          st.dwell -= 1;
          speed_kmh = 2 + Math.random() * 4;
          positionPercent = st.clampedAt === 'max' ? 100 : 0;
        } else if (st.sanJoseDwell > 0) {
          st.sanJoseDwell -= 1;
          speed_kmh = 1 + Math.random() * 3;
          positionPercent = SAN_JOSE_POSITION;
        } else {
          speed_kmh = calculateSpeed(positionPercent, v.baseSpeed, previousSpeeds[v.device_id], trafficFactor, jamTicks);
          const d = percentDeltaForSpeed(speed_kmh, INTERVAL_MS);
          const next = positionPercent + st.dir * d;
          positionPercent = st.dir === 1 ? Math.min(100, next) : Math.max(0, next);
          if (st.dir === 1 && positionPercent >= 99.85) {
            positionPercent = 100;
            st.clampedAt = 'max';
            st.dwell = DWELL_TICKS + (i % 3);
            st.dir = -1;
          } else if (st.dir === -1 && positionPercent <= 0.15) {
            positionPercent = 0;
            st.clampedAt = 'min';
            st.dwell = DWELL_TICKS + ((i + 1) % 3);
            st.dir = 1;
          }
          if (st.sanJoseDwell === 0 && Math.abs(positionPercent - SAN_JOSE_POSITION) <= SAN_JOSE_BAND) {
            positionPercent = SAN_JOSE_POSITION;
            st.sanJoseDwell = SAN_JOSE_DWELL_TICKS;
            speed_kmh = 1 + Math.random() * 3;
          }
        }
      }

      previousSpeeds[v.device_id] = speed_kmh;
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
            ? 15 + Math.floor(Math.random() * 10)
            : 60 + Math.floor(Math.random() * 40);
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

    const { error } = await upsertTrackerLatestRows(supabase, rows);
    if (error) {
      console.error('Tick', tick + 1, 'upsert error:', error.message);
      if (String(error.message || '').includes('heading_toward_lipa')) {
        console.error('  Run migration: supabase/migrations/20250324_add_heading_toward_lipa_to_tracker_latest.sql');
      }
      process.exit(1);
    }

    const speeds = rows.map((r) => `${r.vehicle_name}: ${r.speed_kmh} km/h`).join(', ');
    const v01row = rows.find((r) => r.device_id === 'TEST-V01');
    const kmApprox = (v01row.position_percent / 100) * ROUTE_TOTAL_KM;
    const trafficNow = round1(trafficMultiplier(tick, 0) * 100);
    console.log(
      `Tick ${tick + 1}/${TICKS} t=${tick * INTERVAL_SEC}s | traffic ${trafficNow}% flow | V01 ${v01row.position_percent}% (~${round1(kmApprox)} km) ${v01.phase} | ${speeds}`
    );

    if (tick < TICKS - 1) {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }

  console.log('');
  console.log('Done.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
