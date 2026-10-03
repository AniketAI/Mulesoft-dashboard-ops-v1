const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { fetchExchangeAppCreds } = require('../utils/exchangeHelpers');
const { sendProxyError } = require('../utils/responseHelpers');

// Fetch a client application's clientId from Exchange by numeric appId.
// Route uses a hyphenated prefix so it CANNOT be confused with /:orgId/:envId/:apiId.
router.get('/app-client-id/:appId', authMiddleware, async (req, res) => {
  const { appId } = req.params;
  // orgIds is a comma-separated list of org IDs to try in order
  // (app's masterOrgId, app's orgId, API Manager's orgId as fallback)
  const { orgIds = '', orgId } = req.query;

  const toTry = orgIds
    ? orgIds.split(',').map(o => o.trim()).filter(Boolean)
    : orgId ? [orgId] : [];

  if (toTry.length === 0) {
    return res.status(400).json({ error: 'orgIds or orgId query parameter is required' });
  }

  const client = createClient(req.anypointToken);

  for (const oid of toTry) {
    const { clientId, clientSecret } = await fetchExchangeAppCreds(client, oid, appId);
    if (clientId) {
      console.log(`[APIs] clientId resolved for appId ${appId} via org ${oid}`);
      return res.json({ id: appId, name: null, clientId });
    }
    console.warn(`[APIs] Exchange app lookup found no clientId (org ${oid})`);
  }

  // Nothing worked — return null clientId without error so UI gracefully shows "—"
  console.warn(`[APIs] Could not resolve clientId for appId ${appId} after trying orgs: ${toTry.join(', ')}`);
  res.json({ id: appId, name: null, clientId: null });
});

// Get all API instances for an environment
router.get('/:orgId/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 50, offset = 0 } = req.query;
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis`,
      { params: { limit, offset } }
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch API instances');
  }
});

// Get a specific API instance
router.get('/:orgId/:envId/:apiId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch API instance');
  }
});

// Get policies applied to an API instance
router.get('/:orgId/:envId/:apiId/policies', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId } = req.params;
  const url = `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/policies`;
  console.log('[APIs] GET policies →', url);
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('[APIs] policies error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API policies',
      _debug: { orgId, envId, apiId, url }
    });
  }
});

// Get contracts for an API instance
router.get('/:orgId/:envId/:apiId/contracts', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId } = req.params;
  const url = `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`;
  console.log('[APIs] GET contracts →', url);
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('[APIs] contracts error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API contracts',
      _debug: { orgId, envId, apiId, url }
    });
  }
});

// Delete a contract permanently
router.delete('/:orgId/:envId/:apiId/contracts/:contractId', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId, contractId } = req.params;
  const url = `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts/${contractId}`;
  console.log('[APIs] DELETE contract →', url);
  try {
    const client = createClient(req.anypointToken);
    const response = await client.delete(url);
    // Anypoint returns 204 No Content on success
    res.status(response.status === 204 ? 204 : 200).json(response.data ?? { success: true });
  } catch (error) {
    console.error('[APIs] delete contract error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to delete contract',
      _debug: { orgId, envId, apiId, contractId, url }
    });
  }
});

// Update a contract status (Approve / Revoke)
router.patch('/:orgId/:envId/:apiId/contracts/:contractId', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId, contractId } = req.params;
  const { status } = req.body; // e.g., 'APPROVED', 'REVOKED'
  
  if (!status) {
    return res.status(400).json({ error: 'Contract status is required' });
  }

  const url = `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts/${contractId}`;
  console.log(`[APIs] PATCH contract status to ${status} →`, url);
  try {
    const client = createClient(req.anypointToken);
    const response = await client.patch(url, { status });
    res.json(response.data);
  } catch (error) {
    console.error('[APIs] patch contract error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to update contract status',
      _debug: { orgId, envId, apiId, contractId, url }
    });
  }
});

// Get SLA tiers for an API instance
router.get('/:orgId/:envId/:apiId/tiers', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}/tiers`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch SLA tiers');
  }
});

// Get API alerts
router.get('/:orgId/:envId/:apiId/alerts', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}/alerts`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch API alerts');
  }
});

module.exports = router;