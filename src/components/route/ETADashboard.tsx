import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clock, AlertCircle, Timer, Bus } from 'lucide-react';
import { Station, Vehicle } from '../../App';
import {
  ETA_MIN_EFFECTIVE_SPEED_KMH,
  effectiveSpeedKmhForEta,
  linearDistanceKmToStation,
  nextStationInDirectionOfTravel,
  resolveDirectionAlongRoute,
} from '../../lib/route/route-geometry';
import {
  entriesByStationForAllVehicles,
  getDestinationStationForList,
  syncDepartedTimestamps,
  type StationVehicleStatus,
} from '../../lib/fleet/vehicles-by-station';

type ETADashboardProps = {
  stations: Station[];
  vehicles: Vehicle[];
  selectedVehicle: string | null;
  onVehicleSelect: (vehicleId: string) => void;
  /** Single-station view: hide other stops’ cards (same layout as home otherwise). */
  focusedStationId?: string | null;
  headerAction?: ReactNode;
};

function formatClockTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StationVehicleRows({
  station,
  stations,
  entries,
  selectedVehicle,
  onVehicleSelect,
  size = 'default',
}: {
  station: Station;
  stations: Station[];
  entries: Array<{ vehicle: Vehicle; status: StationVehicleStatus }>;
  selectedVehicle: string | null;
  onVehicleSelect: (vehicleId: string) => void;
  /** Larger touch targets and type for single-station view */
  size?: 'default' | 'featured';
}) {
  const lg = size === 'featured';
  const useTwoColumns = entries.length >= 5;

  if (entries.length === 0) {
    return (
      <div
        className={`flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50/80 text-center ${
          lg ? 'px-4 py-10' : 'px-2 py-4'
        }`}
      >
        <p className={`font-medium text-gray-500 ${lg ? 'text-base' : 'text-[11px]'}`}>No vehicles</p>
      </div>
    );
  }

  return (
    <ul
      className={`min-h-0 flex-1 overflow-y-auto pr-0.5 ${
        lg
          ? useTwoColumns
            ? 'grid max-h-[min(380px,52vh)] grid-cols-2 gap-2'
            : 'max-h-[min(380px,52vh)] space-y-2'
          : useTwoColumns
            ? 'grid max-h-[min(240px,42vh)] grid-cols-2 gap-1'
            : 'max-h-[min(240px,42vh)] space-y-1'
      }`}
      role="list"
      aria-label={`Vehicles for ${station.location}`}
    >
      {entries.map(({ vehicle, status }) => {
        const destination = getDestinationStationForList(vehicle, stations, station, status);
        const isSelected = selectedVehicle === vehicle.id;
        const legKm = linearDistanceKmToStation(vehicle, station);
        const vehicleEta = (() => {
          if (legKm === null) return null;
          if (legKm <= 0.01) return 'Arrived';
          const speedForEta =
            vehicle.speed > 0 ? effectiveSpeedKmhForEta(vehicle.speed) : ETA_MIN_EFFECTIVE_SPEED_KMH;
          const effSpeed = Math.max(speedForEta, ETA_MIN_EFFECTIVE_SPEED_KMH);
          const timeInMinutes = Math.round((legKm / effSpeed) * 60);
          return timeInMinutes < 1 ? '< 1 min' : `${timeInMinutes} min`;
        })();

        return (
          <li key={vehicle.id}>
            <button
              type="button"
              onClick={() => onVehicleSelect(vehicle.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-md border text-left transition-colors ${
                lg ? 'px-3 py-3 sm:rounded-lg sm:py-3.5' : 'gap-2 px-2 py-1.5'
              } ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/30'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className={`min-w-0 flex flex-col ${lg ? 'gap-1' : 'gap-0.5'}`}>
                <span
                  className={`truncate font-semibold text-gray-900 ${lg ? 'text-sm sm:text-base' : 'text-[11px]'}`}
                >
                  Unit {vehicle.plateNumber}
                </span>
                {status === 'departed' && destination && (
                  <span
                    className={`truncate text-gray-600 ${lg ? 'text-xs sm:text-sm' : 'text-[10px]'}`}
                    title={destination.location}
                  >
                    → {destination.location}
                  </span>
                )}
              </div>
              {vehicleEta && (
                <span
                  className={`shrink-0 rounded font-semibold tabular-nums border border-blue-200 bg-blue-50 text-blue-800 ${
                    lg ? 'px-2 py-1 text-[11px] sm:text-xs' : 'px-1.5 py-0.5 text-[9px]'
                  }`}
                >
                  {vehicleEta}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ETADashboard({
  stations,
  vehicles,
  selectedVehicle,
  onVehicleSelect,
  focusedStationId = null,
  headerAction = null,
}: ETADashboardProps) {
  const departedAtRef = useRef<Map<string, number>>(new Map());

  const now = Date.now();
  syncDepartedTimestamps(vehicles, stations, departedAtRef.current, now);

  const displayStations = focusedStationId
    ? stations.filter((s) => s.id === focusedStationId)
    : stations;

  const activeVehicles = vehicles.filter((v) => v.status === 'online');
  const stationEntriesMap = entriesByStationForAllVehicles(vehicles, stations, {
    departedAt: departedAtRef.current,
    now,
  });

  /** Inbound ETA to this stop for any online vehicle (fleet-wide). Sidebar columns only place each vehicle once, so e.g. Batangas must not be limited to rows listed under Station 1. */
  const getNextArrivals = (station: Station) => {
    return activeVehicles
      .map((vehicle) => {
        const distanceKm = linearDistanceKmToStation(vehicle, station);
        if (distanceKm === null) return null;

        let eta: string;
        if (distanceKm <= 0.01) {
          eta = 'Arrived';
        } else {
          // Never show N/A in station ETA cards: if reported speed is 0/invalid,
          // use the minimum effective ETA speed so users still get a computable estimate.
          const speedForEta =
            vehicle.speed > 0 ? effectiveSpeedKmhForEta(vehicle.speed) : ETA_MIN_EFFECTIVE_SPEED_KMH;
          const effSpeed = Math.max(speedForEta, ETA_MIN_EFFECTIVE_SPEED_KMH);
          const timeInHours = distanceKm / effSpeed;
          const timeInMinutes = Math.round(timeInHours * 60);
          if (timeInMinutes < 1) {
            eta = '< 1 min';
          } else {
            eta = `${timeInMinutes} min`;
          }
        }

        let etaMinutes: number;
        if (eta === 'Arrived') {
          etaMinutes = 0;
        } else if (eta === '< 1 min') {
          etaMinutes = 0.5;
        } else {
          const match = eta.match(/(\d+)\s*min/);
          etaMinutes = match ? parseInt(match[1], 10) : Infinity;
        }

        return { vehicle, eta, distanceKm, etaMinutes };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.etaMinutes - b.etaMinutes)
      .slice(0, 2);
  };

  /** When no inbound ETA to this stop, show ETA to the vehicle’s next stop along the line (on-route). */
  const getNextStopAlongRoutePreview = (station: Station) => {
    const entries = stationEntriesMap.get(station.id) ?? [];
    const online = entries.filter((e) => e.vehicle.status === 'online');
    const previews: Array<{
      vehicle: Vehicle;
      eta: string;
      distanceKm: number;
      etaMinutes: number;
      nextLabel: string;
      direction: ReturnType<typeof resolveDirectionAlongRoute>;
    }> = [];
    for (const { vehicle } of online) {
      const nextSt = nextStationInDirectionOfTravel(vehicle, stations);
      if (!nextSt) continue;
      const distanceKm = linearDistanceKmToStation(vehicle, nextSt);
      if (distanceKm === null || distanceKm <= 0.01) continue;
      const speedForEta =
        vehicle.speed > 0 ? effectiveSpeedKmhForEta(vehicle.speed) : ETA_MIN_EFFECTIVE_SPEED_KMH;
      const effSpeed = Math.max(speedForEta, ETA_MIN_EFFECTIVE_SPEED_KMH);
      const timeInMinutes = Math.round((distanceKm / effSpeed) * 60);
      const eta = timeInMinutes < 1 ? '< 1 min' : `${timeInMinutes} min`;
      const etaMinutes = timeInMinutes < 1 ? 0.5 : timeInMinutes;
      previews.push({
        vehicle,
        eta,
        distanceKm,
        etaMinutes,
        nextLabel: nextSt.location,
        direction: resolveDirectionAlongRoute(vehicle),
      });
    }
    if (previews.length === 0) return null;
    previews.sort((a, b) => a.etaMinutes - b.etaMinutes);
    return previews[0];
  };

  const getDepartedPreview = (
    station: Station,
    entries: Array<{ vehicle: Vehicle; status: StationVehicleStatus }>
  ) => {
    const departedEntries = entries
      .filter((entry) => entry.status === 'departed' && entry.vehicle.status === 'online')
      .map((entry) => {
        const departedAt = departedAtRef.current.get(`${entry.vehicle.id}:${station.id}`);
        const fallbackTime = entry.vehicle.lastUpdated ? new Date(entry.vehicle.lastUpdated).getTime() : null;
        const timestamp = departedAt ?? fallbackTime;
        if (!timestamp || Number.isNaN(timestamp)) return null;

        return {
          vehicle: entry.vehicle,
          departedAt: timestamp,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.departedAt - a.departedAt);

    return departedEntries[0] ?? null;
  };

  const isFocusShell = Boolean(focusedStationId);
  const focusedStation = focusedStationId
    ? stations.find((s) => s.id === focusedStationId)
    : undefined;

  return (
    <div
      className={`w-full min-w-0 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-700 shadow-lg shadow-slate-900/20 ring-1 ring-white/10 ${
        isFocusShell ? 'p-4 sm:p-6 lg:p-8' : 'p-3 sm:p-4'
      }`}
    >
      {isFocusShell && focusedStation ? (
        <div className="mb-5 flex min-w-0 flex-col gap-3 sm:gap-3 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 md:contents">
            <Link
              to="/"
              className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-white/35 bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-blue-700 sm:px-3 sm:text-sm"
            >
              ← All stations
            </Link>
            <p className="min-w-0 flex-1 text-xs text-white/95 sm:text-sm md:text-base">
              <span className="font-bold text-white">Station {focusedStation.stationNumber} · {focusedStation.location}</span>
              <span className="mx-1 text-white/55 sm:mx-1.5" aria-hidden>
                ·
              </span>
              <span className="font-medium text-white">{focusedStation.name}</span>
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3 md:ml-auto">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white sm:h-11 sm:w-11 lg:h-12 lg:w-12">
              <Clock className="h-5 w-5 text-blue-600 sm:h-6 sm:w-6 lg:h-7 lg:w-7" />
            </div>
            <h2 className="min-w-0 text-balance text-base font-bold leading-tight text-white sm:text-xl md:text-2xl lg:text-3xl">
              Estimated Time of Arrival
            </h2>
          </div>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white">
            <Clock className="h-5 w-5 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white">Estimated Time of Arrival</h2>
          </div>
          {headerAction}
        </div>
      )}

      {/* Home: one column on narrow phones, three from md; `/station/:id` stays single column */}
      <div className="w-full min-w-0 pb-1 [-webkit-overflow-scrolling:touch]">
        <div
          className={`grid w-full min-w-0 gap-3 ${
            focusedStationId
              ? 'mx-auto max-w-6xl grid-cols-1 xl:max-w-7xl'
              : 'grid-cols-1 md:grid-cols-3'
          }`}
        >
          {displayStations.map((station) => {
          const isStationFocus = Boolean(focusedStationId);
          const baseEntries = stationEntriesMap.get(station.id) ?? [];
          const baseIds = new Set(baseEntries.map((e) => e.vehicle.id));
          /** Also list vehicles inbound to this stop even if their primary column is another stop (matches fleet-wide hero ETA). */
          const inboundExtra: Array<{ vehicle: Vehicle; status: StationVehicleStatus }> = [];
          for (const v of activeVehicles) {
            if (baseIds.has(v.id)) continue;
            const d = linearDistanceKmToStation(v, station);
            if (d === null) continue;
            inboundExtra.push({
              vehicle: v,
              status: d <= 0.01 ? 'at_station' : 'arriving',
            });
          }
          const listEntries = [...baseEntries, ...inboundExtra].sort(
            (a, b) => a.vehicle.currentPosition - b.vehicle.currentPosition
          );
          const nextArrivals = getNextArrivals(station);
          const hasArrivals = nextArrivals.length > 0;
          const departedPreview = !hasArrivals ? getDepartedPreview(station, baseEntries) : null;
          const nextAlongRoutePreview =
            !hasArrivals && !departedPreview ? getNextStopAlongRoutePreview(station) : null;
          const nextStopTowardBatangas = nextAlongRoutePreview?.direction === 'to_batangas';
          const hasListButNoInboundEta = !hasArrivals && listEntries.length > 0;

          const stationTitleBlock = (
            <>
              <div className="min-w-0 flex-1">
                {isStationFocus ? (
                  <p
                    className="text-base font-medium text-gray-600 sm:text-lg"
                    title={station.location}
                  >
                    Station {station.stationNumber} · {station.location} ({station.name})
                  </p>
                ) : (
                  <>
                    <h3 className="text-sm font-bold text-gray-900">
                      Station {station.stationNumber} · {station.location}
                    </h3>
                    <p className="truncate text-xs text-gray-600" title={station.name}>
                      {station.name}
                    </p>
                  </>
                )}
              </div>
              <span
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200/90 bg-slate-50 font-bold tabular-nums text-slate-800 shadow-sm ${
                  isStationFocus
                    ? 'px-3 py-1.5 text-sm sm:text-base'
                    : 'gap-1 px-2 py-1 text-[10px]'
                }`}
                title={`${listEntries.length} vehicle${listEntries.length === 1 ? '' : 's'} at this stop`}
              >
                <Bus
                  className={`shrink-0 text-slate-500 ${isStationFocus ? 'h-4 w-4 sm:h-5 sm:w-5' : 'h-3 w-3'}`}
                  aria-hidden
                />
                {listEntries.length}
              </span>
            </>
          );

          return (
            <div
              key={station.id}
              className={`flex min-w-0 flex-col rounded-lg bg-white shadow-md ${
                isStationFocus
                  ? 'min-h-[280px] p-5 sm:min-h-[300px] sm:p-6 md:p-8'
                  : 'min-h-[200px] p-3'
              }`}
            >
              <div
                className={`flex flex-shrink-0 items-start justify-between gap-3 border-b border-gray-200 ${
                  isStationFocus
                    ? 'mb-5 min-h-[4rem] pb-4 sm:gap-4'
                    : 'mb-3 min-h-[3rem] gap-2 pb-2'
                }`}
              >
                {focusedStationId ? (
                  stationTitleBlock
                ) : (
                  <Link
                    to={`/station/${station.id}`}
                    className="flex min-w-0 flex-1 items-start justify-between gap-2 rounded-md text-inherit no-underline outline-none ring-offset-2 transition-colors hover:bg-slate-50/90 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                    aria-label={`Open dedicated page for Station ${station.stationNumber}, ${station.name}`}
                  >
                    {stationTitleBlock}
                  </Link>
                )}
              </div>

              <div
                className={
                  isStationFocus
                    ? 'flex min-h-0 flex-1 flex-row items-stretch gap-6 sm:gap-8 lg:gap-10'
                    : 'flex min-h-0 flex-1 flex-col gap-3'
                }
              >
                {/* ETA — left when focused; stacked above vehicles on home */}
                <div
                  className={
                    isStationFocus
                      ? 'flex min-h-[160px] min-w-0 flex-[1.15] flex-col justify-center sm:min-h-[180px]'
                      : 'flex min-h-[120px] w-full min-w-0 flex-col'
                  }
                >
                  {hasArrivals ? (
                    <div className={isStationFocus ? 'space-y-3' : 'space-y-2'}>
                      {nextArrivals.slice(0, 1).map((arrival) => {
                        const isArriving = arrival.eta === '< 1 min' || arrival.eta === 'Arrived';
                        const isDelayed = false;

                        return (
                          <div
                            key={arrival.vehicle.id}
                            className={`rounded-lg border ${
                              isStationFocus ? 'p-4 sm:p-5 md:p-6' : 'p-2'
                            } ${
                              isArriving
                                ? 'bg-green-50 border-green-400'
                                : isDelayed
                                  ? 'bg-yellow-50 border-yellow-400'
                                  : 'bg-blue-50 border-blue-400'
                            }`}
                          >
                            <div
                              className={`flex items-center justify-between ${isStationFocus ? 'mb-2' : 'mb-1'}`}
                            >
                              <div
                                className={`font-bold text-gray-900 ${isStationFocus ? 'text-base sm:text-lg md:text-xl' : 'text-xs'}`}
                              >
                                Unit {arrival.vehicle.plateNumber}
                              </div>
                              {isDelayed && (
                                <AlertCircle
                                  className={`text-yellow-600 ${isStationFocus ? 'h-5 w-5' : 'h-3 w-3'}`}
                                />
                              )}
                            </div>

                            <div
                              className={`text-center rounded ${
                                isStationFocus ? 'py-4 sm:py-5 md:py-6' : 'py-2'
                              } ${
                                isArriving ? 'bg-green-100' : isDelayed ? 'bg-yellow-100' : 'bg-blue-100'
                              }`}
                            >
                              <div
                                className={`font-bold ${
                                  isStationFocus
                                    ? 'text-4xl sm:text-5xl md:text-6xl lg:text-7xl'
                                    : 'text-xl sm:text-2xl md:text-3xl'
                                } ${
                                  isArriving
                                    ? 'text-green-600'
                                    : isDelayed
                                      ? 'text-yellow-600'
                                      : 'text-blue-600'
                                }`}
                              >
                                {arrival.eta}
                              </div>
                            </div>

                            <div
                              className={`border-t border-gray-200 ${isStationFocus ? 'mt-4 pt-4' : 'mt-2 pt-2'}`}
                            >
                              <div
                                className={`text-gray-600 ${isStationFocus ? 'text-sm sm:text-base md:text-lg' : 'text-xs'}`}
                              >
                                ~
                                {arrival.distanceKm < 1
                                  ? arrival.distanceKm.toFixed(1)
                                  : arrival.distanceKm < 10
                                    ? arrival.distanceKm.toFixed(1)
                                    : Math.round(arrival.distanceKm)}{' '}
                                km
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : departedPreview ? (
                    <div className={isStationFocus ? 'space-y-3' : 'space-y-2'}>
                      <div
                        className={`rounded-lg border border-slate-300 bg-slate-50/95 ${
                          isStationFocus ? 'p-4 sm:p-5 md:p-6' : 'p-2'
                        }`}
                      >
                        <p
                          className={`mb-2 font-semibold uppercase tracking-wide text-slate-700 ${
                            isStationFocus ? 'text-xs sm:text-sm' : 'text-[9px]'
                          }`}
                        >
                          Vehicle departed this stop
                        </p>
                        <div
                          className={`flex items-center justify-between ${isStationFocus ? 'mb-2' : 'mb-1'}`}
                        >
                          <div
                            className={`font-bold text-gray-900 ${isStationFocus ? 'text-base sm:text-lg md:text-xl' : 'text-xs'}`}
                          >
                            Unit {departedPreview.vehicle.plateNumber}
                          </div>
                        </div>
                        <div
                          className={`rounded bg-slate-100/95 text-center ${
                            isStationFocus ? 'py-3 sm:py-4 md:py-5' : 'py-2'
                          }`}
                        >
                          <div
                            className={`font-bold text-slate-900 ${
                              isStationFocus
                                ? 'text-3xl sm:text-4xl md:text-5xl lg:text-6xl'
                                : 'text-xl sm:text-2xl md:text-3xl'
                            }`}
                          >
                            Departed
                          </div>
                          <p
                            className={`mt-1 font-medium text-slate-700 ${
                              isStationFocus ? 'text-sm sm:text-base' : 'text-[10px]'
                            }`}
                          >
                            {formatClockTime(departedPreview.departedAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : nextAlongRoutePreview ? (
                    <div className={isStationFocus ? 'space-y-3' : 'space-y-2'}>
                      <div
                        className={`rounded-lg border ${
                          nextStopTowardBatangas
                            ? 'border-amber-300 bg-amber-50/95'
                            : 'border-emerald-300 bg-emerald-50/95'
                        } ${isStationFocus ? 'p-4 sm:p-5 md:p-6' : 'p-2'}`}
                      >
                        <p
                          className={`mb-2 font-semibold uppercase tracking-wide ${
                            nextStopTowardBatangas ? 'text-amber-900/90' : 'text-emerald-900/90'
                          } ${isStationFocus ? 'text-xs sm:text-sm' : 'text-[9px]'}`}
                        >
                          {nextStopTowardBatangas
                            ? 'Toward Batangas · next stop (map: orange)'
                            : 'Toward Lipa · next stop (map: green)'}
                        </p>
                        <div
                          className={`flex items-center justify-between ${isStationFocus ? 'mb-2' : 'mb-1'}`}
                        >
                          <div
                            className={`font-bold text-gray-900 ${isStationFocus ? 'text-base sm:text-lg md:text-xl' : 'text-xs'}`}
                          >
                            Unit {nextAlongRoutePreview.vehicle.plateNumber}
                          </div>
                        </div>
                        <div
                          className={`text-center rounded ${isStationFocus ? 'py-3 sm:py-4 md:py-5' : 'py-2'} ${
                            nextStopTowardBatangas ? 'bg-amber-100/90' : 'bg-emerald-100/90'
                          }`}
                        >
                          <div
                            className={`font-bold ${
                              nextStopTowardBatangas ? 'text-amber-900' : 'text-emerald-900'
                            } ${
                              isStationFocus
                                ? 'text-3xl sm:text-4xl md:text-5xl lg:text-6xl'
                                : 'text-xl sm:text-2xl md:text-3xl'
                            }`}
                          >
                            {nextAlongRoutePreview.eta}
                          </div>
                          <p
                            className={`mt-1 font-medium ${
                              nextStopTowardBatangas ? 'text-amber-950/90' : 'text-emerald-950/90'
                            } ${isStationFocus ? 'text-sm sm:text-base' : 'text-[10px]'}`}
                          >
                            {nextAlongRoutePreview.nextLabel}
                          </p>
                        </div>
                        <div
                          className={`border-t ${
                            nextStopTowardBatangas ? 'border-amber-200/90' : 'border-emerald-200/90'
                          } ${isStationFocus ? 'mt-3 pt-3' : 'mt-2 pt-2'}`}
                        >
                          <div
                            className={`text-gray-600 ${isStationFocus ? 'text-sm sm:text-base md:text-lg' : 'text-xs'}`}
                          >
                            ~
                            {nextAlongRoutePreview.distanceKm < 1
                              ? nextAlongRoutePreview.distanceKm.toFixed(1)
                              : nextAlongRoutePreview.distanceKm < 10
                                ? nextAlongRoutePreview.distanceKm.toFixed(1)
                                : Math.round(nextAlongRoutePreview.distanceKm)}{' '}
                            km along route
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : hasListButNoInboundEta ? (
                    <div
                      className={`flex flex-1 flex-col items-center justify-center gap-1 text-center ${
                        isStationFocus ? 'py-10' : 'py-4'
                      }`}
                    >
                      <Timer
                        className={`mx-auto text-gray-300 ${isStationFocus ? 'mb-2 h-14 w-14 sm:h-16 sm:w-16' : 'mb-1 h-8 w-8'}`}
                      />
                      <p
                        className={`font-semibold text-gray-500 ${isStationFocus ? 'text-base sm:text-lg' : 'text-xs'}`}
                      >
                        No inbound ETA at this stop
                      </p>
                    </div>
                  ) : (
                    <div
                      className={`flex flex-1 flex-col items-center justify-center text-center ${
                        isStationFocus ? 'py-10' : 'py-4'
                      }`}
                    >
                      <Timer
                        className={`mx-auto text-gray-300 ${isStationFocus ? 'mb-2 h-14 w-14 sm:h-16 sm:w-16' : 'mb-1 h-8 w-8'}`}
                      />
                      <p
                        className={`font-semibold text-gray-500 ${isStationFocus ? 'text-base sm:text-lg' : 'text-xs'}`}
                      >
                        No vehicles en route
                      </p>
                    </div>
                  )}
                </div>

                {/* Vehicle list — right column on station page; below ETA on home */}
                <div
                  className={
                    isStationFocus
                      ? 'flex min-h-0 min-w-0 flex-1 flex-col border-l border-gray-200 pl-5 sm:pl-6 lg:pl-8'
                      : 'flex min-h-0 min-w-0 flex-col border-t border-gray-200 pt-3'
                  }
                >
                  <div
                    className={`mb-2 flex items-center text-gray-500 ${isStationFocus ? 'mb-4 gap-2 sm:mb-5' : 'gap-1.5'}`}
                  >
                    <Bus
                      className={`shrink-0 ${isStationFocus ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-3.5 w-3.5'}`}
                      aria-hidden
                    />
                    <span
                      className={`font-bold uppercase tracking-wide ${isStationFocus ? 'text-xs sm:text-sm' : 'text-[10px]'}`}
                    >
                      Vehicles
                    </span>
                  </div>
                  <StationVehicleRows
                    station={station}
                    stations={stations}
                    entries={listEntries}
                    selectedVehicle={selectedVehicle}
                    onVehicleSelect={onVehicleSelect}
                    size={isStationFocus ? 'featured' : 'default'}
                  />
                </div>
              </div>
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}
