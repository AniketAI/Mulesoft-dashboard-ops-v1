const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const {
  isProductionEnv,
  parseCH2Apps,
  normalizeStatus,
  makeCh1Headers,
} = require('../utils/appHelpers');
const { sendProxyError } = require('../utils/responseHelpers');

// ── Application-summary in-memory cache ──────────────────────────────────────
//
// WHY in-memory and not SQLite?
//   • App status changes every few minutes — persistence across restarts adds
//     no value (data would be stale anyway on the next boot).
//   • Map.get() is ~0.01 ms; a SQLite read is 1–10 ms + JSON.parse overhead.
//   • The bottleneck is the Anypoint API fan-out (dozens of parallel HTTP calls),
//     not the cache lookup — shaving 1 ms from the read path is irrelevant.
//   • SQLite is the right home for operational history (→ ping_history), not
//     for a hot read-path cache with a 3-min freshness window.
//
// WHY keyed by orgId (not sessionId)?
//   • Old code: globalSummaryCache[sessionId][orgId] — 10 users from the same
//     org triggered 10 separate full Anypoint fan-outs and held 10 copies of
//     the same data in memory.  Dead sessions were never evicted → memory leak.
//   • New code: summaryCache[orgId] — all users of the same org share one entry.
//     The Anypoint token used to populate the cache belongs to whoever triggered
//     the first fetch; subsequent users read the already-cached result instantly.
//   • Security: the cache key IS the orgId, so users of org-A never receive
//     org-B data.  The Anypoint token enforces row-level access at fetch time.
//
// TTL constants
//   FRESH_MS  (3 min)  — serve instantly, no network call
//   TTL_MS    (20 min) — hard eviction via NodeCache stdTTL + checkperiod
//   SWR window = FRESH_MS … TTL_MS: serve stale data + trigger background refresh

const SUMMARY_CACHE_TTL_MS  = 20 * 60 * 1000; // 20 min hard eviction
const SUMMARY_CACHE_FRESH_MS =  3 * 60 * 1000; // 3 min SWR freshness threshold

const summaryCache = new NodeCache({
  stdTTL:      SUMMARY_CACHE_TTL_MS / 1000,  // NodeCache uses seconds
  checkperiod: 5 * 60,                        // sweep for expired keys every 5 min
  useClones:   false,                         // skip deep-copy on read — safe because
                                              // we never mutate cached objects
});

// Thundering-herd guard: if multiple requests arrive for the same org while the
// cache is cold, they all share the single in-flight Promise instead of each
// firing an independent Anypoint fan-out.
const inflightSummary = new Map(); // orgId → Promise<responseData>

// Get all applications for an environment (CloudHub 2.0)
router.get('/cloudhub2/:orgId/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 50, offset = 0 } = req.query;
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${req.params.orgId}/environments/${req.params.envId}/deployments`,
      { params: { limit, offset } }
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch CloudHub 2.0 applications');
  }
});

// Get a specific CloudHub 2.0 application — enriched with properties from separate endpoint
router.get('/cloudhub2/:orgId/:envId/:deploymentId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { orgId, envId, deploymentId } = req.params;

    // Fetch main deployment detail
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`
    );
    const deployment = response.data;

    // Try to fetch application properties from dedicated endpoint
    let extraProps = null;
    try {
      const propsRes = await client.get(
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/settings`
      );
      extraProps = propsRes.data;
    } catch { /* not all apps have this endpoint */ }

    // Merge extra props into the deployment response if found
    if (extraProps) {
      deployment._settings = extraProps;
    }

    res.json(deployment);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application');
  }
});

// Get CloudHub 2.0 app schedulers
router.get('/cloudhub2/:orgId/:envId/:deploymentId/schedulers', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { orgId, envId, deploymentId } = req.params;
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/schedulers`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch schedulers');
  }
});

