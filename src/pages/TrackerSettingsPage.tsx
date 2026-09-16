import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  BusFront,
  ChevronDown,
  CircleHelp,
  Gauge,
  MapPinned,
  PanelLeft,
  Power,
  Satellite,
  Timer,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { Vehicle } from '../App';
import {
  fetchTrackerHistory,
  setVehicleIngestEnabled,
  setVehicleScrapeIntervalMs,
  type TrackerHistoryPointClient,
} from '../api/client';
import {
  isMasterTogglePaused,
  pauseAllTracking,
  resumeAllTracking,
  type MasterToggleProgress,
} from '../lib/fleet/tracker-master-toggle';
import { TrackerLocationsMap } from '../components/fleet/TrackerLocationsMap';
import { StationLegTimesPanel } from '../components/fleet/StationLegTimesPanel';
import { VehicleConvoyHeadwayPanel } from '../components/fleet/VehicleConvoyHeadwayPanel';
import { UiverseToggle } from '../components/ui/UiverseToggle';
import { cn } from '../components/ui/utils';
import { stations } from '../data/route-stations';
import { deviceTrackStatusLabel, getDeviceTrackStatus, isDeviceOnTrack } from '../lib/route/route-corridor';
import {
  createLegTrackerMemory,
  loadStationLegRecords,
  persistStationLegRecords,
  tickStationLegs,
  type StationLegRecord,
} from '../lib/fleet/station-leg-tracker';
import './TrackerSettingsPage.css';

type TrackerSettingsPageProps = {
  vehicles: Vehicle[];
  onIngestSettingsChanged?: () => void;
};

function formatTimestamp(value?: string) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatShortTime(value?: string) {
  if (!value) return 'No signal';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const STALE_MS = 5 * 60 * 1000;
const RELATIVE_TIME_CAP_MS = 24 * 60 * 60 * 1000;
const MOVING_SPEED_KMH = 3;

type SignalState = 'live' | 'delayed' | 'offline';

function getSignalState(vehicle: Vehicle): SignalState {
  if (vehicle.status === 'offline') return 'offline';
  if (!vehicle.lastUpdated) return 'delayed';
  const t = new Date(vehicle.lastUpdated).getTime();
  if (Number.isNaN(t)) return 'delayed';
  if (Date.now() - t > STALE_MS) return 'delayed';
  return 'live';
}

function formatRelativeTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  const t = date.getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  if (Date.now() - t > RELATIVE_TIME_CAP_MS) return formatShortTime(value);
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function isLikelyTechnicalError(message: string | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('json') ||
    m.includes('syntax') ||
    m.includes('500') ||
    m.includes('api failed') ||
    m.includes('network') ||
    m.includes('unexpected token')
  );
}

/** User-facing copy; keep raw text in `title` for support. */
function humanizeHistoryMessage(message: string | null): string {
  if (!message) return 'No route data available.';
  const m = message.toLowerCase();
  if (m.includes('invalid json') || (m.includes('json') && m.includes('invalid'))) {
    return 'No route data available.';
  }
  if (m.includes('select a device')) return 'Select a device to load route history.';
  if (m.includes('no history') || m.includes('no rows')) return 'No route points recorded for this device yet.';
  return message;
}

function formatCoordinate(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : 'Unavailable';
}

/**
 * The dashboard triggers POST /api/trackers-poll every 5s while the tab is visible;
 * the server gates SinoTrack scrapes by `tracker_latest.scrape_interval_ms` (min 15s here).
 * Map/list refresh uses GET /api/vehicles scheduled for 15s after server X-Fleet-Data-At.
 */
function formatIntervalLabel(intervalMs?: number) {
  if (!intervalMs || !Number.isFinite(intervalMs)) return '15s';
  const sec = Math.round(intervalMs / 1000);
  if (sec >= 60 && sec % 60 === 0) {
    const min = sec / 60;
    return `${min} min`;
  }
  return `${sec}s`;
}

