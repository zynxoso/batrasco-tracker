/**
 * SinoTrack per-user poll: log in as a single SIM/IMEI account and call Proc_GetLastPosition.
 * Pure protocol layer — no DB, no env coupling. Designed to be invoked from a Vercel API route.
 */

import crypto from 'crypto';

export type SinotrackPollPosition = {
  device_id: string;
  lat: number;
  lng: number;
  reported_at: number;
  direction?: number;
};

export type SinotrackPollOptions = {
  /** Defaults to https://246.sinotrack.com */
  serverUrl?: string;
  /** Defaults to https://pro.sinotrack.com */
  pageOrigin?: string;
  /** 0 = Proc_Login (default), 1 = Proc_LoginAnother, 2 = Proc_LoginIMEI */
  loginType?: 0 | 1 | 2;
  /** Per-call timeout (ms). Default 8000. */
  timeoutMs?: number;
};

const ROW = '\x11';
const TABLE = '\x1b';
const DEFAULT_SERVER = 'https://246.sinotrack.com';
const DEFAULT_PAGE_ORIGIN = 'https://pro.sinotrack.com';
const DEFAULT_TIMEOUT_MS = 8000;

function md5HexUtf8(s: string): string {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function generateMgtsRandomString(): string {
  return `MGTS_${Math.floor(1e14 * Math.random())}`;
}

function stripMgtsPrefix(full: string): string {
  return String(full).replace(/^MGTS_/, '');
}

function urlOrigin(input: string): string {
  const trimmed = String(input || '').trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const m = withProto.match(/^(https?):\/\/([^/?#]+)/i);
  if (!m) return DEFAULT_SERVER;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}`;
}

function serverUrlToStrAppID(serverUrl: string): string {
  let normalized = String(serverUrl || '').toLowerCase().replace(/^https?:\/\//, '');
  while (normalized.length % 3 !== 0) normalized += '/';
  return Buffer.from(normalized, 'utf8').toString('base64');
}

function buildDataSegment(parts: string[]): string {
  if (!Array.isArray(parts) || parts.length === 0) return '';
  return parts.map((p) => `N'${String(p).replace(/'/g, "''")}'`).join(',');
}

function buildStrToken(cmd: string, dataSegment: string, field = ''): string {
  let result = `${cmd}${ROW}${dataSegment}${ROW}${field}${ROW}` + TABLE;
  while (result.length % 3 !== 0) result += generateMgtsRandomString().charAt(7);
  return Buffer.from(result, 'latin1').toString('base64');
}

function buildSignedFormFields(serverUrl: string, strUser: string, cmd: string, dataParts: string[]) {
  const strAppID = serverUrlToStrAppID(serverUrl);
  const nTimeStamp = String(Date.now());
  const strRandom = stripMgtsPrefix(generateMgtsRandomString());
  const dataSegment = buildDataSegment(dataParts);
  const strToken = buildStrToken(cmd, dataSegment, '');
  const strSign = md5HexUtf8(nTimeStamp + strRandom + strUser + strAppID + strToken);
  return { strAppID, strUser, nTimeStamp, strRandom, strSign, strToken };
}

function browserHeaders(pageOrigin: string): Record<string, string> {
  const origin = urlOrigin(pageOrigin || DEFAULT_PAGE_ORIGIN);
  return {
    accept: 'text/plain, */*; q=0.01',
    origin,
    referer: `${origin}/`,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'x-requested-with': 'XMLHttpRequest',
  };
}

function urlEncodeFormFields(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function loginCmdForType(loginType: number): string {
  if (loginType === 2) return 'Proc_LoginIMEI';
  if (loginType === 1) return 'Proc_LoginAnother';
  return 'Proc_Login';
}

function parseRows(data: unknown): SinotrackPollPosition[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as { m_arrField?: unknown; m_arrRecord?: unknown };
  if (!Array.isArray(d.m_arrField) || !Array.isArray(d.m_arrRecord)) return [];
  const fields = d.m_arrField as string[];
  const ix = (name: string) => fields.indexOf(name);
  const iTe = ix('strTEID');
  const iLat = ix('dbLat');
  const iLon = ix('dbLon');
  const iTime = ix('nTime');
  const iDir = ix('nDirection');
  if (iTe < 0 || iLat < 0 || iLon < 0) return [];

  return (d.m_arrRecord as unknown[])
    .map((rowRaw): SinotrackPollPosition | null => {
      if (!Array.isArray(rowRaw)) return null;
      const row = rowRaw as unknown[];
      const device_id = String(row[iTe] ?? '').trim();
      const lat = Number(row[iLat]);
      const lng = Number(row[iLon]);
      if (!device_id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const t = iTime >= 0 ? Number(row[iTime]) : Date.now();
      const reported_at = Number.isFinite(t) ? (t > 1e12 ? t : Math.round(t * 1000)) : Date.now();
      const direction = iDir >= 0 ? Number(row[iDir]) : undefined;
      return {
        device_id,
        lat,
        lng,
        reported_at,
        ...(Number.isFinite(direction as number) ? { direction: Number(direction) } : {}),
      };
    })
    .filter((v): v is SinotrackPollPosition => v !== null);
}

async function postWithTimeout(url: string, body: string, headers: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Log in as a single SinoTrack user (the device's SIM/IMEI), then ask for that user's last position.
 * Returns the positions parsed from m_arrRecord (usually one row per device on that account).
 */
export async function pollSinotrackUserPositions(
  user: string,
  password: string,
  options: SinotrackPollOptions = {}
): Promise<SinotrackPollPosition[]> {
  const serverUrl = urlOrigin(options.serverUrl ?? DEFAULT_SERVER);
  const pageOrigin = urlOrigin(options.pageOrigin ?? DEFAULT_PAGE_ORIGIN);
  const appJsonUrl = `${serverUrl}/APP/AppJson.asp`;
  const headers = browserHeaders(pageOrigin);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const loginCmd = loginCmdForType(options.loginType ?? 0);
  const loginFields = buildSignedFormFields(serverUrl, user, loginCmd, [user, password]);
  await postWithTimeout(appJsonUrl, urlEncodeFormFields(loginFields), headers, timeoutMs);

  const posFields = buildSignedFormFields(serverUrl, user, 'Proc_GetLastPosition', [user]);
  const posRes = await postWithTimeout(appJsonUrl, urlEncodeFormFields(posFields), headers, timeoutMs);
  if (!posRes.ok) throw new Error(`Proc_GetLastPosition HTTP ${posRes.status}`);
  const data = (await posRes.json()) as unknown;
  return parseRows(data);
}
