#!/usr/bin/env node
/**
 * Writes the two SinoTrack n8n workflows.
 *
 * 1. `n8n/sinotrack-interval-update.json` — webhook from the website that updates
 *    `tracker_latest.scrape_interval_ms` for one device in Supabase.
 *
 * 2. `n8n/sinotrack-poll-trigger.json` — tiny Schedule Trigger (every 5s) that
 *    POSTs to Vercel `/api/trackers-poll`. All SinoTrack login + due-time
 *    decisions live in Vercel (`_api/trackers-poll.ts`); n8n is just a cron.
 *
 * Also writes plain `.code.js` / `.paste.txt` versions of the interval Code node,
 * and `*.workflow.clipboard.txt` files (n8n canvas paste format).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const intervalRunner = `
return await (async () => {
const httpRequest = this.helpers.httpRequest.bind(this.helpers);

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

const HARDCODE = {
  N8N_SUPABASE_URL: '',
  N8N_SUPABASE_KEY: '',
  N8N_INTERVAL_UPDATE_TOKEN: '',
};

function envGet(key, defaultIfMissing) {
  let v;
  try { if (typeof $vars !== 'undefined' && $vars[key] != null && String($vars[key]).trim() !== '') v = String($vars[key]).trim(); } catch (_) {}
  try { if ((v == null || v === '') && typeof $env !== 'undefined' && $env[key] != null && String($env[key]).trim() !== '') v = String($env[key]).trim(); } catch (_) {}
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
      if (j && j[key] != null && String(j[key]).trim() !== '') return String(j[key]).trim();
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

function getRequestPayload() {
  const items = $input.all();
  const j = items && items[0] ? items[0].json || {} : {};
  return j.body && typeof j.body === 'object' ? j.body : j;
}

function getRequestHeaders() {
  const items = $input.all();
  const j = items && items[0] ? items[0].json || {} : {};
  return j.headers && typeof j.headers === 'object' ? j.headers : {};
}

const allowedIntervals = new Set([5000, 10000, 15000, 20000, 60000]);
const supabaseUrl = pick('N8N_SUPABASE_URL');
const supabaseKey = pick('N8N_SUPABASE_KEY');
const token = pick('N8N_INTERVAL_UPDATE_TOKEN', '');
const body = getRequestPayload();
const headers = getRequestHeaders();

const tokenHeader = String(
  headers['x-interval-update-token'] ??
    headers['X-Interval-Update-Token'] ??
    headers['x_interval_update_token'] ??
    ''
).trim();
if (token && tokenHeader !== token) {
  throw new Error('Forbidden: invalid x-interval-update-token');
}

const deviceId = String(body.device_id ?? body.deviceId ?? '').trim();
const intervalMs = Math.round(Number(body.scrape_interval_ms));
if (!deviceId || !Number.isFinite(intervalMs)) {
  throw new Error('Need device_id and scrape_interval_ms');
}
if (!allowedIntervals.has(intervalMs)) {
  throw new Error('scrape_interval_ms must be one of 5000, 10000, 15000, 20000, 60000');
}
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Set N8N_SUPABASE_URL and N8N_SUPABASE_KEY in the config node');
}

const base = supabaseUrl.replace(/\\/+$/, '');
const reqUrl = base + '/rest/v1/tracker_latest?device_id=eq.' + encodeURIComponent(deviceId);
const res = await httpRequest({
  method: 'PATCH',
  url: reqUrl,
  headers: {
    apikey: supabaseKey,
    Authorization: 'Bearer ' + supabaseKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    scrape_interval_ms: intervalMs,
    updated_at: new Date().toISOString(),
  }),
  returnFullResponse: true,
  ignoreHttpStatusErrors: true,
});
ensureHttpOk(res, 'PATCH ' + reqUrl);

let rows = [];
try { rows = typeof res.body === 'string' ? JSON.parse(res.body) : res.body; } catch (_) {}
if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error('No tracker_latest row for this device_id yet; ingest once first.');
}

return [{
  json: {
    ok: true,
    device_id: deviceId,
    scrape_interval_ms: intervalMs,
    rows_updated: rows.length,
    at: new Date().toISOString(),
  },
}];
})();
`.trim();

const intervalConfigAssignments = [
  { id: 'interval-supabase-url', name: 'N8N_SUPABASE_URL', value: 'https://wtbupifuhnsgevafhvie.supabase.co', type: 'string' },
  { id: 'interval-supabase-key', name: 'N8N_SUPABASE_KEY', value: '', type: 'string' },
  { id: 'interval-token', name: 'N8N_INTERVAL_UPDATE_TOKEN', value: '', type: 'string' },
];

const intervalWorkflow = {
  name: 'SinoTrack Interval Update (Webhook -> Supabase)',
  nodes: [
    {
      parameters: {
        content:
          '## Workflow 1: interval updates only\\n1. Triggered by website edit via webhook (no timer).\\n2. Valid intervals: `5000, 10000, 15000, 20000, 60000`.\\n3. Writes `tracker_latest.scrape_interval_ms` for the selected device.\\n4. Workflow 2 (poll trigger) reads these intervals via Vercel.',
        height: 320,
        width: 500,
      },
      id: 'note-interval-only',
      name: 'Read me',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-980, -280],
    },
    {
      parameters: {
        httpMethod: 'POST',
        path: 'sinotrack-interval-update',
        responseMode: 'lastNode',
      },
      id: 'trigger-webhook',
      name: 'Interval update webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-980, -20],
      webhookId: 'sinotrack-interval-update',
    },
    {
      parameters: {
        mode: 'manual',
        duplicateItem: false,
        assignments: { assignments: intervalConfigAssignments },
        options: {},
      },
      id: 'set-interval-config',
      name: 'Interval config',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-720, -20],
    },
    {
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: intervalRunner,
      },
      id: 'code-interval-update',
      name: 'Update interval in Supabase',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-460, -20],
    },
  ],
  connections: {
    'Interval update webhook': {
      main: [[{ node: 'Interval config', type: 'main', index: 0 }]],
    },
    'Interval config': {
      main: [[{ node: 'Update interval in Supabase', type: 'main', index: 0 }]],
    },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  meta: { templateCredsSetupCompleted: true },
};

const VERCEL_POLL_URL = 'https://batrascotracker-pbs-projects-c51d662a.vercel.app/api/trackers-poll';

const pollTriggerWorkflow = {
  name: 'SinoTrack Poll Trigger (every 3s -> Vercel /api/trackers-poll)',
  nodes: [
    {
      parameters: {
        content:
          '## Workflow 2: poll trigger\\n1. Schedule Trigger fires every 3 seconds.\\n2. POSTs to Vercel `/api/trackers-poll`.\\n3. With KV configured, Vercel runs one fleet-wide parallel scrape on that cadence (all devices); otherwise per-device due windows apply.\\n4. Optional auth: set `TRACKER_POLL_SECRET` in Vercel and the matching value in `N8N_TRACKER_POLL_SECRET` here; the request adds an `x-tracker-poll-secret` header.',
        height: 360,
        width: 540,
      },
      id: 'note-poll-trigger',
      name: 'Read me',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-980, -300],
    },
    {
      parameters: {
        rule: { interval: [{ field: 'seconds', secondsInterval: 3 }] },
      },
      id: 'trigger-3s',
      name: 'Every 3 seconds',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [-980, 20],
    },
    {
      parameters: {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
          assignments: [
            { id: 'poll-trigger-url', name: 'N8N_TRACKER_POLL_URL', value: VERCEL_POLL_URL, type: 'string' },
            { id: 'poll-trigger-secret', name: 'N8N_TRACKER_POLL_SECRET', value: '', type: 'string' },
          ],
        },
        options: {},
      },
      id: 'set-poll-trigger-config',
      name: 'Poll trigger config',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-700, 20],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{$json.N8N_TRACKER_POLL_URL}}',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'content-type', value: 'application/json' },
            { name: 'x-tracker-poll-secret', value: '={{$json.N8N_TRACKER_POLL_SECRET}}' },
          ],
        },
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={ }',
        options: {
          timeout: 30000,
          response: { response: { fullResponse: false } },
        },
      },
      id: 'http-poll-trigger',
      name: 'POST /api/trackers-poll',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [-400, 20],
    },
  ],
  connections: {
    'Every 3 seconds': {
      main: [[{ node: 'Poll trigger config', type: 'main', index: 0 }]],
    },
    'Poll trigger config': {
      main: [[{ node: 'POST /api/trackers-poll', type: 'main', index: 0 }]],
    },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  meta: { templateCredsSetupCompleted: true },
};

const intervalOutPath = path.join(root, 'n8n', 'sinotrack-interval-update.json');
const pollOutPath = path.join(root, 'n8n', 'sinotrack-poll-trigger.json');
const intervalCodeOutPath = path.join(root, 'n8n', 'code', 'sinotrack-interval-update.code.js');
const intervalPasteOutPath = path.join(root, 'n8n', 'code', 'sinotrack-interval-update.paste.txt');
const intervalClipboardOutPath = path.join(root, 'n8n', 'clipboard', 'sinotrack-interval-update.workflow.clipboard.txt');
const pollClipboardOutPath = path.join(root, 'n8n', 'clipboard', 'sinotrack-poll-trigger.workflow.clipboard.txt');

function escapeNonAscii(text) {
  return String(text).replace(/[^\x00-\x7F]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, '0');
    return '\\u' + code;
  });
}

function toCanvasClipboard(workflow) {
  return {
    meta: { instanceId: 'sinotrack-clip' },
    nodes: workflow.nodes,
    connections: workflow.connections,
    pinData: {},
  };
}

fs.mkdirSync(path.dirname(intervalOutPath), { recursive: true });
fs.mkdirSync(path.dirname(intervalCodeOutPath), { recursive: true });
fs.mkdirSync(path.dirname(intervalClipboardOutPath), { recursive: true });

fs.writeFileSync(intervalOutPath, JSON.stringify(intervalWorkflow, null, 2) + '\n', 'utf8');
fs.writeFileSync(pollOutPath, JSON.stringify(pollTriggerWorkflow, null, 2) + '\n', 'utf8');
fs.writeFileSync(intervalCodeOutPath, intervalRunner + '\n', 'utf8');
fs.writeFileSync(intervalPasteOutPath, escapeNonAscii(intervalRunner) + '\n', 'utf8');
fs.writeFileSync(intervalClipboardOutPath, JSON.stringify(toCanvasClipboard(intervalWorkflow)) + '\n', 'utf8');
fs.writeFileSync(pollClipboardOutPath, JSON.stringify(toCanvasClipboard(pollTriggerWorkflow)) + '\n', 'utf8');

console.log('Wrote', intervalOutPath);
console.log('Wrote', pollOutPath);
console.log('Wrote', intervalCodeOutPath);
console.log('Wrote', intervalPasteOutPath);
console.log('Wrote', intervalClipboardOutPath);
console.log('Wrote', pollClipboardOutPath);
