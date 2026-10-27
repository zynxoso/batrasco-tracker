import { BATRASCO_ROUTE_PATH } from '../../data/batrasco-route-path';
import { stations } from '../../data/route-stations';
import { distanceKm } from '../route/distance';

// Pure, local simulation. This module never reads or writes tracker records.
const cumulative = [0];
for (let i = 1; i < BATRASCO_ROUTE_PATH.length; i++) {
  const a = BATRASCO_ROUTE_PATH[i - 1];
  const b = BATRASCO_ROUTE_PATH[i];
  cumulative.push(cumulative[i - 1] + distanceKm(a[0], a[1], b[0], b[1]));
}
const corridorKm = cumulative[cumulative.length - 1];
export const demoStops = [...stations].sort((a, b) => a.position - b.position)
  .map(stop => ({ ...stop, km: stop.position / 100 * corridorKm }));
export const demoRouteKm = demoStops[demoStops.length - 1].km;
export const DWELL_SECONDS = 45;

export function coordinatesAt(km: number): [number, number] {
  const target = Math.max(0, Math.min(corridorKm, km));
  let low = 1;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cumulative[mid] < target) low = mid + 1;
    else high = mid;
  }
  const a = BATRASCO_ROUTE_PATH[low - 1];
  const b = BATRASCO_ROUTE_PATH[low];
  const length = cumulative[low] - cumulative[low - 1];
  const fraction = length > 0 ? (target - cumulative[low - 1]) / length : 0;
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
}

export const demoRoutePath: [number, number][] = BATRASCO_ROUTE_PATH
  .filter((_, i) => cumulative[i] < demoRouteKm)
  .map(([lat, lng]) => [lat, lng]);
demoRoutePath.push(coordinatesAt(demoRouteKm));

export const demoBuses = [
  { id: 'DEMO-01', name: 'Bus 01', color: '#087f6b', offset: demoStops[1].km / 34 * 3600 - 90 },
  { id: 'DEMO-02', name: 'Bus 02', color: '#2563eb', offset: 320 },
  { id: 'DEMO-03', name: 'Bus 03', color: '#b45309', offset: 2900 },
];
const legs = [
  { from: 0, to: 1, speed: 34 }, { from: 1, to: 2, speed: 42 },
  { from: 2, to: 1, speed: 38 }, { from: 1, to: 0, speed: 32 },
].map(leg => ({ ...leg, seconds: Math.abs(demoStops[leg.to].km - demoStops[leg.from].km) / leg.speed * 3600 }));
export const cycleSeconds = legs.reduce((sum, leg) => sum + leg.seconds + DWELL_SECONDS, 0);

export function sampleBus(elapsedSeconds: number, bus = demoBuses[0]) {
  let time = ((elapsedSeconds + bus.offset) % cycleSeconds + cycleSeconds) % cycleSeconds;
  for (const leg of legs) {
    const from = demoStops[leg.from];
    const to = demoStops[leg.to];
    if (time < leg.seconds + DWELL_SECONDS) {
      const stopped = time >= leg.seconds;
      const fraction = Math.min(1, time / leg.seconds);
      const km = from.km + (to.km - from.km) * fraction;
      return {
        ...bus, km, coordinates: coordinatesAt(km), stopped,
        speed: stopped ? 0 : leg.speed,
        direction: leg.to > leg.from ? 'Lipa City' : 'Batangas City',
        nextStop: to,
        etaSeconds: Math.max(0, leg.seconds - time),
        departureSeconds: stopped ? leg.seconds + DWELL_SECONDS - time : 0,
        remainingKm: Math.abs(to.km - km),
      };
    }
    time -= leg.seconds + DWELL_SECONDS;
  }
  throw new Error('Invalid simulation time');
}
export type DemoBusState = ReturnType<typeof sampleBus>;
