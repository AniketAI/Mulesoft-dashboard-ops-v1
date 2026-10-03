/**
 * Shared CPS (Config Property Server) utility helpers.
 *
 * These functions appear in 5+ separate files (ApplicationDetailPage,
 * ApplicationsPage, PingTestPanel, PingTestPage, CpsComparisonPage,
 * exportCps.js).  A single canonical implementation prevents the
 * business logic from drifting independently in each location.
 */

// ── ARM property extraction ───────────────────────────────────────────────────

/**
 * Extract CPS connection configuration from an Anypoint Runtime Manager
 * application detail object.
 *
 * Merges properties from all ARM sources in the same priority order used
 * by the Mule application at runtime:
 *   mule.agent.application.properties.service → target.deploymentSettings → top-level
 *
 * @param {object} appDetail  Raw response from /applications/cloudhub2 or /cloudhub1
 * @returns {{
 *   cpsBaseUrl: string,
 *   cpsKey:     string,
 *   cpsEnv:     string,
 *   cpsClientId:string
 * }}
 */
export function extractCpsConfig(appDetail) {
  if (!appDetail) return { cpsBaseUrl: '', cpsKey: '', cpsEnv: '', cpsClientId: '' };

  const ds      = appDetail.target?.deploymentSettings || {};
  const appCfg  = appDetail.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const rp = {
    ...appDetail.properties,
    ...(propsSvc.properties || {}),
    ...(ds.properties || {}),
    ...(ds.environmentVariables || ds.environmentVars || {}),
  };

  return {
    cpsBaseUrl:  rp['cps.configServerBaseUrl'] || rp['config.server.base.url'] || '',
    cpsKey:      rp['cps.projectName']          || rp['cloudhub.api.name']       || appDetail.name || '',
    cpsEnv:      rp['cps.prefix']               || rp['cps.environment']          || '',
    cpsClientId: rp['cps.clientId'] || rp['cps.client_id'] ||
                 rp['cps.client.id'] || rp['cps.apiClientId'] || '',
  };
}

// ── CPS response normalisation ────────────────────────────────────────────────

/**
 * Flatten a CPS API response (any of the several shapes the server returns)
 * into a single plain `{ key: value }` map.
 *
 * Handles:
 *   1. `{ responses: [{ key, properties: {k:v} }] }`  — actual CPS /non-secure response
 *   2. `[{ key, properties: {k:v} }]`                  — array form
 *   3. `{ properties: [{ key, value }] }`              — array of key/value pairs
 *   4. `{ k: v }`                                      — flat map (rare)
 *
 * @param {any}    data    Raw CPS response body
 * @param {string} [appKey] Project key — used to find the matching entry in arrays
 * @returns {Record<string, any>}
 */
export function flattenCpsResponse(data, appKey) {
  if (!data) return {};

  // Shape 1 / 2: responses or array with { properties } entries
  const arr = Array.isArray(data?.responses) ? data.responses
    : Array.isArray(data?.properties) && data.properties.every?.(p => p && typeof p === 'object' && 'key' in p) ? data.properties
    : Array.isArray(data) ? data
    : null;

  if (arr) {
    const flat = {};
    const match = (appKey ? arr.find(p => p.key === appKey) : null) || arr[0];
    const inner = match?.properties ?? match;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      // plain object
      Object.assign(flat, inner);
    } else if (Array.isArray(inner)) {
      // array of { key, value } pairs
      inner.forEach(p => { if (p?.key != null) flat[String(p.key)] = p.value ?? p.val ?? ''; });
    } else {
      // Fall back: merge every entry's properties
      arr.forEach(entry => {
        const props = entry?.properties;
        if (props && typeof props === 'object' && !Array.isArray(props)) {
          Object.assign(flat, props);
        } else if (Array.isArray(props)) {
          props.forEach(p => { if (p?.key != null) flat[String(p.key)] = p.value ?? p.val ?? ''; });
        } else if (entry && typeof entry === 'object' && !Array.isArray(entry) && !('key' in entry) && !('environment' in entry)) {
          Object.assign(flat, entry);
        }
      });
    }
    return flat;
  }

  // Shape 3 / 4: top-level object — if first value is itself an object, unwrap
  if (data && typeof data === 'object') {
    const firstVal = Object.values(data)[0];
    if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
      return Object.values(data).reduce(
        (m, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(m, v) : m),
        {}
      );
    }
    return data;
  }

  return {};
}

// ── API Manager Autodiscovery ID ──────────────────────────────────────────────

/**
 * Find the Anypoint Autodiscovery API ID in a flat CPS properties map.
 *
 * Priority:
 *   1. Exact key `api.id`
 *   2. Any key ending in `.api.id`  (e.g. `customer-sapi.api.id`)
 *   3. Any key ending in `.id` whose value is purely numeric
 *   4. Bare `id` key with numeric value
 *
 * Returns the ID as a string, or null if not found.
 *
 * @param {Record<string, any>} props  Flat CPS properties map
 * @returns {string|null}
 */
export function findApiIdInProps(props) {
  const isValidId = v => /^\d+$/.test(String(v).trim()) && String(v).trim() !== '0';

  if ('api.id' in props && isValidId(props['api.id'])) {
    return String(props['api.id']).trim();
  }
  const dotApiId = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
  if (dotApiId && isValidId(dotApiId[1])) return String(dotApiId[1]).trim();

  const dotId = Object.entries(props).find(([k, v]) => k.endsWith('.id') && isValidId(v));
  if (dotId) return String(dotId[1]).trim();

  if ('id' in props && isValidId(props['id'])) return String(props['id']).trim();

  return null;
}

// ── OAuth2 token URL discovery ────────────────────────────────────────────────

/**
 * Scan a flat CPS properties map for an OAuth2 / JWT token endpoint URL.
 *
 * Heuristics (same logic used by PingTestPanel, BulkPingModal, PingTestPage):
 *   - Value must start with `http`
 *   - Value must contain `/oauth2/`, `okta.com`, or `/token`
 *   - For `/token` matches, the key name must contain jwt/oauth/token/auth
 *
 * @param {Record<string, any>} props
 * @returns {string}  Empty string if no URL found
 */
export function findOAuth2Url(props) {
  for (const [k, v] of Object.entries(props || {})) {
    const val = String(v || '');
    if (!val.startsWith('http')) continue;
    if (
      val.includes('/oauth2/') ||
      val.includes('okta.com') ||
      (val.includes('/token') && (
        k.toLowerCase().includes('jwt') ||
        k.toLowerCase().includes('oauth') ||
        k.toLowerCase().includes('token') ||
        k.toLowerCase().includes('auth')
      ))
    ) {
      return val;
    }
  }
  return '';
}

// ── Misc ──────────────────────────────────────────────────────────────────────

/**
 * Normalise a CPS base URL: strip trailing slashes and the `/api/v2` suffix.
 *
 * @param {string} url
 * @returns {string}
 */
export function normaliseCpsUrl(url = '') {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
}