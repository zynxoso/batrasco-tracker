import type { Vehicle } from '../../App';
import type { TrackerHistoryPointClient } from '../../api/client';
import { stations as initialStations, type Station } from '../../data/route-stations';
import { demoBuses, sampleBus, corridorKm } from '../demo/bus-simulation';
import { projectLatLngOntoRoute } from '../route/route-geometry';
import { DEFAULT_ROUTE_ID, validEntity, validateRecord, type RegistryEntity } from './registry';
import { createLegTrackerMemory, tickStationLegs, type StationLegRecord } from './station-leg-tracker';

type Row = Record<string, any>;
type Unit = { seconds: number; enabled: boolean; interval: number; lastReport: number; reportedAt: string };
type State = {
  version: 1; elapsed: number; rate: number; playing: boolean; route: string;
  records: Record<RegistryEntity, Row[]>; units: Record<string, Unit>;
  history: Record<string, TrackerHistoryPointClient[]>; legs: StationLegRecord[];
};
const STORAGE_KEY = 'batrasco:demo-workspace:v1';
const MODE_KEY = 'batrasco:workspace-mode';
const idFor = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fleetUnits = ['68','10','09','07','71','05','69','87','02','06'];
function seed(): State {
  const stamp = new Date().toISOString();
  return {
    version: 1, elapsed: 0, rate: 20, playing: true, route: DEFAULT_ROUTE_ID,
    records: {
      routes: [{ id: DEFAULT_ROUTE_ID, code: 'BAT-LIP-001', name: 'Batangas–San Jose–Lipa', origin: 'Batangas City', destination: 'Lipa City', updated_at: stamp }],
      drivers: demoBuses.map((_, i) => ({ id: idFor(10 + i), name: `Demo Driver ${i + 1}`, phone: null, updated_at: stamp })),
      vehicles: fleetUnits.map((unit, i) => ({ id: idFor(20 + i), plate_number: unit, device_id: `SIM-${i + 1}`, driver_id: i < demoBuses.length ? idFor(10 + i) : null, route_id: DEFAULT_ROUTE_ID, capacity: 20, availability: 'active', updated_at: stamp })),
      stations: initialStations.map((s, i) => ({ id: idFor(30 + i), name: s.name, location: s.location, station_number: s.stationNumber, latitude: s.latitude, longitude: s.longitude, route_id: DEFAULT_ROUTE_ID, updated_at: stamp })),
    }, units: {}, history: {}, legs: [],
  };
}

