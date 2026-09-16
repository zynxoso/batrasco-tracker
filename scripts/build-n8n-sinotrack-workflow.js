#!/usr/bin/env node
/**
 * Writes n8n/sinotrack-to-ingest.json for import into n8n.
 * Logic is copied from n8n/sinotrack-poll-code.js (keep both in sync when editing helpers).
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const helperPath = path.join(root, 'n8n', 'sinotrack-poll-code.js');
const outPath = path.join(root, 'n8n', 'sinotrack-to-ingest.json');

const src = fs.readFileSync(helperPath, 'utf8');
const start = src.indexOf('const crypto = require');
const end = src.indexOf('module.exports = {');
if (start < 0 || end < 0) {
  console.error('Unexpected n8n/sinotrack-poll-code.js layout');
  process.exit(1);
}
const helpers = src.slice(start, end).trim();

const runner = `
return await (async () => {
const httpRequest = this.helpers.httpRequest.bind(this.helpers);

/** n8n may return \`body\` already parsed as an object — avoid JSON.parse(String(obj)). */
function parseResponseJson(body) {
  if (body == null || body === '') throw new Error('Empty HTTP body');
  if (typeof body === 'object') return body;
  if (typeof body === 'string') return JSON.parse(body);
  return JSON.parse(String(body));
}

function jsonBodyPreview(body, maxLen) {
  const n = maxLen == null ? 300 : maxLen;
  if (body == null) return '';
  if (typeof body === 'object') {
    try {
      return JSON.stringify(body).slice(0, n);
    } catch (_) {
      return '[object]';
    }
  }
  return String(body).slice(0, n);
}

function ensureHttpOk(res, label) {
  const statusCode = Number(res && res.statusCode);
  if (statusCode >= 200 && statusCode < 300) return;
  throw new Error(
    label + ' failed: HTTP ' + (statusCode || 'unknown') + ' ' + jsonBodyPreview(res && res.body, 500),
  );
}

/**
 * Config order: (1) **Set node** fields → (2) HARDCODE below → (3) \`$vars\` / \`$env\` / process.
 * Start with the Set node labelled “1 — Paste USER + INGEST URL here”.
 */
const HARDCODE = {
  N8N_SINOTRACK_SERVER: '',
  N8N_SINOTRACK_USER: '',
  N8N_SINOTRACK_USERS_JSON: '',
  N8N_INGEST_URL: '',
  N8N_SUPABASE_URL: '',
  N8N_SUPABASE_KEY: '',
  N8N_SINOTRACK_PASSWORD: '',
  N8N_SINOTRACK_SKIP_LOGIN: '',
  N8N_SINOTRACK_PAGE_ORIGIN: '',
  N8N_SINOTRACK_STATUS_INVERT: '',
  N8N_DEVICE_INTERVALS_JSON: '',
};

function envGet(key, defaultIfMissing) {
  let v;
  try {
    if (typeof $vars !== 'undefined' && $vars[key] != null && String($vars[key]).trim() !== '') {
      v = String($vars[key]).trim();
    }
  } catch (_) {}
  try {
    if ((v == null || v === '') && typeof $env !== 'undefined' && $env[key] != null && String($env[key]).trim() !== '') {
      v = String($env[key]).trim();
    }
  } catch (_) {}
  if ((v == null || v === '') && typeof process !== 'undefined' && process.env && process.env[key] != null && String(process.env[key]).trim() !== '') {
    v = String(process.env[key]).trim();
  }
  if (v == null || v === '') return defaultIfMissing !== undefined ? defaultIfMissing : '';
  return v;
}

function inputGet(key) {
  try {
    const items = $input.all();
    if (items && items.length > 0) {
      const j = items[0].json;
      if (j && j[key] != null && String(j[key]).trim() !== '') {
        return String(j[key]).trim();
      }
    }
  } catch (_) {}
  return '';
}

function pick(key, defaultIfMissing) {
  const fromSet = inputGet(key);
  if (fromSet !== '') return fromSet;
  const h = HARDCODE[key];
  if (h != null && String(h).trim() !== '') return String(h).trim();
  return envGet(key, defaultIfMissing);
}

