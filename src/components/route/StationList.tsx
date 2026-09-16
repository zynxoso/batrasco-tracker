import { useRef } from 'react';
import { Clock, MapPin, Bus } from 'lucide-react';
import { Station, Vehicle } from '../../App';
import { linearDistanceKmToStation } from '../../lib/route/route-geometry';
/** Speed (km/h) below which we consider vehicle idle (stopped for passengers). */
const IDLE_SPEED_THRESHOLD = 1;
/** Idle at station for this long (ms) before showing "AT STATION". */
const IDLE_AT_STATION_MS = 60 * 1000;

type StationListProps = {
  stations: Station[];
  vehicles: Vehicle[];
  calculateETA: (vehicle: Vehicle, stationPosition: number) => string;
};

export function StationList({ stations, vehicles, calculateETA }: StationListProps) {
  /** First time we saw each vehicle idle near each station (key: `${vehicleId}-${stationId}`). */
  const idleAtStationSinceRef = useRef<Map<string, number>>(new Map());

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-6 h-6 text-blue-600" />
        <h2 className="text-xl font-bold text-gray-900">Vehicles by Station</h2>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Vehicles en route to or briefly at each stop (passenger boarding only; route is continuous).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stations.map((station) => (
          <div key={station.id} className="border-2 border-gray-200 rounded-lg p-5 hover:border-blue-300 transition-colors min-h-[320px] flex flex-col">
            <div className="flex items-start gap-3 mb-4 flex-shrink-0 min-h-[4rem]">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <MapPin className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900">Station {station.stationNumber}</h3>
                <p className="text-sm text-gray-600 truncate" title={station.name}>{station.name}</p>
                <p className="text-xs text-gray-500">{station.location}</p>
              </div>
            </div>

            <div className="space-y-3">
              {vehicles
                .filter(v => v.status === 'online')
                .filter((vehicle) => linearDistanceKmToStation(vehicle, station) !== null)
                .map((vehicle) => {
                  const legKm = linearDistanceKmToStation(vehicle, station)!;
                  const eta = calculateETA(vehicle, station.position);
                  const nearStation = legKm <= 0.01;
                  const idle = vehicle.speed < IDLE_SPEED_THRESHOLD;
                  const key = `${vehicle.id}-${station.id}`;
                  const now = Date.now();
                  if (nearStation && idle) {
                    if (!idleAtStationSinceRef.current.has(key)) {
                      idleAtStationSinceRef.current.set(key, now);
                    }
                  } else {
                    idleAtStationSinceRef.current.delete(key);
                  }
                  const firstIdleAt = idleAtStationSinceRef.current.get(key) ?? now;
                  const idleDurationMs = now - firstIdleAt;
                  const isAtStation = nearStation && idle && idleDurationMs >= IDLE_AT_STATION_MS;
                  const isArrived = isAtStation;

                  const distanceKm = legKm;
                  
                  return (
                    <div
                      key={vehicle.id}
                      className={`p-3 rounded-lg border ${
                        isArrived 
                          ? 'bg-blue-50 border-blue-300' 
                          : false
                          ? 'bg-yellow-50 border-yellow-300'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Bus className="w-4 h-4 text-gray-600" />
                          <span className="font-semibold text-sm">{vehicle.plateNumber}</span>
                        </div>
                        <div className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          isArrived
                            ? 'bg-blue-500 text-white'
                            : false
                            ? 'bg-yellow-500 text-white'
                            : 'bg-blue-500 text-white'
                        }`}>
                          {isArrived ? 'AT STATION' : 'EN ROUTE'}
                        </div>
                      </div>
                      
                      {/* ETA Display */}
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <Clock className="w-5 h-5 text-gray-500" />
                        <div>
                          <span className="text-gray-700">{isArrived ? 'Status: ' : 'ETA: '}</span>
                          <strong className={`text-xl ${isArrived ? 'text-blue-600' : 'text-blue-600'}`}>
                            {isArrived ? 'At station (boarding)' : eta}
                          </strong>
                        </div>
                      </div>

                      {!isArrived && legKm > 0.01 && (
                        <div className="mt-2 text-xs text-gray-600">
                          Distance: ~{distanceKm < 1 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km away
                        </div>
                      )}

                    </div>
                  );
                })}
            </div>

            {vehicles.filter(v => v.status === 'online').length === 0 && (
              <div className="text-center py-4 text-gray-500 text-sm">
                No vehicles en route
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}