import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import {
  Database, RefreshCw, Search, Plus, Trash2, Save,
  X, AlertTriangle, Download, Upload, ShieldCheck, Key,
  FileArchive, Eye, EyeOff, Copy, Check, ExternalLink, Code,
} from 'lucide-react';
import Select from '../components/Select';
import CpsCredentialImportButton from '../components/CpsCredentialImportButton';
import CpsCreateModal from '../components/CpsCreateModal';
import CpsDeleteProjectModal from '../components/CpsDeleteProjectModal';
import CpsBinaryUploadPanel from '../components/CpsBinaryUploadPanel';
import CpsAuthPanel from '../components/CpsAuthPanel';
import CpsImportModal from '../components/CpsImportModal';
import CpsSettingsModal from '../components/CpsSettingsModal';
import CpsCredTestButton from '../components/CpsCredTestButton';
import CpsRequestResponsePanel from '../components/CpsRequestResponsePanel';
import CpsRawJsonModal from '../components/CpsRawJsonModal';
import api from '../services/api';
import axios from 'axios';
import { extractCpsConfig, flattenCpsResponse } from '../utils/cpsHelpers';
import { isDemoMode } from '../utils/demoMode';
import { mockNonSecureResponse, mockSecureResponse } from '../utils/mockCpsData';
import { downloadCsv } from '../utils/appUtils';
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';

// ── Inline CopyBtn ────────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-500 hover:text-gray-900 transition-all flex-shrink-0"
    >
      {done ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
    </button>
  );
}

