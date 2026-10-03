import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, ChevronRight, AlertTriangle, X, SlidersHorizontal, FileSpreadsheet, Activity, CheckCircle2, XCircle, Clock, ShieldCheck, UploadCloud, ExternalLink, Database, Check } from 'lucide-react';
import CredentialImportButton from '../components/CredentialImportButton';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
import CpsExportModal from '../components/CpsExportModal';
import PingResultCard from '../components/PingResultCard';
import CopyBtn from '../components/CopyBtn';
import api from '../services/api';
import { getCachedSWR, setCached, bustCache, keepFresh, stopKeepingFresh } from '../services/apiCache';
import { CK } from '../services/cacheKeys';
import { availableActions, ACTION_CONFIG, ENV_BADGE, generateTxId } from '../utils/appUtils';
import { findOAuth2Url, flattenCpsResponse } from '../utils/cpsHelpers';
import * as XLSX from 'xlsx';

const ENV_TAG_COLOR = {
  production: 'bg-sfgreen-100 text-sfgreen-600',
  sandbox: 'bg-sforange-100 text-sforange-600'
};

/* ── Open app in Anypoint Platform ────────────────────────── */
// Opens the app in CloudHub using a 2-step approach:
//   Step 1 — Switch to the correct Business Group via the Anypoint home URL.
//   Step 2 — After the BG switch settles, navigate to the app using the
//             env-in-path URL format: /console/home/{envId}/applications/...
//             This is the canonical CloudHub URL when inside an environment.
//
// If the env selector still appears (Anypoint Platform limitation when no env
// is cached for this BG in the current browser session), the tooltip shows
// exactly which environment to click — one click lands on the app.
function openInAnypoint(e, app, fallbackBgId) {
  e.stopPropagation();
  // Copy the app name to clipboard so the user can paste it into CloudHub's
  // search box if the "Choose Environment" page appears before the app.
  try { navigator.clipboard.writeText(app.name); } catch { /* non-fatal */ }
  const orgId = app._bgId || fallbackBgId || '';
  const envId = app.environment?.id || '';

  // Env-in-path URL: this is the format Anypoint uses when you are already
  // inside an environment — it encodes the env context in the hash path.
  const envAppUrl = envId
    ? (app.deploymentType === 'CloudHub 2.0'
        ? `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/runtimeFabric/${app.id}/settings`
        : `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/cloudhub/${app.id}/settings`)
    : (app.deploymentType === 'CloudHub 2.0'
        ? `https://anypoint.mulesoft.com/cloudhub/#/console/applications/runtimeFabric/${app.id}/settings`
        : `https://anypoint.mulesoft.com/cloudhub/#/console/applications/cloudhub/${app.id}/settings`);

  if (!orgId) {
    window.open(envAppUrl, '_blank', 'noreferrer');
    return;
  }

  // Step 1: Switch Business Group
  const win = window.open(
    `https://anypoint.mulesoft.com/home/organizations/${orgId}/`,
    '_blank'
  );

  if (win) {
    // Step 2: After BG switch completes, navigate to the app with env in path.
    // 4s gives enough time for the BG-switch redirect chain to fully settle.
    setTimeout(() => {
      try { win.location.href = envAppUrl; }
      catch { window.open(envAppUrl, '_blank', 'noreferrer'); }
    }, 4000);
  } else {
    window.open(envAppUrl, '_blank', 'noreferrer');
  }
}

