#!/usr/bin/env node
/**
 * Poll Sinotrack (or similar) web JSON and forward positions to your ingest API.
 *
 * CONTINUOUS 5s LOOP (this IS the “automatic” runner — not on Vercel):
 * - Do NOT set SINOTRACK_PORTAL_ONCE. Default interval is 5000 ms (SINOTRACK_PORTAL_INTERVAL_MS).
 * - Vercel only serves /api/ingest; it cannot keep a Node process alive. Run this script on a Mac
 *   (see scripts/run-sinotrack-poller.sh + scripts/launchd/) or a small VPS / pm2.
 *
 * Dashboard toggle (“Save tracker updates”):
 * - If SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same project as Vercel) are in .env.local, each poll
 *   skips devices with tracker_latest.ingest_enabled = false. Turn the switch ON in the app → next
 *   poll forwards again. Set SINOTRACK_POLL_RESPECT_INGEST_TOGGLE=0 to disable this filter.
 *
 * Legal / practical:
 * - Use only for accounts and devices you own. Scraping may violate the site's
 *   Terms of Service; prefer official APIs or device TCP (bridge/Flespi) when possible.
 * - Session cookies and tokens expire; refresh them from DevTools when requests fail.
 *
 * How to capture the request (Chrome / Edge):
 * 1. Log in to the Sinotrack web app as usual.
 * 2. Open DevTools → Network, filter "Fetch/XHR".
 * 3. Trigger the screen that loads device/position data (map, device list).
 * 4. Click the request whose Response is JSON with lat/lng (or a list you care about).
 * 5. Right-click → Copy → Copy as cURL (bash).
 * 6. From cURL, set env vars below (URL + Cookie and any Authorization header).
 *
 * Env (required):
 * - SINOTRACK_PORTAL_URL   – full URL to poll (GET by default), e.g. API from Network tab
 * - INGEST_URL             – e.g. https://your-app.vercel.app/api/ingest
 *
 * Env (auth — set what the copied cURL uses):
 * - SINOTRACK_PORTAL_COOKIE        – raw Cookie header value (optional if using HEADERS_JSON)
 * - SINOTRACK_PORTAL_AUTHORIZATION – Bearer token value only (optional; adds "Bearer " prefix)
 * - SINOTRACK_PORTAL_HEADERS_JSON  – optional JSON object of extra headers, e.g. {"X-Token":"..."}
 *
 * Env (optional):
 * - SINOTRACK_PORTAL_METHOD        – GET (default) or POST
 * - SINOTRACK_PORTAL_BODY          – POST body string (e.g. JSON). Content-Type application/json.
 * - SINOTRACK_PORTAL_INTERVAL_MS   – poll interval ms (default 5000; minimum 5000)
 * - SINOTRACK_PORTAL_ONCE          – if "1", run one poll and exit (good for cron)
 * - SINOTRACK_PORTAL_TRANSFORM     – path to a .js module that exports
 *                                    extractReports(json) => Sinotrack-shaped objects[]
 *                                    (device_id|imei, lat|latitude, lng|longitude, reported_at?)
 * - SINOTRACK_PORTAL_DEBUG          – if "1", print response keys / extraction summary
 *
 * SinoTrack AppJson.asp (signed POST — no manual strSign; see scripts/sinotrack-appjson.js):
 * - SINOTRACK_APPJSON=1              – use native signing + form body each poll
 * - SINOTRACK_APPJSON_SERVER         – e.g. https://246.sinotrack.com/ (default)
 * - SINOTRACK_APPJSON_USER           – same as web login (strUser / strCurUser)
 * - SINOTRACK_APPJSON_PASSWORD       – optional; if set, runs Proc_Login first and merges Set-Cookie
 * - SINOTRACK_APPJSON_SKIP_LOGIN     – if "1", skip Proc_Login (some shards return data without login)
 * - SINOTRACK_APPJSON_ORIGIN          – Origin/Referer portal, default pro.sinotrack.com when SERVER is *.sinotrack.com shard
 * - SINOTRACK_APPJSON_WARMUP         – if "0", skip GET portal homepage before login (default: warmup on)
 * - SINOTRACK_APPJSON_LOGIN_TYPE     – 0 / 1 / 2 (unset = try 0 then 2 automatically)
 * - SINOTRACK_APPJSON_STRICT_LOGIN   – if "1", abort when Proc_Login fails (default: still call GetLastPosition)
 * - SINOTRACK_APPJSON_ARGS           – optional comma list for proc args (default: same as USER)
 * - SINOTRACK_APPJSON_CMD            – default Proc_GetLastPosition
 * - SINOTRACK_APPJSON_URL            – override endpoint (default: {origin}/APP/AppJson.asp)
 * Put USER + PASSWORD in .env.local only (never commit). SINOTRACK_PORTAL_COOKIE still overrides / augments cookies.
 *
 * - SINOTRACK_POLL_RESPECT_INGEST_TOGGLE – default on: with Supabase env, skip devices toggled off in the app
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY – same as Vercel (for toggle filter only)
 *
 * Example:
 *   SINOTRACK_PORTAL_URL='https://...' \
 *   SINOTRACK_PORTAL_COOKIE='sessionid=...' \
 *   INGEST_URL='https://....vercel.app/api/ingest' \
 *   node scripts/poll-sinotrack-portal.js
 */