// Trigger a CloudHub 2.0 scheduler to run immediately (Run Now)
router.post('/cloudhub2/:orgId/:envId/:deploymentId/schedulers/:schedulerName/run', authMiddleware, async (req, res) => {
  const { orgId, envId, deploymentId, schedulerName } = req.params;
  const client = createClient(req.anypointToken);
  try {
    const response = await client.post(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/schedulers/${encodeURIComponent(schedulerName)}/run`
    );
    return res.json({ success: true, schedulerName, data: response.data });
  } catch (error) {
    sendProxyError(res, error, `Failed to trigger scheduler "${schedulerName}"`);
  }
});

// Get all CloudHub 1.0 applications
router.get('/cloudhub1/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get('/cloudhub/api/applications', {
      headers: makeCh1Headers(req.params.envId, orgId),
    });
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch CloudHub 1.0 applications');
  }
});

// Get a specific CloudHub 1.0 application
router.get('/cloudhub1/:envId/:appName', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: makeCh1Headers(req.params.envId, orgId),
    });
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch CloudHub 1.0 application');
  }
});

// Get CloudHub 1.0 static IP assignments
// Note: this endpoint returns 404 for apps that don't have the /static-ips API available.
// The frontend handles 404 gracefully by falling back to ipAddresses[] in the main app detail.
router.get('/cloudhub1/:envId/:appName/static-ips', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/static-ips`,
      { headers: makeCh1Headers(req.params.envId, orgId) }
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    // 404 is expected for apps that don't have the static-ips endpoint — log at debug level only
    if (status !== 404) {
      console.error('Error fetching CH1 static IPs:', error.response?.data || error.message);
    }
    res.status(status).json({
      error: error.response?.data?.message || 'Failed to fetch static IPs'
    });
  }
});

// Get CloudHub 1.0 app schedules
router.get('/cloudhub1/:envId/:appName/schedules', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/schedules`,
      { headers: makeCh1Headers(req.params.envId, orgId) }
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch schedules');
  }
});

// Trigger a CloudHub 1.0 scheduler to run immediately (Run Now)
// Strategy 1: POST /cloudhub/api/applications/{appName}/schedules/{scheduleName}/run
// Strategy 2: POST /cloudhub/api/v2/applications/{appName}/schedules/{scheduleName}/run
router.post('/cloudhub1/:envId/:appName/schedules/:scheduleName/run', authMiddleware, async (req, res) => {
  const { envId, appName, scheduleName } = req.params;
  const orgId = req.query.orgId || req.orgId;
  const client = createClient(req.anypointToken);
  const headers = makeCh1Headers(envId, orgId);
  try {
    const response = await client.post(
      `/cloudhub/api/applications/${appName}/schedules/${encodeURIComponent(scheduleName)}/run`,
      {},
      { headers }
    );
    return res.json({ success: true, scheduleName, data: response.data });
  } catch (e1) {
    try {
      const response = await client.post(
        `/cloudhub/api/v2/applications/${appName}/schedules/${encodeURIComponent(scheduleName)}/run`,
        {},
        { headers }
      );
      return res.json({ success: true, scheduleName, data: response.data });
    } catch (e2) {
      console.error(`CH1 schedule trigger failed for ${appName}/${scheduleName}:`, e2.response?.data || e2.message);
      return res.status(e2.response?.status || 500).json({
        error: e2.response?.data?.message || `Failed to trigger scheduler "${scheduleName}"`
      });
    }
  }
});

// Get CloudHub 1.0 app properties
router.get('/cloudhub1/:envId/:appName/properties', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: makeCh1Headers(req.params.envId, orgId),
    });
    const app = response.data;
    res.json({
      appName: req.params.appName,
      properties: app.properties || {},
      workerType: app.workers?.type,
      workers: app.workers?.amount,
      muleVersion: app.muleVersion?.version,
      region: app.region,
      persistentQueues: app.persistentQueues,
      staticIPsEnabled: app.staticIPsEnabled,
      loggingCustomLog4JEnabled: app.loggingCustomLog4JEnabled,
      monitoringEnabled: app.monitoringEnabled
    });
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application properties');
  }
});

// Control action for CloudHub 1.0 (start / stop / restart)
// CH1 API status-change strategies (tried in order):
//   1. POST /cloudhub/api/applications/{domain}/status  { status: 'start'|'stop'|'restart' }
//   2. PUT  /cloudhub/api/applications/{domain}          { status: 'STARTED'|'STOPPED'|'RESTARTED' }
//   3. Restart = stop (strategy 2) → wait 4s → start (strategy 2)
router.post('/cloudhub1/:envId/:appName/action', authMiddleware, async (req, res) => {
  const { envId, appName } = req.params;
  const { action } = req.body; // 'start' | 'stop' | 'restart'
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }
  const orgId = req.query.orgId || req.orgId;
  const client = createClient(req.anypointToken);
  const headers = makeCh1Headers(envId, orgId);

  // Strategy 1: POST .../status with { status: 'start'|'stop'|'restart' }
  // This is the canonical CH1 REST API status-change endpoint
  const strategy1 = async (act) =>
    client.post(`/cloudhub/api/applications/${appName}/status`, { status: act }, { headers });

  // Strategy 2: PUT .../  with { status: 'STARTED'|'STOPPED'|'RESTARTED' }
  const statusMap = { start: 'STARTED', stop: 'STOPPED', restart: 'RESTARTED' };
  const strategy2 = async (act) =>
    client.put(`/cloudhub/api/applications/${appName}`, { status: statusMap[act] || act.toUpperCase() }, { headers });

  // Restart helper: execute a single-action fn for stop, wait, then start
  const doRestart = async (fn) => {
    await fn('stop');
    await new Promise((r) => setTimeout(r, 4000));
    await fn('start');
  };

  // Try strategy 1 first
  try {
    if (action === 'restart') {
      // CH1 may not have a native restart — try direct first, then stop→start
      try {
        await strategy1('restart');
      } catch {
        await doRestart(strategy1);
      }
    } else {
      await strategy1(action);
    }
    return res.json({ success: true, action, appName });
  } catch (e1) {
    // Strategy 1 failed — try strategy 2 (PUT with status field)
    try {
      if (action === 'restart') {
        try {
          await strategy2('restart');
        } catch {
          await doRestart(strategy2);
        }
      } else {
        await strategy2(action);
      }
      return res.json({ success: true, action, appName });
    } catch (e2) {
      console.error(`CH1 action ${action} failed for ${appName}:`, e2.response?.data || e2.message);
      return res.status(e2.response?.status || 500).json({
        error: e2.response?.data?.message || `Failed to ${action} application`
      });
    }
  }
});

// Control action for CloudHub 2.0 (start / stop / restart)
router.post('/cloudhub2/:orgId/:envId/:deploymentId/action', authMiddleware, async (req, res) => {
  const { orgId, envId, deploymentId } = req.params;
  const { action } = req.body; // 'start' | 'stop' | 'restart'
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }
  const client = createClient(req.anypointToken);
  const base = `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;

  try {
    // Try dedicated action endpoint first (POST .../start, .../stop, .../restart)
    const response = await client.post(`${base}/${action}`);
    return res.json({ success: true, action, deploymentId, data: response.data });
  } catch (e1) {
    // Fallback for start/stop: PATCH desiredState
    // Fallback for restart: stop then start (RESTARTED is not a valid desiredState)
    try {
      if (action === 'restart') {
        // CH2 restart = stop → wait → start
        await client.patch(base, { application: { desiredState: 'STOPPED' } });
        await new Promise(r => setTimeout(r, 3000));
        await client.patch(base, { application: { desiredState: 'STARTED' } });
        return res.json({ success: true, action, deploymentId });
      }
      const stateMap = { start: 'STARTED', stop: 'STOPPED' };
      const response = await client.patch(base, {
        application: { desiredState: stateMap[action] }
      });
      return res.json({ success: true, action, deploymentId, data: response.data });
    } catch (e2) {
      console.error(`CH2 action ${action} failed for ${deploymentId}:`, e2.response?.data || e2.message);
      return res.status(e2.response?.status || 500).json({
        error: e2.response?.data?.message || `Failed to ${action} deployment`
      });
    }
  }
});

