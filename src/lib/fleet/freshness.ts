export const GPS_STALE_MS = 5 * 60 * 1000;
export function isGpsFresh(timestamp: string | undefined, now = Date.now()): boolean {
  const at = Date.parse(timestamp ?? '');
  return Number.isFinite(at) && at <= now + 60_000 && now - at < GPS_STALE_MS;
}
export function vehiclePollDelay(failures = 0): number {
  return Math.min(120_000, 15_000 * 2 ** Math.min(3, Math.max(0, failures)));
}