const fs = require('fs');
const path = require('path');

function loadEnvFiles() {
  const root = path.resolve(__dirname, '..');
  for (const file of ['.env.local', '.env']) {
    const p = path.join(root, file);
    try {
      const content = fs.readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
      }
    } catch {
      /* ignore */
    }
  }
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== '') {
      return obj[k];
    }
  }
  return undefined;
}

function toNumber(v) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function normalizeReportedAt(raw) {
  if (raw == null) return Date.now();
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') {
    // seconds vs ms heuristic
    if (raw > 1e12) return raw;
    if (raw > 1e9) return Math.round(raw * 1000);
    return raw;
  }
  return Date.now();
}

function objectHasCoords(o) {
  const lat = toNumber(pickFirst(o, ['lat', 'latitude', 'wd', 'latY', 'gpsLat', 'gpslat']));
  const lng = toNumber(pickFirst(o, ['lng', 'lon', 'longitude', 'jd', 'lngX', 'gpsLng', 'gpslng']));
  return lat != null && lng != null;
}

function deepFindCandidateArrays(value, depth, out) {
  if (depth > 10) return;
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && objectHasCoords(value[0])) {
      out.push(value);
    }
    for (const item of value) deepFindCandidateArrays(item, depth + 1, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFindCandidateArrays(v, depth + 1, out);
  }
}

function heuristicExtractRows(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) && objectHasCoords(data)) {
    return [data];
  }
  const out = [];
  deepFindCandidateArrays(data, 0, out);
  if (out.length === 0) return [];
  out.sort((a, b) => b.length - a.length);
  return out[0];
}

function statusInvertFromEnv() {
  return (
    process.env.SINOTRACK_PORTAL_STATUS_INVERT === '1' ||
    process.env.SINOTRACK_APPJSON_STATUS_INVERT === '1'
  );
}

/**
 * Map portal cell to online/offline. Some shards use 0=online/1=offline — set SINOTRACK_PORTAL_STATUS_INVERT=1.
 * strRunStatus is often “engine/movement”, not link state — we prefer bOnline/strStatus when present.
 */
function normalizeOnlineStatus(raw, invert01) {
  if (invert01 == null) invert01 = statusInvertFromEnv();
  if (raw === true) return 'online';
  if (raw === false) return 'offline';
  if (raw == null || raw === '') return undefined;
  const sOrig = String(raw).trim();
  const s = sOrig.toLowerCase();
  if (/在线|在線/.test(sOrig)) return 'online';
  if (/离线|離線/.test(sOrig)) return 'offline';
  if (s === 'online' || s === 'true' || s === 'y' || s === 'yes' || s === 'on') return 'online';
  if (s === 'offline' || s === 'false' || s === 'n' || s === 'no' || s === 'off') return 'offline';
  if (s === '1' || s === '0') {
    let on = s === '1';
    if (invert01) on = !on;
    return on ? 'online' : 'offline';
  }
  const n = Number(raw);
  if (Number.isFinite(n) && (n === 0 || n === 1)) {
    let on = n === 1;
    if (invert01) on = !on;
    return on ? 'online' : 'offline';
  }
  return undefined;
}