function TrackValidatorHelpContent() {
  return (
    <div
      className="tracker-settings-page__track-instructions tracker-settings-page__track-legend--modal"
      role="document"
    >
      <p className="tracker-settings-page__track-instructions-lead">
        Use this reference while operating the <strong>Live monitor</strong>. It covers the BATRASCO route line,
        track-validation badges, map pin colors, and how they work together with the Tracking (ingest) switch.
      </p>

      <section className="tracker-settings-page__track-instructions-section" aria-labelledby="instr-route-line-heading">
        <h3 id="instr-route-line-heading" className="tracker-settings-page__track-instructions-h">
          1. The route line on the map
        </h3>
        <p className="tracker-settings-page__track-instructions-p">
          The <strong>solid blue polyline</strong> on the map is the BATRASCO authorized route. The app measures each
          vehicle’s <strong>latest reported GPS point</strong> to the nearest point on that line. The device counts as{' '}
          <strong>on track</strong> when that perpendicular distance is within <strong>50 meters</strong> of the
          polyline — wide enough to absorb normal GPS noise and the road width vs route centerline, but narrow enough
          that a unit that has genuinely left the route is flagged <strong>off track</strong>. This is a geometric
          check only — it does not look at schedules or driver identity.
        </p>
      </section>

      <section className="tracker-settings-page__track-instructions-section" aria-labelledby="instr-badges-heading">
        <h3 id="instr-badges-heading" className="tracker-settings-page__track-instructions-h">
          2. Track badges (validator)
        </h3>
        <p className="tracker-settings-page__track-instructions-p">
          Green, amber, and gray pills appear in the <strong>device list</strong>, <strong>device details</strong>, and
          the map HUD when a vehicle is selected. They mirror the same route-line logic as the map pins. Tap a badge
          anywhere to reopen these instructions.
        </p>
        <ul className="tracker-settings-page__track-legend-list m-0 list-none p-0">
          <li className="tracker-settings-page__track-legend-row">
            <span className="tracker-settings-page__track-pill tracker-settings-page__track-pill--on">On track</span>
            <span className="tracker-settings-page__track-legend-def">
              Validator <code className="tracker-settings-page__track-bool">true</code> — GPS is valid and the point
              is within 50 m of the route polyline.
            </span>
          </li>
          <li className="tracker-settings-page__track-legend-row">
            <span className="tracker-settings-page__track-pill tracker-settings-page__track-pill--off">Off track</span>
            <span className="tracker-settings-page__track-legend-def">
              Validator <code className="tracker-settings-page__track-bool">false</code> — GPS is valid but the point
              is more than 50 m from the route polyline.
            </span>
          </li>
          <li className="tracker-settings-page__track-legend-row tracker-settings-page__track-legend-row--muted">
            <span className="tracker-settings-page__track-pill tracker-settings-page__track-pill--none">No fix</span>
            <span className="tracker-settings-page__track-legend-def">
              No usable latitude/longitude — the validator cannot decide true or false until a fix arrives.
            </span>
          </li>
        </ul>
      </section>

      <section className="tracker-settings-page__track-instructions-section" aria-labelledby="instr-pins-heading">
        <h3 id="instr-pins-heading" className="tracker-settings-page__track-instructions-h">
          3. Map vehicle pins
        </h3>
        <p className="tracker-settings-page__track-instructions-p">
          Each circle marks a vehicle’s <strong>current position</strong> on the map. Pin color uses both
          <strong> Tracking</strong> and the <strong>route-line check</strong>.
        </p>
        <ul className="tracker-settings-page__track-legend-list m-0 list-none p-0">
          <li className="tracker-settings-page__track-legend-row">
            <span className="tracker-settings-page__map-pin-swatch tracker-settings-page__map-pin-swatch--on" aria-hidden />
            <span className="tracker-settings-page__track-legend-def">
              <strong className="tracker-settings-page__track-legend-pin-label tracker-settings-page__track-legend-pin-label--on">
                Blue
              </strong>{' '}
              — Tracking is <strong>On</strong> and the latest point is <strong>on track</strong>.
            </span>
          </li>
          <li className="tracker-settings-page__track-legend-row">
            <span className="tracker-settings-page__map-pin-swatch tracker-settings-page__map-pin-swatch--off" aria-hidden />
            <span className="tracker-settings-page__track-legend-def">
              <strong className="tracker-settings-page__track-legend-pin-label tracker-settings-page__track-legend-pin-label--off">
                Orange
              </strong>{' '}
              — Tracking is <strong>On</strong> and the latest point is <strong>off track</strong>.
            </span>
          </li>
          <li className="tracker-settings-page__track-legend-row tracker-settings-page__track-legend-row--muted">
            <span className="tracker-settings-page__map-pin-swatch tracker-settings-page__map-pin-swatch--none" aria-hidden />
            <span className="tracker-settings-page__track-legend-def">
              <strong className="tracker-settings-page__track-legend-pin-label tracker-settings-page__track-legend-pin-label--none">
                Gray
              </strong>{' '}
              — Tracking is <strong>Off</strong>.
            </span>
          </li>
        </ul>
        <p className="tracker-settings-page__track-instructions-p tracker-settings-page__track-instructions-p--tight">
          <strong>Focused vehicle:</strong> the selected pin is slightly larger with a stronger outline; color rules are
          the same. Click a pin again or use <strong>Clear selection</strong> in the map panel to return to the fleet
          overview.
        </p>
      </section>

      <section className="tracker-settings-page__track-instructions-section" aria-labelledby="instr-tracking-heading">
        <h3 id="instr-tracking-heading" className="tracker-settings-page__track-instructions-h">
          4. Tracking (ingest) vs route-line status
        </h3>
        <p className="tracker-settings-page__track-instructions-p">
          <strong>Tracking</strong> in device details is the on/off switch for whether the server records and forwards
          positions for that device. On the map, <strong>Tracking Off</strong> forces the vehicle pin to
          <strong> gray</strong>. When <strong>Tracking On</strong>, the pin color comes from the route check:
          <strong> blue</strong> for on track and <strong>orange</strong> for off track. The
          <strong> On track / Off track / No fix</strong> badge in the list and details still describes the route
          validator result itself. Live / Delayed / Offline in the list describe how fresh the feed is, not on-track
          geometry.
        </p>
      </section>

      <section className="tracker-settings-page__track-instructions-section" aria-labelledby="instr-steps-heading">
        <h3 id="instr-steps-heading" className="tracker-settings-page__track-instructions-h">
          5. Typical workflow
        </h3>
        <ol className="tracker-settings-page__track-instructions-steps">
          <li>
            Scan the <strong>sidebar</strong> for plate numbers, signal state (Live / Delayed / Offline), and track
            pills.
          </li>
          <li>
            <strong>Select</strong> a row to focus it on the map and load <strong>recent route points</strong> in the map
            panel. The selected vehicle <strong>moves to the top</strong> of the list (with a short animation) and returns
            to its normal place when you clear the selection. Press the row again to clear map focus.
          </li>
          <li>
            Use the <strong>chevron</strong> on the row to open <strong>device details</strong> (telemetry, Tracking
            toggle, focus map).
          </li>
          <li>
            Compare the vehicle pin color to the blue route line; open a pin popup for speed, track label, and
            Tracking state.
          </li>
          <li>
            Use <strong>Instructions</strong> in the header anytime to reopen this guide.
          </li>
        </ol>
      </section>

      <aside className="tracker-settings-page__track-instructions-note" role="note">
        <strong>Note:</strong> Orange dashed lines on the map show stored <strong>history</strong> for the selected
        device when available — they are not the same as the solid BATRASCO route line.
      </aside>
    </div>
  );
}

type TrackerDeviceDetailPanelProps = {
  vehicle: Vehicle;
  embedded?: boolean;
  gpsVehicleIds: Set<string>;
  onOpenTrackValidatorHelp: () => void;
  ingestToggleBusyId: string | null;
  intervalUpdateBusyId: string | null;
  onFocusMap: () => void;
  onToggleIngest: (vehicleId: string, enabled: boolean) => void;
  onScrapeIntervalChange: (vehicleId: string, intervalMs: number) => void;
};

