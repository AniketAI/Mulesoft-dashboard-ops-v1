import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
import { Search, Users, RefreshCw, AlertTriangle, Copy, Check, Key, Lock, ChevronRight, ChevronDown, Building2, Download, X, SlidersHorizontal, ArrowUpDown, Hash } from 'lucide-react';
import api from '../services/api';
import { getCached, getCachedSWR, setCached } from '../services/apiCache';
import { CK } from '../services/cacheKeys';

const CopyBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-gray-600 transition-all flex-shrink-0">
      {done ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
    </button>
  );
};

/** Copy all unique matched values for a term — shown in the term group header. */
const CopyAllBtn = ({ values = [] }) => {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(values.join('\n'));
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button
      onClick={copy}
      title={`Copy all ${values.length} unique value${values.length !== 1 ? 's' : ''} for this term`}
      className="flex items-center gap-1 px-3 py-3 text-[10px] text-slate-500 hover:text-purple-700 border-l border-gray-200/40 transition-colors flex-shrink-0 font-medium">
      {done
        ? <><Check size={10} className="text-emerald-600" /> Copied</>
        : <><Copy size={10} /> {values.length}</>}
    </button>
  );
};

// Feature 1: Highlight matched search term inside a string
function Highlight({ text, terms }) {
  if (!text || !terms?.length) return <span>{text}</span>;
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = String(text).split(pattern);
  return (
    <span>
      {parts.map((part, i) =>
        pattern.test(part)
          ? <mark key={i} className="bg-yellow-300/60 text-yellow-900 rounded-sm px-0.5 not-italic">{part}</mark>
          : part
      )}
    </span>
  );
}

function chLabel(dt) {
  if (!dt) return 'CloudHub 1.0';
  const d = dt.toLowerCase();
  return (d.includes('2') || d === 'ch2') ? 'CloudHub 2.0' : 'CloudHub 1.0';
}

// Extract the full merged property map from a CH2 detail or CH1 app object
function mergeAppProps(app) {
  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const ps = appCfg['mule.agent.application.properties.service'] || {};
  return {
    ...(ps.properties || {}),
    ...(ds.runtimeProperties || {}),
    ...(ds.properties || {}),
    ...(ds.environmentVariables || ds.environmentVars || {}),
    ...(appCfg.properties || {}),
    ...(app.application?.properties || {}),
    ...(app.properties || {}),
  };
}

function extractCpsConfig(app, orgId) {
  // Merge all possible property sources from both CH1 and CH2 detail responses
  const p = mergeAppProps(app);

  // ── CPS Base URL — try all known key variants ─────────────────────────
  let cpsBaseUrl =
    p['cps.configServerBaseUrl'] ||
    p['config.server.base.url']  ||
    p['cps.baseUrl']             ||
    p['cps.base.url']            ||
    p['cps.server.url']          ||
    p['cps.url']                 ||
    p['anypoint.config.server.baseUrl'] ||
    p['config.server.url']       ||
    p['configserver.url']        ||
    p['cloudconfig.url']         ||
    '';

  // ── Fallback: scan all property values for a CPS-like URL ────────────
  // Matches any http(s) URL whose key or value suggests a CPS/config server
  if (!cpsBaseUrl) {
    const CPS_KEY_HINT = /cps|config[.\-_]?server|configserver|cloud[.\-_]?config/i;
    for (const [key, val] of Object.entries(p)) {
      if (typeof val === 'string' && /^https?:\/\//i.test(val) && CPS_KEY_HINT.test(key)) {
        cpsBaseUrl = val;
        break;
      }
    }
  }

  // ── CPS Project Key ───────────────────────────────────────────────────
  const cpsKey =
    p['cps.projectName']    ||
    p['cloudhub.api.name']  ||
    p['cps.appName']        ||
    p['cps.app.name']       ||
    p['api.name']           ||
    app.name                ||
    '';

  // ── CPS Environment Prefix ────────────────────────────────────────────
  const cpsEnv =
    p['cps.prefix']       ||
    p['cps.environment']  ||
    p['cps.env']          ||
    p['environment']      ||
    p['deployment.env']   ||
    '';

  // ── CPS Client ID ─────────────────────────────────────────────────────
  const cpsClientId =
    p['cps.clientId']    ||
    p['cps.client_id']   ||
    p['cps.client.id']   ||
    p['cps.apiClientId'] ||
    p['cps.api.clientId'] ||
    '';

  return {
    cpsBaseUrl,
    cpsKey,
    cpsEnv,
    cpsClientId,
    deploymentType: app._type === 'ch1' ? 'ch1' : 'ch2',
    envName: app.environment?.name || '',
    bgOrgId: orgId,
  };
}

