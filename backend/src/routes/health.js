const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { stripDeploymentSuffix } = require('../utils/appHelpers');
const { fetchExchangeAppCreds } = require('../utils/exchangeHelpers');
const { sendProxyError } = require('../utils/responseHelpers');
const db = require('../utils/db');

// Agent that tolerates self-signed / internal-CA certs
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const PING_PATHS = [
  '/api/v1/ping',
  '/api/v2/ping',
  '/v1/ping',        // some PAPIs use /v1/ping without /api prefix
  '/v2/ping',        // some PAPIs use /v2/ping without /api prefix
  '/api/ping',
  '/ping',
];
const PING_TIMEOUT_MS = 30000; // 30 s — some apps (e.g. PAPIs calling Oracle) need more time

/**
 * Returns a domain-qualifier segment to insert between the env slug and
 * "internalapi.sfdcbt.net" for environment families that use a dedicated
 * sub-domain.
 *
 * EI-FI-FINANCIALS-*  →  "fin"
 *   e.g.  app.stage.fin.internalapi.sfdcbt.net
 *
 * Add more rules here as new environment families are discovered.
 */
function getDomainQualifier(normalizedEnvName) {
  // EI-FI-FINANCIALS-* — explicit "FINANCIALS" keyword only
  if (normalizedEnvName.includes('FINANCIALS')) return 'fin';
  return '';
}

/**
 * Build the base URL for a CH1 or CH2 ping.
 *
 * CH1 URL patterns:
 *   Production:     {appName}.internalapi.sfdcbt.net
 *   Non-production: {appName}.stage.internalapi.sfdcbt.net
 *
 * With domain qualifier (e.g. EI-FI-FINANCIALS-* → "fin"):
 *   Production:     {appName}.fin.internalapi.sfdcbt.net
 *   Non-production: {appName}.stage.fin.internalapi.sfdcbt.net
 *
 * isProd is true when envType === 'production' OR envName ends with
 * -PROD / _PROD (orgs whose prod envs are not typed as 'production').
 *
 * @param {string} targetType      'CH1' | 'CH2'
 * @param {string} appName         Application name
 * @param {string} ch2IngressUrl   CH2 ingress URL (may be comma-separated)
 * @param {string} envType         'production' | 'sandbox' | 'design'
 * @param {string} [envName]       Full environment display name e.g. "EI-FI-FINANCIALS-STAGING"
 */
