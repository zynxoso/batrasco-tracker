import { Bus, User, TrendingUp, Clock, ChevronRight } from 'lucide-react';
import { Vehicle } from '../../App';
import { computeEtaInDirectionOfTravel, resolveDirectionAlongRoute, ROUTE_LENGTH_KM } from '../../lib/route/route-geometry';

/** Reserved value for "All vehicles" in the dropdown. */
export const SELECTED_ALL = '__all__';

type VehicleTrackerProps = {
  vehicles: Vehicle[];
  selectedVehicle: string | null;
  onVehicleSelect: (id: string) => void;
  calculateETA: (vehicle: Vehicle, stationPosition: number) => string;
};

export function VehicleTracker({
  vehicles,
  selectedVehicle,
  onVehicleSelect,
  calculateETA: _calculateETA,
}: VehicleTrackerProps) {
  const getStatusColor = (status: string | undefined) =>
    status === 'online' ? 'bg-green-500' : 'bg-gray-500';
  const getStatusText = (status: string | undefined) =>
    status === 'online' ? 'Online' : 'Offline';

  const isNone = false;
  const isAll = selectedVehicle === SELECTED_ALL || selectedVehicle === null || selectedVehicle === '';
  const isSpecificVehicle =
    !isNone &&
    !isAll &&
    vehicles.some((v) => v.id === selectedVehicle);

  const displayedVehicle = isSpecificVehicle
    ? vehicles.find((v) => v.id === selectedVehicle) ?? null
    : null;

  /** Client-resolved trip ETA/distance (matches ETADashboard; avoids stale API strings). */
  const resolvedTrip =
    displayedVehicle != null
      ? (() => {
          const v = displayedVehicle;
          const towardLipa = resolveDirectionAlongRoute(v) === 'to_lipa';
          const eta = computeEtaInDirectionOfTravel(v.currentPosition, v.speed, towardLipa);
          const etaLine =
            eta.etaText === 'N/A' ? `N/A to ${eta.etaLabel}` : `${eta.etaText} to ${eta.etaLabel}`;
          const remainingPct = towardLipa
            ? Math.max(0, 100 - v.currentPosition)
            : Math.max(0, v.currentPosition);
          const remainingKm = (remainingPct / 100) * ROUTE_LENGTH_KM;
          return { etaLine, remainingKm };
        })()
      : null;

  const selectValue = (() => {
    if (selectedVehicle === SELECTED_ALL) return SELECTED_ALL;
    if (selectedVehicle === null || selectedVehicle === '') return SELECTED_ALL;
    if (vehicles.some((v) => v.id === selectedVehicle)) return selectedVehicle;
    return SELECTED_ALL;
  })();

  const handleNext = () => {
    if (vehicles.length === 0 || !isSpecificVehicle) return;
    const currentIndex = vehicles.findIndex((v) => v.id === selectedVehicle);
    const nextIndex = (currentIndex + 1) % vehicles.length;
    onVehicleSelect(vehicles[nextIndex].id);
  };

  return (
    <div className="h-full rounded-2xl border border-slate-200/80 bg-white p-3 shadow-lg shadow-slate-900/[0.06]">
      <div className="flex items-center gap-2 mb-2">
        <Bus className="w-4 h-4 text-blue-600" />
        <h2 className="text-sm font-bold text-gray-900">Map focus</h2>
      </div>

      <div className="flex gap-2 mb-3">
        <select
          value={selectValue}
          onChange={(e) => onVehicleSelect(e.target.value)}
          className="flex-1 min-w-0 text-sm font-medium text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 outline-none"
          aria-label="Choose vehicle: All vehicles or a specific vehicle"
        >
          <option value={SELECTED_ALL}>All vehicles</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plateNumber} – {v.driver}
            </option>
          ))}
        </select>
        {isSpecificVehicle && vehicles.length > 1 && (
          <button
            type="button"
            onClick={handleNext}
            className="shrink-0 inline-flex items-center justify-center gap-0.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 focus:ring-2 focus:ring-blue-500/30"
            aria-label="Next vehicle"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {isAll && (
        <p className="mb-3 text-xs leading-relaxed text-gray-500">
          Per-stop vehicle lists are to the right of each ETA above. Use this menu to highlight one unit on the route map.
        </p>
      )}

      {/* Single vehicle card (only when a specific vehicle is selected) */}
      {isSpecificVehicle && displayedVehicle && (
        <div className="p-3 rounded-lg border-2 border-blue-500 bg-blue-50 transition-all cursor-default">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-xs font-bold text-gray-900">{displayedVehicle.plateNumber}</div>
              <div className="text-xs text-gray-600 flex items-center gap-1">
                <User className="w-3 h-3" />
                {displayedVehicle.driver}
              </div>
            </div>
            <div className={`${getStatusColor(displayedVehicle.status)} text-white text-xs px-2 py-0.5 rounded-full`}>
              {getStatusText(displayedVehicle.status)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs mb-2">
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-blue-600" />
              <div>
                <div className="text-gray-500" style={{ fontSize: '10px' }}>
                  Speed
                </div>
                <div className="font-semibold">{displayedVehicle.speed} km/h</div>
              </div>
            </div>
            {resolvedTrip != null && (
              <div className="flex items-center gap-1">
                <div>
                  <div className="text-gray-500" style={{ fontSize: '10px' }}>
                    Remaining distance
                  </div>
                  <div className="font-semibold">~{Math.round(resolvedTrip.remainingKm)} km</div>
                </div>
              </div>
            )}
            {resolvedTrip != null && (
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-blue-600 shrink-0" />
                <div>
                  <div className="text-gray-500" style={{ fontSize: '10px' }}>
                    ETA (direction of travel)
                  </div>
                  <div className="font-semibold text-blue-700">{resolvedTrip.etaLine}</div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${getStatusColor(displayedVehicle.status)} transition-all duration-500`}
                style={{ width: `${displayedVehicle.currentPosition}%` }}
              />
            </div>
            <div className="text-xs text-gray-600 mt-1 text-center" style={{ fontSize: '10px' }}>
              {Math.round(displayedVehicle.currentPosition)}% complete
            </div>
          </div>
        </div>
      )}

      {!isNone && !isAll && !displayedVehicle && vehicles.length > 0 && (
        <div className="p-3 text-center text-sm text-gray-500 rounded-lg border border-dashed border-gray-200 bg-gray-50">
          Select a vehicle or All vehicles above.
        </div>
      )}
    </div>
  );
}