/** SinoTrack AppJson.asp table shape: m_arrField + m_arrRecord rows. */
function sinotrackAppJsonTableToRows(data) {
  if (!data || !Array.isArray(data.m_arrField) || !Array.isArray(data.m_arrRecord)) return null;
  const fields = data.m_arrField;
  const ix = (name) => fields.indexOf(name);
  const iTe = ix('strTEID');
  const iLat = ix('dbLat');
  const iLon = ix('dbLon');
  const iTime = ix('nTime');
  const iDir = ix('nDirection');
  if (iTe < 0 || iLat < 0 || iLon < 0) return null;

  let iStat = -1;
  for (const col of ['bOnline', 'strStatus', 'nOnline', 'nStatus', 'bLine', 'nLine', 'strRunStatus']) {
    const idx = ix(col);
    if (idx >= 0) {
      iStat = idx;
      break;
    }
  }

  const invert01 = statusInvertFromEnv();

  return data.m_arrRecord.map((row) => {
    const o = {
      device_id: String(row[iTe] ?? ''),
      lat: toNumber(row[iLat]),
      lng: toNumber(row[iLon]),
    };
    if (iTime >= 0) {
      const t = toNumber(row[iTime]);
      if (t != null) o.reported_at = t > 1e12 ? t : Math.round(t * 1000);
    }
    if (iDir >= 0) {
      const d = toNumber(row[iDir]);
      if (d != null) o.direction = d;
    }
    if (iStat >= 0) {
      const st = normalizeOnlineStatus(row[iStat], invert01);
      if (st) o.status = st;
    }
    return o;
  });
}

function rowToReport(row) {
  const lat = toNumber(pickFirst(row, ['lat', 'latitude', 'wd', 'latY', 'gpsLat', 'gpslat']));
  const lng = toNumber(pickFirst(row, ['lng', 'lon', 'longitude', 'jd', 'lngX', 'gpsLng', 'gpslng']));
  const deviceRaw = pickFirst(row, ['imei', 'deviceImei', 'device_id', 'deviceId', 'sn', 'terminal', 'terminalNo']);
  const device_id = deviceRaw != null ? String(deviceRaw).trim() : '';
  if (!device_id || lat == null || lng == null) return null;

  const reported_at = normalizeReportedAt(
    pickFirst(row, ['reported_at', 'reportTime', 'gpsTime', 'locTime', 'deviceTime', 'utc', 'time', 'timestamp', 'dt'])
  );
  const battery = toNumber(pickFirst(row, ['battery_percent', 'battery', 'bat', 'electric', 'ele']));
  const direction = toNumber(pickFirst(row, ['direction', 'course', 'bearing', 'azimuth']));
  const statusRaw = pickFirst(row, [
    'status',
    'bOnline',
    'strStatus',
    'nOnline',
    'nStatus',
    'bLine',
    'nLine',
    'strRunStatus',
  ]);
  const statusNorm = normalizeOnlineStatus(statusRaw, statusInvertFromEnv());
  const rep = {
    device_id,
    lat,
    lng,
    reported_at,
  };
  if (battery != null) rep.battery_percent = Math.max(0, Math.min(100, battery));
  if (direction != null) rep.direction = direction;
  if (statusNorm != null) rep.status = statusNorm;
  return rep;
}

function buildHeaders() {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'poll-sinotrack-portal/1.0 (personal forwarding; +https://github.com/)',
  };
  const cookie = process.env.SINOTRACK_PORTAL_COOKIE;
  if (cookie) headers.Cookie = cookie;
  const auth = process.env.SINOTRACK_PORTAL_AUTHORIZATION;
  if (auth) headers.Authorization = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
  const extra = process.env.SINOTRACK_PORTAL_HEADERS_JSON;
  if (extra) {
    try {
      const o = JSON.parse(extra);
      Object.assign(headers, o);
    } catch (e) {
      console.error('SINOTRACK_PORTAL_HEADERS_JSON must be valid JSON:', e.message);
      process.exit(1);
    }
  }
  return headers;
}

