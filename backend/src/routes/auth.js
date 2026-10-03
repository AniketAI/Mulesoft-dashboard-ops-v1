const express = require('express');
const axios = require('axios');
const router = express.Router();

const { ANYPOINT_URL } = require('../utils/anypointClient');
const { mapOrgShape } = require('../utils/orgHelpers');

// Helper: fetch user profile and store session
async function storeSession(req, token) {
  const profileResponse = await axios.get(`${ANYPOINT_URL}/accounts/api/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const user = profileResponse.data.user;

  // memberOfOrganizations contains ALL orgs the user has access to
  const memberOrgs = user.memberOfOrganizations || [];

  // Find root org: the one with no parentId (or parentOrganizationIds empty)
  const rootOrg = memberOrgs.find((o) => !o.parentId && !o.parentOrganizationIds?.length)
    || memberOrgs.find((o) => !o.parentId)
    || user.organization;

  const rootOrgId = rootOrg.id;
  const rootOrgName = rootOrg.name;

  req.session.token = token;
  req.session.orgId = rootOrgId;
  req.session.orgName = rootOrgName;
  req.session.username = user.username;
  // Store full member org list so /business-groups can return it without extra API calls
  req.session.memberOrgs = memberOrgs.map(mapOrgShape);

  // Build the set of environment IDs the user has an explicit role in
  // user.roles[].contextParams.envId is the authoritative source
  const roles = user.roles || [];
  const roleEnvIds = new Set(
    roles
      .map((r) => r.contextParams?.envId || r.contextParams?.environment)
      .filter(Boolean)
  );

  // Build accessible environments map per org
  // If role-based env IDs exist, filter to only those; otherwise use all member envs
  const accessibleEnvironments = {};
  for (const org of memberOrgs) {
    const envs = org.environments || [];
    const filtered = roleEnvIds.size > 0
      ? envs.filter((e) => roleEnvIds.has(e.id))
      : envs;

    if (filtered.length > 0) {
      accessibleEnvironments[org.id] = filtered.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        organizationId: e.organizationId || org.id,
        isProduction: e.isProduction || e.type === 'production'
      }));
    }
  }

  // Log for debugging
  const totalEnvs = Object.values(accessibleEnvironments).flat().length;
  console.log(`Session: ${memberOrgs.length} orgs, ${roleEnvIds.size} role-scoped envs, ${totalEnvs} accessible envs`);

  req.session.accessibleEnvironments = accessibleEnvironments;
  req.session.user = {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    organization: { id: rootOrgId, name: rootOrgName }
  };
  return { user: req.session.user, orgId: rootOrgId, orgName: rootOrgName };
}

// ── Username / Password ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const response = await axios.post(`${ANYPOINT_URL}/accounts/login`, { username, password });
    const { access_token } = response.data;
    const result = await storeSession(req, access_token);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Login failed. Check your credentials.'
    });
  }
});

// ── Access Token (paste from browser / CLI) ──────────────────────────────────
router.post('/token-login', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Access token is required' });
  }
  try {
    // Strip "Bearer " prefix if user accidentally included it, and trim whitespace/newlines
    let cleanToken = token.trim().replace(/^Bearer\s+/i, '').trim();
    const result = await storeSession(req, cleanToken);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Token login error:', error.response?.data || error.message);
    const status = error.response?.status || 401;
    let msg = 'Invalid or expired access token.';
    if (status === 400) msg = 'Token format is invalid. Make sure you copied only the token value (not "Bearer <token>").';
    if (status === 401) msg = 'Token is expired or invalid. Please grab a fresh token from DevTools.';
    if (status === 403) msg = 'Token does not have sufficient permissions.';
    res.status(status).json({ error: msg });
  }
});

// ── Connected App (OAuth 2.0 Client Credentials) ─────────────────────────────
router.post('/connected-app-login', async (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Client ID and Client Secret are required' });
  }
  try {
    // Exchange client credentials for an access token
    const tokenResponse = await axios.post(
      `${ANYPOINT_URL}/accounts/api/v2/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const access_token = tokenResponse.data.access_token;
    if (!access_token) {
      return res.status(401).json({ error: 'No access token returned. Check your Connected App credentials.' });
    }

    const result = await storeSession(req, access_token);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Connected App login error:', error.response?.data || error.message);
    const msg = error.response?.data?.error_description
      || error.response?.data?.message
      || 'Connected App authentication failed. Check your Client ID and Secret.';
    res.status(error.response?.status || 401).json({ error: msg });
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── Session Check ────────────────────────────────────────────────────────────
router.get('/session', (req, res) => {
  if (req.session && req.session.token) {
    res.json({
      authenticated: true,
      user: req.session.user,
      orgId: req.session.orgId,
      orgName: req.session.orgName,
      memberOrgs: req.session.memberOrgs || [],
      accessibleEnvironments: req.session.accessibleEnvironments || {}
    });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;