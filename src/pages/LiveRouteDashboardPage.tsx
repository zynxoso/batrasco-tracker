import { useEffect, useRef, useState } from 'react';
import { ETADashboard } from '../components/route/ETADashboard';
import { RouteMap } from '../components/route/RouteMap';
import type { Station, Vehicle } from '../App';
import './LiveRouteDashboardPage.css';

type LiveRouteDashboardPageProps = {
  stations: Station[];
  vehicles: Vehicle[];
  selectedVehicle: string | null;
  onVehicleSelect: (vehicleId: string | null) => void;
  /** When set (e.g. `/station/2`), only this stop’s ETA card is shown. */
  focusedStationId?: string | null;
};

export function LiveRouteDashboardPage({
  stations,
  vehicles,
  selectedVehicle,
  onVehicleSelect,
  focusedStationId = null,
}: LiveRouteDashboardPageProps) {
  const [showVisibilityHelp, setShowVisibilityHelp] = useState(false);
  const helpPanelRef = useRef<HTMLDivElement | null>(null);
  const isHomePageView = !focusedStationId;
  // Convoy spacing panel moved to Tracker Settings page.

  useEffect(() => {
    if (!showVisibilityHelp) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (helpPanelRef.current && !helpPanelRef.current.contains(target)) {
        setShowVisibilityHelp(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowVisibilityHelp(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [showVisibilityHelp]);

  return (
    <div className="live-route-dashboard-page flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
      <div className="live-route-dashboard-page__map min-w-0">
        <RouteMap
          vehicles={vehicles}
          stations={stations}
          selectedVehicle={selectedVehicle}
          onVehicleSelect={onVehicleSelect}
          focusedStationId={focusedStationId}
        />
      </div>

      <ETADashboard
        stations={stations}
        vehicles={vehicles}
        selectedVehicle={selectedVehicle}
        onVehicleSelect={onVehicleSelect}
        focusedStationId={focusedStationId}
        headerAction={
          isHomePageView ? (
            <div className="relative shrink-0" ref={helpPanelRef}>
              <button
                type="button"
                onClick={() => setShowVisibilityHelp((prev) => !prev)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#253272]/45 focus-visible:ring-offset-2"
                aria-label="Explain vehicle visibility rules"
                aria-expanded={showVisibilityHelp}
                aria-controls="home-visibility-help"
              >
                ?
              </button>
              {showVisibilityHelp && (
                <div
                  id="home-visibility-help"
                  role="dialog"
                  aria-label="Vehicle visibility rules"
                  className="absolute right-0 top-10 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-xl sm:w-full sm:max-w-md sm:p-4"
                >
                  <p className="font-semibold text-slate-900">Why a vehicle is hidden on home view</p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600 sm:text-sm">
                    <li>Only vehicles with tracking enabled are shown.</li>
                    <li>Vehicles must be on the Batangas-Lipa route line to appear.</li>
                    <li>If GPS is missing/invalid or far from route, the vehicle is hidden here.</li>
                    <li>
                      ETA rows use <strong>Arrived</strong>, <strong>Arriving</strong>, or <strong>Departed</strong> only
                      (separate from the map’s <strong>On track</strong> line check in Fleet map).
                    </li>
                    <li>Hidden vehicles remain visible in Fleet map settings for operators.</li>
                  </ul>
                </div>
              )}
            </div>
          ) : null
        }
      />

    </div>
  );
}
