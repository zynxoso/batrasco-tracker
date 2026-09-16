import { useEffect, useMemo } from 'react';
import type { Vehicle } from '../../App';
import type { Station } from '../../data/route-stations';
import { cn } from '../ui/utils';

type TrackerGoogleMapProps = {
  vehicles: Vehicle[];
  stations: Station[];
  className?: string;
  focusedVehicleId?: string | null;
  historyPoints?: Array<{ latitude?: number; longitude?: number; reported_at?: string }>;
  onVehicleSelect?: (vehicleId: string) => void;
  onStatusChange?: (status: 'loading' | 'ready' | 'error', message?: string) => void;
};

export function TrackerGoogleMap({
  vehicles,
  stations,
  className,
  focusedVehicleId,
  historyPoints,
  onStatusChange,
}: TrackerGoogleMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  const vehiclePoints = useMemo(
    () =>
      vehicles.filter(
        (vehicle): vehicle is Vehicle & { latitude: number; longitude: number } =>
          vehicle.latitude != null &&
          vehicle.longitude != null &&
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude)
      ),
    [vehicles]
  );

  const historyRoute = useMemo(
    () =>
      (historyPoints ?? []).flatMap((point) =>
        point.latitude != null &&
        point.longitude != null &&
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude)
          ? [{ lat: point.latitude, lng: point.longitude }]
          : []
      ),
    [historyPoints]
  );

  const focusedVehicle = useMemo(
    () => vehiclePoints.find((vehicle) => vehicle.id === focusedVehicleId) ?? null,
    [focusedVehicleId, vehiclePoints]
  );

  const targetPoint = useMemo(() => {
    if (focusedVehicle) {
      return {
        latitude: focusedVehicle.latitude,
        longitude: focusedVehicle.longitude,
        zoom: 15,
      };
    }

    if (historyRoute.length > 0) {
      const lastPoint = historyRoute[historyRoute.length - 1];
      return {
        latitude: lastPoint.lat,
        longitude: lastPoint.lng,
        zoom: 13,
      };
    }

    if (vehiclePoints.length > 0) {
      return {
        latitude: vehiclePoints[0].latitude,
        longitude: vehiclePoints[0].longitude,
        zoom: 12,
      };
    }

    if (stations.length > 0) {
      return {
        latitude: stations[0].latitude,
        longitude: stations[0].longitude,
        zoom: 11,
      };
    }

    return {
      latitude: 13.8786,
      longitude: 121.1043,
      zoom: 11,
    };
  }, [focusedVehicle, historyRoute, stations, vehiclePoints]);

  const mapSrc = useMemo(() => {
    if (!apiKey) return null;
    const query = `${targetPoint.latitude},${targetPoint.longitude}`;
    return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&zoom=${targetPoint.zoom}&maptype=roadmap`;
  }, [apiKey, targetPoint]);

  useEffect(() => {
    if (!apiKey) {
      onStatusChange?.('error', 'Google Maps API key missing. Set VITE_GOOGLE_MAPS_API_KEY to enable Google Maps.');
      return;
    }
    onStatusChange?.('loading', 'Loading embedded Google Maps frame.');
  }, [apiKey, mapSrc, onStatusChange]);

  if (!mapSrc) {
    return (
      <div
        className={cn(
          'relative h-[min(68vh,520px)] w-full min-h-[300px] overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100',
          className
        )}
      >
        <div className="absolute inset-4 rounded-2xl border border-red-200 bg-white/95 p-4 text-sm text-slate-700 shadow-lg">
          Google Maps API key missing.
        </div>
      </div>
    );
  }

  return (
    <div
      id="trackerGoogleMapFrame"
      className={cn(
        'relative h-[min(68vh,520px)] w-full min-h-[300px] overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100',
        className
      )}
    >
      <div className="h-full w-full">
        <iframe
          title="Google Maps"
          width="100%"
          height="100%"
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          src={mapSrc}
          className="h-full w-full border-0"
          onLoad={() => {
            onStatusChange?.('ready', 'Embedded Google Maps loaded successfully.');
          }}
          onError={() => {
            onStatusChange?.('error', 'Embedded Google Maps failed to load.');
          }}
        />
      </div>
    </div>
  );
}
