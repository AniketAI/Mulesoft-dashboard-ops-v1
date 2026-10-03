const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const authMiddleware = require('../middleware/authMiddleware');

// Agent that tolerates self-signed / internal-CA certs (same as health.js)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const LEGACY_KEYS = ['ch1_prod', 'ch2_prod', 'ch1_uat', 'ch2_uat'];

/** Strip trailing slash and /api/v2 suffix from a CPS base URL */
function normaliseUrl(url = '') {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
}

/** Build compound key: "{normalised-url}::{bgOrgId}" */
function urlBgKey(rawUrl, bgOrgId) {
  return `${normaliseUrl(rawUrl)}::${bgOrgId}`;
}

/**
 * Credential resolution — priority order:
 *  1. Session keyed by "{url}::{bgOrgId}"  ← per-server × per-BG
 *  2. Session keyed by "{url}" only         ← per-server fallback
 *  3. Session keyed by legacy "ch1_prod"    ← backwards-compat
 *  4. Env vars  CPS_CH1_PROD_CLIENT_ID/SECRET
 */
function getCredentials(req, rawBaseUrl, bgOrgId, envType, chType) {
  const sessionCreds = req.session.cpsCreds || {};
  const normUrl = normaliseUrl(rawBaseUrl);

  // 1. URL + BG composite key
  if (bgOrgId) {
    const key = `${normUrl}::${bgOrgId}`;
    const c = sessionCreds[key];
    if (c?.clientId && c?.clientSecret) return { clientId: c.clientId, clientSecret: c.clientSecret };
  }

  // 2. URL-only key (shared across BGs for that server)
  const byUrl = sessionCreds[normUrl];
  if (byUrl?.clientId && byUrl?.clientSecret) return { clientId: byUrl.clientId, clientSecret: byUrl.clientSecret };

  // 2b. Any url::clientId* entry stored by Strategy 2 (masked cpsClientId path)
  //     Mark as _fromFallback so /fetch can also retry on empty 200 responses
  const urlPrefixEntries = Object.entries(sessionCreds)
    .filter(([k, v]) => k.startsWith(`${normUrl}::`) && v?.clientId && v?.clientSecret);
  if (urlPrefixEntries.length > 0) {
    const [, c] = urlPrefixEntries[0];
    return { clientId: c.clientId, clientSecret: c.clientSecret, _fromFallback: true };
  }

  // 3. Legacy ch/env key
  const legacyKey = `${chType}_${envType}`;
  const byLegacy = sessionCreds[legacyKey];
  if (byLegacy?.clientId && byLegacy?.clientSecret) return { clientId: byLegacy.clientId, clientSecret: byLegacy.clientSecret };

  // 4. Env vars
  const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (clientId && clientSecret) return { clientId, clientSecret };

  return null;
}

function detectEnvType(baseUrl = '', environment = '', envName = '') {
  const s = `${baseUrl} ${environment} ${envName}`.toLowerCase();
  if (/\b(prod|pd)\b/.test(s)) return 'prod';
  // \bstage\b does NOT match "staging" — use stag(e|ing)? to cover both
  if (/\b(uat|ut|stag(e|ing)?|stg|uap|sandbox)\b/.test(s)) return 'uat';
  return 'prod';
}

function detectChType(deploymentType = '') {
  return deploymentType.includes('2') || deploymentType === 'ch2' ? 'ch2' : 'ch1';
}

/* ── GET /api/cps/credentials ────────────────────────────────────────────────
   Returns:
   - byUrlBg: URL×BG entries (new format)
   - byUrl: URL-only entries (per-server fallback)
   - legacy: ch/env entries + env-var status
*/
router.get('/credentials', authMiddleware, (req, res) => {
  const sessionCreds = req.session.cpsCreds || {};

  // Legacy
  const legacy = {};
  LEGACY_KEYS.forEach((key) => {
    const [chType, envType] = key.split('_');
    const prefix = `CPS_${chType.toUpperCase()}_${envType.toUpperCase()}`;
    const fromEnv = !!(process.env[`${prefix}_CLIENT_ID`]);
    const fromSession = !!(sessionCreds[key]?.clientId);
    legacy[key] = { configured: fromEnv || fromSession, source: fromSession ? 'session' : fromEnv ? 'env' : 'none' };
  });

  // URL+BG and URL-only from session
  const byUrlBg = {};
  const byUrl = {};
  Object.entries(sessionCreds).forEach(([key, val]) => {
    if (LEGACY_KEYS.includes(key) || !val?.clientId) return;
    if (key.includes('::')) {
      byUrlBg[key] = { configured: true, source: 'session', maskedId: val.clientId.substring(0, 8) + '…' };
    } else {
      byUrl[key] = { configured: true, source: 'session', maskedId: val.clientId.substring(0, 8) + '…' };
    }
  });

  res.json({ credentials: legacy, byUrl, byUrlBg });
});

/* ── POST /api/cps/credentials ───────────────────────────────────────────────
   Accepts mixed key formats:
   - "ch1_prod"                                   → legacy
   - "https://server.com"                         → URL-only (shared across BGs)
   - "https://server.com::org-id-here"           → URL+BG (per-server × per-BG) ← primary
*/
router.post('/credentials', authMiddleware, (req, res) => {
  const { credentials = {} } = req.body;
  if (!req.session.cpsCreds) req.session.cpsCreds = {};

  for (const [key, creds] of Object.entries(credentials)) {
    if (!creds.clientId && !creds.clientSecret) continue;
    let storageKey;
    if (LEGACY_KEYS.includes(key)) {
      storageKey = key;
    } else if (key.includes('::')) {
      // URL::bgId — normalise just the URL part
      const [rawUrl, bgId] = key.split('::');
      storageKey = `${normaliseUrl(rawUrl)}::${bgId}`;
    } else {
      storageKey = normaliseUrl(key);
    }
    req.session.cpsCreds[storageKey] = { clientId: creds.clientId || '', clientSecret: creds.clientSecret || '' };
  }

  res.json({ success: true });
});

/* ── DELETE /api/cps/credentials/:key ───────────────────────────────────────
   key is URI-encoded; can be legacy, URL-only, or URL::bgId
*/
router.delete('/credentials/:key', authMiddleware, (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (req.session.cpsCreds) {
    delete req.session.cpsCreds[key];
  }
  res.json({ success: true, cleared: key });
});

