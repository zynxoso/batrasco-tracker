import { describe, expect, it } from 'vitest';
import type { Vehicle } from '../../App';
import { stations } from '../../data/route-stations';
import {
  SM_CORRIDOR_STATION_ID,
  createLegTrackerMemory,
  formatLegDurationMinutesRounded,
  formatLegDurationMs,
  nextWaypointAfterLeaving,
  stationsWithSmTerminal,
  tickStationLegs,
  type StationLegRecord,
} from './station-leg-tracker';

const palico = stations.find((s) => s.id === '1')!;
const mak = stations.find((s) => s.id === '2')!;
const jp = stations.find((s) => s.id === '3')!;

function bus(over: Partial<Vehicle>): Vehicle {
  return {
    id: 'unit-bus',
    plateNumber: 'TEST-001',
    driver: 'Unit',
    currentPosition: 0,
    speed: 40,
    status: 'online',
    passengers: 0,
    capacity: 20,
    headingTowardLipa: true,
    ...over,
  };
}

describe('nextWaypointAfterLeaving', () => {
  const ord = stationsWithSmTerminal(stations);
  const sm = ord.find((s) => s.id === SM_CORRIDOR_STATION_ID)!;

  it('from Palico eastbound → Mak', () => {
    const n = nextWaypointAfterLeaving(palico, bus({ currentPosition: 5 }), ord);
    expect(n?.id).toBe(mak.id);
  });

  it('from Mak eastbound → JP', () => {
    const n = nextWaypointAfterLeaving(mak, bus({ currentPosition: mak.position + 2 }), ord);
    expect(n?.id).toBe(jp.id);
  });

  it('from JP eastbound → SM (corridor end)', () => {
    const n = nextWaypointAfterLeaving(jp, bus({ currentPosition: jp.position + 1 }), ord);
    expect(n?.id).toBe(SM_CORRIDOR_STATION_ID);
  });

  it('from SM westbound → JP', () => {
    const n = nextWaypointAfterLeaving(sm, bus({ currentPosition: 90, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(jp.id);
  });

  it('from SM westbound still resolves JP when position is just under 100% (terminus tail)', () => {
    const n = nextWaypointAfterLeaving(sm, bus({ currentPosition: 99.95, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(jp.id);
  });

  it('from JP westbound → Mak', () => {
    const n = nextWaypointAfterLeaving(jp, bus({ currentPosition: jp.position - 1, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(mak.id);
  });

  it('from Mak westbound → Palico', () => {
    const n = nextWaypointAfterLeaving(mak, bus({ currentPosition: mak.position - 2, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(palico.id);
  });

  for (let i = 0; i < 100; i++) {
    it(`param JP→SM east offset ${i} → SM`, () => {
      const pos = jp.position + 0.15 + i * 0.0005;
      const n = nextWaypointAfterLeaving(jp, bus({ currentPosition: pos }), ord);
      expect(n?.id).toBe(SM_CORRIDOR_STATION_ID);
    });
  }

  for (let i = 0; i < 50; i++) {
    it(`param SM→JP west offset ${i} → JP`, () => {
      const pos = 99.5 - i * 0.001;
      const n = nextWaypointAfterLeaving(sm, bus({ currentPosition: pos, headingTowardLipa: false }), ord);
      expect(n?.id).toBe(jp.id);
    });
  }
});

describe('tickStationLegs integration', () => {
  it('records Palico → Mak leg with minute-consistent duration', () => {
    const mem = createLegTrackerMemory();
    const found: StationLegRecord[] = [];
    const push = (r: StationLegRecord) => found.push(r);

    tickStationLegs([bus({ currentPosition: palico.position })], stations, mem, push, { nowMs: 1_000_000 });
    expect(mem.prevAtId.get('unit-bus')).toBe(palico.id);

    tickStationLegs([bus({ currentPosition: 12 })], stations, mem, push, { nowMs: 1_300_000 });
    expect(mem.openLeg.get('unit-bus')?.toId).toBe(mak.id);

    tickStationLegs([bus({ currentPosition: mak.position })], stations, mem, push, { nowMs: 1_900_000 });
    expect(found).toHaveLength(1);
    expect(found[0].fromLabel).toBe(palico.name);
    expect(found[0].toLabel).toBe(mak.name);
    expect(found[0].durationMs).toBe(600_000);
    expect(formatLegDurationMinutesRounded(found[0].durationMs)).toBe('10 min');
    expect(formatLegDurationMs(found[0].durationMs)).toMatch(/10/);
  });

  it('records JP → SM then SM → JP round trip legs', () => {
    const mem = createLegTrackerMemory();
    const found: StationLegRecord[] = [];
    const push = (r: StationLegRecord) => found.push(r);

    tickStationLegs([bus({ currentPosition: jp.position })], stations, mem, push, { nowMs: 5_000_000 });
    tickStationLegs([bus({ currentPosition: jp.position + 0.5 })], stations, mem, push, { nowMs: 5_060_000 });
    tickStationLegs([bus({ currentPosition: 100 })], stations, mem, push, { nowMs: 5_420_000 });
    expect(found.some((r) => r.toLabel === 'SM Lipa' && r.fromLabel === jp.name)).toBe(true);

    tickStationLegs([bus({ currentPosition: 100, headingTowardLipa: false })], stations, mem, push, { nowMs: 5_500_000 });
    tickStationLegs([bus({ currentPosition: 92, headingTowardLipa: false })], stations, mem, push, { nowMs: 5_560_000 });
    tickStationLegs([bus({ currentPosition: jp.position, headingTowardLipa: false })], stations, mem, push, {
      nowMs: 5_800_000,
    });
    expect(found.some((r) => r.fromLabel === 'SM Lipa' && r.toLabel === jp.name)).toBe(true);
  });

});