/* ── Single-app Confirm Modal ──────────────────────────────── */
function ConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, app } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl flex-shrink-0 ${dangerous ? 'bg-red-50 dark:bg-red-500/10' : 'bg-sf-50 dark:bg-sf-500/10'}`}>
            <AlertTriangle size={20} className={dangerous ? 'text-red-600 dark:text-red-400' : 'text-sf-600 dark:text-sf-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base mb-1">{label} Application?</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Are you sure you want to <span className="font-semibold text-gray-900 dark:text-gray-100">{label.toLowerCase()}</span>{' '}
              <span className="font-mono text-sf-700 dark:text-sf-300 text-xs bg-sf-50 dark:bg-sf-500/15 px-1.5 py-0.5 rounded-md">{app.name}</span>?
            </p>
            {dangerous && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ This will stop all running flows and connections.</p>}
          </div>
          <button onClick={onCancel} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${bulkCls}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : <><Icon size={13} /> Confirm {label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Confirm Modal ─────────────────────────────────────── */
function BulkConfirmModal({ state, onConfirm, onCancel, loading, results }) {
  if (!state) return null;
  const { action, apps } = state;
  const { Icon, label, bulkCls } = ACTION_CONFIG[action];
  const dangerous = action === 'stop';
  const isDone = !!results;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl mx-4">
        <div className="flex items-start gap-4 mb-4">
          <div className={`p-3 rounded-2xl flex-shrink-0 ${dangerous ? 'bg-red-50 dark:bg-red-500/10' : 'bg-sf-50 dark:bg-sf-500/10'}`}>
            <AlertTriangle size={20} className={dangerous ? 'text-red-600 dark:text-red-400' : 'text-sf-600 dark:text-sf-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base mb-1">
              {isDone ? 'Results' : `${label} ${apps.length} Application${apps.length !== 1 ? 's' : ''}?`}
            </h3>
            {!isDone && (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                This will <span className="text-gray-900 dark:text-gray-100 font-semibold">{label.toLowerCase()}</span> the following applications:
              </p>
            )}
            {dangerous && !isDone && (
              <p className="text-red-600 dark:text-red-400 text-xs mt-1 font-medium">⚠ This will stop all running flows and connections for each app.</p>
            )}
          </div>
          <button onClick={onCancel} disabled={loading} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* App list with per-app result indicators */}
        <div className="max-h-52 overflow-y-auto space-y-1.5 mb-5 pr-1">
          {apps.map((app) => {
            const r = results?.[app.id];
            return (
              <div key={app.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-800 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                  <span className="text-gray-700 dark:text-gray-300 text-xs font-semibold truncate">{app.name}</span>
                  <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0 hidden sm:inline">({app.environment?.name})</span>
                </div>
                <div className="flex-shrink-0">
                  {r ? (
                    r.success
                      ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">✓ Done</span>
                      : <span className="text-red-600 dark:text-red-400 text-xs font-semibold" title={r.error}>✗ Failed</span>
                  ) : loading ? (
                    <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-sf-400 block" />
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500 text-xs">Pending</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary when done */}
        {isDone && (
          <div className="flex gap-3 mb-4 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              ✓ {Object.values(results).filter((r) => r.success).length} succeeded
            </span>
            {Object.values(results).filter((r) => !r.success).length > 0 && (
              <span className="text-red-600 dark:text-red-400 font-semibold">
                ✗ {Object.values(results).filter((r) => !r.success).length} failed
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl disabled:opacity-50 transition-colors">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          {!isDone && (
            <button onClick={onConfirm} disabled={loading}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${bulkCls}`}>
              {loading
                ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
                : <><Icon size={13} /> {label} All {apps.length}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Bulk Ping Modal ────────────────────────────────────────── */
function BulkPingModal({ apps, onClose }) {
  const navigate = useNavigate();
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const { getSecret: getCpsSecret, hasCredentials: hasCpsCreds } = useCpsCredentialStore();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [transactionId, setTransactionId] = useState('smokeTest');
  const [running, setRunning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [results, setResults] = useState({});
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  const [showSecret, setShowSecret] = useState(false);

  // ── Extract the API Manager autodiscovery ID from CPS non-secure props ───
  //
  // The team stores the autodiscovery ID in CPS non-secure properties using
  // key patterns like:
  //   <prefix>.api.id   e.g.  customer-sapi.api.id = 12345678
  //   <prefix>.id       e.g.  customer-sapi.id     = 12345678  (fallback)
  //
  // Strategy:
  //   1. Read CPS connection config (baseUrl, key, env) from the app's ARM
  //      deployment properties — same fields used by the CPS Compare page.
  //   2. Fetch CPS non-secure properties for this app.
  //   3. Find the first key ending in ".api.id" → its value is the apiId.
  //      If not found, find the first key ending in ".id" with a numeric value.
  //   4. On any failure (CPS unreachable, no CPS config) return {} so the
  //      caller falls through to fuzzy name matching (Layers 3-5).
  const fetchAppApiProps = useCallback(async (app) => {
    const bgId = app._bgId;
    const envId = app.environment?.id;
    if (!bgId || !envId) return {};

    try {
      // ── Step 1: Get ARM detail to extract CPS connection properties ────────
      let armDetail = null;
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}/${app.id}`);
        armDetail = r.data;
      } else {
        const r = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: bgId } });
        armDetail = { name: app.name, properties: r.data?.properties || {} };
      }

      // Merge all ARM property sources (same logic as extractCpsProps in CpsComparisonPage)
      const ds = armDetail?.target?.deploymentSettings || {};
      const appCfg = armDetail?.application?.configuration || {};
      const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
      const allArmProps = {
        ...armDetail?.properties,
        ...(propsSvc.properties || {}),
        ...(ds.properties || {}),
        ...(ds.environmentVariables || ds.environmentVars || {}),
      };

      const cpsBaseUrl  = allArmProps['cps.configServerBaseUrl'] || allArmProps['config.server.base.url'] || '';
      const cpsKey      = allArmProps['cps.projectName'] || allArmProps['cloudhub.api.name'] || app.name || '';
      const cpsEnv      = allArmProps['cps.prefix'] || allArmProps['cps.environment'] || '';
      const cpsClientId = allArmProps['cps.clientId'] || allArmProps['cps.client_id'] ||
                          allArmProps['cps.client.id'] || allArmProps['cps.apiClientId'] || '';

      if (!cpsBaseUrl || !cpsKey) return {}; // no CPS config → skip

      // ── Step 2a: Post CPS credentials to backend session ──────────────────
      // Without this step the CPS fetch returns 422 for apps whose CPS
      // server requires OAuth. Mirror the logic in CpsComparisonPage.
      if (cpsClientId && hasCpsCreds) {
        const secret = getCpsSecret(cpsClientId);
        if (secret) {
          try {
            const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${bgId}`;
            await api.post('/cps/credentials', {
              credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } },
            });
          } catch { /* non-fatal — CPS fetch will fail with 422 if creds are wrong */ }
        }
      }

      // ── Step 2b: Fetch CPS non-secure properties ──────────────────────────
      const cpsRes = await api.get('/cps/fetch', {
        params: {
          baseUrl: cpsBaseUrl,
          type: 'non-secure',
          keys: cpsKey,
          ...(cpsEnv && { environment: cpsEnv }),
          bgOrgId: bgId,
        },
      });

      // Flatten the CPS response to a plain {key: value} map
      const data = cpsRes.data;
      let cpsProps = {};
      if (Array.isArray(data?.responses)) {
        data.responses.forEach(r => Object.assign(cpsProps, r.properties || {}));
      } else if (Array.isArray(data)) {
        data.forEach(r => { if (r?.properties) Object.assign(cpsProps, r.properties); });
        if (Object.keys(cpsProps).length === 0 && typeof data[0] !== 'object') cpsProps = {};
      } else if (data && typeof data === 'object') {
        const firstVal = Object.values(data)[0];
        cpsProps = (firstVal && typeof firstVal === 'object') ?
          Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) :
          data;
      }

      // ── Step 3: Find the autodiscovery ID ─────────────────────────────────
      const cpsKeys = Object.keys(cpsProps);
      //console.log(`[fetchAppApiProps] ${app.name} — CPS keys: [${cpsKeys.join(', ')}]`);

      // Priority 1: exact key "api.id"
      if ('api.id' in cpsProps) {
        const val = String(cpsProps['api.id']).trim();
        if (val && /^\d+$/.test(val)) {
          console.log(`[fetchAppApiProps] ${app.name} — found apiId via exact "api.id": ${val}`);
          return { apiId: val };
        }
      }

      // Priority 2: key ending with ".api.id"  →  e.g. customer-sapi.api.id
      const dotApiIdEntry = Object.entries(cpsProps).find(([k]) => k.endsWith('.api.id'));
      if (dotApiIdEntry) {
        const val = String(dotApiIdEntry[1]).trim();
        if (val && /^\d+$/.test(val)) {
          console.log(`[fetchAppApiProps] ${app.name} — found apiId via "${dotApiIdEntry[0]}": ${val}`);
          return { apiId: val };
        }
      }

      // Priority 3: key ending with ".id" whose value is purely numeric
      // e.g.  sapi-workday-ar-refunds.id = 12345678
      // (Numeric-only check avoids matching client.id, secret.id which hold UUIDs)
      const dotIdEntry = Object.entries(cpsProps).find(([k, v]) =>
        k.endsWith('.id') && /^\d+$/.test(String(v).trim())
      );
      if (dotIdEntry) {
        const val = String(dotIdEntry[1]).trim();
        console.log(`[fetchAppApiProps] ${app.name} — found apiId via "${dotIdEntry[0]}": ${val}`);
        return { apiId: val };
      }

      // Priority 4: bare "id" key with numeric value
      // (handles case where CPS flattening strips the group-name prefix)
      if ('id' in cpsProps) {
        const val = String(cpsProps['id']).trim();
        if (/^\d+$/.test(val)) {
          console.log(`[fetchAppApiProps] ${app.name} — found apiId via bare "id": ${val}`);
          return { apiId: val };
        }
      }

      console.log(`[fetchAppApiProps] ${app.name} — no matching id key found in CPS props, falling back to fuzzy match`);
      return {}; // no autodiscovery ID found in CPS — use fuzzy matching
    } catch (err) {
      console.warn(`[fetchAppApiProps] ${app.name} — error fetching CPS: ${err.message}`);
      return {};
    }
  }, []);

  // Resolve credentials from API Manager + CSV sheet for each app (in parallel).
  // Strategy (in priority order):
  //   1. Fetch app's Autodiscovery api.id → pass to backend for direct lookup (Layer 1)
  //   2. Pass assetId if found → backend uses it for filtered search (Layer 2)
  //   3. Backend falls back to paginated fuzzy name search (Layers 3-5)
  const resolveAllCredentials = useCallback(async () => {
    if (!hasCredentials || clientId.trim()) return {};
    const settled = await Promise.allSettled(
      apps.map(async (app) => {
        const bgId = app._bgId;
        const envId = app.environment?.id;
        if (!bgId || !envId) return null;
        try {
          // Fetch Autodiscovery properties (api.id) in parallel with cred resolution
          const { apiId, assetId } = await fetchAppApiProps(app);

          const { data } = await api.post('/health/auto-credentials', {
            orgId: bgId,
            envId,
            appName: app.name,
            ...(apiId   && { apiId }),    // Layer 1: direct instance lookup
            ...(assetId && { assetId }),  // Layer 2: asset-filtered search
          });
          if (data.found && data.matchInfo?.length > 0) {
            const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
            if (matched) {
              const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
              return {
                appId: app.id,
                ...matched,
                apiInstanceName: meta?.apiInstanceName || '—',
                contractApp: meta?.contractApp || '—',
                resolvedLayer: data.resolvedLayer,
                source: 'csv',
              };
            }
            // CSV lookup failed — try auto-contract-creds as fallback
            const apiInstanceId = data.matchedApis?.[0]?.id;
            if (apiInstanceId) {
              try {
                const contractRes = await api.post('/health/auto-contract-creds', {
                  orgId: bgId, envId, apiId: apiInstanceId,
                  envType: app.environment?.type || '',
                });
                const cd = contractRes.data;
                // Only use credentials if the contract is APPROVED.
                // If pending, do NOT ping with these creds — the API will reject them.
                if (cd.clientId && cd.clientSecret && cd.contractStatus === 'approved') {
                  return {
                    appId: app.id,
                    clientId: cd.clientId,
                    clientSecret: cd.clientSecret,
                    apiInstanceName: data.matchedApis[0]?.label || '—',
                    contractApp: cd.appName || '—',
                    resolvedLayer: 'contract',
                    contractStatus: cd.contractStatus,
                    source: 'contract',
                  };
                }
                // Contract is pending — mark app as skipped so the ping is NOT run
                if (cd.contractStatus === 'pending') {
                  console.log(`[BulkPing] Contract pending for ${app.name} (app: ${cd.appName}) — skipping ping`);
                  return {
                    appId: app.id,
                    clientId: null,
                    clientSecret: null,
                    apiInstanceId: apiInstanceId,  // saved for retry after approval
                    contractApp: cd.appName || '—',
                    apiInstanceName: data.matchedApis[0]?.label || '—',
                    source: 'contract-pending',
                    contractStatus: 'pending',
                  };
                }
              } catch { /* contract fallback failed — skip */ }
            }
          }
          return null;
        } catch { return null; }
      })
    );
    const resolved = {};
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) resolved[r.value.appId] = r.value; });
    return resolved;
  }, [hasCredentials, resolveFromCandidates, apps, clientId, fetchAppApiProps]);

  const runAll = async () => {
    setRunning(false);
    setResults({});
    setAutoResolvedMap({});

    // Step 1: auto-resolve credentials in parallel for all apps
    let resolvedCreds = {};
    if (hasCredentials && !clientId.trim()) {
      setResolving(true);
      resolvedCreds = await resolveAllCredentials();
      setAutoResolvedMap(resolvedCreds);
      setResolving(false);
    }

    setRunning(true);
    const collectedResults = {};

    // ── Auto-fetch JWT for a single app (CPS non-secure → secure scan) ──────
    const fetchJwtForApp = async (app, appClientId, appClientSecret) => {
      if (!appClientId || !appClientSecret) return null;
      const bgId = app._bgId;
      const envId = app.environment?.id;
      try {
        let cpsBaseUrl = '', cpsKey = '', cpsEnv = '';
        try {
          const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}/${app.id}`);
          const ds = r.data?.target?.deploymentSettings || {};
          const appCfg = r.data?.application?.configuration || {};
          const ps = appCfg['mule.agent.application.properties.service'] || {};
          const rp = { ...r.data?.properties, ...(ps.properties || {}), ...(ds.runtimeProperties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || {}) };
          cpsBaseUrl = rp['cps.configServerBaseUrl'] || rp['config.server.base.url'] || '';
          cpsKey = rp['cps.projectName'] || rp['cloudhub.api.name'] || app.name;
          cpsEnv = rp['cps.prefix'] || rp['cps.environment'] || '';
        } catch { return null; }
        if (!cpsBaseUrl || !cpsKey) return null;
        let tokenUrl = null;
        try {
          const nsRes = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: bgId } });
          const nsProps = flattenCpsResponse(nsRes.data);
          tokenUrl = findOAuth2Url(nsProps) || null;
          if (!tokenUrl) {
            // Scan ALL secure keys for an OAuth2 token URL (not just jwt/auth named keys)
            const secKeys = (nsProps['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean);
            if (secKeys.length > 0) {
              const sr = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'secure', keys: secKeys.join(','), ...(cpsEnv && { environment: cpsEnv }), bgOrgId: bgId } });
              const groups = Array.isArray(sr.data?.responses) ? sr.data.responses : Array.isArray(sr.data) ? sr.data : [];
              for (const g of groups) { const u = findOAuth2Url(g.properties || {}); if (u) { tokenUrl = u; break; } }
            }
          }
        } catch { return null; }
        if (!tokenUrl) return null;
        const tr = await api.post('/health/oauth2-token', { tokenUrl, clientId: appClientId, clientSecret: appClientSecret });
        return tr.data?.access_token || null;
      } catch { return null; }
    };

    /**
     * Ping a single app and return its result.
     * Fetches CH2 ingress URL on-demand, uses resolved or manual credentials.
     * If initial ping returns 4xx and CPS is configured, auto-fetches JWT and retries.
     */
    const pingApp = async (app) => {
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      let ch2IngressUrl = undefined;

      if (!isCH1 && app._bgId && app.environment?.id && app.id) {
        try {
          const detail = await api.get(`/applications/cloudhub2/${app._bgId}/${app.environment.id}/${app.id}`);
          const ds = detail.data?.target?.deploymentSettings || {};
          const httpInbound = ds.http?.inbound || {};
          const endpoints = httpInbound.endpoints || [];
          ch2IngressUrl =
            httpInbound.publicUrl ||
            endpoints.find(e => e.access === 'external')?.url ||
            endpoints[0]?.url ||
            undefined;
        } catch {}
      }

      const auto = resolvedCreds[app.id];

      // Skip ping entirely for apps with a pending contract approval
      if (auto?.source === 'contract-pending') {
        return {
          appId: app.id,
          result: {
            status: 'SKIPPED_CONTRACT_PENDING',
            error: `Contract pending approval for "${auto.contractApp}". Approve in API Manager, then use the Retry button.`,
            contractApp: auto.contractApp,
            apiInstanceId: auto.apiInstanceId,
          },
        };
      }

      const useClientId     = clientId.trim()     || auto?.clientId     || undefined;
      const useClientSecret = clientSecret.trim() || auto?.clientSecret || undefined;

      try {
        const { data } = await api.post('/health/ping', {
          targetType: isCH1 ? 'CH1' : 'CH2',
          appName: app.name,
          ch2IngressUrl,
          clientId: useClientId,
          clientSecret: useClientSecret,
          transactionId: transactionId.trim() && transactionId.trim() !== 'smokeTest' ? transactionId.trim() : generateTxId(),
          envType: app.environment?.type || '',
          envName: app.environment?.name || '',
          orgId: app._bgId,
          envId: app.environment?.id,
        });

        // If ping returned 4xx (PARTIAL), try auto-fetching JWT and retrying
        if (data.status === 'PARTIAL' && data.httpStatus >= 400 && data.httpStatus < 500 && !isCH1) {
          const jwt = await fetchJwtForApp(app, useClientId, useClientSecret);
          if (jwt) {
            try {
              const jwtData = await api.post('/health/ping', {
                targetType: 'CH2',
                appName: app.name,
                ch2IngressUrl,
                bearerToken: jwt,
                transactionId: transactionId.trim() && transactionId.trim() !== 'smokeTest' ? transactionId.trim() : generateTxId(),
                envType: app.environment?.type || '',
                envName: app.environment?.name || '',
                orgId: app._bgId,
                envId: app.environment?.id,
              });
              return { appId: app.id, result: { ...jwtData.data, _jwtUsed: true } };
            } catch { /* fall through to original result */ }
          }
        }

        return { appId: app.id, result: data };
      } catch (err) {
        return { appId: app.id, result: { status: 'FAILED', error: err.message } };
      }
    };

    // Run pings in parallel batches of 10 to balance speed vs rate limiting.
    // 100 apps → ~10 batches × ~5s avg = ~50s total (vs ~500s sequential).
    const BATCH_SIZE = 10;
    for (let i = 0; i < apps.length; i += BATCH_SIZE) {
      const batch = apps.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(batch.map(pingApp));
      batchResults.forEach(r => {
        if (r.status === 'fulfilled') {
          const { appId, result } = r.value;
          collectedResults[appId] = result;
          setResults(prev => ({ ...prev, [appId]: result }));
        }
      });
    }

    setRunning(false);
    // Navigate to Ping Test Results page with full results + auto-resolved credential info
    navigate('/ping-test', { state: { preloadedResults: collectedResults, preloadedApps: apps, autoResolvedMap: resolvedCreds } });
    onClose();
  };

  const done = Object.keys(results).length;
  const success = Object.values(results).filter(r => r.status === 'SUCCESS').length;
  const partial = Object.values(results).filter(r => r.status === 'PARTIAL').length;
  const failed = Object.values(results).filter(r => r.status === 'FAILED').length;

  const latencyColor = ms => !ms ? 'text-gray-500' : ms < 300 ? 'text-sfgreen-600' : ms < 1000 ? 'text-sforange-600' : 'text-sfred-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/80 rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-700/60 flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-teal-50/80 dark:from-teal-500/[0.07] to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-teal-100 dark:bg-teal-500/15 shadow-sm">
              <Activity size={18} className="text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h2 className="text-gray-900 dark:text-gray-100 font-bold text-base">Bulk Ping Test</h2>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{apps.length} application{apps.length !== 1 ? 's' : ''} selected</p>
            </div>
          </div>
          <div className="relative flex items-center gap-2 flex-shrink-0">
            <CredentialImportButton compact />
            <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-xl transition-colors"><X size={16} /></button>
          </div>
        </div>

        {/* Credential inputs */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700/60 flex-shrink-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold block mb-1.5">
                client_id <span className="normal-case font-medium text-gray-400 dark:text-gray-500">(overrides auto)</span>
              </label>
              <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="leave blank to auto-resolve"
                className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold block mb-1.5">client_secret</label>
              <div className="relative">
                <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type={showSecret ? 'text' : 'password'} placeholder="optional"
                  className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 pr-8 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all" />
                <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xs transition-colors">{showSecret ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold block mb-1.5">x-transaction-id</label>
              <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest"
                className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all" />
            </div>
          </div>
          {/* Credential import status */}
          {hasCredentials && !clientId.trim() && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <ShieldCheck size={11} />
              Credentials CSV loaded — will auto-resolve per app from API Manager
            </div>
          )}
        </div>

        {/* Resolving banner */}
        {resolving && (
          <div className="px-6 py-2.5 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 flex-shrink-0 bg-emerald-50/40 dark:bg-emerald-500/5">
            <RefreshCw size={12} className="animate-spin" />
            Resolving credentials from API Manager…
          </div>
        )}

        {/* Progress summary */}
        {done > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700/60 flex items-center gap-2.5 text-xs flex-shrink-0 flex-wrap">
            <span className="font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-2 py-1 rounded-lg">{done}/{apps.length} tested</span>
            {success > 0 && <span className="font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg">✓ {success} healthy</span>}
            {partial > 0 && <span className="font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-lg">~ {partial} partial</span>}
            {failed > 0 && <span className="font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-lg">✗ {failed} failed</span>}
            {Object.keys(autoResolvedMap).length > 0 && (
              <span className="flex items-center gap-1 font-semibold text-gray-500 dark:text-gray-400">
                <ShieldCheck size={11} className="text-emerald-500" />{Object.keys(autoResolvedMap).length} auto-creds
              </span>
            )}
          </div>
        )}

        {/* Results list — each app gets a full PingResultCard */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3 bg-gray-50/40 dark:bg-gray-900/20">
          {apps.map(app => (
            <PingResultCard
              key={app.id}
              app={app}
              result={results[app.id]}
              loading={running && !results[app.id]}
              autoResolved={autoResolvedMap[app.id]}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 flex items-center justify-between flex-shrink-0 bg-white dark:bg-gray-800 gap-3">
          <p className="text-gray-400 dark:text-gray-500 text-[11px] hidden sm:block">Pings /api/v1/ping → /api/v2/ping → /api/ping → /ping in order</p>
          <div className="flex items-center gap-2.5 ml-auto">
            <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">Close</button>
            <button onClick={runAll} disabled={running || resolving}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gradient-to-b from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl shadow-md shadow-teal-500/30 hover:shadow-lg hover:shadow-teal-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0">
              {resolving ? <><RefreshCw size={13} className="animate-spin" /> Resolving…</> : running ? <><RefreshCw size={13} className="animate-spin" /> Running…</> : <><Activity size={13} /> Run All Pings</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Export Apps Modal ──────────────────────────────────── */
// Multi-select BGs + Envs, pre-seeded from global BG/Env filters.
// Produces one xlsx sheet per selected environment.
function ExportAppsModal({ apps, allBusinessGroups, environments, onClose }) {
  // Honour the same global filters the main page uses
  const globalBgs  = useMemo(() => applyBgFilter(allBusinessGroups),  [allBusinessGroups]);
  const globalEnvs = useMemo(() => applyEnvFilter(environments), [environments]);

  const [selBgIds,  setSelBgIds]  = useState(() => new Set(globalBgs.map(g => g.id)));
  const [selEnvIds, setSelEnvIds] = useState(() => new Set(globalEnvs.map(e => e.id)));
  const [bgSearch,  setBgSearch]  = useState('');
  const [envSearch, setEnvSearch] = useState('');

  // Environments that have at least one app in the selected BGs
  const availableEnvs = useMemo(() => {
    const bgEnvIds = new Set(
      apps.filter(a => selBgIds.has(a._bgId)).map(a => a.environment?.id).filter(Boolean)
    );
    return globalEnvs.filter(e => bgEnvIds.has(e.id));
  }, [selBgIds, globalEnvs, apps]);

  // When BG selection changes, drop env selections that have no apps there
  useEffect(() => {
    const availIds = new Set(availableEnvs.map(e => e.id));
    setSelEnvIds(prev => new Set([...prev].filter(id => availIds.has(id))));
  }, [availableEnvs]);

  // Apps matching selected BGs + selected Envs
  const exportApps = useMemo(() =>
    apps.filter(a => selBgIds.has(a._bgId) && selEnvIds.has(a.environment?.id)),
    [apps, selBgIds, selEnvIds]
  );

  // Per-env app counts (only for selected envs)
  const envCounts = useMemo(() => {
    const c = {};
    exportApps.forEach(a => { const id = a.environment?.id; if (id) c[id] = (c[id] || 0) + 1; });
    return c;
  }, [exportApps]);

  const toggleBg  = id => setSelBgIds(prev  => { const n = new Set(prev);  n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleEnv = id => setSelEnvIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allBgsChecked  = globalBgs.length     > 0 && globalBgs.every(g     => selBgIds.has(g.id));
  const allEnvsChecked = availableEnvs.length > 0 && availableEnvs.every(e => selEnvIds.has(e.id));

  const selectedEnvCount = availableEnvs.filter(e => selEnvIds.has(e.id) && envCounts[e.id] > 0).length;

  const doExport = () => {
    if (exportApps.length === 0) return;
    const wb = XLSX.utils.book_new();

    // One sheet per env (in global env order, only envs with apps)
    const envsToExport = availableEnvs.filter(e => selEnvIds.has(e.id) && (envCounts[e.id] || 0) > 0);
    envsToExport.forEach(env => {
      const envApps = exportApps.filter(a => a.environment?.id === env.id);
      const rows = envApps.map(app => ({
        'Integration Name': app.name            || '—',
        'Mule Version':     app.muleVersion     || '—',
        'Status':           (app.status || '—').toUpperCase(),
        'Deployment Type':  app.deploymentType  || '—',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const headers = Object.keys(rows[0]);
      ws['!cols'] = headers.map(h => ({
        wch: Math.max(h.length, ...rows.map(r => String(r[h] || '').length)) + 2,
      }));
      // Excel sheet names: max 31 chars, no invalid chars
      const sheetName = env.name.replace(/[/\\?*[\]:]/g, '').slice(0, 31) || 'Sheet';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    XLSX.writeFile(wb, `apps-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    onClose();
  };

  const filteredBgs  = globalBgs.filter(g => g.name.toLowerCase().includes(bgSearch.toLowerCase()));
  const filteredEnvs = availableEnvs.filter(e => e.name.toLowerCase().includes(envSearch.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/80 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-700/60 flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-purple-50/80 dark:from-purple-500/[0.07] to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-purple-100 dark:bg-purple-500/15 shadow-sm">
              <FileSpreadsheet size={18} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base">Export Applications</h3>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Download as an Excel workbook</p>
            </div>
          </div>
          <button onClick={onClose} className="relative text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-xl transition-colors flex-shrink-0"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* ── Business Groups ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">
                Business Groups
                <span className="ml-1.5 text-gray-400 dark:text-gray-500 normal-case font-medium">({selBgIds.size}/{globalBgs.length} selected)</span>
              </label>
              <button
                onClick={() => setSelBgIds(allBgsChecked ? new Set() : new Set(globalBgs.map(g => g.id)))}
                className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors">
                {allBgsChecked ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {globalBgs.length > 6 && (
              <div className="relative mb-2">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input value={bgSearch} onChange={e => setBgSearch(e.target.value)} placeholder="Filter BGs…"
                  className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 transition-all" />
              </div>
            )}
            <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1 rounded-xl border border-gray-100 dark:border-gray-700/50 p-1">
              {filteredBgs.map(g => (
                <button key={g.id} onClick={() => toggleBg(g.id)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left">
                  <div className={`w-[18px] h-[18px] rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                    selBgIds.has(g.id) ? 'bg-purple-600 border-purple-500 shadow-sm shadow-purple-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-purple-500'
                  }`}>
                    {selBgIds.has(g.id) && <Check size={11} className="text-white" />}
                  </div>
                  {g.parentId && <span className="w-3 flex-shrink-0" />}
                  <span className={`text-sm truncate flex-1 ${selBgIds.has(g.id) ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{g.name}</span>
                  {!g.parentId && (
                    <span className="text-[9px] bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold">Root</span>
                  )}
                </button>
              ))}
              {filteredBgs.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No BGs match</p>
              )}
            </div>
          </div>

          {/* ── Environments (each = one sheet tab) ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">
                Environments
                <span className="ml-1 text-gray-400 dark:text-gray-500 normal-case font-medium">— each = one sheet</span>
              </label>
              <button
                onClick={() => setSelEnvIds(allEnvsChecked ? new Set() : new Set(availableEnvs.map(e => e.id)))}
                className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors">
                {allEnvsChecked ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {availableEnvs.length > 6 && (
              <div className="relative mb-2">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input value={envSearch} onChange={e => setEnvSearch(e.target.value)} placeholder="Filter environments…"
                  className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/15 transition-all" />
              </div>
            )}
            <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1 rounded-xl border border-gray-100 dark:border-gray-700/50 p-1">
              {availableEnvs.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No environments found for selected BGs</p>
              ) : filteredEnvs.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">No environments match</p>
              ) : (
                filteredEnvs.map(e => {
                  const isProd = e.type === 'production';
                  const count  = envCounts[e.id] || 0;
                  return (
                    <button key={e.id} onClick={() => toggleEnv(e.id)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left">
                      <div className={`w-[18px] h-[18px] rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                        selEnvIds.has(e.id) ? 'bg-purple-600 border-purple-500 shadow-sm shadow-purple-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-purple-500'
                      }`}>
                        {selEnvIds.has(e.id) && <Check size={11} className="text-white" />}
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className={`text-sm flex-1 truncate ${selEnvIds.has(e.id) ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{e.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold ${
                        isProd ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      }`}>{e.type}</span>
                      {selEnvIds.has(e.id) && count > 0 && (
                        <span className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">{count} apps</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Preview ── */}
          <div className="bg-gradient-to-br from-purple-50 to-purple-50/40 dark:from-purple-500/10 dark:to-purple-500/5 border border-purple-200/60 dark:border-purple-400/20 rounded-2xl px-4 py-3.5">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <span className="text-purple-700 dark:text-purple-300 font-bold text-lg">{exportApps.length}</span>
              {' '}app{exportApps.length !== 1 ? 's' : ''} across{' '}
              <span className="text-purple-700 dark:text-purple-300 font-bold text-lg">{selectedEnvCount}</span>
              {' '}sheet{selectedEnvCount !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Columns per sheet: Integration Name · Mule Version · Status · Deployment Type
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 flex-shrink-0 bg-gray-50/50 dark:bg-gray-900/30">
          <button onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={doExport} disabled={exportApps.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 disabled:opacity-40 text-white rounded-xl shadow-md shadow-purple-500/30 hover:shadow-lg hover:shadow-purple-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0">
            <FileSpreadsheet size={14} />
            Export{exportApps.length > 0 ? ` (${exportApps.length} · ${selectedEnvCount} sheets)` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cache TTL constants ───────────────────────────────────────────────────────
//
// APP_STALE_MS is the EVICTION window — how long before the entry is deleted.
// The freshness threshold (FRESH_MS = 3 min) is fixed inside apiCache.js.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  0 – 3 min   : FRESH  — instant render, no network call                │
// │  3 – 20 min  : STALE  — instant render from cache + silent BG refresh  │
// │  > 20 min    : EXPIRED — full reload with loading spinner               │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Bug (before fix): APP_STALE_MS was set to 3 min — same as FRESH_MS.
// This collapsed the SWR window to 0 seconds: entries went from fresh
// directly to deleted, so ANY navigation longer than 3 minutes triggered a
// full cold reload with spinner.  Setting it to 20 min gives a 17-minute
// stale-but-usable window where the page renders instantly every time.
const APP_STALE_MS = 20 * 60 * 1000; // 20 min eviction (FRESH_MS = 3 min in apiCache.js)

/**
 * Standalone fetch helper used by the ApplicationsPage background-refresh path in loadApps.
 * Fetches apps + envs for the given BG IDs, merges them, stores in cache,
 * and returns { mergedApps, mergedEnvs }.
 * Does NOT touch any React state — callers apply the result themselves.
 */
async function _fetchAndCacheApps(bgId, bgIds, cacheKey) {
  const [appsResults, envsResults] = await Promise.all([
    Promise.allSettled(bgIds.map((id) => api.get(`/applications/summary/${id}`))),
    Promise.allSettled(bgIds.map((id) => api.get(`/environments/${id}`))),
  ]);

  const mergedApps = [];
  const mergedEnvs = [];
  const seenApps = new Set();
  const seenEnvs = new Set();

  appsResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      (r.value.data.data || []).forEach((a) => {
        const key = `${a.id}|${a.environment?.id || ''}`;
        if (!seenApps.has(key)) { seenApps.add(key); mergedApps.push({ ...a, _bgId: bgIds[i] }); }
      });
    }
  });
  envsResults.forEach((r) => {
    if (r.status === 'fulfilled') {
      (r.value.data.data || []).forEach((e) => {
        if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
      });
    }
  });

  // Use APP_STALE_MS (20 min) so entries stay stale-but-usable for 17 min
  // after the 3-min freshness window expires — no cold reload needed.
  setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs }, APP_STALE_MS);
  return { mergedApps, mergedEnvs };
}

export default function ApplicationsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);
  // Persist BG selection in localStorage so it survives navigation
  const [selectedBg, setSelectedBg] = useState(
    () => localStorage.getItem('mule_dashboard_selected_bg') || ''
  );
  // Keep localStorage in sync whenever selectedBg changes
  useEffect(() => {
    if (selectedBg) localStorage.setItem('mule_dashboard_selected_bg', selectedBg);
  }, [selectedBg]);
  const [environments, setEnvironments] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bgLoading, setBgLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Persist selected environment across navigation (like selectedBg)
  const [filterEnv, setFilterEnv] = useState(
    () => localStorage.getItem('mule_dashboard_filter_env') || ''
  );
  useEffect(() => {
    if (filterEnv) localStorage.setItem('mule_dashboard_filter_env', filterEnv);
    else localStorage.removeItem('mule_dashboard_filter_env');
  }, [filterEnv]);
  useEffect(() => {
    if (!filterEnv || environments.length === 0) return;
    if (!environments.some(e => e.id === filterEnv)) setFilterEnv('');
  }, [environments]);
  // Persist status and type filters
  const [filterStatus, setFilterStatus] = useState(
    () => localStorage.getItem('mule_dashboard_filter_status') || ''
  );
  useEffect(() => {
    if (filterStatus) localStorage.setItem('mule_dashboard_filter_status', filterStatus);
    else localStorage.removeItem('mule_dashboard_filter_status');
  }, [filterStatus]);
  const [filterType, setFilterType] = useState(
    () => localStorage.getItem('mule_dashboard_filter_type') || ''
  );
  useEffect(() => {
    if (filterType) localStorage.setItem('mule_dashboard_filter_type', filterType);
    else localStorage.removeItem('mule_dashboard_filter_type');
  }, [filterType]);
  // ── Env filter version ────────────────────────────────────────────────────
  // Increments whenever the EnvFilterModal saves a new selection to localStorage.
  // This triggers the `filtered` useMemo to re-run and pick up the new filter.
  const [envFilterVersion, setEnvFilterVersion] = useState(0);
  const [bgFilterVersion, setBgFilterVersion] = useState(0); // eslint-disable-line no-unused-vars
  useEffect(() => {
    const handler = () => setEnvFilterVersion(v => v + 1);
    window.addEventListener('envFilterChanged', handler);
    return () => window.removeEventListener('envFilterChanged', handler);
  }, []);
  useEffect(() => {
    const handler = () => setBgFilterVersion(v => v + 1);
    window.addEventListener('bgFilterChanged', handler);
    return () => window.removeEventListener('bgFilterChanged', handler);
  }, []);

  const [error, setError] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [showExportApps, setShowExportApps] = useState(false);
  const [showBulkPing, setShowBulkPing] = useState(false);

  // Single-app action states
  const [actionLoading, setActionLoading] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [actionResult, setActionResult] = useState(null);

  // Multi-select states
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);

  // CSV upload state — matched app names from uploaded file
  const [csvMatchedNames, setCsvMatchedNames] = useState(null); // null = not uploaded
  const [csvFileName, setCsvFileName] = useState('');
  // 'exact' = app.name must exactly equal a CSV name | 'fuzzy' = substring match
  const [csvMatchMode, setCsvMatchMode] = useState('exact');
  // Set of env IDs to scope CSV matching — empty Set = match all loaded apps
  const [csvEnvFilter, setCsvEnvFilter] = useState(new Set());
  const [csvEnvDropOpen, setCsvEnvDropOpen] = useState(false);
  const csvEnvDropRef = useRef(null);
  const csvInputRef = useRef(null);
  // Tracks the cache key currently registered for proactive background refresh
  // so we can unregister it when the BG selection changes or the page unmounts.
  // Close env dropdown on outside click
  useEffect(() => {
    if (!csvEnvDropOpen) return;
    const handler = (e) => {
      if (csvEnvDropRef.current && !csvEnvDropRef.current.contains(e.target)) {
        setCsvEnvDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [csvEnvDropOpen]);

  const keepFreshKeyRef = useRef(null);
  // Feature 1: column sort state
  const [sortColumn, setSortColumn] = useState('');
  const [sortDir, setSortDir]       = useState('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const handleSort = (col) => {
    if (sortColumn === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortColumn !== col) return <span className="text-gray-300 dark:text-gray-600 ml-0.5">⇅</span>;
    return <span className="text-sf-600 dark:text-sf-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  /**
   * Match CSV names against the app pool, respecting mode and env scope.
   * Extracted as a plain function (not useCallback) so it can be called
   * both from handleCsvUpload and from the re-apply useEffect.
   */
  const runCsvMatch = useCallback((appPool, csvNames, mode, envFilterSet) => {
    // If env filter set is non-empty, restrict to those envs; otherwise use all loaded apps
    const pool = envFilterSet.size > 0
      ? appPool.filter(a => envFilterSet.has(a.environment?.id))
      : appPool;
    if (mode === 'exact') {
      return pool.filter(a => csvNames.includes(a.name.toLowerCase()));
    }
    return pool.filter(a =>
      csvNames.some(n => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()))
    );
  }, []);

  // Re-apply CSV matching whenever mode or env filter set changes
  useEffect(() => {
    if (!csvMatchedNames?.length) return;
    const matched = runCsvMatch(apps, csvMatchedNames, csvMatchMode, csvEnvFilter);
    setSelectedIds(new Set(matched.map(a => a.id)));
  }, [csvMatchMode, csvEnvFilter, csvMatchedNames, apps]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCsvUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result || '';
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) { setCsvMatchedNames([]); return; }
      const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const nameColIdx = header.findIndex(h => ['appname', 'name', 'domain', 'application'].includes(h));
      let rawNames;
      if (nameColIdx >= 0) {
        rawNames = lines.slice(1).map(l => l.split(',')[nameColIdx]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      } else {
        rawNames = lines.map(l => l.split(',')[0]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
      const normalised = rawNames.map(n => n.toLowerCase());
      setCsvMatchedNames(normalised);
      // Initial selection — useEffect will also fire after state settles
      setApps(current => {
        const matched = runCsvMatch(current, normalised, csvMatchMode, csvEnvFilter);
        setSelectedIds(new Set(matched.map(a => a.id)));
        return current;
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [csvMatchMode, csvEnvFilter, runCsvMatch]);

  useEffect(() => { if (orgId) loadBusinessGroups(); }, [orgId]);
  // Only re-load when selectedBg changes AND BGs are already loaded.
  // On initial mount, loadBusinessGroups calls loadApps directly with fresh BGs,
  // so this effect should only fire for subsequent user-driven BG changes.
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadApps(selectedBg);
  }, [selectedBg]); // eslint-disable-line react-hooks/exhaustive-deps
  // Track mount state so background refresh doesn't set state on unmounted component
  // We intentionally do NOT stop keepFresh on unmount so the cache stays warm globally.
  const isMounted = useRef(true);
  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => { setSelectedIds(new Set()); }, [selectedBg]);

  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const cacheKey = CK.bgs(orgId);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        // Render instantly from cache (stale or fresh) — no spinner shown
        setAllBusinessGroups(swr.data);
        const savedBg = localStorage.getItem('mule_dashboard_selected_bg');
        const isValidSaved = savedBg && (savedBg === '__all__' || swr.data.some(g => g.id === savedBg));
        const newBg = isValidSaved ? savedBg : '__all__';
        setSelectedBg(newBg);
        setBgLoading(false);
        await loadApps(newBg, false, swr.data);
        // If stale, silently refresh in background without blocking the UI
        if (swr.stale) {
          api.get('/organizations/business-groups')
            .then(r => {
              const fresh = r.data.data || [];
              setCached(cacheKey, fresh, 30 * 60 * 1000);
              setAllBusinessGroups(fresh);
            })
            .catch(() => {});
        }
        return;
      }
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      // BGs rarely change — store with a 30-min eviction window
      setCached(cacheKey, groups, 30 * 60 * 1000);
      setAllBusinessGroups(groups);
      const savedBg = localStorage.getItem('mule_dashboard_selected_bg');
      const isValidSaved = savedBg && (savedBg === '__all__' || groups.some(g => g.id === savedBg));
      const newBg = isValidSaved ? savedBg : '__all__';
      setSelectedBg(newBg);
      // Call loadApps with fresh BGs directly — avoids stale allBusinessGroups closure
      await loadApps(newBg, false, groups);
    } catch { setSelectedBg(orgId); }
    setBgLoading(false);
  };

  const loadApps = async (bgId, forceRefresh = false, bgsOverride) => {
    // bgsOverride: pass fresh BGs when called directly from loadBusinessGroups
    // to avoid stale closure when allBusinessGroups state hasn't updated yet
    const visible = applyBgFilter(bgsOverride || allBusinessGroups);
    const bgIds = bgId === '__all__'
      ? (visible.length > 0 ? visible.map(g => g.id) : [orgId])
      : [bgId];

    // ── Frontend cache — SWR (stale-while-revalidate) ────────────────────────
    // Render instantly from any usable cached value, then silently re-fetch
    // in the background when the entry is older than FRESH_MS (3 min).
    if (!forceRefresh) {
      const cacheKey = CK.apps(bgId, bgIds);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        setApps(swr.data.apps);
        setEnvironments(swr.data.envs);
        setError(swr.data.apps.length === 0 ? 'No applications found.' : '');
        setSelectedIds(new Set());
        if (swr.stale) {
          // Background refresh — no loading spinner, UI stays responsive
          _fetchAndCacheApps(bgId, bgIds, cacheKey).then(({ mergedApps, mergedEnvs }) => {
            setApps(mergedApps);
            setEnvironments(mergedEnvs);
            if (mergedApps.length === 0) setError('No applications found.');
          }).catch(() => {});
        }
        return; // instant — no network call blocks the UI
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    setLoading(true);
    setError('');
    setSelectedIds(new Set());
    try {
      const params = forceRefresh ? { params: { refresh: 'true' } } : {};
      const [appsResults, envsResults] = await Promise.all([
        Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`, params))),
        Promise.allSettled(bgIds.map(id => api.get(`/environments/${id}`))),
      ]);

      const mergedApps = [];
      const mergedEnvs = [];
      const seenApps = new Set();
      const seenEnvs = new Set();

      appsResults.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(a => {
            const key = `${a.id}|${a.environment?.id || ''}`;
            if (!seenApps.has(key)) { seenApps.add(key); mergedApps.push({ ...a, _bgId: bgIds[i] }); }
          });
        }
      });
      envsResults.forEach(r => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(e => {
            if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
          });
        }
      });

      setApps(mergedApps);
      setEnvironments(mergedEnvs);
      if (mergedApps.length === 0) setError('No applications found.');

      // Store in frontend cache — APP_STALE_MS eviction window (20 min)
      // FRESH_MS (3 min) is fixed inside apiCache.js, giving a 17-min SWR window.
      const cacheKey = CK.apps(bgId, bgIds);
      setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs }, APP_STALE_MS);

      // Proactive background refresh — the idle sweep will re-fetch this entry
      // when it goes stale (after 3 min), so the cache is NEVER cold while the
      // page is open. Navigation to this page will always be instant.
      if (keepFreshKeyRef.current && keepFreshKeyRef.current !== cacheKey) {
        stopKeepingFresh(keepFreshKeyRef.current); // unregister previous BG key
      }
      keepFreshKeyRef.current = cacheKey;
      keepFresh(cacheKey, () =>
        _fetchAndCacheApps(bgId, bgIds, cacheKey).then(({ mergedApps: ma, mergedEnvs: me }) => {
          if (isMounted.current) {
            setApps(ma);
            setEnvironments(me);
          }
          return { apps: ma, envs: me }; // returned value is stored by the sweep
        })
      );
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load applications.');
      setApps([]);
    }
    setLoading(false);
  };

  /* ── Single-app action ─────────────────────────────── */
  const requestAction = (e, app, action) => {
    e.stopPropagation();
    setActionResult(null);
    setConfirmState({ app, action });
  };

  const executeAction = async () => {
    if (!confirmState) return;
    const { app, action } = confirmState;
    setActionLoading((prev) => ({ ...prev, [app.id]: action }));
    try {
      const isCH2 = app.deploymentType === 'CloudHub 2.0';
      const envId = app.environment?.id;
      const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
      if (isCH2) {
        await api.post(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}/action`, { action });
      } else {
        await api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${appBgId}`, { action });
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApps((prev) => prev.map((a) => a.id === app.id ? { ...a, status: nextStatus } : a));
      bustCache(CK.PREFIX.apps); // invalidate cached lists so Refresh picks up real status
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action} ${app.name}: ${e.response?.data?.error || e.message}` });
    } finally {
      setActionLoading((prev) => ({ ...prev, [app.id]: null }));
      setConfirmState(null);
      setTimeout(() => setActionResult(null), 6000);
    }
  };

  /* ── Multi-select ──────────────────────────────────── */
  const filtered = useMemo(() => {
    // Env filter modal: build a Set of visible env IDs from localStorage.
    // Called inside the memo so it always reads the current localStorage value
    // when envFilterVersion changes (i.e. after the modal saves).
    const visEnvIds = new Set(applyEnvFilter(environments).map(e => e.id));
    const envModalActive = environments.length > 0 && visEnvIds.size < environments.length;

    return apps.filter((a) => {
      // If env filter modal is active, only show apps whose environment is visible
      if (envModalActive && !visEnvIds.has(a.environment?.id)) return false;
      const matchSearch = !search || a.name?.toLowerCase().includes(search.toLowerCase());
      const matchEnv = !filterEnv || a.environment?.id === filterEnv;
      const matchStatus = !filterStatus || (a.status || '').toUpperCase() === filterStatus.toUpperCase();
      const matchType = !filterType || a.deploymentType === filterType;
      return matchSearch && matchEnv && matchStatus && matchType;
    });
  }, [apps, environments, search, filterEnv, filterStatus, filterType, envFilterVersion]);

  const allSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const someSelected = !allSelected && filtered.some((a) => selectedIds.has(a.id));
  // selectedApps is derived from ALL loaded apps (not just filtered) so that
  // selections persist when the user changes env/status/type/search filters.
  // This allows selecting apps from multiple environments and pinging them all.
  const selectedApps = apps.filter((a) => selectedIds.has(a.id));

  // Feature 2: status summary counts from current filtered set
  const statusSummary = useMemo(() => {
    const c = {};
    filtered.forEach(a => { const s = (a.status || 'UNKNOWN').toUpperCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [filtered]);

  // Feature 7: status counts from ALL loaded apps (for filter dropdown badges)
  const statusCountsAll = useMemo(() => {
    const c = {};
    apps.forEach(a => { const s = (a.status || 'UNKNOWN').toUpperCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [apps]);

  // Selected rows float to the top, then apply column sort (Feature 1)
  const displayFiltered = useMemo(() => {
    let result = selectedIds.size === 0 ? [...filtered] : [...filtered].sort((a, b) => {
      const aS = selectedIds.has(a.id) ? 0 : 1;
      const bS = selectedIds.has(b.id) ? 0 : 1;
      return aS - bS;
    });
    if (sortColumn) {
      const getValue = (a) => {
        if (sortColumn === 'name')         return (a.name || '').toLowerCase();
        if (sortColumn === 'status')       return (a.status || '').toLowerCase();
        if (sortColumn === 'environment')  return (a.environment?.name || '').toLowerCase();
        if (sortColumn === 'type')         return (a.deploymentType || '').toLowerCase();
        if (sortColumn === 'muleVersion')  return (a.muleVersion || '').toLowerCase();
        if (sortColumn === 'lastModified') return a.lastModifiedDate || '';
        return '';
      };
      result.sort((a, b) => {
        const cmp = String(getValue(a)).localeCompare(String(getValue(b)));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [filtered, selectedIds, sortColumn, sortDir]);

  // Reset to page 1 whenever filters, search, sort, or BG selection change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterEnv, filterStatus, filterType, selectedBg, sortColumn, sortDir, filtered.length]);

  // Paginated slice of the display list
  const totalPages = Math.max(1, Math.ceil(displayFiltered.length / pageSize));
  const paginatedItems = displayFiltered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleRow = (e, appId) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(appId) ? next.delete(appId) : next.add(appId);
      return next;
    });
  };

  const toggleAll = (e) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected || someSelected) {
        filtered.forEach((a) => next.delete(a.id));
      } else {
        filtered.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  /* ── Bulk action ───────────────────────────────────── */
  const requestBulkAction = (action) => {
    setBulkResults(null);
    setBulkConfirm({ action, apps: selectedApps });
  };

  const executeBulkAction = async () => {
    if (!bulkConfirm) return;
    const { action, apps: targets } = bulkConfirm;
    setBulkLoading(true);
    setBulkResults(null);

    const settled = await Promise.allSettled(
      targets.map((app) => {
        const isCH2 = app.deploymentType === 'CloudHub 2.0';
        const envId = app.environment?.id;
        const appBgId = app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId);
        if (isCH2) {
          return api.post(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}/action`, { action });
        } else {
          return api.post(`/applications/cloudhub1/${envId}/${app.id}/action?orgId=${appBgId}`, { action });
        }
      })
    );

    const resultMap = {};
    const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';

    targets.forEach((app, i) => {
      const r = settled[i];
      resultMap[app.id] = r.status === 'fulfilled'
        ? { success: true }
        : { success: false, error: r.reason?.response?.data?.error || r.reason?.message || 'Failed' };
    });

    // Optimistic update for successful ones
    setApps((prev) => prev.map((a) => resultMap[a.id]?.success ? { ...a, status: nextStatus } : a));
    bustCache(CK.PREFIX.apps); // invalidate cached lists after bulk status change
    setBulkResults(resultMap);
    setBulkLoading(false);
    // Keep only failed ones selected
    setSelectedIds((prev) => {
      const next = new Set(prev);
      targets.forEach((a) => { if (resultMap[a.id]?.success) next.delete(a.id); });
      return next;
    });
  };

  const bulkActions = useMemo(() => {
    if (selectedApps.length === 0) return [];
    const canStart   = selectedApps.some((a) => availableActions(a.status).includes('start'));
    const canStop    = selectedApps.some((a) => availableActions(a.status).includes('stop'));
    const canRestart = selectedApps.some((a) => availableActions(a.status).includes('restart'));
    return [
      ...(canStart   ? ['start']   : []),
      ...(canStop    ? ['stop']    : []),
      ...(canRestart ? ['restart'] : [])
    ];
  }, [selectedApps]);

  /* ── Export Apps to XLSX ───────────────────────────── */
  const exportAppsToXlsx = useCallback(() => {
    const source = selectedApps.length > 0 ? selectedApps : filtered;
    if (source.length === 0) return;

    const rows = source.map(app => ({
      'Environment': app.environment?.name || '—',
      'Integration Name': app.name || '—',
      'Mule Version': app.muleVersion || '—',
      'Status': (app.status || '—').toUpperCase(),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);

    // Auto-size columns
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map(h => ({
      wch: Math.max(h.length, ...rows.map(r => String(r[h] || '').length)) + 2,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Applications');

    const filename = `apps-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  }, [selectedApps, filtered]);

  /* ── Select options ────────────────────────────────── */
  // Apply BG filter to the visible list
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  // Apply Env filter to the loaded environments
  const visibleEnvs = applyEnvFilter(environments);
  const envFilterActive = visibleEnvs.length < environments.length;

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${visibleGroups.length}`, tagColor: 'bg-gray-200 text-gray-600' },
    ...visibleGroups.map((g) => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-sf-100 text-sf-600'
    })),
  ];

  const envOptions = [
    { value: '', label: 'All Environments' },
    ...visibleEnvs.map((e) => ({
      value: e.id, label: e.name, badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type, tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-200 text-gray-500'
    }))
  ];

  // Feature 7: status options with live counts from all loaded apps
  const statusOptions = [
    { value: '', label: 'All Statuses' },
    ...[
      { value: 'RUNNING',           label: 'Running',   badgeColor: 'bg-sfgreen-400' },
      { value: 'APPLIED',           label: 'Applied',   badgeColor: 'bg-sfteal-400' },
      { value: 'FAILED',            label: 'Failed',    badgeColor: 'bg-sfred-400' },
      { value: 'STOPPED',           label: 'Stopped',   badgeColor: 'bg-gray-400' },
      { value: 'DEPLOYING',         label: 'Deploying', badgeColor: 'bg-sf-400' },
      { value: 'UPDATING',          label: 'Updating',  badgeColor: 'bg-sfpurple-400' },
      { value: 'STARTING',          label: 'Starting',  badgeColor: 'bg-sf-300' },
      { value: 'STOPPING',          label: 'Stopping',  badgeColor: 'bg-sforange-400' },
      { value: 'PARTIALLY_STARTED', label: 'Partial',   badgeColor: 'bg-sforange-400' },
    ].map(s => ({
      ...s,
      badge: true,
      label: statusCountsAll[s.value]
        ? `${s.label} (${statusCountsAll[s.value]})`
        : s.label,
    })),
  ];

  const typeOptions = [
    { value: '', label: 'All Deployment Types' },
    { value: 'CloudHub 2.0', label: 'CloudHub 2.0', tag: 'CH2', tagColor: 'bg-sf-100 text-sf-600' },
    { value: 'CloudHub 1.0', label: 'CloudHub 1.0', tag: 'CH1', tagColor: 'bg-sfpurple-100 text-sfpurple-600' }
  ];

  const selectedBgName = selectedBg === '__all__'
    ? 'All Organizations'
    : visibleGroups.find((g) => g.id === selectedBg)?.name || 'Organization';

  return (
    <div className="space-y-5">
      {/* Modals */}
      <ConfirmModal
        state={confirmState}
        onConfirm={executeAction}
        onCancel={() => setConfirmState(null)}
        loading={!!actionLoading[confirmState?.app?.id]}
      />
      <BulkConfirmModal
        state={bulkConfirm}
        onConfirm={executeBulkAction}
        onCancel={() => { setBulkConfirm(null); setBulkResults(null); }}
        loading={bulkLoading}
        results={bulkResults}
      />

      {/* Bulk Ping Modal */}
      {showBulkPing && (
        <BulkPingModal
          apps={selectedApps.length > 0 ? selectedApps : filtered}
          onClose={() => setShowBulkPing(false)}
        />
      )}

      {/* Export Apps Modal */}
      {showExportApps && (
        <ExportAppsModal
          apps={apps}
          allBusinessGroups={allBusinessGroups}
          environments={environments}
          onClose={() => setShowExportApps(false)}
        />
      )}

      {/* CPS Export Modal */}
      {showExport && (
        <CpsExportModal
          apps={selectedApps.length > 0 ? selectedApps : filtered}
          bgOrgId={selectedBg !== '__all__' ? selectedBg : (selectedApps[0]?._bgId || orgId)}
          bgName={selectedBgName}
          selectedEnvId={filterEnv || ''}
          envName={filterEnv ? (environments.find(e=>e.id===filterEnv)?.name || '') : (filtered[0]?.environment?.name || '')}
          filterSummary={[
            selectedApps.length > 0 ? `${selectedApps.length} selected apps` : null,
            filterEnv ? `Env: ${environments.find(e=>e.id===filterEnv)?.name || filterEnv}` : null,
            filterStatus ? `Status: ${filterStatus}` : null,
            filterType ? `Type: ${filterType}` : null,
            search ? `Search: "${search}"` : null
          ].filter(Boolean).join(' · ')}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Header — title + inline CSV banner + action buttons all on one row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
          {/* Inline CSV banner — only when a CSV is uploaded */}
          {csvMatchedNames !== null && (
            <div className={`group relative flex items-center gap-2.5 flex-wrap pl-1 pr-3 py-1.5 rounded-2xl border transition-all ${
              selectedIds.size > 0
                ? 'bg-gradient-to-r from-sf-50 via-sf-50/60 to-transparent dark:from-sf-500/10 dark:via-sf-500/5 border-sf-200/70 dark:border-sf-400/30 shadow-sm'
                : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700'
            }`}>
              <span className={`flex items-center justify-center w-7 h-7 rounded-xl flex-shrink-0 ${
                selectedIds.size > 0 ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30' : 'bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400'
              }`}>
                <UploadCloud size={13} />
              </span>
              <div className="flex flex-col leading-tight">
                <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 max-w-[120px] truncate">{csvFileName}</span>
                {selectedIds.size > 0
                  ? <span className="text-sf-700 dark:text-sf-300 font-bold text-[11px]">{selectedIds.size} matched</span>
                  : <span className="text-gray-400 dark:text-gray-500 text-[10px]">no match</span>}
              </div>
              {csvMatchedNames.length > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">({csvMatchedNames.length} in CSV)</span>
              )}
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
              {/* Match mode */}
              <div className="flex items-center gap-0.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5 shadow-sm">
                {[['exact', 'Exact'], ['fuzzy', '~']].map(([mode, label]) => (
                  <button key={mode} onClick={() => setCsvMatchMode(mode)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold transition-all ${
                      csvMatchMode === mode ? 'bg-sf-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {/* Env dropdown */}
              {environments.length > 0 && (() => {
                const envList = applyEnvFilter(environments);
                const selNames = [...csvEnvFilter].map(id => envList.find(e => e.id === id)?.name).filter(Boolean);
                const dropLabel = csvEnvFilter.size === 0 ? 'All envs' : `${csvEnvFilter.size} envs`;
                return (
                  <>
                    <div className="relative" ref={csvEnvDropRef}>
                      <button onClick={() => setCsvEnvDropOpen(o => !o)}
                        className={`flex items-center gap-1 text-[9px] font-semibold rounded-lg px-2 py-1 border transition-colors ${
                          csvEnvFilter.size > 0
                            ? 'bg-sf-50 dark:bg-sf-500/10 border-sf-200/70 dark:border-sf-400/30 text-sf-700 dark:text-sf-300'
                            : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-sf-300/60 dark:hover:border-sf-400/40 hover:text-sf-700 dark:hover:text-sf-300'
                        }`}>
                        {dropLabel}
                        <span className={`transition-transform inline-block ${csvEnvDropOpen ? 'rotate-180' : ''}`}>▾</span>
                      </button>
                      {csvEnvDropOpen && (
                        <div className="absolute top-full left-0 mt-1.5 z-30 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl min-w-[11rem] overflow-hidden">
                          <div className="px-2 pt-2 pb-1 border-b border-gray-100 dark:border-gray-700">
                            <div className="relative">
                              <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                              <input autoFocus placeholder="Search…"
                                onChange={e => {
                                  const q = e.target.value.toLowerCase();
                                  csvEnvDropRef.current?.querySelectorAll('[data-env-name]').forEach(el => {
                                    el.style.display = el.dataset.envName.includes(q) ? '' : 'none';
                                  });
                                }}
                                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg pl-5 pr-2 py-1 text-[9px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500/50"
                              />
                            </div>
                          </div>
                          <div className="max-h-44 overflow-y-auto py-1">
                            {envList.map(env => {
                              const isSel = csvEnvFilter.has(env.id);
                              const isProd = env.type === 'production';
                              return (
                                <button key={env.id} data-env-name={env.name.toLowerCase()}
                                  onClick={() => setCsvEnvFilter(prev => { const n = new Set(prev); n.has(env.id) ? n.delete(env.id) : n.add(env.id); return n; })}
                                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left">
                                  <div className={`w-3.5 h-3.5 rounded-md border flex-shrink-0 flex items-center justify-center transition-colors ${isSel ? 'bg-sf-500 border-sf-400' : 'border-gray-300 dark:border-gray-600'}`}>
                                    {isSel && <span className="text-white text-[7px] font-bold leading-none">✓</span>}
                                  </div>
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isProd ? 'bg-sfgreen-400' : 'bg-sforange-400'}`} />
                                  <span className="text-[9px] text-gray-600 dark:text-gray-300">{env.name}</span>
                                </button>
                              );
                            })}
                          </div>
                          {csvEnvFilter.size > 0 && (
                            <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700">
                              <button onClick={() => { setCsvEnvFilter(new Set()); setCsvEnvDropOpen(false); }}
                                className="text-[9px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Clear</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {selNames.length > 0 && (
                      <span className="text-[9px] text-sf-700/80 dark:text-sf-300/80 font-medium truncate max-w-[140px]">{selNames.join(', ')}</span>
                    )}
                  </>
                );
              })()}
              {/* Close CSV */}
              <button onClick={() => { setCsvMatchedNames(null); setCsvFileName(''); setSelectedIds(new Set()); setCsvEnvFilter(new Set()); }}
                className="flex items-center justify-center w-5 h-5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0 transition-colors">
                <X size={12} />
              </button>
            </div>
          )}

        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Bulk actions — shown before Upload CSV when apps are selected */}
          {selectedApps.length > 0 && (
            <>
              <span className="text-[11px] text-sf-700 dark:text-sf-300 font-bold px-2 py-1 rounded-lg bg-sf-50 dark:bg-sf-500/10">{selectedApps.length} sel</span>
              <button onClick={() => setSelectedIds(new Set())}
                className="text-[10px] text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 underline underline-offset-2 transition-colors">Clear</button>
              {bulkActions.map(action => {
                const { Icon, label, bulkCls } = ACTION_CONFIG[action];
                return (
                  <button key={action} onClick={() => requestBulkAction(action)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${bulkCls}`}>
                    <Icon size={13} /> {label}
                  </button>
                );
              })}
              <span className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent mx-1 flex-shrink-0" />
            </>
          )}
          {/* Hidden CSV file input */}
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="hidden" />
          {/* CSV upload button */}
          <button onClick={() => csvInputRef.current?.click()}
            title="Upload a CSV of app names to auto-select matching apps"
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sf-700 dark:hover:text-sf-300 border border-gray-200 dark:border-gray-700 hover:border-sf-200/70 dark:hover:border-sf-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sf-100 dark:group-hover/tool:bg-sf-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sf-600 dark:group-hover/tool:text-sf-400 flex-shrink-0 transition-colors">
              <UploadCloud size={12} />
            </span>
            Upload CSV
          </button>
          <button onClick={() => setShowBulkPing(true)} disabled={loading || filtered.length === 0}
            title={selectedApps.length > 0 ? `Ping ${selectedApps.length} selected apps` : 'Ping all visible apps'}
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sfteal-700 dark:hover:text-sfteal-300 border border-gray-200 dark:border-gray-700 hover:border-sfteal-200/70 dark:hover:border-sfteal-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:shadow-none disabled:hover:shadow-none transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sfteal-100 dark:group-hover/tool:bg-sfteal-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sfteal-600 dark:group-hover/tool:text-sfteal-400 flex-shrink-0 transition-colors">
              <Activity size={12} />
            </span>
            {selectedApps.length > 0 ? `Ping (${selectedApps.length})` : 'Ping Test'}
          </button>
          <button
            onClick={() => setShowExportApps(true)}
            disabled={loading || apps.length === 0}
            title="Export apps to Excel — choose Business Group and Environment"
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sfpurple-700 dark:hover:text-sfpurple-300 border border-gray-200 dark:border-gray-700 hover:border-sfpurple-200/70 dark:hover:border-sfpurple-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:shadow-none disabled:hover:shadow-none transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sfpurple-100 dark:group-hover/tool:bg-sfpurple-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sfpurple-600 dark:group-hover/tool:text-sfpurple-400 flex-shrink-0 transition-colors">
              <FileSpreadsheet size={12} />
            </span>
            Export Apps
          </button>
          <button onClick={() => setShowExport(true)} disabled={loading || apps.length === 0}
            title={selectedApps.length > 0 ? `Export CPS for ${selectedApps.length} selected apps` : 'Export CPS Properties to Excel'}
            className="group/tool flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 hover:text-sfgreen-700 dark:hover:text-sfgreen-300 border border-gray-200 dark:border-gray-700 hover:border-sfgreen-200/70 dark:hover:border-sfgreen-400/30 px-3 py-2 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:shadow-none disabled:hover:shadow-none transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-gray-100 dark:bg-gray-700 group-hover/tool:bg-sfgreen-100 dark:group-hover/tool:bg-sfgreen-500/20 text-gray-500 dark:text-gray-400 group-hover/tool:text-sfgreen-600 dark:group-hover/tool:text-sfgreen-400 flex-shrink-0 transition-colors">
              <FileSpreadsheet size={12} />
            </span>
            {selectedApps.length > 0 ? `Export CPS (${selectedApps.length})` : 'Export CPS'}
          </button>
          <button onClick={() => loadApps(selectedBg, true)} disabled={loading || bgLoading}
            title="Refresh application list"
            className="flex items-center justify-center w-9 h-9 rounded-xl text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md disabled:opacity-50 transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Single-app toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success ? 'bg-sfgreen-50/40 border-sfgreen-200/50 text-sfgreen-700' : 'bg-sfred-50/40 border-sfred-200/50 text-sfred-700'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-400/30 rounded-2xl px-4 py-3 text-red-700 dark:text-red-300 text-sm shadow-sm">
          <AlertTriangle size={15} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Filters row — Search, BG, Env, Status, Type (no labels) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="relative group">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 group-focus-within:text-sf-500 pointer-events-none transition-colors" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search applications…"
              className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 dark:focus:ring-sf-400/15 transition-all" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
        {/* BG selector */}
        <div className="lg:col-span-1">
          <Select
            value={selectedBg}
            onChange={(v) => {
              setSelectedBg(v);
              setSearch('');
              setFilterEnv('');
              setFilterStatus('');
              setFilterType('');
              localStorage.removeItem('mule_dashboard_filter_status');
              localStorage.removeItem('mule_dashboard_filter_type');
              localStorage.removeItem('mule_dashboard_filter_env');
            }}
            options={bgOptions}
            placeholder="All Organizations…"
            searchable={visibleGroups.length > 5}
            disabled={bgLoading}
          />
          {filterActive && (
            <p className="text-[10px] text-sf-600 dark:text-sf-400 font-medium mt-1 pl-1">
              {visibleGroups.length}/{allBusinessGroups.length} shown
            </p>
          )}
        </div>
        <div><Select value={filterEnv} onChange={setFilterEnv} options={envOptions} placeholder="All Environments" searchable /></div>
        <div><Select value={filterStatus} onChange={setFilterStatus} options={statusOptions} placeholder="All Statuses" /></div>
        <div><Select value={filterType} onChange={setFilterType} options={typeOptions} placeholder="All Types" /></div>
      </div>


      {loading ? (
        /* Feature 1.1: skeleton table rows matching the real table structure */
        <div className="bg-white dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-800/90 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3 w-10" />
                <th className="text-left px-4 py-3">Application</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Environment</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Mule Version</th>
                <th className="text-left px-4 py-3">Last Modified</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(8)].map((_, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60 animate-pulse">
                  <td className="px-4 py-3.5"><div className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-3 rounded bg-gray-100 dark:bg-gray-700" style={{ width: `${100 + (i % 5) * 30}px` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><div className="h-5 w-20 rounded-full bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-gray-600" />
                      <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-700" />
                    </div>
                  </td>
                  <td className="px-4 py-3.5"><div className="h-5 w-24 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-3 w-20 rounded bg-gray-100 dark:bg-gray-700" /></td>
                  <td className="px-4 py-3.5"><div className="h-6 w-14 rounded-lg bg-gray-100 dark:bg-gray-700 mx-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative bg-white dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-800/90 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* Feature 6: overflow-y-auto on this inner div makes sticky thead work.
              The outer div keeps overflow-hidden for border-radius clipping. */}
          <div className="overflow-y-auto max-h-[72vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/95 dark:bg-gray-900/95 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider backdrop-blur-sm border-b border-gray-200 dark:border-white/[0.08]">
                {/* Select-all checkbox */}
                <th className="px-4 py-3.5 w-10" onClick={toggleAll}>
                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center cursor-pointer transition-all ${
                    allSelected ? 'bg-sf-600 border-sf-500 shadow-sm shadow-sf-500/30' : someSelected ? 'bg-sf-100 dark:bg-sf-500/20 border-sf-300 dark:border-sf-400/40' : 'border-gray-300 dark:border-gray-600 hover:border-sf-500'
                  }`}>
                    {allSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    {someSelected && <span className="text-sf-600 dark:text-sf-400 text-[10px] font-bold leading-none">–</span>}
                  </div>
                </th>
                {/* Feature 1: sortable column headers */}
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('name')}>
                  Application <SortIcon col="name" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('status')}>
                  Status <SortIcon col="status" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('environment')}>
                  Environment <SortIcon col="environment" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('type')}>
                  Type <SortIcon col="type" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('muleVersion')}>
                  Mule Version <SortIcon col="muleVersion" />
                </th>
                <th className="text-left px-4 py-3.5 font-semibold cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 select-none transition-colors" onClick={() => handleSort('lastModified')}>
                  Last Modified <SortIcon col="lastModified" />
                </th>
                <th className="px-4 py-3.5 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
              {paginatedItems.map((app, idx) => {
                const actions = availableActions(app.status);
                const isActing = !!actionLoading[app.id];
                const isChecked = selectedIds.has(app.id);

                return (
                  <tr key={`${app.id}-${idx}`}
                    className={`group hover:bg-sf-50/40 dark:hover:bg-sf-500/[0.08] cursor-pointer transition-colors ${isChecked ? 'bg-sf-50/60 dark:bg-sf-500/[0.12]' : (() => {
                      const st = (app.status || '').toUpperCase();
                      if (st === 'FAILED')    return 'border-l-2 border-l-red-500 bg-red-50/30 dark:bg-red-500/[0.08]';
                      if (st === 'DEPLOYING') return 'border-l-2 border-l-blue-400 bg-blue-50/20 dark:bg-blue-500/[0.07]';
                      if (st === 'UPDATING')  return 'border-l-2 border-l-purple-400 bg-purple-50/20 dark:bg-purple-500/[0.07]';
                      if (st === 'STARTING')  return 'border-l-2 border-l-blue-300';
                      if (st === 'STOPPING')  return 'border-l-2 border-l-orange-400';
                      if (st === 'STOPPED')   return 'border-l-2 border-l-gray-200 dark:border-l-gray-700';
                      return 'border-l-2 border-l-transparent';
                    })()}`}
                    onClick={() => navigate(`/applications/${app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId)}/${app.environment?.id}/${app.id}`)}>
                    {/* Checkbox */}
                    <td className="px-4 py-3.5" onClick={(e) => toggleRow(e, app.id)}>
                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center cursor-pointer transition-all ${
                        isChecked ? 'bg-sf-600 border-sf-500 shadow-sm shadow-sf-500/30' : 'border-gray-300 dark:border-gray-600 hover:border-sf-500 group-hover:border-sf-400'
                      }`}>
                        {isChecked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-900 dark:text-gray-100 font-semibold">{app.name}</span>
                        <CopyBtn text={app.name} fade={false} />
                        <button
                          type="button"
                          title={`Open in Anypoint Platform${app.environment?.name ? ` — ${app.environment.name}` : ''} (app name copied to clipboard)`}
                          onClick={(e) => openInAnypoint(e, app, selectedBg !== '__all__' ? selectedBg : orgId)}
                          className="ml-0.5 text-gray-400 dark:text-gray-500 hover:text-sf-600 dark:hover:text-sf-400 transition-colors flex-shrink-0"
                        >
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-800 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
                        <span className="text-gray-600 dark:text-gray-400">{app.environment?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        app.deploymentType === 'CloudHub 2.0' ? 'bg-sf-50 text-sf-700 dark:bg-sf-500/15 dark:text-sf-300' : 'bg-sfpurple-50 text-sfpurple-700 dark:bg-sfpurple-500/15 dark:text-sfpurple-300'
                      }`}>{app.deploymentType}</span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 dark:text-gray-400 font-mono text-xs">{app.muleVersion || '—'}</td>
                    <td className="px-4 py-3.5 text-xs">
                      {app.lastModifiedDate
                        ? <span className="text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                            {new Date(app.lastModifiedDate).toLocaleString(undefined, {
                              year: 'numeric', month: 'short', day: '2-digit',
                              hour: '2-digit', minute: '2-digit', hour12: false,
                            })}
                          </span>
                        : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {isActing ? (
                          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-sf-400" />
                        ) : actions.length > 0 ? (
                          actions.map((action) => {
                            const { Icon, label, btnCls } = ACTION_CONFIG[action];
                            return (
                              <button key={action} title={label}
                                onClick={(e) => requestAction(e, app, action)}
                                className={`p-1.5 rounded-xl border transition-all duration-200 hover:scale-105 active:scale-95 ${btnCls}`}>
                                <Icon size={13} />
                              </button>
                            );
                          })
                        ) : (
                          <ChevronRight size={14} className="text-gray-400 dark:text-gray-500" />
                        )}
                        {/* CPS Manager shortcut */}
                        <button
                          title="Open in CPS Manager"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/cps-manager', {
                              state: {
                                cpsAutoSelect: {
                                  bgId: app._bgId || (selectedBg !== '__all__' ? selectedBg : orgId),
                                  envId: app.environment?.id || '',
                                  compositeId: `${app.id}|${app.environment?.id || ''}|${app._bgId || ''}`,
                                  appName: app.name,
                                },
                              },
                            });
                          }}
                          className="p-1.5 rounded-lg border text-gray-400 dark:text-gray-500 hover:text-sfteal-600 dark:hover:text-sfteal-400 border-gray-200 dark:border-gray-700 hover:border-sfteal-300/60 dark:hover:border-sfteal-400/30 hover:bg-sfteal-50 dark:hover:bg-sfteal-500/10 hover:shadow-sm transition-all">
                          <Database size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {displayFiltered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center mb-1">
                        <Search size={20} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">
                        {apps.length === 0
                          ? `No applications found in ${selectedBgName}.`
                          : 'No applications match your filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Pagination controls */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-1">
          {/* Left: selected + total info */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {selectedApps.length > 0 && (
              <span className="text-sf-700 dark:text-sf-300 font-bold px-2 py-0.5 rounded-lg bg-sf-50 dark:bg-sf-500/10">{selectedApps.length} selected</span>
            )}
            <span>
              {displayFiltered.length === apps.length
                ? `${apps.length} application${apps.length !== 1 ? 's' : ''}`
                : `${displayFiltered.length} of ${apps.length} applications`}
            </span>
          </div>

          {/* Right: page-size picker + prev/next */}
          <div className="flex items-center gap-3">
            {/* Page size selector */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span>Rows</span>
              <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-0.5">
                {[25, 50, 100, 200].map(size => (
                  <button
                    key={size}
                    onClick={() => { setPageSize(size); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                      pageSize === size
                        ? 'bg-white dark:bg-gray-900 text-sf-700 dark:text-sf-300 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Page navigation */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                  title="First page"
                >
                  «
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                >
                  ‹
                </button>

                {/* Page number pills */}
                <div className="flex items-center gap-0.5">
                  {(() => {
                    const pages = [];
                    const delta = 2;
                    const left = Math.max(1, currentPage - delta);
                    const right = Math.min(totalPages, currentPage + delta);
                    if (left > 1) {
                      pages.push(1);
                      if (left > 2) pages.push('...');
                    }
                    for (let i = left; i <= right; i++) pages.push(i);
                    if (right < totalPages) {
                      if (right < totalPages - 1) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, i) =>
                      p === '...' ? (
                        <span key={`ellipsis-${i}`} className="px-1.5 text-[10px] text-gray-400 dark:text-gray-500">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setCurrentPage(p)}
                          className={`min-w-[28px] h-[28px] text-[10px] font-semibold rounded-lg transition-all ${
                            currentPage === p
                              ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 shadow-sm'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    );
                  })()}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                >
                  ›
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed shadow-sm transition-all"
                  title="Last page"
                >
                  »
                </button>

                {/* Compact page range label */}
                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1 tabular-nums whitespace-nowrap">
                  {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, displayFiltered.length)} of {displayFiltered.length}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
