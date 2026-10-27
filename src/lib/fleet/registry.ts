export const DEFAULT_ROUTE_ID = '00000000-0000-4000-8000-000000000001';
export type Field = { key: string; label: string; required?: boolean; type?: 'number' | 'select'; min?: number; max?: number; options?: string[]; reference?: 'drivers' | 'routes' };
export const registry = {
  vehicles: { table: 'fleet_vehicles', label: 'Vehicles', fields: [
    { key: 'plate_number', label: 'Plate number', required: true },
    { key: 'device_id', label: 'GPS device ID (optional)' },
    { key: 'driver_id', label: 'Driver', reference: 'drivers' },
    { key: 'route_id', label: 'Route', reference: 'routes' },
    { key: 'capacity', label: 'Capacity', required: true, type: 'number', min: 1, max: 100 },
    { key: 'availability', label: 'Availability', required: true, type: 'select', options: ['active', 'inactive', 'maintenance'] },
  ] as Field[] },
  drivers: { table: 'fleet_drivers', label: 'Drivers', fields: [
    { key: 'name', label: 'Full name', required: true }, { key: 'phone', label: 'Phone (optional)' },
  ] as Field[] },
  routes: { table: 'fleet_routes', label: 'Routes', fields: [
    { key: 'code', label: 'Route code', required: true }, { key: 'name', label: 'Name', required: true },
    { key: 'origin', label: 'Origin', required: true }, { key: 'destination', label: 'Destination', required: true },
  ] as Field[] },
  stations: { table: 'fleet_stations', label: 'Stations', fields: [
    { key: 'name', label: 'Station name', required: true }, { key: 'location', label: 'City / municipality', required: true },
    { key: 'route_id', label: 'Route', required: true, reference: 'routes' },
    { key: 'station_number', label: 'Station number', required: true, type: 'number', min: 1, max: 100 },
    { key: 'latitude', label: 'Latitude', required: true, type: 'number', min: -90, max: 90 },
    { key: 'longitude', label: 'Longitude', required: true, type: 'number', min: -180, max: 180 },
  ] as Field[] },
};
export type RegistryEntity = keyof typeof registry;
export function validEntity(value: unknown): value is RegistryEntity { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(registry, value); }
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateRecord(entity: RegistryEntity, input: unknown): Record<string, string | number | null> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid record');
  const row: Record<string, string | number | null> = {};
  for (const field of registry[entity].fields) {
    const raw = (input as Record<string, unknown>)[field.key];
    if (raw == null || raw === '') {
      if (field.required) throw new Error(`${field.label} is required`);
      row[field.key] = null; continue;
    }
    if (field.type === 'number') {
      if (typeof raw !== 'number' && typeof raw !== 'string') throw new Error(`Invalid ${field.label}`);
      const number = Number(raw);
      if (!Number.isFinite(number) || number < field.min! || number > field.max! ||
        (['capacity','station_number'].includes(field.key) && !Number.isInteger(number))) throw new Error(`Invalid ${field.label}`);
      row[field.key] = number;
    } else {
      if (typeof raw !== 'string') throw new Error(`Invalid ${field.label}`);
      const text = raw.trim();
      if (!text || text.length > 160 || /[\x00-\x1f]/.test(text)) throw new Error(`Invalid ${field.label}`);
      if (field.reference && !isUuid(text)) throw new Error(`Invalid ${field.label}`);
      if (field.options && !field.options.includes(text)) throw new Error(`Invalid ${field.label}`);
      row[field.key] = field.key === 'plate_number' || field.key === 'code' ? text.toUpperCase() : text;
    }
  }
  return row;
}
