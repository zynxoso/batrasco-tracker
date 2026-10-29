import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { CollaborationSplash } from './components/shell/CollaborationSplash';
import { fetchVehicles, triggerTrackersPoll, type VehicleFromApi } from './api/client';
import { isMasterTogglePaused } from './lib/fleet/tracker-master-toggle';
import {
  canUseSupabaseDirect,
  fetchVehiclesFromSupabase,
} from './lib/fleet/fetch-vehicles-from-supabase';
import { stations, type Station } from './data/route-stations';
import { isDeviceOnTrack } from './lib/route/route-corridor';
import { LiveRouteDashboardPage } from './pages/LiveRouteDashboardPage';
import { TrackerSettingsPage } from './pages/TrackerSettingsPage';
import { LandingPage } from './pages/LandingPage';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import batrascoLogo from './assets/batrasco_logo.png';
import { FleetMapLoginModal } from './components/auth/FleetMapLoginModal';
import { isFleetAdminAuthorized } from './lib/auth/admin-auth';
import {
  AlertCircle,
  Info,
  LayoutDashboard,
  Loader2,
  MapPinned,
  Route as RouteIcon,
} from 'lucide-react';

export type { Station };
export { stations };

export type Vehicle = {
  id: string;
  plateNumber: string;
  driver: string;
  currentPosition: number;
  speed: number;
  status: 'online' | 'offline';
  passengers: number;
  capacity: number;
  /** Tracker device online (from API/database) */
  trackerOnline?: boolean;
  /** Current position from tracker (for distance to station) */
  latitude?: number;
  longitude?: number;
  /** Remaining distance in km (from API, live update) */
  remainingDistanceKm?: number;
  lastUpdated?: string;
  /** Single ETA in direction of travel (from API), e.g. "12 min to Batangas Grand Terminal" */
  etaInDirectionOfTravel?: string;
  /** From API/DB only — toward Lipa (100%) vs Batangas (0%). Not client poll delta. */
  headingTowardLipa?: boolean;
  /** GPS heading in degrees (0–360) when provided by tracker; refines direction with route bearing. */
  direction?: number;
  /** When false, ingests for this device are ignored on the server. */
  ingestEnabled?: boolean;
  /** Optional per-device scrape interval in ms. */
  scrapeIntervalMs?: number;
  /** When API omits heading: inferred from last vs current position% on poll (weaker than GPS). */
  motionTowardLipa?: boolean;
};

const ENABLE_SPLASH = false;

const FLEET_UI_GAP_MS = 15_000;
const HIDDEN_VEHICLE_POLL_MS = 30_000;

function maxLastUpdatedMsFromVehicleList(list: { lastUpdated?: string }[]): number {
  let m = 0;
  for (const v of list) {
    if (!v.lastUpdated) continue;
    const t = new Date(v.lastUpdated).getTime();
    if (Number.isFinite(t)) m = Math.max(m, t);
  }
  return m;
}