/* ── GET /api/cps/fetch ──────────────────────────────────────────────────────
   Additional query param: bgOrgId (the BG org ID — used for credential lookup)
*/
router.get('/fetch', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, keys, deploymentType, envName, bgOrgId } = req.query;

  if (!baseUrl || !type) return res.status(400).json({ error: 'baseUrl and type are required' });

  const envType = detectEnvType(baseUrl, environment, envName);
  const chType = detectChType(deploymentType);
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);

  if (!creds) {
    return res.status(422).json({
      error: `CPS credentials not configured for this server / BG combination`,
      credKey: `${chType}_${envType}`,
      cpsUrl: normaliseUrl(baseUrl),
      bgOrgId: bgOrgId || null,
      suggestedKey: bgOrgId ? `${normaliseUrl(baseUrl)}::${bgOrgId}` : normaliseUrl(baseUrl),
      needsConfig: true
    });
  }

  const pathMap = {
    'non-secure':     '/api/v2/properties/non-secure',
    'non-secure-all': '/api/v2/properties/non-secure/all',
    'secure':         '/api/v2/properties/secure',
    'secure-all':     '/api/v2/properties/secure/all',
    'binaries':       '/api/v2/binaries/secure',
    'binaries-auth':  '/api/v2/binaries/secure/auth'
  };

  const cpsPath = pathMap[type];
  if (!cpsPath) return res.status(400).json({ error: `Unknown CPS type: ${type}` });

  const params = {};
  if (environment) params.environment = environment;
  if (keys) params.keys = keys;

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}${cpsPath}`;
  const queryStr = new URLSearchParams(params).toString();
  console.log(`CPS → GET ${fullUrl}?${queryStr}  [bg: ${bgOrgId || 'none'}]`);

  // Helper: make one CPS GET call with a specific credential pair
  const makeCpsCall = async (clientId, clientSecret, timeoutMs = 20000) => {
    return axios.get(fullUrl, {
      headers: { 'client_id': clientId, 'client_secret': clientSecret, 'Content-Type': 'application/json' },
      params,
      timeout: timeoutMs,
      httpsAgent,
      validateStatus: () => true, // handle all statuses ourselves
    });
  };

  let response;
  try {
    console.log(`CPS primary call — clientId="${creds.clientId.slice(0,8)}…"`);
    response = await makeCpsCall(creds.clientId, creds.clientSecret);
    console.log(`CPS primary response — HTTP ${response.status} (clientId="${creds.clientId.slice(0,8)}…")`);

    // Helper: check if a CPS response indicates no project access.
    // Detects three patterns:
    //   1. Empty responses array or empty properties objects
    //   2. properties = "COULD NOT ACCESS" (string) — CPS explicit denial
    //   3. Top-level empty object/array
    const isNoAccessResponse = (r) => {
      const d = r.data;
      if (!d) return true;
      if (Array.isArray(d?.responses)) {
        if (d.responses.length === 0) return true;
        return d.responses.every(x => {
          if (!x.properties) return true;
          if (typeof x.properties === 'string') return true;  // "COULD NOT ACCESS"
          if (typeof x.properties === 'object') return Object.keys(x.properties).length === 0;
          return true;
        });
      }
      if (Array.isArray(d)) return d.length === 0;
      if (typeof d === 'object') return Object.keys(d).length === 0;
      return false;
    };

    // Helper: check specifically for the explicit "COULD NOT ACCESS" string
    // (unambiguous wrong-credential signal — always retry, even for promoted creds)
    const isCouldNotAccess = (r) => {
      const d = r.data;
      if (!d || !Array.isArray(d?.responses)) return false;
      return d.responses.some(x => typeof x.properties === 'string');
    };

    // Retry conditions:
    //   1. HTTP 401 — wrong credential (server-level auth failure)
    //   2. HTTP 200 + "COULD NOT ACCESS" string — wrong cred for THIS project
    //      (retry ALWAYS, even for promoted credentials — different projects need
    //       different credentials even on the same CPS server)
    //   3. HTTP 200 + empty response + step 2b fallback credential only
    const shouldRetry = response.status === 401 ||
      isCouldNotAccess(response) ||
      (response.status === 200 && creds._fromFallback && isNoAccessResponse(response));

    if (shouldRetry && response.status === 200) {
      console.log(`CPS 200 but no project access — credential "${creds.clientId.slice(0,8)}…" ${isCouldNotAccess(response) ? 'returned COULD NOT ACCESS' : 'returned empty response'}; trying other credentials`);
    }

    if (shouldRetry) {
      const sessionCreds = req.session.cpsCreds || {};
      const altEntries = Object.entries(sessionCreds)
        .filter(([k, v]) => k.startsWith(`${normaliseUrl(baseUrl)}::`) && v?.clientId && v?.clientId !== creds.clientId && v?.clientSecret);

      console.log(`CPS 401 — ${altEntries.length} alt credential(s) available for retry`);
      if (altEntries.length > 0) {
        const BATCH = 5;
        let found = false;
        for (let i = 0; i < altEntries.length && !found; i += BATCH) {
          const batch = altEntries.slice(i, i + BATCH);
          const batchNum = Math.floor(i / BATCH) + 1;
          const totalBatches = Math.ceil(altEntries.length / BATCH);
          console.log(`CPS retry batch ${batchNum}/${totalBatches} — testing clientIds: [${batch.map(([,c]) => c.clientId.slice(0,8)+'…').join(', ')}]`);
          const settled = await Promise.allSettled(
            batch.map(([, c]) => makeCpsCall(c.clientId, c.clientSecret, 5000).then(r => ({ cred: c, res: r })))
          );
          for (const s of settled) {
            if (s.status === 'rejected') {
              console.log(`CPS retry — clientId="${s.reason?.config?.headers?.client_id?.slice(0,8) || '?'}…" threw: ${s.reason?.code || s.reason?.message}`);
            } else {
              const { cred, res: r } = s.value;
              const noAccess = isNoAccessResponse(r);
              console.log(`CPS retry — clientId="${cred.clientId.slice(0,8)}…" → HTTP ${r.status}${r.status === 200 && noAccess ? ' (no project access)' : r.status === 200 ? ' ✅ has data' : ''}`);
              // Accept this credential if: not 401 AND not "no project access"
              if (r.status !== 401 && !(r.status === 200 && noAccess)) {
                response = r;
                // Promote to url::bgOrgId (when bgOrgId is known) AND url-only
                // This ensures callers with bgId='__all__' (no bgOrgId) also benefit
                if (bgOrgId) req.session.cpsCreds[`${normaliseUrl(baseUrl)}::${bgOrgId}`] = { clientId: cred.clientId, clientSecret: cred.clientSecret };
                req.session.cpsCreds[normaliseUrl(baseUrl)] = { clientId: cred.clientId, clientSecret: cred.clientSecret };
                console.log(`CPS retry resolved ✅ — promoted clientId "${cred.clientId.slice(0,8)}…" as primary (batch ${batchNum}/${totalBatches})`);
                found = true;
                break;
              }
            }
          }
        }
        if (!found) {
          console.warn(`CPS retry ❌ — all ${altEntries.length} credentials returned 401 or empty data`);
        }
      } else {
        console.warn(`CPS 401 — no alt credentials available; CSV may not contain a valid credential for this server`);
      }
    }

    // ── Per-group credential resolution for secure fetches ─────────────────────
    // When secure properties are requested with multiple group keys, different
    // groups on the same CPS server may require DIFFERENT credentials.
    // After the main retry resolves a credential for SOME groups, check if
    // any groups still returned "COULD NOT ACCESS" and try the remaining
    // credentials specifically for those groups, then merge the results.
    if ((type === 'secure' || type === 'secure-all') &&
        response?.status === 200 &&
        Array.isArray(response?.data?.responses)) {

      const failedKeys = response.data.responses
        .filter(r => typeof r.properties === 'string')   // "COULD NOT ACCESS" = string value
        .map(r => r.key)
        .filter(Boolean);

      if (failedKeys.length > 0) {
        console.log(`CPS per-group retry — ${failedKeys.length} group(s) still COULD NOT ACCESS after main retry`);

        // Collect all unique credentials from session (excluding the one already used)
        const sessionCreds = req.session.cpsCreds || {};
        const usedClientId = creds.clientId;
        const altCreds = Object.values(sessionCreds)
          .filter(c => c?.clientId && c?.clientId !== usedClientId && c?.clientSecret)
          // Deduplicate by clientId
          .filter((c, i, arr) => arr.findIndex(x => x.clientId === c.clientId) === i);

        // Try each alt credential against ONLY the failed group keys
        const remaining = new Set(failedKeys);
        for (const altCred of altCreds) {
          if (remaining.size === 0) break;
          try {
            const altParams = { ...params, keys: [...remaining].join(',') };
            const altRes = await axios.get(fullUrl, {
              headers: { 'client_id': altCred.clientId, 'client_secret': altCred.clientSecret, 'Content-Type': 'application/json' },
              params: altParams,
              timeout: 8000,
              httpsAgent,
              validateStatus: () => true,
            });

            if (altRes.status === 200 && Array.isArray(altRes.data?.responses)) {
              let resolved = 0;
              for (const group of altRes.data.responses) {
                // Only merge if this group now has actual properties (not COULD NOT ACCESS)
                if (typeof group.properties === 'object' && group.properties !== null &&
                    Object.keys(group.properties).length > 0) {
                  const idx = response.data.responses.findIndex(r => r.key === group.key);
                  if (idx >= 0) {
                    response.data.responses[idx] = group;  // replace COULD NOT ACCESS with real data
                    remaining.delete(group.key);
                    resolved++;
                  }
                }
              }
              if (resolved > 0) {
                console.log(`CPS per-group retry — clientId="${altCred.clientId.slice(0,8)}…" resolved ${resolved} group(s) (${remaining.size} still failing)`);
              }
            }
          } catch { /* skip this credential */ }
        }

        if (remaining.size < failedKeys.length) {
          console.log(`CPS per-group retry complete — resolved ${failedKeys.length - remaining.size}/${failedKeys.length} previously-failing group(s)`);
        } else {
          console.log(`CPS per-group retry complete — no additional groups resolved (all ${failedKeys.length} require credentials not in the uploaded CSV)`);
        }
      }
    }
  } catch (fetchErr) {
    const msg = fetchErr.code === 'ECONNABORTED' || fetchErr.code === 'ETIMEDOUT'
      ? `CPS request timed out after ${fetchErr.config?.timeout || 20000}ms`
      : fetchErr.message || 'CPS network error';
    console.error(`CPS fetch error for ${fullUrl}: [${fetchErr.code || 'ERR'}] ${msg}`);
    return res.status(504).json({ error: msg, attemptedUrl: `${fullUrl}?${queryStr}` });
  }

  try {
    if (response.status >= 400) {
      const errMsg = response.data?.message || response.data?.description || response.data?.error
        || (typeof response.data === 'string' ? response.data : null) || `HTTP ${response.status}`;
      console.error(`CPS error (${response.status}) ${fullUrl}?${queryStr}: ${errMsg}`);
      return res.status(response.status).json({ error: errMsg, attemptedUrl: `${fullUrl}?${queryStr}`, details: response.data });
    }

    const data = response.data;
    if (type === 'binaries') {
      const list = Array.isArray(data) ? data : (data.properties || data.binaries || []);
      return res.json({
        type,
        binaries: list.map((b) => ({
          key: b.key || b.name,
          environment: b.environment,
          size: b.size,
          contentType: b.contentType || b.type || 'application/octet-stream',
          lastModified: b.lastModified || b.updatedAt
        }))
      });
    }

    res.json(data);
  } catch (error) {
    const status = error.response?.status || 500;
    const msg = error.response?.data?.message
      || error.response?.data?.description
      || error.response?.data?.error
      || (typeof error.response?.data === 'string' ? error.response.data : null)
      || error.message
      || 'CPS request failed';
    console.error(`CPS error (${status}) ${fullUrl}?${queryStr}: ${msg}`);
    res.status(status).json({ error: msg, attemptedUrl: `${fullUrl}?${queryStr}`, details: error.response?.data });
  }
});

/* ── POST /api/cps/search-user ───────────────────────────────────────────────
   Fan-out CPS search: find all apps whose non-secure OR secure CPS properties
   contain a given username (value-match, case-insensitive).

   Body: {
     username: string,
     apps: [{
       appName, appId?, cpsBaseUrl, cpsKey, cpsEnv,
       deploymentType, envName, bgOrgId
     }]
   }

   Returns: {
     results: [{
       appName, appId, matchedProps: [{ key, value, source }]
     }],
     scanned: number,
     skipped: number   // apps with no CPS config
   }
*/
router.post('/search-user', authMiddleware, async (req, res) => {
  const { username, apps = [], searchMode = 'value', exactMatch = false } = req.body || {};
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (!Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'apps array is required' });
  }

  // Support comma-separated terms — any term matching a property value counts as a hit.
  // e.g. "john.doe, jane.smith" → search for either "john.doe" OR "jane.smith"
  const searchTerms = username.trim().toLowerCase()
    .split(',').map(t => t.trim()).filter(Boolean);
  const CONCURRENCY = 30; // increased from 15 for faster fan-out

  // ── Circuit breaker: per-URL connection-failure tracking ─────────────────
  // After CIRCUIT_OPEN_THRESHOLD consecutive ECONNABORTED/ETIMEDOUT failures
  // for the same CPS base URL, all remaining apps on that server are skipped
  // immediately without waiting for another timeout.  This prevents a slow or
  // unreachable CPS server from blocking the entire search for 15s × N apps.
  const failedUrls = new Map(); // normalisedUrl → failure count
  const CIRCUIT_OPEN_THRESHOLD = 3;

  /** Flatten CPS response (all formats) into a flat {key:value} map */
  function flattenProps(data) {
    if (!data) return {};
    let flat = {};

    const propsArray =
      Array.isArray(data) ? data
      : Array.isArray(data?.responses) ? data.responses
      : Array.isArray(data?.properties) ? data.properties
      : null;

    if (propsArray) {
      propsArray.forEach(entry => {
        const inner = entry?.properties;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          Object.assign(flat, inner);
        } else if (Array.isArray(inner)) {
          inner.forEach(p => { if (p?.key != null) flat[String(p.key)] = p.value ?? p.val ?? ''; });
        } else if (entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.key && !entry.environment) {
          Object.assign(flat, entry);
        }
      });
    } else if (data && typeof data === 'object') {
      const firstVal = Object.values(data)[0];
      if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
        flat = data[Object.keys(data)[0]] || firstVal;
      } else {
        flat = data;
      }
    }
    return flat;
  }

  /** Scan a flat props map for any of the search terms in values */
  function scanProps(flat, source) {
    const hits = [];
    for (const [k, v] of Object.entries(flat)) {
      if (v != null) {
        const target = searchMode === 'key' ? String(k) : String(v);
        const matchFound = searchTerms.some(term => {
          return exactMatch 
            ? target.toLowerCase() === term 
            : target.toLowerCase().includes(term);
        });
        if (matchFound) {
          hits.push({ key: k, value: String(v), source });
        }
      }
    }
    return hits;
  }

  /** Find a related password property in the same namespace as matchedKey.
   *
   * Pass 1 (preferred): prefix-restricted match — same top-level namespace as
   *   the matched key (e.g., matchedKey="db.username" → looks for "db.*password*").
   *   Skips values that are themselves masked (all-asterisk placeholders).
   *
   * Pass 2 (fallback): no prefix restriction — returns the first non-masked
   *   password-like value found anywhere in props.  Used when the secure group
   *   stores credentials under a different namespace (e.g., non-secure key uses
   *   "anypoint.mq.*" prefix but the secure group just has "password").
   */
  function findPassword(props, matchedKey) {
    const PWD_PATTERN = /password|passwd|\.secret$|_secret$|\.pwd$|_pwd$/i;
    const prefix = matchedKey.includes('.') ? matchedKey.split('.')[0] : '';

    // Pass 1: prefix-restricted, skip masked (***) values
    for (const [k, v] of Object.entries(props || {})) {
      if (!PWD_PATTERN.test(k)) continue;
      if (prefix && !k.startsWith(prefix)) continue;
      const val = v != null ? String(v) : '';
      if (val && !/^\*+$/.test(val)) return val;   // real value found ✅
    }

    // Pass 2: cross-namespace fallback — any password-like key with a real value
    // Only run when a prefix was in play (no-prefix keys already searched above exhaustively)
    if (prefix) {
      for (const [k, v] of Object.entries(props || {})) {
        if (!PWD_PATTERN.test(k)) continue;
        const val = v != null ? String(v) : '';
        if (val && !/^\*+$/.test(val)) return val;  // cross-namespace real value ✅
      }
    }

    return '';
  }

  /** Check if a non-secure CPS response contains no usable data or only access-denied entries */
  function isEmptyNsResponse(data) {
    if (!data) return true;
    if (Array.isArray(data?.responses)) {
      if (data.responses.length === 0) return true;
      // "COULD NOT ACCESS" stored as a string → credential lacks project-level access
      // Treat this the same as an empty response so the retry loop kicks in
      if (data.responses.some(r => typeof r?.properties === 'string')) return true;
      return data.responses.every(r => !r?.properties ||
        (typeof r.properties === 'object' && Object.keys(r.properties).length === 0)
      );
    }
    if (Array.isArray(data)) return data.length === 0;
    if (typeof data === 'object') return Object.keys(data).length === 0;
    return true;
  }

  /** Process one app — fetch non-secure + optionally secure, return matched props */
  async function processApp(appEntry) {
    const { appName, appId, cpsBaseUrl, cpsKey, cpsEnv, deploymentType, envName, bgOrgId, status } = appEntry;
    if (!cpsBaseUrl || !cpsKey) return null; // no CPS config

    // Normalise URL early so both the circuit-breaker check and the catch
    // block (ECONNABORTED handler) always reference the same canonical key.
    const cleanBase = normaliseUrl(cpsBaseUrl);

    // Circuit breaker: skip immediately if this server already timed out N times
    if ((failedUrls.get(cleanBase) || 0) >= CIRCUIT_OPEN_THRESHOLD) {
      return { _circuitBroken: true, appName, cpsUrl: cleanBase };
    }

    const envType = detectEnvType(cpsBaseUrl, cpsEnv, envName);
    const chType = detectChType(deploymentType || '');
    let creds = getCredentials(req, cpsBaseUrl, bgOrgId, envType, chType);
    if (!creds) return null; // no credentials configured — skip silently

    const params = { environment: cpsEnv, keys: cpsKey };
    const nsUrl = `${cleanBase}/api/v2/properties/non-secure`;

    let matchedProps = [];

    // ── Non-secure fetch with credential retry ────────────────────────────
    let nsRes;
    try {
      nsRes = await axios.get(nsUrl, {
        headers: { client_id: creds.clientId, client_secret: creds.clientSecret, 'Content-Type': 'application/json' },
        params,
        timeout: 8000,       // reduced from 15 s — fast enough for a healthy CPS server
        httpsAgent,          // tolerates internal CA certs (prevents UNABLE_TO_GET_ISSUER_CERT_LOCALLY)
        validateStatus: () => true,
      });
      nsSearched++;

      // Retry on 401 or empty response — try all other session credentials
      if (nsRes.status === 401 || (nsRes.status === 200 && isEmptyNsResponse(nsRes.data))) {
        const reason = nsRes.status === 401 ? '401' : 'empty response';
        const sessionCreds = req.session.cpsCreds || {};
        const altEntries = Object.entries(sessionCreds)
          .filter(([k, v]) => k.startsWith(`${cleanBase}::`) && v?.clientId && v?.clientId !== creds.clientId && v?.clientSecret);
        if (altEntries.length > 0) {
          console.log(`[search-user] "${appName}" — ${reason}, trying ${altEntries.length} alt credential(s)`);
          // Parallel batches of 5 — same pattern as /fetch route.
          // Serial retries were O(N × timeout) when the CPS server is slow;
          // batching reduces that to O(ceil(N/5) × timeout).
          const RETRY_BATCH = 5;
          let resolvedAlt = null;
          for (let ri = 0; ri < altEntries.length && !resolvedAlt; ri += RETRY_BATCH) {
            const retryBatch = altEntries.slice(ri, ri + RETRY_BATCH);
            const retrySettled = await Promise.allSettled(
              retryBatch.map(([, altCred]) =>
                axios.get(nsUrl, {
                  headers: { client_id: altCred.clientId, client_secret: altCred.clientSecret, 'Content-Type': 'application/json' },
                  params,
                  timeout: 5000,
                  httpsAgent,
                  validateStatus: () => true,
                }).then(r => ({ altCred, r }))
              )
            );
            for (const s of retrySettled) {
              if (s.status === 'fulfilled') {
                const { altCred, r } = s.value;
                if (r.status !== 401 && !(r.status === 200 && isEmptyNsResponse(r.data))) {
                  resolvedAlt = { altCred, r };
                  break;
                }
              }
            }
          }
          if (resolvedAlt) {
            nsRes = resolvedAlt.r;
            creds = resolvedAlt.altCred;
            // Promote working credential so subsequent apps on this server skip the retry loop
            req.session.cpsCreds[`${cleanBase}::${bgOrgId}`] = { clientId: resolvedAlt.altCred.clientId, clientSecret: resolvedAlt.altCred.clientSecret };
            req.session.cpsCreds[cleanBase] = { clientId: resolvedAlt.altCred.clientId, clientSecret: resolvedAlt.altCred.clientSecret };
            console.log(`[search-user] "${appName}" — alt credential resolved ✅ (promoted to session for ${cleanBase})`);
          }
        }
      }

      // After retry, if still 401 — credential not found for this app's CPS server
      if (nsRes.status === 401) {
        return { _authError: true, appName };
      }
      // Server error — skip silently
      if (nsRes.status >= 500) {
        return null;
      }

      const nsFlat = flattenProps(nsRes.data);
      const nsHits = scanProps(nsFlat, 'non-secure').map(h => ({
        ...h, secureGroupKey: '', password: findPassword(nsFlat, h.key),
      }));
      matchedProps = matchedProps.concat(nsHits);

      // ── Secure fetch — check all common key names used to reference secure groups ──
      const secureKeyStr =
        nsFlat['cps.secure.properties']       ||  // standard
        nsFlat['cps.secure.keys']              ||  // alternative
        nsFlat['cps.secureProperties']         ||  // camelCase variant
        nsFlat['cps.security.properties']      ||  // security namespace
        nsFlat['cps.properties.secure']        ||  // reversed order
        nsFlat['anypoint.config.secure.properties'] ||
        '';
      if (secureKeyStr) {
        secureRefSearched++;
        try {
          const sUrl = `${cleanBase}/api/v2/properties/secure`;
          const sRes = await axios.get(sUrl, {
            headers: { client_id: creds.clientId, client_secret: creds.clientSecret, 'Content-Type': 'application/json' },
            params: { environment: cpsEnv, keys: secureKeyStr },
            timeout: 8000,   // reduced from 15 s
            validateStatus: () => true,
          });
          // Parse per-group to track which secure group each match came from
          const sData = sRes.data;
          const groups = Array.isArray(sData?.responses) ? sData.responses
            : Array.isArray(sData) ? sData
            : (sData && typeof sData === 'object' ? [{ key: secureKeyStr.split(',')[0].trim(), properties: sData }] : []);
          const accessDeniedGroups = groups.filter(g => typeof g.properties === 'string').length;
          if (sRes.status !== 200 || accessDeniedGroups > 0) {
            const secureGroupKeys = groups.map(g => g.key || '?').join(', ');
            const securePropsCount = groups.reduce((n, g) => n + (typeof g.properties === 'object' ? Object.keys(g.properties || {}).length : 0), 0);
            //console.log(`[search-user][SEC-REF] "${appName}" HTTP=${sRes.status} groups=[${secureGroupKeys}] props=${securePropsCount} denied=${accessDeniedGroups}`);
          }
          for (const group of groups) {
            if (!group) continue;
            const gKey = group.key || secureKeyStr.split(',')[0].trim() || '';
            const gProps = group.properties || {};
            if (typeof gProps !== 'object' || Array.isArray(gProps)) continue;
            const sHits = scanProps(gProps, 'secure').map(h => ({
              ...h, secureGroupKey: gKey, password: findPassword(gProps, h.key),
            }));
            matchedProps = matchedProps.concat(sHits);
            // ── Unmask non-secure passwords ─────────────────────────────────
            // Non-secure props often store *** as a placeholder for passwords
            // whose real value lives in the secure group. Now that we have the
            // secure group props, update any non-secure hit whose password is
            // still masked/empty with the actual value from this secure group.
            matchedProps.forEach(hit => {
              if (hit.source === 'non-secure' &&
                  (!hit.password || /^\*+$/.test(String(hit.password)))) {
                const pw = findPassword(gProps, hit.key);
                if (pw && !/^\*+$/.test(pw)) hit.password = pw;
              }
            });
          }
        } catch (sErr) {
          //console.log(`[search-user] "${appName}" secure fetch FAILED: ${sErr.code || sErr.message}`);
        }
      } else {
        // ── No reference key in non-secure — try secure fetch anyway ──────
        secureFallbackSearched++;
        try {
          const sUrl2 = `${cleanBase}/api/v2/properties/secure`;
          const sRes2 = await axios.get(sUrl2, {
            headers: { client_id: creds.clientId, client_secret: creds.clientSecret, 'Content-Type': 'application/json' },
            params: { environment: cpsEnv, keys: cpsKey },
            timeout: 8000, httpsAgent, validateStatus: () => true,
          });
          if (sRes2.status === 200) {
            const s2Flat = flattenProps(sRes2.data);
            const s2Hits = scanProps(s2Flat, 'secure').map(h => ({ ...h, secureGroupKey: cpsKey, password: findPassword(s2Flat, h.key) }));
            if (s2Hits.length > 0) matchedProps = matchedProps.concat(s2Hits);
            // ── Unmask non-secure passwords (fallback path) ─────────────────
            // Same logic as above: replace *** placeholders in non-secure hits
            // with the actual value found in the fallback secure group.
            matchedProps.forEach(hit => {
              if (hit.source === 'non-secure' &&
                  (!hit.password || /^\*+$/.test(String(hit.password)))) {
                const pw = findPassword(s2Flat, hit.key);
                if (pw && !/^\*+$/.test(pw)) hit.password = pw;
              }
            });
          }
        } catch { /* skip — secure properties optional */ }
      }
    } catch (err) {
      // Log the error type so logs distinguish timeout/network from no-match
      const code = err.code || (err.response?.status ? `HTTP ${err.response.status}` : 'ERR');
      console.warn(`[search-user] processApp failed for "${appName}" [${code}]: ${err.message}`);
      // Circuit breaker: count connection-level failures per CPS URL.
      // ECONNABORTED = axios timeout, ETIMEDOUT = OS-level timeout,
      // ECONNREFUSED / ENOTFOUND = server unreachable / DNS failure.
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNREFUSED'  || err.code === 'ENOTFOUND') {
        const count = (failedUrls.get(cleanBase) || 0) + 1;
        failedUrls.set(cleanBase, count);
        if (count === CIRCUIT_OPEN_THRESHOLD) {
          console.warn(`[search-user] Circuit breaker OPEN for "${cleanBase}" — remaining apps on this CPS server will be skipped instantly`);
        }
      }
      return null;
    }

    if (matchedProps.length === 0) return null;
    return {
      appName,
      appId: appId || appName,
      envName,
      deploymentType,
      cpsKey,
      cpsPrefix: cpsEnv,
      status: status || '',
      matchedProps,
    };
  }

  // ── Stats counters ─────────────────────────────────────────────────────────
  let nsSearched = 0;             // apps where non-secure was fetched
  let secureRefSearched = 0;      // apps where secure was fetched via reference key
  let secureFallbackSearched = 0; // apps where fallback secure (no reference key) was attempted

  // ── Concurrency-limited fan-out ──────────────────────────────────────────
  const results = [];
  let skipped = 0;            // apps with no CPS config or no credentials
  let scanned = 0;            // apps successfully queried (with or without matches)
  let matched = 0;            // apps with at least one matching property
  let credentialErrors = 0;   // apps skipped due to 401 (missing / invalid CPS credentials)
  let circuitBrokenCount = 0; // apps skipped instantly because their CPS URL hit the circuit breaker

  for (let i = 0; i < apps.length; i += CONCURRENCY) {
    const batch = apps.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(a => processApp(a)));
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        if (outcome.value?._circuitBroken) {
          circuitBrokenCount++;
          skipped++;
        } else if (outcome.value === null) {
          skipped++;
        } else if (outcome.value?._authError) {
          // 401 after exhausting all credentials — count separately
          credentialErrors++;
          skipped++;
        } else {
          scanned++;
          matched++;
          results.push(outcome.value);
        }
      } else {
        skipped++;
      }
    }
  }

  if (credentialErrors > 0) {
    console.warn(`[search-user] "${username}" — ${credentialErrors} app(s) returned HTTP 401 for all credentials; upload a CPS CSV with broader credentials to include those apps`);
  }

  // Collect circuit-broken URLs for the response so the frontend can surface them
  const circuitBrokenUrls = [...failedUrls.entries()]
    .filter(([, count]) => count >= CIRCUIT_OPEN_THRESHOLD)
    .map(([url]) => url);
  if (circuitBrokenUrls.length > 0) {
    console.warn(`[search-user] Unreachable CPS servers (circuit open): [${circuitBrokenUrls.join(', ')}] — ${circuitBrokenCount} app(s) skipped without timeout`);
  }

  console.log(`[search-user] terms=[${searchTerms.join(' | ')}] — total: ${apps.length}, matched: ${matched}, credentialErrors: ${credentialErrors}, circuitBroken: ${circuitBrokenCount}, skipped/no-match: ${skipped - credentialErrors - circuitBrokenCount}`);
  res.json({ results, scanned: apps.length, matched, skipped, credentialErrors,
    circuitBrokenUrls, circuitBrokenCount,
    searchStats: { nonSecureSearched: nsSearched, secureRefSearched, secureFallbackSearched } });
});

// ─────────────────────────────────────────────────────────────────────────────
// CPS WRITE OPERATIONS (CRUD + Auth Management)
// ─────────────────────────────────────────────────────────────────────────────

/* ── POST /api/cps/write ──────────────────────────────────────────────────────
   Create (POST) or Update (PUT) a CPS project entry.

   Body: {
     baseUrl      string   CPS server base URL
     type         string   'non-secure' | 'secure'
     method       string   'POST' (create new) | 'PUT' (update existing)  — default: 'PUT'
     environment  string   CPS environment prefix  e.g. 'prod' | 'uat'
     projectKey   string   CPS project key  e.g. 'my-api-name-v1-uw2-pd'
     properties   object   { "key1": "value1", "key2": "value2", ... }
     bgOrgId      string   Business Group org ID (for credential lookup)
   }

   The CPS write body format (confirmed from Postman collection):
   { "properties": [{ "environment", "key", "properties": { k: v } }] }
*/
router.post('/write', authMiddleware, async (req, res) => {
  const {
    baseUrl,
    type = 'non-secure',
    method = 'PUT',
    environment,
    projectKey,
    properties = {},
    bgOrgId,
  } = req.body || {};

  if (!baseUrl || !environment || !projectKey) {
    return res.status(400).json({ error: 'baseUrl, environment, and projectKey are required' });
  }

  const validTypes = ['non-secure', 'secure'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}` });
  }

  const validMethods = ['POST', 'PUT'];
  const httpMethod = (method || 'PUT').toUpperCase();
  if (!validMethods.includes(httpMethod)) {
    return res.status(400).json({ error: `Invalid method: ${method}. Must be POST or PUT` });
  }

  const envType = detectEnvType(baseUrl, environment, '');
  const chType = detectChType('');
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);
  if (!creds) {
    return res.status(422).json({
      error: 'CPS credentials not configured for this server',
      cpsUrl: normaliseUrl(baseUrl),
      bgOrgId: bgOrgId || null,
      needsConfig: true,
    });
  }

  const pathMap = {
    'non-secure': '/api/v2/properties/non-secure',
    'secure':     '/api/v2/properties/secure',
  };

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}${pathMap[type]}`;

  const body = {
    properties: [{ environment, key: projectKey, properties }],
  };

  console.info(`[CPS Write] user=${req.session?.username || 'unknown'} op=${httpMethod} project=${projectKey} env=${environment} type=${type} base=${cleanBaseUrl}`);

  try {
    const response = await axios({
      method: httpMethod.toLowerCase(),
      url: fullUrl,
      headers: {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        'Content-Type': 'application/json',
      },
      data: body,
      timeout: 20000,
      validateStatus: () => true,
    });

    const reqDetails = { method: httpMethod, url: fullUrl, body };
    const resDetails = { status: response.status, body: response.data };

    if (response.status >= 400) {
      const errMsg = response.data?.message || response.data?.description || response.data?.error
        || (typeof response.data === 'string' ? response.data : null)
        || `CPS ${httpMethod} failed with HTTP ${response.status}`;
      console.error(`[CPS Write] ${httpMethod} failed (${response.status}): ${errMsg}`);
      return res.status(response.status).json({
        error: errMsg, details: response.data,
        requestDetails: reqDetails, responseDetails: resDetails,
      });
    }

    return res.json({
      success: true,
      method: httpMethod,
      projectKey,
      environment,
      type,
      propertyCount: Object.keys(properties).length,
      requestDetails: reqDetails,
      responseDetails: resDetails,
    });
  } catch (err) {
    const msg = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
      ? `CPS request timed out after 20s`
      : err.message || 'CPS write request failed';
    console.error(`[CPS Write] Network error for ${fullUrl}: ${msg}`);
    return res.status(504).json({ error: msg });
  }
});

/* ── DELETE /api/cps/project ──────────────────────────────────────────────────
   Delete an ENTIRE CPS project entry (all properties for that key+environment).

   ⚠️  There is no CPS endpoint for deleting an individual property key.
       DELETE removes the whole project entry.  To remove a single key,
       use PUT /api/cps/write with the key omitted from the properties object.

   Body: { baseUrl, type, environment, projectKey, bgOrgId }
*/
router.delete('/project', authMiddleware, async (req, res) => {
  const {
    baseUrl,
    type = 'non-secure',
    environment,
    projectKey,
    bgOrgId,
  } = req.body || {};

  if (!baseUrl || !environment || !projectKey) {
    return res.status(400).json({ error: 'baseUrl, environment, and projectKey are required' });
  }

  const envType = detectEnvType(baseUrl, environment, '');
  const chType = detectChType('');
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);
  if (!creds) {
    return res.status(422).json({ error: 'CPS credentials not configured for this server', needsConfig: true });
  }

  const pathMap = {
    'non-secure': '/api/v2/properties/non-secure',
    'secure':     '/api/v2/properties/secure',
    'binaries':   '/api/v2/binaries/secure',
  };

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}${pathMap[type] || pathMap['non-secure']}`;

  console.info(`[CPS Write] user=${req.session?.username || 'unknown'} op=DELETE project=${projectKey} env=${environment} type=${type} base=${cleanBaseUrl}`);

  try {
    const response = await axios.delete(fullUrl, {
      headers: { client_id: creds.clientId, client_secret: creds.clientSecret },
      params: { environment, keys: projectKey },
      timeout: 20000,
      validateStatus: () => true,
    });

    const delReqDetails = {
      method: 'DELETE', url: fullUrl,
      params: { environment, keys: projectKey },
    };
    const delResDetails = { status: response.status, body: response.data };

    if (response.status >= 400) {
      const errMsg = response.data?.message || response.data?.error
        || `CPS DELETE failed with HTTP ${response.status}`;
      console.error(`[CPS Write] DELETE failed (${response.status}): ${errMsg}`);
      return res.status(response.status).json({
        error: errMsg,
        requestDetails: delReqDetails, responseDetails: delResDetails,
      });
    }

    return res.json({
      success: true, deleted: projectKey, environment, type,
      requestDetails: delReqDetails,
      responseDetails: delResDetails,
    });
  } catch (err) {
    const msg = err.code === 'ECONNABORTED' ? 'CPS request timed out' : err.message;
    return res.status(504).json({ error: msg });
  }
});