function urlEncodeFormFields(fields) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, String(v));
  return params.toString();
}

/** device_ids with ingest_enabled = false in tracker_latest (matches dashboard switches). */
async function loadIngestDisabledDeviceIds() {
  if (process.env.SINOTRACK_POLL_RESPECT_INGEST_TOGGLE === '0') return new Set();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return new Set();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key);
    const { data, error } = await supabase.from('tracker_latest').select('device_id').eq('ingest_enabled', false);
    if (error) {
      if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
        console.error('[debug] ingest_enabled query:', error.message);
      }
      return new Set();
    }
    return new Set((data ?? []).map((r) => String(r.device_id)));
  } catch (e) {
    if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
      console.error('[debug] loadIngestDisabledDeviceIds:', e);
    }
    return new Set();
  }
}

/** device_id => per-device scrape interval ms from tracker_latest (optional). */
async function loadScrapeIntervalByDeviceId() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return new Map();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key);
    const { data, error } = await supabase.from('tracker_latest').select('device_id, scrape_interval_ms');
    if (error) {
      if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
        console.error('[debug] scrape_interval_ms query:', error.message);
      }
      return new Map();
    }
    const map = new Map();
    for (const row of data ?? []) {
      const id = String(row.device_id ?? '').trim();
      const n = Number(row.scrape_interval_ms);
      if (!id || !Number.isFinite(n) || n <= 0) continue;
      map.set(id, Math.max(5000, Math.round(n)));
    }
    return map;
  } catch (e) {
    if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
      console.error('[debug] loadScrapeIntervalByDeviceId:', e);
    }
    return new Map();
  }
}

/** For long-running pollers, enforce per-device interval between forwarded points. */
const lastForwardedAtByDevice = new Map();

