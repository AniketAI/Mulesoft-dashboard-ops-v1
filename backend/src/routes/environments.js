const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { isProductionEnv, uniqueProductionEnvs } = require('../utils/appHelpers');
const { sendProxyError } = require('../utils/responseHelpers');

// Get environments for a specific org — filtered to only those the user has access to
router.get('/:orgId', authMiddleware, async (req, res) => {
  const targetOrgId = req.params.orgId;

  // Build a set of ALL accessible environment IDs across every org in session
  const allAccessibleIds = new Set(
    Object.values(req.accessibleEnvironments).flat().map((e) => e.id)
  );

  // Fast path: session has accessible envs for this specific org
  if (req.accessibleEnvironments[targetOrgId]?.length > 0) {
    const envs = req.accessibleEnvironments[targetOrgId].filter(isProductionEnv);
    return res.json({ data: envs, total: envs.length });
  }

  // If root org or no direct match — return all accessible envs across all orgs (deduped)
  if (allAccessibleIds.size > 0) {
    const allEnvs = Object.values(req.accessibleEnvironments).flat();
    const unique = uniqueProductionEnvs(allEnvs);
    if (unique.length > 0) return res.json({ data: unique, total: unique.length });
  }

  // Last resort fallback: fetch from API and filter against accessible IDs
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/accounts/api/organizations/${targetOrgId}/environments`
    );
    const all = response.data.data || [];
    const candidates = allAccessibleIds.size > 0
      ? all.filter((e) => allAccessibleIds.has(e.id))
      : all;
    const filtered = candidates.filter(isProductionEnv);
    res.json({ data: filtered, total: filtered.length });
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch environments');
  }
});

// Get environments for the current (root) org — returns ALL accessible envs across all orgs
router.get('/', authMiddleware, async (req, res) => {
  if (Object.keys(req.accessibleEnvironments).length > 0) {
    const allEnvs = Object.values(req.accessibleEnvironments).flat();
    const unique = uniqueProductionEnvs(allEnvs);
    return res.json({ data: unique, total: unique.length });
  }

  // Fallback: fetch for root org (no session filtering available)
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/accounts/api/organizations/${req.orgId}/environments`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch environments');
  }
});

module.exports = router;