/* ── GET /api/cps/auth ────────────────────────────────────────────────────────
   Fetch the access control list (allowedClientIds + readOnlyClientIds) for a
   CPS project key.

   Query: baseUrl, type, environment, projectKey, bgOrgId
*/
router.get('/auth', authMiddleware, async (req, res) => {
  const { baseUrl, type = 'non-secure', environment, projectKey, bgOrgId } = req.query;

  if (!baseUrl || !environment || !projectKey) {
    return res.status(400).json({ error: 'baseUrl, environment, and projectKey are required' });
  }

  const envType = detectEnvType(baseUrl, environment, '');
  const chType = detectChType('');
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);
  if (!creds) {
    return res.status(422).json({ error: 'CPS credentials not configured', needsConfig: true });
  }

  const authPathMap = {
    'non-secure': '/api/v2/properties/non-secure/auth',
    'secure':     '/api/v2/properties/secure/auth',
    'binaries':   '/api/v2/binaries/secure/auth',
  };

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}${authPathMap[type] || authPathMap['non-secure']}`;

  try {
    const response = await axios.get(fullUrl, {
      headers: { client_id: creds.clientId, client_secret: creds.clientSecret },
      params: { environment, keys: projectKey },
      timeout: 15000,
      validateStatus: () => true,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(504).json({ error: err.message || 'CPS auth fetch failed' });
  }
});

/* ── POST /api/cps/auth ───────────────────────────────────────────────────────
   Update the access control list for a CPS project key.

   Body: {
     baseUrl          string
     type             string   'non-secure' | 'secure' | 'binaries'
     environment      string
     projectKey       string
     allowedClientIds string[]  Client IDs with full read+write access
     readOnlyClientIds string[] Client IDs with read-only access (optional)
     replace          boolean  true → PUT /auth (full replace)
                               false (default) → PUT /auth/add (non-destructive append)
     bgOrgId          string
   }
*/
router.post('/auth', authMiddleware, async (req, res) => {
  const {
    baseUrl,
    type = 'non-secure',
    environment,
    projectKey,
    allowedClientIds = [],
    readOnlyClientIds = [],
    replace = false,
    bgOrgId,
  } = req.body || {};

  if (!baseUrl || !environment || !projectKey) {
    return res.status(400).json({ error: 'baseUrl, environment, and projectKey are required' });
  }
  if (!Array.isArray(allowedClientIds) || allowedClientIds.length === 0) {
    return res.status(400).json({ error: 'allowedClientIds must be a non-empty array' });
  }

  const envType = detectEnvType(baseUrl, environment, '');
  const chType = detectChType('');
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);
  if (!creds) {
    return res.status(422).json({ error: 'CPS credentials not configured', needsConfig: true });
  }

  const baseAuthPathMap = {
    'non-secure': '/api/v2/properties/non-secure/auth',
    'secure':     '/api/v2/properties/secure/auth',
    'binaries':   '/api/v2/binaries/secure/auth',
  };
  const basePath = baseAuthPathMap[type] || baseAuthPathMap['non-secure'];
  // replace=true → full replace: PUT /auth
  // replace=false → non-destructive append: PUT /auth/add
  const suffix = replace ? '' : '/add';
  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}${basePath}${suffix}`;

  const body = {
    properties: [{
      environment,
      key: projectKey,
      allowedClientIds,
      ...(readOnlyClientIds.length > 0 && { readOnlyClientIds }),
    }],
  };

  console.info(`[CPS Auth] user=${req.session?.username || 'unknown'} op=${replace ? 'REPLACE' : 'ADD'} project=${projectKey} env=${environment} type=${type} allowedCount=${allowedClientIds.length}`);

  try {
    const response = await axios.put(fullUrl, body, {
      headers: {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    const authReqDetails = { method: 'PUT', url: fullUrl, body };
    const authResDetails = { status: response.status, body: response.data };

    if (response.status >= 400) {
      const errMsg = response.data?.message || response.data?.error
        || `CPS auth update failed with HTTP ${response.status}`;
      return res.status(response.status).json({
        error: errMsg,
        requestDetails: authReqDetails, responseDetails: authResDetails,
      });
    }

    return res.json({
      success: true,
      mode: replace ? 'replace' : 'add',
      projectKey,
      environment,
      allowedClientIds,
      readOnlyClientIds,
      requestDetails: authReqDetails,
      responseDetails: authResDetails,
    });
  } catch (err) {
    return res.status(504).json({ error: err.message || 'CPS auth update failed' });
  }
});

/* ── POST /api/cps/credentials/test ─────────────────────────────────────────
   Test a CPS credential pair without saving it to the session.
   Useful for verifying credentials before writing properties.

   Body: { baseUrl, clientId, clientSecret, environment, projectKey? }
   Response: { valid, statusCode, message }
*/
router.post('/credentials/test', authMiddleware, async (req, res) => {
  const { baseUrl, clientId, clientSecret, environment, projectKey } = req.body || {};

  if (!baseUrl || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'baseUrl, clientId, and clientSecret are required' });
  }

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const url = `${cleanBaseUrl}/api/v2/properties/non-secure`;

  try {
    const r = await axios.get(url, {
      headers: { client_id: clientId, client_secret: clientSecret, 'Content-Type': 'application/json' },
      params: { environment: environment || 'prod', keys: projectKey || '' },
      timeout: 10000,
      validateStatus: () => true,
    });

    if (r.status === 401) {
      return res.json({ valid: false, statusCode: 401, message: 'Invalid credentials — check your client_id and client_secret' });
    }
    if (r.status === 403) {
      return res.json({ valid: false, statusCode: 403, message: 'Insufficient permissions — credentials are valid but do not have access to this CPS server' });
    }
    if (r.status === 200) {
      return res.json({ valid: true, statusCode: 200, message: 'Connected successfully — credentials are valid' });
    }
    // Other non-401/403/200 statuses (e.g. 404, 500) — treat as connectivity success but note the status
    return res.json({ valid: true, statusCode: r.status, message: `Connected (HTTP ${r.status}) — credentials are accepted` });
  } catch (err) {
    const msg = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
      ? 'CPS server unreachable — request timed out after 10s'
      : err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN'
      ? 'CPS server unreachable — DNS resolution failed'
      : err.message || 'CPS connectivity test failed';
    return res.json({ valid: false, statusCode: 0, message: msg });
  }
});

