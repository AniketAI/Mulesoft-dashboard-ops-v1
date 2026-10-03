/**
 * Shared Exchange API helpers.
 *
 * The pattern of fetching an Exchange application's clientId + clientSecret
 * (try the dedicated /credentials endpoint first, fall back to the main app
 * endpoint) is used in both apis.js and health.js.  A single canonical
 * implementation avoids the two callers drifting apart.
 */

/**
 * Fetch the clientId and clientSecret for an Anypoint Exchange application.
 *
 * Strategy (in order):
 *  1. GET /exchange/api/v2/organizations/{orgId}/applications/{appId}/credentials
 *     — the dedicated credentials sub-resource (most reliable, most specific).
 *  2. GET /exchange/api/v2/organizations/{orgId}/applications/{appId}
 *     — the main application endpoint, which sometimes includes the credentials
 *       inline (older Exchange versions or public apps).
 *
 * Returns `{ clientId, clientSecret }` where either field may be null when not
 * found.  Never throws — callers should treat null values as "not available".
 *
 * @param {import('axios').AxiosInstance} client  Authenticated Anypoint axios client
 * @param {string} orgId   Organisation (or BG) that owns the application
 * @param {string|number} appId  Numeric Exchange application ID
 * @returns {Promise<{ clientId: string|null, clientSecret: string|null }>}
 */
const fetchExchangeAppCreds = async (client, orgId, appId) => {
  // Step 1: dedicated credentials endpoint
  try {
    const r = await client.get(
      `/exchange/api/v2/organizations/${orgId}/applications/${appId}/credentials`
    );
    const cred = r.data;
    const clientId = cred.clientId || cred.client_id || null;
    const clientSecret = cred.clientSecret || cred.client_secret || null;
    if (clientId) return { clientId, clientSecret };
  } catch {
    // 404 / 403 — fall through to main app endpoint
  }

  // Step 2: main application endpoint
  try {
    const r = await client.get(
      `/exchange/api/v2/organizations/${orgId}/applications/${appId}`
    );
    const app = r.data;
    return {
      clientId: app.clientId || app.client_id || null,
      clientSecret: app.clientSecret || app.client_secret || null,
    };
  } catch {
    return { clientId: null, clientSecret: null };
  }
};

module.exports = { fetchExchangeAppCreds };