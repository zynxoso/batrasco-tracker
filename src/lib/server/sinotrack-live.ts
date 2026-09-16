import crypto from 'crypto';

export type SinotrackLiveReport = {
  device_id: string;
  lat: number;
  lng: number;
  reported_at: number | string;
  direction?: number;
  status?: 'online' | 'offline';
};

const ROW = '\x11';
const TABLE = '\x1b';

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
  const match = withProto.match(/^(https?):\/\/([^/?#]+)/i);
  if (!match) return 'https://pro.sinotrack.com';
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}`;
}

function urlHostname(input: string): string {
  const trimmed = String(input || '').trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const match = withProto.match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : '';
}

function serverUrlToStrAppID(serverUrl: string): string {
  let normalized = String(serverUrl || '').toLowerCase().replace(/^https?:\/\//, '');
  while (normalized.length % 3 !== 0) normalized += '/';
  return Buffer.from(normalized, 'utf8').toString('base64');
}

function buildDataSegment(dataParts: string[]): string {
  if (!Array.isArray(dataParts) || dataParts.length === 0) return '';
  return dataParts.map((p) => `N'${String(p).replace(/'/g, "''")}'`).join(',');
}

function buildStrToken(cmd: string, dataSegment: string, field = ''): string {
  let result = `${cmd}${ROW}${dataSegment}${ROW}${field}${ROW}`;
  result += TABLE;
  while (result.length % 3 !== 0) {
    result += generateMgtsRandomString().charAt(7);
  }
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

function resolvedPageOrigin(serverUrl: string, explicitOrigin?: string): string {
  if (explicitOrigin && explicitOrigin.trim()) {
    const origin = explicitOrigin.trim();
    return origin.startsWith('http') ? origin : `https://${origin}`;
  }
  const host = urlHostname(serverUrl);
  if (/^\d+\.sinotrack\.com$/i.test(host)) return 'https://pro.sinotrack.com';
  return urlOrigin(serverUrl);
}

function browserLikeHeaders(serverUrl: string, pageOrigin: string): Record<string, string> {
  const origin = urlOrigin(pageOrigin || resolvedPageOrigin(serverUrl));
  return {
    accept: 'text/plain, */*; q=0.01',
    origin,
    referer: `${origin}/`,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
}

function urlEncodeFormFields(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function loginCmdForType(loginType?: string): string {
  const t = Number(loginType);
  if (t === 2) return 'Proc_LoginIMEI';
  if (t === 1) return 'Proc_LoginAnother';
  return 'Proc_Login';
}

function parseRows(data: unknown): SinotrackLiveReport[] {
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
    .map((rowRaw) => {
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
        ...(Number.isFinite(direction) ? { direction } : {}),
      } satisfies SinotrackLiveReport;
    })
    .filter((v): v is SinotrackLiveReport => v !== null);
}

export async function fetchSinotrackLiveReportsFromEnv(): Promise<SinotrackLiveReport[]> {
  const enabled = process.env.SINOTRACK_LIVE_SCRAPE === '1';
  const strUser = process.env.SINOTRACK_APPJSON_USER;
  if (!enabled || !strUser) return [];

  const serverUrl = process.env.SINOTRACK_APPJSON_SERVER || 'https://246.sinotrack.com/';
  const appJsonUrl = `${urlOrigin(serverUrl)}/APP/AppJson.asp`;
  const pageOrigin = resolvedPageOrigin(serverUrl, process.env.SINOTRACK_APPJSON_ORIGIN);
  const baseHeaders = browserLikeHeaders(serverUrl, pageOrigin);

  const password = process.env.SINOTRACK_APPJSON_PASSWORD;
  if (password) {
    const loginCmd = loginCmdForType(process.env.SINOTRACK_APPJSON_LOGIN_TYPE);
    const loginFields = buildSignedFormFields(serverUrl, strUser, loginCmd, [strUser, password]);
    const loginRes = await fetch(appJsonUrl, {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: urlEncodeFormFields(loginFields),
    });
    // Some shards fail login but still return data for Proc_GetLastPosition; don't hard-fail.
    if (!loginRes.ok && process.env.SINOTRACK_APPJSON_STRICT_LOGIN === '1') return [];
  }

  const cmd = process.env.SINOTRACK_APPJSON_CMD || 'Proc_GetLastPosition';
  const argsRaw = process.env.SINOTRACK_APPJSON_ARGS;
  const args = argsRaw ? argsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [strUser];
  const fields = buildSignedFormFields(serverUrl, strUser, cmd, args);
  const res = await fetch(appJsonUrl, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: urlEncodeFormFields(fields),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  return parseRows(data);
}