async function pollOnce() {
  const ingestUrl = process.env.INGEST_URL;
  if (!ingestUrl || String(ingestUrl).trim() === '') {
    console.error(
      'Missing INGEST_URL. Set it in .env.local (repo root), e.g.\n' +
        '  INGEST_URL=https://YOUR_APP.vercel.app/api/ingest\n' +
        'Or pass inline:\n' +
        '  INGEST_URL=https://YOUR_APP.vercel.app/api/ingest SINOTRACK_APPJSON=1 SINOTRACK_APPJSON_USER=... npm run poll-sinotrack-portal'
    );
    process.exit(1);
  }

  const useAppJson = process.env.SINOTRACK_APPJSON === '1';
  let url;
  let method = (process.env.SINOTRACK_PORTAL_METHOD || 'GET').toUpperCase();
  let body = process.env.SINOTRACK_PORTAL_BODY;
  const headers = buildHeaders();

  if (useAppJson) {
    const appJson = require('./sinotrack-appjson');
    const serverUrl = process.env.SINOTRACK_APPJSON_SERVER || 'https://246.sinotrack.com/';
    const strUser = process.env.SINOTRACK_APPJSON_USER;
    if (!strUser || String(strUser).trim() === '') {
      console.error('SINOTRACK_APPJSON=1 requires SINOTRACK_APPJSON_USER (web login id)');
      process.exit(1);
    }
    const appJsonUrl =
      process.env.SINOTRACK_APPJSON_URL ||
      process.env.SINOTRACK_PORTAL_URL ||
      appJson.defaultAppJsonUrl(serverUrl);

    let pageOrigin = appJson.resolvedPageOrigin(serverUrl, process.env.SINOTRACK_APPJSON_ORIGIN);
    if (!pageOrigin) {
      try {
        pageOrigin = new URL(serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`).origin;
      } catch {
        pageOrigin = 'https://pro.sinotrack.com';
      }
    }

    Object.assign(headers, appJson.browserLikeHeaders(serverUrl, { pageOrigin }));
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';

    if (process.env.SINOTRACK_APPJSON_WARMUP !== '0') {
      const home = pageOrigin.endsWith('/') ? pageOrigin : `${pageOrigin}/`;
      try {
        const warmRes = await fetch(home, {
          method: 'GET',
          headers: {
            accept: 'text/html,*/*;q=0.1',
            ...appJson.browserLikeHeaders(serverUrl, { pageOrigin }),
          },
        });
        const warmCookie = appJson.collectCookieHeader(warmRes);
        if (warmCookie) {
          headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${warmCookie}` : warmCookie;
        }
        if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
          console.error('[debug] warmup GET', home, 'cookies:', Boolean(warmCookie));
        }
      } catch (e) {
        if (process.env.SINOTRACK_PORTAL_DEBUG === '1') console.error('[debug] warmup failed', e.message);
      }
    }

    const password = process.env.SINOTRACK_APPJSON_PASSWORD;
    const skipLogin = process.env.SINOTRACK_APPJSON_SKIP_LOGIN === '1';
    const strictLogin = process.env.SINOTRACK_APPJSON_STRICT_LOGIN === '1';
    if (password != null && String(password).length > 0 && !skipLogin) {
      const explicitLt = process.env.SINOTRACK_APPJSON_LOGIN_TYPE;
      const loginTypes =
        explicitLt !== undefined && String(explicitLt).trim() !== ''
          ? [Number(explicitLt)]
          : [0, 2];

      let loginSucceeded = false;
      let lastLoginSnippet = '';

      for (const lt of loginTypes) {
        if (!Number.isFinite(lt)) continue;
        const loginCmd = appJson.loginCmdForType(lt);
        const loginFields = appJson.buildSignedFormFields({
          serverUrl,
          strUser,
          cmd: loginCmd,
          dataParts: [strUser, String(password)],
        });
        const loginRes = await fetch(appJsonUrl, {
          method: 'POST',
          headers: { ...headers },
          body: urlEncodeFormFields(loginFields),
        });
        const loginText = await loginRes.text();
        lastLoginSnippet = loginText.slice(0, 450);
        let loginData;
        try {
          loginData = JSON.parse(loginText);
        } catch {
          console.error('Login response is not JSON:', loginText.slice(0, 300));
          process.exit(1);
        }
        if (Number(loginData.m_isResultOk) === 1) {
          const fromLogin = appJson.collectCookieHeader(loginRes);
          if (fromLogin) {
            headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${fromLogin}` : fromLogin;
          }
          loginSucceeded = true;
          if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
            console.error('[debug] login ok', loginCmd, 'Set-Cookie:', Boolean(fromLogin));
          }
          break;
        }
        if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
          console.error('[debug] login failed', loginCmd, lastLoginSnippet);
        }
      }

      if (!loginSucceeded) {
        const hint =
          'Proc_Login / Proc_LoginIMEI both returned m_isResultOk!=1 (wrong password, account lock, or API mismatch).\n' +
          'Next steps: verify credentials in a browser; SINOTRACK_APPJSON_SKIP_LOGIN=1; or SINOTRACK_APPJSON_LOGIN_TYPE=1.\n';
        if (strictLogin) {
          console.error(hint, lastLoginSnippet);
          process.exit(1);
        }
        console.error(
          '[warn]',
          hint +
            'Continuing with Proc_GetLastPosition anyway (many accounts still return data). Set SINOTRACK_APPJSON_STRICT_LOGIN=1 to abort.\n',
          lastLoginSnippet
        );
      }
    }

    const cmd = process.env.SINOTRACK_APPJSON_CMD || 'Proc_GetLastPosition';
    const argsRaw = process.env.SINOTRACK_APPJSON_ARGS;
    const dataParts = argsRaw
      ? argsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [strUser];
    const fields = appJson.buildSignedFormFields({ serverUrl, strUser, cmd, dataParts });
    body = urlEncodeFormFields(fields);
    method = 'POST';
    url = appJsonUrl;
  } else {
    url = process.env.SINOTRACK_PORTAL_URL;
    if (!url) {
      console.error('Set SINOTRACK_PORTAL_URL or SINOTRACK_APPJSON=1 with SINOTRACK_APPJSON_USER');
      process.exit(1);
    }
    if (body && method === 'POST') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: method === 'POST' && body ? body : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('Portal HTTP', res.status, text.slice(0, 500));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('Response is not JSON. First 300 chars:', text.slice(0, 300));
    process.exit(1);
  }

  if (process.env.SINOTRACK_PORTAL_DEBUG === '1') {
    console.error('[debug] top-level keys:', data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : typeof data);
  }

  if (data && data.m_isResultOk === 0 && process.env.SINOTRACK_PORTAL_DEBUG === '1') {
    console.error('[debug] m_isResultOk=0', JSON.stringify(data).slice(0, 400));
  }

  let rows;
  const transformPath = process.env.SINOTRACK_PORTAL_TRANSFORM;
  if (transformPath) {
    const abs = path.isAbsolute(transformPath) ? transformPath : path.resolve(process.cwd(), transformPath);
    delete require.cache[require.resolve(abs)];
    const mod = require(abs);
    if (typeof mod.extractReports !== 'function') {
      console.error('Transform module must export extractReports(data)');
      process.exit(1);
    }
    rows = mod.extractReports(data);
  } else if (useAppJson) {
    rows = sinotrackAppJsonTableToRows(data);
    if (!rows || rows.length === 0) rows = heuristicExtractRows(data);
  } else {
    rows = heuristicExtractRows(data);
  }

  if (!Array.isArray(rows)) {
    console.error('extractReports / heuristic did not return an array');
    process.exit(1);
  }

  const reports = rows.map(rowToReport).filter(Boolean);
  if (reports.length === 0) {
    console.error(
      'No reports extracted. Save response to a file, add scripts/sinotrack-portal-transform.example.js pattern, set SINOTRACK_PORTAL_TRANSFORM.'
    );
    if (process.env.SINOTRACK_PORTAL_DEBUG === '1') console.error('[debug] sample JSON snippet:', JSON.stringify(data).slice(0, 800));
    process.exit(1);
  }

  const disabledIds = await loadIngestDisabledDeviceIds();
  const perDeviceIntervals = await loadScrapeIntervalByDeviceId();
  const now = Date.now();
  const toIngest = reports.filter((r) => {
    if (disabledIds.has(r.device_id)) return false;
    const intervalMs = perDeviceIntervals.get(r.device_id);
    if (!intervalMs) return true;
    const last = lastForwardedAtByDevice.get(r.device_id);
    if (typeof last === 'number' && now - last < intervalMs) return false;
    return true;
  });
  if (disabledIds.size > 0 && reports.length > toIngest.length) {
    console.log(
      new Date().toISOString(),
      'skip',
      reports.length - toIngest.length,
      'report(s) (ingest toggled off in app for those device_id(s))'
    );
  }
  if (toIngest.length === 0) {
    console.log(
      new Date().toISOString(),
      'skip ingest: all',
      reports.length,
      'report(s) toggled off — turn switches ON in the dashboard or set SINOTRACK_POLL_RESPECT_INGEST_TOGGLE=0'
    );
    return;
  }

  const ingestRes = await fetch(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reports: toIngest }),
  });
  const ingestText = await ingestRes.text();
  if (!ingestRes.ok) {
    console.error('Ingest HTTP', ingestRes.status, ingestText.slice(0, 500));
    process.exit(1);
  }
  for (const rep of toIngest) {
    lastForwardedAtByDevice.set(rep.device_id, now);
  }
  console.log(new Date().toISOString(), 'forwarded', toIngest.length, 'report(s)', ingestText.slice(0, 200));
}

async function main() {
  loadEnvFiles();
  const once = process.env.SINOTRACK_PORTAL_ONCE === '1';
  const intervalMs = Math.max(5000, Number(process.env.SINOTRACK_PORTAL_INTERVAL_MS) || 5000);

  await pollOnce();
  if (once) return;

  setInterval(() => {
    pollOnce().catch((e) => console.error(e));
  }, intervalMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
