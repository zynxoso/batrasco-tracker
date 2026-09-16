export type RealFleetDevice = {
  deviceId: string;
  simNumber: string;
};

export const REAL_FLEET_ROSTER: readonly RealFleetDevice[] = [
  { deviceId: '7026270707', simNumber: '09455407679' },
  { deviceId: '7026304452', simNumber: '09569830963' },
  { deviceId: '7026302965', simNumber: '09569830965' },
  { deviceId: '7026302897', simNumber: '09569830969' },
  { deviceId: '7026304614', simNumber: '09569830971' },
  { deviceId: '7026304309', simNumber: '09569830973' },
  { deviceId: '7026304581', simNumber: '09569830977' },
  { deviceId: '7026304594', simNumber: '09569830979' },
  { deviceId: '7026304589', simNumber: '09569830980' },
  { deviceId: '7026304542', simNumber: '09569830986' },
] as const;

const REAL_FLEET_ORDER = new Map(REAL_FLEET_ROSTER.map((device, index) => [device.deviceId, index]));

export function getRealFleetDevice(deviceId: string): RealFleetDevice | undefined {
  return REAL_FLEET_ROSTER.find((device) => device.deviceId === deviceId);
}

export function isKnownRealFleetDevice(deviceId: string): boolean {
  return REAL_FLEET_ORDER.has(deviceId);
}

export function sortByRealFleetRoster<T extends { id: string }>(vehicles: readonly T[]): T[] {
  return [...vehicles].sort((a, b) => {
    const aOrder = REAL_FLEET_ORDER.get(a.id);
    const bOrder = REAL_FLEET_ORDER.get(b.id);
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return a.id.localeCompare(b.id);
  });
}
