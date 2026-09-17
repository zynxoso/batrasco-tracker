/**
 * BATRASCO stops. `position` (0–100% along the driving corridor) is **derived**
 * from each stop's lat/lng by projecting it onto `BATRASCO_ROUTE_PATH` — so the
 * dashboard's route strip, ETA math, and "near station" checks stay in sync
 * automatically whenever the corridor is regenerated. The first entry (Palico)
 * is pinned to 0% so the western terminus detection is exact even with float
 * drift. The last stop (J.P. Laurel Hwy) is **not** pinned to 100% because the
 * corridor extends past it to SM Lipa — it sits at its natural ~80%.
 */
import { projectLatLngOntoRoute, type GeofenceBoundingBox } from '../lib/route/route-geometry';

export type Station = {
  id: string;
  /** Display title e.g. "Station 1" */
  stationNumber: number;
  name: string;
  location: string;
  /** 0–100% along the corridor. Derived — do not edit by hand. */
  position: number;
  /** BATRASCO stop coordinates for distance calculation */
  latitude: number;
  longitude: number;
  /**
   * Optional lat/lng bounding box around the on-the-ground terminal / parking
   * area for this stop. A vehicle whose GPS fix is inside this box is treated
   * as **arrived** at the stop even if its projected along-corridor position
   * or inferred direction would say otherwise (parked buses often sit off the
   * driving polyline in terminal yards). Rendered on the live map as a
   * semi-transparent orange rectangle.
   */
  geofence?: GeofenceBoundingBox;
};

type StationDefinition = Omit<Station, 'position'>;

/** Order: Station 1 (Mataas na Kahoy Junction), Station 2 (San Jose Church), Station 3 (Batangas City, Puregold).
 *  Batangas City is pinned to 0% (corridor start). The easternmost passenger stop
 *  (Mataas na Kahoy Junction) projects to ~80% — the corridor runs a further ~5.7 km east to SM Lipa. */
const stationDefinitions: StationDefinition[] = [
  {
    id: '1',
    stationNumber: 1,
    name: 'Mataas na Kahoy Junction',
    location: 'Lipa City',
    latitude: 13.9394312,
    longitude: 121.122812,
  },
  {
    id: '2',
    stationNumber: 2,
    name: 'San Jose Church',
    location: 'San Jose',
    latitude: 13.8785677,
    longitude: 121.1042709,
  },
  {
    id: '3',
    stationNumber: 3,
    name: 'Batangas City, Puregold',
    location: 'Batangas City',
    latitude: 13.7641749,
    longitude: 121.0562022,
    // Terminal parking yard (off Arturo Tanco Drive). Roughly
    // 180 m × 170 m around the stop pin. Tune the four numbers if the
    // on-map blue box doesn't match the parking area on the ground.
    geofence: {
      south: 13.76400,
      north: 13.76560,
      west: 121.05555,
      east: 121.05710,
    },
  },
];

export const stations: Station[] = stationDefinitions.map((def) => {
  // Pin Batangas City (corridor start) to 0%; other stops use their projected percent along the route corridor.
  const position =
    def.location === 'Batangas City'
      ? 0
      : projectLatLngOntoRoute(def.latitude, def.longitude).positionPercent;
  return { ...def, position };
});