// Get CH2 Private Space details (includes network.outboundStaticIps)
// targetId is a UUID when deployed to a Private Space (not a region name like cloudhub-us-east-2)
router.get('/private-spaces/:orgId/:privateSpaceId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { orgId, privateSpaceId } = req.params;
    const response = await client.get(
      `/runtimefabric/api/organizations/${orgId}/privatespaces/${privateSpaceId}`
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    if (status !== 404) console.error('Error fetching private space:', error.response?.data || error.message);
    res.status(status).json({ error: error.response?.data?.message || 'Failed to fetch private space' });
  }
});

/**
 * Core fetch-and-cache logic for the application summary.
 * Extracted so it can be called both synchronously (cache miss) and
 * fire-and-forget (SWR background refresh).
 *
 * No longer accepts sessionId — cache is keyed by orgId only.
 * See the cache design notes at the top of this file.
 *
 * @param {object} client      Anypoint HTTP client
 * @param {string} targetOrgId
 * @returns {Promise<object>}  responseData
 */
async function _fetchSummary(client, targetOrgId) {
  const envResponse = await client.get(
    `/accounts/api/organizations/${targetOrgId}/environments`
  );
  const allEnvironments = envResponse.data.data || [];
  const environments = allEnvironments.filter(isProductionEnv);

  const results = [];
  const errors = [];
  const accessibleEnvIds = new Set();

  await Promise.all(environments.map(async (env) => {
    let ch2Accessible = false;
    let ch1Accessible = false;

    try {
      const ch2Response = await client.get(
        `/amc/application-manager/api/v2/organizations/${targetOrgId}/environments/${env.id}/deployments`,
        { params: { limit: 500 } }
      );
      ch2Accessible = true;
      const apps = parseCH2Apps(ch2Response.data);
      apps.forEach((app) => {
        const runtimeStatus = app.application?.status || app.application?.state;
        const deploymentStatus = app.status || app.desiredStatus;
        const effectiveStatus = runtimeStatus || deploymentStatus;
        results.push({
          id: app.id,
          name: app.name,
          status: normalizeStatus(effectiveStatus),
          deploymentStatus: normalizeStatus(deploymentStatus),
          environment: { id: env.id, name: env.name, type: env.type },
          deploymentType: 'CloudHub 2.0',
          lastModifiedDate: app.lastModifiedDate || app.updatedAt,
          muleVersion: app.currentRuntimeVersion || app.lastSuccessfulRuntimeVersion,
          replicas: app.target?.replicas,
        });
      });
    } catch (e) {
      const status = e.response?.status;
      if (status !== 403 && status !== 401) ch2Accessible = true;
      if (status !== 403 && status !== 401) errors.push(`CH2 ${env.name}: ${e.message}`);
    }

    try {
      const ch1Response = await client.get('/cloudhub/api/applications', {
        headers: makeCh1Headers(env.id, targetOrgId),
      });
      ch1Accessible = true;
      const raw = ch1Response.data;
      const ch1Apps = Array.isArray(raw) ? raw : (raw.applications || raw.data || []);
      ch1Apps.forEach((app) => {
        if (!results.find((r) => r.name === (app.domain || app.name))) {
          results.push({
            id: app.domain || app.name,
            name: app.domain || app.name,
            status: normalizeStatus(app.status),
            environment: { id: env.id, name: env.name, type: env.type },
            deploymentType: 'CloudHub 1.0',
            lastModifiedDate: app.lastUpdateTime ? new Date(app.lastUpdateTime).toISOString() : null,
            muleVersion: typeof app.muleVersion === 'string'
              ? app.muleVersion
              : app.muleVersion?.version,
            workers: app.workers,
            staticIPsEnabled: app.staticIPsEnabled ?? null,
          });
        }
      });
    } catch (e) {
      const status = e.response?.status;
      if (status !== 403 && status !== 401) ch1Accessible = true;
      if (status !== 403 && status !== 401) errors.push(`CH1 ${env.name} (${status || 'ERR'}): ${e.response?.data?.message || e.message}`);
    }

    if (ch1Accessible || ch2Accessible) accessibleEnvIds.add(env.id);
  }));

  const accessibleEnvironments = environments.filter(e => accessibleEnvIds.has(e.id));
  const responseData = {
    total: results.length,
    data: results,
    environments: accessibleEnvironments,
    orgId: targetOrgId,
    _errors: errors.length > 0 ? errors : undefined,
    _cachedAt: new Date().toISOString(),
  };

  // Store in NodeCache — TTL eviction is handled automatically by NodeCache's
  // internal checkperiod sweep; no manual cleanup needed.
  summaryCache.set(targetOrgId, { data: responseData, ts: Date.now() });
  //console.log(`[Summary] ${new Date().toISOString()} Cache SET for org ${targetOrgId} (${results.length} apps)`);
  return responseData;
}

