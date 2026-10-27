import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const compiled = await build({ entryPoints: ['src/lib/demo/bus-simulation.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const sim = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const bus = { ...sim.demoBuses[0], offset: 0 };
const firstLeg = sim.demoStops[1].km / 34 * 3600;
const secondLeg = (sim.demoStops[2].km - sim.demoStops[1].km) / 42 * 3600;

test('distance and ETA advance consistently at the displayed speed', () => {
  const a = sim.sampleBus(10, bus);
  const b = sim.sampleBus(70, bus);
  assert.ok(Math.abs(b.km - a.km - 34 / 60) < 1e-9);
  assert.ok(Math.abs(a.etaSeconds - b.etaSeconds - 60) < 1e-9);
  assert.notDeepEqual(a.coordinates, b.coordinates);
});
test('bus remains stationary for the full station dwell then departs', () => {
  const a = sim.sampleBus(firstLeg + 1, bus);
  const b = sim.sampleBus(firstLeg + 44, bus);
  assert.equal(a.speed, 0);
  assert.equal(b.stopped, true);
  assert.deepEqual(a.coordinates, b.coordinates);
  assert.ok(Math.abs(a.departureSeconds - 44) < 1e-8);
  const departing = sim.sampleBus(firstLeg + 46, bus);
  assert.equal(departing.stopped, false);
  assert.equal(departing.nextStop.id, sim.demoStops[2].id);
});
test('bus turns around at the last passenger stop', () => {
  const terminal = firstLeg + 45 + secondLeg;
  const waiting = sim.sampleBus(terminal + 1, bus);
  assert.equal(waiting.stopped, true);
  assert.ok(Math.abs(waiting.km - sim.demoRouteKm) < 1e-8);
  const returning = sim.sampleBus(terminal + 46, bus);
  assert.equal(returning.direction, 'Batangas City');
  assert.ok(returning.km < sim.demoRouteKm);
});
test('full circuit wraps without teleporting across the route', () => {
  const before = sim.sampleBus(sim.cycleSeconds - .01, bus);
  const after = sim.sampleBus(sim.cycleSeconds + .01, bus);
  assert.ok(Math.abs(after.km - before.km) < .001);
  assert.equal(after.direction, 'Lipa City');
});
test('all buses remain within passenger route through several circuits', () => {
  for (const vehicle of sim.demoBuses) {
    for (let t = 0; t < sim.cycleSeconds * 3; t += 7) {
      const state = sim.sampleBus(t, vehicle);
      assert.ok(state.km >= 0 && state.km <= sim.demoRouteKm);
      assert.ok(state.coordinates.every(Number.isFinite));
      assert.ok(state.etaSeconds >= 0 && state.departureSeconds >= 0);
      assert.ok(Number.isFinite(state.remainingKm));
    }
  }
});
test('restart is deterministic and initial buses are distinct', () => {
  assert.deepEqual(sim.sampleBus(0), sim.sampleBus(0));
  assert.equal(new Set(sim.demoBuses.map(vehicle => sim.sampleBus(0, vehicle).km)).size, 3);
});