const serverUrl = pick('N8N_SINOTRACK_SERVER', 'https://246.sinotrack.com/');
const strUser = pick('N8N_SINOTRACK_USER');
const usersJson = pick('N8N_SINOTRACK_USERS_JSON', '');
const ingestUrl = pick('N8N_INGEST_URL');
const supabaseUrl = pick('N8N_SUPABASE_URL', '');
const supabaseKey = pick('N8N_SUPABASE_KEY', '');
const password = pick('N8N_SINOTRACK_PASSWORD', '');
const skipLogin = pick('N8N_SINOTRACK_SKIP_LOGIN', '') === '1';
const pageOriginEnv = pick('N8N_SINOTRACK_PAGE_ORIGIN', '');
const statusInvert = pick('N8N_SINOTRACK_STATUS_INVERT', '') === '1';
const users = parseSinotrackUsersJson(usersJson, strUser, {
  password,
  skipLogin,
  pageOrigin: pageOriginEnv,
});
let deviceIntervals = null;
let intervalSource = 'supabase';
let intervalWarning = '';
try {
  deviceIntervals = await loadDeviceIntervalsFromSupabase(httpRequest, {
    url: supabaseUrl,
    key: supabaseKey,
  });
} catch (error) {
  intervalWarning = error instanceof Error ? error.message : String(error);
  deviceIntervals = null;
}
if (deviceIntervals == null) {
  deviceIntervals = parseDeviceIntervalsJson(pick('N8N_DEVICE_INTERVALS_JSON', ''));
  intervalSource = 'fallback';
}
const staticStore = getWorkflowStaticStore(this);
const lastForwardedAtByDevice =
  staticStore.lastForwardedAtByDevice && typeof staticStore.lastForwardedAtByDevice === 'object'
    ? staticStore.lastForwardedAtByDevice
    : {};

if (users.length === 0 || !ingestUrl) {
  throw new Error(
    'Open the node “1 — Paste USER + INGEST URL here” and set N8N_SINOTRACK_USERS_JSON (preferred) or N8N_SINOTRACK_USER, plus N8N_INGEST_URL.',
  );
}

const appJsonUrl = defaultAppJsonUrl(serverUrl);
async function post(url, body, headers) {
  const res = await httpRequest({
    method: 'POST',
    url,
    headers: { ...headers },
    body,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  });
  ensureHttpOk(res, 'POST ' + url);
  return res;
}

async function getPortal(url, pageOrigin) {
  const h = { ...browserLikeHeaders(serverUrl, pageOrigin), accept: 'text/html,*/*;q=0.1' };
  const res = await httpRequest({
    method: 'GET',
    url,
    headers: h,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  });
  ensureHttpOk(res, 'GET ' + url);
  return res;
}

const reportsByDeviceId = new Map();
for (const account of users) {
  const pageOrigin = resolvedPageOrigin(serverUrl, account.pageOrigin || pageOriginEnv);
  let headers = {
    ...browserLikeHeaders(serverUrl, pageOrigin),
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };

  const home = pageOrigin.endsWith('/') ? pageOrigin : pageOrigin + '/';
  try {
    const warm = await getPortal(home, pageOrigin);
    headers.Cookie = mergeCookie(headers.Cookie, warm.headers['set-cookie']);
  } catch (_) {}

  if (account.password && !account.skipLogin) {
    for (const lt of [0, 2]) {
      const loginCmd = loginCmdForType(lt);
      const loginBody = urlEncodeFormFields(
        buildSignedFormFields(serverUrl, account.user, loginCmd, [account.user, String(account.password)]),
      );
      const loginRes = await post(appJsonUrl, loginBody, headers);
      headers.Cookie = mergeCookie(headers.Cookie, loginRes.headers['set-cookie']);
      try {
        const loginData = parseResponseJson(loginRes.body);
        if (Number(loginData.m_isResultOk) === 1) break;
      } catch (_) {}
    }
  }

  const posBody = urlEncodeFormFields(
    buildSignedFormFields(serverUrl, account.user, 'Proc_GetLastPosition', [account.user]),
  );
  const posRes = await post(appJsonUrl, posBody, headers);
  const data = parseResponseJson(posRes.body);
  const rows = sinotrackAppJsonTableToRows(data, { invertStatus: statusInvert });
  if (!rows || rows.length === 0) {
    throw new Error(
      'SinoTrack: no position rows for user ' +
        account.user +
        '. m_isResultOk=' +
        data.m_isResultOk +
        ' snippet=' +
        JSON.stringify(data).slice(0, 400),
    );
  }
  const accountReports = rows.map((r) => rowToReport(r, { invertStatus: statusInvert })).filter(Boolean);
  for (const report of accountReports) {
    reportsByDeviceId.set(report.device_id, report);
  }
}

const reports = Array.from(reportsByDeviceId.values());
if (reports.length === 0) throw new Error('SinoTrack: no valid reports after mapping all users');

const now = Date.now();
const filteredReports = reports.filter((report) => {
  const configuredInterval = deviceIntervals[report.device_id];
  if (!Number.isFinite(configuredInterval) || configuredInterval <= 0) return true;
  const lastForwardedAt = Number(lastForwardedAtByDevice[report.device_id] ?? 0);
  return !Number.isFinite(lastForwardedAt) || now - lastForwardedAt >= configuredInterval;
});