function TrackerDeviceDetailPanel({
  vehicle,
  embedded,
  gpsVehicleIds,
  onOpenTrackValidatorHelp,
  ingestToggleBusyId,
  intervalUpdateBusyId,
  onFocusMap,
  onToggleIngest,
  onScrapeIntervalChange,
}: TrackerDeviceDetailPanelProps) {
  const ingestOn = vehicle.ingestEnabled !== false;
  const hasGps = gpsVehicleIds.has(vehicle.id);
  const trackStatus = getDeviceTrackStatus(vehicle.latitude, vehicle.longitude);
  const onTrackBool = isDeviceOnTrack(vehicle.latitude, vehicle.longitude);
  return (
    <div
      className={cn(
        'tracker-settings-page__device-detail-panel',
        embedded && 'tracker-settings-page__device-detail-panel--embedded'
      )}
    >
      <div className="tracker-settings-page__device-detail-stats" role="group" aria-label="Live telemetry">
        <div className="tracker-settings-page__device-detail-stat">
          <div className="tracker-settings-page__device-detail-stat-label">Coordinates</div>
          <div className="tracker-settings-page__device-detail-stat-value tracker-settings-page__device-detail-stat-value--mono">
            {formatCoordinate(vehicle.latitude)}, {formatCoordinate(vehicle.longitude)}
          </div>
        </div>
        <div className="tracker-settings-page__device-detail-stat">
          <div className="tracker-settings-page__device-detail-stat-label">Last update</div>
          <div className="tracker-settings-page__device-detail-stat-value">{formatShortTime(vehicle.lastUpdated)}</div>
        </div>
        <div className="tracker-settings-page__device-detail-stat">
          <div className="tracker-settings-page__device-detail-stat-label">Speed</div>
          <div className="tracker-settings-page__device-detail-stat-value">
            {vehicle.speed}
            <span className="tracker-settings-page__device-detail-stat-unit"> km/h</span>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'tracker-settings-page__device-detail-track',
          trackStatus === 'on_track' && 'tracker-settings-page__device-detail-track--on',
          trackStatus === 'off_track' && 'tracker-settings-page__device-detail-track--off',
          trackStatus === 'no_fix' && 'tracker-settings-page__device-detail-track--none'
        )}
      >
        <div className="tracker-settings-page__device-detail-track-head">
          <span className="tracker-settings-page__device-detail-track-title">Track</span>
          <span className="tracker-settings-page__device-detail-track-hint">Tap badge for help</span>
        </div>
        <div className="tracker-settings-page__device-detail-track-body">
          <span
            role="button"
            tabIndex={0}
            className={cn(
              'tracker-settings-page__track-pill',
              'tracker-settings-page__track-pill--legend-trigger',
              trackStatus === 'on_track' && 'tracker-settings-page__track-pill--on',
              trackStatus === 'off_track' && 'tracker-settings-page__track-pill--off',
              trackStatus === 'no_fix' && 'tracker-settings-page__track-pill--none'
            )}
            title={
              onTrackBool === true
                ? 'Validator: true (on track)'
                : onTrackBool === false
                  ? 'Validator: false (off track)'
                  : 'No GPS coordinates'
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenTrackValidatorHelp();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onOpenTrackValidatorHelp();
              }
            }}
          >
            {deviceTrackStatusLabel(trackStatus)}
          </span>
        </div>
      </div>

      <div className="tracker-settings-page__device-detail-ingest">
        <div className="tracker-settings-page__device-detail-ingest-text">
          <div className="tracker-settings-page__device-detail-ingest-label">Tracking</div>
          <div
            className={cn(
              'tracker-settings-page__device-detail-ingest-state',
              ingestOn
                ? 'tracker-settings-page__device-detail-ingest-state--on'
                : 'tracker-settings-page__device-detail-ingest-state--off'
            )}
          >
            {ingestOn ? 'Active' : 'Paused'}
          </div>
        </div>
        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <UiverseToggle
            checked={ingestOn}
            disabled={ingestToggleBusyId === vehicle.id}
            onCheckedChange={(enabled) => onToggleIngest(vehicle.id, enabled)}
            aria-label={`Turn tracking ${ingestOn ? 'off' : 'on'} for ${vehicle.plateNumber}`}
          />
        </div>
      </div>

      <div className="tracker-settings-page__device-detail-ingest">
        <div className="tracker-settings-page__device-detail-ingest-text">
          <div className="tracker-settings-page__device-detail-ingest-label">Interval</div>
          <div className="tracker-settings-page__device-detail-ingest-state">
            {formatIntervalLabel(vehicle.scrapeIntervalMs)}
          </div>
        </div>
        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <select
            className="rounded border border-[#d9dde4] bg-white px-2 py-1 text-xs font-medium text-[#334155] disabled:cursor-not-allowed"
            disabled={intervalUpdateBusyId === vehicle.id}
            value={vehicle.scrapeIntervalMs && vehicle.scrapeIntervalMs >= 15_000 ? vehicle.scrapeIntervalMs : 15_000}
            onChange={(event) => onScrapeIntervalChange(vehicle.id, Number(event.target.value))}
            aria-label={`Set interval for ${vehicle.plateNumber}`}
            title="Minimum 15s between SinoTrack scrapes for this device. The app still triggers the server poller every 5s while the tab is open; the map refreshes from server data at least 15s after each fleet update."
          >
            <option value={15000}>15s</option>
            <option value={20_000}>20s</option>
            <option value={30_000}>30s</option>
            <option value={60_000}>1 min</option>
          </select>
        </div>
      </div>

      <button type="button" onClick={() => onFocusMap()} className="tracker-settings-page__device-detail-focus-btn tracker-ui-press">
        Focus on map & history
      </button>

      <div
        className={cn(
          'tracker-settings-page__device-detail-mapstatus',
          hasGps ? 'tracker-settings-page__device-detail-mapstatus--ok' : 'tracker-settings-page__device-detail-mapstatus--wait'
        )}
      >
        {hasGps ? (
          <Wifi className="tracker-settings-page__device-detail-mapstatus-icon" aria-hidden />
        ) : (
          <WifiOff className="tracker-settings-page__device-detail-mapstatus-icon" aria-hidden />
        )}
        <span>{hasGps ? 'Position shown on map' : 'Waiting for GPS fix'}</span>
      </div>
    </div>
  );
}

