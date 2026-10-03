import { useState, useCallback, useEffect } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight, Globe, Wifi, WifiOff, Key, Eye, EyeOff, ShieldCheck, Wand2, Lock, Zap, X, Copy, Check, Terminal, History, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useCredentialStore } from '../context/CredentialStoreContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { findOAuth2Url, flattenCpsResponse } from '../utils/cpsHelpers';
import AttemptLog from './AttemptLog';
import PostmanJsonViewer from './PostmanJsonViewer';
import { buildPingUrl } from '../utils/appUtils';
export default function PingTestPanel({
  appName, isCH1, ch2IngressUrl, orgId, envId,
  defaultClientId = '', defaultClientSecret = '',
  cpsBaseUrl = '', cpsClientId = '', cpsKey = '', cpsEnv = '',
  pingSpec = null, pingSpecLoading = false,
  envType = '',   // 'production' | 'sandbox' | 'design' — selects CH1 domain
  envName = '',   // full env display name e.g. "EI-FI-FINANCIALS-STAGING" — used for domain qualifier
}) {
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const { getSecret: getCpsSecret, hasCredentials: hasCpsCreds } = useCpsCredentialStore();

  const [clientId, setClientId] = useState(defaultClientId);
  const [clientSecret, setClientSecret] = useState(defaultClientSecret);
  const [showSecret, setShowSecret] = useState(false);
  const [autoResolving, setAutoResolving] = useState(false);
  const [autoResolved, setAutoResolved] = useState(null);

  const [authMode, setAuthMode] = useState('client-credentials');
  const [bearerToken, setBearerToken] = useState('');
  const [tokenUrl, setTokenUrl] = useState('');
  const [tokenClientId, setTokenClientId] = useState('');
  const [tokenClientSecret, setTokenClientSecret] = useState('');
  const [fetchingToken, setFetchingToken] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [tokenExpiresIn, setTokenExpiresIn] = useState(null);
  const [showTokenHelper, setShowTokenHelper] = useState(false);
  const [gettingJwt, setGettingJwt] = useState(false);
  const [jwtError, setJwtError] = useState(null);
  const [jwtTokenUrl, setJwtTokenUrl] = useState(''); // stored once found, reused on refresh
  const [copiedCurl, setCopiedCurl] = useState(false);

  const [transactionId, setTransactionId] = useState('');
  const [queryParams, setQueryParams] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [configOpen, setConfigOpen] = useState(true); // auto-collapses after ping completes
  const [pingHistory, setPingHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!orgId || !envId || !appName) return;
    try {
      setHistoryLoading(true);
      const { data } = await api.get('/health/ping/history', {
        params: { orgId, envId, appName }
      });
      setPingHistory(data || []);
    } catch (e) {
      console.error('Failed to fetch ping history', e);
    } finally {
      setHistoryLoading(false);
    }
  }, [orgId, envId, appName]);

  const clearHistory = async () => {
    if (!orgId || !envId || !appName) return;
    try {
      setHistoryLoading(true);
      await api.delete('/health/ping/history', { params: { orgId, envId, appName } });
      setPingHistory([]);
    } catch (e) {
      console.error('Failed to clear ping history', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const flattenCpsProps = (data) => {
    if (!data) return {};
    let props = {};
    if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(props, r.properties || {}));
    else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(props, r.properties); });
    else if (data && typeof data === 'object') {
      const fv = Object.values(data)[0];
      props = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
    }
    return props;
  };

  const extractApiId = (props) => {
    const isValidId = v => /^\d+$/.test(String(v).trim()) && String(v).trim() !== '0';
    if ('api.id' in props && isValidId(props['api.id'])) return String(props['api.id']).trim();
    const e1 = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
    if (e1 && isValidId(e1[1])) return String(e1[1]).trim();
    const e2 = Object.entries(props).find(([k, v]) => k.endsWith('.id') && isValidId(v));
    if (e2) return String(e2[1]).trim();
    if ('id' in props && isValidId(props['id'])) return String(props['id']).trim();
    return null;
  };

  const autoFillCredentials = useCallback(async () => {
    if (!hasCredentials || !orgId || !envId) return;
    setAutoResolving(true);
    setAutoResolved(null);
    try {
      const body = { orgId, envId, appName };
      if (cpsBaseUrl && cpsKey) {
        if (cpsClientId && hasCpsCreds) {
          const secret = getCpsSecret(cpsClientId);
          if (secret) {
            try {
              const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
              await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } } });
            } catch { /* non-fatal */ }
          }
        }
        try {
          const r = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId } });
          const apiId = extractApiId(flattenCpsProps(r.data));
          if (apiId) body.apiId = apiId;
        } catch { /* continue */ }
      }
      const { data } = await api.post('/health/auto-credentials', body);
      if (data.found && data.matchInfo?.length > 0) {
        const matched = resolveFromCandidates(data.matchInfo.map(m => m.clientId));
        if (matched) {
          const meta = data.matchInfo.find(m => m.clientId === matched.clientId);
          setClientId(matched.clientId); setClientSecret(matched.clientSecret);
          setAutoResolved({ clientId: matched.clientId, apiInstanceName: meta?.apiInstanceName || '—', contractApp: meta?.contractApp || '—', source: 'csv' });
          setAutoResolving(false); return;
        }
        const apiInstanceId = data.matchedApis?.[0]?.id;
        if (apiInstanceId) {
          try {
            const cd = (await api.post('/health/auto-contract-creds', { orgId, envId, apiId: apiInstanceId, envType: envType || '', envName: envName || '' })).data;
            if (cd.clientId && cd.clientSecret) {
              setClientId(cd.clientId); setClientSecret(cd.clientSecret);
              setAutoResolved({ clientId: cd.clientId, apiInstanceName: data.matchedApis[0]?.label || '—', contractApp: cd.appName || '—', source: cd.contractStatus === 'approved' ? 'contract' : 'contract-pending', contractStatus: cd.contractStatus });
              setAutoResolving(false); return;
            }
            if (cd.contractStatus === 'pending') { setAutoResolved({ error: `Contract requested for "${cd.appName}" — awaiting approval.` }); setAutoResolving(false); return; }
          } catch (e) { console.warn('[PingTestPanel] auto-contract-creds:', e.message); }
        }
        setAutoResolved({ error: 'API Manager found a match but no credential could be resolved. Import a CSV or create an Exchange app.' });
      } else {
        setAutoResolved({ error: 'No matching API Manager instance found for this app.' });
      }
    } catch (err) { setAutoResolved({ error: err.message }); }
    setAutoResolving(false);
  }, [hasCredentials, orgId, envId, appName, resolveFromCandidates]);

  const fetchOAuth2Token = async () => {
    if (!tokenUrl || !tokenClientId || !tokenClientSecret) return;
    setFetchingToken(true); setTokenError(null); setTokenExpiresIn(null);
    try {
      const { data } = await api.post('/health/oauth2-token', { tokenUrl: tokenUrl.trim(), clientId: tokenClientId.trim(), clientSecret: tokenClientSecret.trim() });
      setBearerToken(data.access_token);
      setTokenExpiresIn(data.expires_in || null);
    } catch (err) { setTokenError(err.response?.data?.error || err.message || 'Failed to fetch token'); }
    finally { setFetchingToken(false); }
  };

  // ── One-click: scan CPS → fetch JWT → switch to Bearer mode ─────────────
  const getJwtToken = async () => {
    if (!clientId || !clientSecret) {
      setJwtError('Auto-fill credentials from API Manager first, then click Get JWT Token');
      return;
    }
    setGettingJwt(true);
    setJwtError(null);

    try {
      let foundTokenUrl = jwtTokenUrl; // reuse previously discovered URL

      if (!foundTokenUrl && cpsBaseUrl && cpsKey) {
        // Scan CPS non-secure first
        const nsRes = await api.get('/cps/fetch', {
          params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId }
        });
        const nsProps = flattenCpsProps(nsRes.data);
        foundTokenUrl = findOAuth2Url(nsProps);

        // If not found in non-secure, scan ALL secure keys for an OAuth2 token URL.
        // Previously only searched keys named "jwt" or "auth" — token URLs can be
        // in any secure group (e.g. salesforce-details, oracle-details, etc.).
        if (!foundTokenUrl) {
          const secureKeys = (nsProps['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean);
          if (secureKeys.length > 0) {
            try {
              if (cpsClientId && hasCpsCreds) {
                const secret = getCpsSecret(cpsClientId);
                if (secret) {
                  const credKey = `${cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
                  await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: cpsClientId, clientSecret: secret } } });
                }
              }
              // Fetch all secure keys at once — each group is a separate response entry
              const sr = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'secure', keys: secureKeys.join(','), ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId } });
              const sg = Array.isArray(sr.data?.responses) ? sr.data.responses : Array.isArray(sr.data?.properties) ? sr.data.properties : Array.isArray(sr.data) ? sr.data : [];
              for (const g of sg) { const u = findOAuth2Url(g.properties || {}); if (u) { foundTokenUrl = u; break; } }
            } catch { /* continue */ }
          }
        }
      }

      if (!foundTokenUrl) {
        setJwtError('No OAuth2 token URL found in CPS. Ensure jwt-auth-details secure group is configured.');
        setGettingJwt(false);
        return;
      }
      setJwtTokenUrl(foundTokenUrl); // cache for re-fetches

      // Fetch JWT token using resolved client credentials
      const { data } = await api.post('/health/oauth2-token', {
        tokenUrl: foundTokenUrl,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setBearerToken(data.access_token);
      setTokenExpiresIn(data.expires_in || null);
      setAuthMode('bearer-token');

    } catch (err) {
      setJwtError(err.response?.data?.error || err.message || 'Failed to get JWT token');
    } finally {
      setGettingJwt(false);
    }
  };

  // Build the curl command from current credentials and a given URL
  const buildCurl = (url, maskSecrets = false) => {
    const lines = [`curl -X GET \\`, `  "${url}" \\`];
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -H "x-transaction-id: ${transactionId || 'smokeTest'}" \\`);
    if (authMode === 'bearer-token' && bearerToken) {
      const tok = maskSecrets ? `${bearerToken.slice(0, 20)}…` : bearerToken;
      lines.push(`  -H "Authorization: Bearer ${tok}"`);
    } else {
      if (clientId) lines.push(`  -H "client_id: ${clientId}" \\`);
      if (clientSecret) {
        const sec = maskSecrets ? `${clientSecret.slice(0, 4)}…` : clientSecret;
        lines.push(`  -H "client_secret: ${sec}"`);
      } else if (clientId) {
        // remove trailing backslash from last line
        lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
      }
    }
    // Ensure last line has no trailing backslash
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
    return lines.join('\n');
  };

  const generateTxId = () => {
    try { return crypto.randomUUID(); } catch {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  };

  const targetType = isCH1 ? 'CH1' : 'CH2';
  // Build CH1 base URL — injects .fin. (or other qualifier) when environment name
  // signals a domain family e.g. EI-FI-FINANCIALS-STAGING → app.stage.fin.internalapi.sfdcbt.net
  // Falls back to prod vs stage selection when envName is not provided (old callers).
  const isProdEnv = (envType || '').toLowerCase() === 'production';
  const safeName = (appName || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const ch1Base = (() => {
    if (envName) {
      const built = buildPingUrl(appName, envName);
      if (built) return `https://${built}`;
    }
    return isProdEnv
      ? `https://${safeName}.internalapi.sfdcbt.net`
      : `https://${safeName}.stage.internalapi.sfdcbt.net`;
  })();
  const displayBase = isCH1 ? ch1Base : ch2IngressUrl || '(no ingress URL detected)';

  // Auto-collapse config panel when ping completes
  const runPing = async () => {
    const txId = generateTxId();
    setTransactionId(txId); // update field + curl command with the generated UUID
    setLoading(true); setResult(null); setError(null);

    // Client-side safety timeout — prevents the button staying disabled forever
    // if the backend is slow (6 paths × 30s each = up to 3 min worst case).
    // After 95s the frontend stops waiting and shows a timeout error.
    const clientTimeout = setTimeout(() => {
      setError('Ping timed out waiting for response (95s). The backend may still be running — try again in a moment.');
      setLoading(false);
      setConfigOpen(false);
    }, 95000);

    try {
      const { data } = await api.post('/health/ping', {
        targetType, appName, orgId, envId,
        ch2IngressUrl: isCH1 ? undefined : ch2IngressUrl,
        envType: isCH1 ? envType : undefined,
        envName: isCH1 ? envName : undefined,  // full name — backend injects .fin. for FINANCIALS envs
        ...(authMode === 'bearer-token'
          ? { bearerToken: bearerToken.trim() || undefined }
          : { clientId: clientId.trim() || undefined, clientSecret: clientSecret.trim() || undefined }),
        transactionId: txId,
        queryParams: queryParams.trim() || undefined,
        credentialsLabel: authMode === 'bearer-token' ? 'Manual / Token' : (clientId ? 'Manual / Client ID' : 'Manual / None'),
      });
      clearTimeout(clientTimeout);
      setResult(data);
      fetchHistory(); // Fetch history after a successful or failed ping
    } catch (err) {
      clearTimeout(clientTimeout);
      setError(err.response?.data?.error || err.message || 'Ping request failed');
    } finally {
      setLoading(false);
      setConfigOpen(false); // collapse config after ping completes
    }
  };

  const badgeConfig = {
    SUCCESS: { icon: <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />, label: 'Healthy / Reachable', cls: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-400', ping: true },
    PARTIAL: { icon: <AlertCircle  size={15} className="text-amber-600 dark:text-amber-400"  />, label: 'Reachable (non-2xx)', cls: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200/60 dark:border-amber-400/20 text-amber-700 dark:text-amber-300',  dot: 'bg-amber-400', ping: false },
    FAILED:  { icon: <XCircle      size={15} className="text-red-600 dark:text-red-400"     />, label: 'Unreachable',         cls: 'bg-red-50 dark:bg-red-500/10 border-red-200/60 dark:border-red-400/20 text-red-700 dark:text-red-300',           dot: 'bg-red-500',    ping: false },
  };
  const badge = result ? badgeConfig[result.status] || badgeConfig.FAILED : null;
  const latencyColor = (ms) => !ms ? 'text-gray-500 dark:text-gray-400' : ms < 300 ? 'text-emerald-600 dark:text-emerald-400' : ms < 1000 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

  const inputCls = 'w-full bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfteal-400 dark:focus:border-sfteal-500 focus:ring-2 focus:ring-sfteal-500/10 transition-all';
  const blueInputCls = 'w-full bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 transition-all';

  return (
    <div className="space-y-5">
      <div className="relative rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-sm overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-sfteal-500 via-sf-400 to-sfteal-500"/>

        {/* ── Header bar — always visible ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-sfteal-500 to-sfteal-600 shadow-sm shadow-sfteal-500/30 flex-shrink-0">
              <Activity size={13} className="text-white" />
            </div>
            <span className="text-gray-900 dark:text-gray-100 text-sm font-semibold">Ping / Health Check</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border flex-shrink-0 ${isCH1 ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20' : 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'}`}>
              {isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}
            </span>
            {authMode === 'bearer-token' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-400/20 flex items-center gap-1 flex-shrink-0">
                <Lock size={8} /> JWT Auth
              </span>
            )}
            {/* Compact credential summary when collapsed */}
            {!configOpen && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate max-w-xs hidden sm:block">
                {authMode === 'bearer-token' && bearerToken
                  ? `🔒 Bearer …${bearerToken.slice(-10)}`
                  : clientId ? `🔑 ${clientId.slice(0, 8)}…` : '(no credentials)'}
                {queryParams && ` · ?${queryParams.slice(0, 20)}${queryParams.length > 20 ? '…' : ''}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {(ch2IngressUrl || isCH1) && (
              <button
                onClick={() => {
                  const url = result?.activeEndpoint || `${displayBase}/api/v1/ping${queryParams ? `?${queryParams}` : ''}`;
                  navigator.clipboard.writeText(buildCurl(url, false));
                  setCopiedCurl(true);
                  setTimeout(() => setCopiedCurl(false), 2000);
                }}
                title="Copy cURL"
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-xs font-semibold rounded-xl transition-all">
                {copiedCurl ? <><Check size={12} className="text-emerald-600 dark:text-emerald-400" /> Copied!</> : <><Terminal size={12} /> Copy cURL</>}
              </button>
            )}
            <button onClick={runPing} disabled={loading || (!isCH1 && !ch2IngressUrl)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-b from-sfteal-500 to-sfteal-600 hover:from-sfteal-400 hover:to-sfteal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-md shadow-sfteal-500/30 hover:shadow-lg hover:shadow-sfteal-500/40 ring-1 ring-inset ring-white/20 transition-all hover:-translate-y-0.5 active:translate-y-0">
              {loading ? <><RefreshCw size={14} className="animate-spin" /> Pinging…</> : <><Wifi size={14} /> Run Ping Test</>}
            </button>
            {/* Expand / collapse config */}
            <button onClick={() => setConfigOpen(v => !v)}
              title={configOpen ? 'Collapse config' : 'Expand config'}
              className="p-2 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/70 dark:hover:bg-gray-800/60 border border-transparent hover:border-gray-200/60 dark:hover:border-gray-700/60 transition-all">
              {configOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          </div>
        </div>

        {/* ── Collapsible config body ── */}
        {configOpen && (
        <div className="px-5 pb-4 space-y-4 border-t border-gray-100 dark:border-gray-800 pt-4">
          {/* Base URL + tries hint */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Globe size={11} className="text-gray-400 dark:text-gray-500" />
              <span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all">{displayBase}</span>
            </div>
            <p className="text-gray-400 dark:text-gray-500 text-[11px]">Tries: <span className="text-gray-500 dark:text-gray-400">/api/v1/ping → /api/v2/ping → /api/ping → /ping</span></p>
          </div>

        {/* Exchange spec hint */}
        {(pingSpecLoading || pingSpec) && (
          <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
            {pingSpecLoading ? (
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400"><RefreshCw size={9} className="animate-spin" /> Fetching API spec from Exchange…</div>
            ) : pingSpec?.pingEndpoints?.length > 0 ? (
              <div className="bg-sf-50/60 dark:bg-sf-500/5 border border-sf-200/50 dark:border-sf-400/15 rounded-lg px-3 py-2 space-y-1.5">
                <p className="text-[10px] text-sf-700 dark:text-sf-300 font-semibold flex items-center gap-1"><Globe size={9} /> Spec-detected ping endpoint{pingSpec.pingEndpoints.length > 1 ? 's' : ''}</p>
                <div className="flex flex-wrap gap-1.5">
                  {pingSpec.pingEndpoints.map((ep, i) => {
                    const requiredQp = (ep.queryParams || []).filter(p => p.required);
                    const qpString = requiredQp.map(p => `${p.name}=${p.example || p.type || ''}`).join('&');
                    return (
                      <button key={i} onClick={() => { if (qpString) setQueryParams(qpString); }}
                        title={qpString ? `Click to auto-fill: ${qpString}` : ep.path}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 bg-white dark:bg-gray-800 border border-sf-200/60 dark:border-sf-400/20 rounded text-sf-700 dark:text-sf-300 hover:bg-sf-600 hover:text-white hover:border-sf-600 transition-all font-mono">
                        <span className="opacity-70">{ep.method}</span>
                        <span>{ep.path}</span>
                        {requiredQp.length > 0 && <span className="text-sforange-600 dark:text-sforange-400 ml-0.5">+{requiredQp.length}p</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : pingSpec ? <p className="text-[10px] text-gray-400 dark:text-gray-500">No ping/health endpoint in spec — using standard paths</p> : null}
          </div>
        )}

        {/* Query params */}
        <div className={pingSpec || pingSpecLoading ? '' : 'pt-1 border-t border-gray-100 dark:border-gray-800'}>
          <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1 mb-1">
            <Globe size={9} /> Query Parameters <span className="normal-case text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <input value={queryParams} onChange={e => setQueryParams(e.target.value)} placeholder="e.g. checkDb=true&type=health" className={inputCls} />
        </div>

        {/* Auth Mode + Credentials */}
        <div className="space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center gap-0.5 bg-gray-100/70 dark:bg-gray-800/60 rounded-lg p-0.5 w-fit border border-gray-200/70 dark:border-gray-700/60">
            <button onClick={() => setAuthMode('client-credentials')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${authMode === 'client-credentials' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <Key size={10} /> Client ID / Secret
            </button>
            <button onClick={() => setAuthMode('bearer-token')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${authMode === 'bearer-token' ? 'bg-gradient-to-b from-sf-500 to-sf-600 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <Lock size={10} /> Bearer Token (JWT)
            </button>
          </div>

          {authMode === 'client-credentials' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1"><Key size={9} /> client_id</label>
                <input value={clientId} onChange={e => { setClientId(e.target.value); setAutoResolved(null); }} placeholder="optional" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1"><Key size={9} /> client_secret</label>
                <div className="relative">
                  <input value={clientSecret} onChange={e => setClientSecret(e.target.value)} type={showSecret ? 'text' : 'password'} placeholder="optional"
                    className="w-full bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-3 py-1.5 pr-8 text-xs text-gray-700 dark:text-gray-200 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfteal-400 dark:focus:border-sfteal-500 focus:ring-2 focus:ring-sfteal-500/10 transition-all" />
                  <button onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                    {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1"><Terminal size={9} /> x-transaction-id</label>
                <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest" className={inputCls} />
              </div>
            </div>
          ) : (
            /* ── Bearer Token (JWT) mode ── */
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1"><Lock size={9} /> Bearer Token (JWT / OAuth2)</label>
                <div className="relative">
                  <textarea value={bearerToken} onChange={e => setBearerToken(e.target.value)} rows={3}
                    placeholder="Paste your JWT or access_token here, or use the OAuth2 helper below to fetch one automatically…"
                    className="w-full bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-3 py-2 text-xs text-gray-700 dark:text-gray-200 font-mono placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 resize-y pr-8 transition-all" />
                  {bearerToken && (
                    <button onClick={() => { setBearerToken(''); setTokenExpiresIn(null); }} title="Clear"
                      className="absolute top-2 right-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 bg-gray-100/80 dark:bg-gray-700/80 rounded p-0.5"><X size={11} /></button>
                  )}
                </div>
                {tokenExpiresIn && <p className="text-[10px] text-emerald-600 dark:text-emerald-400">✓ Token fetched — expires in {tokenExpiresIn}s</p>}
                {bearerToken && !tokenExpiresIn && <p className="text-[10px] text-sf-600 dark:text-sf-400">🎟 Will send as <code className="text-sf-700 dark:text-sf-300">Authorization: Bearer …</code></p>}
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1"><Terminal size={9} /> x-transaction-id</label>
                <input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="smokeTest" className={inputCls} />
              </div>
              {/* OAuth2 helper */}
              <div className="border border-gray-200/70 dark:border-gray-700/60 rounded-xl overflow-hidden">
                <button onClick={() => setShowTokenHelper(!showTokenHelper)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50/70 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-xs font-semibold transition-all">
                  <div className="flex items-center gap-1.5"><Zap size={10} className="text-sf-600 dark:text-sf-400" /><span>Get token from OAuth2 endpoint</span><span className="text-gray-400 dark:text-gray-500 font-normal">(client_credentials)</span></div>
                  {showTokenHelper ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {showTokenHelper && (
                  <div className="px-4 py-3 space-y-3 bg-gray-50/40 dark:bg-gray-800/30 border-t border-gray-200/70 dark:border-gray-700/60">
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Token URL</label>
                      <input value={tokenUrl} onChange={e => setTokenUrl(e.target.value)} placeholder="https://auth.example.com/oauth/token" className={blueInputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Client ID</label>
                        <input value={tokenClientId} onChange={e => setTokenClientId(e.target.value)} placeholder="client_id" className={blueInputCls} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Client Secret</label>
                        <input type="password" value={tokenClientSecret} onChange={e => setTokenClientSecret(e.target.value)} placeholder="client_secret" className={blueInputCls} />
                      </div>
                    </div>
                    {tokenError && <p className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1"><XCircle size={10} /> {tokenError}</p>}
                    <button onClick={fetchOAuth2Token} disabled={fetchingToken || !tokenUrl || !tokenClientId || !tokenClientSecret}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg shadow-sm shadow-sf-500/30 transition-all">
                      {fetchingToken ? <><RefreshCw size={10} className="animate-spin" /> Fetching…</> : <><Zap size={10} /> Fetch Token → fill above</>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        </div>)} {/* end collapsible config body */}

        {/* CSV import + auto-fill (client-credentials mode only) — always visible */}
        {authMode === 'client-credentials' && (
          <div className="space-y-2 pt-1 border-t border-gray-100 dark:border-gray-800 px-5 pb-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {hasCredentials && (
                  <>
                    <button onClick={autoFillCredentials} disabled={autoResolving || !orgId || !envId}
                      title="Auto-fill credentials from API Manager contracts + your loaded CSV"
                      className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 rounded-lg transition-all disabled:opacity-50 font-semibold">
                      {autoResolving ? <><RefreshCw size={9} className="animate-spin" /> Resolving…</> : <><Wand2 size={9} /> Auto-fill from API Manager</>}
                    </button>
                  </>
                )}
                {/* Get JWT Token — appears after ping returns PARTIAL (JWT required) */}
                {result?.status === 'PARTIAL' && cpsBaseUrl && (
                  <button onClick={getJwtToken}
                    disabled={gettingJwt || !clientId || !clientSecret}
                    title={!clientId || !clientSecret ? 'Auto-fill credentials first, then click to get JWT' : 'Scan CPS for OAuth2 token URL and fetch JWT Bearer token'}
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200/60 dark:border-indigo-400/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 rounded-lg transition-all disabled:opacity-50 font-semibold">
                    {gettingJwt ? <><RefreshCw size={9} className="animate-spin" /> Getting JWT…</> : <><Lock size={9} /> Get JWT Token</>}
                  </button>
                )}
              </div>
              {autoResolved && !autoResolved.error && (
                <span className={`flex items-center gap-1 text-[10px] font-medium ${autoResolved.source === 'contract-pending' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  <ShieldCheck size={9} />
                  {autoResolved.source === 'contract' ? '🔑 contract: ' : autoResolved.source === 'contract-pending' ? '⏳ pending: ' : ''}
                  {autoResolved.apiInstanceName} → {autoResolved.contractApp}
                </span>
              )}
              {autoResolved?.source === 'contract-pending' && (
                <button onClick={autoFillCredentials} disabled={autoResolving}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-400/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded transition-colors font-medium">
                  {autoResolving ? <RefreshCw size={9} className="animate-spin" /> : <RefreshCw size={9} />} Re-check Approval
                </button>
              )}
              {autoResolved?.error && <span className="text-[10px] text-amber-600 dark:text-amber-400">{autoResolved.error}</span>}
              {jwtError && <span className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1"><XCircle size={9} /> {jwtError}</span>}
            </div>
          </div>
        )}
      </div>

      {!isCH1 && !ch2IngressUrl && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-xl px-4 py-3 text-amber-700 dark:text-amber-300 text-sm">
          <AlertCircle size={15} className="flex-shrink-0" /><span>No public ingress URL found for this CH2 app. Check the <strong>Infra & Config</strong> tab.</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-500/5 border border-red-200/60 dark:border-red-400/15 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">
          <WifiOff size={15} className="flex-shrink-0" /><span>{error}</span>
        </div>
      )}

      {result && badge && (
        <div className="space-y-4">
          <div className={`flex items-center justify-between flex-wrap gap-3 rounded-2xl border px-5 py-4 ${badge.cls}`}>
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 flex-shrink-0">
                {badge.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${badge.dot}`} />}
                <span className={`relative inline-flex rounded-full h-3 w-3 ${badge.dot}`} />
              </span>
              <div className="flex items-center gap-2">{badge.icon}<span className="font-semibold text-sm">{badge.label}</span></div>
            </div>
            {result.responseTimeMs != null && <span className={`font-mono text-sm font-bold ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span>}
          </div>

          <div className="bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Active Endpoint', result.activeEndpoint ? <span className="font-mono text-xs text-sfteal-700 dark:text-sfteal-300 break-all">{result.activeEndpoint}</span> : <span className="text-gray-400 dark:text-gray-600">—</span>],
                  ['HTTP Status', result.httpStatus != null ? <span className={`font-mono text-sm font-bold ${result.httpStatus < 300 ? 'text-emerald-600 dark:text-emerald-400' : result.httpStatus < 500 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{result.httpStatus}</span> : <span className="text-gray-400 dark:text-gray-600">—</span>],
                  ['Response Time', result.responseTimeMs != null ? <span className={`font-mono font-bold ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span> : <span className="text-gray-400 dark:text-gray-600">—</span>],
                  ['Target Type', <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${isCH1 ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20' : 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'}`}>{isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'}</span>],
                ].map(([label, value]) => (
                  <tr key={label} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <td className="px-5 py-3 w-40 text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase">{label}</td>
                    <td className="px-5 py-3">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.payload && (() => {
              const endpoints = result.payload?.pingResponse?.endpoints;
              const summary = result.payload?.pingResponse?.summary;
              return (
                <div className="border-t border-gray-100 dark:border-gray-800 space-y-0">
                  {/* Structured endpoint health table when pingResponse.endpoints exists */}
                  {Array.isArray(endpoints) && endpoints.length > 0 && (() => {
                    const ok = endpoints.filter(e => e && (e.status || '').toLowerCase() === 'success').length;
                    const fail = endpoints.length - ok;
                    return (
                      <div className="px-5 py-4 space-y-3 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1.5">
                            <Activity size={9} /> Endpoint Health ({endpoints.length})
                          </p>
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ {ok} ok</span>
                            {fail > 0 && <span className="text-red-600 dark:text-red-400 font-semibold">✗ {fail} failed</span>}
                            {summary?.serviceName && <span className="text-gray-400 dark:text-gray-500 font-mono">{summary.serviceName}</span>}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {endpoints.map((ep, i) => {
                            if (!ep) return null;
                            const isOk = (ep.status || '').toLowerCase() === 'success';
                            return (
                              <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 border ${isOk ? 'bg-emerald-50/60 dark:bg-emerald-500/5 border-emerald-200/50 dark:border-emerald-400/15' : 'bg-red-50/60 dark:bg-red-500/5 border-red-200/50 dark:border-red-400/15'}`}>
                                <span className="text-[11px] mt-0.5 flex-shrink-0">{isOk ? '✅' : '❌'}</span>
                                <div className="flex-1 min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{ep.serviceName}</span>
                                    {ep.endpointName && <span className="text-[10px] text-gray-400 dark:text-gray-500">· {ep.endpointName}</span>}
                                  </div>
                                  {ep.apiUser && <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{ep.apiUser}</p>}
                                  <p className={`text-[10px] ${isOk ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-red-600/80 dark:text-red-400/80'}`}>
                                    {ep.message}{ep.domain ? ` · ${ep.domain}` : ''}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Full raw JSON — always visible */}
                  <div className="px-5 py-4">
                    <p className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-2">Response Body</p>
                    <PostmanJsonViewer data={result.payload} maxHeight="400px" />
                  </div>
                </div>
              );
            })()}
            {result.error && <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 flex items-center gap-2 text-red-600 dark:text-red-400 text-xs"><XCircle size={12} className="flex-shrink-0" />{result.error}</div>}
          </div>
          {Array.isArray(result.attempts) && result.attempts.length > 0 && (
            <AttemptLog
              attempts={result.attempts}
              className="bg-white/50 dark:bg-gray-900/40 border border-gray-200/60 dark:border-gray-700/60 rounded-2xl px-4 py-3"
            />
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sfteal-100 dark:bg-sfteal-500/10">
            <Activity size={24} className="text-sfteal-500 dark:text-sfteal-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Click <strong className="text-gray-700 dark:text-gray-200">Run Ping Test</strong> to check if the app is reachable</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">Will test: <span className="text-gray-500 dark:text-gray-400 font-mono">{displayBase}/api/v1/ping</span> and fallbacks</p>
        </div>
      )}

      {/* Ping History Section */}
      <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <History size={16} />
            <span className="text-sm font-semibold">Ping History {pingHistory.length > 0 ? `(${pingHistory.length})` : ''}</span>
            {historyLoading && <RefreshCw size={12} className="animate-spin text-gray-400 dark:text-gray-500" />}
            {showHistory ? <ChevronDown size={16} className="text-gray-400 dark:text-gray-500" /> : <ChevronRight size={16} className="text-gray-400 dark:text-gray-500" />}
          </button>

          {pingHistory.length > 0 && showHistory && (
            <button
              onClick={clearHistory}
              disabled={historyLoading}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-600 hover:text-white border border-red-200/60 dark:border-red-400/20 hover:border-red-600 transition-all disabled:opacity-50"
            >
              <Trash2 size={12} /> Clear History
            </button>
          )}
        </div>

        {showHistory && (
          <div className="space-y-3">
            {pingHistory.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-xs text-center py-4">No ping history found for this app.</p>
            ) : (
              pingHistory.map((entry, idx) => (
                <PingHistoryItem key={entry.id || idx} entry={entry} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PingHistoryItem({ entry }) {
  const [expanded, setExpanded] = useState(false);

  const isOk = entry.status === 'SUCCESS';
  const isPartial = entry.status === 'PARTIAL';

  const badgeCls = isOk ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20' :
                   isPartial ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20' :
                   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20';

  const icon = isOk ? <CheckCircle2 size={12} /> :
               isPartial ? <AlertCircle size={12} /> :
               <XCircle size={12} />;

  return (
    <div className="bg-white/50 dark:bg-gray-900/40 border border-gray-200/60 dark:border-gray-700/60 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {new Date(entry.timestamp).toLocaleString()}
          </span>
          <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeCls}`}>
            {icon} {entry.status}
          </span>
          {entry.responseTimeMs != null && (
            <span className="text-xs font-mono text-gray-600 dark:text-gray-300">{entry.responseTimeMs}ms</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 dark:text-gray-500 max-w-[200px] truncate font-mono" title={entry.endpoint}>{entry.endpoint || 'No Endpoint'}</span>
          {expanded ? <ChevronDown size={14} className="text-gray-400 dark:text-gray-500"/> : <ChevronRight size={14} className="text-gray-400 dark:text-gray-500"/>}
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-gray-200/60 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-800/40">
          {entry.error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{entry.error}</p>}
          {entry.payload && (
            <div>
              <p className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-2">Response Body</p>
              <PostmanJsonViewer data={entry.payload} maxHeight="240px" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
