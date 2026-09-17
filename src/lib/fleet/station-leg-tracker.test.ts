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

const batangas = stations.find((s) => s.id === '3')!;
const sanJose = stations.find((s) => s.id === '2')!;
const mataas = stations.find((s) => s.id === '1')!;

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

  it('from Batangas eastbound → San Jose', () => {
    const n = nextWaypointAfterLeaving(batangas, bus({ currentPosition: 5 }), ord);
    expect(n?.id).toBe(sanJose.id);
  });

  it('from San Jose eastbound → Mataas', () => {
    const n = nextWaypointAfterLeaving(sanJose, bus({ currentPosition: sanJose.position + 2 }), ord);
    expect(n?.id).toBe(mataas.id);
  });

  it('from Mataas eastbound → SM (corridor end)', () => {
    const n = nextWaypointAfterLeaving(mataas, bus({ currentPosition: mataas.position + 1 }), ord);
    expect(n?.id).toBe(SM_CORRIDOR_STATION_ID);
  });

  it('from SM westbound → Mataas', () => {
    const n = nextWaypointAfterLeaving(sm, bus({ currentPosition: 90, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(mataas.id);
  });

  it('from SM westbound still resolves Mataas when position is just under 100% (terminus tail)', () => {
    const n = nextWaypointAfterLeaving(sm, bus({ currentPosition: 99.95, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(mataas.id);
  });

  it('from Mataas westbound → San Jose', () => {
    const n = nextWaypointAfterLeaving(mataas, bus({ currentPosition: mataas.position - 1, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(sanJose.id);
  });

  it('from San Jose westbound → Batangas', () => {
    const n = nextWaypointAfterLeaving(sanJose, bus({ currentPosition: sanJose.position - 2, headingTowardLipa: false }), ord);
    expect(n?.id).toBe(batangas.id);
  });

  for (let i = 0; i < 100; i++) {
    it(`param Mataas→SM east offset ${i} → SM`, () => {
      const pos = mataas.position + 0.15 + i * 0.0005;
      const n = nextWaypointAfterLeaving(mataas, bus({ currentPosition: pos }), ord);
      expect(n?.id).toBe(SM_CORRIDOR_STATION_ID);
    });
  }

  for (let i = 0; i < 50; i++) {
    it(`param SM→Mataas west offset ${i} → Mataas`, () => {
      const pos = 99.5 - i * 0.001;
      const n = nextWaypointAfterLeaving(sm, bus({ currentPosition: pos, headingTowardLipa: false }), ord);
      expect(n?.id).toBe(mataas.id);
    });
  }
});

describe('tickStationLegs integration', () => {
  it('records Batangas → San Jose leg with minute-consistent duration', () => {
    const mem = createLegTrackerMemory();
    const found: StationLegRecord[] = [];
    const push = (r: StationLegRecord) => found.push(r);

    tickStationLegs([bus({ currentPosition: batangas.position })], stations, mem, push, { nowMs: 1_000_000 });
    expect(mem.prevAtId.get('unit-bus')).toBe(batangas.id);

    tickStationLegs([bus({ currentPosition: 12 })], stations, mem, push, { nowMs: 1_300_000 });
    expect(mem.openLeg.get('unit-bus')?.toId).toBe(sanJose.id);

    tickStationLegs([bus({ currentPosition: sanJose.position })], stations, mem, push, { nowMs: 1_900_000 });
    expect(found).toHaveLength(1);
    expect(found[0].fromLabel).toBe(batangas.name);
    expect(found[0].toLabel).toBe(sanJose.name);
    expect(found[0].durationMs).toBe(600_000);
    expect(formatLegDurationMinutesRounded(found[0].durationMs)).toBe('10 min');
    expect(formatLegDurationMs(found[0].durationMs)).toMatch(/10/);
  });

  it('records Mataas → SM then SM → Mataas round trip legs', () => {
    const mem = createLegTrackerMemory();
    const found: StationLegRecord[] = [];
    const push = (r: StationLegRecord) => found.push(r);

    tickStationLegs([bus({ currentPosition: mataas.position })], stations, mem, push, { nowMs: 5_000_000 });
    tickStationLegs([bus({ currentPosition: mataas.position + 0.5 })], stations, mem, push, { nowMs: 5_060_000 });
    tickStationLegs([bus({ currentPosition: 100 })], stations, mem, push, { nowMs: 5_420_000 });
    expect(found.some((r) => r.toLabel === 'SM Lipa' && r.fromLabel === mataas.name)).toBe(true);

    tickStationLegs([bus({ currentPosition: 100, headingTowardLipa: false })], stations, mem, push, { nowMs: 5_500_000 });
    tickStationLegs([bus({ currentPosition: 92, headingTowardLipa: false })], stations, mem, push, { nowMs: 5_560_000 });
    tickStationLegs([bus({ currentPosition: mataas.position, headingTowardLipa: false })], stations, mem, push, {
      nowMs: 5_800_000,
    });
    expect(found.some((r) => r.fromLabel === 'SM Lipa' && r.toLabel === mataas.name)).toBe(true);
  });

});