// Summary: get apps across all environments for an org
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const targetOrgId = req.params.orgId;
    const forceRefresh = req.query.refresh === 'true';

    // ── NodeCache-backed SWR (Stale-While-Revalidate) ─────────────────────
    //
    // Cache is keyed by orgId — all users of the same org share one entry.
    //
    //  age < FRESH_MS  (3 min)  → serve instantly, no network call
    //  age < TTL_MS   (20 min)  → serve stale data immediately AND trigger a
    //                             silent background refresh — the NEXT request
    //                             will always hit a warm cache
    //  age ≥ TTL_MS             → NodeCache has already evicted the key;
    //                             synchronous fetch (cold cache)
    //
    // Thundering-herd protection: if N requests arrive for the same org
    // while the cache is cold, only ONE Anypoint fan-out is issued — all
    // N callers await the same Promise via inflightSummary.
    // ─────────────────────────────────────────────────────────────────────

    const cached   = summaryCache.get(targetOrgId);      // undefined if evicted
    const ageMs    = cached ? Date.now() - cached.ts : Infinity;
    const isFresh  = ageMs < SUMMARY_CACHE_FRESH_MS;
    const isUsable = cached && ageMs < SUMMARY_CACHE_TTL_MS; // belt-and-suspenders

    if (!forceRefresh && cached && isFresh) {
      // ── Fresh hit — instant response, zero network ───────────────────────
      //console.log(`[Summary] ${new Date().toISOString()} Cache HIT (fresh) for org ${targetOrgId} (age: ${Math.round(ageMs/1000)}s)`);
      return res.json(cached.data);
    }

    if (!forceRefresh && isUsable) {
      // ── Stale-but-usable — respond instantly, refresh in background ──────
      //console.log(`[Summary] ${new Date().toISOString()} Cache HIT (stale) for org ${targetOrgId} (age: ${Math.round(ageMs/1000)}s) — BG refresh started`);
      res.json(cached.data);

      // Only start a background refresh if one isn't already running for this org
      if (!inflightSummary.has(targetOrgId)) {
        const p = _fetchSummary(client, targetOrgId)
          .catch((err) => console.warn(`[Summary] BG refresh failed for org ${targetOrgId}:`, err.message))
          .finally(() => inflightSummary.delete(targetOrgId));
        inflightSummary.set(targetOrgId, p);
      }
      return;
    }

    // ── Cache miss / force-refresh — thundering-herd protected fetch ────────
    //console.log(`[Summary] ${new Date().toISOString()} Cache MISS for org ${targetOrgId} (forceRefresh: ${forceRefresh})`);

    if (!forceRefresh && inflightSummary.has(targetOrgId)) {
      // Another request is already fetching this org — piggyback on it
      //console.log(`[Summary] ${new Date().toISOString()} Piggybacking on in-flight fetch for org ${targetOrgId}`);
      const data = await inflightSummary.get(targetOrgId);
      return res.json(data);
    }

    // First request to trigger the fetch — store promise so others can piggyback
    const p = _fetchSummary(client, targetOrgId)
      .finally(() => inflightSummary.delete(targetOrgId));

    if (!forceRefresh) inflightSummary.set(targetOrgId, p);

    const data = await p;
    res.json(data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application summary');
  }
});

module.exports = router;
