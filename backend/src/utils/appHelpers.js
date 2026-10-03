/**
 * Shared application and environment helpers used across multiple route files.
 * Centralising these prevents the same logic from drifting out of sync when
 * the business rules change.
 */

// ── Environment filtering ─────────────────────────────────────────────────────

/**
 * Returns true when an environment should be included in results.
 * Excludes any environment whose name contains "qa" or "dev" (case-insensitive).
 *
 * @param {{ name?: string }} env
 * @returns {boolean}
 */
const isProductionEnv = (env) => {
  const name = (env.name || '').toLowerCase();
  return !name.includes('qa') && !name.includes('dev');
};

/**
 * Deduplicate an array of environment objects by their `id` field,
 * then apply the production-env filter.
 *
 * @param {Array<{ id: string, name?: string }>} envs
 * @returns {Array}
 */
const uniqueProductionEnvs = (envs) => {
  const seen = new Set();
  return envs.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  }).filter(isProductionEnv);
};

// ── CloudHub 2.0 response parsing ────────────────────────────────────────────

/**
 * Parse apps out of the various CloudHub 2.0 list-API response shapes.
 * The API has returned items/deployments/content/data depending on the
 * version and query parameters used.
 *
 * @param {any} data  Raw response body from the CH2 deployments endpoint
 * @returns {Array}
 */
const parseCH2Apps = (data) => {
  if (Array.isArray(data)) return data;
  return data.items || data.deployments || data.content || data.data || [];
};

// ── Status normalisation ──────────────────────────────────────────────────────

/**
 * Normalise CloudHub 1.0 and 2.0 status strings to a consistent vocabulary
 * so the frontend never has to handle platform-specific variants.
 *
 * CH1 mappings:  STARTED → RUNNING | DEPLOY_FAILED → FAILED |
 *                UNDEPLOYED / NOT_RUNNING → STOPPED
 * CH2 statuses are already in the canonical vocabulary (RUNNING, FAILED, etc.)
 *
 * @param {string|undefined} status
 * @returns {string}
 */
const normalizeStatus = (status) => {
  const s = (status || '').toUpperCase().trim();
  if (s === 'STARTED') return 'RUNNING';
  if (s === 'DEPLOY_FAILED') return 'FAILED';
  if (s === 'UNDEPLOYED') return 'STOPPED';
  if (s === 'NOT_RUNNING') return 'STOPPED';
  return s;
};

// ── CloudHub 1.0 request headers ─────────────────────────────────────────────

/**
 * Build the CloudHub 1.0 context headers required by every CH1 API call.
 *
 * @param {string} envId  Anypoint environment ID
 * @param {string} orgId  Anypoint organisation ID
 * @returns {{ 'X-ANYPNT-ENV-ID': string, 'X-ANYPNT-ORG-ID': string }}
 */
const makeCh1Headers = (envId, orgId) => ({
  'X-ANYPNT-ENV-ID': envId,
  'X-ANYPNT-ORG-ID': orgId,
});

// ── App-name normalisation ────────────────────────────────────────────────────

/**
 * Strip CloudHub deployment suffixes from an app name so the base logical
 * name can be used for Exchange searches or fuzzy matching.
 *
 * Examples:
 *   sapi-workday-ar-refunds-v1-uw2-up   → sapi-workday-ar-refunds
 *   xapi-coupa-ask-procurement-v1-uw2-ut → xapi-coupa-ask-procurement
 *   my-app-v2                            → my-app
 *
 * @param {string} name
 * @returns {string}
 */
const stripDeploymentSuffix = (name) =>
  (name || '')
    .toLowerCase()
    // Strip region+env suffix: -uw2-up, -eu2-ut, -ap1-ud, -uw2-up1
    .replace(/-[a-z]{2,4}\d+[-_][a-z]{2,5}\d*$/i, '')
    // Strip standalone region code: -uw2, -eu2, -ap1
    .replace(/-[a-z]{2,3}\d+$/i, '')
    // Strip version suffix: -v1, _v2, .v1.0
    .replace(/[-_.]v\d+(\.\d+)*$/i, '')
    // Strip bare version suffix: v1, v2.0
    .replace(/\bv\d+(\.\d+)*$/i, '');

module.exports = {
  isProductionEnv,
  uniqueProductionEnvs,
  parseCH2Apps,
  normalizeStatus,
  makeCh1Headers,
  stripDeploymentSuffix,
};