import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Rectangle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Vehicle } from '../../App';
import { BATRASCO_ROUTE_PATH } from '../../data/batrasco-route-path';
import type { Station } from '../../data/route-stations';
import { deviceTrackStatusLabel, getDeviceTrackStatus } from '../../lib/route/route-corridor';
import { cn } from '../ui/utils';

type MarkerVisualState = 'tracking-off' | 'on-track' | 'off-track';

function vehicleMarkerVisualState(v: Vehicle): MarkerVisualState {
  if (v.ingestEnabled === false) return 'tracking-off';
  const status = getDeviceTrackStatus(v.latitude, v.longitude);
  return status === 'on_track' ? 'on-track' : 'off-track';
}

/** Stroke and fill for vehicle dots — blue on route line, orange off, gray no fix. */
function vehicleMarkerPathOptions(
  v: Vehicle,
  focused: boolean
): { color: string; fillColor: string; fillOpacity: number; weight: number; className: string } {
  const visualState = vehicleMarkerVisualState(v);

  if (visualState === 'tracking-off') {
    return {
      color: focused ? '#4b5563' : '#6b7280',
      fillColor: focused ? '#cbd5e1' : '#9ca3af',
      fillOpacity: focused ? 0.95 : 0.9,
      weight: focused ? 3 : 2,
      className: `tracker-map-marker tracker-map-marker--tracking-off${focused ? ' tracker-map-marker--focused' : ''}`,
    };
  }

  const baseWeight = focused ? 3 : 2;
  const baseOpacity = focused ? 0.95 : 0.92;

  if (visualState === 'on-track') {
    return {
      color: focused ? '#1d4ed8' : '#2563eb',
      fillColor: focused ? '#60a5fa' : '#3b82f6',
      fillOpacity: baseOpacity,
      weight: baseWeight,
      className: `tracker-map-marker tracker-map-marker--on-track${focused ? ' tracker-map-marker--focused' : ''}`,
    };
  }
  return {
    color: focused ? '#a23401' : '#c3431b',
    fillColor: focused ? '#f0d0c2' : '#d9845c',
    fillOpacity: baseOpacity,
    weight: baseWeight,
    className: `tracker-map-marker tracker-map-marker--off-track${focused ? ' tracker-map-marker--focused' : ''}`,
  };
}

function InvalidateMapSize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const refresh = () => {
      requestAnimationFrame(() => {
        map.invalidateSize(false);
      });
    };

    refresh();

    const resizeObserver = new ResizeObserver(() => {
      refresh();
    });

    resizeObserver.observe(container);
    window.addEventListener('load', refresh);
    window.addEventListener('resize', refresh);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('load', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, [map]);

  return null;
}

function FitBounds({ points, disabled }: { points: [number, number][]; disabled?: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (disabled) return;
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [disabled, map, points]);
  return null;
}

/**
 * Fraction of the map container width to offset the focused vehicle from the
 * horizontal center, so it sits clear of the right-hand "selected vehicle"
 * info panel (which floats over ~30 % of the right side). Positive shifts the
 * vehicle to the LEFT in the viewport by moving the map's center to the RIGHT.
 */
const FOCUS_HORIZONTAL_OFFSET_FRACTION = 0.1;

function FocusVehicle({ point, focusNonce }: { point: [number, number] | null; focusNonce?: number }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    const targetZoom = Math.max(map.getZoom(), 14);
    const containerWidth = map.getSize().x;
    if (containerWidth > 0) {
      const targetPoint = map.project(L.latLng(point[0], point[1]), targetZoom);
      const shifted = targetPoint.add(
        L.point(containerWidth * FOCUS_HORIZONTAL_OFFSET_FRACTION, 0)
      );
      const shiftedCenter = map.unproject(shifted, targetZoom);
      map.flyTo(shiftedCenter, targetZoom, { duration: 0.45 });
    } else {
      map.flyTo(point, targetZoom, { duration: 0.45 });
    }
  }, [focusNonce, map, point]);
  return null;
}

type TrackerLocationsMapProps = {
  vehicles: Vehicle[];
  stations: Station[];
  className?: string;
  focusedVehicleId?: string | null;
  focusNonce?: number;
  historyPoints?: Array<{ latitude?: number; longitude?: number; reported_at?: string }>;
  onVehicleSelect?: (vehicleId: string | null) => void;
};

