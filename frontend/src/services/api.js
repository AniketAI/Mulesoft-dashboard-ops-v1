import axiosClient from './axiosClient.js';
import * as mock from './mockData.js';
import mockCpsData from './mockCpsData.json';

// ── Demo-mode helpers (re-exported for backwards compatibility) ───────────────
// Components that already import { isDemoMode } from '../services/api' continue
// to work unchanged. The canonical source is now src/utils/demoMode.js.
export { DEMO_MODE_KEY, isDemoMode, enableDemoMode, disableDemoMode } from '../utils/demoMode.js';
import { isDemoMode } from '../utils/demoMode.js';

let demoPingHistory = [
  {
    id: 1,
    timestamp: Date.now() - 60000,
    status: 'SUCCESS',
    responseTimeMs: 120,
    endpoint: 'https://demo-api.sfdcbt.net/api/v1/ping',
    appName: 'customer-api-v2',
    payload: { status: 'ok', version: '2.0.1' },
    env_name: 'Production',
    target_type: 'CH1',
    credentials: 'Auto (customer-api-client)',
    http_status: 200
  },
  {
    id: 2,
    timestamp: Date.now() - 120000,
    status: 'FAILED',
    responseTimeMs: null,
    endpoint: 'https://order-api.sfdcbt.net/api/v1/ping',
    appName: 'order-process-sapi',
    error: 'ECONNREFUSED',
    env_name: 'Production',
    target_type: 'CH1',
    credentials: 'Manual / None',
    http_status: null
  }
];

// ── Mock response helper ─────────────────────────────────────────────────────
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

const mockHandler = async (url, params, data = null) => {
  await delay();

  // Auth session
  if (url === '/auth/session') {
    return { authenticated: true, user: mock.MOCK_USER, orgId: 'demo-org-001', orgName: 'Demo Organization' };
  }
  if (url === '/auth/logout') return { success: true };

  // Environments
  if (url.startsWith('/environments')) {
    return { data: mock.MOCK_ENVIRONMENTS, total: mock.MOCK_ENVIRONMENTS.length };
  }

  // Applications summary
  if (url.startsWith('/applications/summary')) {
    return { data: mock.MOCK_APPS, total: mock.MOCK_APPS.length, environments: mock.MOCK_ENVIRONMENTS };
  }

  // Application detail
  if (url.startsWith('/applications/cloudhub2') || url.startsWith('/applications/cloudhub1')) {
    return mock.MOCK_APP_DETAIL;
  }

  // Business groups
  if (url.includes('/organizations/business-groups')) {
    return { data: mock.MOCK_BUSINESS_GROUPS, total: mock.MOCK_BUSINESS_GROUPS.length };
  }
  if (url.includes('/organizations/') && url.includes('/members')) {
    return { data: mock.MOCK_MEMBERS, total: mock.MOCK_MEMBERS.length };
  }
  if (url.startsWith('/organizations')) {
    return { data: mock.MOCK_BUSINESS_GROUPS[0] };
  }

  // API Manager
  if (url.includes('/policies')) {
    return { policies: mock.MOCK_POLICIES };
  }
  if (url.startsWith('/apis')) {
    return { assets: mock.MOCK_APIS, total: mock.MOCK_APIS.length };
  }

  // CPS credentials
  if (url === '/cps/credentials') {
    return mockCpsData.credentials;
  }
  if (url.startsWith('/cps/fetch')) {
    if (params?.type === 'secure') {
      return mockCpsData.fetchSecure;
    }
    return mockCpsData.fetch;
  }
  // CPS write operations (demo mode — simulate success)
  if (url === '/cps/write') return { success: true, method: 'PUT', projectKey: 'demo-app', propertyCount: 3 };
  if (url === '/cps/project') return { success: true, deleted: 'demo-app' };
  if (url === '/cps/auth' && params?.projectKey) return mockCpsData.auth;
  if (url === '/cps/auth') return { success: true, allowedClientIds: ['demo-client-id-1'] };
  if (url === '/cps/credentials/test') return { valid: true, statusCode: 200, message: 'Demo mode — connected successfully' };
  if (url === '/cps/binary') return { success: true, uploaded: 'demo.jks', sizeBytes: 1024 };

  // Health / Ping History
  if (url.includes('/health/ping/history')) {
    return [...demoPingHistory].sort((a, b) => b.timestamp - a.timestamp);
  }
  if (url === '/health/ping') {
    const result = {
      id: Date.now(),
      status: 'SUCCESS',
      responseTimeMs: Math.floor(Math.random() * 200) + 50,
      endpoint: `https://${data?.appName || 'app'}.internalapi.sfdcbt.net/api/v1/ping`,
      appName: data?.appName || 'unknown-app',
      timestamp: Date.now(),
      payload: { status: 'ok' },
      attempts: [],
      env_name: data?.envName || 'Sandbox',
      target_type: data?.targetType || 'CH1',
      credentials: data?.credentialsLabel || 'Manual / None',
      http_status: 200
    };
    demoPingHistory.push(result);
    return result;
  }

  // Exchange
  if (url.startsWith('/exchange/org') && url.includes('/summary')) {
    return { assetCounts: mock.MOCK_EXCHANGE_SUMMARY };
  }
  if (url.startsWith('/exchange/search')) {
    const search = (params?.search || '').toLowerCase();
    const type = params?.type || '';
    let assets = mock.MOCK_EXCHANGE_ASSETS;
    if (search) assets = assets.filter((a) => a.name.toLowerCase().includes(search) || a.assetId.includes(search));
    if (type) assets = assets.filter((a) => a.type === type);
    return { assets, total: assets.length };
  }
  if (url.startsWith('/exchange')) {
    return mock.MOCK_EXCHANGE_ASSETS[0];
  }

  return {};
};

// ── Unified API facade ────────────────────────────────────────────────────────
// Wraps axiosClient with demo-mode short-circuiting.
// axiosClient (src/services/axiosClient.js) owns the HTTP config and interceptors;
// this facade owns the demo/real branching logic.
const api = {
  get: async (url, config = {}) => {
    if (isDemoMode()) {
      const data = await mockHandler(url, config.params);
      return { data };
    }
    return axiosClient.get(url, config);
  },
  post: async (url, payload, config = {}) => {
    if (isDemoMode()) {
      if (url === '/auth/logout') return { data: { success: true } };
      const data = await mockHandler(url, config.params, payload);
      return { data: Object.keys(data).length > 0 ? data : { success: true } };
    }
    return axiosClient.post(url, payload, config);
  },
  delete: async (url, config = {}) => {
    if (isDemoMode()) {
      if (url === '/health/ping/history') demoPingHistory = [];
      return { data: { success: true } };
    }
    return axiosClient.delete(url, config);
  },
  patch: async (url, data, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.patch(url, data, config);
  },
  put: async (url, data, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.put(url, data, config);
  },
};

export default api;