export function TrackerSettingsPage({ vehicles, onIngestSettingsChanged }: TrackerSettingsPageProps) {
  const [ingestToggleBusyId, setIngestToggleBusyId] = useState<string | null>(null);
  const [intervalUpdateBusyId, setIntervalUpdateBusyId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [expandedVehicleId, setExpandedVehicleId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [historyPoints, setHistoryPoints] = useState<TrackerHistoryPointClient[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [trackValidatorModalOpen, setTrackValidatorModalOpen] = useState(false);
  const [stationLegModalOpen, setStationLegModalOpen] = useState(false);
  const [convoySpacingModalOpen, setConvoySpacingModalOpen] = useState(false);
  const [masterPaused, setMasterPaused] = useState<boolean>(() => isMasterTogglePaused());
  const [masterBusy, setMasterBusy] = useState(false);
  const [masterProgress, setMasterProgress] = useState<MasterToggleProgress | null>(null);
  const [masterError, setMasterError] = useState<string | null>(null);
  // Treat the master toggle as paused if either (a) this browser has a local
  // snapshot or (b) every known vehicle is already disabled on the server.
  // Without (b) a user who paused from another browser/device would see the
  // button in "ON" state here and clicking it would call pause (not resume),
  // trapping them in the off state.
  const allVehiclesDisabled = useMemo(
    () => vehicles.length > 0 && vehicles.every((v) => v.ingestEnabled === false),
    [vehicles]
  );
  const effectiveMasterPaused = masterPaused || allVehiclesDisabled;
  const masterTrackingEnabled = !effectiveMasterPaused;

  const handleToggleMasterTracking = useCallback(async () => {
    if (masterBusy) return;
    setMasterBusy(true);
    setMasterError(null);
    setMasterProgress({ total: vehicles.length, completed: 0, failed: 0 });
    try {
      const result = effectiveMasterPaused
        ? await resumeAllTracking(vehicles, (p) => setMasterProgress(p))
        : await pauseAllTracking(vehicles, (p) => setMasterProgress(p));
      setMasterPaused(isMasterTogglePaused());
      if (!result.ok) {
        setMasterError(
          `Applied to ${result.attempted - result.failed.length}/${result.attempted} devices. Failed: ${result.failed.join(', ')}`
        );
      }
      onIngestSettingsChanged?.();
    } catch (e) {
      setMasterError(e instanceof Error ? e.message : String(e));
      setMasterPaused(isMasterTogglePaused());
    } finally {
      setMasterBusy(false);
      setMasterProgress(null);
    }
  }, [masterBusy, effectiveMasterPaused, onIngestSettingsChanged, vehicles]);

  useEffect(() => {
    /** Keep topbar button in sync if another tab mutates the snapshot. */
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'tracker-master-toggle:snapshot:v1') {
        setMasterPaused(isMasterTogglePaused());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const openTrackValidatorModal = useCallback(() => {
    setTrackValidatorModalOpen(true);
  }, []);

  const closeTrackValidatorModal = useCallback(() => {
    setTrackValidatorModalOpen(false);
  }, []);

  const closeStationLegModal = useCallback(() => {
    setStationLegModalOpen(false);
  }, []);

  const closeConvoySpacingModal = useCallback(() => {
    setConvoySpacingModalOpen(false);
  }, []);

  const anyModalOpen = trackValidatorModalOpen || stationLegModalOpen || convoySpacingModalOpen;

  useEffect(() => {
    if (!anyModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeTrackValidatorModal();
      closeStationLegModal();
      closeConvoySpacingModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [anyModalOpen, closeConvoySpacingModal, closeStationLegModal, closeTrackValidatorModal]);

  useEffect(() => {
    if (!anyModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [anyModalOpen]);

  const withGps = useMemo(
    () =>
      vehicles.filter(
        (vehicle) =>
          vehicle.latitude != null &&
          vehicle.longitude != null &&
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude)
      ),
    [vehicles]
  );

  const gpsVehicleIds = useMemo(() => new Set(withGps.map((vehicle) => vehicle.id)), [withGps]);
  const prefersReducedMotion = useReducedMotion();

  // Station→station travel time tracking (moved from Home into Tracker Settings).
  const legMemRef = useRef(createLegTrackerMemory());
  const [stationLegRecords, setStationLegRecords] = useState<StationLegRecord[]>(() => loadStationLegRecords());

  useEffect(() => {
    const found: StationLegRecord[] = [];
    tickStationLegs(vehicles, stations, legMemRef.current, (r) => found.push(r));
    if (found.length > 0) {
      setStationLegRecords((prev) => {
        const next = [...found, ...prev].slice(0, 80);
        persistStationLegRecords(next);
        return next;
      });
    }
  }, [vehicles]);

  /** Map-selected device is shown at the top of the sidebar list; original order when nothing is selected. */
  const orderedVehicles = useMemo(() => {
    if (!selectedVehicleId) return vehicles;
    const ix = vehicles.findIndex((v) => v.id === selectedVehicleId);
    if (ix <= 0) return vehicles;
    const chosen = vehicles[ix];
    return [chosen, ...vehicles.filter((v) => v.id !== selectedVehicleId)];
  }, [vehicles, selectedVehicleId]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null,
    [selectedVehicleId, vehicles]
  );
  const expandedVehicle = useMemo(
    () =>
      expandedVehicleId != null ? (vehicles.find((vehicle) => vehicle.id === expandedVehicleId) ?? null) : null,
    [expandedVehicleId, vehicles]
  );
  const historyRoute = useMemo(
    () =>
      [...historyPoints]
        .reverse()
        .filter(
          (point): point is TrackerHistoryPointClient & { latitude: number; longitude: number } =>
            point.latitude != null &&
            point.longitude != null &&
            Number.isFinite(point.latitude) &&
            Number.isFinite(point.longitude)
        ),
    [historyPoints]
  );
  const recentHistoryPoints = useMemo(() => [...historyRoute].reverse().slice(0, 8), [historyRoute]);
  const onlineCount = useMemo(() => vehicles.filter((vehicle) => vehicle.status === 'online').length, [vehicles]);
  const ingestEnabledCount = useMemo(
    () => vehicles.filter((vehicle) => vehicle.ingestEnabled !== false).length,
    [vehicles]
  );
  const latestHistoryPoint = historyRoute.length > 0 ? historyRoute[historyRoute.length - 1] : null;

  const selectedTrackStatus = useMemo(
    () =>
      selectedVehicle
        ? getDeviceTrackStatus(selectedVehicle.latitude, selectedVehicle.longitude)
        : null,
    [selectedVehicle]
  );
  const mapRouteHint = useMemo(() => {
    if (!selectedVehicle) {
      return { text: 'Select a device to show its route on the map.', tone: 'info' as const, raw: null as string | null };
    }
    if (historyLoading) return { text: 'Loading route…', tone: 'info' as const, raw: null };
    if (historyRoute.length > 0) {
      return {
        text: `${historyRoute.length} route points are drawn on the map.`,
        tone: 'success' as const,
        raw: null as string | null,
      };
    }
    const raw = historyMessage;
    return {
      text: humanizeHistoryMessage(raw),
      tone: isLikelyTechnicalError(raw) ? ('error' as const) : ('info' as const),
      raw,
    };
  }, [historyLoading, historyMessage, historyRoute.length, selectedVehicle]);

  useEffect(() => {
    if (selectedVehicleId && !vehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(null);
    }
    if (expandedVehicleId && !vehicles.some((vehicle) => vehicle.id === expandedVehicleId)) {
      setExpandedVehicleId(null);
    }
  }, [expandedVehicleId, selectedVehicleId, vehicles]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory(deviceId: string) {
      setHistoryLoading(true);
      setHistoryMessage(null);
      const result = await fetchTrackerHistory(deviceId, 60);
      if (cancelled) return;
      setHistoryPoints(result.points);
      if (result.error) setHistoryMessage(result.error);
      else if (result.message) setHistoryMessage(result.message);
      else if (result.points.length === 0) setHistoryMessage('No history found for the selected device yet.');
      else setHistoryMessage(null);
      setHistoryLoading(false);
    }

    if (!selectedVehicleId) {
      setHistoryPoints([]);
      setHistoryMessage('Select a device to load its JSON-backed route history.');
      return () => {
        cancelled = true;
      };
    }

    void loadHistory(selectedVehicleId);
    return () => {
      cancelled = true;
    };
  }, [selectedVehicleId]);

  const handleSelectVehicle = useCallback((vehicleId: string | null) => {
    if (vehicleId === null) {
      setSelectedVehicleId(null);
      setExpandedVehicleId(null);
      setFocusNonce((value) => value + 1);
      return;
    }
    setSelectedVehicleId(vehicleId);
    setExpandedVehicleId(vehicleId);
    setFocusNonce((value) => value + 1);
    setMobileSidebarOpen(false);
  }, []);

  const handleToggleExpanded = useCallback((vehicleId: string) => {
    setExpandedVehicleId((previous) => (previous === vehicleId ? null : vehicleId));
  }, []);

  const handleToggleIngest = useCallback(
    async (vehicleId: string, enabled: boolean) => {
      setIngestToggleBusyId(vehicleId);
      try {
        const result = await setVehicleIngestEnabled(vehicleId, enabled);
        if (result.ok) onIngestSettingsChanged?.();
      } finally {
        setIngestToggleBusyId(null);
      }
    },
    [onIngestSettingsChanged]
  );

  const handleScrapeIntervalChange = useCallback(
    async (vehicleId: string, intervalMs: number) => {
      setIntervalUpdateBusyId(vehicleId);
      try {
        const result = await setVehicleScrapeIntervalMs(vehicleId, intervalMs);
        if (result.ok) onIngestSettingsChanged?.();
      } finally {
        setIntervalUpdateBusyId(null);
      }
    },
    [onIngestSettingsChanged]
  );

  return (
    <div className="sinotrack-layout tracker-settings-page tracker-ui absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f0f2f5]">
      {mobileSidebarOpen && (
        <button
          type="button"
          className="tracker-settings-page__drawer-backdrop"
          aria-label="Close device list"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <header className="sinotrack-layout__topbar tracker-settings-page__topbar flex shrink-0 flex-wrap items-center gap-2 px-3 py-1 md:gap-3 md:py-1.5">
        <button
          type="button"
          className="tracker-settings-page__mobile-only tracker-ui-press gap-2 rounded border border-[#e8eaec] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#515a6e] shadow-sm"
          onClick={() => setMobileSidebarOpen(true)}
          aria-expanded={mobileSidebarOpen}
          aria-controls="tracker-settings-sidebar"
        >
          <PanelLeft className="h-4 w-4 text-[#2d8cf0]" aria-hidden />
          Devices
        </button>
        <div className="tracker-settings-page__desktop-only flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#e8eaec] bg-[#f7f7f7] text-[#2d8cf0]">
            <Satellite className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight text-[#17233d]">Batrasco · GPS tracking</div>
            <div className="truncate text-[11px] text-[#808695]">Live monitor · OpenStreetMap</div>
          </div>
        </div>
        <div className="tracker-settings-page__topbar-stats" aria-label="Fleet summary">
          <span className="tracker-settings-page__topbar-chip">
            <span className="tracker-settings-page__topbar-chip-label">Live</span>
            <strong className="tracker-settings-page__topbar-chip-value">{onlineCount}</strong>
          </span>
          <span className="tracker-settings-page__topbar-chip">
            <span className="tracker-settings-page__topbar-chip-label">GPS</span>
            <strong className="tracker-settings-page__topbar-chip-value">{withGps.length}</strong>
          </span>
          <span className="tracker-settings-page__topbar-chip">
            <span className="tracker-settings-page__topbar-chip-label">Tracking</span>
            <strong className="tracker-settings-page__topbar-chip-value">{ingestEnabledCount}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={handleToggleMasterTracking}
          disabled={masterBusy || vehicles.length === 0}
          aria-pressed={masterTrackingEnabled}
          title={
            masterError
              ? `Last toggle finished with errors: ${masterError}`
              : masterTrackingEnabled
                ? `Tracking is ON. Click to pause ALL ${vehicles.length} devices; each device's current on/off state will be remembered and restored when you resume.`
                : `Tracking is PAUSED. Click to restore each device to the on/off state it had before the bulk pause.`
          }
          className={cn(
            'tracker-ui-press inline-flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-60',
            masterTrackingEnabled
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
          )}
        >
          <Power
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              masterTrackingEnabled ? 'text-emerald-600' : 'text-rose-600'
            )}
            aria-hidden
          />
          <span className="hidden sm:inline">
            {masterBusy
              ? masterProgress
                ? `${masterTrackingEnabled ? 'Pausing' : 'Resuming'} ${masterProgress.completed}/${masterProgress.total}…`
                : masterTrackingEnabled
                  ? 'Pausing…'
                  : 'Resuming…'
              : masterTrackingEnabled
                ? 'Tracking: ON'
                : 'Tracking: PAUSED'}
          </span>
          <span className="sm:hidden" aria-hidden>
            {masterTrackingEnabled ? 'ON' : 'OFF'}
          </span>
        </button>
        <button
          type="button"
          className="tracker-settings-page__topbar-instructions-btn tracker-ui-press"
          onClick={openTrackValidatorModal}
          aria-label="Open Live monitor instructions"
        >
          <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="tracker-settings-page__topbar-instructions-btn-text">Instructions</span>
        </button>
        <button
          type="button"
          className="tracker-settings-page__topbar-instructions-btn tracker-ui-press"
          onClick={() => setStationLegModalOpen(true)}
          aria-label="Open station-to-station travel times"
        >
          <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="tracker-settings-page__topbar-instructions-btn-text">Station-to-station</span>
        </button>
        <button
          type="button"
          className="tracker-settings-page__topbar-instructions-btn tracker-ui-press"
          onClick={() => setConvoySpacingModalOpen(true)}
          aria-label="Open convoy spacing"
        >
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="tracker-settings-page__topbar-instructions-btn-text">Convoy spacing</span>
        </button>
        <nav
          className="tracker-settings-page__desktop-only tracker-settings-page__topbar-tabs ml-auto gap-0"
          aria-label="Primary workspace"
        >
          <span className="sinotrack-tab sinotrack-tab--active px-4 py-2">Live monitor</span>
        </nav>
        <div className="tracker-settings-page__mobile-only--text min-w-0 flex-1 truncate text-center text-xs font-semibold text-[#515a6e]">
          GPS monitor
        </div>
      </header>

      <div className="tracker-settings-page__split">
        <aside
          id="tracker-settings-sidebar"
          className="tracker-settings-page__sidebar min-h-0 border-[#e8eaec] bg-white"
          data-drawer-open={mobileSidebarOpen ? true : undefined}
          aria-label="Tracker devices and settings"
        >
          <div className="tracker-settings-page__device-list" data-scroll-region="tracker-devices">
            {vehicles.length === 0 ? (
              <div className="tracker-settings-page__sidebar-empty tracker-settings-page__panel border-dashed px-4 py-10 text-center">
                <div className="tracker-settings-page__sidebar-empty-icon" aria-hidden>
                  <BusFront className="mx-auto h-6 w-6 text-[#94a3b8]" />
                </div>
                <div className="tracker-settings-page__empty-device-title tracker-settings-page__panel-title">No devices yet</div>
                <p className="tracker-settings-page__sidebar-empty-hint">Connect trackers or verify your data feed.</p>
              </div>
            ) : (
              <>
                <div className="tracker-settings-page__device-list-toolbar">
                  <span className="tracker-settings-page__device-list-toolbar-title" id="tracker-sidebar-vehicles-label">
                    Vehicles
                  </span>
                  <span className="tracker-settings-page__device-list-toolbar-count" aria-hidden>
                    {vehicles.length}
                  </span>
                </div>
                <LayoutGroup id="tracker-sidebar-device-rail">
                  <ul
                    className="tracker-settings-page__device-rail tracker-settings-page__device-rail--layout m-0 list-none p-0"
                    aria-labelledby="tracker-sidebar-vehicles-label"
                  >
                {orderedVehicles.map((vehicle) => {
                  const selected = selectedVehicleId === vehicle.id;
                  const expanded = expandedVehicleId === vehicle.id;
                  const trackStatus = getDeviceTrackStatus(vehicle.latitude, vehicle.longitude);
                  const onTrackBool = isDeviceOnTrack(vehicle.latitude, vehicle.longitude);
                  const signal = getSignalState(vehicle);
                  const ingestOn = vehicle.ingestEnabled !== false;
                  const moving = ingestOn && vehicle.speed >= MOVING_SPEED_KMH && signal !== 'offline';
                  const hasNamedDriver =
                    Boolean(vehicle.driver?.trim()) && vehicle.driver!.trim() !== '-';
                  const driverLabel = hasNamedDriver ? vehicle.driver!.trim() : null;
                  const signalWord =
                    signal === 'live' ? 'Live signal' : signal === 'delayed' ? 'Delayed signal' : 'Offline';
                  const selectHint = selected ? 'Press again to clear map focus' : 'Select for map and history';

                  return (
                    <motion.li
                      key={vehicle.id}
                      layout={prefersReducedMotion !== true}
                      className="tracker-settings-page__device-rail-item"
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 420, damping: 34, mass: 0.85 }
                      }
                    >
                      <div
                        className={cn(
                          'tracker-settings-page__device-card',
                          !ingestOn && 'tracker-settings-page__device-card--tracking-off',
                          selected && 'tracker-settings-page__device-card--active',
                          expanded && 'tracker-settings-page__device-card--expanded'
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${vehicle.plateNumber}, device ID ${vehicle.id}. ${signalWord}. ${selectHint}.`}
                          onClick={() => handleSelectVehicle(selected ? null : vehicle.id)}
                          className="tracker-settings-page__device-item tracker-settings-page__device-item--grid tracker-ui-press text-left"
                        >
                          <div className="tracker-settings-page__device-item-thumb-cell">
                            <div className="tracker-settings-page__device-thumb-wrap">
                              <div
                                className={cn(
                                  'tracker-settings-page__device-thumb',
                                  selected && 'tracker-settings-page__device-thumb--selected'
                                )}
                              >
                                <BusFront className="tracker-settings-page__device-thumb-icon" aria-hidden />
                              </div>
                              <span
                                className={cn(
                                  'tracker-settings-page__device-thumb-signal',
                                  !ingestOn && 'tracker-settings-page__signal-dot--tracking-off',
                                  ingestOn && signal === 'live' && 'tracker-settings-page__signal-dot--live',
                                  ingestOn && signal === 'delayed' && 'tracker-settings-page__signal-dot--delayed',
                                  ingestOn && signal === 'offline' && 'tracker-settings-page__signal-dot--offline',
                                  moving && 'tracker-settings-page__signal-dot--moving'
                                )}
                                title={ingestOn ? (moving ? 'Moving' : 'Stopped or slow') : 'Tracking paused'}
                                aria-hidden
                              />
                            </div>
                          </div>
                          <div className="tracker-settings-page__device-item-main">
                            <div className="tracker-settings-page__device-item-text-cell">
                              <div className="tracker-settings-page__device-item-plate">{vehicle.plateNumber}</div>
                              {driverLabel ? (
                                <div className="tracker-settings-page__device-item-sub">{driverLabel}</div>
                              ) : null}
                              <div
                                className="tracker-settings-page__device-item-device-id"
                                title="SinoTrack / tracker device identifier (IMEI)"
                              >
                                Device ID <span className="tracker-settings-page__device-item-device-id-value">{vehicle.id}</span>
                              </div>
                            </div>
                            <div className="tracker-settings-page__device-item-badges">
                              {signal === 'live' ? (
                                <span className="tracker-settings-page__status-live">Live</span>
                              ) : signal === 'delayed' ? (
                                <span className="tracker-settings-page__status-delayed">Delayed</span>
                              ) : (
                                <span className="tracker-settings-page__status-offline">Offline</span>
                              )}
                              <span
                                className={cn(
                                  'tracker-settings-page__track-pill',
                                  'tracker-settings-page__track-pill--legend-trigger',
                                  trackStatus === 'on_track' && 'tracker-settings-page__track-pill--on',
                                  trackStatus === 'off_track' && 'tracker-settings-page__track-pill--off',
                                  trackStatus === 'no_fix' && 'tracker-settings-page__track-pill--none'
                                )}
                                title={
                                  onTrackBool === true
                                    ? 'Validator: true (on track)'
                                    : onTrackBool === false
                                      ? 'Validator: false (off track)'
                                      : 'No GPS coordinates'
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openTrackValidatorModal();
                                }}
                              >
                                {deviceTrackStatusLabel(trackStatus)}
                              </span>
                            </div>
                            <div className="tracker-settings-page__device-item-meta-row">
                              <span className="tracker-settings-page__device-item-speed">
                                <strong>{vehicle.speed}</strong>
                                <span className="tracker-settings-page__device-item-speed-unit"> km/h</span>
                              </span>
                              <span className="tracker-settings-page__device-item-meta-sep" aria-hidden>
                                ·
                              </span>
                              <span
                                className="inline-flex items-center rounded border border-[#d9dde4] bg-[#f8fafc] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569]"
                                title={`Interval: ${formatIntervalLabel(vehicle.scrapeIntervalMs)}`}
                              >
                                {formatIntervalLabel(vehicle.scrapeIntervalMs)}
                              </span>
                              <span className="tracker-settings-page__device-item-meta-sep" aria-hidden>
                                ·
                              </span>
                              <span className="tracker-settings-page__device-item-updated" title={vehicle.lastUpdated}>
                                {formatRelativeTime(vehicle.lastUpdated)}
                              </span>
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleExpanded(vehicle.id)}
                          className="tracker-settings-page__device-expand tracker-ui-press"
                          aria-expanded={expanded}
                          title={expanded ? 'Hide details' : 'Device details'}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${vehicle.plateNumber} details`}
                        >
                          <ChevronDown className={cn('tracker-settings-page__device-expand-icon', expanded && 'tracker-settings-page__device-expand-icon--open')} aria-hidden />
                        </button>
                      </div>
                    </motion.li>
                  );
                })}
                  </ul>
                </LayoutGroup>
              </>
            )}
          </div>

          {expandedVehicle != null && (
            <div
              className="tracker-settings-page__device-detail-popout"
              role="region"
              aria-labelledby="tracker-device-detail-title"
            >
              <div className="tracker-settings-page__device-detail-popout-header">
                <div className="min-w-0">
                  <div className="tracker-settings-page__device-detail-popout-eyebrow">Device details</div>
                  <div id="tracker-device-detail-title" className="tracker-settings-page__device-detail-popout-title">
                    {expandedVehicle.plateNumber}
                  </div>
                  {expandedVehicle.driver &&
                  expandedVehicle.driver.trim() &&
                  expandedVehicle.driver.trim() !== '-' ? (
                    <div className="tracker-settings-page__device-detail-popout-subtitle">
                      {expandedVehicle.driver.trim()}
                    </div>
                  ) : null}
                  <div
                    className="tracker-settings-page__device-detail-popout-device-id"
                    title="SinoTrack / tracker device identifier (IMEI)"
                  >
                    Device ID{' '}
                    <span className="tracker-settings-page__device-detail-popout-device-id-value">{expandedVehicle.id}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="tracker-settings-page__device-detail-popout-close tracker-ui-press"
                  aria-label={`Close details for ${expandedVehicle.plateNumber}`}
                  onClick={() => setExpandedVehicleId(null)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="tracker-settings-page__device-detail-popout-scroll" data-scroll-region="tracker-device-detail">
                <TrackerDeviceDetailPanel
                  vehicle={expandedVehicle}
                  embedded
                  gpsVehicleIds={gpsVehicleIds}
                  onOpenTrackValidatorHelp={openTrackValidatorModal}
                  ingestToggleBusyId={ingestToggleBusyId}
                  intervalUpdateBusyId={intervalUpdateBusyId}
                  onFocusMap={() => handleSelectVehicle(expandedVehicle.id)}
                  onToggleIngest={handleToggleIngest}
                  onScrapeIntervalChange={handleScrapeIntervalChange}
                />
              </div>
            </div>
          )}
        </aside>

        <main className="tracker-settings-page__map-main tracker-settings-page__map-stage">
          <div className="tracker-settings-page__map-fill absolute">
            <TrackerLocationsMap
              vehicles={vehicles}
              stations={stations}
              focusedVehicleId={gpsVehicleIds.has(selectedVehicleId ?? '') ? selectedVehicleId : null}
              focusNonce={focusNonce}
              onVehicleSelect={handleSelectVehicle}
              historyPoints={historyRoute}
              className="h-full w-full rounded-none border-0"
            />
          </div>

          <div className="tracker-settings-page__hud-top pointer-events-none absolute inset-x-4 top-4">
            <div className="tracker-settings-page__hud-top-inner">
              <div className="tracker-settings-page__hud-top-right">
                {selectedVehicle && (
                  <div className="tracker-settings-page__selected-device tracker-settings-page__map-selected-float">
                    <div className="tracker-settings-page__selected-device-title tracker-settings-page__panel-title--muted flex items-center gap-2">
                      <Gauge className="h-3.5 w-3.5 text-[#2563eb]" aria-hidden />
                      Selected vehicle
                    </div>
                    <dl className="tracker-settings-page__device-details">
                      <dt>Speed</dt>
                      <dd>{selectedVehicle.speed} km/h</dd>
                      <dt>Updated</dt>
                      <dd>{formatRelativeTime(selectedVehicle.lastUpdated)}</dd>
                      <dt>Signal</dt>
                      <dd>
                        {getSignalState(selectedVehicle) === 'live'
                          ? 'Live'
                          : getSignalState(selectedVehicle) === 'delayed'
                            ? 'Delayed'
                            : 'Offline'}
                      </dd>
                      <dt>Coordinates</dt>
                      <dd>
                        {formatCoordinate(selectedVehicle.latitude)}, {formatCoordinate(selectedVehicle.longitude)}
                      </dd>
                      <dt>On route line</dt>
                      <dd className="tracker-settings-page__device-details-track">
                        {selectedTrackStatus != null ? (
                          <button
                            type="button"
                            className={cn(
                              'tracker-settings-page__track-pill-hover-target tracker-settings-page__track-pill-hud-btn',
                              'inline-flex flex-wrap items-center gap-2 border-0 bg-transparent p-0 text-left font-inherit'
                            )}
                            onClick={openTrackValidatorModal}
                            title="Open full instructions"
                            aria-label="Open Live monitor instructions"
                          >
                            <span
                              className={cn(
                                'tracker-settings-page__track-pill tracker-settings-page__track-pill--inline',
                                'tracker-settings-page__track-pill--legend-trigger',
                                selectedTrackStatus === 'on_track' && 'tracker-settings-page__track-pill--on',
                                selectedTrackStatus === 'off_track' && 'tracker-settings-page__track-pill--off',
                                selectedTrackStatus === 'no_fix' && 'tracker-settings-page__track-pill--none'
                              )}
                            >
                              {deviceTrackStatusLabel(selectedTrackStatus)}
                            </span>
                          </button>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </dl>
                  </div>
                )}
                <div className="tracker-settings-page__map-controls tracker-settings-page__panel">
                  <div className="tracker-settings-page__panel-title--muted flex items-center gap-2">
                    <MapPinned className="h-3.5 w-3.5 text-[#0284c7]" aria-hidden />
                    Map
                  </div>
                  <div className="tracker-settings-page__map-controls-focus-row">
                    <div className="tracker-settings-page__map-controls-focus min-w-0">
                      {selectedVehicle?.plateNumber ?? 'Fleet overview'}
                    </div>
                    {selectedVehicle ? (
                      <button
                        type="button"
                        className="tracker-settings-page__map-controls-clear tracker-ui-press"
                        onClick={() => handleSelectVehicle(null)}
                      >
                        Clear selection
                      </button>
                    ) : null}
                  </div>
                  <p className="tracker-settings-page__map-controls-body">
                    {selectedVehicle
                      ? 'Use the list or pins to switch vehicles. Route status and recent points are in this panel.'
                      : 'Tap the sidebar list or a map pin to focus a vehicle.'}
                  </p>
                  <div className="tracker-settings-page__panel-title--muted mt-2">Route on map</div>
                  {mapRouteHint.tone === 'error' ? (
                    <div className="tracker-settings-page__alert-error" title={mapRouteHint.raw ?? undefined}>
                      {mapRouteHint.text}
                    </div>
                  ) : mapRouteHint.tone === 'success' ? (
                    <div className="tracker-settings-page__alert-success">{mapRouteHint.text}</div>
                  ) : (
                    <p className="tracker-settings-page__map-controls-body mt-1">{mapRouteHint.text}</p>
                  )}

                  <section
                    className="tracker-settings-page__history-shell tracker-settings-page__history-shell--map-panel"
                    aria-label="Recent route points"
                  >
                    <div className="tracker-settings-page__history-shell-head">
                      <div className="min-w-0">
                        <div className="tracker-settings-page__history-shell-eyebrow">Recent route points</div>
                        <div className="tracker-settings-page__history-device-name">
                          {selectedVehicle ? selectedVehicle.plateNumber : 'No vehicle selected'}
                        </div>
                      </div>
                      <div className="tracker-settings-page__history-count" aria-live="polite">
                        {historyLoading ? 'Loading' : `${historyRoute.length} pts`}
                      </div>
                    </div>

                    <div className="tracker-settings-page__history-box tracker-settings-page__history-box--compact">
                      <div className="tracker-settings-page__history-row">
                        <span className="tracker-settings-page__history-muted">Latest ping</span>
                        <strong className="tracker-settings-page__history-strong">
                          {latestHistoryPoint?.reported_at ? formatShortTime(latestHistoryPoint.reported_at) : '—'}
                        </strong>
                      </div>
                      <div className="tracker-settings-page__history-row">
                        <span className="tracker-settings-page__history-muted">Source</span>
                        <strong className="tracker-settings-page__history-strong">Stored route</strong>
                      </div>
                    </div>

                    <div className="tracker-settings-page__history-scroll" data-scroll-region="tracker-history">
                      {!selectedVehicle ? (
                        <p className="tracker-settings-page__history-placeholder">
                          Select a device in the list or tap a map pin to load recent points.
                        </p>
                      ) : historyLoading ? (
                        <p className="tracker-settings-page__history-placeholder">Loading route points…</p>
                      ) : recentHistoryPoints.length === 0 ? (
                        <p
                          className={
                            isLikelyTechnicalError(historyMessage)
                              ? 'tracker-settings-page__alert-error'
                              : 'tracker-settings-page__history-placeholder'
                          }
                          title={historyMessage ?? undefined}
                        >
                          {humanizeHistoryMessage(historyMessage)}
                        </p>
                      ) : (
                        <ul className="m-0 list-none p-0">
                          {recentHistoryPoints.map((point, index) => (
                            <li
                              key={`${point.device_id}-${point.reported_at}-${index}`}
                              className="tracker-settings-page__history-point"
                            >
                              <div className="tracker-settings-page__history-row">
                                <span className="tracker-settings-page__history-strong">{formatTimestamp(point.reported_at)}</span>
                                <span className="tracker-settings-page__history-muted">
                                  {point.speed_kmh != null ? `${point.speed_kmh} km/h` : '—'}
                                </span>
                              </div>
                              <div className="tracker-settings-page__history-muted">
                                {formatCoordinate(point.latitude)}, {formatCoordinate(point.longitude)}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>

        </main>
      </div>

      {trackValidatorModalOpen && (
        <div
          className="tracker-settings-page__track-validator-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTrackValidatorModal();
          }}
        >
          <div
            className="tracker-settings-page__track-validator-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tracker-track-validator-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tracker-settings-page__track-validator-modal-header">
              <div className="min-w-0">
                <div className="tracker-settings-page__track-validator-modal-eyebrow">Live monitor</div>
                <div id="tracker-track-validator-title" className="tracker-settings-page__track-validator-modal-title">
                  Instructions
                </div>
                <p className="tracker-settings-page__track-validator-modal-lead">
                  Corridor checks, badges, map pins, Tracking vs GPS, and how to move through the fleet view.
                </p>
              </div>
              <button
                type="button"
                className="tracker-settings-page__track-validator-modal-close tracker-ui-press"
                aria-label="Close instructions"
                onClick={closeTrackValidatorModal}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="tracker-settings-page__track-validator-modal-body">
              <TrackValidatorHelpContent />
            </div>
          </div>
        </div>
      )}

      {stationLegModalOpen && (
        <div
          className="tracker-settings-page__track-validator-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeStationLegModal();
          }}
        >
          <div
            className="tracker-settings-page__track-validator-modal tracker-settings-page__track-validator-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tracker-station-leg-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tracker-settings-page__track-validator-modal-header">
              <div className="min-w-0">
                <div className="tracker-settings-page__track-validator-modal-eyebrow">Analytics</div>
                <div id="tracker-station-leg-title" className="tracker-settings-page__track-validator-modal-title">
                  Station-to-station travel times
                </div>
                <p className="tracker-settings-page__track-validator-modal-lead">
                  Latest completed legs between stops (recorded automatically from live GPS).
                </p>
              </div>
              <button
                type="button"
                className="tracker-settings-page__track-validator-modal-close tracker-ui-press"
                aria-label="Close station-to-station modal"
                onClick={closeStationLegModal}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="tracker-settings-page__track-validator-modal-body">
              <StationLegTimesPanel records={stationLegRecords} compact={false} tone="light" showIntro={false} />
            </div>
          </div>
        </div>
      )}

      {convoySpacingModalOpen && (
        <div
          className="tracker-settings-page__track-validator-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConvoySpacingModal();
          }}
        >
          <div
            className="tracker-settings-page__track-validator-modal tracker-settings-page__track-validator-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tracker-convoy-spacing-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="tracker-settings-page__track-validator-modal-header">
              <div className="min-w-0">
                <div className="tracker-settings-page__track-validator-modal-eyebrow">Analytics</div>
                <div id="tracker-convoy-spacing-title" className="tracker-settings-page__track-validator-modal-title">
                  Convoy spacing
                </div>
                <p className="tracker-settings-page__track-validator-modal-lead">
                  Time from each vehicle to the next one ahead on the same heading.
                </p>
              </div>
              <button
                type="button"
                className="tracker-settings-page__track-validator-modal-close tracker-ui-press"
                aria-label="Close convoy spacing modal"
                onClick={closeConvoySpacingModal}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="tracker-settings-page__track-validator-modal-body">
              <VehicleConvoyHeadwayPanel vehicles={vehicles} embedded />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