/** Entirely local data adapter for the existing screens. No fetch or Supabase calls. */
export class DemoRuntime {
  state: State;
  storageError = '';
  private listeners = new Set<() => void>();
  private legMemory = createLegTrackerMemory();
  private lastSaved = 0;
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.state = seed();
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (saved) {
        const value = JSON.parse(saved);
        if (value.version === 1 && ['routes','drivers','vehicles','stations'].every(k => Array.isArray(value.records?.[k])) &&
            Number.isFinite(value.elapsed) && [1,20,60].includes(value.rate) && typeof value.playing === 'boolean' &&
            value.units && value.history && Array.isArray(value.legs)) this.state = value;
      }
    } catch { this.storageError = 'Saved demo data could not be read. Using starter records.'; }
    // Upgrade only the old starter roster; retain edits, archived records and trip history.
    const rows = this.state.records.vehicles;
    const legacy = rows.filter(row => demoBuses.some((bus, i) => row.id === idFor(20 + i) && row.plate_number === bus.id && row.device_id === `SIM-${i + 1}`));
    if (legacy.length) {
      for (const row of legacy) {
        const index = demoBuses.findIndex(bus => bus.id === row.plate_number);
        if (!rows.some(other => other.plate_number === fleetUnits[index])) row.plate_number = fleetUnits[index];
      }
      for (const row of seed().records.vehicles.slice(3)) if (!rows.some(other => other.id === row.id || other.plate_number === row.plate_number || other.device_id === row.device_id)) rows.push(row);
      this.save();
    }
    this.syncUnits();
    this.recordPoints();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.listeners.forEach(fn => fn()); }
  save = () => {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state)); this.storageError = ''; }
    catch { this.storageError = 'Browser storage is full or blocked. Changes work for this session but may not survive refresh.'; }
    this.lastSaved = Date.now();
  };
  private changed() { this.save(); this.notify(); }
  private syncUnits() {
    for (const row of this.state.records.vehicles) if (!this.state.units[row.id]) this.state.units[row.id] = { seconds: 0, enabled: true, interval: 15000, lastReport: -Infinity, reportedAt: new Date().toISOString() };
  }
  stations(route = this.state.route): Station[] {
    return this.state.records.stations.filter(r => !r.archived_at && r.route_id === route).map(r => ({
      id: String(r.station_number), stationNumber: r.station_number, name: r.name, location: r.location,
      latitude: r.latitude, longitude: r.longitude,
      position: projectLatLngOntoRoute(r.latitude, r.longitude).positionPercent,
    })).sort((a, b) => a.stationNumber - b.stationNumber);
  }
  private stops(route: string) {
    return this.stations(route).sort((a,b) => a.position - b.position)
      .filter((s, i, all) => !i || s.position - all[i - 1].position > .01)
      .map(s => ({ ...s, km: s.position / 100 * corridorKm }));
  }
  vehicles(): Vehicle[] {
    this.syncUnits();
    return this.state.records.vehicles.filter(r => !r.archived_at && r.route_id === this.state.route).map((row) => {
      const index = this.state.records.vehicles.findIndex(r => r.id === row.id);
      const unit = this.state.units[row.id];
      const stops = this.stops(row.route_id);
      const usable = stops.length >= 2 && this.state.records.routes.some(r => r.id === row.route_id && !r.archived_at);
      const model = { ...demoBuses[index % demoBuses.length], id: row.id, name: row.plate_number, offset: demoBuses[index % demoBuses.length].offset + Math.floor(index / 3) * 180 };
      const point = usable ? sampleBus(unit.seconds, model, stops) : null;
      const active = usable && row.availability === 'active' && unit.enabled;
      const moving = active && this.state.playing;
      return {
        id: row.id, deviceId: row.device_id || 'Unassigned', plateNumber: row.plate_number,
        driver: this.state.records.drivers.find(d => d.id === row.driver_id && !d.archived_at)?.name || 'Unassigned',
        capacity: row.capacity, passengers: active ? Math.min(row.capacity, 8 + index * 3) : 0,
        currentPosition: point ? point.km / corridorKm * 100 : 0,
        latitude: point?.coordinates[0], longitude: point?.coordinates[1],
        speed: moving ? point!.speed : 0, status: active ? 'online' : 'offline', trackerOnline: active,
        ingestEnabled: unit.enabled, scrapeIntervalMs: unit.interval, lastUpdated: unit.reportedAt,
        headingTowardLipa: point?.direction === 'Lipa City', remainingDistanceKm: point?.remainingKm,
        etaInDirectionOfTravel: !usable ? 'Add at least two route stations' : !active ? 'Tracking disabled' : !this.state.playing ? 'Demo paused' : point!.stopped ? `At ${point!.nextStop.name} · departs in ${Math.ceil(point!.departureSeconds)}s` : `${Math.ceil(point!.etaSeconds / 60)} min to ${point!.nextStop.name}`,
      };
    });
  }
  private recordPoints() {
    for (const vehicle of this.vehicles()) {
      const unit = this.state.units[vehicle.id];
      if (vehicle.status !== 'online' || unit.seconds - (unit.lastReport ?? -Infinity) < unit.interval / 1000) continue;
      unit.lastReport = unit.seconds;
      unit.reportedAt = new Date().toISOString();
      const point: TrackerHistoryPointClient = {
        device_id: vehicle.id, vehicle_name: vehicle.plateNumber, latitude: vehicle.latitude, longitude: vehicle.longitude,
        speed_kmh: vehicle.speed, position_percent: vehicle.currentPosition, reported_at: unit.reportedAt,
        stored_at: unit.reportedAt, status: vehicle.status, heading_toward_lipa: vehicle.headingTowardLipa,
      };
      this.state.history[vehicle.id] = [point, ...(this.state.history[vehicle.id] || [])].slice(0, 240);
    }
  }
  advance(realSeconds: number) {
    if (!this.state.playing || !Number.isFinite(realSeconds) || realSeconds <= 0) return;
    const seconds = Math.min(realSeconds, 1) * this.state.rate;
    this.state.elapsed += seconds;
    this.syncUnits();
    for (const row of this.state.records.vehicles) {
      const unit = this.state.units[row.id];
      if (!row.archived_at && row.availability === 'active' && unit.enabled && row.route_id === this.state.route) unit.seconds += seconds;
    }
    this.recordPoints();
    tickStationLegs(this.vehicles(), this.stations(), this.legMemory, leg => {
      this.state.legs = [{ ...leg, completedAt: Date.now() }, ...this.state.legs].slice(0, 80);
    }, { nowMs: this.state.elapsed * 1000 });
    if (Date.now() - this.lastSaved > 4000) this.save();
    this.notify();
  }
  setPlaying(enabled: boolean) { this.state.playing = enabled; this.changed(); }
  setRate(rate: number) { if (![1,20,60].includes(rate)) throw new Error('Invalid playback speed'); this.state.rate = rate; this.changed(); }
  setRoute(id: string) { if (!this.state.records.routes.some(r => r.id === id && !r.archived_at)) throw new Error('Route unavailable'); this.state.route = id; this.legMemory = createLegTrackerMemory(); this.recordPoints(); this.changed(); }
  setUnit(id: string, patch: Partial<Pick<Unit,'enabled'|'interval'>>) {
    const unit = this.state.units[id]; if (!unit) throw new Error('Vehicle not found');
    if (patch.interval != null && (!Number.isFinite(patch.interval) || patch.interval < 15000 || patch.interval > 300000)) throw new Error('Use an interval from 15 to 300 seconds');
    Object.assign(unit, patch); this.legMemory = createLegTrackerMemory(); this.changed();
  }
  restart() {
    this.state.elapsed = 0; this.state.units = {}; this.state.history = {}; this.state.legs = []; this.state.playing = true;
    this.legMemory = createLegTrackerMemory(); this.syncUnits(); this.recordPoints(); this.changed();
  }
  reset() { this.state = seed(); this.restart(); }
  history(id: string, limit: number) { return (this.state.history[id] || []).slice(0, Math.max(1, Math.min(limit,240))); }
  async request(url: string, init?: RequestInit) {
    const params = new URL(url, 'https://demo.local').searchParams;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const entity = params.get('entity') || body.entity;
    if (!validEntity(entity)) throw new Error('Invalid record type');
    const rows = this.state.records[entity];
    if (!init?.method || init.method === 'GET') {
      const search = (params.get('search') || '').toLowerCase();
      const archived = params.get('archived') === 'true';
      const filtered = rows.filter(r => !!r.archived_at === archived && [r.name,r.plate_number,r.code,r.phone,r.location].some(v => String(v || '').toLowerCase().includes(search)));
      const page = Math.max(0, Number(params.get('page')) || 0);
      return { records: structuredClone(filtered.slice(page * 25, page * 25 + 25)), total: filtered.length };
    }
    const existing = rows.find(r => r.id === body.id);
    if (init.method === 'PATCH' && !existing) throw new Error('Record not found');
    if (typeof body.archived === 'boolean' && existing) {
      if (body.archived && entity === 'routes' && existing.id === DEFAULT_ROUTE_ID) throw new Error('The default route cannot be archived');
      existing.archived_at = body.archived ? new Date().toISOString() : null;
      existing.updated_at = new Date().toISOString();
      if (body.archived && entity === 'routes' && this.state.route === existing.id) this.state.route = DEFAULT_ROUTE_ID;
    } else {
      const record = validateRecord(entity, body.record);
      for (const key of ['plate_number','device_id','code']) if (record[key] && rows.some(r => r.id !== body.id && r[key] === record[key])) throw new Error('That plate, device or route code already exists');
      if (entity === 'stations' && rows.some(r => r.id !== body.id && r.route_id === record.route_id && r.station_number === record.station_number)) throw new Error('Station number already exists on this route');
      for (const [field, kind] of [['route_id','routes'],['driver_id','drivers']] as const) if (record[field] && !this.state.records[kind].some(r => r.id === record[field] && !r.archived_at)) throw new Error('Choose an active assignment');
      const saved = { ...existing, ...record, id: existing?.id || crypto.randomUUID(), updated_at: new Date().toISOString() };
      const routeChanged = existing?.route_id !== record.route_id;
      if (existing) Object.assign(existing, saved); else rows.push(saved);
      if (entity === 'vehicles' && this.state.units[saved.id] && routeChanged) this.state.units[saved.id].seconds = 0;
    }
    this.legMemory = createLegTrackerMemory(); this.syncUnits(); this.recordPoints(); this.changed();
    return { ok: true };
  }
}

function browserStorage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } }
export const demoRuntime = new DemoRuntime(browserStorage());
let mode = browserStorage()?.getItem(MODE_KEY) !== 'live';
export const isDemoMode = () => mode;
export function setDemoMode(enabled: boolean) { mode = enabled; try { browserStorage()?.setItem(MODE_KEY, enabled ? 'demo' : 'live'); } catch {} }