// Grouped BG+Env selector with quick-select shortcuts
function BgEnvSelector({ businessGroups, onSelectionsChange }) {
  const [allEnvs, setAllEnvs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState(() => {
    try {
      const saved = sessionStorage.getItem('userSearch_selections');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [search, setSearch] = useState('');
  const [envFilterVersion, setEnvFilterVersion] = useState(0);
  const [bgFilterVersion, setBgFilterVersion] = useState(0);
  useEffect(() => {
    const h = () => setEnvFilterVersion(v => v + 1);
    window.addEventListener('envFilterChanged', h);
    return () => window.removeEventListener('envFilterChanged', h);
  }, []);
  useEffect(() => {
    const h = () => setBgFilterVersion(v => v + 1);
    window.addEventListener('bgFilterChanged', h);
    return () => window.removeEventListener('bgFilterChanged', h);
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem('userSearch_selections', JSON.stringify([...selections])); } catch (e) {}
  }, [selections]);

  useEffect(() => {
    const visible = applyBgFilter(businessGroups);
    if (!visible.length) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled(
      visible.map(bg =>
        api.get(`/environments/${bg.id}`)
          .then(r => {
            const envList = r.data?.data || r.data?.environments || (Array.isArray(r.data) ? r.data : []);
            return envList.map(e => ({
              id: e.id,
              bgId: bg.id, bgName: bg.name,
              envId: e.id, envName: e.name, envType: e.type,
            }));
          })
          .catch(() => [])
      )
    ).then(results => {
      const flat = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      const envFiltered = applyEnvFilter(flat);
      setAllEnvs(envFiltered.length > 0 ? envFiltered : flat);
      setLoading(false);
    });
  }, [businessGroups, envFilterVersion, bgFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sel = allEnvs.filter(e => selections.has(`${e.bgId}:${e.envId}`));
    onSelectionsChange(sel);
  }, [selections, allEnvs]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchLo = search.toLowerCase().trim();
  const visibleEnvs = searchLo
    ? allEnvs.filter(e =>
        e.envName.toLowerCase().includes(searchLo) ||
        e.bgName.toLowerCase().includes(searchLo) ||
        (e.envType || '').toLowerCase().includes(searchLo)
      )
    : allEnvs;

  // Group visible envs by BG for display
  const grouped = useMemo(() => {
    const map = new Map();
    visibleEnvs.forEach(e => {
      if (!map.has(e.bgId)) map.set(e.bgId, { bgId: e.bgId, bgName: e.bgName, envs: [] });
      map.get(e.bgId).envs.push(e);
    });
    return [...map.values()];
  }, [visibleEnvs]);

  const toggle = (bgId, envId) => {
    setSelections(prev => {
      const n = new Set(prev);
      const k = `${bgId}:${envId}`;
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  // Toggle all envs of a specific BG
  const toggleBg = (bgId, envs) => {
    const keys = envs.map(e => `${e.bgId}:${e.envId}`);
    const allSelected = keys.every(k => selections.has(k));
    setSelections(prev => {
      const n = new Set(prev);
      if (allSelected) keys.forEach(k => n.delete(k));
      else keys.forEach(k => n.add(k));
      return n;
    });
  };

  const selectByType = (type) =>
    setSelections(prev => {
      const n = new Set(prev);
      allEnvs.filter(e => e.envType === type).forEach(e => n.add(`${e.bgId}:${e.envId}`));
      return n;
    });

  const clearAll = () => setSelections(new Set());
  const selectAll = () => setSelections(new Set(visibleEnvs.map(e => `${e.bgId}:${e.envId}`)));

  const prodCount = allEnvs.filter(e => e.envType === 'production').length;
  const sandboxCount = allEnvs.filter(e => e.envType !== 'production').length;

  return (
    <div className="border border-gray-300/50 rounded-xl overflow-hidden">
      {/* Quick-select shortcuts */}
      {!loading && allEnvs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-gray-300/50 bg-gray-100/20">
          <span className="text-[9px] text-gray-400 uppercase tracking-wider font-bold flex-shrink-0">Quick select:</span>
          {prodCount > 0 && (
            <button onClick={() => selectByType('production')}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-green-50/40 text-green-600 border-green-200/50 hover:bg-green-50/70 transition-colors font-medium">
              ● All Production ({prodCount})
            </button>
          )}
          {sandboxCount > 0 && (
            <button onClick={() => selectByType('sandbox')}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-yellow-50/40 text-yellow-600 border-yellow-200/50 hover:bg-yellow-50/70 transition-colors font-medium">
              ● All Sandbox ({sandboxCount})
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{selections.size}/{allEnvs.length} selected</span>
            {selections.size > 0 && (
              <button onClick={clearAll} className="text-[10px] text-red-500/70 hover:text-red-600 transition-colors">Clear all</button>
            )}
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-300/50 bg-gray-100/40">
        <Search size={11} className="text-slate-500 flex-shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search BG or environment…"
          className="flex-1 bg-transparent text-xs text-gray-700 placeholder-gray-400 focus:outline-none min-w-0"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-slate-500 hover:text-gray-600 text-xs flex-shrink-0">✕</button>
        )}
        {search && visibleEnvs.length > 0 && (
          <button onClick={selectAll} className="text-[10px] text-cyan-600 hover:text-cyan-700 font-medium flex-shrink-0 border-l border-gray-300/60 pl-2">
            Select {visibleEnvs.length}
          </button>
        )}
      </div>

      {/* Grouped environment list */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-500 text-xs">
          <RefreshCw size={12} className="animate-spin" /> Loading environments…
        </div>
      ) : grouped.length === 0 ? (
        <div className="py-6 text-center text-gray-400 text-xs">
          {search ? `No environments match "${search}"` : 'No environments available'}
        </div>
      ) : (
        <div style={{ maxHeight: '16rem', overflowY: 'auto' }}>
          {grouped.map(({ bgId, bgName, envs }) => {
            const bgKeys = envs.map(e => `${e.bgId}:${e.envId}`);
            const allBgSelected = bgKeys.every(k => selections.has(k));
            const someBgSelected = !allBgSelected && bgKeys.some(k => selections.has(k));
            return (
              <div key={bgId}>
                {/* BG group header — click to select/deselect all envs in this BG */}
                <div
                  onClick={() => toggleBg(bgId, envs)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer bg-gray-100/50 border-b border-gray-300/40 hover:bg-gray-100/70 transition-colors group`}
                >
                  <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    allBgSelected ? 'bg-cyan-500 border-cyan-400' :
                    someBgSelected ? 'bg-cyan-100/60 border-cyan-300' :
                    'border-gray-300 group-hover:border-cyan-500'
                  }`}>
                    {allBgSelected && <Check size={8} className="text-white" />}
                    {someBgSelected && <span className="text-cyan-600 text-[8px] font-bold leading-none">–</span>}
                  </div>
                  <Building2 size={10} className="text-slate-500 flex-shrink-0" />
                  <span className="text-[10px] font-semibold text-gray-500 flex-1 truncate">{bgName}</span>
                  <span className="text-[9px] text-gray-400">{envs.length} env{envs.length !== 1 ? 's' : ''}</span>
                </div>
                {/* Env rows for this BG */}
                {envs.map(env => {
                  const key = `${env.bgId}:${env.envId}`;
                  const isChecked = selections.has(key);
                  const isProd = env.envType === 'production';
                  return (
                    <div
                      key={key}
                      onClick={() => toggle(env.bgId, env.envId)}
                      className={`flex items-center gap-3 pl-8 pr-3 py-2 cursor-pointer transition-colors border-b border-gray-200/30 last:border-0 ${isChecked ? 'bg-cyan-50/20' : 'hover:bg-gray-100/30'}`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${isChecked ? 'bg-cyan-500 border-cyan-400' : 'border-gray-300 hover:border-cyan-500'}`}>
                        {isChecked && <Check size={9} className="text-white" />}
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-green-400' : 'bg-yellow-400'}`} />
                      <span className={`text-xs flex-1 ${isChecked ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>{env.envName}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${isProd ? 'bg-green-100/40 text-green-500' : 'bg-yellow-100/40 text-yellow-500'}`}>
                        {env.envType || 'sandbox'}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GlobalSearchPage() {
  const { orgId: authOrgId } = useAuth();
  const navigate = useNavigate();
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();
  const [bgs, setBgs] = useState([]);
  const [bgsLoad, setBgsLoad] = useState(false);
  const [bgEnvSelections, setBgEnvSelections] = useState([]);
  const [query, setQuery] = useState(() => sessionStorage.getItem('userSearch_query') || '');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('userSearch_results')) || null; } catch { return null; }
  });
  const [error, setError] = useState('');
  const [credentialErrors, setCredentialErrors] = useState(0);
  const [circuitBrokenUrls, setCircuitBrokenUrls] = useState([]);
  const [progress, setProgress] = useState({ envsDone: 0, envsTotal: 0, appsT: 0, appsN: 0, phase: 1, batchDone: 0, batchTotal: 0 });
  const [envStats, setEnvStats] = useState([]);
  // Feature 3: cancel
  const abortRef = useRef(null);
  // Feature 8: search mode — 'value' | 'key'
  const [searchMode, setSearchMode] = useState(() => sessionStorage.getItem('userSearch_mode') || 'value');
  const [exactMatch, setExactMatch] = useState(() => sessionStorage.getItem('userSearch_exactMatch') === 'true');
  // Feature 2: group by app toggle
  const [groupByApp, setGroupByApp] = useState(() => sessionStorage.getItem('userSearch_groupApp') === 'true');
  const [expandedApps, setExpandedApps] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('userSearch_expandedApps') || '[]')); } catch { return new Set(); }
  });
  // Group by term (search value) toggle — mutually exclusive with groupByApp
  const [groupByTerm, setGroupByTerm] = useState(() => sessionStorage.getItem('userSearch_groupTerm') === 'true');
  const [expandedTerms, setExpandedTerms] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('userSearch_expandedTerms') || '[]')); } catch { return new Set(); }
  });
  // Feature 15: sortable columns
  const [sortCol, setSortCol] = useState(() => sessionStorage.getItem('userSearch_sortCol') || '');
  const [sortDir, setSortDir] = useState(() => sessionStorage.getItem('userSearch_sortDir') || 'asc');
  // BG/Env selector collapse state
  const [selectorCollapsed, setSelectorCollapsed] = useState(() => sessionStorage.getItem('userSearch_collapsed') === 'true');

  useEffect(() => { sessionStorage.setItem('userSearch_query', query); }, [query]);
  useEffect(() => { try { sessionStorage.setItem('userSearch_results', JSON.stringify(results)); } catch (e) {} }, [results]);
  useEffect(() => { sessionStorage.setItem('userSearch_mode', searchMode); }, [searchMode]);
  useEffect(() => { sessionStorage.setItem('userSearch_exactMatch', exactMatch); }, [exactMatch]);
  useEffect(() => { sessionStorage.setItem('userSearch_groupApp', groupByApp); }, [groupByApp]);
  useEffect(() => { try { sessionStorage.setItem('userSearch_expandedApps', JSON.stringify([...expandedApps])); } catch {} }, [expandedApps]);
  useEffect(() => { sessionStorage.setItem('userSearch_groupTerm', groupByTerm); }, [groupByTerm]);
  useEffect(() => { try { sessionStorage.setItem('userSearch_expandedTerms', JSON.stringify([...expandedTerms])); } catch {} }, [expandedTerms]);
  useEffect(() => { sessionStorage.setItem('userSearch_sortCol', sortCol); }, [sortCol]);
  useEffect(() => { sessionStorage.setItem('userSearch_sortDir', sortDir); }, [sortDir]);
  useEffect(() => { sessionStorage.setItem('userSearch_collapsed', selectorCollapsed); }, [selectorCollapsed]);

  useEffect(() => {
    setBgsLoad(true);
    api.get('/organizations/business-groups').then(r => setBgs(r.data?.data || [])).catch(() => {}).finally(() => setBgsLoad(false));
  }, []);

  // Fire-and-forget credential posting — no await, runs in background.
  //
  // KEY FIX: store ALL CSV credentials as {url}::{clientId} entries so the
  // backend retry loop (which searches for {url}::* entries) can try every
  // credential when the primary one returns 401.
  // Previously only ONE credential was stored per URL+BG, so if that credential
  // didn't have access, ALL retries failed (nothing to retry with).
  const postCreds = useCallback((entries) => {
    if (!hasCpsCreds) return;
    const allCreds = getAllCredentials();
    if (!allCreds.length) return;

    // Collect unique normalised CPS base URLs from this batch of entries
    const uniqueNorms = new Set();
    const primaryByBg = new Map(); // {norm}::{bgOrgId} → best cred from app properties

    for (const e of entries) {
      if (!e.cpsBaseUrl) continue;
      const norm = e.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      uniqueNorms.add(norm);

      // If the app declares its own clientId and we have its secret, use it as primary
      const bgKey = `${norm}::${e.bgOrgId}`;
      if (!primaryByBg.has(bgKey) && e.cpsClientId) {
        const s = getSecret(e.cpsClientId);
        if (s) primaryByBg.set(bgKey, { clientId: e.cpsClientId, clientSecret: s });
      }
    }

    if (!uniqueNorms.size) return;

    // Build credential map to post to the session:
    //   {norm}::{bgOrgId}    → app-specific primary (from cpsClientId in ARM properties)
    //   {norm}::{clientId}   → ALL CSV credentials as alt entries for the retry loop
    //   {norm}               → URL-only fallback
    const credMap = {};
    for (const norm of uniqueNorms) {
      // App-specific primaries
      for (const [bgKey, cred] of primaryByBg.entries()) {
        if (bgKey.startsWith(`${norm}::`)) credMap[bgKey] = cred;
      }
      // ALL CSV credentials stored under {url}::{clientId} so retry loop finds them
      for (const { clientId, clientSecret } of allCreds) {
        credMap[`${norm}::${clientId}`] = { clientId, clientSecret };
      }
      // URL-only fallback: use first credential from CSV
      credMap[norm] = { clientId: allCreds[0].clientId, clientSecret: allCreds[0].clientSecret };
    }

    // Fire without await — credentials are stored in session for the backend
    api.post('/cps/credentials', { credentials: credMap }).catch(() => {});
  }, [hasCpsCreds, getAllCredentials, getSecret]);

  const fetchAppsForEnv = useCallback(async (bgId, envId, envName) => {
    const apps = [];
    const DETAIL_BATCH = 50;
    let ch2List = [];
    // Track status from the list (summary) to fall back on if detail doesn't have it
    const listStatusMap = {}; // id → status string

    // ── CH2: always do a fresh paginated list fetch ───────────────────────
    // Do NOT use the ApplicationsPage summary cache (apps:${bgId}:${bgId}) —
    // that cache is paginated to 100 apps and would miss apps 101+ in large envs.
    // Per-app detail cache (ch2detail:${a.id}:${envId}) is still used below.
    try {
      let offset = 0;
      while (true) {
        const r = await api.get(`/applications/cloudhub2/${bgId}/${envId}`, { params: { limit: 100, offset } });
        const items = r.data?.items || r.data?.deployments || r.data?.content || (Array.isArray(r.data) ? r.data : []);
        if (!items.length) break;
        items.forEach(a => { if (a.id && a.status) listStatusMap[a.id] = a.status; });
          ch2List.push(...items);
          // Only stop when the API returns fewer items than requested — this is the
          // definitive "last page" signal regardless of what field name the API
          // uses for the total count (total / totalItems / totalElements / count).
          // Comparing against r.data.total is unreliable because some API versions
          // return total=100 (page size) rather than the global count.
          if (items.length < 100) break;
        offset += 100;
      }
    } catch {}

    // ── Feature 17: track apps with confirmed "no CPS config" to skip detail re-fetch ──
    // After the first search, apps with no CPS properties are marked in a module-level
    // Set so subsequent searches skip the CH2 detail fetch for them entirely.
    // The key is appId:envId to scope it to the specific deployment.
    const NO_CPS_CACHE_KEY = 'noCpsAppIds';
    let noCpsIds = (() => { try { return new Set(JSON.parse(sessionStorage.getItem(NO_CPS_CACHE_KEY) || '[]')); } catch { return new Set(); } })();
    const saveNoCpsIds = () => { try { sessionStorage.setItem(NO_CPS_CACHE_KEY, JSON.stringify([...noCpsIds].slice(-500))); } catch {} };

    // ── CH2: detail fetch with per-app caching + large parallel batch ─────
    // CH2 list API does NOT return runtime properties — must fetch each app detail.
    // Per-app cache avoids re-fetching on repeat searches (5-min TTL).
    for (let i = 0; i < ch2List.length; i += DETAIL_BATCH) {
      const settled = await Promise.allSettled(
        ch2List.slice(i, i + DETAIL_BATCH).map(a => {
          const appKey = `ch2detail:${a.id}:${envId}`;
          // Feature 17: skip detail fetch for apps previously confirmed to have no CPS config
          const skipKey = `${a.id}:${envId}`;
          if (noCpsIds.has(skipKey)) {
            return Promise.resolve({ ...a, status: listStatusMap[a.id] || a.status || '', _noCps: true });
          }
          const cached = getCached(appKey);
          // Merge summary status into cached detail if detail lacks it
          if (cached) {
            if (!cached.status && listStatusMap[a.id]) cached.status = listStatusMap[a.id];
            return Promise.resolve(cached);
          }
          return api.get(`/applications/cloudhub2/${bgId}/${envId}/${a.id}`)
            .then(r => {
              const detail = r.data;
              // CH2 detail: status is in application.status, desiredStatus, or top-level status
              if (!detail.status) {
                detail.status = detail.application?.status || detail.desiredStatus
                  || listStatusMap[a.id] || '';
              }
              // Feature 17: check if this app has CPS config; if not, mark it for future skipping
              const merged = mergeAppProps(detail);
              const hasCpsUrl = !!(merged['cps.configServerBaseUrl'] || merged['config.server.base.url'] ||
                merged['cps.baseUrl'] || merged['cps.base.url'] || merged['cps.url'] ||
                Object.entries(merged).some(([k, v]) => typeof v === 'string' && /^https?:\/\//i.test(v) && /cps|config[.\-_]?server/i.test(k)));
              if (!hasCpsUrl) { noCpsIds.add(`${a.id}:${envId}`); saveNoCpsIds(); }
              setCached(appKey, detail);
              return detail;
            })
            .catch(() => ({ ...a, status: listStatusMap[a.id] || a.status || '' }));
        })
      );
      settled.forEach(s => { if (s.status === 'fulfilled' && s.value && !s.value._noCps) apps.push(s.value); });
    }

    // ── CH1: always fetch fresh list (1 call returns ALL apps with properties)
    // CH1 list API returns the full properties map directly — no per-app detail needed.
    // Cache the list per env (5-min TTL) to speed up repeat searches.
    // SWR: serve stale data immediately and re-fetch silently in background.
    try {
      const ch1Key = CK.ch1list(bgId, envId);
      const ch1Swr = getCachedSWR(ch1Key);
      let ch1Data = ch1Swr?.data || null;
      if (!ch1Data) {
        const r = await api.get(`/applications/cloudhub1/${envId}`, { params: { orgId: bgId } });
        ch1Data = Array.isArray(r.data) ? r.data : (r.data?.applications || r.data?.data || []);
        setCached(ch1Key, ch1Data, 5 * 60 * 1000);
      } else if (ch1Swr?.stale) {
        // Serve stale data now; refresh cache in background for the next search
        api.get(`/applications/cloudhub1/${envId}`, { params: { orgId: bgId } })
          .then(r => {
            const fresh = Array.isArray(r.data) ? r.data : (r.data?.applications || r.data?.data || []);
            setCached(ch1Key, fresh, 5 * 60 * 1000);
          })
          .catch(() => {});
      }
      apps.push(...ch1Data.map(c => ({
        _type: 'ch1', id: c.domain, name: c.domain,
        properties: c.properties || {}, // full properties from CH1 list API
        status: c.status || '',          // CH1 status (STARTED / STOPPED etc.)
        environment: { name: envName, id: envId },
      })));
    } catch {}

    return apps;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelSearch = () => { abortRef.current?.abort(); };

  const clearSearchState = () => {
    cancelSearch();
    setQuery('');
    setResults(null);
    setError('');
    setProgress({ envsDone: 0, envsTotal: 0, appsT: 0, appsN: 0, phase: 1, batchDone: 0, batchTotal: 0 });
    setEnvStats([]);
    setExpandedApps(new Set());
    setExpandedTerms(new Set());
    setCircuitBrokenUrls([]);
    setSelectorCollapsed(false);
    try { sessionStorage.removeItem('cpsUnreachableUrls'); } catch {}
    // Note: bgEnvSelections are managed by BgEnvSelector and not cleared by default
    // to preserve UX, but we clear the results and query to reset the view.
  };

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const SortBtn = ({ col }) => (
    <button onClick={() => toggleSort(col)} className="ml-0.5 opacity-40 hover:opacity-100 transition-opacity">
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : <ArrowUpDown size={9} />}
    </button>
  );

  const runSearch = async () => {
    if (!query.trim()) { setError('Enter a search term.'); return; }
    if (!bgEnvSelections.length) { setError('Select at least one Environment.'); return; }
    // Feature 3: cancel previous search
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

      // Auto-collapse the selector panel when search starts to give results more space
      setSelectorCollapsed(true);
      setLoading(true); setError(''); setResults(null); setCredentialErrors(0); setCircuitBrokenUrls([]); setEnvStats([]);
    setProgress({ envsDone: 0, envsTotal: bgEnvSelections.length, appsT: 0, appsN: 0, phase: 1, batchDone: 0, batchTotal: 0 });

    // Feature 9: multi-term — split by comma
    const terms = query.trim().split(',').map(t => t.trim()).filter(Boolean);

    // ── Phase 1: Fetch all envs in PARALLEL ───────────────────────────────
    const searchTermLo = terms[0].toLowerCase(); // primary term for ARM scan
    const armRows = []; // direct ARM/deployment property matches (no CPS)

    const envResults = await Promise.allSettled(
      bgEnvSelections.map(async (sel) => {
        const apps = await fetchAppsForEnv(sel.bgId, sel.envId, sel.envName);
        const allMapped = apps.map(a => ({
          appName: a.name,
          appId: a.id || a.name,
          ...extractCpsConfig(a, sel.bgId),
          envName: a.environment?.name || sel.envName,
          envId: sel.envId,
          status: a.status || a.target?.desiredStatus || a.target?.status || '',
        }));
        const entries = allMapped.filter(e => e.cpsBaseUrl && e.cpsKey);

        // ── Infer CPS URL for apps without one ───────────────────────────────
        // Some CH2 apps (e.g. job-s360-edh-account-v1) don't store cpsBaseUrl
        // in their ARM deployment properties, but they use the SAME CPS server
        // as every other app in the same BG+env.
        // Find the dominant (most-used) CPS URL from apps that DO have it,
        // then assign it to the apps that don't so they also get searched.
        const urlCounts = entries.reduce((acc, e) => {
          acc[e.cpsBaseUrl] = (acc[e.cpsBaseUrl] || 0) + 1;
          return acc;
        }, {});
        const dominantCpsUrl = Object.entries(urlCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || '';
        const fallbackEnv = sel.envType === 'production' || sel.envName.toLowerCase().includes('prod') ? 'prod' : '';
        const inferredEntries = dominantCpsUrl
          ? allMapped
              .filter(e => !e.cpsBaseUrl && e.cpsKey)
              .map(e => ({ ...e, cpsBaseUrl: dominantCpsUrl, cpsEnv: e.cpsEnv || fallbackEnv }))
          : [];
        const allEnvEntries = [...entries, ...inferredEntries];

        // Fire-and-forget credentials (no await)
        if (allEnvEntries.length) postCreds(allEnvEntries);

        // ── Also scan ARM deployment properties directly ───────────────
        for (const a of apps) {
          if (ctl.signal.aborted) break;
          const p = mergeAppProps(a);
          // Feature 8: key mode searches property keys; value mode searches values
          // Feature 8: key mode searches property keys; value mode searches values
          const hits = Object.entries(p).filter(([k, v]) => {
            const target = searchMode === 'key' ? k : (typeof v === 'string' ? v : '');
            if (!target) return false;
            return terms.some(t => exactMatch ? target.toLowerCase() === t.toLowerCase() : target.toLowerCase().includes(t.toLowerCase()));
          });
          if (hits.length > 0) {
            armRows.push({
              bgName: sel.bgName,
              chEnv: a.environment?.name || sel.envName,
              chVersion: chLabel(a._type === 'ch1' ? 'ch1' : 'ch2'),
              appName: a.name,
              appId: a.id || a.name,
              bgOrgId: sel.bgId,
              envId: sel.envId,
              status: a.status || '',
              nsKey: '(ARM props)',
              cpsPrefix: '—',
              secureKey: '',
              propKey: hits.map(([k]) => k).join(', '),
              apiUser: hits[0][1],
              password: '—',
              source: 'arm-props',
            });
          }
        }

        // Per-env stat tracking
        setEnvStats(prev => [...prev, {
          envName: sel.envName, bgName: sel.bgName,
          total: apps.length, withCps: allEnvEntries.length,
        }]);
        setProgress(p => ({
          ...p,
          appsT: p.appsT + apps.length,
          envsDone: p.envsDone + 1,
        }));
        return allEnvEntries;
      })
    );

    // ── Surface env-level fetch failures to the user ──────────────────────
    const failedEnvCount = envResults.filter(r => r.status === 'rejected').length;
    if (failedEnvCount > 0) {
      setError(`Warning: ${failedEnvCount} environment${failedEnvCount !== 1 ? 's' : ''} could not be loaded and were skipped. Results may be incomplete.`);
    }

    // ── Phase 2: Flatten + deduplicate entries ─────────────────────────────
    const seen = new Set();
      const allEntries = envResults
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .filter(e => {
          // Deduplicate by cpsUrl + cpsKey + cpsEnv + bgOrgId + envId
          // Use envId (CloudHub UUID) instead of envName — envName can be identical
          // across BGs (e.g., both EI-FI-PROD and BT-FINANCE-PROD have CH env named
          // "Production"), while envId is always unique per BG+environment combination.
          const k = `${e.cpsBaseUrl}||${e.cpsKey}||${e.cpsEnv}||${e.bgOrgId}||${e.envId || e.envName}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

    // ── Pre-filter: skip apps whose CPS URL was previously confirmed unreachable ──
    // The backend circuit breaker reports unreachable CPS URLs per search and we
    // cache them in sessionStorage so repeat searches skip them instantly instead
    // of waiting for timeouts again.
    const normCpsUrl = (url) => (url || '').trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const cachedUnreachable = (() => {
      try { return new Set(JSON.parse(sessionStorage.getItem('cpsUnreachableUrls') || '[]')); } catch { return new Set(); }
    })();
    const entriesToSearch = cachedUnreachable.size > 0
      ? allEntries.filter(e => !cachedUnreachable.has(normCpsUrl(e.cpsBaseUrl)))
      : allEntries;
    const preFilteredCount = allEntries.length - entriesToSearch.length;

    setProgress(p => ({ ...p, appsN: entriesToSearch.length }));

    if (!entriesToSearch.length) {
      const msg = preFilteredCount > 0
        ? `All ${allEntries.length} CPS-configured app(s) skipped — their CPS server(s) were unreachable in a previous search. Clear browser sessionStorage or restart to retry.`
        : 'No apps with CPS config found — check that apps have cps.configServerBaseUrl set';
      setError(msg);
      setResults([]); setLoading(false); return;
    }

    if (ctl.signal.aborted) { setLoading(false); return; }

    // ── Phase 3: Backend CPS fan-out search ───────────────────────────────
    // Feature 4: show incremental results as each batch arrives
    const BACKEND_BATCH = 100;
    const totalBatches = Math.ceil(entriesToSearch.length / BACKEND_BATCH);
    setProgress(p => ({ ...p, phase: 2, batchDone: 0, batchTotal: totalBatches }));

    let totalCredErrors = 0;
    let batchFailed = 0;

    for (let bi = 0; bi < entriesToSearch.length; bi += BACKEND_BATCH) {
      if (ctl.signal.aborted) break;
      const batch = entriesToSearch.slice(bi, bi + BACKEND_BATCH);
      const batchNum = Math.floor(bi / BACKEND_BATCH) + 1;
      try {
        // Feature 8: pass searchMode to backend (value search = username, key search = different param)
        const payload = {
          username: terms.join(','),
          apps: batch,
          searchMode,
          exactMatch
        };
        const r = await api.post('/cps/search-user', payload, { timeout: 120000 });
        totalCredErrors += r.data?.credentialErrors || 0;

        // Collect circuit-broken URLs reported by the backend circuit breaker.
        // Also persist to sessionStorage so the pre-filter above skips them on
        // the next search without waiting for another round of timeouts.
        if (r.data?.circuitBrokenUrls?.length > 0) {
          setCircuitBrokenUrls(prev => [...new Set([...prev, ...r.data.circuitBrokenUrls])]);
          try {
            const existing = new Set(JSON.parse(sessionStorage.getItem('cpsUnreachableUrls') || '[]'));
            r.data.circuitBrokenUrls.forEach(u => existing.add(u));
            sessionStorage.setItem('cpsUnreachableUrls', JSON.stringify([...existing]));
          } catch {}
        }

        // Feature 4: incrementally build and display results after each batch
        const batchRows = [];
        for (const item of r.data?.results || []) {
          let origApp = {};
          if(batch && batch.length > 0){
            for (let i = 0;i<batch.length; i++){
              if(batch[i] && batch[i].appName === item?.appName && batch[i].envName === item?.envName){
                origApp = batch[i];
                break;
              }
            }
          }
          for (const prop of item.matchedProps || []) {
            batchRows.push({
              bgName: item.bgName || origApp.bgName || origApp.envName?.split('/')[0] || item.envName?.split('/')[0] || '—',
              chEnv: item.envName || origApp.envName || '—',
              chVersion: chLabel(item.deploymentType || origApp.deploymentType),
              appName: item.appName,
              appId: item.appId || origApp.appId || item.appName,
              bgOrgId: item.bgOrgId || origApp.bgOrgId || '',
              envId: item.envId || origApp.envId || '',
              status: item.status || origApp.status || '',
              nsKey: item.cpsKey || '—',
              cpsPrefix: item.cpsPrefix || '—',
              secureKey: prop.secureGroupKey || (prop.source === 'secure' ? '(secure)' : ''),
              propKey: prop.key,
              apiUser: prop.value,
              password: prop.password || '—',
              source: prop.source,
            });
          }
        }
        setResults(prev => (prev ? [...prev, ...batchRows] : batchRows));
      } catch (batchErr) {
        batchFailed++;
        if (!ctl.signal.aborted)
          console.warn(`[search-user] batch ${batchNum}/${totalBatches} failed:`, batchErr.message);
      }
      setProgress(p => ({ ...p, batchDone: batchNum }));
    }

    if (!ctl.signal.aborted) {
      setCredentialErrors(totalCredErrors);
      // Merge ARM rows, ensuring no duplicate with CPS results
      setResults(prev => {
        const cpsAppNames = new Set((prev || []).map(r => r.appName));
        const uniqueArmRows = armRows.filter(r => !cpsAppNames.has(r.appName));
        return [...(prev || []), ...uniqueArmRows];
      });
      if (batchFailed > 0 && batchFailed === totalBatches) {
        setError(`Search failed — all ${totalBatches} batch(es) returned errors. Check backend logs.`);
      }
    }
    setLoading(false);
  };

  const exportCsv = () => {
    if (!results || !results.length) return;
    // Feature 13: include Business Group as first column
    const H = ['Business Group', 'Cloudhub Environment', 'Cloudhub Version', 'Integration Name', 'Status', 'Non-Secure Key', 'CPS Prefix', 'Secure Key', 'Found In Property Key', 'API User', 'Password'];
    const rows = results.map(r => [r.bgName || '—', r.chEnv, r.chVersion, r.appName, r.status || '—', r.nsKey, r.cpsPrefix, r.secureKey, r.propKey, r.apiUser, r.password]);
    const csv = [H, ...rows].map(row => row.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'global-search-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /**
   * Export grouped results to XLSX — single sheet with section markers.
   *
   * Layout (one sheet named "Search Results"):
   *   Row 1  : Column headers
   *   Per term:
   *     ── # <term>  (<N> matches) ──   ← term separator row
   *     Per Business Group:
   *       ▶  <BG Name>                  ← BG section header
   *       Per Secure Key (NS first):
   *         🔑/🔒 <SK Name>             ← SK sub-section header
   *         data row …                  ← full data rows
   *       (blank row between BGs)
   *
   * Column order:
   *   Business Group | CH Environment | CH Version | Integration Name |
   *   Status | NS Key | CPS Prefix | Secure Key | Property Key | API User | Password
   */
  /**
   * Export a pivot/summary XLSX — one row per unique matched value (username/apiUser).
   *
   * Columns:
   *   Username                 → the matched value (apiUser)
   *   Secure Keys              → BG Name \n   secure-group-key  (for secure-prop matches)
   *   Directly connected APIs  → BG Name \n   app-name  (all apps where this value was found)
   *
   * Format mirrors the user-requested layout: BG name as section label,
   * integration/key names indented on following lines within the cell.
   */
  const exportSummaryXlsx = () => {
    if (!results || !results.length) return;

    // Group by unique apiUser value
    // userMap: apiUser → { passwords: Map<bgName, Set<pw>>, secureKeys: Map<bgName, Set<skName>>, apps: Map<bgName, Set<appName>> }
    const userMap = new Map();
    results.forEach(row => {
      const user = row.apiUser || '—';
      if (!userMap.has(user)) userMap.set(user, { passwords: new Map(), secureKeys: new Map(), apps: new Map() });
      const entry = userMap.get(user);
      const bg = row.bgName || '—';

      // Passwords — collect unique non-blank, non-masked passwords per BG
      const pw = row.password;
      if (pw && pw !== '—' && pw !== '' && !/^\*+$/.test(pw)) {
        if (!entry.passwords.has(bg)) entry.passwords.set(bg, new Set());
        entry.passwords.get(bg).add(pw);
      }

      // Secure keys — only when row has an actual secure group key
      if (row.secureKey) {
        if (!entry.secureKeys.has(bg)) entry.secureKeys.set(bg, new Set());
        entry.secureKeys.get(bg).add(row.secureKey);
      }

      // Connected apps — every row contributes its app name + status
      if (!entry.apps.has(bg)) entry.apps.set(bg, new Set());
      const appDisplay = row.appName ? `${row.appName} -> ${row.status || 'unknown'}` : '—';
      entry.apps.get(bg).add(appDisplay);
    });

    const headers = ['Username', 'Password', 'Secure Keys', 'Directly connected APIs'];
    const aoa = [headers];

    for (const [username, { passwords, secureKeys, apps }] of userMap.entries()) {
      // Password cell: "BG\npw1\npw2\n\nBG2\npw3\n"
      const pwLines = [];
      [...passwords.entries()].forEach(([bg, pws]) => {
        pwLines.push(bg);
        [...pws].forEach(pw => pwLines.push(pw));
        pwLines.push(''); // blank line after each BG
      });

      // Secure Keys cell: "BG\nkey1\nkey2\n\nBG2\nkey3\n"
      const skLines = [];
      [...secureKeys.entries()].forEach(([bg, keys]) => {
        skLines.push(bg);
        [...keys].forEach(k => skLines.push(k));
        skLines.push('');
      });

      // Directly connected APIs cell: "BG\napp1\napp2\n\nBG2\napp3\n"
      const appLines = [];
      [...apps.entries()].forEach(([bg, appNames]) => {
        appLines.push(bg);
        [...appNames].forEach(a => appLines.push(a));
        appLines.push('');
      });

      aoa.push([username, pwLines.join('\n'), skLines.join('\n'), appLines.join('\n')]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 42 }, { wch: 35 }, { wch: 45 }, { wch: 55 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'User Summary');
    XLSX.writeFile(wb, `user-summary-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`);
  };

  const exportGroupedXlsx = (termGroupsMap, getMatchedTermFn, activeTermsList, searchModeCurrent) => {
    const COL_HDR = [
      'Business Group', 'CH Environment', 'CH Version',
      'Integration Name', 'Status', 'NS Key', 'CPS Prefix',
      'Secure Key', 'Property Key', 'API User', 'Password',
    ];

    const aoa = [COL_HDR]; // single array-of-arrays for the whole sheet

    for (const term of activeTermsList) {
      const termRows = termGroupsMap.get(term) || [];

      // ── Term separator row ──────────────────────────────────────────────
      const termLabel = `${term}  (${termRows.length} match${termRows.length !== 1 ? 'es' : ''})`;
      aoa.push([termLabel, ...Array(COL_HDR.length - 1).fill('')]);

      if (!termRows.length) {
        aoa.push(['(no results)', ...Array(COL_HDR.length - 1).fill('')]);
        aoa.push(Array(COL_HDR.length).fill(''));
        continue;
      }

      // Build BG → SecureKey → rows structure
      const bgMap = new Map();
      termRows.forEach(row => {
        const bg = row.bgName || '—';
        if (!bgMap.has(bg)) bgMap.set(bg, new Map());
        const skMap = bgMap.get(bg);
        const sk = row.secureKey || 'Non-Secure';
        if (!skMap.has(sk)) skMap.set(sk, []);
        skMap.get(sk).push(row);
      });

      for (const [bgName, skMap] of bgMap.entries()) {
        // BG section header
        aoa.push([`${bgName}`, ...Array(COL_HDR.length - 1).fill('')]);

        // Sort: Non-Secure first, then secure groups alphabetically
        const sortedSk = [...skMap.entries()].sort(([a], [b]) => {
          if (a === 'Non-Secure') return -1;
          if (b === 'Non-Secure') return 1;
          return a.localeCompare(b);
        });

        for (const [skName, skRows] of sortedSk) {
          // Secure-key sub-section header
          aoa.push(['', `  ${skName === 'Non-Secure' ? '🔑 Non-Secure' : `🔒 ${skName}`}`, ...Array(COL_HDR.length - 2).fill('')]);

          // Group by Integration Name (appName) within each SK section
          const appNameMap = new Map();
          skRows.forEach(row => {
            const app = row.appName || '—';
            if (!appNameMap.has(app)) appNameMap.set(app, []);
            appNameMap.get(app).push(row);
          });

          for (const [appName, appRows] of appNameMap.entries()) {
            // Integration name sub-header (indented in column 4)
            const appHdr = Array(COL_HDR.length).fill('');
            appHdr[3] = `    ⊕  ${appName}${appRows[0]?.status ? `  [${appRows[0].status}]` : ''}`;
            aoa.push(appHdr);

            // Data rows for this integration
            for (const row of appRows) {
              aoa.push([
                row.bgName    || '—',
                row.chEnv     || '—',
                row.chVersion || '—',
                row.appName   || '—',
                row.status    || '',
                row.nsKey     || '—',
                row.cpsPrefix || '—',
                row.secureKey || '',
                row.propKey   || '—',
                row.apiUser   || '',
                row.password  || '—',
              ]);
            }
          }
        }
        aoa.push(Array(COL_HDR.length).fill('')); // blank row between BGs
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Set sensible column widths
    ws['!cols'] = [20, 18, 8, 28, 10, 20, 10, 22, 28, 30, 10].map(w => ({ wch: w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Search Results');
    XLSX.writeFile(wb, `grouped-search-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`);
  };

  const selCount = bgEnvSelections.length;
  const COL_HEADERS = ['#', 'Cloudhub Environment', 'Cloudhub Version', 'Integration Name', 'Status', 'Non-Secure Key', 'CPS Prefix', 'Secure Key', 'Found In Property Key', 'API User', 'Password'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Users size={20} className="text-cyan-600" /> Global Search</h1>
        <p className="text-slate-500 text-sm mt-1">Search for a username across all app CPS non-secure & secure properties</p>
      </div>

      <div className="bg-white/50 border border-gray-200/60 rounded-2xl overflow-hidden">
        {/* Header — always visible, click anywhere to toggle */}
        <button
          onClick={() => setSelectorCollapsed(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-100/30 transition-colors">
          <div className="flex items-center gap-2">
            <ChevronDown
              size={14}
              className={`text-slate-500 transition-transform flex-shrink-0 ${selectorCollapsed ? '-rotate-90' : ''}`}
            />
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Business Groups & Environments</p>
          </div>
          {selCount > 0 && (
            <span className="text-[10px] text-cyan-600 font-medium flex-shrink-0">
              {selCount} env{selCount !== 1 ? 's' : ''} across {new Set(bgEnvSelections.map(s => s.bgId)).size} BG{new Set(bgEnvSelections.map(s => s.bgId)).size !== 1 ? 's' : ''} selected
            </span>
          )}
          {selCount === 0 && (
            <span className="text-[10px] text-gray-400 flex-shrink-0">
              {selectorCollapsed ? 'Click to expand' : 'Select environments…'}
            </span>
          )}
        </button>

        {/* Collapsible body */}
        {!selectorCollapsed && (
          <div className="px-5 pb-4 space-y-3 border-t border-gray-200/40">
            <div className="pt-3">
              {bgsLoad
                ? <div className="flex items-center gap-2 text-slate-500 text-xs py-2"><RefreshCw size={13} className="animate-spin" /> Loading…</div>
                : <BgEnvSelector businessGroups={bgs} onSelectionsChange={setBgEnvSelections} />
              }
            </div>
            {selCount > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {bgEnvSelections.map(s => (
                  <span key={s.bgId + ':' + s.envId}
                    className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' + (s.envType === 'production' ? 'bg-green-50/40 text-green-600 border-green-200/50' : 'bg-yellow-50/40 text-yellow-600 border-yellow-200/50')}>
                    {s.bgName} / {s.envName}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Collapsed summary — show selected env pills in a compact single line */}
        {selectorCollapsed && selCount > 0 && (
          <div className="px-5 pb-3 flex flex-wrap gap-1.5 border-t border-gray-200/30 pt-2">
            {bgEnvSelections.map(s => (
              <span key={s.bgId + ':' + s.envId}
                className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' + (s.envType === 'production' ? 'bg-green-50/40 text-green-600 border-green-200/50' : 'bg-yellow-50/40 text-yellow-600 border-yellow-200/50')}>
                {s.bgName} / {s.envName}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && runSearch()}
              placeholder={searchMode === 'key' ? 'Enter property key name to find (e.g. db.username)…' : 'Enter username / email / value to search in CPS properties…'}
              className="w-full bg-white/60 border border-gray-200/80 rounded-xl pl-10 pr-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-cyan-300/50 focus:bg-white" />
          </div>
          {/* Feature 3: Cancel button during search */}
          {loading
            ? <button onClick={cancelSearch}
                className="flex items-center gap-2 px-5 py-3 bg-red-800 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                <X size={14} /> Cancel
              </button>
            : (
              <>
                {(query || results) && (
                  <button onClick={clearSearchState}
                    className="flex items-center gap-2 px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                    <X size={14} /> Clear
                  </button>
                )}
                <button onClick={runSearch} disabled={!query.trim() || !selCount}
                  className="flex items-center gap-2 px-5 py-3 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                  <Search size={14} /> Search
                </button>
              </>
            )}
        </div>
        {/* Feature 8: Search mode toggle + Feature 9: multi-term hint */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100/60 border border-gray-300/40 rounded-lg p-0.5">
            {[['value','Search Values'], ['key','Search Keys']].map(([mode, label]) => (
              <button key={mode} onClick={() => setSearchMode(mode)}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-all ${searchMode === mode ? 'bg-cyan-700 text-white' : 'text-slate-500 hover:text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-gray-100/60 border border-gray-300/40 rounded-lg p-0.5">
            <button onClick={() => setExactMatch(!exactMatch)}
              className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-all ${exactMatch ? 'bg-cyan-700 text-white' : 'text-slate-500 hover:text-gray-600'}`}>
              Exact Match (Case Insensitive)
            </button>
          </div>
          <p className="text-[10px] text-gray-400">
            {searchMode === 'value'
              ? 'Tip: separate multiple terms with commas — e.g. john.doe, jane.smith'
              : 'Key mode: finds apps that have this property key configured (any value)'}
          </p>
        </div>
      </div>

      {!hasCpsCreds && (
        <div className="flex items-center gap-3 bg-yellow-50/20 border border-yellow-200/40 rounded-xl px-4 py-3 text-yellow-600/80 text-xs">
          <AlertTriangle size={13} className="flex-shrink-0" />
          No CPS credentials imported — use the <strong className="text-yellow-700">CPS CSV import</strong> in the header to also search secure properties.
        </div>
      )}

      {/* Feature 1.9: informative empty state when no search has been run yet */}
      {results === null && !loading && (
        <div className="bg-white/40 border border-gray-200/60 rounded-2xl px-6 py-8 space-y-5">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-cyan-50/40 border border-cyan-200/30 flex-shrink-0">
              <Users size={20} className="text-cyan-600" />
            </div>
            <div>
              <h3 className="text-gray-900 text-sm font-semibold">How Global Search works</h3>
              <p className="text-gray-500 text-xs mt-1 leading-relaxed">
                Searches for a username or email substring across <strong className="text-gray-600">CPS non-secure and secure properties</strong> for every app in the selected environments.
                Also scans ARM deployment properties (CloudHub environment variables) as a fallback.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                icon: '🔍',
                title: 'Property keys scanned',
                items: ['.username', '.user', '.login', '.email', '.apiUser', '(any key whose value contains your search)'],
              },
              {
                icon: '🗝️',
                title: 'What you need',
                items: ['Select 1+ environments above', 'Import a CPS CSV (header: CPS Credentials)', 'Enter a username or partial email'],
              },
              {
                icon: '📋',
                title: 'What you get back',
                items: ['App name + environment + status', 'The exact property key containing the match', 'CPS secure group name (if secure)', 'Associated password value (plain text)'],
              },
            ].map(({ icon, title, items }) => (
              <div key={title} className="bg-gray-100/30 border border-gray-300/40 rounded-xl p-4 space-y-2">
                <p className="text-gray-600 text-xs font-semibold flex items-center gap-2">
                  <span>{icon}</span> {title}
                </p>
                <ul className="space-y-1">
                  {items.map(item => (
                    <li key={item} className="text-slate-500 text-[10px] flex items-start gap-1.5">
                      <span className="text-cyan-700 flex-shrink-0 mt-0.5">›</span>
                      <code className="font-mono">{item}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-gray-400 text-[10px] text-center">
            💡 Tip: search for a partial email (e.g. <code className="text-slate-500">@company.com</code>) to find all service accounts, or an ldap username to locate where it's used across integrations.
          </p>
        </div>
      )}

      {loading && (
        <div className="bg-white/50 border border-gray-200/60 rounded-2xl px-5 py-6 flex flex-col items-center gap-3">
          <RefreshCw size={22} className="animate-spin text-cyan-600" />
          <p className="text-gray-600 text-sm font-medium">
            {progress.phase === 1 ? 'Phase 1 — Fetching app lists…' : 'Phase 2 — Scanning CPS properties…'}
          </p>
          {/* Feature 11: two-phase progress */}
          {progress.phase === 1 && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{progress.envsDone}/{progress.envsTotal} envs</span>
              <span>{progress.appsT} apps found</span>
              {progress.appsN > 0 && <span>{progress.appsN} with CPS</span>}
            </div>
          )}
          {progress.phase === 2 && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>Batch {progress.batchDone}/{progress.batchTotal}</span>
              <span>{progress.appsN} apps</span>
              {results?.length > 0 && <span className="text-emerald-600/80">✓ {results.length} match{results.length !== 1 ? 'es' : ''} so far</span>}
            </div>
          )}
          <div className="w-full max-w-xs">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-600 rounded-full transition-all duration-300" style={{ width:
                progress.phase === 1 && progress.envsTotal > 0 ? `${Math.round((progress.envsDone / progress.envsTotal) * 50)}%`
                : progress.phase === 2 && progress.batchTotal > 0 ? `${50 + Math.round((progress.batchDone / progress.batchTotal) * 50)}%`
                : '0%'
              }} />
            </div>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-start gap-3 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-sm">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      {results !== null && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={'text-xs px-2.5 py-1 rounded-full font-bold border ' + (results.length > 0 ? 'bg-emerald-50/50 text-emerald-700 border-emerald-300/50' : 'bg-gray-100/60 text-slate-500 border-gray-300/40')}>
                {results.length} match{results.length !== 1 ? 'es' : ''}
              </span>
            </div>
            {/* Per-env diagnostic — helps identify BGs where apps have no CPS config */}
            {envStats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {envStats.map((s, i) => (
                  <span key={i} className={`text-[9px] px-2 py-0.5 rounded-full border font-mono ${
                    s.withCps === 0 ? 'bg-yellow-50/30 text-yellow-500 border-yellow-200/40' : 'bg-gray-100/40 text-slate-500 border-gray-300/40'
                  }`} title={`${s.bgName} / ${s.envName}: ${s.total} apps, ${s.withCps} with CPS config`}>
                    {s.bgName}/{s.envName}: {s.withCps}/{s.total} CPS
                  </span>
                ))}
              </div>
            )}
            {/* Feature 2: group-by-app / group-by-term toggles (mutually exclusive) */}
            <div className="flex items-center gap-2">
              <button onClick={() => { setGroupByApp(v => !v); setGroupByTerm(false); }}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${groupByApp ? 'bg-cyan-100 border-cyan-300/60 text-cyan-700' : 'bg-gray-100/60 border-gray-300/40 text-gray-500 hover:text-gray-600'}`}>
                <Building2 size={11} /> {groupByApp ? 'Grouped by App' : 'Group by App'}
              </button>
              <button onClick={() => { setGroupByTerm(v => !v); setGroupByApp(false); }}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${groupByTerm ? 'bg-purple-100 border-purple-300/60 text-purple-700' : 'bg-gray-100/60 border-gray-300/40 text-gray-500 hover:text-gray-600'}`}>
                <Hash size={11} /> {groupByTerm ? 'Grouped by Term' : 'Group by Term'}
              </button>
              {results.length > 0 && (
                <button onClick={exportCsv}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-emerald-600 hover:text-emerald-700 bg-emerald-50/40 border border-emerald-200/40 rounded-xl transition-colors font-medium">
                  <Download size={13} /> Export CSV
                </button>
              )}
              {results.length > 0 && (
                <button onClick={exportSummaryXlsx}
                  title="Export summary: Username | Secure Keys | Directly Connected APIs"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-cyan-600 hover:text-cyan-700 bg-cyan-50/40 border border-cyan-200/40 rounded-xl transition-colors font-medium">
                  <Download size={13} /> Export Summary
                </button>
              )}
              {/* XLSX export — only shown in Group by Term mode (multi-sheet, one per term) */}
              {results.length > 0 && groupByTerm && (() => {
                const at = query.trim().split(',').map(t => t.trim()).filter(Boolean);
                if (at.length <= 1) return null;
                const tg = new Map();
                at.forEach(t => tg.set(t, []));
                results.forEach(row => {
                  const field = searchMode === 'key' ? row.propKey : row.apiUser;
                  const term = at.find(t => String(field || '').toLowerCase().includes(t.toLowerCase())) || at[0];
                  tg.get(term)?.push(row);
                });
                return (
                  <button
                    onClick={() => exportGroupedXlsx(tg, null, at, searchMode)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-purple-600 hover:text-purple-700 bg-purple-50/40 border border-purple-200/40 rounded-xl transition-colors font-medium">
                    <Download size={13} /> Export XLSX
                  </button>
                );
              })()}
            </div>
          </div>

          {credentialErrors > 0 && (
            <div className="flex items-start gap-3 bg-yellow-50/20 border border-yellow-200/40 rounded-xl px-4 py-3">
              <AlertTriangle size={13} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-700 text-xs font-semibold">
                  {credentialErrors} app{credentialErrors !== 1 ? 's' : ''} not searched — missing CPS credentials
                </p>
                <p className="text-yellow-500/80 text-[10px] mt-0.5">
                  These apps use a CPS server not covered by your uploaded credentials CSV. Upload a broader CSV via the <strong className="text-yellow-600">CPS CSV import</strong> button in the header to include them.
                </p>
              </div>
            </div>
          )}

          {circuitBrokenUrls.length > 0 && (
            <div className="flex items-start gap-3 bg-orange-50/20 border border-orange-200/40 rounded-xl px-4 py-3">
              <AlertTriangle size={13} className="text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-orange-700 text-xs font-semibold">
                  {circuitBrokenUrls.length} CPS server{circuitBrokenUrls.length !== 1 ? 's' : ''} unreachable — apps on those servers were skipped (circuit breaker)
                </p>
                <p className="text-orange-500/80 text-[10px] mt-1">
                  After 3 consecutive timeouts the circuit breaker opened and remaining apps on these servers were skipped instantly.
                  These URLs are cached in this browser session — press <strong className="text-orange-600">Clear</strong> to reset and retry them.
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {circuitBrokenUrls.map(url => (
                    <li key={url} className="text-[10px] font-mono text-orange-600/70 truncate">● {url}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 bg-white/40 border border-gray-200/60 rounded-2xl">
              <Users size={32} className="text-gray-400" />
              <p className="text-slate-500 text-sm">No apps found with <span className="font-mono text-gray-500">"{query.trim()}"</span> in CPS properties</p>
            </div>
          ) : (() => {
            // Feature 9: derive active search terms for highlighting
            const activeTerms = query.trim().split(',').map(t => t.trim()).filter(Boolean);
            // Feature 15: sort results
            const sortedResults = sortCol
              ? [...results].sort((a, b) => {
                  const v = r => String(r[sortCol] ?? '').toLowerCase();
                  const cmp = v(a).localeCompare(v(b));
                  return sortDir === 'asc' ? cmp : -cmp;
                })
              : results;

            // Group by matched search term
            if (groupByTerm && activeTerms.length > 1) {
              const getMatchedTerm = (row) => {
                const field = searchMode === 'key' ? row.propKey : row.apiUser;
                return activeTerms.find(t => String(field || '').toLowerCase().includes(t.toLowerCase()))
                  || activeTerms[0];
              };

              // Build ALL term groups (including empty ones for 0-match display)
              const termGroups = new Map();
              activeTerms.forEach(t => termGroups.set(t, []));
              sortedResults.forEach(row => {
                const term = getMatchedTerm(row);
                if (!termGroups.has(term)) termGroups.set(term, []);
                termGroups.get(term).push(row);
              });

              const nonEmptyTerms = activeTerms.filter(t => (termGroups.get(t)?.length || 0) > 0);
              // Auto-expand if only 1 non-empty group and nothing manually expanded yet
              const autoExpanded = nonEmptyTerms.length === 1 && expandedTerms.size === 0
                ? new Set(nonEmptyTerms) : expandedTerms;

              return (
                <div className="space-y-3">
                  {/* ── Expand / Collapse All ────────────────────────────── */}
                  <div className="flex items-center justify-end gap-2 text-[10px]">
                    <button onClick={() => setExpandedTerms(new Set(nonEmptyTerms))}
                      className="text-slate-500 hover:text-gray-600 transition-colors">
                      Expand all
                    </button>
                    <span className="text-gray-400">·</span>
                    <button onClick={() => setExpandedTerms(new Set())}
                      className="text-slate-500 hover:text-gray-600 transition-colors">
                      Collapse all
                    </button>
                  </div>

                  {/* ── Per-term accordion (all terms, empty ones dimmed) ─── */}
                  {activeTerms.map(term => {
                    const termRows = termGroups.get(term) || [];
                    const hasMatches = termRows.length > 0;
                    const isExp = autoExpanded.has(term);

                    // 0-match term — shown as a dimmed "not found" row
                    if (!hasMatches) {
                      return (
                        <div key={term} className="flex items-center gap-3 px-4 py-2.5 bg-white/30 border border-gray-200/40 rounded-xl opacity-50">
                          <Hash size={11} className="text-gray-400 flex-shrink-0" />
                          <span className="font-mono text-sm text-slate-500 font-semibold">{term}</span>
                          <span className="text-[10px] text-gray-400 ml-1">— not found in any app</span>
                        </div>
                      );
                    }

                    // Sub-group by app within this term
                    const appMap = new Map();
                    termRows.forEach(row => {
                      if (!appMap.has(row.appName)) appMap.set(row.appName, []);
                      appMap.get(row.appName).push(row);
                    });

                    // Collect all matched values for this term (for "Copy all" button)
                    const allValues = [...new Set(termRows.map(r => r.apiUser))];

                    return (
                      <div key={term} className="bg-white/50 border border-purple-200/30 rounded-xl overflow-hidden">
                        {/* Term group header */}
                        <div className="flex items-center gap-0 border-b border-gray-200/40">
                          <button
                            onClick={() => setExpandedTerms(prev => { const n = new Set(prev); n.has(term) ? n.delete(term) : n.add(term); return n; })}
                            className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-gray-100/30 transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                              <Hash size={12} className="text-purple-600 flex-shrink-0" />
                              <span className="font-mono text-sm text-gray-900 font-semibold truncate">{term}</span>
                              <span className="text-[10px] text-slate-500 flex-shrink-0 hidden sm:inline">
                                {appMap.size} app{appMap.size !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs text-purple-600 font-semibold">
                                {termRows.length} match{termRows.length !== 1 ? 'es' : ''}
                              </span>
                              <ChevronDown size={13} className={`text-gray-400 transition-transform ${isExp ? '' : '-rotate-90'}`} />
                            </div>
                          </button>
                          {/* Copy all values for this term */}
                          <CopyAllBtn values={allValues} />
                        </div>

                        {/* Expanded: Business Group (bgName) → Apps → Properties */}
                        {isExp && (() => {
                          // Group by bgName (e.g. "EI-FI-PROD"), then by appName within each BG
                          const bgMap = new Map();
                          termRows.forEach(row => {
                            const key = row.bgName || '—';
                            if (!bgMap.has(key)) bgMap.set(key, new Map());
                            const ba = bgMap.get(key);
                            if (!ba.has(row.appName)) ba.set(row.appName, []);
                            ba.get(row.appName).push(row);
                          });
                          return (
                            <div>
                              {[...bgMap.entries()].map(([bgName, bgAppMap]) => {
                                const bgMatchCount = [...bgAppMap.values()].reduce((n, r) => n + r.length, 0);
                                // Colour dot — green if BG name contains "PROD", yellow otherwise
                                const isProd = /prod/i.test(bgName);
                                const dotCls = isProd ? 'bg-green-500' : 'bg-yellow-500';
                                return (
                                  <div key={bgName} className="border-t border-gray-200/40">
                                    {/* BG sub-header */}
                                    <div className="flex items-center gap-2 px-4 py-2 bg-gray-100/40">
                                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotCls}`} />
                                      <span className="text-[10px] font-semibold text-gray-700 flex-1 font-mono">{bgName}</span>
                                      <span className="text-[9px] text-gray-400">
                                        {bgAppMap.size} app{bgAppMap.size !== 1 ? 's' : ''} · {bgMatchCount} match{bgMatchCount !== 1 ? 'es' : ''}
                                      </span>
                                    </div>
                                    {/* Secure key sub-groups → full-field mini table */}
                                    {(() => {
                                      const allBgRows = [...bgAppMap.values()].flat();
                                      const skMap = new Map();
                                      allBgRows.forEach(row => {
                                        const sk = row.secureKey || 'Non-Secure';
                                        if (!skMap.has(sk)) skMap.set(sk, []);
                                        skMap.get(sk).push(row);
                                      });
                                      // Non-Secure first, then secure groups alphabetically
                                      const sortedSk = [...skMap.entries()].sort(([a], [b]) => {
                                        if (a === 'Non-Secure') return -1;
                                        if (b === 'Non-Secure') return 1;
                                        return a.localeCompare(b);
                                      });
                                      return (
                                        <div>
                                          {sortedSk.map(([skName, skRows]) => (
                                            <div key={skName} className="border-t border-gray-200/30">
                                              {/* Secure key sub-header */}
                                              <div className="flex items-center gap-2 px-6 py-1.5 bg-gray-100/20">
                                                {skName === 'Non-Secure'
                                                  ? <span className="flex items-center gap-1 text-[9px] font-semibold text-slate-500 bg-gray-100/50 border border-gray-300/30 px-1.5 py-0.5 rounded"><Key size={8} /> Non-Secure</span>
                                                  : <span className="flex items-center gap-1 text-[9px] font-semibold text-orange-600/80 bg-orange-50/20 border border-orange-200/30 px-1.5 py-0.5 rounded"><Lock size={8} /> {skName}</span>
                                                }
                                                <span className="text-[9px] text-gray-400">{skRows.length} result{skRows.length !== 1 ? 's' : ''}</span>
                                              </div>
                                              {/* Grouped by Integration Name within each SK section */}
                                              {(() => {
                                                const skAppMap = new Map();
                                                skRows.forEach(row => {
                                                  if (!skAppMap.has(row.appName)) skAppMap.set(row.appName, []);
                                                  skAppMap.get(row.appName).push(row);
                                                });
                                                return (
                                                  <div className="divide-y divide-gray-200/20">
                                                    {[...skAppMap.entries()].map(([appName, appRows]) => (
                                                      <div key={appName} className="px-6 py-2.5 hover:bg-gray-100/10">
                                                        {/* Integration name header */}
                                                        <div className="flex items-center gap-2 mb-2">
                                                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border flex-shrink-0 ${
                                                            appRows[0].chVersion === 'CloudHub 2.0'
                                                              ? 'bg-blue-50/40 text-blue-600 border-blue-300/40'
                                                              : 'bg-purple-50/40 text-purple-600 border-purple-300/40'
                                                          }`}>
                                                            {appRows[0].chVersion === 'CloudHub 2.0' ? 'CH2' : 'CH1'}
                                                          </span>
                                                          <button
                                                            onClick={() => { const r = appRows[0]; if (r.bgOrgId && r.envId && r.appId) navigate(`/applications/${r.bgOrgId}/${r.envId}/${r.appId}`); }}
                                                            className="text-[10px] font-mono text-cyan-700 hover:text-cyan-900 font-medium hover:underline underline-offset-2 truncate">
                                                            {appName}
                                                          </button>
                                                          <span className="text-[9px] text-gray-400 flex-shrink-0">{appRows[0].chEnv}</span>
                                                          {appRows[0].status && (
                                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold flex-shrink-0 ${
                                                              appRows[0].status.toUpperCase() === 'RUNNING'
                                                                ? 'bg-green-50/40 text-green-600 border-green-300/40'
                                                                : appRows[0].status.toUpperCase() === 'FAILED'
                                                                ? 'bg-red-50/40 text-red-600 border-red-300/40'
                                                                : 'bg-gray-100/60 text-gray-500 border-gray-300/40'
                                                            }`}>
                                                              {appRows[0].status}
                                                            </span>
                                                          )}
                                                          <span className="text-[9px] text-gray-400 ml-auto flex-shrink-0">
                                                            {appRows.length} prop{appRows.length !== 1 ? 's' : ''}
                                                          </span>
                                                        </div>
                                                        {/* Property rows — compact table without Env/Type/App (already in header) */}
                                                        <div className="overflow-x-auto pl-2">
                                                          <table className="w-full border-collapse">
                                                            <thead>
                                                              <tr className="bg-gray-100/10 text-gray-400 text-[9px] uppercase tracking-wider border-b border-gray-200/30">
                                                                <th className="px-2 py-1 text-left font-bold whitespace-nowrap">NS Key</th>
                                                                <th className="px-2 py-1 text-left font-bold whitespace-nowrap">Prefix</th>
                                                                <th className="px-2 py-1 text-left font-bold whitespace-nowrap">Property Key</th>
                                                                <th className="px-2 py-1 text-left font-bold whitespace-nowrap">Value</th>
                                                                <th className="px-2 py-1 text-left font-bold whitespace-nowrap">Password</th>
                                                              </tr>
                                                            </thead>
                                                            <tbody>
                                                              {appRows.map((row, ri) => (
                                                                <tr key={ri} className="group border-b border-gray-200/20 hover:bg-gray-100/20 last:border-0">
                                                                  <td className="px-2 py-1.5 text-[10px] font-mono text-gray-500 whitespace-nowrap">{row.nsKey}</td>
                                                                  <td className="px-2 py-1.5 text-[10px] font-mono text-slate-500 whitespace-nowrap">{row.cpsPrefix}</td>
                                                                  <td className="px-2 py-1.5">
                                                                    <div className="flex items-center gap-1 group/cell">
                                                                      <span className="text-[10px] font-mono text-cyan-700/80 whitespace-nowrap">{row.propKey}</span>
                                                                      <CopyBtn text={row.propKey} />
                                                                    </div>
                                                                  </td>
                                                                  <td className="px-2 py-1.5">
                                                                    <div className="flex items-center gap-1 group/cell">
                                                                      <span className="text-[10px] font-mono text-emerald-700/90 break-all max-w-[200px]">
                                                                        <Highlight text={row.apiUser} terms={[term]} />
                                                                      </span>
                                                                      <CopyBtn text={row.apiUser} />
                                                                    </div>
                                                                  </td>
                                                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                                                    <div className="flex items-center gap-1 group/cell">
                                                                      <span className={`text-[10px] font-mono ${row.password && row.password !== '—' && !/^\*+$/.test(row.password) ? 'text-amber-700/90' : 'text-gray-400'}`}>{row.password}</span>
                                                                      {row.password && row.password !== '—' && !/^\*+$/.test(row.password) && <CopyBtn text={row.password} />}
                                                                    </div>
                                                                  </td>
                                                                </tr>
                                                              ))}
                                                            </tbody>
                                                          </table>
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Feature 2: grouped view by app
            if (groupByApp) {
              const appGroups = new Map();
              sortedResults.forEach(row => {
                const key = row.appName;
                if (!appGroups.has(key)) appGroups.set(key, { row, rows: [] });
                appGroups.get(key).rows.push(row);
              });
              return (
                <div className="space-y-2">
                  {[...appGroups.entries()].map(([appName, { row: first, rows }]) => {
                    const isExp = expandedApps.has(appName);
                    return (
                      <div key={appName} className="bg-white/50 border border-gray-200/60 rounded-xl overflow-hidden">
                        <button onClick={() => setExpandedApps(prev => { const n = new Set(prev); n.has(appName) ? n.delete(appName) : n.add(appName); return n; })}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100/30 transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <button onClick={e => { e.stopPropagation(); if (first.bgOrgId && first.envId && first.appId) navigate(`/applications/${first.bgOrgId}/${first.envId}/${first.appId}`); }}
                              className="text-sm font-semibold text-cyan-700 hover:text-cyan-900 font-mono truncate transition-colors" title="Open Application Detail">
                              {appName}
                            </button>
                            <span className="text-[10px] text-slate-500">{first.chEnv}</span>
                            {first.status && <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${first.status.toUpperCase()==='RUNNING' ? 'bg-green-50/40 text-green-600 border-green-300/40' : 'bg-gray-100/60 text-gray-500 border-gray-300/40'}`}>{first.status}</span>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[10px] text-slate-500">{rows.length} match{rows.length !== 1 ? 'es' : ''}</span>
                            <ChevronDown size={13} className={`text-gray-400 transition-transform ${isExp ? '' : '-rotate-90'}`} />
                          </div>
                        </button>
                        {isExp && (
                          <div className="border-t border-gray-200/40 divide-y divide-gray-200/30">
                            {rows.map((row, ri) => (
                              <div key={ri} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-100/20 text-xs">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  <span className="font-mono text-cyan-700/80"><Highlight text={row.propKey} terms={activeTerms} /></span>
                                  {row.secureKey ? <span className="text-[9px] text-orange-600 bg-orange-50/30 px-1 rounded ml-1">{row.secureKey}</span> : null}
                                </div>
                                <span className="font-mono text-emerald-700 break-all max-w-xs"><Highlight text={row.apiUser} terms={activeTerms} /></span>
                                <CopyBtn text={row.apiUser} />
                                <div className="flex items-center gap-1 group/cell">
                                  <span className={`font-mono ${row.password && row.password !== '—' && !/^\*+$/.test(row.password) ? 'text-amber-700/90' : 'text-gray-400'}`}>{row.password}</span>
                                  {row.password && row.password !== '—' && !/^\*+$/.test(row.password) && <CopyBtn text={row.password} />}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Flat table view (default)
            return (
              <div className="bg-white/50 border border-gray-200/60 rounded-2xl overflow-hidden">
                {/* Feature 15: sticky table + sortable headers */}
                <div className="overflow-x-auto overflow-y-auto max-h-[65vh]">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-100/95 border-b border-gray-300/40 backdrop-blur-sm">
                        <th className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase w-8">#</th>
                        {[['chEnv','Environment'], ['chVersion','Type'], ['appName','App Name'], ['status','Status'], ['nsKey','CPS Key'], ['cpsPrefix','Prefix'], ['secureKey','Secure Group'], ['propKey','Property Key'], ['apiUser','Value'], ['password','Password']].map(([col, label]) => (
                          <th key={col} className="px-3 py-3 text-left text-[10px] font-bold tracking-wider text-slate-500 uppercase whitespace-nowrap cursor-pointer hover:text-gray-600 select-none" onClick={() => toggleSort(col)}>
                            {label} <SortBtn col={col} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((row, i) => (
                        <tr key={i} className="group border-b border-gray-200/40 hover:bg-gray-100/30 transition-colors last:border-0">
                          <td className="px-3 py-3 text-xs text-gray-400 font-mono tabular-nums text-right select-none">{i + 1}</td>
                          <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">{row.chEnv}</td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={'text-[10px] px-2 py-0.5 rounded font-bold border ' + (row.chVersion === 'CloudHub 2.0' ? 'bg-blue-50/40 text-blue-700 border-blue-300/40' : 'bg-purple-50/40 text-purple-700 border-purple-300/40')}>{row.chVersion}</span>
                          </td>
                          {/* Feature 5: clickable app name */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1 group/cell">
                              <button onClick={() => { if (row.bgOrgId && row.envId && row.appId) navigate(`/applications/${row.bgOrgId}/${row.envId}/${row.appId}`); }}
                                className="text-xs font-mono text-cyan-700 hover:text-cyan-900 font-medium hover:underline underline-offset-2 text-left transition-colors" title="Open Application Detail">
                                {row.appName}
                              </button>
                              <CopyBtn text={row.appName} />
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {row.status ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${row.status.toUpperCase()==='RUNNING' ? 'bg-green-50/40 text-green-600 border-green-300/40' : row.status.toUpperCase()==='STOPPED' ? 'bg-gray-100/60 text-gray-500 border-gray-300/40' : row.status.toUpperCase()==='FAILED' ? 'bg-red-50/40 text-red-600 border-red-300/40' : 'bg-yellow-50/40 text-yellow-600 border-yellow-300/40'}`}>{row.status.toUpperCase()}</span>
                            ) : <span className="text-gray-400 text-[10px]">—</span>}
                          </td>
                          <td className="px-3 py-3"><div className="flex items-center gap-1 group/cell"><span className="text-xs font-mono text-gray-500">{row.nsKey}</span><CopyBtn text={row.nsKey} /></div></td>
                          <td className="px-3 py-3 text-xs font-mono text-gray-500">{row.cpsPrefix}</td>
                          <td className="px-3 py-3">
                            {row.secureKey
                              ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-orange-50/40 text-orange-700 border-orange-300/40 font-mono"><Lock size={8} /> {row.secureKey}</span>
                              : <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-gray-100/60 text-slate-500 border-gray-300/40"><Key size={8} /> non-secure</span>}
                          </td>
                          {/* Feature 1: highlight propKey */}
                          <td className="px-3 py-3"><div className="flex items-center gap-1 group/cell"><span className="text-xs font-mono text-cyan-700"><Highlight text={row.propKey} terms={activeTerms} /></span><CopyBtn text={row.propKey} /></div></td>
                          {/* Feature 1: highlight apiUser */}
                          <td className="px-3 py-3"><div className="flex items-center gap-1 group/cell"><span className="text-xs font-mono text-emerald-700 break-all"><Highlight text={row.apiUser} terms={activeTerms} /></span><CopyBtn text={row.apiUser} /></div></td>
                          <td className="px-3 py-3 text-xs">
                            <div className="flex items-center gap-1 group/cell">
                              <span className={`font-mono ${row.password && row.password !== '—' && !/^\*+$/.test(row.password) ? 'text-amber-700/90' : 'text-gray-400'}`}>{row.password}</span>
                              {row.password && row.password !== '—' && !/^\*+$/.test(row.password) && <CopyBtn text={row.password} />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
