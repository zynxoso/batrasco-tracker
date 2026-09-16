/**
 * SinoTrack web "AppJson.asp" request signing (same algorithm as gps-go.pc.min.js).
 * Reverse-engineered for personal use with accounts you own; respect site ToS.
 *
 * strSign = MD5( nTimeStamp + strRandom + strUser + strAppID + strToken )
 * strToken = base64( Cmd + \\x11 + Data + \\x11 + Field + \\x11 + \\x1b + pad* )
 * pad: while length % 3 != 0, append ("MGTS_" + random14).charAt(7)  (fresh random each time)
 */

const crypto = require('crypto');

const ROW = '\x11';
const TABLE = '\x1b';

function md5HexUtf8(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

/** MGTS random string as in client (strip "MGTS_" for form field strRandom). */
function generateMgtsRandomString() {
  return 'MGTS_' + Math.floor(1e14 * Math.random()).toString();
}

function stripMgtsPrefix(full) {
  return String(full).replace(/^MGTS_/, '');
}

/**
 * Normalize host to strAppID (base64): lowercase, strip scheme, pad length to multiple of 3 with '/'.
 */
function serverUrlToStrAppID(serverUrl) {
  let n = String(serverUrl || '').toLowerCase();
  n = n.replace(/^https?:\/\//, '');
  while (n.length % 3 !== 0) n += '/';
  return Buffer.from(n, 'utf8').toString('base64');
}

/** Data segment: N'a',N'b' with SQL-style quote escape */
function buildDataSegment(dataParts) {
  if (!Array.isArray(dataParts) || dataParts.length === 0) return '';
  return dataParts
    .map((p) => "N'" + String(p).replace(/'/g, "''") + "'")
    .join(',');
}

/**
 * Build strToken (base64) for a stored-procedure style command.
 * @param {string} cmd e.g. "Proc_GetLastPosition"
 * @param {string} dataSegment from buildDataSegment (N'...' list)
 * @param {string} [field] usually ""
 */
function buildStrToken(cmd, dataSegment, field = '') {
  let r = cmd + ROW + dataSegment + ROW + field + ROW;
  r += TABLE;
  while (r.length % 3 !== 0) {
    r += generateMgtsRandomString().charAt(7);
  }
  return Buffer.from(r, 'latin1').toString('base64');
}

/**
 * @param {{ serverUrl: string, strUser: string, cmd: string, dataParts: string[] }} opts
 * @returns {{ strAppID: string, strUser: string, nTimeStamp: string, strRandom: string, strSign: string, strToken: string }}
 */
function buildSignedFormFields(opts) {
  const { serverUrl, strUser, cmd, dataParts } = opts;
  const strAppID = serverUrlToStrAppID(serverUrl);
  const nTimeStamp = String(Date.now());
  const strRandom = stripMgtsPrefix(generateMgtsRandomString());
  const dataSegment = buildDataSegment(dataParts);
  const strToken = buildStrToken(cmd, dataSegment, '');
  const signInput = nTimeStamp + strRandom + strUser + strAppID + strToken;
  const strSign = md5HexUtf8(signInput);
  return { strAppID, strUser, nTimeStamp, strRandom, strSign, strToken };
}

function defaultAppJsonUrl(serverUrl) {
  const u = new URL(serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`);
  return `${u.origin}/APP/AppJson.asp`;
}

/**
 * Origin/Referer must match the PC portal you use in the browser. For shard APIs
 * (e.g. POST https://246.sinotrack.com/APP/...) the site still sends
 * Origin: https://pro.sinotrack.com — not the shard host.
 * @param {string} _serverUrl unused; kept for call-site clarity
 * @param {{ pageOrigin?: string }} [options] pageOrigin = full portal URL (default: infer shard → pro.sinotrack.com)
 */
function browserLikeHeaders(_serverUrl, options = {}) {
  let page = options.pageOrigin;
  if (!page) {
    try {
      const u = new URL(_serverUrl.startsWith('http') ? _serverUrl : `https://${_serverUrl}`);
      if (/^\d+\.sinotrack\.com$/i.test(u.hostname)) page = 'https://pro.sinotrack.com';
    } catch (_) {}
  }
  if (!page) page = _serverUrl;
  const u = new URL(page.startsWith('http') ? page : `https://${page}`);
  const ua =
    options.userAgent ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return {
    accept: 'text/plain, */*; q=0.01',
    origin: u.origin,
    referer: `${u.origin}/`,
    'user-agent': ua,
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  };
}

/** Explicit portal origin override, or null to let browserLikeHeaders infer. */
function resolvedPageOrigin(serverUrl, envOrigin) {
  if (envOrigin && String(envOrigin).trim()) {
    const o = String(envOrigin).trim();
    return o.startsWith('http') ? o : `https://${o}`;
  }
  try {
    const u = new URL(serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`);
    if (/^\d+\.sinotrack\.com$/i.test(u.hostname)) return 'https://pro.sinotrack.com';
  } catch (_) {}
  return null;
}

/**
 * Combine Set-Cookie from a fetch Response into one Cookie header value (name=value pairs only).
 */
function collectCookieHeader(res) {
  if (!res || !res.headers) return '';
  const parts = [];
  if (typeof res.headers.getSetCookie === 'function') {
    for (const c of res.headers.getSetCookie()) {
      const pair = String(c).split(';')[0].trim();
      if (pair) parts.push(pair);
    }
  } else {
    const raw = res.headers.get('set-cookie');
    if (raw) {
      for (const chunk of raw.split(/,(?=\s*[^=\s]+=)/)) {
        const pair = chunk.split(';')[0].trim();
        if (pair) parts.push(pair);
      }
    }
  }
  return parts.join('; ');
}

/** Web client: Login (0) / LoginAnother (1) / LoginIMEI (2) → Proc_* with N'user',N'pass'. */
function loginCmdForType(loginType) {
  const t = Number(loginType);
  if (t === 2) return 'Proc_LoginIMEI';
  if (t === 1) return 'Proc_LoginAnother';
  return 'Proc_Login';
}

module.exports = {
  serverUrlToStrAppID,
  buildDataSegment,
  buildStrToken,
  buildSignedFormFields,
  defaultAppJsonUrl,
  browserLikeHeaders,
  resolvedPageOrigin,
  collectCookieHeader,
  loginCmdForType,
  generateMgtsRandomString,
  stripMgtsPrefix,
};
