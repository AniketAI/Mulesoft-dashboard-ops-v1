const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { mapOrgShape } = require('../utils/orgHelpers');
const { sendProxyError } = require('../utils/responseHelpers');

// Walk UP from any org to the root (parentId === null)
async function findRootOrgId(client, orgId) {
  let currentId = orgId;
  const visited = new Set();
  while (currentId) {
    if (visited.has(currentId)) break; // cycle guard
    visited.add(currentId);
    try {
      const res = await client.get(`/accounts/api/organizations/${currentId}`);
      const org = res.data;
      if (!org.parentId) {
        console.log(`Root org found: ${org.name} (${org.id})`);
        return org.id;
      }
      currentId = org.parentId;
    } catch (e) {
      console.error(`Failed to fetch org ${currentId} while walking up:`, e.response?.status);
      break;
    }
  }
  return orgId; // fallback to original if walk fails
}

// BFS DOWN from root to get every accessible org
async function fetchAllOrgs(client, rootOrgId) {
  const visited = new Set();
  const allOrgs = [];
  const queue = [rootOrgId];

  while (queue.length > 0) {
    const orgId = queue.shift();
    if (visited.has(orgId)) continue;
    visited.add(orgId);

    try {
      const res = await client.get(`/accounts/api/organizations/${orgId}`);
      const org = res.data;
      allOrgs.push({
        id: org.id,
        name: org.name,
        domain: org.domain,
        type: org.type,
        parentId: org.parentId || null,
        ownerId: org.ownerId,
        createdAt: org.createdAt,
        updatedAt: org.updatedAt,
        subOrganizationIds: org.subOrganizationIds || []
      });
      // Enqueue children
      for (const childId of (org.subOrganizationIds || [])) {
        if (!visited.has(childId)) queue.push(childId);
      }
    } catch (e) {
      console.error(`Failed to fetch org ${orgId}:`, e.response?.status, e.message);
    }
  }
  return allOrgs;
}

// Get current organization
router.get('/', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(`/accounts/api/organizations/${req.orgId}`);
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch organization');
  }
});

// Get all business groups — uses memberOrgs from session (set at login) for speed
router.get('/business-groups', authMiddleware, async (req, res) => {
  try {
    // Fast path: session already has the full memberOrgs list from /accounts/api/me
    if (req.memberOrgs && req.memberOrgs.length > 0) {
      return res.json({ total: req.memberOrgs.length, data: req.memberOrgs });
    }

    // Fallback: re-fetch from /accounts/api/me
    const client = createClient(req.anypointToken);
    const profileRes = await client.get('/accounts/api/me');
    const memberOrgs = (profileRes.data.user?.memberOfOrganizations || []).map(mapOrgShape);

    if (memberOrgs.length > 0) {
      console.log(`Business groups from /me: ${memberOrgs.length}`);
      return res.json({ total: memberOrgs.length, data: memberOrgs });
    }

    // Final fallback: BFS from root
    const rootOrgId = await findRootOrgId(client, req.orgId);
    const allOrgs = await fetchAllOrgs(client, rootOrgId);
    console.log(`Business groups from BFS: ${allOrgs.length}`);
    res.json({ total: allOrgs.length, data: allOrgs, rootOrgId });
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch business groups');
  }
});

// Get a specific organization by ID
router.get('/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(`/accounts/api/organizations/${req.params.orgId}`);
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch organization');
  }
});

// Get users in an organization
router.get('/:orgId/members', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 50, offset = 0 } = req.query;
    const response = await client.get(
      `/accounts/api/organizations/${req.params.orgId}/members?limit=${limit}&offset=${offset}`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch organization members');
  }
});

module.exports = router;