function buildBaseUrl(targetType, appName, ch2IngressUrl, envType, envName) {
  const safe = (appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (targetType === 'CH2' && ch2IngressUrl) {
    const candidates = ch2IngressUrl
      .split(',')
      .map(u => u.trim().replace(/\/+$/, ''))
      .filter(u => /^https?:\/\/.+/.test(u));

    if (candidates.length > 0) {
      const external = candidates.find(u => !u.includes('internalapi'));
      return external || candidates[0];
    }
  }

  // Determine production vs non-production for the CH1 subdomain
  const isProd =
    (envType || '').toLowerCase() === 'production' ||
    /(?:^|[-_ ])prod$/i.test((envName || '').trim());

  // Domain qualifier for special env families (e.g. EI-FI-FINANCIALS-* → "fin")
  const qualifier = getDomainQualifier((envName || '').toUpperCase());

  // CH1 URL structure:
  //   prod, no qualifier:     app.internalapi.sfdcbt.net
  //   prod, with qualifier:   app.fin.internalapi.sfdcbt.net
  //   non-prod, no qualifier: app.stage.internalapi.sfdcbt.net
  //   non-prod, with qual:    app.stage.fin.internalapi.sfdcbt.net
  if (qualifier) {
    return isProd
      ? `https://${safe}.${qualifier}.internalapi.sfdcbt.net`
      : `https://${safe}.stage.${qualifier}.internalapi.sfdcbt.net`;
  }

  return isProd
    ? `https://${safe}.internalapi.sfdcbt.net`
    : `https://${safe}.stage.internalapi.sfdcbt.net`;
}

// ─── POST /api/health/oauth2-token ───────────────────────────────────────────
/**
 * Server-side proxy for OAuth2 client_credentials token requests.
 * Avoids CORS issues when the token endpoint doesn't allow browser origins.
 *
 * Body: { tokenUrl, clientId, clientSecret, grantType?, scope? }
 * Response: { access_token, token_type, expires_in }
 */
router.post('/oauth2-token', authMiddleware, async (req, res) => {
  const { tokenUrl, clientId, clientSecret, grantType = 'client_credentials', scope } = req.body || {};
  if (!tokenUrl || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'tokenUrl, clientId, and clientSecret are required' });
  }
  try {
    const params = new URLSearchParams({ grant_type: grantType, client_id: clientId, client_secret: clientSecret });
    if (scope) params.append('scope', scope);
    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      httpsAgent,
      timeout: 15000,
      validateStatus: () => true,
    });
    if (response.status >= 400) {
      const errMsg = response.data?.error_description || response.data?.error || response.data?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: errMsg, raw: response.data });
    }
    const { access_token, token_type, expires_in } = response.data;
    if (!access_token) {
      return res.status(400).json({ error: 'Token endpoint did not return access_token', raw: response.data });
    }
    console.log(`[oauth2-token] Token fetched from ${tokenUrl} (expires_in=${expires_in})`);
    return res.json({ access_token, token_type: token_type || 'Bearer', expires_in });
  } catch (e) {
    console.error('[oauth2-token] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/health/ping
 */
router.post('/ping', authMiddleware, async (req, res) => {
  const {
    targetType = 'CH1',
    appName,
    ch2IngressUrl,
    clientId,
    clientSecret,
    bearerToken,        // JWT / OAuth2 Bearer token — sends Authorization: Bearer <token>
    transactionId = 'smokeTest',
    queryParams = '',   // optional: "key1=val1&key2=val2" appended to every ping URL
    envType = '',       // 'production' | 'sandbox' | 'design' — selects CH1 domain
    envName = '',       // full env display name e.g. "EI-FI-FINANCIALS-STAGING" — used for domain qualifier
    orgId,
    envId,
    credentialsLabel = '—',
  } = req.body || {};

  if (!appName) {
    return res.status(400).json({ error: 'appName is required' });
  }

  const base = buildBaseUrl(targetType, appName, ch2IngressUrl, envType, envName);

  // Determine prod/non-prod for fallback decisions
  const isProdPing =
    (envType || '').toLowerCase() === 'production' ||
    /(?:^|[-_ ])prod$/i.test((envName || '').trim());

  const qualifier = getDomainQualifier((envName || '').toUpperCase());

  // standardBase fallback strategy:
  //   1. Qualified envs (e.g. .fin.): always add plain internalapi.sfdcbt.net as final fallback
  //   2. Non-prod, no qualifier: add plain internalapi.sfdcbt.net as fallback
  //      (catches edge cases where the env is non-prod but the app lives on the prod domain)
  //   3. Prod, no qualifier: no fallback needed (already using the root domain)
  const standardBase = (() => {
    if (targetType === 'CH2') return null;
    if (qualifier) {
      // e.g. qualified → try both .stage.fin. (primary) and .internalapi. (final fallback)
      return `https://${(appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')}.internalapi.sfdcbt.net`;
    }
    if (!isProdPing) {
      // Non-prod primary is .stage.internalapi. — fallback to plain .internalapi.
      return `https://${(appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-')}.internalapi.sfdcbt.net`;
    }
    return null;
  })();

  // HTTP variant of the qualified base (tried if HTTPS TLS fails on .fin. servers)
  const httpBase = qualifier ? base.replace(/^https:\/\//, 'http://') : null;

  if (qualifier) {
    console.log(`[Ping] Domain qualifier detected: "${qualifier}" (envName="${envName}") → primary base: ${base}`);
    if (httpBase)     console.log(`[Ping] HTTP fallback: ${httpBase} (tried if HTTPS .${qualifier}. TLS fails)`);
    if (standardBase) console.log(`[Ping] Standard fallback: ${standardBase} (tried if ALL .${qualifier}. paths fail)`);
  }

  const outboundHeaders = {
    Accept: 'application/json, */*',
    'Content-Type': 'application/json', // always sent — required by many Mule APIs
    'x-transaction-id': transactionId,
  };
  if (bearerToken) outboundHeaders['Authorization'] = `Bearer ${bearerToken}`;
  if (clientId) outboundHeaders['client_id'] = clientId;
  if (clientSecret) outboundHeaders['client_secret'] = clientSecret;

  console.log('[Ping] Base URL:', base);
  console.log('[Ping] Headers being sent:', {
    'x-transaction-id': transactionId,
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken.slice(0, 20)}… (len ${bearerToken.length})` } : {}),
    ...(clientId ? { client_id: `${clientId.slice(0, 6)}…` } : {}),
    ...(clientSecret ? { client_secret: `${clientSecret.slice(0, 4)}… (len ${clientSecret.length})` } : {}),
  });

  // Build the ordered URL list:
  //   1. HTTPS qualified (.fin.) paths  — tried first (correct URL, prefer HTTPS)
  //   2. HTTP qualified (.fin.) paths   — tried if HTTPS fails (some .fin. servers use HTTP)
  //   3. HTTPS standard paths           — final fallback (no qualifier)
  const urlsToTry = [
    // HTTPS .fin. paths
    ...PING_PATHS.map(p => queryParams ? `${base}${p}?${queryParams}` : `${base}${p}`),
    // HTTP .fin. paths (fallback when HTTPS TLS fails on internal FIN servers)
    ...(httpBase ? PING_PATHS.map(p => queryParams ? `${httpBase}${p}?${queryParams}` : `${httpBase}${p}`) : []),
    // Standard HTTPS paths (no .fin. qualifier — final fallback)
    ...(standardBase ? PING_PATHS.map(p => queryParams ? `${standardBase}${p}?${queryParams}` : `${standardBase}${p}`) : []),
  ];

  // Thresholds for phase-change logging
  const httpsQualifiedCount = PING_PATHS.length;
  const httpQualifiedCount  = httpBase ? PING_PATHS.length * 2 : PING_PATHS.length;
  const qualifiedPathCount = PING_PATHS.length; // number of .fin. paths before fallback starts
  let loggedHttpFallback = false;
  let loggedStandardFallback = false;
  const attempts = [];

  for (let _i = 0; _i < urlsToTry.length; _i++) {
    const url = urlsToTry[_i];

    // Log when switching from HTTPS .fin. → HTTP .fin.
    if (httpBase && _i === httpsQualifiedCount && !loggedHttpFallback) {
      loggedHttpFallback = true;
      console.log(`[Ping] HTTPS .${qualifier}. paths failed — now trying HTTP .${qualifier}.: ${httpBase}`);
    }
    // Log when switching from HTTP .fin. → standard HTTPS
    if (standardBase && _i === httpQualifiedCount && !loggedStandardFallback) {
      loggedStandardFallback = true;
      console.log(`[Ping] All .${qualifier}. paths (HTTPS+HTTP) exhausted — now trying standard fallback: ${standardBase}`);
    }

    const t0 = Date.now();
    console.log(`[Ping] → Trying: ${url}`);

    try {
      const response = await axios.get(url, {
        timeout: PING_TIMEOUT_MS,
        validateStatus: () => true,
        headers: outboundHeaders,
        maxRedirects: 5,
        httpsAgent,
      });

      console.log(`[Ping] ✓ ${url} → HTTP ${response.status} (${Date.now() - t0}ms)`);

      const responseTimeMs = Date.now() - t0;
      const httpStatus = response.status;

      let payload = null;
      try {
        payload = typeof response.data === 'object'
          ? response.data
          : JSON.parse(response.data);
      } catch {
        payload = response.data ? String(response.data).slice(0, 500) : null;
      }

      // Store payload per attempt so the frontend can show the response body for each path tried
      let attemptPayload = null;
      try {
        attemptPayload = typeof response.data === 'object' ? response.data : String(response.data).slice(0, 2000);
      } catch {}
      attempts.push({ url, httpStatus, responseTimeMs, payload: attemptPayload });

      const payloadStr = payload
        ? typeof payload === 'string' ? payload : JSON.stringify(payload)
        : '';

      // Detect responses that mean "this path doesn't exist on the app" —
      // in these cases skip to the next path rather than stopping early.
      //
      // Rules (any of the following → skip):
      //   1. HTTP 404 — path not found on the Mule app
      //   2. Mule "No listener for endpoint" text
      //   3. "No flow" text (older Mule runtimes)
      //   4. "resource not found" text
      //   5. ENDPT_FAILURE text — Mule app-level 404 wrapped inside HTTP 200
      //   6. Structured app-level 404: { "error": [{ "code": "404", "status": "NOT_FOUND" }] }
      const isAppLevel404 = (() => {
        if (!payload || typeof payload !== 'object') return false;
        const errors = Array.isArray(payload.error) ? payload.error
          : (payload.error && typeof payload.error === 'object' ? [payload.error] : []);
        return errors.some(e =>
          String(e?.code) === '404' ||
          e?.status === 'NOT_FOUND' ||
          String(e?.description?.[0]?.message || '').toUpperCase().includes('ENDPT_FAILURE')
        );
      })();

      if (isAppLevel404) {
        console.log(`[Ping] ${url} → 200 but app-level 404 detected (ENDPT_FAILURE/NOT_FOUND) — skipping to next path`);
      }

      const isNoListener =
        httpStatus === 404 ||
        payloadStr.toLowerCase().includes('no listener for endpoint') ||
        payloadStr.toLowerCase().includes('no flow') ||
        payloadStr.toLowerCase().includes('resource not found') ||
        payloadStr.toUpperCase().includes('ENDPT_FAILURE') ||
        isAppLevel404;

      // ── 5xx with meaningful app body → app is reachable (PARTIAL) ────────
      // Some apps return 500 with a rich pingResponse/endpoints body when a
      // downstream service fails — the app itself IS reachable.
      const hasMeaningfulBody = payload && typeof payload === 'object' && (
        payload.pingResponse ||
        payload.endpoints ||
        payload.summary ||
        (Array.isArray(payload.errors) && payload.errors.length > 0)
      );

      if (httpStatus < 500 && !isNoListener) {
        const status =
          httpStatus >= 200 && httpStatus < 300 ? 'SUCCESS' :
          httpStatus >= 400 && httpStatus < 500 ? 'PARTIAL' : 'FAILED';
        const result = { status, activeEndpoint: url, responseTimeMs, httpStatus, payload, attempts };
        
        // Save to DB
        if (orgId && envId) {
          console.log(`[Ping DB] Saving SUCCESS for ${appName} org=${orgId} env=${envId}`);
          db.run(
            `INSERT INTO ping_history (session_id, org_id, env_id, app_name, timestamp, status, response_time_ms, endpoint, payload, env_name, target_type, credentials, http_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.sessionID, orgId, envId, appName, Date.now(), status, responseTimeMs, url, JSON.stringify(payload), envName, targetType, credentialsLabel, httpStatus || null],
            (err) => { if (err) console.error('[ping] Error saving history SUCCESS:', err.message, err); }
          );
        } else {
          console.log(`[Ping DB] Skipping save SUCCESS because orgId or envId missing. orgId=${orgId}, envId=${envId}`);
        }
        
        return res.json(result);
      }

      if (httpStatus >= 500 && !isNoListener && hasMeaningfulBody) {
        console.log(`[Ping] ${url} → ${httpStatus} with meaningful pingResponse body — marking PARTIAL (app reachable, downstream error)`);
        const result = { status: 'PARTIAL', activeEndpoint: url, responseTimeMs, httpStatus, payload, attempts };
        
        // Save to DB
        if (orgId && envId) {
          console.log(`[Ping DB] Saving PARTIAL for ${appName} org=${orgId} env=${envId}`);
          db.run(
            `INSERT INTO ping_history (session_id, org_id, env_id, app_name, timestamp, status, response_time_ms, endpoint, payload, env_name, target_type, credentials, http_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.sessionID, orgId, envId, appName, Date.now(), 'PARTIAL', responseTimeMs, url, JSON.stringify(payload), envName, targetType, credentialsLabel, httpStatus || null],
            (err) => { if (err) console.error('[ping] Error saving history PARTIAL:', err.message, err); }
          );
        } else {
          console.log(`[Ping DB] Skipping save PARTIAL because orgId or envId missing. orgId=${orgId}, envId=${envId}`);
        }

        return res.json(result);
      }
    } catch (err) {
      const responseTimeMs = Date.now() - t0;
      let errorDetail = err.message;

      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        errorDetail = `Timeout after ${PING_TIMEOUT_MS}ms`;
      } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        errorDetail = 'DNS resolution failed — host unreachable';
      } else if (err.code === 'ECONNREFUSED') {
        errorDetail = 'Connection refused';
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        errorDetail = 'SSL certificate error';
      }

      console.log(`[Ping] ✗ ${url} → ${errorDetail} (${responseTimeMs}ms)`);
      attempts.push({ url, error: errorDetail, responseTimeMs, payload: null });
    }
  }

  // Build a human-readable summary of why all paths failed
  const errorTypes = [...new Set(attempts.map(a => a.error).filter(Boolean))];
  let summary = 'All ping paths unreachable';
  if (errorTypes.some(e => e.includes('ECONNREFUSED') || e.includes('Connection refused'))) {
    summary = 'Connection refused — app port is not accepting connections. The app may be stopped or crashed.';
  } else if (errorTypes.some(e => e.includes('Timeout') || e.includes('ETIMEDOUT') || e.includes('ECONNABORTED'))) {
    summary = `Request timed out after ${PING_TIMEOUT_MS / 1000}s — the app may be overloaded, or a firewall/VPC rule is blocking the connection.`;
  } else if (errorTypes.some(e => e.includes('DNS') || e.includes('ENOTFOUND') || e.includes('EAI_AGAIN'))) {
    summary = 'DNS resolution failed — the hostname could not be resolved. Check that the app URL is correct and accessible from this network.';
  } else if (errorTypes.some(e => e.includes('SSL') || e.includes('certificate') || e.includes('CERT_'))) {
    summary = 'SSL/TLS error — the app\'s certificate is expired, self-signed, or untrusted.';
  } else if (attempts.every(a => !a.error && a.httpStatus >= 500)) {
    summary = 'App returned 5xx (server error) on all ping paths — the app is reachable but erroring internally.';
  }

  const result = {
    status: 'FAILED',
    activeEndpoint: null,
    responseTimeMs: null,
    httpStatus: null,
    payload: null,
    attempts,
    error: summary,
  };

  // Save failed ping to DB
  if (orgId && envId) {
    console.log(`[Ping DB] Saving FAILED for ${appName} org=${orgId} env=${envId}`);
    db.run(
      `INSERT INTO ping_history (session_id, org_id, env_id, app_name, timestamp, status, error, env_name, target_type, credentials) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.sessionID, orgId, envId, appName, Date.now(), 'FAILED', summary, envName, targetType, credentialsLabel],
      (err) => { if (err) console.error('[ping] Error saving history FAILED:', err.message, err); }
    );
  } else {
    console.log(`[Ping DB] Skipping save FAILED because orgId or envId missing. orgId=${orgId}, envId=${envId}`);
  }

  return res.json(result);
});

// ─── GET /api/health/ping/history ───────────────────────────────────────────
router.get('/ping/history', authMiddleware, (req, res) => {
  const { orgId, envId, appName } = req.query;
  
  let query = `SELECT * FROM ping_history WHERE session_id = ?`;
  let params = [req.sessionID];

  if (orgId && envId && appName) {
    query += ` AND org_id = ? AND env_id = ? AND app_name = ?`;
    params.push(orgId, envId, appName);
  }

  query += ` ORDER BY timestamp DESC LIMIT 100`; // Limit to 100 for global view

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('[ping/history] Error fetching history:', err.message);
      return res.status(500).json({ error: 'Failed to fetch ping history' });
    }
    const history = rows.map(r => {
      let parsedPayload = null;
      if (r.payload) {
        try { parsedPayload = JSON.parse(r.payload); } catch { parsedPayload = r.payload; }
      }
      return {
        id: r.id,
        timestamp: r.timestamp,
        status: r.status,
        responseTimeMs: r.response_time_ms,
        endpoint: r.endpoint,
        payload: parsedPayload,
        error: r.error,
        appName: r.app_name, // include app_name for global view
        env_name: r.env_name,
        target_type: r.target_type,
        credentials: r.credentials,
        http_status: r.http_status
      };
    });
    return res.json(history);
  });
});

