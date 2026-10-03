import React, { useState, useEffect, useCallback } from 'react';
import { X, Download, RefreshCw, CheckCircle, AlertTriangle, FileSpreadsheet, Globe, ChevronRight, Building2, Layers, Key, Zap, Search, FileJson } from 'lucide-react';
import { exportCpsProperties } from '../utils/exportCps';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { applyBgFilter } from './BgFilterModal';
import api from '../services/api';

/* ── BG + Env multi-selector ────────────────────────────────── */
function BgEnvSelector({ selectedBgId, selectedEnvId, onSelectionsChange }) {
  const [businessGroups, setBusinessGroups] = useState([]);
  const [envsByBg, setEnvsByBg] = useState({});
  const [loadingEnvs, setLoadingEnvs] = useState({});
  const [expandedBgs, setExpandedBgs] = useState(new Set());
  const [selections, setSelections] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [envSearch, setEnvSearch] = useState('');

  useEffect(() => { loadBusinessGroups(); }, []);

  const loadBusinessGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setBusinessGroups(groups);
      const initialBgId = selectedBgId;
      if (initialBgId) {
        const sel = new Set();
        if (selectedEnvId) { sel.add(`${initialBgId}:${selectedEnvId}`); }
        else { sel.add(`${initialBgId}:*`); }
        setSelections(sel);
        setExpandedBgs(new Set([initialBgId]));
        loadEnvsForBg(initialBgId);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const loadEnvsForBg = useCallback(async (bgId) => {
    if (envsByBg[bgId]) return;
    setLoadingEnvs(prev => ({ ...prev, [bgId]: true }));
    try {
      const res = await api.get(`/environments/${bgId}`);
      const envs = res.data.data || [];
      setEnvsByBg(prev => ({ ...prev, [bgId]: envs }));
    } catch { setEnvsByBg(prev => ({ ...prev, [bgId]: [] })); }
    setLoadingEnvs(prev => ({ ...prev, [bgId]: false }));
  }, [envsByBg]);

  const toggleBgExpand = (bgId) => {
    setExpandedBgs(prev => { const n = new Set(prev); n.has(bgId) ? n.delete(bgId) : n.add(bgId); return n; });
    loadEnvsForBg(bgId);
  };

  const isBgSelected = (bgId) => selections.has(`${bgId}:*`) || [...selections].some(s => s.startsWith(`${bgId}:`));
  const isEnvSelected = (bgId, envId) => selections.has(`${bgId}:${envId}`) || selections.has(`${bgId}:*`);

  const toggleBg = (bgId) => {
    setSelections(prev => {
      const next = new Set(prev);
      if (isBgSelected(bgId)) { [...next].filter(s => s.startsWith(`${bgId}:`)).forEach(s => next.delete(s)); }
      else {
        const envs = envsByBg[bgId];
        if (envs?.length) { envs.forEach(e => next.add(`${bgId}:${e.id}`)); }
        else { next.add(`${bgId}:*`); }
      }
      return next;
    });
  };

  const toggleEnv = (bgId, envId) => {
    setSelections(prev => {
      const next = new Set(prev);
      const key = `${bgId}:${envId}`;
      const allKey = `${bgId}:*`;
      if (next.has(allKey)) {
        next.delete(allKey);
        (envsByBg[bgId] || []).forEach(e => next.add(`${bgId}:${e.id}`));
      }
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  useEffect(() => {
    const result = [];
    selections.forEach(sel => {
      const [bgId, envId] = sel.split(':');
      const bg = businessGroups.find(g => g.id === bgId);
      if (!bg) return;
      if (envId === '*') {
        const envs = envsByBg[bgId] || [];
        if (envs.length === 0) { result.push({ bgId, bgName: bg.name, envId: null, envName: 'All Environments' }); }
        else { envs.forEach(e => result.push({ bgId, bgName: bg.name, envId: e.id, envName: e.name })); }
      } else {
        const env = (envsByBg[bgId] || []).find(e => e.id === envId);
        result.push({ bgId, bgName: bg.name, envId, envName: env?.name || envId });
      }
    });
    onSelectionsChange(result);
  }, [selections, businessGroups, envsByBg]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compute derived values (before any early return) ────────────────
  const visible = applyBgFilter(businessGroups);
  const searchLo = envSearch.toLowerCase().trim();

  // Auto-load envs for all visible BGs when search is active — MUST be before early return
  useEffect(() => {
    if (!searchLo || loading) return;
    visible.forEach(bg => { if (!envsByBg[bg.id]) loadEnvsForBg(bg.id); });
  }, [searchLo, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center py-6"><RefreshCw size={16} className="animate-spin text-gray-500" /></div>;

  const root = visible.find(g => !g.parentId);
  const children = visible.filter(g => g.parentId);
  const ordered = root ? [root, ...children] : visible;

  const getFilteredEnvs = (bgId) => {
    const envs = envsByBg[bgId] || [];
    if (!searchLo) return envs;
    return envs.filter(e => e.name.toLowerCase().includes(searchLo) || e.type?.toLowerCase().includes(searchLo));
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
      {/* Env search input */}
      <div className="relative border-b border-gray-200 dark:border-gray-700">
        <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          value={envSearch}
          onChange={e => setEnvSearch(e.target.value)}
          placeholder="Search environments…"
          className="w-full bg-gray-50 dark:bg-gray-900/40 pl-10 pr-9 py-2.5 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:bg-white dark:focus:bg-gray-900 transition-colors"
        />
        {envSearch && (
          <button onClick={() => setEnvSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xs transition-colors">✕</button>
        )}
      </div>
      <div style={{ maxHeight: '12rem', overflowY: 'auto' }}>
      {ordered.map(bg => {
        const isExpanded = expandedBgs.has(bg.id) || !!searchLo;
        const isChecked = isBgSelected(bg.id);
        const envs = getFilteredEnvs(bg.id);
        const loadingE = loadingEnvs[bg.id];
        // Hide BG if search active and no matching envs (and not still loading)
        if (searchLo && envs.length === 0 && !loadingE) return null;
        return (
          <div key={bg.id} className="border-b border-gray-100 dark:border-gray-700/60 last:border-0">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div onClick={() => toggleBg(bg.id)}
                className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center flex-shrink-0 cursor-pointer transition-all ${isChecked ? 'bg-blue-600 border-blue-500 shadow-sm shadow-blue-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'}`}>
                {isChecked && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <Building2 size={13} className={isChecked ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'} />
              <span className={`text-sm flex-1 truncate ${isChecked ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>{bg.name}</span>
              {!bg.parentId && <span className="text-[9px] font-bold bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full">ROOT</span>}
              <button onClick={() => toggleBgExpand(bg.id)} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <ChevronRight size={13} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {isExpanded && (
              <div className="bg-gray-50/60 dark:bg-gray-900/20">
                {loadingE ? (
                  <div className="flex items-center gap-2 px-9 py-2.5 text-gray-400 dark:text-gray-500 text-xs"><RefreshCw size={12} className="animate-spin" /> Loading environments…</div>
                ) : envs.length === 0 ? (
                  <div className="px-9 py-2.5 text-gray-400 dark:text-gray-500 text-xs">No environments</div>
                ) : envs.map(env => {
                  const envChecked = isEnvSelected(bg.id, env.id);
                  const isProd = env.type === 'production';
                  return (
                    <div key={env.id} onClick={() => toggleEnv(bg.id, env.id)}
                      className="flex items-center gap-2.5 px-9 py-2 hover:bg-gray-100/60 dark:hover:bg-gray-700/30 cursor-pointer transition-colors">
                      <div className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 transition-all ${envChecked ? 'bg-blue-600 border-blue-500 shadow-sm shadow-blue-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'}`}>
                        {envChecked && <span className="text-white text-[9px] font-bold">✓</span>}
                      </div>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isProd ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className={`text-xs flex-1 truncate ${envChecked ? 'text-gray-700 dark:text-gray-300 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>{env.name}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isProd ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300'}`}>{env.type}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/* ── Main Modal ─────────────────────────────────────────────── */
export default function CpsExportModal({ apps: passedApps, bgOrgId, bgName, envName, selectedEnvId, filterSummary, onClose }) {
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();

  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [errorMsg, setErrorMsg] = useState('');
  const [cpsBaseUrl, setCpsBaseUrl] = useState('');
  const [cpsEnv, setCpsEnv] = useState('');
  const [bgEnvSelections, setBgEnvSelections] = useState([]);
  // Export format: 'excel' | 'json'
  const [exportFormat, setExportFormat] = useState('excel');

  // Whether to use the pre-passed apps (selected from Applications page) or BG/Env selector
  const hasPreselected = passedApps?.length > 0;
  const [usePreselected, setUsePreselected] = useState(hasPreselected);

  // Auto-detect state
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  // ── Auto-detect CPS URL from the first pre-selected app's ARM properties ──
  const autoDetectFromApp = useCallback(async (app) => {
    if (!app || cpsBaseUrl) return;
    setAutoDetecting(true);
    try {
      const envId = app.environment?.id;
      const appBgId = app._bgId || bgOrgId;
      if (!envId || !appBgId) return;
      let armProps = {};
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}`);
        const ds = r.data?.target?.deploymentSettings || {};
        const ps = (r.data?.application?.configuration || {})['mule.agent.application.properties.service'] || {};
        armProps = { ...(ps.properties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || ds.environmentVars || {}), ...(r.data?.properties || {}) };
      } else {
        const r = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: appBgId } });
        armProps = r.data?.properties || {};
      }
      const url = armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'];
      if (url) {
        const normUrl = url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
        setCpsBaseUrl(normUrl);
        const detectedEnv = armProps['cps.prefix'] || armProps['cps.environment'] || '';
        setCpsEnv(detectedEnv);
        setAutoDetected(true);
      }
    } catch { /* ignore — user can enter manually */ }
    setAutoDetecting(false);
  }, [bgOrgId, cpsBaseUrl]);

  // ── Load stored credentials + auto-detect URL on mount ──────────────────
  useEffect(() => {
    // 1. Try stored session credentials first (fast)
    api.get('/cps/credentials').then(res => {
      const byUrlBg = res.data?.byUrlBg || {};
      const byUrl = res.data?.byUrl || {};
      const bgMatch = Object.keys(byUrlBg).find(k => k.includes(`::${bgOrgId}`));
      if (bgMatch) {
        const url = bgMatch.split('::')[0];
        setCpsBaseUrl(url);
        setCpsEnv(url.includes('ut') || url.includes('stage') ? 'uat' : 'prod');
        setAutoDetected(true);
        return;
      }
      if (Object.keys(byUrl).length > 0) {
        const url = Object.keys(byUrl)[0];
        setCpsBaseUrl(url);
        setCpsEnv(url.includes('ut') || url.includes('stage') ? 'uat' : 'prod');
        setAutoDetected(true);
        return;
      }
      // 2. No stored creds — try to detect from first pre-selected app
      if (passedApps?.length > 0) {
        autoDetectFromApp(passedApps[0]);
      }
    }).catch(() => {
      if (passedApps?.length > 0) autoDetectFromApp(passedApps[0]);
    });
  }, [bgOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── JSON export helper: fetch CPS non-secure props for one app ──────────
  // Returns the raw CPS API response exactly as received — no transformation.
  const fetchAppCpsJson = useCallback(async (app) => {
    const appBgId = app._bgId || bgOrgId;
    const envId = app.environment?.id;
    try {
      // Step 1: get ARM detail to extract CPS config
      let armProps = {};
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${appBgId}/${envId}/${app.id}`);
        const ds = r.data?.target?.deploymentSettings || {};
        const ps = (r.data?.application?.configuration || {})['mule.agent.application.properties.service'] || {};
        armProps = { ...(r.data?.properties || {}), ...(ps.properties || {}), ...(ds.properties || {}), ...(ds.environmentVariables || ds.environmentVars || {}) };
      } else {
        const r = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: appBgId } });
        armProps = r.data?.properties || {};
      }
      const detectedUrl = (cpsBaseUrl.trim() || armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'] || '').trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      // Per-app ARM value wins; modal override is fallback; 'prod' is last resort
      const detectedEnv = armProps['cps.prefix'] || armProps['cps.environment'] || cpsEnv.trim() || 'prod';
      const detectedKey = armProps['cps.projectName'] || armProps['cloudhub.api.name'] || app.name;
      if (!detectedUrl || !detectedKey) return { _app: app.name, _error: 'No CPS config found in deployment properties' };

      // Step 2: post CPS credentials to backend session (mirrors CPS Manager logic)
      if (hasCpsCreds) {
        const isMasked = v => !v || /^\*+$/.test(String(v).trim());
        const cpsClientId = armProps['cps.clientId'] || armProps['cps.client_id'] || armProps['cps.client.id'] || armProps['cps.apiClientId'] || '';
        const credMap = {};
        // Try the specific clientId from ARM first
        if (cpsClientId && !isMasked(cpsClientId)) {
          const secret = getSecret(cpsClientId);
          if (secret) credMap[`${detectedUrl}::${appBgId}`] = { clientId: cpsClientId, clientSecret: secret };
        }
        // Fall back to all CSV credentials
        const allCreds = getAllCredentials();
        for (const { clientId, clientSecret } of allCreds) {
          credMap[`${detectedUrl}::${clientId}`] = { clientId, clientSecret };
        }
        if (Object.keys(credMap).length > 0) {
          try { await api.post('/cps/credentials', { credentials: credMap }); } catch { /* non-fatal */ }
        }
      }

      // Step 3: fetch non-secure CPS properties — return raw response as-is
      const nsRes = await api.get('/cps/fetch', {
        params: { baseUrl: detectedUrl, type: 'non-secure', environment: detectedEnv || undefined, keys: detectedKey, bgOrgId: appBgId },
      });
      return nsRes.data;
    } catch (err) {
      return { _app: app.name, _error: err.response?.data?.error || err.message || 'Failed to fetch CPS properties' };
    }
  }, [bgOrgId, cpsBaseUrl, cpsEnv, hasCpsCreds, getSecret, getAllCredentials]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    if (bgEnvSelections.length === 0 && !usePreselected) {
      setErrorMsg('Please select at least one Business Group / Environment.');
      setStatus('error');
      return;
    }
    setStatus('running');
    setErrorMsg('');

    let allApps = [];

    if (usePreselected && passedApps?.length > 0) {
      // Use the pre-selected apps directly
      allApps = passedApps.map(a => ({ ...a, _bgName: a.environment?.name || bgName }));
    } else {
      // Collect all apps from selected BG/env combinations
      for (const sel of bgEnvSelections) {
        try {
          const res = await api.get(`/applications/summary/${sel.bgId}`);
          const appsForBg = res.data.data || [];
          const filtered = sel.envId ? appsForBg.filter(a => a.environment?.id === sel.envId) : appsForBg;
          filtered.forEach(a => {
            if (!allApps.find(x => x.id === a.id && x.environment?.id === a.environment?.id)) {
              allApps.push({ ...a, _bgId: sel.bgId, _bgName: sel.bgName, _envName: sel.envName });
            }
          });
        } catch { /* skip */ }
      }
    }

    // ── JSON export path ──────────────────────────────────────────────────────
    if (exportFormat === 'json') {
      try {
        setProgress({ current: 0, total: allApps.length, label: 'Fetching CPS properties…' });
        const results = [];
        for (let i = 0; i < allApps.length; i++) {
          setProgress({ current: i, total: allApps.length, label: allApps[i].name });
          const appResult = await fetchAppCpsJson(allApps[i]);
          results.push(appResult);
        }
        setProgress({ current: allApps.length, total: allApps.length, label: '' });
        // Build output: single app → just the raw response; multiple → keyed by app name
        const output = results.length === 1
          ? results[0]
          : Object.fromEntries(allApps.map((a, i) => [a.name, results[i]]));
        // Trigger download
        const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = allApps.length === 1
          ? allApps[0].name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
          : `cps-export-${allApps.length}-apps`;
        a.href = url;
        a.download = `${safeName}-cps-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('done');
      } catch (e) {
        setErrorMsg(e.message || 'JSON export failed');
        setStatus('error');
      }
      return;
    }

    // ── Excel export path ─────────────────────────────────────────────────────
    if (usePreselected) {
      // ── Pre-selected apps: single file with Environment column ─────────────
      const uniqueEnvNames = [...new Set(allApps.map(a => a._envName || a.environment?.name).filter(Boolean))];
      const combinedEnvName = uniqueEnvNames.length === 1 ? uniqueEnvNames[0] : 'Multi-Env';
      try {
        await exportCpsProperties({
          apps: allApps,
          bgOrgId,
          bgName,
          envName: combinedEnvName,
          cpsBaseUrl: cpsBaseUrl.trim(),
          cpsEnvOverride: cpsEnv.trim(),
          onProgress: (current, total, label) => setProgress({ current, total, label }),
          getCredential: hasCpsCreds ? getSecret : null,
          getAllCredentials: hasCpsCreds ? getAllCredentials : null,
        });
        setStatus('done');
      } catch (e) {
        setErrorMsg(e.message || 'Export failed');
        setStatus('error');
      }
    } else {
      // ── BG/Env selector: one file per environment ──────────────────────────
      const appsByEnv = new Map();
      for (const a of allApps) {
        const envKey = a._envName || a.environment?.name || 'Unknown';
        if (!appsByEnv.has(envKey)) appsByEnv.set(envKey, { apps: [], bgName: a._bgName || bgName });
        appsByEnv.get(envKey).apps.push(a);
      }
      const envEntries = [...appsByEnv.entries()];
      const totalAll = allApps.length;
      let totalProcessed = 0;
      try {
        for (let ei = 0; ei < envEntries.length; ei++) {
          const [envLabel, { apps: envApps, bgName: envBgName }] = envEntries[ei];
          await exportCpsProperties({
            apps: envApps,
            bgOrgId,
            bgName: envBgName,
            envName: envLabel,
            cpsBaseUrl: cpsBaseUrl.trim(),
            cpsEnvOverride: cpsEnv.trim(),
            onProgress: (current, _total, label) => {
              setProgress({ current: totalProcessed + current, total: totalAll, label });
            },
            getCredential: hasCpsCreds ? getSecret : null,
            getAllCredentials: hasCpsCreds ? getAllCredentials : null,
          });
          totalProcessed += envApps.length;
          if (ei < envEntries.length - 1) await new Promise(r => setTimeout(r, 200));
        }
        setStatus('done');
      } catch (e) {
        setErrorMsg(e.message || 'Export failed');
        setStatus('error');
      }
    }
  };

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const canExport = usePreselected ? passedApps?.length > 0 : bgEnvSelections.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/80 rounded-3xl w-full max-w-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-700/60 flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-emerald-50/80 dark:from-emerald-500/[0.07] to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 shadow-sm">
              <FileSpreadsheet size={18} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-gray-900 dark:text-gray-100 font-bold text-base">Export CPS Properties</h2>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                {usePreselected
                  ? `Exporting ${passedApps.length} selected app${passedApps.length !== 1 ? 's' : ''}`
                  : 'Select Business Groups and Environments to export'}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={status === 'running'} className="relative text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-xl transition-colors disabled:opacity-30 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Pre-selected apps banner + toggle */}
          {(status === 'idle' || status === 'error') && hasPreselected && (
            <div className="flex items-center justify-between gap-3 bg-gradient-to-br from-blue-50 to-blue-50/40 dark:from-blue-500/10 dark:to-blue-500/5 border border-blue-200/60 dark:border-blue-400/20 rounded-2xl px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex-shrink-0">
                  <Zap size={13} className="text-blue-600 dark:text-blue-400" />
                </span>
                <span className="text-blue-700 dark:text-blue-300 text-xs font-semibold">
                  {passedApps.length} app{passedApps.length !== 1 ? 's' : ''} pre-selected from Applications page
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setUsePreselected(!usePreselected)}
                  className={'text-[11px] px-3 py-1.5 rounded-lg border font-semibold transition-all ' + (usePreselected ? 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-500/30' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100')}>
                  {usePreselected ? '✓ Use Selected Apps' : 'Use BG/Env Selector'}
                </button>
              </div>
            </div>
          )}

          {/* BG + Env selector (only when not using preselected) */}
          {(status === 'idle' || status === 'error') && !usePreselected && (
            <div className="space-y-2.5">
              <p className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={12} /> Business Groups & Environments
              </p>
              <BgEnvSelector selectedBgId={bgOrgId} selectedEnvId={selectedEnvId} onSelectionsChange={setBgEnvSelections} />
              {bgEnvSelections.length > 0 && (
                <p className="text-blue-600 dark:text-blue-400 text-[11px] font-medium">
                  {bgEnvSelections.length} environment{bgEnvSelections.length !== 1 ? 's' : ''} selected across {[...new Set(bgEnvSelections.map(s => s.bgId))].length} BG{[...new Set(bgEnvSelections.map(s => s.bgId))].length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}

          {/* CPS Server Config */}
          {(status === 'idle' || status === 'error') && (
            <div className="space-y-3 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/60 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <Globe size={12} /> CPS Server Configuration
                </p>
                <div className="flex items-center gap-2">
                  {autoDetecting && <span className="flex items-center gap-1 text-[10px] font-medium text-blue-600 dark:text-blue-400"><RefreshCw size={9} className="animate-spin" /> Detecting…</span>}
                  {autoDetected && !autoDetecting && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><Zap size={9} /> Auto-detected</span>}
                  {hasCpsCreds && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600/70 dark:text-emerald-400/70"><Key size={9} /> CSV creds loaded</span>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">CPS Base URL <span className="normal-case font-medium text-gray-400 dark:text-gray-500">(optional — auto-detected per app)</span></label>
                  <input value={cpsBaseUrl} onChange={e => { setCpsBaseUrl(e.target.value); setAutoDetected(false); }}
                    placeholder="Auto-detected from app properties…"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">CPS Env Override <span className="normal-case font-medium text-gray-400 dark:text-gray-500">(optional)</span></label>
                  <input value={cpsEnv} onChange={e => setCpsEnv(e.target.value)}
                    placeholder="prod / uat (auto per app)"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all" />
                </div>
              </div>
              {!cpsBaseUrl && !autoDetecting && (
                <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  ⚠ No CPS URL set — each app will use its own <code>cps.configServerBaseUrl</code> from deployment properties.
                </p>
              )}
            </div>
          )}

          {/* Format selector */}
          {status === 'idle' && (
            <div className="space-y-2.5">
              <p className="text-gray-400 dark:text-gray-500 text-[10px] uppercase tracking-wider font-bold">Export Format</p>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setExportFormat('excel')}
                  className={`flex items-center gap-2 flex-1 px-3.5 py-3 rounded-xl border text-xs font-semibold transition-all ${
                    exportFormat === 'excel'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300/70 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300 shadow-sm'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}>
                  <FileSpreadsheet size={14} /> Excel (.xlsx)
                  <span className="ml-auto text-[9px] opacity-60 font-medium">4 sheets</span>
                </button>
                <button
                  onClick={() => setExportFormat('json')}
                  className={`flex items-center gap-2 flex-1 px-3.5 py-3 rounded-xl border text-xs font-semibold transition-all ${
                    exportFormat === 'json'
                      ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300/70 dark:border-blue-400/30 text-blue-700 dark:text-blue-300 shadow-sm'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}>
                  <FileJson size={14} /> JSON (.json)
                  <span className="ml-auto text-[9px] opacity-60 font-medium">raw props</span>
                </button>
              </div>
              {exportFormat === 'excel' && (
                <div className="space-y-1 mt-1">
                  {['AllPropertiesCatalog', 'Host_APIUsersCatalog', 'ScheduleCatalog', 'StaticIPsCatalog'].map(s => (
                    <div key={s} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700/50 rounded-lg px-3 py-1.5">
                      <ChevronRight size={10} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
                      <span className="text-gray-600 dark:text-gray-300 text-xs font-mono">{s}</span>
                    </div>
                  ))}
                  <p className="text-gray-400 dark:text-gray-500 text-[10px]">⚠ Sensitive values masked as <code>****</code></p>
                </div>
              )}
              {exportFormat === 'json' && (
                <p className="text-gray-400 dark:text-gray-500 text-[10px] pl-1">
                  Exports raw CPS non-secure properties as <code className="text-gray-500 dark:text-gray-400">{`{ appName: { key: value } }`}</code> per app.
                </p>
              )}
            </div>
          )}

          {/* Progress */}
          {(status === 'running' || status === 'done') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-gray-500 dark:text-gray-400">
                  {status === 'done' ? 'Export complete!' : `Fetching ${progress.current}/${progress.total} apps in parallel…`}
                </span>
                <span className={'font-bold ' + (status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400')}>{progressPct}%</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700/60 rounded-full h-2 overflow-hidden">
                <div className={'h-2 rounded-full transition-all duration-300 ' + (status === 'done' ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-blue-400 to-blue-500')} style={{ width: `${progressPct}%` }} />
              </div>
              {progress.label && status === 'running' && (
                <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono truncate">⚡ {progress.label}</p>
              )}
              {status === 'done' && (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold"><CheckCircle size={16} /> File downloaded successfully!</div>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="flex items-start gap-3 bg-red-50 dark:bg-red-500/10 border border-red-200/70 dark:border-red-400/30 rounded-2xl px-4 py-3.5">
              <AlertTriangle size={16} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-700 dark:text-red-300 text-sm font-semibold">Export failed</p>
                <p className="text-red-500/90 dark:text-red-400/80 text-xs mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 gap-3 flex-shrink-0 bg-gray-50/50 dark:bg-gray-900/30">
          <p className="text-gray-400 dark:text-gray-500 text-xs font-medium">
            {usePreselected
              ? `${passedApps?.length || 0} app${(passedApps?.length || 0) !== 1 ? 's' : ''} selected`
              : bgEnvSelections.length > 0 ? `${bgEnvSelections.length} env${bgEnvSelections.length !== 1 ? 's' : ''} selected` : 'No selection'}
          </p>
          <div className="flex gap-2.5">
            <button onClick={onClose} disabled={status === 'running'}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors disabled:opacity-50">
              {status === 'done' ? 'Close' : 'Cancel'}
            </button>
            {status !== 'done' && (
              <button onClick={handleExport} disabled={status === 'running' || !canExport}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 shadow-md ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${
                  exportFormat === 'json'
                    ? 'bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40'
                    : 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 shadow-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/40'
                }`}>
                {status === 'running'
                  ? <><RefreshCw size={13} className="animate-spin" /> Exporting…</>
                  : status === 'error'
                    ? <><RefreshCw size={13} /> Retry</>
                    : exportFormat === 'json'
                      ? <><FileJson size={13} /> Export to JSON</>
                      : <><Download size={13} /> Export to Excel</>}
              </button>
            )}
            {status === 'done' && (
              <button onClick={handleExport} className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors">
                <Download size={13} /> Download Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
