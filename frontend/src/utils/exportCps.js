import * as XLSX from 'xlsx';
import api from '../services/api';

const SECRET_PATTERNS = /password|secret|passwd|token|credential|\.key$|keypassword|keystorepassword|truststore\.password|ssl\.password|msk\.password/i;

function isSecretKey(k) {
  return SECRET_PATTERNS.test(k);
}

function maskSecrets(props) {
  const result = {};
  for (const [k, v] of Object.entries(props || {})) {
    result[k] = isSecretKey(k) ? '****' : v;
  }
  return result;
}

function propsToString(props) {
  return Object.entries(props || {})
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

function extractHosts(props) {
  const hostKeys = ['https.host', 'http.host', 'host', 'hostname'];
  for (const k of hostKeys) {
    if (props[k]) return props[k];
  }
  return '';
}

function extractApiUsers(props) {
  const userPairs = [];
  for (const [k, v] of Object.entries(props || {})) {
    // Match keys that end in username/user/login/email with or without dot prefix
    if (/(^|\.)username$/i.test(k) || /(^|\.)user$/i.test(k) || /(^|\.)login$/i.test(k) || /(^|\.)email$/i.test(k)) {
      if (!isSecretKey(String(v))) userPairs.push(`${k}:${v}`);
    }
  }
  return userPairs.join(',');
}

function extractHostsSecure(props) {
  const hostPairs = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v !== 'string' || !v || isSecretKey(k)) continue;
    // Match host, endpoint, url, domain, servers, server, address
    if (/(^|\.)+(host|endpoint|url|domain|servers|server|address|bootstrap\.servers)$/i.test(k)) {
      hostPairs.push(`${k}:${v}`);
    }
  }
  return hostPairs.join(',');
}

function normalisePropsArray(raw, appKey) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.responses)) return raw.responses;
  if (Array.isArray(raw?.properties)) {
    // Could be wrapper or flat array of entries
    return raw.properties.every(p => p.key) ? raw.properties : [{ key: appKey, properties: raw.properties }];
  }
  if (raw && typeof raw === 'object') {
    return [{ key: appKey, properties: raw }];
  }
  return [];
}

/**
 * Fetch CPS data for a single app.
 * Returns { nonSecure, secureGroups } or throws.
 */
const isMasked = (v) => !v || /^\*+$/.test(String(v).trim());