// ─── DELETE /api/health/ping/history ────────────────────────────────────────
router.delete('/ping/history', authMiddleware, (req, res) => {
  const { orgId, envId, appName } = req.query;

  let query = `DELETE FROM ping_history WHERE session_id = ?`;
  let params = [req.sessionID];

  if (orgId && envId && appName) {
    query += ` AND org_id = ? AND env_id = ? AND app_name = ?`;
    params.push(orgId, envId, appName);
  }

  db.run(query, params, (err) => {
    if (err) {
      console.error('[ping/history] Error deleting history:', err.message);
      return res.status(500).json({ error: 'Failed to clear history' });
    }
    return res.json({ success: true });
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a name for fuzzy matching:
 *   - strip deployment/version suffixes (via shared stripDeploymentSuffix)
 *   - replace hyphens / underscores / dots with space
 *   - collapse whitespace
 *
 * Uses stripDeploymentSuffix from appHelpers so the regex rules stay in sync
 * with the Exchange search normalization in exchange.js.
 */
function normalizeName(name) {
  return stripDeploymentSuffix(name)
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMatch(appName, apiLabel) {
  const a = normalizeName(appName);
  const b = normalizeName(apiLabel);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// ─── POST /api/health/auto-credentials ───────────────────────────────────────
/**
 * Foolproof multi-layer strategy to find the API Manager instance for a
 * deployed Mule app and return the clientIds from its APPROVED contracts.
 *
 * Layers 1-3 are implemented here (Layer 4 and 5 are the outer catch-all).
 *
 * Body: { orgId, envId, appName, apiId?, assetId?, apiMgrOrgId? }
 */
router.post('/auto-credentials', authMiddleware, async (req, res) => {
  const { orgId, envId, appName, apiId, assetId, apiMgrOrgId } = req.body || {};

  if (!orgId || !envId || !appName) {
    return res.status(400).json({
      error: 'orgId, envId, and appName are required',
      found: false,
      candidates: [],
    });
  }

  try {
    const client = createClient(req.anypointToken);
    const searchOrgId = (apiMgrOrgId && apiMgrOrgId !== orgId) ? apiMgrOrgId : orgId;

    console.log(`[auto-credentials] Request — appName="${appName}" apiId=${apiId || 'null'} assetId=${assetId || 'null'} org=${searchOrgId} env=${envId}`);

    // ── Shared helpers ──────────────────────────────────────────────────────

    /** Flatten an API Manager list response (assets[] or apis[] shape) into a flat array. */
    function flattenApiResponse(data) {
      const assets = data?.assets;
      if (Array.isArray(assets) && assets.length > 0) {
        return assets.flatMap(asset =>
          (asset.apis || []).map(api => ({
            ...api,
            assetId: api.assetId || asset.assetId,
            asset: {
              assetId: asset.assetId,
              exchangeAssetName: asset.exchangeAssetName || asset.assetId,
              ...(api.asset || {}),
            },
          }))
        );
      }
      const raw = data?.apis || data?.data || [];
      return Array.isArray(raw) ? raw : [];
    }

    /** Fetch ALL API Manager instances for org+env using pagination (100/page). */
    async function fetchAllApisForEnv(oId, eId, filterAssetId) {
      const PAGE = 100;
      let offset = 0;
      let all = [];
      try {
        while (true) {
          const params = { limit: PAGE, offset };
          if (filterAssetId) params.assetId = filterAssetId;
          const r = await client.get(
            `/apimanager/api/v1/organizations/${oId}/environments/${eId}/apis`,
            { params }
          );
          const page = flattenApiResponse(r.data);
          all = all.concat(page);
          const total = r.data?.total ?? page.length;
          if (all.length >= total || page.length < PAGE) break;
          offset += PAGE;
        }
      } catch { /* return what we have so far */ }
      return all;
    }

    /** Fetch approved contracts for one API instance and return normalized rows. */
    async function extractContractClientIds(oId, eId, api) {
      const apiLabel =
        api.instanceLabel ||
        api.asset?.exchangeAssetName ||
        api.asset?.assetId ||
        String(api.id);
      try {
        const r = await client.get(
          `/apimanager/api/v1/organizations/${oId}/environments/${eId}/apis/${api.id}/contracts`
        );
        const raw = r.data?.contracts || r.data || [];
        return (Array.isArray(raw) ? raw : [])
          .filter(c => (c.status || '').toUpperCase() === 'APPROVED')
          .map(c => ({
            clientId:
              c.application?.coreServicesId ||
              c.application?.clientId ||
              c.application?.credentials?.clientId ||
              c.clientApplication?.coreServicesId ||
              c.clientId ||
              c.credentials?.clientId ||
              null,
            apiInstanceName: apiLabel,
            apiInstanceId: api.id,
            contractApp: c.application?.name || 'Unknown',
          }))
          .filter(x => x.clientId);
      } catch (err) {
        console.warn(`[auto-credentials] contracts fetch failed for API ${api.id}:`, err.message);
        return [];
      }
    }

    /** Collect unique clientIds from up to 5 API instances in parallel. */
    async function collectCandidates(oId, eId, matchedApis) {
      const seen = new Set();
      const allCandidates = [];
      const matchInfo = [];
      await Promise.allSettled(
        matchedApis.slice(0, 5).map(async api => {
          const rows = await extractContractClientIds(oId, eId, api);
          for (const row of rows) {
            if (!seen.has(row.clientId)) {
              seen.add(row.clientId);
              allCandidates.push(row.clientId);
              matchInfo.push(row);
            }
          }
        })
      );
      return { allCandidates, matchInfo };
    }

    /** Fuzzy-filter a list of API instances against the app name. */
    function fuzzyMatch(apis) {
      return apis.filter(api => {
        const labels = [
          api.instanceLabel,
          api.asset?.exchangeAssetName,
          api.asset?.assetId,
          api.asset?.name,
          api.assetId,
        ].filter(Boolean);
        return labels.some(l => isMatch(appName, l));
      });
    }

    /** Get all environments for an org. */
    async function getOrgEnvs(oId) {
      try {
        const r = await client.get(`/accounts/api/organizations/${oId}/environments`);
        const list = r.data?.data || r.data?.environments || r.data || [];
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    }

    /** Build a result response and send it. */
    function sendResult(res, allCandidates, matchInfo, matchedApis, layer) {
      console.log(`[auto-credentials] ✅ Layer ${layer} — ${allCandidates.length} clientId(s) for "${appName}"`);
      return res.json({
        found: allCandidates.length > 0,
        candidates: allCandidates,
        matchInfo,
        matchedApis: matchedApis.slice(0, 5).map(a => ({
          id: a.id,
          label: a.instanceLabel || a.asset?.exchangeAssetName || a.asset?.assetId || String(a.id),
        })),
        resolvedLayer: layer,
      });
    }

    // ── LAYER 1: Direct api.id lookup ─────────────────────────────────────
    if (apiId && apiId !== '0') {
      console.log(`[auto-credentials] Layer 1 — direct api.id="${apiId}"`);
      const envIds = [envId, ...(await getOrgEnvs(searchOrgId)).map(e => e.id).filter(id => id !== envId)];
      for (const eid of envIds) {
        try {
          const r = await client.get(
            `/apimanager/api/v1/organizations/${searchOrgId}/environments/${eid}/apis/${apiId}`
          );
          if (r.data?.id) {
            const { allCandidates, matchInfo } = await collectCandidates(searchOrgId, eid, [r.data]);
            if (allCandidates.length > 0) {
              return sendResult(res, allCandidates, matchInfo, [r.data], 1);
            }
          }
        } catch { /* try next env */ }
      }
      console.log('[auto-credentials] Layer 1 — no contracts found, falling through to Layer 2');
    }

    // ── LAYER 2: assetId-filtered paginated search ────────────────────────
    if (assetId) {
      console.log(`[auto-credentials] Layer 2 — assetId-filtered search: "${assetId}"`);
      const apis = await fetchAllApisForEnv(searchOrgId, envId, assetId);
      if (apis.length > 0) {
        const { allCandidates, matchInfo } = await collectCandidates(searchOrgId, envId, apis);
        if (allCandidates.length > 0) {
          return sendResult(res, allCandidates, matchInfo, apis, 2);
        }
      }
      console.log('[auto-credentials] Layer 2 — no contracts found, falling through to Layer 3');
    }

    // ── LAYER 3: Paginated fuzzy name search — deployment env only ────────
    console.log(`[auto-credentials] Layer 3 — paginated fuzzy search in env ${envId}`);
    {
      const apis = await fetchAllApisForEnv(searchOrgId, envId);
      const matched = fuzzyMatch(apis);
      console.log(`[auto-credentials] Layer 3 — ${apis.length} instances, ${matched.length} match(es)`);
      if (matched.length > 0) {
        const { allCandidates, matchInfo } = await collectCandidates(searchOrgId, envId, matched);
        if (allCandidates.length > 0) {
          return sendResult(res, allCandidates, matchInfo, matched, 3);
        }
      }
    }

    // All layers exhausted
    console.log(`[auto-credentials] All layers exhausted — no API Manager instance found for "${appName}"`);
    return res.json({
      found: false,
      candidates: [],
      matchInfo: [],
      matchedApis: [],
      resolvedLayer: null,
      message: 'No matching API Manager instance found. Ensure api.id is stored in CPS non-secure props (*.api.id) or the API Manager instanceLabel matches the app name.',
    });

  } catch (error) {
    sendProxyError(res, error, 'Failed to resolve credentials from API Manager');
  }
});

// ─── POST /api/health/auto-contract-creds ────────────────────────────────────
/**
 * Auto-resolve ping credentials by finding an existing Exchange application
 * owned by the logged-in user and using it to create (or reuse) a contract
 * on the target API instance.
 *
 * Body: { orgId, envId, apiId, envType? }
 * Response: { clientId, clientSecret, contractStatus, appName, appId }
 */
router.post('/auto-contract-creds', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId, envType, envName } = req.body || {};
  if (!orgId || !envId || !apiId) {
    return res.status(400).json({ error: 'orgId, envId, and apiId are required' });
  }

  try {
    const client = createClient(req.anypointToken);

    // 1. List user's Exchange applications
    console.log(`[auto-contract-creds] Listing user apps for org ${orgId}`);
    let userApps = [];
    try {
      const appsRes = await client.get(
        `/exchange/api/v2/organizations/${orgId}/applications`,
        { params: { limit: 50 } }
      );
      userApps = Array.isArray(appsRes.data) ? appsRes.data : (appsRes.data?.applications || appsRes.data?.data || []);
    } catch (e) {
      console.warn('[auto-contract-creds] Could not list user apps:', e.message);
    }

    if (userApps.length === 0) {
      return res.status(404).json({
        error: 'No Exchange applications found for the current user. Create an application in Anypoint Exchange first.',
        contractStatus: 'no-apps'
      });
    }
    console.log(`[auto-contract-creds] Found ${userApps.length} user app(s)`);

    // 2. Fetch existing contracts on this API
    console.log(`[auto-contract-creds] Fetching existing contracts for API ${apiId}`);
    let existingContracts = [];
    try {
      const contractsRes = await client.get(
        `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`
      );
      existingContracts = contractsRes.data?.contracts || contractsRes.data || [];
    } catch (e) {
      console.warn('[auto-contract-creds] Could not fetch contracts:', e.message);
    }

    const userAppIds = new Set(userApps.map(a => String(a.id)));

    // Check for APPROVED contracts from any of the user's apps
    const existingApproved = existingContracts.find(c =>
      (c.status || '').toUpperCase() === 'APPROVED' &&
      userAppIds.has(String(c.application?.id || c.applicationId || ''))
    );

    if (existingApproved) {
      const appId = existingApproved.application?.id || existingApproved.applicationId;
      const appName = existingApproved.application?.name || 'User App';
      console.log(`[auto-contract-creds] Found existing approved contract for app ${appName} (${appId})`);
      const creds = await fetchExchangeAppCreds(client, orgId, appId);
      if (creds.clientId && creds.clientSecret) {
        return res.json({ ...creds, contractStatus: 'approved', appName, appId });
      }
    }

    // Check for PENDING contracts from any of the user's apps from exchange
    const existingPendingAny = existingContracts.find(c =>
      (c.status || '').toUpperCase() !== 'APPROVED' &&
      userAppIds.has(String(c.application?.id || c.applicationId || ''))
    );

    if (existingPendingAny) {
      const appId = existingPendingAny.application?.id || existingPendingAny.applicationId;
      const appName = existingPendingAny.application?.name || 'User App';
      const status = (existingPendingAny.status || 'PENDING').toLowerCase();
      console.log(`[auto-contract-creds] Found existing ${status.toUpperCase()} contract for app ${appName} (${appId}) — returning status only`);
      const creds = await fetchExchangeAppCreds(client, orgId, appId);
      return res.json({ clientId: creds.clientId, clientSecret: creds.clientSecret, contractStatus: status, appName, appId });
    }

    // 3. No existing contract — create one using the most appropriate user app
    // isProd: true when envType is explicitly 'production' OR when the environment
    // NAME ends with -PROD / _PROD (e.g. "MY-ORG-PROD", "COMPANY_PROD").
    // This handles orgs whose prod envs are not typed as 'production' in Anypoint.
    const isProd =
      (envType || '').toLowerCase() === 'production' ||
      /(?:^|[-_ ])prod$/i.test((envName || '').trim());
    console.log(`[auto-contract-creds] isProd=${isProd} (envType="${envType || ''}", envName="${envName || ''}")`);
    const nameLo = (a) => (a.name || '').toLowerCase();

    const targetApp =
      (isProd
        ? userApps.find(a => nameLo(a).includes('prod') && nameLo(a).includes('ping'))
        : userApps.find(a => nameLo(a).includes('stage') && nameLo(a).includes('ping'))
      ) ||
      userApps.find(a => nameLo(a).includes('ping')) ||
      userApps[0];
    const targetAppId = targetApp.id;
    const targetAppName = targetApp.name || 'User App';
    console.log(`[auto-contract-creds] No existing contract found — creating for app "${targetAppName}" (${targetAppId})`);

    // Double-check this specific app doesn't already have a contract (safety net)
    const existingPending = existingContracts.find(c =>
      String(c.application?.id || c.applicationId || '') === String(targetAppId)
    );

    let contractStatus = 'pending';
    if (!existingPending) {
      // Fetch available SLA tiers
      let tierId = null;
      try {
        const tiersRes = await client.get(
          `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/tiers`
        );
        const tiers = tiersRes.data?.tiers || tiersRes.data || [];
        const autoTier = tiers.find(t => t.autoApprove === true) || tiers[0];
        if (autoTier) tierId = autoTier.id;
      } catch { /* no tiers required */ }

      // Build candidate app list: env-type apps first, then ping-only, then rest
      const envTypeApps = userApps.filter(a => isProd
        ? (nameLo(a).includes('prod') && nameLo(a).includes('ping'))
        : (nameLo(a).includes('stage') && nameLo(a).includes('ping'))
      );
      const pingOnlyApps = userApps.filter(a =>
        nameLo(a).includes('ping') &&
        !(isProd
          ? (nameLo(a).includes('prod') && nameLo(a).includes('ping'))
          : (nameLo(a).includes('stage') && nameLo(a).includes('ping'))
        )
      );
      const otherApps2 = userApps.filter(a => !nameLo(a).includes('ping'));

      // Always include the full fallback pool — envType apps are tried first,
      // but if they all fail with IDP conflicts we fall through to ping-only
      // apps and then the rest. Previously the fallback was gated on
      // envTypeApps.length === 0, which meant IDP failures on envType apps
      // caused the contract creation to abort prematurely.
      const seen = new Set([String(targetApp.id)]);
      const candidateApps = [
        targetApp,
        ...envTypeApps.filter(a => !seen.has(String(a.id)) && seen.add(String(a.id))),
        ...pingOnlyApps.filter(a => !seen.has(String(a.id)) && seen.add(String(a.id))),
        ...otherApps2.filter(a => !seen.has(String(a.id)) && seen.add(String(a.id))),
      ];
      console.log(`[auto-contract-creds] Candidate apps (${isProd ? 'PROD' : 'stage'}): ${candidateApps.map(a => a.name).join(', ')}`);
      let created = false;
      let lastErr = null;

      for (const candidateApp of candidateApps) {
        const contractBody = { applicationId: candidateApp.id };
        if (tierId) contractBody.requestedTierId = tierId;
        try {
          const createRes = await client.post(
            `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`,
            contractBody
          );
          contractStatus = (createRes.data?.status || 'pending').toLowerCase();
          console.log(`[auto-contract-creds] Contract created with app "${candidateApp.name}" (${candidateApp.id}), status: ${contractStatus}`);
          Object.assign(targetApp, { id: candidateApp.id, name: candidateApp.name });
          created = true;
          break;
        } catch (createErr) {
          const msg = createErr.response?.data?.message || createErr.message || '';
          const isIdpConflict = msg.toLowerCase().includes('idp') || msg.toLowerCase().includes('identity');
          if (isIdpConflict) {
            console.log(`[auto-contract-creds] IDP conflict for app "${candidateApp.name}" — trying next app`);
            lastErr = createErr;
            continue;
          }
          console.warn('[auto-contract-creds] Could not create contract:', createErr.response?.data || msg);
          return res.status(createErr.response?.status || 500).json({
            error: msg || 'Failed to create contract',
            contractStatus: 'error',
            appName: candidateApp.name,
            appId: candidateApp.id,
          });
        }
      }

      if (!created) {
        const errMsg = lastErr?.response?.data?.message || lastErr?.message || 'All available apps have IDP conflicts with this API instance';
        console.warn('[auto-contract-creds] Could not create contract with any app:', errMsg);
        return res.status(409).json({
          error: errMsg,
          contractStatus: 'error',
          hint: 'The user\'s Exchange applications use a different Identity Provider than this API instance. Manually create a contract in Anypoint Exchange, then use "Auto-fill from API Manager".',
        });
      }
    } else {
      contractStatus = (existingPending.status || 'pending').toLowerCase();
      console.log(`[auto-contract-creds] Contract already exists with status: ${contractStatus}`);
    }

    // 4. Fetch credentials for the user app
    const creds = await fetchExchangeAppCreds(client, orgId, targetAppId);
    return res.json({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      contractStatus,
      appName: targetAppName,
      appId: targetAppId,
    });

  } catch (error) {
    sendProxyError(res, error, 'Failed to auto-resolve contract credentials');
  }
});

module.exports = router;
