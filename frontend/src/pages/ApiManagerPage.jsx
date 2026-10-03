import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, ShieldCheck, Search, SlidersHorizontal, ChevronRight, CheckCircle, XCircle, Clock, AlertCircle, Globe, Trash2 } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter, getVisibleEnvIds } from '../components/EnvFilterModal';
import api from '../services/api';
import { ENV_BADGE } from '../utils/appUtils';
import { getCachedSWR, setCached } from '../services/apiCache';

const ENV_TAG_COLOR = { production: 'bg-green-100 text-green-600', sandbox: 'bg-yellow-100 text-yellow-600' };

// Cache TTL constants
const ENV_CACHE_MS  = 10 * 60 * 1000;  // 10 min — env lists are stable
const APIS_CACHE_MS =  5 * 60 * 1000;  //  5 min — API instances change more often

// ── Contract Card ─────────────────────────────────────────────────────────────
function ContractCard({ c, i, onUpdateContract, onDeleteContract }) {
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleUpdate = async (newStatus) => {
    setLoading(true);
    await onUpdateContract(c.id, newStatus);
    setLoading(false);
    setConfirmRevoke(false);
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    await onDeleteContract(c.id);
    setDeleteLoading(false);
    setConfirmDelete(false);
  };

  const appName =
    c.application?.name ||
    c.clientApplication?.name ||
    c.applicationName ||
    `App ${c.clientApplicationId || c.applicationId || c.id}`;

  const clientId =
    c.application?.coreServicesId ||
    c._enrichedClientId ||
    c.application?.clientId ||
    c.application?.client_id ||
    c.application?.credentials?.clientId ||
    c.clientApplication?.coreServicesId ||
    c.clientApplication?.clientId ||
    c.clientId ||
    c.client_id ||
    null;

  const clientAppId =
    c.application?.id ||
    c.clientApplication?.id ||
    c.clientApplicationId ||
    c.applicationId ||
    null;

  const status = (c.status || 'ACTIVE').toUpperCase();
  const tierName = c.tier?.name || c.requestedTier?.name || null;
  const created = c.createdDate ? new Date(c.createdDate).toLocaleDateString() : null;

  // Anypoint API can return 'PENDING_APPROVAL' or just 'PENDING' for awaiting-approval contracts,
  // and 'ACTIVE' or 'APPROVED' for approved ones — normalise both variants.
  const isPending  = status === 'PENDING_APPROVAL' || status === 'PENDING';
  const isApproved = status === 'ACTIVE' || status === 'APPROVED';

  const statusIcon =
    isApproved ? <CheckCircle size={12} className="text-green-600 flex-shrink-0" /> :
    status === 'REVOKED' ? <XCircle size={12} className="text-red-600 flex-shrink-0" /> :
    isPending ? <Clock size={12} className="text-yellow-600 flex-shrink-0" /> :
    <AlertCircle size={12} className="text-gray-500 flex-shrink-0" />;

  const statusColor =
    isApproved ? 'text-green-600 bg-green-50 border-green-300/40' :
    status === 'REVOKED' ? 'text-red-600 bg-red-50 border-red-300/40' :
    isPending ? 'text-yellow-600 bg-yellow-50 border-yellow-300/40' :
    'text-gray-500 bg-gray-200/30 border-gray-300/40';

  return (
    <div key={c.id || i} className="px-5 py-3 hover:bg-gray-100/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-gray-900 text-sm font-medium truncate">{appName}</p>
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${statusColor}`}>
          {statusIcon}{status.replace('_', ' ')}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-[10px] w-16 flex-shrink-0">Client ID</span>
          <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 break-all select-all">
            {clientId || '—'}
          </span>
        </div>
        {clientAppId && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-[10px] w-16 flex-shrink-0">App ID</span>
            <span className="font-mono text-[10px] text-gray-500">{clientAppId}</span>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {tierName && (
            <span className="text-blue-600 text-[10px] bg-blue-50 border border-blue-300/40 px-1.5 py-0.5 rounded">{tierName}</span>
          )}
          {created && <span className="text-gray-500 text-[10px]">{created}</span>}
        </div>
      </div>

      <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-200/60">
        {/* ── Status action buttons (left) ─────────────────────────── */}
        <div className="flex gap-2 min-h-[24px] items-center">
          {loading && <RefreshCw size={12} className="animate-spin text-gray-500" />}

          {!loading && isPending && (
            <>
              <button onClick={() => handleUpdate('APPROVED')} className="text-[10px] uppercase font-bold tracking-wider bg-green-100/40 text-green-600 border border-green-300/50 hover:bg-green-800/60 px-3 py-1 rounded transition-colors">Approve</button>
              <button onClick={() => handleUpdate('REVOKED')} className="text-[10px] uppercase font-bold tracking-wider bg-red-100/40 text-red-600 border border-red-300/50 hover:bg-red-800/60 px-3 py-1 rounded transition-colors">Reject</button>
            </>
          )}

          {!loading && isApproved && !confirmRevoke && (
            <button onClick={() => setConfirmRevoke(true)} className="text-[10px] uppercase font-bold tracking-wider bg-red-100/40 text-red-600 border border-red-300/50 hover:bg-red-800/60 px-3 py-1 rounded transition-colors">Revoke</button>
          )}

          {!loading && confirmRevoke && (
            <div className="flex gap-2 items-center">
              <span className="text-[10px] uppercase font-bold tracking-wider text-red-600 flex items-center gap-1">
                <AlertCircle size={10} /> Revoke this contract?
              </span>
              <button onClick={() => handleUpdate('REVOKED')} className="text-[10px] uppercase font-bold tracking-wider bg-red-600 text-gray-900 hover:bg-red-500 px-3 py-1 rounded transition-colors">Yes, Revoke</button>
              <button onClick={() => setConfirmRevoke(false)} className="text-[10px] uppercase font-bold tracking-wider text-gray-500 hover:text-gray-900 px-2 py-1 rounded transition-colors">Cancel</button>
            </div>
          )}

          {!loading && status === 'REVOKED' && (
            <button onClick={() => handleUpdate('ACTIVE')} className="text-[10px] uppercase font-bold tracking-wider bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200 px-3 py-1 rounded transition-colors">Restore</button>
          )}
        </div>

        {/* ── Delete button (right) ─────────────────────────────────── */}
        <div className="flex gap-2 items-center flex-shrink-0">
          {deleteLoading ? (
            <RefreshCw size={12} className="animate-spin text-gray-500" />
          ) : confirmDelete ? (
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] font-bold text-red-600 flex items-center gap-1">
                <Trash2 size={10} /> Delete permanently?
              </span>
              <button
                onClick={handleDelete}
                className="text-[10px] uppercase font-bold tracking-wider bg-red-700 text-gray-900 hover:bg-red-600 px-2 py-0.5 rounded transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] uppercase font-bold tracking-wider text-gray-500 hover:text-gray-900 px-2 py-0.5 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setConfirmRevoke(false); setConfirmDelete(true); }}
              title="Delete contract permanently"
              className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider bg-gray-100 text-gray-500 border border-gray-300 hover:bg-red-100/40 hover:text-red-600 hover:border-red-300/50 px-2 py-1 rounded transition-colors"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Policy Card ───────────────────────────────────────────────────────────────
function PolicyCard({ p, i }) {
  const policyName =
    p.template?.name || p.template?.assetId || p.assetId ||
    (typeof p.policyTemplateId === 'string' && isNaN(p.policyTemplateId) ? p.policyTemplateId : null) ||
    `Policy ${p.id}`;
  const rawVer = p.template?.assetVersion || p.assetVersion;
  const policyVersion = rawVer && String(rawVer).length <= 10 ? rawVer : null;
  return (
    <div key={p.id || i} className="px-5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-gray-900 text-sm font-medium capitalize">{policyName.replace(/-/g, ' ')}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${p.disabled ? 'text-red-600 bg-red-50 border-red-300/40' : 'text-green-600 bg-green-50 border-green-300/40'}`}>
          {p.disabled ? 'Disabled' : 'Active'}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <p className="text-gray-500 text-xs font-mono">{policyName}</p>
        {policyVersion && <span className="text-gray-500 text-[10px]">v{policyVersion}</span>}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ApiManagerPage() {
  const { orgId: authOrgId } = useAuth();

  const [allBusinessGroups, setAllBusinessGroups] = useState([]);

  // Persist BG selection in localStorage; default to __all__
  const [selectedBg, setSelectedBg] = useState(
    () => localStorage.getItem('mule_apimgr_bg') || '__all__'
  );
  useEffect(() => {
    if (selectedBg) localStorage.setItem('mule_apimgr_bg', selectedBg);
  }, [selectedBg]);

  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);
  const [environments, setEnvironments] = useState([]);

  // Persist Env selection in localStorage; '' means All Environments
  const [selectedEnv, setSelectedEnv] = useState(
    () => localStorage.getItem('mule_apimgr_env') || ''
  );
  useEffect(() => {
    localStorage.setItem('mule_apimgr_env', selectedEnv);
  }, [selectedEnv]);

  const [apis, setApis] = useState([]);
  const [selectedApi, setSelectedApi] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [bgFilterVersion, setBgFilterVersion] = useState(0); // eslint-disable-line no-unused-vars
  const [envFilterVersion, setEnvFilterVersion] = useState(0); // tracks global env filter changes

  // Prevent the selectedEnv effect from double-firing on initial mount;
  // loadEnvs already calls loadApisInternal directly with fresh data.
  const skipEnvEffectRef = useRef(true);

  // Auto-select instance navigated from ApplicationDetailPage (stored in localStorage)
  const pendingInstanceIdRef = useRef(
    localStorage.getItem('mule_apimgr_instance') || ''
  );

  // ── Listen for global filter changes ───────────────────────────────────────
  // BG filter changes — causes re-render for filter count badges
  useEffect(() => {
    const h = () => setBgFilterVersion(v => v + 1);
    window.addEventListener('bgFilterChanged', h);
    return () => window.removeEventListener('bgFilterChanged', h);
  }, []);

  // Global Env filter changes (Header → EnvFilterModal) — re-apply filter to envs
  useEffect(() => {
    const h = () => setEnvFilterVersion(v => v + 1);
    window.addEventListener('envFilterChanged', h);
    return () => window.removeEventListener('envFilterChanged', h);
  }, []);

  // Clear the pending instance key from localStorage as soon as the page mounts
  // (we've already captured it in the ref above)
  useEffect(() => {
    if (pendingInstanceIdRef.current) {
      localStorage.removeItem('mule_apimgr_instance');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On auth ready, load business groups
  useEffect(() => {
    if (authOrgId) loadBusinessGroups();
  }, [authOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select pending API instance once the list finishes loading
  useEffect(() => {
    const targetId = pendingInstanceIdRef.current;
    if (!targetId || apis.length === 0 || selectedApi) return;
    const match = apis.find(a => String(a.id) === String(targetId));
    if (match) {
      pendingInstanceIdRef.current = ''; // consume — only fire once
      selectApi(match);
    }
  }, [apis]); // eslint-disable-line react-hooks/exhaustive-deps

  // When BG selection changes, groups first load, OR global env filter changes →
  // reload envs + APIs.  envFilterVersion bump triggers this without a new API
  // call if the env list is already cached (cache hit → re-apply filter only).
  useEffect(() => {
    if (selectedBg && allBusinessGroups.length > 0) loadEnvs(selectedBg);
  }, [selectedBg, allBusinessGroups.length, envFilterVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-load APIs when user explicitly changes the env dropdown
  useEffect(() => {
    if (skipEnvEffectRef.current) return;
    if (selectedBg) loadApisInternal(selectedBg, selectedEnv, environments);
  }, [selectedEnv]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Business Groups ─────────────────────────────────────────────────────────
  const loadBusinessGroups = async () => {
    setBgLoading(true);
    try {
      const res = await api.get('/organizations/business-groups');
      const groups = res.data.data || [];
      setAllBusinessGroups(groups);
      const savedBg = localStorage.getItem('mule_apimgr_bg');
      const isValidSaved = savedBg && (savedBg === '__all__' || groups.some(g => g.id === savedBg));
      setSelectedBg(isValidSaved ? savedBg : '__all__');
    } catch {
      setSelectedBg(authOrgId || '__all__');
    }
    setBgLoading(false);
  };

  // ── Environments ────────────────────────────────────────────────────────────
  // Fetches raw envs (with SWR caching), then applies the global env filter
  // from the Header's Env Filter button before updating state.
  const loadEnvs = async (bgId) => {
    skipEnvEffectRef.current = true;
    setApis([]); setSelectedApi(null);
    try {
      const visible = applyBgFilter(allBusinessGroups);
      const bgIds = bgId === '__all__'
        ? (visible.length > 0 ? visible.map(g => g.id) : [authOrgId])
        : [bgId];

      // ── Cache: raw (unfiltered) env list keyed by BG set ──────────────────
      // We cache the raw list so that global env filter changes can be applied
      // instantly without a new API call (envFilterVersion increments →
      // loadEnvs → cache hit → re-apply applyEnvFilter → done).
      const envCacheKey = `apimgr:envs:${[...bgIds].sort().join(',')}`;
      let rawEnvs;

      const swr = getCachedSWR(envCacheKey);
      if (swr && !swr.stale) {
        // Fresh cache hit — no network call needed
        rawEnvs = swr.data;
      } else {
        // Cache miss or stale — fetch from API
        const results = await Promise.allSettled(bgIds.map(id => api.get(`/environments/${id}`)));
        const seenEnvs = new Set();
        const fetched = [];
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            (r.value.data.data || []).forEach(e => {
              if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); fetched.push(e); }
            });
          }
        });
        setCached(envCacheKey, fetched, ENV_CACHE_MS);
        // SWR: if a stale entry existed, use it for this render cycle;
        // the fresh data is stored in cache for the next navigation.
        rawEnvs = swr?.stale ? swr.data : fetched;
      }

      // ── Apply global Env Filter (from Header's "Env Filter" button) ────────
      // applyEnvFilter returns ALL envs when no global filter is active,
      // or only the selected subset when the user has configured one.
      const mergedEnvs = applyEnvFilter(rawEnvs);
      setEnvironments(mergedEnvs);

      // Validate saved env is still in the filtered list; fall back to '' (All)
      const savedEnv = localStorage.getItem('mule_apimgr_env') || '';
      const validSavedEnv = savedEnv && mergedEnvs.some(e => e.id === savedEnv) ? savedEnv : '';
      setSelectedEnv(validSavedEnv);

      // Load APIs immediately with fresh data (don't wait for state to propagate)
      skipEnvEffectRef.current = false;
      await loadApisInternal(bgId, validSavedEnv, mergedEnvs);
    } catch {
      setEnvironments([]);
      skipEnvEffectRef.current = false;
    }
  };

  // ── API Instances ───────────────────────────────────────────────────────────
  // Core loader — accepts explicit args so it works both from loadEnvs
  // (before React state updates) and from the env-change effect.
  // Uses SWR caching: fresh → instant return; stale → instant render + bg refetch;
  // miss → fetch with spinner.
  const loadApisInternal = async (bgId, envId, envList) => {
    setError('');

    const visible = applyBgFilter(allBusinessGroups);
    const bgIds = bgId === '__all__'
      ? (visible.length > 0 ? visible.map(g => g.id) : [authOrgId])
      : [bgId];

    // Always apply the global env filter defensively so that stale-closure
    // callers (e.g. the selectedEnv useEffect) never accidentally fetch for
    // environments the user has excluded via the Header's Env Filter button.
    const filteredEnvList = applyEnvFilter(envList || []);

    const envIds = envId
      ? [envId]
      : filteredEnvList.map(e => e.id);

    if (envIds.length === 0) {
      setError('No environments available. Select a Business Group with environments.');
      setApis([]);
      setSelectedApi(null);
      setLoading(false);
      return;
    }

    // ── SWR cache check ───────────────────────────────────────────────────────
    const apisCacheKey = `apimgr:apis:${bgId}:${[...envIds].sort().join(',')}`;
    const swr = getCachedSWR(apisCacheKey);

    if (swr) {
      // Render instantly from cache (stale or fresh)
      setApis(swr.data);
      setSelectedApi(null);
      setLoading(false);
      if (swr.data.length === 0) setError('No API instances found.');
      if (!swr.stale) return; // Fresh — no network call needed
      // Stale — fall through for silent background refresh (no spinner)
    } else {
      // Cache miss — show loading spinner and clear list
      setLoading(true);
      setApis([]);
      setSelectedApi(null);
    }

    // ── Network fetch ─────────────────────────────────────────────────────────
    try {
      // Build correct (org, env) pairs — NO cross-product.
      // Each environment belongs to exactly one org (its organizationId).
      // Querying a different org for an env that does not belong to it returns 401.
      // • Specific BG selected → all envs in filteredEnvList belong to it by construction.
      // • "All BGs" selected   → use env.organizationId to route each env to its owning org.
      const combos = envIds.map(ev => {
        if (bgId !== '__all__') {
          return { bg: bgId, ev };
        }
        const envObj = filteredEnvList.find(e => e.id === ev);
        const bg = envObj?.organizationId || bgIds[0];
        return { bg, ev };
      });

      const results = await Promise.allSettled(
        combos.map(({ bg, ev }) => api.get(`/apis/${bg}/${ev}`))
      );

      const seenApis = new Set();
      const list = [];
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          const data = r.value.data;
          const rawItems = data.assets || data.data || (Array.isArray(data) ? data : []);
          const items = rawItems.flatMap(item =>
            Array.isArray(item.apis) && item.apis.length > 0
              ? item.apis.map(inst => ({
                  ...inst,
                  assetId: inst.assetId || item.assetId,
                  assetVersion: inst.assetVersion || item.assetVersion,
                  groupId: inst.groupId || item.groupId,
                }))
              : [item]
          );
          items.forEach(item => {
            const key = String(item.id);
            if (!seenApis.has(key)) { seenApis.add(key); list.push(item); }
          });
        }
      });

      setCached(apisCacheKey, list, APIS_CACHE_MS);
      setApis(list);
      if (list.length === 0) setError('No API instances found.');
    } catch (e) {
      // Only show error if we had no cached data to fall back on
      if (!swr) {
        setError(e.response?.data?.error || e.response?.data?.message || 'Failed to load API instances.');
        setApis([]);
      }
    }
    setLoading(false);
  };

  // Public refresh — invalidates the API instances cache then reloads
  const loadApis = () => {
    const envIds = selectedEnv
      ? [selectedEnv]
      : environments.map(e => e.id);
    const apisCacheKey = `apimgr:apis:${selectedBg}:${[...envIds].sort().join(',')}`;
    // Force a fresh fetch by writing a 0-TTL entry (expired immediately)
    setCached(apisCacheKey, [], 0);
    loadApisInternal(selectedBg, selectedEnv, environments);
  };

  // ── API Detail ──────────────────────────────────────────────────────────────
  const selectApi = async (apiInstance) => {
    setSelectedApi(apiInstance);
    setPolicies([]);
    setContracts([]);
    setContractsLoading(true);

    // For "All BGs" mode, prefer the instance's own organizationId if available
    const bgId = selectedBg === '__all__'
      ? (apiInstance.organizationId || authOrgId)
      : selectedBg;
    const envId = apiInstance.environmentId || selectedEnv;

    const [pRes, cRes] = await Promise.allSettled([
      api.get(`/apis/${bgId}/${envId}/${apiInstance.id}/policies`),
      api.get(`/apis/${bgId}/${envId}/${apiInstance.id}/contracts`),
    ]);

    if (pRes.status === 'fulfilled') {
      const d = pRes.value.data;
      setPolicies(d.policies || (Array.isArray(d) ? d : []));
    }

    let contractList = [];
    if (cRes.status === 'fulfilled') {
      const d = cRes.value.data;
      contractList = d.contracts || (Array.isArray(d) ? d : []);
    }

    setContracts(contractList);
    setContractsLoading(false);
  };

  const updateContractStatus = async (contractId, newStatus) => {
    const bgId = selectedBg === '__all__'
      ? (selectedApi?.organizationId || authOrgId)
      : selectedBg;
    const envId = selectedApi?.environmentId || selectedEnv;
    try {
      await api.patch(
        `/apis/${bgId}/${envId}/${selectedApi.id}/contracts/${contractId}`,
        { status: newStatus }
      );
      const cRes = await api.get(`/apis/${bgId}/${envId}/${selectedApi.id}/contracts`);
      const d = cRes.data;
      setContracts(d.contracts || (Array.isArray(d) ? d : []));
    } catch (e) {
      alert(`Failed to update contract: ${e.response?.data?.error || e.message}`);
    }
  };

  const deleteContract = async (contractId) => {
    const bgId = selectedBg === '__all__'
      ? (selectedApi?.organizationId || authOrgId)
      : selectedBg;
    const envId = selectedApi?.environmentId || selectedEnv;
    try {
      await api.delete(
        `/apis/${bgId}/${envId}/${selectedApi.id}/contracts/${contractId}`
      );
      // Remove deleted contract from local state immediately — no re-fetch needed
      setContracts(prev => prev.filter(c => c.id !== contractId));
    } catch (e) {
      alert(`Failed to delete contract: ${e.response?.data?.error || e.message}`);
    }
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const visibleGroups = applyBgFilter(allBusinessGroups);
  const filterActive = visibleGroups.length < allBusinessGroups.length;

  // Global env filter active when localStorage has a saved selection
  const envFilterActive = getVisibleEnvIds().size > 0;

  const selectedBgName = selectedBg === '__all__'
    ? 'All Business Groups'
    : visibleGroups.find(g => g.id === selectedBg)?.name || 'Organization';

  const selectedEnvName = environments.find(e => e.id === selectedEnv)?.name || '';

  const bgOptions = [
    {
      value: '__all__',
      label: 'All Business Groups',
      tag: `${visibleGroups.length}`,
      tagColor: 'bg-gray-200 text-gray-600',
    },
    ...visibleGroups.map(g => ({
      value: g.id,
      label: g.name,
      indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined,
      tagColor: 'bg-blue-100 text-blue-600',
    })),
  ];

  const envOptions = [
    {
      value: '',
      label: 'All Environments',
      tag: environments.length > 0 ? `${environments.length}` : undefined,
      tagColor: 'bg-gray-200 text-gray-600',
    },
    ...environments.map(e => ({
      value: e.id,
      label: e.name,
      badge: true,
      badgeColor: ENV_BADGE[e.type] || 'bg-gray-400',
      tag: e.type,
      tagColor: ENV_TAG_COLOR[e.type] || 'bg-gray-200 text-gray-500',
    })),
  ];

  // Search: match assetId, name, instanceLabel, OR numeric API instance ID
  const filtered = apis.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase().trim();
    return (
      (a.assetId  || '').toLowerCase().includes(q) ||
      (a.name     || '').toLowerCase().includes(q) ||
      (a.label    || '').toLowerCase().includes(q) ||
      (a.instanceLabel || '').toLowerCase().includes(q) ||
      String(a.id ?? '').includes(q)
    );
  });

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBusinessGroups}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => {
            const visible = applyBgFilter(allBusinessGroups);
            if (selectedBg !== '__all__' && !visible.find(g => g.id === selectedBg)) {
              setSelectedBg('__all__');
            }
          }}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">API Manager</h1>
          <p className="text-gray-500 text-sm mt-1">
            Managed API instances in{' '}
            <span className="text-blue-600">{selectedBgName}</span>
            {selectedEnvName && (
              <> · <span className="text-blue-600">{selectedEnvName}</span></>
            )}
          </p>
        </div>
        <button
          onClick={loadApis}
          disabled={loading || !selectedBg}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 px-3 py-2 rounded-lg disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ── Filters — BG · Env · Search inline row ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">

        {/* Business Group */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium flex-1">Business Group</p>
          </div>
          <Select
            value={selectedBg}
            onChange={v => { setSelectedBg(v); setSearch(''); }}
            options={bgOptions}
            placeholder="Select business group…"
            searchable={visibleGroups.length > 5}
            disabled={bgLoading}
          />
          {filterActive && (
            <p className="text-[9px] text-blue-600 mt-0.5 pl-1">
              {visibleGroups.length}/{allBusinessGroups.length} shown
            </p>
          )}
        </div>

        {/* Environment — respects global Env Filter from Header */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium flex-1">Environment</p>
            {envFilterActive && (
              <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border bg-green-100 border-green-300/50 text-green-600">
                <Globe size={9} /> Global filter
              </span>
            )}
          </div>
          <Select
            value={selectedEnv}
            onChange={v => {
              skipEnvEffectRef.current = true;
              setSelectedEnv(v);
              loadApisInternal(selectedBg, v, environments);
            }}
            options={envOptions}
            placeholder="All Environments"
            searchable={environments.length > 5}
          />
          {envFilterActive && (
            <p className="text-[9px] text-green-600 mt-0.5 pl-1">
              {environments.length} env{environments.length !== 1 ? 's' : ''} from global filter
            </p>
          )}
        </div>

        {/* Search — spans 2 columns on larger screens */}
        <div className="sm:col-span-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">Search</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by API name, asset ID, or instance ID…"
              className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-yellow-50/20 border border-yellow-200/40 rounded-xl px-4 py-3 text-yellow-600 text-sm">
          {error}
        </div>
      )}

      {/* ── Main grid: list + detail ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── API Instance List ─────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-gray-900 font-semibold">
              API Instances ({filtered.length})
            </h3>
            {apis.length > filtered.length && (
              <span className="text-[10px] text-gray-500">{apis.length} total</span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500" />
            </div>
          ) : (
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {filtered.map(a => (
                <button
                  key={`${a.id}-${a.assetId}`}
                  onClick={() => selectApi(a)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-100/50 text-left transition-colors ${
                    selectedApi?.id === a.id ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ShieldCheck size={15} className="text-blue-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-gray-900 text-sm font-medium truncate">
                        {a.assetId || a.name || a.label}
                      </p>
                      <p className="text-gray-500 text-xs">
                        v{a.assetVersion || a.productVersion || '—'} · ID: {a.id}
                        {/* Show env name when viewing across multiple envs */}
                        {!selectedEnv && a.environmentId && environments.length > 1 && (
                          <> · <span className="text-gray-500">
                            {environments.find(e => e.id === a.environmentId)?.name || a.environmentId}
                          </span></>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge status={a.status || 'active'} />
                    <ChevronRight size={13} className="text-gray-500" />
                  </div>
                </button>
              ))}

              {filtered.length === 0 && !loading && (
                <p className="px-5 py-10 text-center text-gray-500 text-sm">
                  {search
                    ? 'No APIs match your search.'
                    : !selectedBg
                    ? 'Select a business group.'
                    : 'No API instances found.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── API Detail Panel ──────────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-y-auto max-h-[700px]">
          {selectedApi ? (
            <>
              {/* Detail header */}
              <div className="px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
                <h3 className="text-gray-900 font-semibold">
                  {selectedApi.assetId || selectedApi.name}
                </h3>
                <p className="text-gray-500 text-xs mt-0.5">
                  Version {selectedApi.assetVersion || selectedApi.productVersion || '—'}
                  {selectedApi.instanceLabel && (
                    <span className="ml-2 text-blue-600">· {selectedApi.instanceLabel}</span>
                  )}
                </p>
              </div>

              {/* Key-value metadata */}
              <div className="p-5 space-y-2.5 text-sm border-b border-gray-200">
                {[
                  ['API ID', selectedApi.id],
                  ['Group ID', selectedApi.groupId || '—'],
                  ['Environment', (() => {
                    const envName = environments.find(e => e.id === (selectedApi.environmentId || selectedEnv))?.name;
                    return envName || selectedApi.environmentId || selectedEnv || '—';
                  })()],
                  ['Endpoint URI', selectedApi.endpoint?.uri || selectedApi.endpointUri || '—'],
                  ['Proxy URI', selectedApi.endpoint?.proxyUri || '—'],
                  ['Technology', selectedApi.technology || selectedApi.type || '—'],
                  ['Status', selectedApi.status || 'active'],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-start justify-between gap-4">
                    <span className="text-gray-500 flex-shrink-0 w-28">{label}</span>
                    <span className="text-gray-900 text-right font-mono text-xs break-all">{String(val)}</span>
                  </div>
                ))}
              </div>

              {/* Policies */}
              <div className="border-b border-gray-200">
                <div className="px-5 py-2.5 flex items-center justify-between">
                  <h4 className="text-gray-900 text-sm font-semibold">
                    Policies ({policies.length})
                  </h4>
                </div>
                {policies.length === 0 ? (
                  <p className="px-5 pb-4 text-gray-500 text-xs">No policies applied.</p>
                ) : (
                  <div className="divide-y divide-gray-200/60">
                    {policies.map((p, i) => (
                      <PolicyCard key={p.id || i} p={p} i={i} />
                    ))}
                  </div>
                )}
              </div>

              {/* Contracts */}
              <div>
                <div className="px-5 py-2.5 flex items-center justify-between">
                  <h4 className="text-gray-900 text-sm font-semibold">
                    Contracts ({contracts.length})
                  </h4>
                  {contractsLoading && (
                    <RefreshCw size={12} className="animate-spin text-gray-500" />
                  )}
                </div>
                {contractsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
                  </div>
                ) : contracts.length === 0 ? (
                  <p className="px-5 pb-4 text-gray-500 text-xs">No contracts found.</p>
                ) : (
                  <div className="divide-y divide-gray-200/60">
                    {contracts.map((c, i) => (
                      <ContractCard
                        key={c.id || i}
                        c={c}
                        i={i}
                        onUpdateContract={updateContractStatus}
                        onDeleteContract={deleteContract}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Empty state — no API selected */
            <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
              <ShieldCheck size={32} className="text-gray-500 mb-3" />
              <p className="text-gray-500 text-sm">Select an API instance to view details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