async function fetchAppCps(app, cpsBaseUrl, bgOrgId, cpsEnvOverride, getCredential, getAllCredentials) {
  const isCh2 = app.deploymentType === 'CloudHub 2.0';
  const depType = isCh2 ? 'ch2' : 'ch1';

  // Step 1: Fetch full app details — get runtime properties AND schedulers in one call
  let runtimeProps = {};
  let schedulers = [];
  let staticIPList = [];
  // Use app-specific bgId if available (set when building apps from BG/Env selector)
  const effectiveBgOrgId = app._bgId || bgOrgId;
  try {
    const envId = app.environment?.id;
    if (isCh2) {
      const res = await api.get(`/applications/cloudhub2/${effectiveBgOrgId}/${envId}/${app.id}`);
      const cfg = res.data?.application?.configuration || {};
      const propsSvc = cfg['mule.agent.application.properties.service'] || {};
      const ds = res.data?.target?.deploymentSettings || {};
      runtimeProps = {
        ...propsSvc.properties,
        ...ds.properties,
        ...ds.environmentVariables,
        ...ds.environmentVars,
        ...res.data?.properties
      };
      // CH2 static IPs:
      // If deployed to a Private Space (targetId is a UUID), fetch outboundStaticIps from Private Spaces API.
      // Otherwise (Shared Space, targetId is a region name), fall back to replica list.
      const targetId = res.data?.target?.targetId || '';
      const isPrivateSpace = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
      if (isPrivateSpace) {
        try {
          const psRes = await api.get(`/applications/private-spaces/${effectiveBgOrgId}/${targetId}`);
          const outboundIPs = psRes.data?.network?.outboundStaticIps || [];
          if (Array.isArray(outboundIPs)) staticIPList = outboundIPs.filter(Boolean);
        } catch { /* not a private space or no access — fall through */ }
      }
      // Fallback: replica list (shared space or private space fetch failed)
      if (!staticIPList.length) {
        const replicaList = res.data?.replicas || [];
        staticIPList = replicaList.map(r => r.ipAddress || r.publicIpAddress).filter(Boolean);
      }
      // CH2 schedulers from dedicated endpoint — returns { items: [{flowName, type, expression, enabled}] }
      try {
        const schedRes = await api.get(`/applications/cloudhub2/${effectiveBgOrgId}/${envId}/${app.id}/schedulers`);
        schedulers = schedRes.data?.items || schedRes.data?.schedulers || (Array.isArray(schedRes.data) ? schedRes.data : []);
      } catch { /* no schedulers */ }
    } else {
      const res = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: effectiveBgOrgId } });
      runtimeProps = res.data?.properties || {};
      // CH1 static IPs — try dedicated endpoint first
      try {
        const sipRes = await api.get(`/applications/cloudhub1/${envId}/${app.id}/static-ips`, { params: { orgId: effectiveBgOrgId } });
        const sipArr = Array.isArray(sipRes.data) ? sipRes.data
          : (sipRes.data?.staticIps || sipRes.data?.staticIPs || sipRes.data?.items || []);
        staticIPList = sipArr.map(s => typeof s === 'string' ? s : (s.ipAddress || s.staticIPAddress || s.address || s.ip)).filter(Boolean);
      } catch { /* 404 or other — will check inline fields below */ }
      // Fallback: inline fields on the main app detail response
      // (this is what the Application Detail Page uses when /static-ips returns 404)
      if (!staticIPList.length) {
        const rawIPs = res.data?.staticIPs || res.data?.staticIps || res.data?.staticIPAddresses || res.data?.ipAddresses || [];
        if (Array.isArray(rawIPs)) staticIPList = rawIPs.map(s => typeof s === 'string' ? s : (s.ipAddress || s.address || s.ip)).filter(Boolean);
      }
      // CH1 schedulers from dedicated endpoint
      try {
        const schedRes = await api.get(`/applications/cloudhub1/${envId}/${app.id}/schedules`, { params: { orgId: effectiveBgOrgId } });
        schedulers = Array.isArray(schedRes.data) ? schedRes.data : (schedRes.data?.schedules || []);
      } catch { /* no schedulers */ }
    }
  } catch { /* fall back to summary data */ }

  const allProps = { ...runtimeProps, ...(app.runtimeProps || {}), ...(app.properties || {}) };

  // CPS URL and env always come from the app's own ARM runtime properties.
  // The modal's URL/env fields are NOT used — they are for display only.
  const cpsEnv = allProps['cps.prefix'] || allProps['cps.environment'] || 'prod';
  // cps.projectName is the authoritative CPS key — NOT the app name or app.id
  const cpsKey = allProps['cps.projectName'] || allProps['cloudhub.api.name'] || app.name;

  const effectiveCpsBaseUrl = allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'];
  if (!effectiveCpsBaseUrl) throw new Error(`No CPS URL in runtime properties for "${app.name}"`);

  const normUrl = effectiveCpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');

  // ── Per-app credential resolution ────────────────────────────────────────
  // Strategy 1: get the specific cps.clientId from ARM props → look up secret in CSV
  // Strategy 2 (fallback): masked / not in CSV → post all CSV creds as url::clientId entries
  const cpsClientId = allProps['cps.clientId'] || allProps['cps.client_id'] ||
                      allProps['cps.client.id'] || allProps['cps.apiClientId'] || '';

  if (cpsClientId && !isMasked(cpsClientId) && getCredential) {
    const secret = getCredential(cpsClientId);
    if (secret) {
      const credMap = {
        [`${normUrl}::${effectiveBgOrgId}`]: { clientId: cpsClientId, clientSecret: secret },
        [normUrl]: { clientId: cpsClientId, clientSecret: secret },
      };
      if (getAllCredentials) {
        const allCreds = getAllCredentials();
        for (const { clientId, clientSecret } of allCreds) {
          if (clientId !== cpsClientId) {
            credMap[`${normUrl}::${clientId}`] = { clientId, clientSecret };
          }
        }
      }
      try { await api.post('/cps/credentials', { credentials: credMap }); } catch { /* non-fatal */ }
    } else if (getAllCredentials) {
      // Specific clientId not in CSV — fall back to all credentials
      const allCreds = getAllCredentials();
      if (allCreds.length) {
        const credMap = {};
        for (const { clientId, clientSecret } of allCreds) credMap[`${normUrl}::${clientId}`] = { clientId, clientSecret };
        try { await api.post('/cps/credentials', { credentials: credMap }); } catch { /* non-fatal */ }
      }
    }
  } else if (getAllCredentials) {
    // clientId is masked or absent — post all as url::clientId fallback entries
    const allCreds = getAllCredentials();
    if (allCreds.length) {
      const credMap = {};
      for (const { clientId, clientSecret } of allCreds) credMap[`${normUrl}::${clientId}`] = { clientId, clientSecret };
      try { await api.post('/cps/credentials', { credentials: credMap }); } catch { /* non-fatal */ }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Fetch non-secure — throw on error so the caller can record it in the export
  const nsRes = await api.get('/cps/fetch', { params: {
    baseUrl: normUrl, type: 'non-secure', environment: cpsEnv,
    keys: cpsKey, deploymentType: depType, bgOrgId: effectiveBgOrgId
  }});
  const nsRaw = nsRes.data;

  // Debug: log raw response to console
  console.log(`[CPS Export] app="${app.name}" key="${cpsKey}" env="${cpsEnv}" rawResponse:`, JSON.stringify(nsRaw).substring(0, 500));

  const arr = normalisePropsArray(nsRaw, cpsKey);
  const match = arr.find(p => p.key === cpsKey) || arr[0];
  const inner = match?.properties || match;
  let flatNs = (inner && typeof inner === 'object' && !Array.isArray(inner)) ? inner : {};

  // If flatNs is still empty, the response structure is unexpected — store raw response for debugging
  if (Object.keys(flatNs).length === 0) {
    throw new Error(`Empty properties for "${cpsKey}". Raw response: ${JSON.stringify(nsRaw).substring(0, 300)}`);
  }

  const secureKeyStr = flatNs['cps.secure.properties'] || '';
  const secureKeys = secureKeyStr.split(',').map(s => s.trim()).filter(Boolean);

  // Fetch secure groups
  const secureGroups = [];
  if (secureKeys.length > 0) {
    try {
      const sr = await api.get('/cps/fetch', { params: {
        baseUrl: normUrl, type: 'secure', environment: cpsEnv,
        keys: secureKeyStr, deploymentType: depType, bgOrgId: effectiveBgOrgId
      }});
      const raw = sr.data;
      const arr = normalisePropsArray(raw, secureKeys[0]);
      for (const entry of arr) {
        secureGroups.push({ key: entry.key, properties: entry.properties || {} });
      }
    } catch { /* secure fetch failed */ }
  }

  return { flatNs, secureGroups, cpsEnv, cpsKey, schedulers, allProps, staticIPList };
}

// ── Row builder (shared between sequential and batch paths) ─────────────
function buildRows(app, fetchResult, allPropsRows, hostApiRows, scheduleRows, staticIPsRows) {
  const { flatNs, secureGroups, schedulers: fetchedSchedulers, allProps: fetchedAllProps, staticIPList: fetchedStaticIPs } = fetchResult;
  const staticIPsEnabled = app.staticIPsEnabled != null ? (app.staticIPsEnabled ? 'Yes' : 'No') : '—';
  const staticIPs = fetchedStaticIPs?.length > 0 ? fetchedStaticIPs.join(', ') : '—';
  const cloudhubVersion = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
  const appStatus = app.status || '—';
  const hostsNonSecure = extractHosts(flatNs);

  const flatSecure = {};
  for (const g of secureGroups) Object.assign(flatSecure, g.properties || {});

  const resolveProp = (val) => {
    if (!val) return val;
    const m = String(val).match(/^\$\{(.+)\}$/);
    if (m) {
      const key = m[1];
      return flatNs[key] || flatSecure[key] || (fetchedAllProps && fetchedAllProps[key]) || val;
    }
    return val;
  };

  const schedEnv = app._envName || app.environment?.name || '—';
  for (const s of (fetchedSchedulers || [])) {
    const innerSchedulers = Array.isArray(s.schedulers) ? s.schedulers : [];
    const cronSched = innerSchedulers.find(x => /cron/i.test(x.type || '')) || innerSchedulers[0];
    const fixedSched = innerSchedulers.find(x => /fixed/i.test(x.type || '')) || null;
    const rawCron = cronSched?.expression || s.schedule?.cronExpression || s.schedule?.expression || s.cronExpression || s.expression || s.schedulerConfig?.cronExpression || s.schedulerConfig?.expression || '';
    const rawPeriod = fixedSched?.period || fixedSched?.frequency || s.schedule?.period || s.schedule?.frequency || s.frequency || s.period || '';
    const rawTimeUnit = fixedSched?.timeUnit || s.schedule?.timeUnit || s.timeUnit || '';
    const rawTimeZone = cronSched?.timeZone || s.schedule?.timeZone || s.timeZone || '';
    scheduleRows.push({
      environment: schedEnv,
      apiDomainName: app.name,
      scheduleName: s.flow || s.flowName || s.name || s.schedulerName || '',
      enabled: s.enabled !== false ? 'true' : 'false',
      scheduleCronExpression: resolveProp(rawCron),
      scheduleTimeZone: resolveProp(rawTimeZone),
      scheduleTimeUnit: resolveProp(rawTimeUnit),
      schedulePeriod: String(resolveProp(String(rawPeriod)))
    });
  }

  const environment = app._envName || app.environment?.name || '—';

  // Splunk AWS Firehose access key — sourced from ARM runtime properties (not CPS)
  const splunkAccessKeyId = fetchedAllProps?.['splunk.aws.firehose.accessKeyId'] || '';

  if (secureGroups.length === 0) {
    allPropsRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: flatNs['cps.secure.properties'] || '', properties: '', splunkAccessKeyId });
    hostApiRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: flatNs['cps.secure.properties'] || '', hostsSecure: '', apiUsers: '', notAccessible: '' });
  } else {
    for (const group of secureGroups) {
      const maskedSec = maskSecrets(group.properties);
      allPropsRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: group.key, properties: propsToString(maskedSec), splunkAccessKeyId });
      hostApiRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: group.key, hostsSecure: extractHostsSecure(group.properties), apiUsers: extractApiUsers(group.properties), notAccessible: '' });
    }
  }
  // One row per app in the dedicated StaticIPs sheet
  if (staticIPsRows) {
    staticIPsRows.push({
      apiName: app.name,
      environment: app._envName || app.environment?.name || '—',
      cloudhubVersion,
      appStatus,
      staticIPsEnabled,
      staticIPs,
    });
  }
}

