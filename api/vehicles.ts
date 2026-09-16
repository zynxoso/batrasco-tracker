import { getLastFleetDataAt } from '../src/lib/server/fleet-data-clock';
import { getLatestVehiclesFromDbWithMeta } from '../src/lib/server/tracker-db';
import { normalizeSinotrackReport } from '../src/lib/server/sinotrack-types';
import { fetchSinotrackLiveReportsFromEnv } from '../src/lib/server/sinotrack-live';
import { persistTrackerReport } from '../src/lib/server/tracker-db';

/** Unix ms for X-Fleet-Data-At header (digits only, UTC clock). Uses `lastUpdated` (= DB `updated_at` when present). */
function maxReportedAtMsFromVehicles(vehicles: { lastUpdated?: string }[]): number {
  let m = 0;
  for (const v of vehicles) {
    if (!v.lastUpdated) continue;
    const t = new Date(v.lastUpdated).getTime();
    if (Number.isFinite(t)) m = Math.max(m, t);
  }
  return m;
}

async function fleetDataAtMsForResponse(vehicles: { lastUpdated?: string }[]): Promise<number> {
  const kvMs = await getLastFleetDataAt();
  const dbMax = maxReportedAtMsFromVehicles(vehicles);
  const merged = Math.max(kvMs ?? 0, dbMax);
  return merged > 0 ? merged : Date.now();
}

function simpleHash(obj: unknown): string {
  const str = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function commonHeaders(
  etag: string,
  source: 'database' | 'fallback',
  error?: string,
  fleetDataAtMs?: number
): HeadersInit {
  const h: Record<string, string> = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag, X-Vehicles-Source, X-Vehicles-Error, X-Fleet-Data-At',
    ETag: etag,
    'X-Vehicles-Source': source,
  };
  if (error) h['X-Vehicles-Error'] = error;
  if (fleetDataAtMs != null && Number.isFinite(fleetDataAtMs)) {
    h['X-Fleet-Data-At'] = String(Math.round(fleetDataAtMs));
  }
  return h;
}

export async function GET(request: Request) {
  try {
    // Optional live mode: scrape SinoTrack on each request, then read the latest DB snapshot.
    // Enable by setting SINOTRACK_LIVE_SCRAPE=1 and SINOTRACK_APPJSON_USER(+password) on Vercel.
    const liveReports = await fetchSinotrackLiveReportsFromEnv();
    if (liveReports.length > 0) {
      for (const report of liveReports) {
        const normalized = normalizeSinotrackReport(report);
        if (!normalized) continue;
        await persistTrackerReport(normalized);
      }
    }
    const { vehicles, source, error } = await getLatestVehiclesFromDbWithMeta();
    const etag = `"${simpleHash(vehicles)}"`;
    const fleetDataAtMs = await fleetDataAtMsForResponse(vehicles);
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: { ...commonHeaders(etag, source, error, fleetDataAtMs), Pragma: 'no-cache' },
      });
    }
    return new Response(JSON.stringify(vehicles), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...commonHeaders(etag, source, error, fleetDataAtMs),
        'Pragma': 'no-cache',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const emptyEtag = '"0"';
    const fleetDataAtMs = await fleetDataAtMsForResponse([]);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...commonHeaders(emptyEtag, 'fallback', message, fleetDataAtMs),
        'Pragma': 'no-cache',
      },
    });
  }
}