/* ── POST /api/cps/binary ────────────────────────────────────────────────────
   Upload a binary file to CPS.

   Unlike JSON property routes, binaries use:
     Content-Type: application/octet-stream
     Custom headers: key (filename), environment
     Body: raw binary bytes

   Body (multipart handled by Express — file bytes forwarded directly):
   {
     baseUrl      string   CPS server base URL
     environment  string   CPS environment prefix
     key          string   Binary filename  e.g. "api-httplistener.jks"
     bgOrgId      string   Business Group org ID
   }
   Plus the raw binary body in req.rawBody (set via custom middleware) OR
   the request streams the body directly.

   ⚠️  Because Express parses JSON bodies globally, we need the raw buffer.
       The frontend must send this as a FormData / Blob where the binary is
       attached, then the backend reads req.body.fileData (base64) and
       converts it to a Buffer before forwarding to CPS.

   Frontend sends: { baseUrl, environment, key, bgOrgId, fileData: base64String }
*/
router.post('/binary', authMiddleware, async (req, res) => {
  const { baseUrl, environment, key: fileName, bgOrgId, fileData } = req.body || {};

  if (!baseUrl || !environment || !fileName) {
    return res.status(400).json({ error: 'baseUrl, environment, and key (filename) are required' });
  }
  if (!fileData) {
    return res.status(400).json({ error: 'fileData (base64-encoded binary content) is required' });
  }

  const envType = detectEnvType(baseUrl, environment, '');
  const chType = detectChType('');
  const creds = getCredentials(req, baseUrl, bgOrgId, envType, chType);
  if (!creds) {
    return res.status(422).json({ error: 'CPS credentials not configured', needsConfig: true });
  }

  // Decode base64 → Buffer
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fileData, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid fileData — must be a valid base64-encoded string' });
  }

  const cleanBaseUrl = normaliseUrl(baseUrl);
  const fullUrl = `${cleanBaseUrl}/api/v2/binaries/secure`;

  console.info(`[CPS Binary] user=${req.session?.username || 'unknown'} op=UPLOAD file=${fileName} env=${environment} base=${cleanBaseUrl} size=${fileBuffer.length}`);

  try {
    const response = await axios.post(fullUrl, fileBuffer, {
      headers: {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        'Content-Type': 'application/octet-stream',
        key: fileName,
        environment,
      },
      timeout: 60000, // binaries can be large — 60s timeout
      validateStatus: () => true,
      maxBodyLength: 50 * 1024 * 1024, // 50MB max
      maxContentLength: 50 * 1024 * 1024,
    });

    const binReqDetails = {
      method: 'POST', url: fullUrl,
      headers: { 'Content-Type': 'application/octet-stream', key: fileName, environment },
      body: `[Binary data: ${fileBuffer.length} bytes]`,
    };
    const binResDetails = { status: response.status, body: response.data };

    if (response.status >= 400) {
      const errMsg = response.data?.message || response.data?.error
        || `CPS binary upload failed with HTTP ${response.status}`;
      console.error(`[CPS Binary] Upload failed (${response.status}): ${errMsg}`);
      return res.status(response.status).json({
        error: errMsg,
        requestDetails: binReqDetails, responseDetails: binResDetails,
      });
    }

    return res.json({
      success: true,
      uploaded: fileName,
      environment,
      sizeBytes: fileBuffer.length,
      requestDetails: binReqDetails,
      responseDetails: binResDetails,
    });
  } catch (err) {
    const msg = err.code === 'ECONNABORTED' ? 'CPS binary upload timed out' : err.message;
    console.error(`[CPS Binary] Network error for ${fullUrl}: ${msg}`);
    return res.status(504).json({ error: msg });
  }
});

router.detectEnvType = detectEnvType;
router.detectChType = detectChType;
router.getCredentials = getCredentials;
router.normaliseUrl = normaliseUrl;

module.exports = router;