function buildErrorRow(app, e, allPropsRows, hostApiRows) {
  const environment = app._envName || app.environment?.name || '—';
  const cloudhubVersion = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
  const appStatus = app.status || '—';
  const msg = `ERROR: ${e.response?.data?.error || e.message}`;
  allPropsRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure: '', cpsSecureKey: '', properties: msg, splunkAccessKeyId: '' });
  hostApiRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure: '', cpsSecureKey: '', hostsSecure: '', apiUsers: '', notAccessible: msg });
}

/**
 * Main export function — processes apps in parallel batches for speed.
 * @param {Array}    apps             - list of apps from /applications/summary
 * @param {string}   bgOrgId          - selected BG org ID
 * @param {string}   cpsBaseUrl       - CPS server base URL override (per-app URL takes priority)
 * @param {string}   cpsEnvOverride   - CPS environment override (per-app cps.prefix takes priority)
 * @param {Function} onProgress       - callback(current, total, label)
 * @param {Function} getCredential    - (clientId) => secret | null
 * @param {Function} getAllCredentials - () => [{clientId, clientSecret}]
 * @param {number}   batchSize        - parallel concurrency per batch (default 10)
 */
export async function exportCpsProperties({ apps, bgOrgId, bgName, envName, cpsBaseUrl, cpsEnvOverride, onProgress, getCredential, getAllCredentials, batchSize = 10 }) {
  const allPropsRows = [];
  const hostApiRows = [];
  const scheduleRows = [];
  const staticIPsRows = [];

  const total = apps.length;
  const totalBatches = Math.ceil(total / batchSize);

  // ── Parallel batch processing ──────────────────────────────────────────
  // Pre-allocate results array to preserve original app order after batches run in parallel
  const results = new Array(total);
  let done = 0;

  for (let i = 0; i < total; i += batchSize) {
    const batchApps = apps.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    const settled = await Promise.allSettled(
      batchApps.map(app => fetchAppCps(app, cpsBaseUrl, bgOrgId, cpsEnvOverride, getCredential, getAllCredentials))
    );

    settled.forEach((outcome, j) => {
      results[i + j] = { app: batchApps[j], outcome };
      done++;
    });

    onProgress?.(done, total, `Batch ${batchNum}/${totalBatches} complete (${done}/${total} apps)`);
  }
  // ── Build rows in original order ───────────────────────────────────────

  for (const { app, outcome } of results) {
    if (!app) continue;
    if (outcome.status === 'fulfilled') {
      try {
        buildRows(app, outcome.value, allPropsRows, hostApiRows, scheduleRows, staticIPsRows);
      } catch (e) {
        buildErrorRow(app, e, allPropsRows, hostApiRows);
        const siEnabled = app.staticIPsEnabled != null ? (app.staticIPsEnabled ? 'Yes' : 'No') : '—';
        const siVer = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
        staticIPsRows.push({ apiName: app.name, environment: app._envName || app.environment?.name || '—', cloudhubVersion: siVer, appStatus: app.status || '—', staticIPsEnabled: siEnabled, staticIPs: '—' });
      }
    } else {
      buildErrorRow(app, outcome.reason, allPropsRows, hostApiRows);
      const siEnabled = app.staticIPsEnabled != null ? (app.staticIPsEnabled ? 'Yes' : 'No') : '—';
      const siVer = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
      staticIPsRows.push({ apiName: app.name, environment: app._envName || app.environment?.name || '—', cloudhubVersion: siVer, appStatus: app.status || '—', staticIPsEnabled: siEnabled, staticIPs: '—' });
    }
  }

  // ── Export as Excel (.xlsx) with 3 sheets ─────────────────────────────
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(allPropsRows, {
    header: ['environment', 'apiName', 'cloudhubVersion', 'splunkAccessKeyId', 'appStatus', 'hostsNonSecure', 'cpsSecureKey', 'properties']
  });
  XLSX.utils.book_append_sheet(wb, ws1, 'AllPropertiesCatalog');

  const ws2 = XLSX.utils.json_to_sheet(hostApiRows, {
    header: ['environment', 'apiName', 'cloudhubVersion', 'appStatus', 'hostsNonSecure', 'cpsSecureKey', 'hostsSecure', 'apiUsers', 'notAccessible']
  });
  XLSX.utils.book_append_sheet(wb, ws2, 'Host_APIUsersCatalog');

  const ws3 = XLSX.utils.json_to_sheet(scheduleRows, {
    header: ['environment', 'apiDomainName', 'scheduleName', 'enabled', 'scheduleCronExpression', 'scheduleTimeZone', 'scheduleTimeUnit', 'schedulePeriod']
  });
  XLSX.utils.book_append_sheet(wb, ws3, 'ScheduleCatalog');

  // Sheet 4: StaticIPsCatalog — one row per app, includes env + CloudHub version + status
  const ws4 = XLSX.utils.json_to_sheet(staticIPsRows, {
    header: ['apiName', 'environment', 'cloudhubVersion', 'appStatus', 'staticIPsEnabled', 'staticIPs']
  });
  XLSX.utils.book_append_sheet(wb, ws4, 'StaticIPsCatalog');

  const date = new Date().toISOString().split('T')[0];
  const safeName = (s) => (s || '').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const envPart = safeName(envName);
  const filename = ['CPS-Properties', envPart, date].filter(Boolean).join('-') + '.xlsx';
  XLSX.writeFile(wb, filename);
}