/** OpenStreetMap view with vehicle GPS pins, BATRASCO route polyline (docs/routes.md), and stops. */
export function TrackerLocationsMap({
  vehicles,
  stations,
  className,
  focusedVehicleId,
  focusNonce,
  historyPoints,
  onVehicleSelect,
}: TrackerLocationsMapProps) {
  const withCoords = useMemo(
    () =>
      vehicles.filter(
        (v): v is Vehicle & { latitude: number; longitude: number } =>
          v.latitude != null &&
          v.longitude != null &&
          Number.isFinite(v.latitude) &&
          Number.isFinite(v.longitude)
      ),
    [vehicles]
  );

  const points = useMemo<[number, number][]>(
    () => withCoords.map((v) => [v.latitude, v.longitude]),
    [withCoords]
  );

  const stationPoints = useMemo<[number, number][]>(() => stations.map((s) => [s.latitude, s.longitude]), [stations]);

  const defaultCenter: [number, number] = [13.8786, 121.1043];
  const focusedPoint = useMemo<[number, number] | null>(() => {
    if (!focusedVehicleId) return null;
    const v = withCoords.find((x) => x.id === focusedVehicleId);
    return v ? [v.latitude, v.longitude] : null;
  }, [focusedVehicleId, withCoords]);
  const historyMarkers = useMemo(
    () =>
      (historyPoints ?? []).flatMap((point) =>
        point.latitude != null &&
        point.longitude != null &&
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude)
          ? [
              {
                position: [point.latitude, point.longitude] as [number, number],
                reported_at: point.reported_at,
              },
            ]
          : []
      ),
    [historyPoints]
  );
  const historyLine = useMemo<[number, number][]>(() => historyMarkers.map((point) => point.position), [historyMarkers]);
  const mapBoundsPoints = useMemo<[number, number][]>(
    () => [...BATRASCO_ROUTE_PATH, ...historyLine, ...points],
    [historyLine, points]
  );

  return (
    <div
      className={cn(
        'h-[min(68vh,520px)] w-full min-h-[300px] rounded-xl overflow-hidden border border-slate-200/90 bg-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]',
        className
      )}
    >
      <MapContainer center={defaultCenter} zoom={11} className="h-full w-full z-0" scrollWheelZoom>
        <InvalidateMapSize />
        <TileLayer
          attribution={
            import.meta.env.VITE_CARTO_API_KEY
              ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          }
          url={
            import.meta.env.VITE_CARTO_API_KEY
              ? `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${import.meta.env.VITE_CARTO_API_KEY}`
              : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          }
        />
        <Polyline
          positions={BATRASCO_ROUTE_PATH}
          pathOptions={{ color: '#253272', weight: 5, opacity: 0.92 }}
        />
        {historyLine.length >= 2 && (
          <Polyline
            positions={historyLine}
            pathOptions={{ color: '#ca5730', weight: 3, opacity: 0.9, dashArray: '8 8' }}
          />
        )}
        {stations.map((s) =>
          s.geofence ? (
            <Rectangle
              key={`geofence-${s.id}`}
              bounds={[
                [s.geofence.south, s.geofence.west],
                [s.geofence.north, s.geofence.east],
              ]}
              pathOptions={{
                color: '#c2410c',
                weight: 2,
                opacity: 0.9,
                fillColor: '#f97316',
                fillOpacity: 0.22,
              }}
              interactive={false}
            />
          ) : null
        )}
        {stations.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.latitude, s.longitude]}
            radius={7}
            pathOptions={{
              color: '#17256b',
              fillColor: '#eceef6',
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Popup>
              <span className="text-sm font-semibold">{s.location}</span>
            </Popup>
          </CircleMarker>
        ))}
        {historyMarkers.map((point, index) => (
          <CircleMarker
            key={`history-${index}-${point.position[0]}-${point.position[1]}`}
            center={point.position}
            radius={index === historyMarkers.length - 1 ? 5 : 3}
            pathOptions={{
              color: '#c3431b',
              fillColor: '#e8b39a',
              fillOpacity: index === historyMarkers.length - 1 ? 0.95 : 0.75,
              weight: 1.5,
            }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold text-slate-900">History point</div>
                <div className="text-xs text-slate-500">
                  {point.reported_at
                    ? new Date(point.reported_at).toLocaleString()
                    : 'Timestamp unavailable'}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {withCoords.map((v) => {
          const focused = focusedVehicleId === v.id;
          const trackStatus = getDeviceTrackStatus(v.latitude, v.longitude);
          return (
          <CircleMarker
            key={v.id}
            center={[v.latitude, v.longitude]}
            radius={focused ? 13 : 11}
            pathOptions={vehicleMarkerPathOptions(v, focused)}
            eventHandlers={{
              click: () => onVehicleSelect?.(focusedVehicleId === v.id ? null : v.id),
            }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-bold">Unit {v.plateNumber}</div>
                <div className="text-gray-600">{v.driver}</div>
                <div>{v.speed} km/h</div>
                {v.lastUpdated && (
                  <div className="text-xs text-gray-500 mt-1">Updated {new Date(v.lastUpdated).toLocaleString()}</div>
                )}
                <div className="text-xs mt-1">
                  Corridor:{' '}
                  <span className="font-medium text-slate-800">{deviceTrackStatusLabel(trackStatus)}</span>
                </div>
                <div className="text-xs mt-1">
                  Tracking:{' '}
                  <span className={v.ingestEnabled !== false ? 'text-green-700 font-medium' : 'text-amber-800 font-medium'}>
                    {v.ingestEnabled !== false ? 'On' : 'Off'}
                  </span>
                </div>
                {onVehicleSelect && focusedVehicleId === v.id ? (
                  <button
                    type="button"
                    className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onVehicleSelect(null);
                    }}
                  >
                    Show fleet overview
                  </button>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
          );
        })}
        <FitBounds points={mapBoundsPoints} disabled={Boolean(focusedPoint)} />
        <FocusVehicle point={focusedPoint} focusNonce={focusNonce} />
      </MapContainer>
    </div>
  );
}
