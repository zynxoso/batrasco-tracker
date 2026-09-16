/**
 * TCP → HTTP bridge for Sinotrack ST-903.
 * Listens for TCP, parses payloads, POSTs to Vercel ingest with throttling.
 */

const net = require('net');

const PORT = parseInt(process.env.BRIDGE_PORT || '5000', 10);
const HOST = process.env.BRIDGE_HOST || '0.0.0.0';
const INGEST_URL = process.env.INGEST_URL || 'http://localhost:3000/api/ingest';
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS || '5000', 10); // max one POST per device per N ms
const BATCH_MS = parseInt(process.env.BATCH_MS || '0', 10); // if > 0, batch and send every N ms

const lastSentByDevice = new Map();
let batch = [];

function parseST903(raw) {
  const str = typeof raw === 'string' ? raw : raw.toString('utf8', 0, Math.min(raw.length, 1024));
  const line = str.split('\n')[0].trim();
  if (!line) return null;
  const parts = line.split(/[,;\t]/).map((p) => p.trim());
  if (parts.length < 4) return null;
  const device_id = parts[0];
  const lat = parseFloat(parts[1]);
  const lng = parseFloat(parts[2]);
  const speed = parseFloat(parts[3]) || 0;
  if (!device_id || isNaN(lat) || isNaN(lng)) return null;
  return { device_id, lat, lng, speed_kmh: speed, reported_at: new Date().toISOString() };
}

async function postToIngest(payload) {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Ingest ${res.status}: ${await res.text()}`);
  return res;
}

function throttle(deviceId) {
  const now = Date.now();
  const last = lastSentByDevice.get(deviceId) || 0;
  if (now - last < THROTTLE_MS) return false;
  lastSentByDevice.set(deviceId, now);
  return true;
}

async function flushBatch() {
  if (batch.length === 0) return;
  const toSend = [...batch];
  batch = [];
  try {
    await postToIngest({ reports: toSend });
    console.log(`[${new Date().toISOString()}] Sent ${toSend.length} report(s)`);
  } catch (e) {
    console.error('Ingest error:', e.message);
  }
}

const DEBUG = process.env.BRIDGE_DEBUG === '1';

const server = net.createServer((socket) => {
  let buf = '';
  socket.on('data', async (data) => {
    const raw = data.toString();
    if (DEBUG) console.log(`[${new Date().toISOString()}] TCP received (${raw.length} bytes): ${JSON.stringify(raw.slice(0, 200))}`);
    buf += raw;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = parseST903(line);
      if (!parsed) {
        if (DEBUG) console.log(`[${new Date().toISOString()}] Parse failed for line: ${JSON.stringify(trimmed.slice(0, 120))}`);
        continue;
      }
      if (!throttle(parsed.device_id)) {
        if (BATCH_MS > 0) batch.push(parsed);
        continue;
      }
      if (BATCH_MS > 0) {
        batch.push(parsed);
        continue;
      }
      try {
        await postToIngest(parsed);
        console.log(`[${new Date().toISOString()}] ${parsed.device_id} lat=${parsed.lat} lng=${parsed.lng} speed=${parsed.speed_kmh}`);
      } catch (e) {
        console.error('Ingest error:', e.message);
      }
    }
  });
  socket.on('end', () => {});
  socket.on('error', () => {});
});

if (BATCH_MS > 0) {
  setInterval(flushBatch, BATCH_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`ST-903 bridge listening on ${HOST}:${PORT} → ${INGEST_URL}`);
});
