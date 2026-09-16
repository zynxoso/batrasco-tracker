/**
 * Fetch vehicle list directly from Supabase (client-side).
 * Use when project URL + anon key are available (Vite maps SUPABASE_URL → VITE_SUPABASE_URL and
 * SUPABASE_ANON_KEY → VITE_SUPABASE_ANON_KEY). The app
 * shows DB data even if the serverless /api/vehicles is not available (e.g. SPA rewrite).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  computeEtaInDirectionOfTravel,
  distanceKmToRouteTerminus,
  latLngToPositionPercent,
  resolveDirectionAlongRoute,
  ROUTE_LENGTH_KM,
} from '../route/route-geometry';
import { REAL_FLEET_ROSTER, getRealFleetDevice, sortByRealFleetRoster } from '../server/real-fleet-roster';
import type { VehicleFromApi } from '../../api/client';

const STALE_MS = 5 * 60 * 1000;

let supabaseInstance: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || !url || typeof key !== 'string' || !key) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        lock: async (_name, _acquireTimeout, fn) => await fn(),
      },
    });
  }
  return supabaseInstance;
}

export function canUseSupabaseDirect(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return typeof url === 'string' && url.length > 0 && typeof key === 'string' && key.length > 0;
}

export async function fetchVehiclesFromSupabase(): Promise<VehicleFromApi[] | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  // Select only columns that exist in the base schema; direction/battery_percent are optional (migration 20250220)
  const { data: rows, error } = await supabase
    .from('tracker_latest')
    .select(
      'device_id, vehicle_name, latitude, longitude, speed_kmh, position_percent, status, reported_at, updated_at, direction, battery_percent, heading_toward_lipa, ingest_enabled'
    );

  if (error || !rows?.length) return null;

  const now = Date.now();
  const vehicles: VehicleFromApi[] = rows.map((r) => {
    const row = r as Record<string, unknown>;
    const fromRealRoster = getRealFleetDevice(String(r.device_id));
    const reportedAt = new Date(r.reported_at).getTime();
    const trackerOnline = now - reportedAt < STALE_MS;
    const status = r.status === 'offline' ? 'offline' : 'online';
    const positionPercent =
      r.latitude != null && r.longitude != null && Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude))
        ? latLngToPositionPercent(Number(r.latitude), Number(r.longitude))
        : Number(r.position_percent);
    const speedKmh = Number(r.speed_kmh);
    const h = row.heading_toward_lipa;
    const dir =
      row.direction != null && !Number.isNaN(Number(row.direction)) ? Number(row.direction) : undefined;
    const towardLipa =
      resolveDirectionAlongRoute({
        headingTowardLipa: h === true ? true : h === false ? false : undefined,
        direction: dir,
        currentPosition: positionPercent,
      }) === 'to_lipa';
    const remainingDistanceKm = distanceKmToRouteTerminus(positionPercent, towardLipa);
    const remainingDistancePercent = ROUTE_LENGTH_KM > 0 ? (remainingDistanceKm / ROUTE_LENGTH_KM) * 100 : 0;
    const eta = computeEtaInDirectionOfTravel(positionPercent, speedKmh, towardLipa);
    const etaInDirectionOfTravel =
      eta.etaText === 'N/A' ? `N/A to ${eta.etaLabel}` : `${eta.etaText} to ${eta.etaLabel}`;
    const plateNumber =
      typeof r.vehicle_name === 'string' && r.vehicle_name.trim()
        ? r.vehicle_name.trim()
        : fromRealRoster?.deviceId ?? String(r.device_id);

    const devId = String(r.device_id);
    const hash = devId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return {
      id: devId,
      plateNumber,
      driver: '—',
      currentPosition: positionPercent,
      speed: speedKmh,
      status,
      passengers: 3 + (hash % 15),
      capacity: 20,
      trackerOnline,
      remainingDistancePercent,
      remainingDistanceKm,
      lastUpdated:
        row.updated_at != null && String(row.updated_at).trim()
          ? String(row.updated_at)
          : String(r.reported_at),
      ...(r.latitude != null && r.longitude != null
        ? { latitude: Number(r.latitude), longitude: Number(r.longitude) }
        : {}),
      etaInDirectionOfTravel,
      ...(h === true || h === false ? { headingTowardLipa: h } : {}),
      ...(dir !== undefined ? { direction: dir } : {}),
      ...(row.battery_percent != null ? { batteryPercent: Number(row.battery_percent) } : {}),
      ingestEnabled: row.ingest_enabled !== false,
    };
  });

  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
  for (const device of REAL_FLEET_ROSTER) {
    if (vehicleIds.has(device.deviceId)) continue;
    vehicles.push({
      id: device.deviceId,
      plateNumber: device.deviceId,
      driver: device.simNumber,
      currentPosition: 0,
      speed: 0,
      status: 'offline',
      passengers: 0,
      capacity: 20,
      trackerOnline: false,
      remainingDistancePercent: 0,
      remainingDistanceKm: 0,
      lastUpdated: '',
      etaInDirectionOfTravel: 'N/A to Batangas Grand Terminal',
      ingestEnabled: true,
    });
  }

  return sortByRealFleetRoster(vehicles);
}