function AppRoutes({
  vehicles,
  selectedVehicle,
  setSelectedVehicle,
  setIngestSettingsNonce,
  apiAvailable,
  dataError,
}: {
  vehicles: Vehicle[];
  selectedVehicle: string | null;
  setSelectedVehicle: Dispatch<SetStateAction<string | null>>;
  setIngestSettingsNonce: Dispatch<SetStateAction<number>>;
  apiAvailable: boolean | null;
  dataError: string | null;
}) {
  const alerts = (
    <>
      {apiAvailable === null && vehicles.length === 0 && (
        <div className="flex gap-3 rounded-2xl border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-sm text-sky-950 shadow-sm shadow-sky-900/5">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-600" aria-hidden />
          <div>
            <div className="font-semibold text-sky-950">Loading vehicle data</div>
            <p className="mt-0.5 text-xs text-sky-800/90">Connecting to the live feed…</p>
          </div>
        </div>
      )}
      {apiAvailable === true && vehicles.length === 0 && !dataError && (
        <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm shadow-slate-900/5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <div>
            <div className="font-semibold text-slate-900">No vehicles in the feed yet</div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              Units appear here after trackers report to the API or when rows exist in Supabase.
            </p>
          </div>
        </div>
      )}
      {dataError && (
        <div
          className="flex gap-3 rounded-2xl border border-red-200 bg-red-50/95 px-4 py-3 text-sm text-red-950 shadow-sm shadow-red-900/10"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold">Could not load vehicle data</div>
            <div className="mt-1 font-mono text-xs break-all text-red-900/90">{dataError}</div>
            <div className="mt-2 text-xs leading-relaxed text-red-800/95">
              Fix: for the API set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel. For local dev without /api, add
              VITE_SUPABASE_ANON_KEY (anon/public key from Supabase; never service_role). SUPABASE_URL is reused for the SPA URL
              when VITE_SUPABASE_URL is omitted. Or set VITE_API_PROXY_ORIGIN to your deployed app. Redeploy after changing env.
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Home/station dashboards should only show track-enabled devices that are
  // physically on the Batangas↔Lipa route line.
  // Tracker Settings still receives the full list so operators can re-enable devices.
  const dashboardVehicles = vehicles.filter(
    (vehicle) => vehicle.ingestEnabled !== false && isDeviceOnTrack(vehicle.latitude, vehicle.longitude) === true
  );

  const liveDashboardShellClass =
    'live-route-dashboard-shell flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:px-8';

  function StationDetailDashboard() {
    const { stationId } = useParams<{ stationId: string }>();
    const station = stations.find((s) => s.id === stationId);
    if (!station) {
      return <Navigate to="/tracker" replace />;
    }
    return (
      <LiveRouteDashboardPage
        stations={stations}
        vehicles={dashboardVehicles}
        selectedVehicle={selectedVehicle}
        onVehicleSelect={setSelectedVehicle}
        focusedStationId={station.id}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/tracker"
        element={
          <div className={liveDashboardShellClass}>
            {alerts}
            <LiveRouteDashboardPage
              stations={stations}
              vehicles={dashboardVehicles}
              selectedVehicle={selectedVehicle}
              onVehicleSelect={setSelectedVehicle}
            />
          </div>
        }
      />
      <Route
        path="/tracker-settings"
        element={
          isFleetAdminAuthorized() ? (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {/* Float alerts so they do not consume vertical space and shrink the map */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-[1300] flex justify-center px-2 pt-2"
                aria-live="polite"
              >
                <div className="pointer-events-auto max-h-[min(42vh,360px)] w-full max-w-3xl space-y-2 overflow-y-auto">
                  {alerts}
                </div>
              </div>
              <div className="relative min-h-0 min-w-0 flex-1">
                <TrackerSettingsPage
                  vehicles={vehicles}
                  onIngestSettingsChanged={() => setIngestSettingsNonce((n) => n + 1)}
                />
              </div>
            </div>
          ) : (
            <Navigate to="/tracker" replace state={{ openFleetLogin: true }} />
          )
        }
      />
      <Route
        path="/station/:stationId"
        element={
          <div className={liveDashboardShellClass}>
            {alerts}
            <StationDetailDashboard />
          </div>
        }
      />
    </Routes>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSplash, setShowSplash] = useState(ENABLE_SPLASH);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const lastEtagRef = useRef<string | undefined>(undefined);
  const lastPositionByVehicleRef = useRef<Record<string, number>>({});
  /** Monotonic id so a slow poll cannot overwrite state after a newer poll has run. */
  const pollSeqRef = useRef(0);
  const [mockSimulatorBusy, setMockSimulatorBusy] = useState<
    null | 'quick' | 'realistic'
  >(null);
  const [mockSimulatorNote, setMockSimulatorNote] = useState<string | null>(null);
  const [ingestSettingsNonce, setIngestSettingsNonce] = useState(0);

  useEffect(() => {
    if ((location.state as { openFleetLogin?: boolean })?.openFleetLogin) {
      if (!isFleetAdminAuthorized()) {
        setIsLoginModalOpen(true);
      }
    }
  }, [location.state]);

  const runMockSimulator = async (script: 'quick' | 'realistic') => {
    setMockSimulatorBusy(script);
    setMockSimulatorNote(null);
    try {
      const r = await fetch('/__dev/run-simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        setMockSimulatorNote(j.error || `HTTP ${r.status}`);
        return;
      }
      setMockSimulatorNote(
        script === 'quick'
          ? 'Started quick mock (simulate-tracker-test.js).'
          : 'Started realistic mock (simulate-tracker-realistic.js).'
      );
    } catch (e) {
      setMockSimulatorNote(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setMockSimulatorBusy(null);
    }
  };

  // Show splash only once on initial load (10s), then never again – no recurring cycle
  useEffect(() => {
    if (!ENABLE_SPLASH) return;
    const initialTimer = setTimeout(() => setShowSplash(false), 10000);
    return () => clearTimeout(initialTimer);
  }, []);

  /**
   * Dashboard-driven SinoTrack poller.
   *
   * Vercel Hobby cron caps at once-per-day, so the SPA itself triggers
   * `POST /api/trackers-poll` every 5 seconds while the tab is visible (30 s
   * when hidden). When nobody is viewing, polling stops — the live monitor is
   * the consumer of fresh data, so this matches the actual need without
   * requiring n8n or Pro plan.
   *
   * Respects the master tracking toggle (localStorage snapshot set by the
   * Tracker Settings topbar button). When paused we skip the network call
   * entirely — per-device ingest_enabled=false on the server would make it a
   * no-op anyway, but avoiding the fetch saves every visible tab from
   * hammering `/api/trackers-poll` during the paused state.
   */
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (isMasterTogglePaused()) return;
      inFlight = true;
      try {
        await triggerTrackersPoll();
      } finally {
        inFlight = false;
      }
    };

    const visibleIntervalMs = 5000;
    const hiddenIntervalMs = 30_000;

    const schedule = () => {
      if (intervalId != null) clearInterval(intervalId);
      const ms = document.visibilityState === 'visible' ? visibleIntervalMs : hiddenIntervalMs;
      intervalId = setInterval(() => {
        void tick();
      }, ms);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void tick();
      schedule();
    };

    void tick();
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (intervalId != null) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [ingestSettingsNonce]);

  // Fetch tracker data: next GET /api/vehicles is scheduled for 15s after X-Fleet-Data-At (KV + DB) while tab visible; 30s interval when hidden.
  // Try API first (uses Supabase on server when SUPABASE_URL + key are set). If API fails, try direct Supabase when VITE_* are set.
  useEffect(() => {
    const mapApiToState = (v: {
      id: string;
      plateNumber: string;
      driver: string;
      currentPosition: number;
      speed: number;
      status: 'online' | 'offline';
      passengers: number;
      capacity: number;
      trackerOnline?: boolean;
      latitude?: number;
      longitude?: number;
      remainingDistanceKm?: number;
      lastUpdated?: string;
      etaInDirectionOfTravel?: string;
      headingTowardLipa?: boolean | string | null;
      direction?: number | string | null;
      motionTowardLipa?: boolean;
      ingestEnabled?: boolean;
      scrapeIntervalMs?: number;
    }) => {
      const rawH = v.headingTowardLipa;
      const headingFromApi =
        rawH === true || rawH === 'true'
          ? true
          : rawH === false || rawH === 'false'
            ? false
            : undefined;
      const prev = lastPositionByVehicleRef.current[v.id];
      let motion: boolean | undefined;
      if (
        headingFromApi === undefined &&
        prev !== undefined &&
        Math.abs(v.currentPosition - prev) > 0.02
      ) {
        motion = v.currentPosition > prev;
      }
      lastPositionByVehicleRef.current[v.id] = v.currentPosition;
      const dirRaw = v.direction;
      const direction =
        dirRaw != null && dirRaw !== ''
          ? (() => {
              const n = Number(dirRaw);
              return Number.isFinite(n) ? n : undefined;
            })()
          : undefined;
      return {
        id: v.id,
        plateNumber: v.plateNumber,
        driver: v.driver,
        currentPosition: v.currentPosition,
        speed: v.speed,
        status: v.status,
        passengers: v.passengers,
        capacity: v.capacity,
        trackerOnline: v.trackerOnline,
        latitude: v.latitude,
        longitude: v.longitude,
        remainingDistanceKm: v.remainingDistanceKm,
        lastUpdated: v.lastUpdated,
        etaInDirectionOfTravel: v.etaInDirectionOfTravel,
        ...(headingFromApi !== undefined ? { headingTowardLipa: headingFromApi } : {}),
        ...(direction !== undefined ? { direction } : {}),
        ...(motion !== undefined ? { motionTowardLipa: motion } : {}),
        ingestEnabled: v.ingestEnabled !== false,
        ...(v.scrapeIntervalMs != null ? { scrapeIntervalMs: Number(v.scrapeIntervalMs) } : {}),
      };
    };

    let cancelled = false;
    let nextVehicleTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let hiddenVehicleIntervalId: ReturnType<typeof setInterval> | null = null;

    const clearVehicleTimers = () => {
      if (nextVehicleTimeoutId != null) {
        clearTimeout(nextVehicleTimeoutId);
        nextVehicleTimeoutId = null;
      }
      if (hiddenVehicleIntervalId != null) {
        clearInterval(hiddenVehicleIntervalId);
        hiddenVehicleIntervalId = null;
      }
    };

    const scheduleNextVehicleFetch = (lastFleetDataAtMs: number | null | undefined) => {
      clearVehicleTimers();
      if (cancelled) return;
      if (document.visibilityState !== 'visible') {
        hiddenVehicleIntervalId = setInterval(() => void pollVehicles(), HIDDEN_VEHICLE_POLL_MS);
        return;
      }
      const base =
        lastFleetDataAtMs != null && Number.isFinite(lastFleetDataAtMs) && lastFleetDataAtMs > 0
          ? lastFleetDataAtMs
          : Date.now();
      const delay = Math.max(0, base + FLEET_UI_GAP_MS - Date.now());
      nextVehicleTimeoutId = setTimeout(() => void pollVehicles(), delay);
    };

    const pollVehicles = async () => {
      const seq = ++pollSeqRef.current;
      /** True when /api responded OK this tick (including empty array). Used so we don't call setApiAvailable(false) after a successful HTTP response. */
      let hadSuccessfulApiResponse = false;
      const finishApiPath = (lastMs: number | null | undefined) => {
        if (seq !== pollSeqRef.current) return;
        scheduleNextVehicleFetch(lastMs ?? null);
      };

      try {
        const result = await fetchVehicles(lastEtagRef.current);
        if (seq !== pollSeqRef.current) return;
        lastEtagRef.current = result.etag;
        if (result.notModified) {
          setDataError(null);
          finishApiPath(result.lastFleetDataAtMs ?? null);
          return;
        }
        if (result.data?.length) {
          setVehicles(result.data.map(mapApiToState));
          setApiAvailable(true);
          setDataError(null);
          setSelectedVehicle((prev) => {
            if (prev === null || prev === '' || prev === '__all__') return prev;
            return result.data!.some((v) => v.id === prev) ? prev : null;
          });
          finishApiPath(result.lastFleetDataAtMs ?? null);
          return;
        }
        if (result.data?.length === 0) {
          setVehicles([]);
          // Empty list is a successful response; only surface X-Vehicles-Error if present.
          setDataError(result.error ? `API: ${result.error}` : null);
          setApiAvailable(true);
          hadSuccessfulApiResponse = true;
          finishApiPath(result.lastFleetDataAtMs ?? null);
          return;
        }
        if (result.data === null) {
          // fetchVehicles maps non-array JSON to data: null (see src/api/client.ts).
          setVehicles([]);
          setDataError(
            result.error ? `API: ${result.error}` : 'API returned JSON that is not an array of vehicles.'
          );
          setApiAvailable(true);
          hadSuccessfulApiResponse = true;
          finishApiPath(result.lastFleetDataAtMs ?? null);
          return;
        }
      } catch (e) {
        if (seq !== pollSeqRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setDataError(`API failed: ${msg}`);
      }
      if (seq !== pollSeqRef.current) return;
      if (canUseSupabaseDirect()) {
        try {
          const data = await fetchVehiclesFromSupabase();
          if (seq !== pollSeqRef.current) return;
          if (data?.length) {
            setVehicles(data.map(mapApiToState));
            setApiAvailable(true);
            setDataError(null);
            setSelectedVehicle((prev) => {
              if (prev === null || prev === '' || prev === '__all__') return prev;
              return data.some((v) => v.id === prev) ? prev : null;
            });
            const rowMax = maxLastUpdatedMsFromVehicleList(data as VehicleFromApi[]);
            scheduleNextVehicleFetch(rowMax > 0 ? rowMax : null);
            return;
          }
          setDataError((prev) => {
            // API already returned 200 with [] — don't stack a red error for "Supabase also empty".
            if (hadSuccessfulApiResponse && !prev) return null;
            return prev || 'Direct Supabase: no rows in tracker_latest.';
          });
          scheduleNextVehicleFetch(null);
        } catch (e) {
          if (seq !== pollSeqRef.current) return;
          const msg = e instanceof Error ? e.message : String(e);
          setDataError((prev) => prev ? `${prev} — Supabase: ${msg}` : `Direct Supabase failed: ${msg}`);
          scheduleNextVehicleFetch(null);
        }
      } else {
        setDataError((prev) => {
          const defaultAnonMsg =
            'Anon Supabase key missing: set VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY (public key from API settings), or set VITE_API_PROXY_ORIGIN for /api. URL: VITE_SUPABASE_URL or SUPABASE_URL.';
          // /api already succeeded (e.g. empty []) — do not show anon-only warning as if the API failed.
          if (!prev && hadSuccessfulApiResponse) return null;
          if (!prev) return defaultAnonMsg;
          if (prev.includes('VITE_SUPABASE_ANON_KEY') || prev.includes('SUPABASE_ANON_KEY')) return prev;
          // When /api already failed, `prev` was truthy so we used to hide the anon hint entirely.
          if (prev.startsWith('API failed:') && !prev.includes('for fallback when /api')) {
            return `${prev} — Add VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY (public key) for fallback when /api is unavailable.`;
          }
          return prev;
        });
        scheduleNextVehicleFetch(null);
      }
      if (seq !== pollSeqRef.current) return;
      // Only mark API unavailable when we did not get a successful /api response this tick (e.g. fetch threw or non-array body).
      if (!hadSuccessfulApiResponse) {
        setApiAvailable(false);
      }
    };

    void pollVehicles();

    const onVisibilityChange = () => {
      clearVehicleTimers();
      if (document.visibilityState === 'visible') void pollVehicles();
      else scheduleNextVehicleFetch(null);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearVehicleTimers();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [ingestSettingsNonce]);

  // Show splash screen for 10 seconds
  if (showSplash) {
    return <CollaborationSplash />;
  }

  const isLandingPage = location.pathname === '/';

  return (
    <div
      className={
        isLandingPage
          ? 'app-root min-h-screen w-full min-w-0 max-w-full flex flex-col'
          : 'app-root flex min-h-dvh w-full min-w-0 max-w-full flex-1 flex-col bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(23,37,107,0.11),transparent),linear-gradient(165deg,#fafbfe_0%,#eef0f7_42%,#e4e8f2_100%)]'
      }
    >
      {!isLandingPage && (
        <header className="shrink-0 border-b border-slate-200/70 bg-gradient-to-b from-slate-50/90 to-white/95 pt-[env(safe-area-inset-top,0px)] shadow-[0_12px_40px_-24px_rgba(15,23,42,0.18)] backdrop-blur-md supports-[backdrop-filter]:from-slate-50/75 supports-[backdrop-filter]:to-white/85">
          <div
            className="h-0.5 w-full bg-[linear-gradient(90deg,#253272_0%,#484d80_52%,#c23e01_100%)]"
            aria-hidden
          />
          <div className="px-3 py-1.5 sm:px-5 sm:py-2 lg:px-8 lg:py-2.5">
            <div className="relative flex w-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white pl-1 shadow-[0_4px_28px_-14px_rgba(23,37,107,0.14),inset_0_1px_0_0_rgba(255,255,255,0.97)] sm:rounded-2xl sm:pl-1.5 lg:flex-row lg:items-center">
              <div
                className="pointer-events-none absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[#17256b] via-[#484d80] to-[#c23e01] opacity-90"
                aria-hidden
              />
              {/* Brand */}
              <div className="flex min-w-0 items-center gap-3 border-b border-slate-200/70 py-2.5 pl-3 pr-2.5 sm:gap-3.5 sm:py-3 sm:pl-4 sm:pr-3 lg:flex-1 lg:border-b-0 lg:border-r lg:border-slate-200/70 lg:py-3 lg:pl-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white p-1 shadow-[inset_0_1px_2px_rgba(23,37,107,0.06)] ring-1 ring-slate-200/90 sm:h-[3.875rem] sm:w-[3.875rem] sm:p-1.5">
                  <img
                    src={batrascoLogo}
                    alt="Batrasco"
                    width={128}
                    height={128}
                    className="h-full w-full object-contain object-center"
                    decoding="async"
                  />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <p className="text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-[#c23e01]">
                    Fleet operations
                  </p>
                  <h1 className="mt-1 text-balance text-[15px] font-bold leading-snug tracking-tight text-[#17256b] sm:text-lg lg:text-[1.125rem]">
                    Batangas – Lipa Batrasco Tracker
                  </h1>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-xs">
                    Live GPS fleet and route status
                  </p>
                </div>
              </div>

              {/* Nav + route: one row from sm; lg:contents lifts children into parent flex row */}
              <div className="flex min-w-0 flex-col divide-y divide-slate-200/70 sm:flex-row sm:divide-x sm:divide-y-0 sm:divide-slate-200/70 lg:contents">
                <div className="flex min-w-0 items-stretch px-2.5 py-2 sm:w-0 sm:flex-1 sm:items-center sm:px-3 sm:py-2.5 lg:w-auto lg:flex-none lg:border-r lg:border-slate-200/70 lg:px-4 lg:py-3">
                  <nav
                    className="flex h-9 w-full min-w-0 gap-1 overflow-x-auto rounded-[10px] bg-slate-100/95 p-1 ring-1 ring-inset ring-slate-200/90 sm:h-10 lg:w-auto [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0"
                    aria-label="Main sections"
                  >
                    <NavLink
                      to="/tracker"
                      className={({ isActive }) =>
                        `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-semibold tracking-tight transition-all duration-200 sm:min-h-10 sm:px-3 sm:text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c23e01]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                          isActive
                            ? 'bg-[#253272] text-white shadow-md shadow-[#17256b]/25'
                            : 'text-slate-600 hover:bg-white hover:text-[#253272] active:scale-[0.99]'
                        }`
                      }
                    >
                      <LayoutDashboard className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
                      <span>Dashboard</span>
                    </NavLink>
                  <NavLink
                    to="/tracker-settings"
                    onClick={(e) => {
                      if (!isFleetAdminAuthorized()) {
                        e.preventDefault();
                        setIsLoginModalOpen(true);
                      }
                    }}
                    className={({ isActive }) =>
                      `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-semibold tracking-tight transition-all duration-200 sm:min-h-10 sm:px-3 sm:text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c23e01]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                        isActive
                          ? 'bg-[#253272] text-white shadow-md shadow-[#17256b]/25'
                          : 'text-slate-600 hover:bg-white hover:text-[#253272] active:scale-[0.99]'
                      }`
                    }
                  >
                    <MapPinned className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
                    <span>Fleet map</span>
                  </NavLink>
                </nav>
              </div>

              {/* Route + dev */}
              <div className="flex min-w-0 flex-col gap-2 px-2.5 py-2 sm:flex-1 sm:justify-center sm:px-3 sm:py-2.5 lg:flex lg:flex-1 lg:flex-row lg:items-center lg:justify-end lg:gap-2 lg:px-5 lg:py-3">
                <div className="flex w-full min-w-0 items-center gap-2 rounded-[10px] border border-slate-200/80 border-l-[3px] border-l-[#c23e01] bg-gradient-to-r from-slate-50/95 to-white py-1.5 pl-2 pr-2.5 shadow-sm shadow-slate-900/[0.035] sm:max-w-full lg:w-auto lg:max-w-sm">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#253272] to-[#484d80] text-white shadow-sm shadow-[#17256b]/20"
                    aria-hidden
                  >
                    <RouteIcon className="h-4 w-4" strokeWidth={2.25} />
                  </div>
                  <p className="min-w-0 flex-1 text-left text-[11px] leading-tight sm:text-xs">
                    <span className="font-bold uppercase tracking-[0.1em] text-slate-500">Active route</span>
                    <span className="mx-1.5 font-light text-slate-300" aria-hidden>
                      ·
                    </span>
                    <span className="font-mono text-[13px] font-bold tabular-nums tracking-tight text-[#17256b] sm:text-sm">
                      BAT-LIP-001
                    </span>
                  </p>
                </div>
                {import.meta.env.DEV && (
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    <button
                      type="button"
                      disabled={mockSimulatorBusy !== null}
                      title="Same as npm run simulate-tracker-quick"
                      onClick={() => void runMockSimulator('quick')}
                      aria-label="Start quick mock simulator"
                      aria-busy={mockSimulatorBusy === 'quick'}
                      className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-amber-300/90 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-initial sm:text-sm"
                    >
                      {mockSimulatorBusy === 'quick' ? 'Starting…' : 'Quick mock'}
                    </button>
                    <button
                      type="button"
                      disabled={mockSimulatorBusy !== null}
                      title="Same as npm run simulate-tracker-realistic"
                      onClick={() => void runMockSimulator('realistic')}
                      aria-label="Start realistic mock simulator"
                      aria-busy={mockSimulatorBusy === 'realistic'}
                      className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-amber-300/90 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-initial sm:text-sm"
                    >
                      {mockSimulatorBusy === 'realistic' ? 'Starting…' : 'Realistic mock'}
                    </button>
                    {mockSimulatorNote && (
                      <p className="w-full text-center text-[11px] text-slate-600 sm:text-right">{mockSimulatorNote}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
      )}

      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
        <AppRoutes
          vehicles={vehicles}
          selectedVehicle={selectedVehicle}
          setSelectedVehicle={setSelectedVehicle}
          setIngestSettingsNonce={setIngestSettingsNonce}
          apiAvailable={apiAvailable}
          dataError={dataError}
        />
      </div>

      <FleetMapLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={() => {
          setIsLoginModalOpen(false);
          navigate('/tracker-settings');
        }}
      />
    </div>
  );
}
