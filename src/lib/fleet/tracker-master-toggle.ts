/**
 * Bulk "pause all tracking" toggle implemented entirely client-side.
 *
 * When paused, a snapshot of each device's previous `ingestEnabled` value is
 * stored in `localStorage`, and every device is PATCHed to `ingest_enabled=false`
 * via the existing per-device toggle endpoint. Resuming restores each device
 * to its saved value, then clears the snapshot.
 *
 * Why not a server flag? The server flag in src/lib/server/cron-state.ts needs Vercel KV
 * (not configured in this deployment), and the per-device column is what the
 * trackers-poll handler actually checks — so driving that directly is both
 * simpler and more durable.
 */
import { setVehicleIngestEnabled } from '../../api/client';

const SNAPSHOT_KEY = 'tracker-master-toggle:snapshot:v1';

export type MasterToggleSnapshot = Record<string, boolean>;

export type MasterToggleProgress = {
  total: number;
  completed: number;
  failed: number;
};

export type MasterToggleResult = {
  ok: boolean;
  attempted: number;
  failed: string[];
};

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMasterToggleSnapshot(): MasterToggleSnapshot | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  const raw = storage.getItem(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const out: MasterToggleSnapshot = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[id] = value;
    }
    return out;
  } catch {
    return null;
  }
}

function writeMasterToggleSnapshot(snapshot: MasterToggleSnapshot): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function clearMasterToggleSnapshot(): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.removeItem(SNAPSHOT_KEY);
}

export function isMasterTogglePaused(): boolean {
  return readMasterToggleSnapshot() != null;
}

async function runPerDevicePatch(
  deviceIds: string[],
  enabledFor: (deviceId: string) => boolean,
  onProgress?: (progress: MasterToggleProgress) => void,
  concurrency = 5
): Promise<MasterToggleResult> {
  const failed: string[] = [];
  let completed = 0;
  let cursor = 0;
  const total = deviceIds.length;

  const report = () => {
    onProgress?.({ total, completed, failed: failed.length });
  };
  report();

  const runners = Array.from({ length: Math.min(concurrency, total || 1) }, async () => {
    while (cursor < total) {
      const i = cursor++;
      const deviceId = deviceIds[i];
      const wanted = enabledFor(deviceId);
      try {
        const result = await setVehicleIngestEnabled(deviceId, wanted);
        if (!result.ok) failed.push(deviceId);
      } catch {
        failed.push(deviceId);
      } finally {
        completed++;
        report();
      }
    }
  });
  await Promise.all(runners);

  return { ok: failed.length === 0, attempted: total, failed };
}

export async function pauseAllTracking(
  vehicles: Array<{ id: string; ingestEnabled?: boolean }>,
  onProgress?: (progress: MasterToggleProgress) => void
): Promise<MasterToggleResult> {
  // If a snapshot already exists, we're already in the paused state — do not
  // overwrite it with a snapshot of "all off", which would erase the real
  // pre-pause values when the user next resumes.
  const existing = readMasterToggleSnapshot();
  if (!existing) {
    const anyEnabled = vehicles.some((v) => v.ingestEnabled !== false);
    // Only persist a snapshot if there is genuinely something to restore.
    // Otherwise (server already reports every device disabled, e.g. because
    // the pause was triggered from another browser / device) we would save
    // an "all false" snapshot that makes resume a permanent no-op and traps
    // the user in the paused state.
    if (anyEnabled) {
      const snapshot: MasterToggleSnapshot = {};
      for (const v of vehicles) snapshot[v.id] = v.ingestEnabled !== false;
      writeMasterToggleSnapshot(snapshot);
    }
  }
  const ids = vehicles.map((v) => v.id);
  return runPerDevicePatch(ids, () => false, onProgress);
}

export async function resumeAllTracking(
  vehicles: Array<{ id: string; ingestEnabled?: boolean }>,
  onProgress?: (progress: MasterToggleProgress) => void
): Promise<MasterToggleResult> {
  const snapshot = readMasterToggleSnapshot();
  // Fallback cases where "resume" must unconditionally enable every device:
  //   1. No snapshot at all (pause happened on a different browser/device).
  //   2. Snapshot exists but has no `true` entries — e.g. a buggy earlier
  //      pause persisted an all-false snapshot. Without this fallback the
  //      user would be stuck OFF forever because `enabledFor` would return
  //      `false` for every device.
  const snapshotHasAnyEnabled =
    !!snapshot && Object.values(snapshot).some((v) => v !== false);
  const enabledFor = (deviceId: string): boolean => {
    if (!snapshot || !snapshotHasAnyEnabled) return true;
    const v = snapshot[deviceId];
    return v !== false;
  };
  const ids = vehicles.map((v) => v.id);
  const result = await runPerDevicePatch(ids, enabledFor, onProgress);
  if (result.ok || result.failed.length < ids.length) {
    // Clear only if something succeeded; otherwise leave the snapshot so the
    // user can retry without losing their saved state.
    clearMasterToggleSnapshot();
  }
  return result;
}
