import type { Vehicle } from '../../App';
import {
  ETA_MIN_EFFECTIVE_SPEED_KMH,
  effectiveSpeedKmhForEta,
  resolveDirectionAlongRoute,
  ROUTE_LENGTH_KM,
} from '../route/route-geometry';

export type HeadwayRow = {
  vehicle: Vehicle;
  /** 1 = first to complete this direction’s run, then 2, … (convoy order). */
  arrivalOrder: number;
  /** km along the corridor to the next vehicle in front, or 0 for the lead. */
  gapKm: number;
  /** Minutes to cover *gap* at this vehicle’s effective speed; null = lead, no one ahead. */
  minutesToNext: number | null;
  isLead: boolean;
};

function formatMinutesForHeadway(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m < 1) return '< 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

export { formatMinutesForHeadway as formatHeadwayTime };

/**
 * In direction to Lipa, the lead is the highest `currentPosition` (farthest east);
 * in direction to Batangas, the lead is the lowest. Each vehicle (except the
 * lead) has the vehicle in front on the line as the next one **toward the
 * destination**; gap and “minutes to next” are from the follower's current
 * speed using the same effective-ETA speed floor as the rest of the app.
 */
export function buildHeadwayRows(vehicles: Vehicle[], toLipa: boolean): HeadwayRow[] {
  const dir = toLipa ? 'to_lipa' : 'to_batangas';
  const inDir = vehicles.filter(
    (v) => v.status === 'online' && resolveDirectionAlongRoute(v) === dir
  );
  if (inDir.length === 0) return [];

  const sorted = [...inDir].sort((a, b) =>
    toLipa ? b.currentPosition - a.currentPosition : a.currentPosition - b.currentPosition
  );

  return sorted.map((v, i) => {
    if (i === 0) {
      return { vehicle: v, arrivalOrder: 1, gapKm: 0, minutesToNext: null, isLead: true };
    }
    const ahead = sorted[i - 1]!;
    const gapKm =
      (Math.abs(ahead.currentPosition - v.currentPosition) / 100) * (ROUTE_LENGTH_KM || 1);
    const eff = effectiveSpeedKmhForEta(v.speed);
    const speed = eff > 0 ? Math.max(eff, ETA_MIN_EFFECTIVE_SPEED_KMH) : ETA_MIN_EFFECTIVE_SPEED_KMH;
    const minutesToNext = (gapKm / speed) * 60;
    return {
      vehicle: v,
      arrivalOrder: i + 1,
      gapKm,
      minutesToNext: Number.isFinite(minutesToNext) ? minutesToNext : null,
      isLead: false,
    };
  });
}
