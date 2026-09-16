import { Link } from 'react-router-dom';
import { MapPin, Navigation } from 'lucide-react';
import { Vehicle, Station } from '../../App';
import { resolveDirectionAlongRoute, ROUTE_LENGTH_KM } from '../../lib/route/route-geometry';

/** km from SM Lipa (corridor east endpoint @ 100%) backwards to `positionPercent`. */
function kmFromSm(positionPercent: number): number {
  return ((100 - positionPercent) / 100) * ROUTE_LENGTH_KM;
}
/** "12 km", or "0.4 km" when under a kilometre (matches endpoint-label convention). */
function formatKm(km: number): string {
  return km < 1 ? km.toFixed(1) : String(Math.round(km));
}

type RouteMapProps = {
  vehicles: Vehicle[];
  stations: Station[];
  selectedVehicle: string | null;
  onVehicleSelect: (id: string) => void;
  focusedStationId?: string | null;
};

export function RouteMap({
  vehicles,
  stations,
  selectedVehicle,
  onVehicleSelect,
  focusedStationId = null,
}: RouteMapProps) {
  const TRAFFIC_SPEED_THRESHOLD_KMH = 12;
  /** Yellow = slow roll / possible congestion, not parked (speed 0). */
  const isSlowMovingTraffic = (v: Vehicle) =>
    v.status === 'online' && v.speed > 0 && v.speed <= TRAFFIC_SPEED_THRESHOLD_KMH;

  /** Lipa = green (north/east run); Batangas = dark orange (logo warm side). */
  const getVehicleColor = (vehicle: Vehicle) => {
    if (vehicle.status !== 'online') return 'bg-[#64748b]';
    return resolveDirectionAlongRoute(vehicle) === 'to_lipa' ? 'bg-[#15803d]' : 'bg-[#c23e01]';
  };
  const getVehicleBorderClass = (vehicle: Vehicle, isSelected: boolean) => {
    if (isSlowMovingTraffic(vehicle)) return 'border-[#ca5730]';
    if (isSelected) return 'border-[#17256b]';
    return 'border-white/90';
  };

  return (
    <div className="h-full min-w-0 rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-lg shadow-slate-900/[0.06] sm:p-3">
      <div className="mb-2 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Navigation className="h-4 w-4 shrink-0 text-[#c23e01]" />
          <h2 className="min-w-0 text-sm font-bold text-gray-900">Route Visualization</h2>
        </div>
        <span className="text-[11px] leading-snug text-gray-500 sm:ml-auto sm:text-xs">
          Batangas City ↔ San Jose ↔ Lipa City
        </span>
      </div>

      <div className="relative min-h-[min(22rem,58vh)] overflow-hidden rounded-lg bg-gradient-to-r from-[#ecfdf5]/90 via-slate-50 to-[#fff1eb]/95 py-3 pl-2 pr-2 pb-12 pt-3 ring-1 ring-slate-200/60 sm:min-h-[200px] sm:pl-4 sm:pr-20 sm:pt-4 sm:pb-14">
        {/* Route Path — Lipa (green) → Batangas (orange) */}
        <div className="absolute top-1/2 left-6 right-6 h-2 rounded-full bg-slate-200/90 -translate-y-1/2">
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#22c55e]/55 via-[#94a3b8]/35 to-[#ea580c]/55 opacity-90" />
        </div>

        {/* Stations — pin on route line; uniform card size so labels align evenly */}
        {stations.map((station) => (
          <div
            key={station.id}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
            style={{ left: `calc(6% + ${station.position * 0.88}%)` }}
          >
            {/* Spacer so pin center sits on route line; then pin + connector + card */}
            <div className="shrink-0" style={{ height: '3.5rem' }} aria-hidden />
            <div className="relative z-10 flex flex-col items-center shrink-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-gradient-to-br from-[#253272] to-[#484d80] shadow-xl shadow-[#17256b]/30 ring-2 ring-[#484d80]/35">
                <MapPin className="h-5 w-5 text-white" strokeWidth={2.5} aria-hidden />
              </div>
              <div className="h-2 w-px shrink-0 bg-gray-300" aria-hidden />
            </div>
            <Link
              to={`/station/${station.id}`}
              className={`mt-1 block h-auto min-h-[4.5rem] w-[min(12.5rem,calc(50vw-1.25rem))] max-w-[12.5rem] shrink-0 cursor-pointer overflow-hidden rounded-2xl border-2 bg-white text-inherit shadow-[0_8px_18px_rgba(23,37,107,0.12)] no-underline outline-none ring-offset-2 transition-[border-color,box-shadow] hover:border-[#17256b]/35 hover:shadow-[0_10px_22px_rgba(23,37,107,0.16)] focus-visible:ring-2 focus-visible:ring-[#253272]/40 sm:min-h-[4.75rem] sm:w-[12.5rem] ${
                focusedStationId === station.id
                  ? 'border-[#c23e01]/55 ring-2 ring-[#c23e01]/25'
                  : 'border-[#17256b]/20'
              }`}
              aria-current={focusedStationId === station.id ? 'page' : undefined}
              aria-label={`Open dedicated page for Station ${station.stationNumber}, ${station.name}`}
            >
              <div className="flex min-h-[4.5rem] min-w-0 items-center gap-1.5 px-2 py-2 sm:min-h-[4.75rem] sm:gap-2 sm:px-3 sm:py-2">
                <div className="shrink-0 text-[#253272]">
                  <MapPin className="h-6 w-6 sm:h-8 sm:w-8" />
                </div>
                <div className="min-w-0 flex flex-1 flex-col justify-center">
                  <span className="text-sm font-bold leading-tight text-[#17256b] sm:text-lg sm:leading-none">
                    Station {station.stationNumber}
                  </span>
                  <span
                    className="mt-0.5 line-clamp-2 text-xs leading-tight text-[#253272]/90 sm:truncate sm:text-sm sm:whitespace-nowrap"
                    title={station.name}
                  >
                    {station.name}
                  </span>
                  <span
                    className="mt-0.5 text-[10px] leading-none text-gray-500 sm:mt-1 sm:text-xs sm:whitespace-nowrap"
                    title={`${kmFromSm(station.position).toFixed(2)} km from SM Lipa along the driving corridor`}
                  >
                    ~{formatKm(kmFromSm(station.position))} km
                  </span>
                </div>
              </div>
            </Link>
          </div>
        ))}

        {/* Vehicles */}
        {vehicles.map((vehicle) => {
          const isNoSelection =
            selectedVehicle === null ||
            selectedVehicle === '' ||
            selectedVehicle === '__all__';
          const isSelected = !isNoSelection && selectedVehicle === vehicle.id;
          return (
          <div
            key={vehicle.id}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer transition-all duration-500"
            style={{ left: `calc(6% + ${vehicle.currentPosition * 0.88}%)` }}
            onClick={() => onVehicleSelect(vehicle.id)}
          >
            <div className={`relative ${isSelected ? 'scale-125' : 'scale-100'} transition-transform`}>
              {/* Vehicle Icon */}
              <div
                className={`w-8 h-8 ${getVehicleColor(vehicle)} rounded-lg border-2 ${getVehicleBorderClass(vehicle, isSelected)} shadow-lg flex items-center justify-center transform hover:scale-110 transition-transform`}
                data-vehicle-marker-id={vehicle.id}
                data-vehicle-plate={vehicle.plateNumber}
              >
                <span className="text-white font-bold text-xs">
                  {vehicle.plateNumber.includes('-')
                    ? vehicle.plateNumber.split('-')[1]
                    : vehicle.plateNumber.slice(-4)}
                </span>
              </div>
              
              {/* Selected Vehicle Info */}
              {isSelected && (
                <div className="absolute -top-14 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded shadow-lg p-2 w-28 z-10">
                  <div className="text-xs font-bold">{vehicle.plateNumber}</div>
                  <div className="text-xs opacity-80">
                    {vehicle.speed} km/h
                  </div>
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900" />
                </div>
              )}
            </div>
          </div>
          );
        })}

        {/* Distance label — SM Lipa (corridor east endpoint) is the 0 km
            reference at the RIGHT end of the strip. Left-end Palico label
            removed per product: per-station `~N km` labels inside the cards
            already convey each stop's distance from SM. */}
        <div className="absolute bottom-3 left-6 right-6 flex justify-end text-xs text-gray-500">
          <span>0 km</span>
        </div>
      </div>

      {/* Legend — explicit colors so pills never match (violet/amber were both peach in theme). */}
      <div className="mt-3 rounded-xl border border-slate-200/90 bg-gradient-to-r from-slate-50 to-white p-2.5 shadow-sm ring-1 ring-slate-100/80">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#17256b]">Legend</span>
          <span className="text-[10px] font-medium text-slate-500">Lipa · green · Batangas · orange</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#6ee7b7] bg-[#ecfdf5] px-3 py-1.5 text-slate-800 shadow-sm">
            <div
              className="h-3.5 w-3.5 shrink-0 rounded-md bg-[#15803d] shadow-sm ring-2 ring-white"
              aria-hidden
            />
            <span className="text-[13px] font-semibold leading-none">Going to Lipa</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#fdba74] bg-[#fff1eb] px-3 py-1.5 text-slate-800 shadow-sm">
            <div
              className="h-3.5 w-3.5 shrink-0 rounded-md bg-[#c23e01] shadow-sm ring-2 ring-white"
              aria-hidden
            />
            <span className="text-[13px] font-semibold leading-none">Going to Batangas</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#facc15] bg-[#fefce8] px-3 py-1.5 text-slate-800 shadow-sm">
            <div
              className="h-3.5 w-3.5 shrink-0 rounded-md border-[2.5px] border-[#ca5730] bg-white shadow-sm ring-2 ring-white"
              aria-hidden
            />
            <span className="text-[13px] font-semibold leading-none">In traffic</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-slate-800 shadow-sm">
            <div
              className="h-3.5 w-3.5 shrink-0 rounded-md bg-[#64748b] shadow-sm ring-2 ring-white"
              aria-hidden
            />
            <span className="text-[13px] font-semibold leading-none">Offline</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#17256b]/25 bg-[#eef2fa] px-3 py-1.5 text-slate-800 shadow-sm">
            <div
              className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#253272] to-[#484d80] shadow-sm ring-2 ring-white"
              aria-hidden
            >
              <MapPin className="h-2 w-2 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[13px] font-semibold leading-none">Station</span>
          </div>
        </div>
      </div>
    </div>
  );
}