// ── SecretValue ───────────────────────────────────────────────────────────────
function SecretValue({ value }) {
  const [show, setShow] = useState(false);
  const isSecret = /^\*+$/.test(String(value));
  return (
    <span className="flex items-center gap-1">
      <span className="font-mono text-xs text-gray-700 break-all">
        {show || !isSecret ? String(value) : '••••••••'}
      </span>
      {isSecret && (
        <button onClick={() => setShow(v => !v)} className="text-gray-500 hover:text-gray-900 flex-shrink-0">
          {show ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      )}
    </span>
  );
}

const PROP_TYPE_TABS = [
  { id: 'non-secure', label: 'Non-Secure' },
  { id: 'secure', label: 'Secure' },
  { id: 'binaries', label: 'Binaries' },
  { id: 'auth', label: '🔐 Access Control' },
];

// ── Feature 1: Save Diff Modal ────────────────────────────────────────────────
function SaveDiffModal({ pendingChanges, originalProps, mergedProps, isProd, onConfirm, onCancel, saving }) {
  const added    = Object.entries(pendingChanges.added);
  const modified = Object.entries(pendingChanges.modified);
  const deleted  = [...pendingChanges.deleted];
  const total    = added.length + modified.length + deleted.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-300 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
              <Save size={14} className={isProd ? 'text-red-600' : 'text-cyan-600'} />
              Review Changes Before Saving
            </h3>
            <p className="text-gray-500 text-xs mt-0.5">{total} change{total !== 1 ? 's' : ''} pending · {isProd ? '⚠ PRODUCTION' : 'Non-production'}</p>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-900"><X size={15} /></button>
        </div>

        {/* Diff table */}
        <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
          {added.map(([key, val]) => (
            <div key={`add::${key}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 rounded-lg bg-emerald-50/20 border border-emerald-200/30 text-xs">
              <span className="font-mono text-gray-600 truncate">{key}</span>
              <span className="text-gray-500 italic">— (new)</span>
              <span className="font-mono text-emerald-700 break-all">{String(val)}</span>
            </div>
          ))}
          {modified.map(([key, newVal]) => (
            <div key={`mod::${key}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 rounded-lg bg-blue-50/20 border border-blue-200/30 text-xs">
              <span className="font-mono text-gray-600 truncate">{key}</span>
              <span className="font-mono text-red-600/80 break-all line-through">{String(originalProps[key] ?? '')}</span>
              <span className="font-mono text-blue-700 break-all">{String(newVal)}</span>
            </div>
          ))}
          {deleted.map(key => (
            <div key={`del::${key}`} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 rounded-lg bg-red-50/20 border border-red-200/30 text-xs">
              <span className="font-mono text-gray-600 truncate">{key}</span>
              <span className="font-mono text-red-600/80 break-all line-through">{String(originalProps[key] ?? '')}</span>
              <span className="text-gray-500 italic">— (deleted)</span>
            </div>
          ))}
        </div>

        {/* Column labels */}
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-5 py-2 border-t border-gray-200 text-[9px] text-gray-500 uppercase tracking-wider flex-shrink-0">
          <span>Key</span><span>Old Value</span><span>New Value</span>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 flex-shrink-0">
          <button onClick={onCancel} disabled={saving}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-300 rounded-lg disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={saving}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${
              isProd ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-cyan-700 hover:bg-cyan-600 text-white'
            }`}>
            {saving
              ? <><RefreshCw size={13} className="animate-spin" /> Saving…</>
              : <><Save size={13} /> Confirm Save ({total} change{total !== 1 ? 's' : ''})</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Feature 9: Property type detection ───────────────────────────────────────
function getValueTypeIcon(val) {
  const v = String(val ?? '').trim();
  if (!v) return null;
  if (/^\$\{.+\}$/.test(v)) return { emoji: '⚡', label: 'Placeholder reference', color: 'text-yellow-500' };
  if (/^https?:\/\//i.test(v)) return { emoji: '🌐', label: 'URL', color: 'text-blue-600' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return { emoji: '🔑', label: 'UUID', color: 'text-purple-600' };
  if (/^(true|false)$/i.test(v)) return { emoji: v.toLowerCase() === 'true' ? '✅' : '❌', label: 'Boolean', color: 'text-emerald-600' };
  if (/^\d+(\.\d+)?$/.test(v) && v.length < 20) return { emoji: '🔢', label: 'Number', color: 'text-cyan-600' };
  if (/^\s*[\[{]/.test(v)) return { emoji: '📋', label: 'JSON object/array', color: 'text-orange-600' };
  return null;
}

// ── Feature 14: Validation warnings ──────────────────────────────────────────
function getValidationWarning(key, val, allProps) {
  const v = String(val ?? '').trim();
  if (!v && /(\.url|\.host|\.username|\.user|\.endpoint|\.server|\.address)$/i.test(key)) {
    return { msg: 'Empty value for a required-looking property' };
  }
  if (/^\$\{.+\}$/.test(v)) {
    const inner = v.slice(2, -1);
    if (allProps && !(inner in allProps)) {
      return { msg: `Placeholder key "${inner}" not found in this property set` };
    }
  }
  return null;
}

export default function CpsManagerPage() {
  const { orgId: authOrgId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Stores the pending auto-select from navigation state (set by ApplicationsPage / ApplicationDetailPage)
  const pendingAutoSelectRef = useRef(null);
  // Survives the apps-effect reset: holds the compositeId to re-apply after filtered apps load
  const pendingSelectCompositeRef = useRef(null);
  // Version counters — incremented each time a new fetch starts so stale Promises are ignored
  const envsFetchIdRef = useRef(0);
  const appsFetchIdRef = useRef(0);
  const { getAllCredentials, hasCredentials: hasCpsCreds, getSecret } = useCpsCredentialStore();

  // ── BG / Env / App state ─────────────────────────────────────────────────
  const [allBgs, setAllBgs] = useState([]);
  const [selectedBgId, setSelectedBgId] = useState('');
  const [envs, setEnvs] = useState([]);
  const [selectedEnvId, setSelectedEnvId] = useState('');
  const [apps, setApps] = useState([]);
  const [selectedAppComposite, setSelectedAppComposite] = useState(''); // "appId|envId|bgId"
  const [bgLoading, setBgLoading] = useState(true);
  const [envLoading, setEnvLoading] = useState(false);
  const [appLoading, setAppLoading] = useState(false);

  // ── CPS connection details (auto-populated from ARM) ─────────────────────
  const [cpsBaseUrl, setCpsBaseUrl] = useState('');
  const [cpsEnv, setCpsEnv] = useState('');
  const [cpsKey, setCpsKey] = useState('');
  const [cpsClientId, setCpsClientId] = useState('');
  const [credsResolved, setCredsResolved] = useState(false);
  const [appDetailLoading, setAppDetailLoading] = useState(false);

  // ── Property data state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('non-secure');
  const [originalProps, setOriginalProps] = useState({});
  const [pendingChanges, setPendingChanges] = useState({ added: {}, modified: {}, deleted: new Set() });
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsError, setPropsError] = useState('');
  const [secureGroups, setSecureGroups] = useState([]);
  const [binaryKeys, setBinaryKeys] = useState([]);
  const [search, setSearch] = useState('');
  const [secureGroupSearch, setSecureGroupSearch] = useState('');

  // ── Save state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [toast, setToast] = useState(null);
  const [lastOperation, setLastOperation] = useState(null);

  // ── Env filter version (re-renders envOptions when filter changes) ────────
  const [envFilterVersion, setEnvFilterVersion] = useState(0); // eslint-disable-line no-unused-vars
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

  // ── Modals ───────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCpsSettings, setShowCpsSettings] = useState(false);
  const [showSecureRawJson, setShowSecureRawJson] = useState(false);
  // Feature 1: save diff modal
  const [showDiffModal, setShowDiffModal] = useState(false);
  // Feature 5: undo history
  const [undoHistory, setUndoHistory] = useState([]);
  // Feature 3: localStorage draft banner
  const [pendingDraft, setPendingDraft] = useState(null);
  // Feature 13: session change log
  const [changeLog, setChangeLog] = useState([]);
  const [showChangeLog, setShowChangeLog] = useState(false);
  // Feature 15: app CPS status map (compositeId → true/false)
  const [appCpsStatus, setAppCpsStatus] = useState({});
  // Feature 16: URL presets (persisted in localStorage, max 5)
  const [cpsUrlPresets, setCpsUrlPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cps_url_presets') || '[]'); } catch { return []; }
  });

  // ── Derived ──────────────────────────────────────────────────────────────
  const resolvedBgId = useMemo(() => {
    if (!selectedAppComposite) return selectedBgId;
    const [, , bgId] = selectedAppComposite.split('|');
    return bgId || selectedBgId;
  }, [selectedAppComposite, selectedBgId]);

  const selectedApp = useMemo(() => {
    if (!selectedAppComposite) return null;
    const [appId, envId, bgId] = selectedAppComposite.split('|');
    return apps.find(a => String(a.id) === appId && (a.environment?.id === envId || !envId) && (a._bgId === bgId || !bgId)) || null;
  }, [selectedAppComposite, apps]);

  const isProd = useMemo(() => {
    if (!selectedApp) return false;
    const type = selectedApp.environment?.type || '';
    return type === 'production' || cpsEnv === 'prod' || cpsBaseUrl.includes('-pd.') || cpsBaseUrl.includes('-pd.');
  }, [selectedApp, cpsEnv, cpsBaseUrl]);

  // Compute merged properties: original + pending changes
  const mergedProps = useMemo(() => {
    const m = { ...originalProps, ...pendingChanges.modified, ...pendingChanges.added };
    pendingChanges.deleted.forEach(k => delete m[k]);
    return m;
  }, [originalProps, pendingChanges]);

  const pendingCount = Object.keys(pendingChanges.added).length
    + Object.keys(pendingChanges.modified).length
    + pendingChanges.deleted.size;

  const hasPendingChanges = pendingCount > 0;

  // ── Load BGs ─────────────────────────────────────────────────────────────
  // Capture auto-select request from navigation state on mount
  useEffect(() => {
    const auto = location.state?.cpsAutoSelect;
    if (auto?.bgId) pendingAutoSelectRef.current = auto;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setBgLoading(true);
    api.get('/organizations/business-groups')
      .then(r => {
        const bgs = r.data?.data || [];
        setAllBgs(bgs);
        // Default to 'All Business Groups' (selectedBgId stays '')
      })
      .catch(() => {})
      .finally(() => setBgLoading(false));
  }, []);

  // When BG list loads and there's a pending auto-select, set the BG
  useEffect(() => {
    const auto = pendingAutoSelectRef.current;
    if (!auto || !allBgs.length || bgLoading) return;
    if (selectedBgId !== auto.bgId) {
      setSelectedBgId(auto.bgId);
      // Don't set envId here — the envs loading effect resets it.
      // pendingAutoSelectRef keeps the envId so the envs effect can pick it up.
    }
  }, [allBgs, bgLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // When apps load and there's a pending auto-select, call selectApp.
  // IMPORTANT: only fire once selectedEnvId has settled to the target env —
  // if we fire on the intermediate "all envs" load the apps effect will reset
  // selectedAppComposite when the filtered load arrives.
  useEffect(() => {
    const auto = pendingAutoSelectRef.current;
    if (!auto) return;
    if (appLoading) return;
    if (!apps.length) return;
    if (selectedEnvId !== auto.envId) return;
    if (selectedBgId !== auto.bgId) return;
    const targetAppId = String(auto.compositeId.split('|')[0]);
    const found = apps.find(a => String(a.id) === targetAppId);
    if (found) {
      const actualCompositeId = `${found.id}|${found.environment?.id || ''}|${found._bgId || ''}`;
      pendingAutoSelectRef.current = null;
      // Store compositeId so the apps effect can re-apply it after the filtered list loads
      pendingSelectCompositeRef.current = actualCompositeId;
      selectApp(actualCompositeId);
    }
  }, [apps, appLoading, selectedEnvId, selectedBgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load Envs when BG selection or BG list changes ────────────────────────
  useEffect(() => {
    // Wait until BG list has loaded before fan-out
    if (!allBgs.length) return;
    setEnvLoading(true);
    setSelectedEnvId('');
    setApps([]);
    setSelectedAppComposite('');

    const bgsToFetch = selectedBgId === ''
      ? applyBgFilter(allBgs)                          // All BGs: fan out to every visible BG
      : allBgs.filter(g => g.id === selectedBgId);    // Specific BG

    if (bgsToFetch.length === 0) { setEnvLoading(false); return; }

    const fetchId = ++envsFetchIdRef.current; // capture version for this fetch

    Promise.all(
      bgsToFetch.map(bg =>
        api.get(`/environments/${bg.id}`)
          .then(r => r.data?.data || [])
          .catch(() => [])
      )
    ).then(results => {
      // Discard stale fetches (e.g. the all-BGs fan-out that started before BG was set)
      if (fetchId !== envsFetchIdRef.current) return;
      // Merge + deduplicate by environment ID
      const seen = new Set();
      const merged = results.flat().filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      setEnvs(merged);
      // Use the pending auto-select envId if it exists in the loaded list;
      // otherwise fall back to the first environment.
      const auto = pendingAutoSelectRef.current;
      const targetEnv = auto?.envId && merged.some(e => e.id === auto.envId)
        ? auto.envId
        : merged[0]?.id || '';
      setSelectedEnvId(targetEnv);
    }).catch(() => {}).finally(() => {
      if (fetchId === envsFetchIdRef.current) setEnvLoading(false);
    });
  }, [selectedBgId, allBgs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load Apps when Env or BG changes ─────────────────────────────────────
  useEffect(() => {
    if (!allBgs.length) return;
    setAppLoading(true);
    setSelectedAppComposite('');

    const bgsToFetch = selectedBgId === ''
      ? applyBgFilter(allBgs)
      : allBgs.filter(g => g.id === selectedBgId);

    if (bgsToFetch.length === 0) { setAppLoading(false); return; }

    const fetchId = ++appsFetchIdRef.current; // capture version for this fetch

    Promise.all(
      bgsToFetch.map(bg =>
        api.get(`/applications/summary/${bg.id}`)
          .then(r => {
            const all = r.data?.data || [];
            const filtered = selectedEnvId
              ? all.filter(a => a.environment?.id === selectedEnvId)
              : all;
            return filtered.map(a => ({ ...a, _bgId: bg.id }));
          })
          .catch(() => [])
      )
    ).then(results => {
      // Discard stale fetches
      if (fetchId !== appsFetchIdRef.current) return;
      const flatApps = results.flat();
      setApps(flatApps);
      // Re-apply auto-select if a compositeId was queued (the apps-effect reset above clears
      // selectedAppComposite, so we must re-set it after the filtered list arrives)
      const pendingCid = pendingSelectCompositeRef.current;
      if (pendingCid) {
        const targetId = String(pendingCid.split('|')[0]);
        const found = flatApps.find(a => String(a.id) === targetId);
        if (found) {
          pendingSelectCompositeRef.current = null;
          const actualCid = `${found.id}|${found.environment?.id || ''}|${found._bgId || ''}`;
          // Defer one tick so setApps state is applied before selectApp reads it
          setTimeout(() => selectApp(actualCid), 0);
        }
      }
    }).catch(() => {}).finally(() => {
      if (fetchId === appsFetchIdRef.current) setAppLoading(false);
    });
  }, [selectedBgId, selectedEnvId, allBgs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select App → fetch ARM detail → extract CPS config ───────────────────
  const selectApp = useCallback(async (compositeId) => {
    setSelectedAppComposite(compositeId);
    setCpsBaseUrl(''); setCpsEnv(''); setCpsKey(''); setCpsClientId('');
    setCredsResolved(false);
    setOriginalProps({}); setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    setSecureGroups([]); setBinaryKeys([]);
    setPropsError('');
    if (!compositeId) return;

    const [appId, envId, bgId] = compositeId.split('|');
    const app = apps.find(a => String(a.id) === appId);
    if (!app) return;

    setAppDetailLoading(true);
    try {
      let detail;
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${bgId || selectedBgId}/${envId}/${appId}`);
        detail = r.data;
      } else {
        const r = await api.get(`/applications/cloudhub1/${envId}/${appId}`, { params: { orgId: bgId || selectedBgId } });
        detail = { name: app.name, properties: r.data?.properties || {} };
      }
      const extracted = extractCpsConfig(detail);
      setCpsBaseUrl(extracted.cpsBaseUrl || '');
      setCpsEnv(extracted.cpsEnv || '');
      setCpsKey(extracted.cpsKey || '');
      setCpsClientId(extracted.cpsClientId || '');

      // Auto-resolve credentials from imported CSV
      if (extracted.cpsBaseUrl && hasCpsCreds) {
        const normBase = extracted.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
        const isMasked = v => !v || /^\*+$/.test(v.trim());
        const bgOrgId = bgId || selectedBgId;

        if (extracted.cpsClientId && !isMasked(extracted.cpsClientId)) {
          const secret = getSecret(extracted.cpsClientId);
          if (secret) {
            try {
              await api.post('/cps/credentials', { credentials: { [`${normBase}::${bgOrgId}`]: { clientId: extracted.cpsClientId, clientSecret: secret } } });
              setCredsResolved(true);
            } catch {}
          }
        }
        if (!credsResolved) {
          const allCreds = getAllCredentials();
          if (allCreds.length > 0) {
            const credMap = {};
            for (const { clientId, clientSecret } of allCreds) {
              credMap[`${normBase}::${clientId}`] = { clientId, clientSecret };
            }
            try { await api.post('/cps/credentials', { credentials: credMap }); setCredsResolved(true); } catch {}
          }
        }
      }
    } catch {}
    // Feature 15: record CPS status for this app so the selector can show an indicator
    setAppCpsStatus(prev => ({ ...prev, [compositeId]: !!(extractCpsConfig ? true : false) }));
    setAppDetailLoading(false);
  }, [apps, selectedBgId, hasCpsCreds, getSecret, getAllCredentials]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load Properties ───────────────────────────────────────────────────────
  const loadProperties = useCallback(async () => {
    if (!cpsBaseUrl || !cpsKey || !cpsEnv) return;
    setPropsLoading(true);
    setPropsError('');
    setOriginalProps({});
    setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    setSecureGroups([]);
    setBinaryKeys([]);

    if (isDemoMode()) {
      const nonSecureKey = mockNonSecureResponse.responses[0].key;
      const flat = flattenCpsResponse(mockNonSecureResponse, nonSecureKey);
      setOriginalProps(flat);
      setUndoHistory([]);
      
      const binStr = flat['cps.secure.binaries'] || '';
      if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));
      
      const groups = Array.isArray(mockSecureResponse.responses) ? mockSecureResponse.responses : [];
      setSecureGroups(groups);
      
      setPropsLoading(false);
      return;
    }

    const bgOrgId = resolvedBgId;
    try {
      // Load non-secure (always)
      const nsRes = await api.get('/cps/fetch', {
        params: { baseUrl: cpsBaseUrl, type: 'non-secure', environment: cpsEnv, keys: cpsKey, bgOrgId }
      });
      const flat = flattenCpsResponse(nsRes.data, cpsKey);
      setOriginalProps(flat);
      setUndoHistory([]);

      // Feature 3: check for a saved draft
      try {
        const dKey = `cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`;
        const raw = localStorage.getItem(dKey);
        if (raw) {
          const draft = JSON.parse(raw);
          const n = Object.keys(draft.added || {}).length + Object.keys(draft.modified || {}).length + (draft.deleted || []).length;
          if (n > 0) setPendingDraft({ ...draft, draftKey: dKey, totalChanges: n });
        }
      } catch { /* ignore corrupt draft */ }

      // Extract binary keys from non-secure
      const binStr = flat['cps.secure.binaries'] || '';
      if (binStr) setBinaryKeys(binStr.split(',').map(k => k.trim()).filter(Boolean));

      // Try to load secure (optional — requires credentials)
      const secStr = flat['cps.secure.properties'] || '';
      if (secStr) {
        try {
          const secRes = await api.get('/cps/fetch', {
            params: { baseUrl: cpsBaseUrl, type: 'secure', environment: cpsEnv, keys: secStr, bgOrgId }
          });
          const groups = Array.isArray(secRes.data?.responses) ? secRes.data.responses : [];
          setSecureGroups(groups);
        } catch {}
      }
    } catch (err) {
      setPropsError(err.response?.data?.error || err.message || 'Failed to load CPS properties');
    }
    setPropsLoading(false);
  }, [cpsBaseUrl, cpsKey, cpsEnv, resolvedBgId]);

  // ── Feature 5: undo stack helpers ────────────────────────────────────────
  const undoLastChange = useCallback(() => {
    setUndoHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setPendingChanges({ added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) });
      return h.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); undoLastChange(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLastChange]);

  // Feature 3: auto-save draft to localStorage whenever pendingChanges changes
  useEffect(() => {
    if (!cpsBaseUrl || !cpsKey || !cpsEnv) return;
    const draftKey = `cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`;
    const hasChanges = Object.keys(pendingChanges.added).length > 0
      || Object.keys(pendingChanges.modified).length > 0
      || pendingChanges.deleted.size > 0;
    if (hasChanges) {
      try {
        localStorage.setItem(draftKey, JSON.stringify({
          added: pendingChanges.added, modified: pendingChanges.modified,
          deleted: [...pendingChanges.deleted], savedAt: new Date().toISOString(),
        }));
      } catch { /* ignore */ }
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [pendingChanges, cpsBaseUrl, cpsKey, cpsEnv]);

  // ── Property change helpers (push to undo history before each mutation) ──
  const updateProperty = (key, newValue) => {
    setPendingChanges(prev => {
      setUndoHistory(h => [...h.slice(-19), { added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) }]);
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in prev.added) { next.added = { ...prev.added, [key]: newValue }; }
      else { next.modified = { ...prev.modified, [key]: newValue }; }
      return next;
    });
  };

  const addProperty = (key, value) => {
    if (!key.trim()) return;
    setPendingChanges(prev => {
      setUndoHistory(h => [...h.slice(-19), { added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) }]);
      return { ...prev, added: { ...prev.added, [key.trim()]: value }, deleted: (() => { const s = new Set(prev.deleted); s.delete(key.trim()); return s; })() };
    });
  };

  const markDeleted = (key) => {
    setPendingChanges(prev => {
      setUndoHistory(h => [...h.slice(-19), { added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) }]);
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in next.added) { delete next.added[key]; }
      else { next.deleted.add(key); delete next.modified[key]; }
      return next;
    });
  };

  const discardChanges = () => {
    setUndoHistory([]);
    setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    if (cpsBaseUrl && cpsKey && cpsEnv) localStorage.removeItem(`cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`);
    setPendingDraft(null);
  };

  // ── Save (PUT) — Feature 1: show diff modal before actual save ───────────
  const requestSave = () => {
    if (!hasPendingChanges || !cpsBaseUrl || !cpsKey) return;
    setShowDiffModal(true);
  };

  const saveChanges = async () => {
    setShowDiffModal(false);
    if (!hasPendingChanges || !cpsBaseUrl || !cpsKey) return;
    setSaving(true);
    setSaveError('');

    const propType = activeTab === 'secure' ? 'secure' : 'non-secure';
    const pathSuffix = propType === 'secure' ? '/api/v2/properties/secure' : '/api/v2/properties/non-secure';
    const cleanBase = cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const fallbackReqDetails = {
      method: 'PUT',
      url: `${cleanBase}${pathSuffix}`,
      body: { properties: [{ environment: cpsEnv, key: cpsKey, properties: mergedProps }] },
    };

    try {
      const resp = await api.post('/cps/write', {
        baseUrl: cpsBaseUrl,
        type: propType,
        method: 'PUT',
        environment: cpsEnv,
        projectKey: cpsKey,
        properties: mergedProps,
        bgOrgId: resolvedBgId,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      setLastOperation({
        label: 'Save Properties',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
      setUndoHistory([]);
      try { localStorage.removeItem(`cps_draft_${cpsBaseUrl}_${cpsKey}_${cpsEnv}`); } catch {}
      setPendingDraft(null);
      // Feature 13: append to session change log
      setChangeLog(log => [...log, {
        ts: new Date().toISOString(), label: 'Save Non-Secure',
        key: cpsKey, env: cpsEnv, changes: pendingCount, success: true,
      }]);
      showToast('Properties saved successfully', 'success');
      await loadProperties();
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      setLastOperation({
        label: 'Save Properties',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setSaveError(err.response?.data?.error || err.message || 'Save failed');
    }
    setSaving(false);
  };

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Feature 16: URL preset helpers ───────────────────────────────────────
  const saveUrlPreset = () => {
    const u = cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    if (!u || cpsUrlPresets.includes(u)) return;
    const next = [...cpsUrlPresets, u].slice(-5);
    setCpsUrlPresets(next);
    try { localStorage.setItem('cps_url_presets', JSON.stringify(next)); } catch {}
  };
  const removeUrlPreset = (url) => {
    const next = cpsUrlPresets.filter(p => p !== url);
    setCpsUrlPresets(next);
    try { localStorage.setItem('cps_url_presets', JSON.stringify(next)); } catch {}
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const rows = [['Property Key', 'Value']];
    Object.entries(mergedProps).sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => rows.push([k, String(v ?? '')]));
    downloadCsv(rows, `cps-${cpsKey}-${cpsEnv}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ── Filtered secure groups ────────────────────────────────────────────────
  const filteredSecureGroups = useMemo(() => {
    if (!secureGroupSearch.trim()) return secureGroups;
    const q = secureGroupSearch.toLowerCase();
    return secureGroups.filter(g => {
      if ((g.key || '').toLowerCase().includes(q)) return true;
      if (g.properties && typeof g.properties === 'object') {
        return Object.entries(g.properties).some(([k, v]) => 
          k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
        );
      }
      return false;
    });
  }, [secureGroups, secureGroupSearch]);

  // ── Filtered visible properties ───────────────────────────────────────────
  const visibleProps = useMemo(() => {
    const entries = Object.entries(mergedProps).sort(([a], [b]) => a.localeCompare(b));
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q));
  }, [mergedProps, search]);

  // ── Dropdown options ──────────────────────────────────────────────────────
  const bgOptions = [
    { value: '', label: 'All Business Groups' },
    ...applyBgFilter(allBgs).map(g => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-100 text-blue-600',
    })),
  ];
  const visibleEnvs = applyEnvFilter(envs);
  const envFilterActive = visibleEnvs.length < envs.length;
  const envOptions = [
    { value: '', label: `All Environments${envFilterActive ? ` (${visibleEnvs.length} visible)` : ''}` },
    ...visibleEnvs.map(e => ({ value: e.id, label: e.name })),
  ];
  const appOptions = apps.map(a => {
    const cid = `${a.id}|${a.environment?.id || ''}|${a._bgId || ''}`;
    const hasCps = appCpsStatus[cid];
    return {
      value: cid, label: a.name,
      tag: a.deploymentType === 'CloudHub 2.0' ? 'CH2' : 'CH1',
      tagColor: a.deploymentType === 'CloudHub 2.0' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600',
      ...(hasCps !== undefined ? {
        tag2: hasCps ? '✓CPS' : 'noCPS',
        tag2Color: hasCps ? 'bg-emerald-500/15 text-emerald-500' : 'bg-gray-200/40 text-gray-500',
      } : {}),
    };
  });

  const canLoad = !!(cpsBaseUrl && cpsKey && cpsEnv);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Modals */}
      {showCreate && (
        <CpsCreateModal
          baseUrl={cpsBaseUrl} environment={cpsEnv} bgOrgId={resolvedBgId} isProd={isProd}
          onClose={() => setShowCreate(false)}
          onCreated={k => { showToast(`Project "${k}" created`); loadProperties(); }}
          onResult={setLastOperation}
        />
      )}
      {showDelete && (
        <CpsDeleteProjectModal
          baseUrl={cpsBaseUrl} type={activeTab === 'secure' ? 'secure' : 'non-secure'}
          environment={cpsEnv} projectKey={cpsKey} bgOrgId={resolvedBgId} isProd={isProd}
          onClose={() => setShowDelete(false)}
          onDeleted={k => { showToast(`Project "${k}" deleted`); setOriginalProps({}); setPendingChanges({ added: {}, modified: {}, deleted: new Set() }); }}
          onResult={setLastOperation}
        />
      )}
      {showImport && (
        <CpsImportModal
          baseUrl={cpsBaseUrl} type={activeTab} environment={cpsEnv} projectKey={cpsKey}
          bgOrgId={resolvedBgId} isProd={isProd} existingProps={originalProps}
          onClose={() => setShowImport(false)}
          onImported={({ count, mergedProps }) => { 
            showToast(`Imported ${count} properties`); 
            if (isDemoMode && mergedProps) {
              setOriginalProps(mergedProps);
              setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
            } else {
              loadProperties(); 
            }
          }}
        />
      )}
      {showCpsSettings && (
        <CpsSettingsModal
          prefilledUrl={cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}
          prefilledBgId={resolvedBgId}
          onClose={() => setShowCpsSettings(false)}
        />
      )}

      {/* Feature 1: Save Diff Modal */}
      {showDiffModal && (
        <SaveDiffModal
          pendingChanges={pendingChanges}
          originalProps={originalProps}
          mergedProps={mergedProps}
          isProd={isProd}
          onConfirm={saveChanges}
          onCancel={() => setShowDiffModal(false)}
          saving={saving}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          toast.type === 'success'
            ? 'bg-emerald-50/40 border-emerald-200/50 text-emerald-700'
            : 'bg-red-50/40 border-red-200/50 text-red-700'
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Database size={20} className="text-cyan-600" /> CPS Property Manager
          </h1>
          <p className="text-gray-500 text-sm mt-1">Create, update, delete and manage auth for CPS properties</p>
        </div>
        <div className="flex items-center gap-2">
          <CpsCredentialImportButton compact />
          <button onClick={() => setShowCpsSettings(true)}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 bg-blue-50/40 border border-blue-200/50 px-3 py-1.5 rounded-lg transition-colors">
            <Key size={11} /> CPS Credentials
          </button>
        </div>
      </div>

      {/* Production banner */}
      {isProd && cpsBaseUrl && (
        <div className="flex items-center gap-3 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
          <span className="text-red-700 text-sm font-semibold">
            ⚠️ PRODUCTION — changes take effect immediately and cannot be undone
          </span>
        </div>
      )}

      {/* BG / Env / App selectors */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Business Group</p>
            <Select value={selectedBgId} onChange={setSelectedBgId} options={bgOptions}
              placeholder="Select BG…" searchable disabled={bgLoading} />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Environment</p>
            <Select value={selectedEnvId} onChange={setSelectedEnvId} options={envOptions}
              placeholder="All Environments" disabled={envLoading || !allBgs.length} />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1 flex items-center gap-1">
              Application {appLoading && <RefreshCw size={9} className="animate-spin text-gray-500" />}
            </p>
            <Select value={selectedAppComposite} onChange={selectApp} options={appOptions}
              placeholder="Search application…" searchable disabled={appLoading || !allBgs.length} />
            {/* View Application link — appears immediately after selecting an app */}
            {selectedAppComposite && (() => {
              const [appId, envId, bgId] = selectedAppComposite.split('|');
              if (!appId || !envId || !bgId) return null;
              const appName = apps.find(a => String(a.id) === appId)?.name || '';
              return (
                <button
                  onClick={() => navigate(`/applications/${bgId}/${envId}/${appId}`)}
                  className="mt-1.5 flex items-center gap-1.5 text-[10px] text-cyan-600 hover:text-cyan-700 transition-colors group/applink">
                  <ExternalLink size={10} className="flex-shrink-0" />
                  <span className="group-hover/applink:underline underline-offset-2 truncate">
                    {appName ? `Open ${appName} in Application Details` : 'View Application Details'}
                  </span>
                </button>
              );
            })()}
          </div>
        </div>

        {/* CPS config fields — always visible for manual entry or auto-fill from selected app */}
        <div className="pt-3 border-t border-gray-200/60 space-y-3">
          {appDetailLoading ? (
            <div className="flex items-center gap-2 text-gray-500 text-xs">
              <RefreshCw size={11} className="animate-spin" /> Extracting CPS config from ARM properties…
            </div>
          ) : (
            <>
              {!selectedAppComposite && !cpsBaseUrl && (
                <div className="flex items-center gap-2 bg-blue-50/20 border border-blue-200/30 rounded-lg px-3 py-2 text-[10px] text-blue-600/80">
                  <Database size={10} className="flex-shrink-0" />
                  Select an app above to auto-fill, or enter CPS details manually to create properties for a new app before deployment.
                </div>
              )}
              {!selectedAppComposite && cpsBaseUrl && (
                <span className="inline-flex items-center gap-1 text-[9px] text-blue-600 bg-blue-50 border border-blue-300/40 px-2 py-0.5 rounded-full">
                  <Database size={8} /> Manual entry
                </span>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    CPS Base URL
                    {cpsBaseUrl && !cpsUrlPresets.includes(cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')) && (
                      <button onClick={saveUrlPreset} title="Save as preset"
                        className="text-[8px] text-gray-500 hover:text-cyan-600 border border-gray-300 hover:border-cyan-300 px-1.5 py-0.5 rounded transition-colors">
                        + save preset
                      </button>
                    )}
                  </label>
                  <input value={cpsBaseUrl} onChange={e => setCpsBaseUrl(e.target.value)}
                    placeholder="https://cps-server.internalapi.sfdcbt.net"
                    className="w-full h-[42px] bg-white/80 border border-gray-300 rounded-lg px-3 text-sm text-gray-700 font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 placeholder-gray-400 transition-all" />
                  {cpsUrlPresets.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {cpsUrlPresets.map(p => (
                        <span key={p} className="inline-flex items-center gap-1 text-[9px] font-mono bg-gray-100 border border-gray-300 rounded-md px-2 py-0.5 group/preset">
                          <button onClick={() => setCpsBaseUrl(p)} title={p}
                            className={`hover:text-cyan-700 transition-colors truncate max-w-40 ${cpsBaseUrl.startsWith(p) || p === cpsBaseUrl ? 'text-cyan-600' : 'text-gray-500'}`}>
                            {p.replace(/^https?:\/\//, '')}
                          </button>
                          <button onClick={() => removeUrlPreset(p)} className="opacity-0 group-hover/preset:opacity-100 text-gray-500 hover:text-red-600 flex-shrink-0 transition-all">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">CPS Env</label>
                  <input value={cpsEnv} onChange={e => setCpsEnv(e.target.value)} placeholder="prod / uat"
                    className="w-full h-[42px] bg-white/80 border border-gray-300 rounded-lg px-3 text-sm text-gray-700 font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 placeholder-gray-400 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Project Key</label>
                  <input value={cpsKey} onChange={e => setCpsKey(e.target.value)} placeholder="my-api-name"
                    className="w-full h-[42px] bg-white/80 border border-gray-300 rounded-lg px-3 text-sm text-gray-700 font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 placeholder-gray-400 transition-all" />
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {credsResolved && (
                  <span className="flex items-center gap-1 text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-300/40 px-2 py-0.5 rounded-full">
                    <Key size={8} /> CPS creds auto-resolved
                  </span>
                )}
                <CpsCredTestButton baseUrl={cpsBaseUrl} clientId={cpsClientId}
                  clientSecret={cpsClientId ? undefined : undefined}
                  environment={cpsEnv} projectKey={cpsKey} compact />
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={loadProperties} disabled={!canLoad || propsLoading}
                    className="flex items-center gap-1.5 text-xs text-cyan-600 hover:text-cyan-700 bg-cyan-50/40 border border-cyan-200/50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                    <RefreshCw size={11} className={propsLoading ? 'animate-spin' : ''} />
                    {Object.keys(originalProps).length > 0 ? 'Refresh' : 'Load Properties'}
                  </button>
                  {canLoad && (
                    <button onClick={() => setShowCreate(true)}
                      className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 bg-emerald-50/40 border border-emerald-200/50 px-3 py-1.5 rounded-lg transition-colors">
                      <Plus size={11} /> Create New
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Properties area */}
      {Object.keys(originalProps).length > 0 && (
        <div className="space-y-4">
          {/* Tabs + action toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="bg-white p-1 rounded-xl border border-gray-200 flex gap-0.5">
              {PROP_TYPE_TABS.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    activeTab === t.id ? 'bg-gray-200/80 text-gray-900 shadow-md' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/60'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {activeTab !== 'auth' && activeTab !== 'binaries' && (
                <>
                  <button onClick={() => setShowImport(true)}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 bg-blue-50/40 border border-blue-200/50 px-2.5 py-1.5 rounded-lg transition-colors">
                    <Upload size={11} /> Import
                  </button>
                  <button onClick={exportCsv}
                    className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 bg-emerald-50/40 border border-emerald-200/50 px-2.5 py-1.5 rounded-lg transition-colors">
                    <Download size={11} /> Export
                  </button>
                  <button onClick={() => setShowDelete(true)}
                    className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 bg-red-50/40 border border-red-200/50 px-2.5 py-1.5 rounded-lg transition-colors">
                    <Trash2 size={11} /> Delete Project
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Save error */}
          {saveError && (
            <div className="flex items-center gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-sm">
              <AlertTriangle size={14} className="flex-shrink-0" /> {saveError}
            </div>
          )}

          {/* Loading / Error state */}
          {propsLoading && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Loading CPS properties…</span>
            </div>
          )}
          {propsError && !propsLoading && (
            <div className="flex items-start gap-3 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-700 text-sm font-medium">Failed to load properties</p>
                <p className="text-red-500/80 text-xs mt-1">{propsError}</p>
              </div>
            </div>
          )}

          {/* Feature 3: Draft restore banner */}
          {pendingDraft && !hasPendingChanges && (
            <div className="flex items-center justify-between gap-4 bg-amber-50/30 border border-amber-200/50 rounded-xl px-4 py-3">
              <div>
                <p className="text-amber-700 text-xs font-semibold">📝 Unsaved draft found</p>
                <p className="text-amber-500/80 text-[10px] mt-0.5">
                  {pendingDraft.totalChanges} unsaved change{pendingDraft.totalChanges !== 1 ? 's' : ''} from {new Date(pendingDraft.savedAt).toLocaleTimeString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => {
                  setPendingChanges({ added: pendingDraft.added || {}, modified: pendingDraft.modified || {}, deleted: new Set(pendingDraft.deleted || []) });
                  setPendingDraft(null);
                }} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors">
                  Restore Draft
                </button>
                <button onClick={() => { try { localStorage.removeItem(pendingDraft.draftKey); } catch {} setPendingDraft(null); }}
                  className="text-amber-600 hover:text-amber-600 text-xs transition-colors">Discard</button>
              </div>
            </div>
          )}

          {/* Non-Secure Tab */}
          {activeTab === 'non-secure' && !propsLoading && !propsError && (
            <PropertyTable
              props={mergedProps}
              originalProps={originalProps}
              pendingChanges={pendingChanges}
              search={search}
              setSearch={setSearch}
              onUpdate={updateProperty}
              onDelete={markDeleted}
              onAdd={addProperty}
              onReplaceAll={setPendingChanges}
              hasPendingChanges={hasPendingChanges}
              pendingCount={pendingCount}
              onSave={requestSave}
              onDiscard={discardChanges}
              saving={saving}
              isProd={isProd}
              allProps={mergedProps}
              onUndo={undoLastChange}
              undoCount={undoHistory.length}
              envStr={cpsEnv}
              keyStr={cpsKey}
            />
          )}

          {/* Secure Tab */}
          {activeTab === 'secure' && !propsLoading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Secure Properties</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Encrypted values that are securely stored in the CPS.
                  </p>
                </div>
                <button 
                  onClick={() => setShowSecureRawJson(true)}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 bg-blue-50/40 border border-blue-200/50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Code size={12} /> Global Raw JSON
                </button>
              </div>
              {secureGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 bg-white border border-gray-200 rounded-xl">
                  <Key size={28} className="text-gray-500" />
                  <p className="text-gray-500 text-sm">No secure properties configured (<code className="text-gray-500">cps.secure.properties</code> not set in non-secure)</p>
                </div>
              ) : (
                <>
                  {/* Search across secure group keys */}
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    <input
                      value={secureGroupSearch}
                      onChange={e => setSecureGroupSearch(e.target.value)}
                      placeholder={`Search groups, keys, or values… (${secureGroups.length} group${secureGroups.length !== 1 ? 's' : ''})`}
                      className="w-full bg-white border border-gray-300 rounded-xl pl-9 pr-10 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-cyan-300/50"
                    />
                    {secureGroupSearch && (
                      <button onClick={() => setSecureGroupSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900 transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {secureGroupSearch.trim() && (
                    <p className="text-[10px] text-gray-500 -mt-2">
                      {filteredSecureGroups.length} of {secureGroups.length} group{secureGroups.length !== 1 ? 's' : ''} shown
                    </p>
                  )}
                  {filteredSecureGroups.map(group => (
                    <SecureGroupEditor
                      key={group.key}
                      group={group}
                      baseUrl={cpsBaseUrl}
                      environment={cpsEnv}
                      bgOrgId={resolvedBgId}
                      isProd={isProd}
                      onResult={setLastOperation}
                      globalSearch={secureGroupSearch}
                      onGroupDeleted={deletedKey => {
                        setSecureGroups(prev => prev.filter(g => g.key !== deletedKey));
                        showToast(`Secure group "${deletedKey}" deleted`);
                      }}
                    />
                  ))}
                  {filteredSecureGroups.length === 0 && secureGroupSearch.trim() && (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 bg-white border border-gray-200 rounded-xl">
                      <Search size={20} className="text-gray-500" />
                      <p className="text-gray-500 text-sm">No secure groups match "<span className="font-mono">{secureGroupSearch}</span>"</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Binaries Tab */}
          {activeTab === 'binaries' && !propsLoading && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <CpsBinaryUploadPanel
                baseUrl={cpsBaseUrl}
                environment={cpsEnv}
                bgOrgId={resolvedBgId}
                existingKeys={binaryKeys}
                isProd={isProd}
                onUploaded={key => { showToast(`Binary "${key}" uploaded`); loadProperties(); }}
                onResult={setLastOperation}
              />
            </div>
          )}

          {/* Access Control Tab */}
          {activeTab === 'auth' && !propsLoading && (
            <AuthTabWithSearch
              cpsBaseUrl={cpsBaseUrl}
              cpsEnv={cpsEnv}
              cpsKey={cpsKey}
              secureGroups={secureGroups}
              resolvedBgId={resolvedBgId}
              setLastOperation={setLastOperation}
            />
          )}
        </div>
      )}

      {/* Empty state: CPS config entered but no properties loaded yet */}
      {!propsLoading && Object.keys(originalProps).length === 0 && !propsError && canLoad && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white border border-gray-200 rounded-xl">
          <Database size={36} className="text-gray-500" />
          <p className="text-gray-500 text-sm">
            CPS config detected — click <strong className="text-gray-900">Load Properties</strong> to fetch
          </p>
          <p className="text-gray-500 text-xs font-mono">
            {cpsKey} · {cpsEnv} · {cpsBaseUrl.split('/')[2]}
          </p>
          <button onClick={loadProperties} disabled={!canLoad}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
            <RefreshCw size={13} /> Load Properties
          </button>
        </div>
      )}

      {/* Request / Response debug panel */}
      {lastOperation && (
        <CpsRequestResponsePanel
          operation={lastOperation}
          onDismiss={() => setLastOperation(null)}
        />
      )}

      {/* Feature 13: Session Change Log */}
      {changeLog.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button onClick={() => setShowChangeLog(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100/30 transition-colors">
            <span className="text-xs font-medium text-gray-500 flex items-center gap-2">
              📋 Session Change Log
              <span className="text-[9px] bg-gray-100 border border-gray-300 px-1.5 py-0.5 rounded-full">{changeLog.length}</span>
            </span>
            <span className="text-gray-500 text-xs">{showChangeLog ? '▲ hide' : '▼ show'}</span>
          </button>
          {showChangeLog && (
            <div className="border-t border-gray-200 divide-y divide-gray-200/60 max-h-48 overflow-y-auto">
              {[...changeLog].reverse().map((entry, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-[10px]">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${entry.success ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-gray-500 font-mono flex-shrink-0">{new Date(entry.ts).toLocaleTimeString()}</span>
                  <span className="text-gray-500 font-medium flex-shrink-0">{entry.label}</span>
                  <span className="text-gray-500 font-mono truncate">{entry.key} · {entry.env}</span>
                  {entry.changes != null && <span className="text-cyan-600 ml-auto flex-shrink-0">{entry.changes} change{entry.changes !== 1 ? 's' : ''}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No CPS config state */}
      {selectedAppComposite && !appDetailLoading && !cpsBaseUrl && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 bg-white border border-gray-200 rounded-xl">
          <AlertTriangle size={28} className="text-yellow-600" />
          <p className="text-gray-500 text-sm">No CPS configuration found for this application</p>
          <p className="text-gray-500 text-xs">
            The app must have <code className="text-gray-500">cps.configServerBaseUrl</code> in its deployment properties
          </p>
          <p className="text-gray-500 text-xs">You can still enter the CPS URL, env, and project key manually above</p>
        </div>
      )}

      {/* Secure Global Raw JSON Editor */}
      {showSecureRawJson && (
        <CpsRawJsonModal
          isOpen={showSecureRawJson}
          onClose={() => setShowSecureRawJson(false)}
          initialJson={secureGroups}
          onSave={(parsedGroups) => {
            if (Array.isArray(parsedGroups)) {
               setSecureGroups(parsedGroups);
            } else {
               alert("Secure groups must be an array of objects.");
            }
          }}
          title="Global Secure Properties JSON"
          description="Edit all secure groups globally. Find and replace functionality is available."
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PropertyTable — inline-editable property table with pending change tracking
// ─────────────────────────────────────────────────────────────────────────────
export function PropertyTable({
  props, originalProps, pendingChanges, search, setSearch,
  onUpdate, onDelete, onAdd, onReplaceAll, hasPendingChanges, pendingCount,
  onSave, onDiscard, saving, isProd,
  allProps, // for placeholder resolution + validation (features 9/14/17)
  onUndo, undoCount = 0, // Feature 5: undo stack
  envStr, keyStr, // Passed from parent for Raw JSON full payload structure
  hideSearchInput,
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [bulkText, setBulkText] = useState('');
  // Feature 6: copy as formats
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [copyDone, setCopyDone] = useState('');
  // Feature 7: find & replace
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');

  // Parse bulk text → array of { key, value }
  const parseBulk = (text) => {
    if (!text.trim()) return [];
    // Try JSON first
    try {
      const obj = JSON.parse(text.trim());
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return Object.entries(obj).map(([k, v]) => ({ key: String(k), value: String(v ?? '') }));
      }
    } catch { /* not JSON, fall through */ }
    // Parse key=value or key: value lines
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('//'))
      .map(line => {
        const eqIdx = line.indexOf('=');
        const colIdx = line.indexOf(':');
        let sep = -1;
        if (eqIdx >= 0 && colIdx >= 0) sep = Math.min(eqIdx, colIdx);
        else if (eqIdx >= 0) sep = eqIdx;
        else if (colIdx >= 0) sep = colIdx;
        if (sep <= 0) return null;
        return { key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim() };
      })
      .filter(Boolean)
      .filter(({ key }) => key.length > 0);
  };

  const bulkParsed = parseBulk(bulkText);

  const applyBulk = () => {
    bulkParsed.forEach(({ key, value }) => onAdd(key, value));
    setBulkText('');
    setShowBulkAdd(false);
  };

  const allEntries = Object.entries(props).sort(([a], [b]) => a.localeCompare(b));
  const filtered = search.trim()
    ? allEntries.filter(([k, v]) => k.toLowerCase().includes(search.toLowerCase()) || String(v).toLowerCase().includes(search.toLowerCase()))
    : allEntries;

  const rowStatus = (key) => {
    if (pendingChanges.deleted.has(key)) return 'deleted';
    if (key in pendingChanges.added) return 'added';
    if (key in pendingChanges.modified) return 'modified';
    return 'unchanged';
  };

  const startEdit = (key, currentValue) => {
    setEditingKey(key);
    setEditValue(String(currentValue));
  };

  const commitEdit = (key) => {
    if (editValue !== String(props[key])) onUpdate(key, editValue);
    setEditingKey(null);
  };

  // ── Feature 6: copy all properties as various formats ─────────────────────
  const copyAs = (format) => {
    const entries = Object.entries(props).sort(([a], [b]) => a.localeCompare(b));
    let text = '';
    if (format === 'json') {
      text = JSON.stringify(Object.fromEntries(entries), null, 2);
    } else if (format === 'properties') {
      text = entries.map(([k, v]) => `${k}=${v}`).join('\n');
    } else if (format === 'yaml') {
      text = entries.map(([k, v]) => {
        const safe = String(v).includes(':') || String(v).includes('#') || String(v).startsWith(' ')
          ? `"${String(v).replace(/"/g, '\\"')}"` : String(v);
        return `${k}: ${safe}`;
      }).join('\n');
    } else if (format === 'env') {
      text = entries.map(([k, v]) => `export ${k.toUpperCase().replace(/\./g, '_')}="${String(v).replace(/"/g, '\\"')}"`).join('\n');
    }
    navigator.clipboard.writeText(text);
    setCopyDone(format);
    setShowCopyMenu(false);
    setTimeout(() => setCopyDone(''), 2000);
  };

  // ── Feature 7: find & replace ─────────────────────────────────────────────
  const findMatches = findText.trim()
    ? Object.keys(props).filter(k => {
        const v = String(props[k] ?? '');
        return v.includes(findText);
      })
    : [];

  const applyFindReplace = () => {
    if (!findText.trim()) return;
    findMatches.forEach(key => {
      const newVal = String(props[key] ?? '').split(findText).join(replaceText);
      onUpdate(key, newVal);
    });
  };

  return (
    <div className="space-y-3">
      {/* Feature 7: Find & Replace panel */}
      {showFindReplace && (
        <div className="bg-white border border-indigo-200/40 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
              <Search size={11} /> Find & Replace in Values
            </p>
            <button onClick={() => { setShowFindReplace(false); setFindText(''); setReplaceText(''); }}
              className="text-gray-500 hover:text-gray-900 transition-colors"><X size={13} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] text-gray-500 uppercase tracking-wider mb-1">Find (in values)</label>
              <input value={findText} onChange={e => setFindText(e.target.value)} placeholder="search string…"
                className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-indigo-300/50" />
            </div>
            <div>
              <label className="block text-[9px] text-gray-500 uppercase tracking-wider mb-1">Replace with</label>
              <input value={replaceText} onChange={e => setReplaceText(e.target.value)} placeholder="replacement…"
                className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-indigo-300/50" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-medium ${findMatches.length > 0 ? 'text-indigo-700' : 'text-gray-500'}`}>
              {findText.trim()
                ? findMatches.length > 0
                  ? `${findMatches.length} value${findMatches.length !== 1 ? 's' : ''} match`
                  : 'No matches'
                : 'Enter search text above'}
            </span>
            <button onClick={applyFindReplace} disabled={findMatches.length === 0 || !findText.trim()}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg disabled:opacity-40 transition-colors">
              Replace All ({findMatches.length})
            </button>
          </div>
        </div>
      )}

      {/* Search + toolbar row */}
      <div className="flex items-center gap-2 flex-wrap">
        {!hideSearchInput && (
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search properties…"
              className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-9 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500" />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {/* Feature 7: Find & Replace toggle */}
        <button onClick={() => setShowFindReplace(s => !s)}
          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${
            showFindReplace
              ? 'bg-indigo-100 border-indigo-300/60 text-indigo-700'
              : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-indigo-700 hover:border-indigo-300/50'
          }`}>
          <Search size={11} /> Find & Replace
        </button>
        {/* Feature 6: Copy as formats */}
        <div className="relative">
          <button onClick={() => setShowCopyMenu(s => !s)}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${
              copyDone ? 'bg-emerald-100 border-emerald-300/60 text-emerald-700'
              : showCopyMenu ? 'bg-gray-200/40 border-gray-300 text-gray-700'
              : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'
            }`}>
            {copyDone ? <><Check size={11} className="text-emerald-600" /> Copied!</>
              : <><Copy size={11} /> Copy as…</>}
          </button>
          {showCopyMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-300 rounded-xl shadow-2xl z-30 min-w-40 overflow-hidden">
              {[
                { id: 'json', label: 'JSON', sub: '{ "key": "val" }' },
                { id: 'properties', label: '.properties', sub: 'key=value' },
                { id: 'yaml', label: 'YAML', sub: 'key: value' },
                { id: 'env', label: 'Env Vars', sub: 'export KEY=value' },
              ].map(fmt => (
                <button key={fmt.id} onClick={() => copyAs(fmt.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100/60 transition-colors group">
                  <p className="text-xs text-gray-700 font-medium">{fmt.label}</p>
                  <p className="text-[9px] text-gray-500 font-mono">{fmt.sub}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Raw JSON Edit toggle */}
        <button
          onClick={() => setShowRawJson(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border bg-gray-100 border-gray-300 text-gray-500 hover:text-cyan-700 hover:border-cyan-300/50 transition-colors"
        >
          <Code size={11} /> Raw JSON
        </button>
        {/* Bulk Add toggle */}
        <button
          onClick={() => setShowBulkAdd(s => !s)}
          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${
            showBulkAdd
              ? 'bg-purple-100 border-purple-300/60 text-purple-700'
              : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-purple-700 hover:border-purple-300/50'
          }`}
        >
          <Plus size={11} /> Bulk Add
        </button>
        {hasPendingChanges && (
          <>
            {undoCount > 0 && onUndo && (
              <button onClick={onUndo} disabled={saving} title={`Undo (${undoCount} steps) — Ctrl+Z`}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-300 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors">
                ↩ Undo ({undoCount})
              </button>
            )}
            <button onClick={onDiscard} disabled={saving}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-300 px-3 py-2 rounded-lg disabled:opacity-50 transition-colors">
              <X size={11} /> Discard
            </button>
            <button onClick={onSave} disabled={saving}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50 transition-colors ${
                isProd ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-cyan-700 hover:bg-cyan-600 text-white'
              }`}>
              {saving
                ? <><RefreshCw size={11} className="animate-spin" /> Saving…</>
                : <><Save size={11} /> Save ({pendingCount} change{pendingCount !== 1 ? 's' : ''})</>}
            </button>
          </>
        )}
      </div>

      {/* Bulk Add panel */}
      {showBulkAdd && (
        <div className="bg-white border border-purple-200/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-purple-700">Bulk Add Properties</p>
            <button onClick={() => { setShowBulkAdd(false); setBulkText(''); }}
              className="text-gray-500 hover:text-gray-900 transition-colors">
              <X size={13} />
            </button>
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Paste <code className="text-gray-500 bg-gray-100 px-1 rounded">key=value</code> lines (one per line),
            or a <code className="text-gray-500 bg-gray-100 px-1 rounded">{'{"key":"value"}'}</code> JSON object.
            Lines starting with <code className="text-gray-500 bg-gray-100 px-1 rounded">#</code> are ignored.
          </p>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={`# Paste key=value pairs or JSON\ndb.host=localhost\ndb.port=5432\ndb.name=myapp\n\n# Or paste JSON:\n# { "db.host": "localhost", "db.port": "5432" }`}
            rows={8}
            className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 font-mono placeholder-gray-400 focus:outline-none focus:border-purple-300/50 resize-y min-h-[120px]"
          />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-medium ${bulkParsed.length > 0 ? 'text-purple-700' : 'text-gray-500'}`}>
              {bulkText.trim()
                ? bulkParsed.length > 0
                  ? `✓ ${bulkParsed.length} propert${bulkParsed.length === 1 ? 'y' : 'ies'} parsed`
                  : '⚠ Could not parse — check format'
                : 'Paste content above to preview'}
            </span>
            <div className="flex items-center gap-2">
              {/* Preview parsed entries */}
              {bulkParsed.length > 0 && bulkParsed.length <= 5 && (
                <span className="text-[9px] text-gray-500 font-mono truncate max-w-48">
                  {bulkParsed.slice(0, 3).map(e => e.key).join(', ')}{bulkParsed.length > 3 ? ', …' : ''}
                </span>
              )}
              <button
                onClick={applyBulk}
                disabled={bulkParsed.length === 0}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-lg disabled:opacity-40 transition-colors"
              >
                <Plus size={11} /> Add {bulkParsed.length > 0 ? `${bulkParsed.length} ` : ''}Properties
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Property table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100/50 text-gray-500 text-[10px] uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 w-[45%]">Property Key</th>
              <th className="text-left px-4 py-2.5">Value</th>
              <th className="px-3 py-2.5 w-16 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(([key, value]) => {
              const status = rowStatus(key);
              const isDeleted = status === 'deleted';
              const isAdded = status === 'added';
              const isModified = status === 'modified';
              const isEditing = editingKey === key;
              return (
                <tr key={key}
                  className={`group border-t border-gray-200/40 transition-colors ${
                    isDeleted ? 'opacity-40 bg-red-50/10' :
                    isAdded ? 'bg-emerald-50/10 border-l-2 border-l-emerald-600' :
                    isModified ? 'bg-blue-50/10 border-l-2 border-l-blue-600' :
                    'hover:bg-gray-100/20'
                  }`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {isAdded && <span className="text-[8px] text-emerald-600 bg-emerald-100 px-1 py-0.5 rounded font-bold">NEW</span>}
                      {isModified && <span className="text-[8px] text-blue-600 bg-blue-100 px-1 py-0.5 rounded font-bold">MOD</span>}
                      {isDeleted && <span className="text-[8px] text-red-600 bg-red-100 px-1 py-0.5 rounded font-bold">DEL</span>}
                      <span className={`font-mono text-xs ${isDeleted ? 'line-through text-gray-500' : 'text-gray-600'}`}>{key}</span>
                      <CopyBtn text={key} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(key)}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(key); if (e.key === 'Escape') setEditingKey(null); }}
                        className="w-full bg-gray-100 border border-blue-300/50 rounded-lg px-2 py-1 text-xs text-gray-900 font-mono focus:outline-none"
                      />
                    ) : (
                      <div className="space-y-0.5">
                        {/* Feature 9+14: type icon + validation warning + value + copy */}
                        <div className="flex items-center gap-1.5 group/val cursor-text" onClick={() => !isDeleted && startEdit(key, value)}>
                          {!isDeleted && (() => {
                            const typeInfo = getValueTypeIcon(value);
                            return typeInfo ? (
                              <span title={typeInfo.label} className={`text-[10px] flex-shrink-0 leading-none ${typeInfo.color}`}>{typeInfo.emoji}</span>
                            ) : null;
                          })()}
                          {!isDeleted && (() => {
                            const warn = getValidationWarning(key, value, allProps || props);
                            return warn ? (
                              <span title={warn.msg} className="text-yellow-500 flex-shrink-0 cursor-help text-[10px] leading-none" aria-label={warn.msg}>⚠</span>
                            ) : null;
                          })()}
                          <span className={`font-mono text-xs break-all leading-relaxed ${isDeleted ? 'line-through text-gray-500' : 'text-gray-700'}`}>
                            {String(value) || <span className="text-gray-500 italic">empty</span>}
                          </span>
                          <CopyBtn text={String(value)} />
                        </div>
                        {/* Feature 17: placeholder resolution preview */}
                        {!isEditing && !isDeleted && /^\$\{.+\}$/.test(String(value)) && (() => {
                          const inner = String(value).slice(2, -1);
                          const resolved = (allProps || props)?.[inner];
                          return resolved ? (
                            <p className="text-[9px] text-gray-500 font-mono pl-0.5">
                              <span className="text-gray-500">→ </span>
                              {String(resolved).substring(0, 80)}{String(resolved).length > 80 ? '…' : ''}
                            </p>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {!isDeleted ? (
                      <button onClick={() => onDelete(key)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-gray-500 hover:text-red-600 hover:bg-red-50/40 transition-all">
                        <Trash2 size={12} />
                      </button>
                    ) : (
                      <button onClick={() => onUpdate(key, originalProps[key] ?? props[key])}
                        className="text-[9px] text-gray-500 hover:text-gray-900 px-1.5 py-0.5 border border-gray-300 rounded transition-colors">
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Add new property row */}
            <tr className="border-t border-gray-200/60 bg-emerald-50/5">
              <td className="px-4 py-2.5">
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="new.property.key"
                  className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1 text-xs text-gray-700 font-mono placeholder-gray-400 focus:outline-none focus:border-emerald-300/50"
                />
              </td>
              <td className="px-4 py-2.5">
                <input
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  placeholder="value"
                  onKeyDown={e => { if (e.key === 'Enter' && newKey.trim()) { onAdd(newKey, newValue); setNewKey(''); setNewValue(''); } }}
                  className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1 text-xs text-gray-700 font-mono placeholder-gray-400 focus:outline-none focus:border-emerald-300/50"
                />
              </td>
              <td className="px-3 py-2.5 text-center">
                <button
                  onClick={() => { if (newKey.trim()) { onAdd(newKey, newValue); setNewKey(''); setNewValue(''); } }}
                  disabled={!newKey.trim()}
                  className="flex items-center gap-0.5 text-[10px] px-2 py-1 bg-emerald-100 border border-emerald-300/40 text-emerald-700 hover:bg-emerald-600/30 rounded-lg transition-colors disabled:opacity-40 mx-auto"
                >
                  <Plus size={10} /> Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-500 text-xs">
            {search ? `No properties match "${search}"` : 'No properties loaded'}
          </div>
        )}
      </div>
      <p className="text-[10px] text-gray-500 text-right">
        {filtered.length} of {allEntries.length} properties shown
        {hasPendingChanges && <span className="ml-2 text-cyan-500">{pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}</span>}
      </p>

      {/* Raw JSON Modal */}
      {showRawJson && (
        <CpsRawJsonModal
          isOpen={showRawJson}
          onClose={() => setShowRawJson(false)}
          title="Edit Properties as JSON"
          description="Paste a full Postman properties payload. Your changes will be diffed and added to pending changes."
          initialJson={{
            properties: [
              {
                environment: envStr || '',
                key: keyStr || '',
                properties: props
              }
            ]
          }}
          onSave={(parsed) => {
            let newProps = parsed;
            if (parsed.properties && Array.isArray(parsed.properties) && parsed.properties[0]?.properties) {
              newProps = parsed.properties[0].properties;
            }
            const newPending = { added: {}, modified: {}, deleted: new Set() };
            for (const k of Object.keys(originalProps)) {
              if (!(k in newProps)) {
                newPending.deleted.add(k);
              } else if (String(newProps[k]) !== String(originalProps[k])) {
                newPending.modified[k] = String(newProps[k]);
              }
            }
            for (const k of Object.keys(newProps)) {
              if (!(k in originalProps)) {
                newPending.added[k] = String(newProps[k]);
              }
            }
            
            if (onReplaceAll) {
              onReplaceAll(newPending);
            } else {
              newPending.deleted.forEach(k => onDelete(k));
              Object.entries(newPending.modified).forEach(([k, v]) => onUpdate(k, v));
              Object.entries(newPending.added).forEach(([k, v]) => onAdd(k, v));
            }
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SecureGroupEditor — full CRUD + Auth panel for a single CPS secure group
// ─────────────────────────────────────────────────────────────────────────────
export function SecureGroupEditor({ group, baseUrl, environment, bgOrgId, isProd, onResult, onGroupDeleted, globalSearch }) {
  const isAccessDenied = typeof group.properties === 'string';
  const [originalProps, setOriginalProps] = useState(!isAccessDenied ? (group.properties || {}) : {});
  const [pendingChanges, setPendingChanges] = useState({ added: {}, modified: {}, deleted: new Set() });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const mergedProps = useMemo(() => {
    const m = { ...originalProps, ...pendingChanges.modified, ...pendingChanges.added };
    pendingChanges.deleted.forEach(k => delete m[k]);
    return m;
  }, [originalProps, pendingChanges]);

  const pendingCount = Object.keys(pendingChanges.added).length
    + Object.keys(pendingChanges.modified).length
    + pendingChanges.deleted.size;
  const hasPendingChanges = pendingCount > 0;

  const updateProperty = (key, newValue) => {
    setPendingChanges(prev => {
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in prev.added) { next.added = { ...prev.added, [key]: newValue }; }
      else { next.modified = { ...prev.modified, [key]: newValue }; }
      return next;
    });
  };

  const addProperty = (key, value) => {
    if (!key.trim()) return;
    setPendingChanges(prev => ({
      ...prev,
      added: { ...prev.added, [key.trim()]: value },
      deleted: (() => { const s = new Set(prev.deleted); s.delete(key.trim()); return s; })(),
    }));
  };

  const markDeleted = (key) => {
    setPendingChanges(prev => {
      const next = { ...prev, added: { ...prev.added }, modified: { ...prev.modified }, deleted: new Set(prev.deleted) };
      if (key in next.added) { delete next.added[key]; }
      else { next.deleted.add(key); delete next.modified[key]; }
      return next;
    });
  };

  const discardChanges = () => setPendingChanges({ added: {}, modified: {}, deleted: new Set() });

  const saveGroup = async () => {
    if (!hasPendingChanges) return;
    setSaving(true);
    setSaveError('');
    const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const fallbackReqDetails = {
      method: 'PUT',
      url: `${cleanBase}/api/v2/properties/secure`,
      body: { properties: [{ environment, key: group.key, properties: mergedProps }] },
    };
    try {
      const resp = await api.post('/cps/write', {
        baseUrl, type: 'secure', method: 'PUT',
        environment, projectKey: group.key, properties: mergedProps, bgOrgId,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: `Save Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      setOriginalProps(mergedProps);
      setPendingChanges({ added: {}, modified: {}, deleted: new Set() });
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: `Save Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setSaveError(err.response?.data?.error || err.message || 'Save failed');
    }
    setSaving(false);
  };

  const deleteGroup = async () => {
    if (isProd && deleteConfirmText.trim() !== group.key) return;
    setDeleting(true);
    const cleanBase = baseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
    const fallbackReqDetails = {
      method: 'DELETE',
      url: `${cleanBase}/api/v2/properties/secure`,
      params: { environment, keys: group.key },
    };
    try {
      const resp = await api.delete('/cps/project', {
        data: { baseUrl, type: 'secure', environment, projectKey: group.key, bgOrgId },
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: `Delete Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      onGroupDeleted?.(group.key);
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: `Delete Secure Group (${group.key})`,
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
  };

  return (
    <div className="bg-white border border-orange-200/30 rounded-xl overflow-hidden">
      {/* Group header */}
      <div className="px-4 py-3 bg-orange-50/20 border-b border-orange-200/30 flex items-center gap-2 flex-wrap">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-2 flex-1 min-w-0">
          <Key size={12} className="text-orange-600 flex-shrink-0" />
          <span className="text-orange-700 text-xs font-semibold font-mono truncate">{group.key}</span>
          {isAccessDenied && (
            <span className="text-[9px] text-yellow-600 bg-yellow-50 border border-yellow-300/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
              ⚠ Access Denied
            </span>
          )}
          {hasPendingChanges && !collapsed && (
            <span className="text-[9px] text-cyan-600 bg-cyan-50 border border-cyan-300/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
              {pendingCount} unsaved
            </span>
          )}
        </button>
        {/* Toolbar */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasPendingChanges && (
            <>
              <button onClick={discardChanges} disabled={saving}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-900 bg-gray-100 border border-gray-300 px-2 py-1 rounded-lg transition-colors disabled:opacity-50">
                <X size={9} /> Discard
              </button>
              <button onClick={saveGroup} disabled={saving}
                className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg transition-colors disabled:opacity-50 ${
                  isProd ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-orange-700 hover:bg-orange-600 text-white'
                }`}>
                {saving ? <><RefreshCw size={9} className="animate-spin" /> Saving…</> : <><Save size={9} /> Save</>}
              </button>
            </>
          )}
          <button
            onClick={() => { setShowAuth(s => !s); setShowDeleteConfirm(false); }}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors ${
              showAuth
                ? 'bg-cyan-700/40 border-cyan-300/60 text-cyan-700'
                : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-cyan-700'
            }`}
          >
            <ShieldCheck size={9} /> Auth
          </button>
          <button
            onClick={() => { setShowDeleteConfirm(s => !s); setShowAuth(false); }}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-colors ${
              showDeleteConfirm
                ? 'bg-red-700/40 border-red-300/60 text-red-700'
                : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-red-600'
            }`}
          >
            <Trash2 size={9} /> Delete Group
          </button>
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="flex items-center gap-2 bg-red-50/30 border-b border-red-200/40 px-4 py-2 text-red-600 text-xs">
          <AlertTriangle size={11} className="flex-shrink-0" /> {saveError}
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="px-4 py-3 bg-red-50/20 border-b border-red-200/30 space-y-2">
          <p className="text-xs text-red-700 font-medium flex items-center gap-1.5">
            <AlertTriangle size={11} /> Delete entire secure group <code className="bg-red-50/40 px-1 rounded">{group.key}</code>?
          </p>
          {isProd ? (
            <div className="flex items-center gap-2">
              <input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={`Type "${group.key}" to confirm`}
                className="flex-1 bg-gray-100 border border-red-300/50 rounded-lg px-2.5 py-1 text-xs text-gray-900 font-mono placeholder-gray-400 focus:outline-none"
              />
              <button
                onClick={deleteGroup}
                disabled={deleting || deleteConfirmText.trim() !== group.key}
                className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {deleting ? <><RefreshCw size={9} className="animate-spin" /> Deleting…</> : <><Trash2 size={9} /> Confirm Delete</>}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-red-600/70 flex-1">This will remove all properties in this group permanently.</p>
              <button
                onClick={deleteGroup}
                disabled={deleting}
                className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {deleting ? <><RefreshCw size={9} className="animate-spin" /> Deleting…</> : <><Trash2 size={9} /> Delete</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Auth panel */}
      {showAuth && (
        <div className="px-4 pt-4 pb-2 border-b border-orange-200/20 bg-orange-50/10">
          <CpsAuthPanel
            baseUrl={baseUrl}
            type="secure"
            environment={environment}
            projectKey={group.key}
            bgOrgId={bgOrgId}
            onResult={onResult}
          />
        </div>
      )}

      {/* Properties */}
      {!collapsed && (
        isAccessDenied ? (
          <div className="px-4 py-5 flex flex-col items-center gap-3">
            <AlertTriangle size={20} className="text-yellow-500" />
            <p className="text-yellow-600/80 text-sm text-center">
              COULD NOT ACCESS — the credential in use does not have permission for this group.
            </p>
            <p className="text-gray-500 text-xs text-center">
              You can still create a new entry using the form below — existing values will be replaced.
            </p>
            {/* Allow write even when read fails */}
            <div className="w-full mt-2">
              <PropertyTable
                props={mergedProps}
                originalProps={originalProps}
                pendingChanges={pendingChanges}
                search={globalSearch || ''}
                setSearch={() => {}}
                hideSearchInput={true}
                onUpdate={updateProperty}
                onDelete={markDeleted}
                onAdd={addProperty}
                hasPendingChanges={hasPendingChanges}
                pendingCount={pendingCount}
                onSave={saveGroup}
                onDiscard={discardChanges}
                saving={saving}
                isProd={isProd}
                allProps={mergedProps}
                envStr={environment}
                keyStr={group.key}
              />
            </div>
          </div>
        ) : (
          <div className="p-4">
            <PropertyTable
              props={mergedProps}
              originalProps={originalProps}
              pendingChanges={pendingChanges}
              search={globalSearch || ''}
              setSearch={() => {}}
              hideSearchInput={true}
              onUpdate={updateProperty}
              onDelete={markDeleted}
              onAdd={addProperty}
              hasPendingChanges={hasPendingChanges}
              pendingCount={pendingCount}
              onSave={saveGroup}
              onDiscard={discardChanges}
              saving={saving}
              isProd={isProd}
              allProps={mergedProps}
              envStr={environment}
              keyStr={group.key}
            />
          </div>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthTabWithSearch — Access Control tab with project-key search at the top
// ─────────────────────────────────────────────────────────────────────────────
export function AuthTabWithSearch({ cpsBaseUrl, cpsEnv, cpsKey, secureGroups, resolvedBgId, setLastOperation }) {
  const [keySearch, setKeySearch] = useState('');

  const q = keySearch.trim().toLowerCase();

  // Build list of all auth sections: non-secure + secure groups
  const allSections = [
    { type: 'non-secure', key: cpsKey, label: 'Non-Secure' },
    ...secureGroups.map(g => ({ type: 'secure', key: g.key, label: 'Secure' })),
  ];

  const visibleSections = q
    ? allSections.filter(s => s.key.toLowerCase().includes(q))
    : allSections;

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          value={keySearch}
          onChange={e => setKeySearch(e.target.value)}
          placeholder="Search project key…"
          className="w-full bg-white border border-gray-300 rounded-xl pl-9 pr-10 py-2.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-cyan-300/50"
        />
        {keySearch && (
          <button
            onClick={() => setKeySearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Count hint */}
      {q && (
        <p className="text-[10px] text-gray-500">
          {visibleSections.length === 0
            ? `No sections match "${keySearch}"`
            : `${visibleSections.length} of ${allSections.length} section${allSections.length !== 1 ? 's' : ''} shown`}
        </p>
      )}

      {/* Auth sections */}
      {visibleSections.map(section => (
        <div
          key={`${section.type}::${section.key}`}
          className={`bg-white rounded-xl overflow-hidden ${
            section.type === 'secure'
              ? 'border border-orange-200/30'
              : 'border border-gray-200'
          }`}
        >
          <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${
            section.type === 'secure'
              ? 'bg-orange-50/20 border-orange-200/30'
              : 'bg-gray-100/40 border-gray-300/50'
          }`}>
            <ShieldCheck size={12} className={section.type === 'secure' ? 'text-orange-600' : 'text-cyan-600'} />
            <span className={`text-xs font-semibold ${section.type === 'secure' ? 'text-orange-700' : 'text-cyan-700'}`}>
              {section.label}
            </span>
            <code className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded ml-1 font-mono">{section.key}</code>
          </div>
          <div className="p-5">
            <CpsAuthPanel
              baseUrl={cpsBaseUrl}
              type={section.type}
              environment={cpsEnv}
              projectKey={section.key}
              bgOrgId={resolvedBgId}
              onResult={setLastOperation}
            />
          </div>
        </div>
      ))}

      {visibleSections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-2 bg-white border border-gray-200 rounded-xl">
          <Search size={24} className="text-gray-500" />
          <p className="text-gray-500 text-sm">No project keys match "{keySearch}"</p>
        </div>
      )}
    </div>
  );
}