if (filteredReports.length === 0) {
  return [
    {
      json: {
        ok: true,
        forwarded: 0,
        skipped: reports.length,
        skippedByInterval: true,
        polledUsers: users.map((account) => account.user),
        configuredDevices: Object.keys(deviceIntervals).length,
        intervalSource,
        ...(intervalWarning ? { intervalWarning } : {}),
        at: new Date().toISOString(),
      },
    },
  ];
}

const ingestRes = await httpRequest({
  method: 'POST',
  url: ingestUrl,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reports: filteredReports }),
  returnFullResponse: true,
  ignoreHttpStatusErrors: true,
});
ensureHttpOk(ingestRes, 'POST ' + ingestUrl);

if (ingestRes.statusCode >= 200 && ingestRes.statusCode < 300) {
  for (const report of filteredReports) {
    lastForwardedAtByDevice[report.device_id] = now;
  }
  staticStore.lastForwardedAtByDevice = lastForwardedAtByDevice;
}

const ingestPreview = jsonBodyPreview(ingestRes.body, 300);
return [
  {
    json: {
      ok: ingestRes.statusCode >= 200 && ingestRes.statusCode < 300,
      forwarded: filteredReports.length,
      skipped: reports.length - filteredReports.length,
      polledUsers: users.map((account) => account.user),
      ingestStatus: ingestRes.statusCode,
      ingestPreview,
      intervalSource,
      ...(intervalWarning ? { intervalWarning } : {}),
      at: new Date().toISOString(),
    },
  },
];
})();
`.trim();

const jsCode = `${helpers}\n\n${runner}`;

const workflow = {
  name: 'SinoTrack → C001 ingest',
  nodes: [
    {
      parameters: {
        content: '## Easiest setup\n1. **Set** node: **N8N_SINOTRACK_USERS_JSON**, **N8N_INGEST_URL**, **N8N_SUPABASE_URL**, and **N8N_SUPABASE_KEY**.\n2. The workflow reads each device interval from `tracker_latest.scrape_interval_ms`.\n3. If map shows **Online/Offline backwards**, set **N8N_SINOTRACK_STATUS_INVERT** = `1`.\n4. Optional: shared server/password, or per-user password/skipLogin/pageOrigin inside the JSON.\n\n**ingest** = `/api/ingest`. **Supabase** is the interval source of truth. Some plans block 5s schedules.',
        height: 380,
        width: 440,
      },
      id: 'note-sinotrack',
      name: 'Read me',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-640, -180],
    },
    {
      parameters: {
        rule: {
          interval: [{ field: 'seconds', secondsInterval: 5 }],
        },
      },
      id: 'trigger-schedule',
      name: 'Every 5 seconds',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-560, 80],
    },
    {
      parameters: {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
          assignments: [
            {
              id: 'assign-user',
              name: 'N8N_SINOTRACK_USER',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-users-json',
              name: 'N8N_SINOTRACK_USERS_JSON',
              value:
                '[\n  { "user": "7026270707" },\n  { "user": "7026304452" }\n]',
              type: 'string',
            },
            {
              id: 'assign-ingest',
              name: 'N8N_INGEST_URL',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-supabase-url',
              name: 'N8N_SUPABASE_URL',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-supabase-key',
              name: 'N8N_SUPABASE_KEY',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-server',
              name: 'N8N_SINOTRACK_SERVER',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-pass',
              name: 'N8N_SINOTRACK_PASSWORD',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-skip',
              name: 'N8N_SINOTRACK_SKIP_LOGIN',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-origin',
              name: 'N8N_SINOTRACK_PAGE_ORIGIN',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-stat-inv',
              name: 'N8N_SINOTRACK_STATUS_INVERT',
              value: '',
              type: 'string',
            },
            {
              id: 'assign-device-intervals',
              name: 'N8N_DEVICE_INTERVALS_JSON',
              value: '',
              type: 'string',
            },
          ],
        },
        options: {},
      },
      id: 'set-config',
      name: '1 — Paste USER + INGEST URL here',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-320, 80],
    },
    {
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode,
      },
      id: 'code-poll',
      name: 'Poll SinoTrack → POST ingest',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-80, 80],
    },
  ],
  connections: {
    'Every 5 seconds': {
      main: [[{ node: '1 — Paste USER + INGEST URL here', type: 'main', index: 0 }]],
    },
    '1 — Paste USER + INGEST URL here': {
      main: [[{ node: 'Poll SinoTrack → POST ingest', type: 'main', index: 0 }]],
    },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  meta: { templateCredsSetupCompleted: true },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log('Wrote', outPath);
