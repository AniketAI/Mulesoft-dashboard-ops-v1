import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation } from 'react-router-dom';
import {
  Search, Package, RefreshCw, ExternalLink, ChevronLeft, ChevronRight,
  Globe, FileText, Tag, User, Calendar, Link2, SlidersHorizontal, Activity,
  Code2, Copy, Check, AlertTriangle,
} from 'lucide-react';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import api from '../services/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ASSET_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'rest-api', label: 'REST API' },
  { value: 'soap-api', label: 'SOAP API' },
  { value: 'http-api', label: 'HTTP API' },
  { value: 'mule-application', label: 'Mule Application' },
  { value: 'mule-plugin', label: 'Connector / Plugin' },
  { value: 'template', label: 'Template' },
  { value: 'example', label: 'Example' },
];

const typeColor = (type) => ({
  'rest-api':          'bg-blue-100 text-blue-600',
  'soap-api':          'bg-purple-100 text-purple-600',
  'http-api':          'bg-cyan-100 text-cyan-600',
  'mule-application':  'bg-green-100 text-green-600',
  'mule-plugin':       'bg-orange-100 text-orange-600',
  template:            'bg-yellow-100 text-yellow-600',
  example:             'bg-pink-100 text-pink-600',
}[type] || 'bg-gray-100 text-gray-500');

const METHOD_COLOR = {
  GET:    'bg-blue-50/40 text-blue-700 border-blue-300/40',
  POST:   'bg-green-50/40 text-green-700 border-green-300/40',
  PUT:    'bg-yellow-50/40 text-yellow-700 border-yellow-300/40',
  DELETE: 'bg-red-50/40 text-red-700 border-red-300/40',
  PATCH:  'bg-orange-50/40 text-orange-700 border-orange-300/40',
};

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="text-gray-500 hover:text-gray-900 p-0.5 transition-colors">
      {done ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
    </button>
  );
}

const LIMIT = 100;

// ─── ExchangePage ─────────────────────────────────────────────────────────────

export default function ExchangePage() {
  const { orgId: rootOrgId } = useAuth();
  const location = useLocation();

  // ── BG state ─────────────────────────────────────────────────────────────
  const [allBgs, setAllBgs] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [bgLoading, setBgLoading] = useState(true);
  const [showBgFilter, setShowBgFilter] = useState(false);

  // ── Asset list state ──────────────────────────────────────────────────────
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [assetType, setAssetType] = useState('');
  const [bgFilterVersion, setBgFilterVersion] = useState(0); // eslint-disable-line no-unused-vars
  useEffect(() => {
    const h = () => setBgFilterVersion(v => v + 1);
    window.addEventListener('bgFilterChanged', h);
    return () => window.removeEventListener('bgFilterChanged', h);
  }, []);
  const [offset, setOffset] = useState(0);

  // ── Asset detail state ────────────────────────────────────────────────────
  const [selected, setSelected] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [assetDetail, setAssetDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pingSpec, setPingSpec] = useState(null);
  const [pingSpecLoading, setPingSpecLoading] = useState(false);

  // For navigation from AppDetailPage
  const [pendingAssetId, setPendingAssetId] = useState(null);
  const [pendingGroupId, setPendingGroupId] = useState(null);

  // ── Load BGs ──────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/organizations/business-groups').then(r => {
      const groups = r.data?.data || [];
      setAllBgs(groups);
      const root = groups.find(g => !g.parentId) || groups[0];
      if (root && !location.state?.groupId) setSelectedOrgId(root.id);
    }).catch(() => { setSelectedOrgId(rootOrgId); }).finally(() => setBgLoading(false));
  }, [rootOrgId]);

  // ── Handle navigation state from AppDetailPage ────────────────────────────
  useEffect(() => {
    const state = location.state;
    if (state?.assetId) {
      setPendingAssetId(state.assetId);
      setPendingGroupId(state.groupId || null);
      setSearch(state.assetId);
      if (state.groupId) setSelectedOrgId(state.groupId);
    }
  }, []);

  useEffect(() => {
    if (!bgLoading) { setOffset(0); loadAssets(0); }
  }, [search, assetType, selectedOrgId, bgLoading]);

  // ── Load assets ───────────────────────────────────────────────────────────
  const loadAssets = useCallback(async (off) => {
    setLoading(true);
    try {
      const res = await api.get('/exchange/search', {
        params: { search: search || undefined, type: assetType || undefined,
          organizationId: selectedOrgId || undefined, offset: off, limit: LIMIT }
      });
      const data = res.data;
      const list = Array.isArray(data) ? data : (data.assets || data.data || []);
      setAssets(list);
      setTotal(data.total || list.length);

      if (pendingAssetId && off === 0) {
        const match = list.find(a => a.assetId === pendingAssetId && (!pendingGroupId || a.groupId === pendingGroupId))
          || list.find(a => a.assetId === pendingAssetId)
          || (list.length === 1 ? list[0] : null);
        if (match) { selectAsset(match); setPendingAssetId(null); }
      }
    } catch { setAssets([]); setTotal(0); }
    setLoading(false);
  }, [search, assetType, selectedOrgId, pendingAssetId, pendingGroupId]);

  // ── Select asset + fetch detail & spec ────────────────────────────────────
  const selectAsset = useCallback(async (asset) => {
    setSelected(asset);
    setDetailTab('overview');
    setAssetDetail(null);
    setPingSpec(null);

    // Fetch full asset details
    setDetailLoading(true);
    try {
      const r = await api.get(`/exchange/${asset.groupId}/${asset.assetId}/${asset.version}`);
      setAssetDetail(r.data);
    } catch {}
    setDetailLoading(false);

    // Fetch API spec for REST/HTTP APIs
    if (['rest-api', 'http-api', 'soap-api'].includes(asset.type)) {
      setPingSpecLoading(true);
      try {
        const r = await api.get('/exchange/ping-spec', {
          params: { groupId: asset.groupId, assetId: asset.assetId,
            version: asset.version, orgId: asset.groupId, appName: asset.name || asset.assetId }
        });
        setPingSpec(r.data);
      } catch {}
      setPingSpecLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Filtered BGs (respects BgFilterModal)
  const filteredBgs = applyBgFilter(allBgs);
  const filterActive = filteredBgs.length < allBgs.length;

  const bgOptions = [
    { value: '', label: 'All Organizations', tag: `${filteredBgs.length}`, tagColor: 'bg-gray-200 text-gray-600' },
    ...filteredBgs.map(g => ({
      value: g.id, label: g.name, indent: !!g.parentId,
      tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-100 text-blue-600'
    }))
  ];

  const selectedBgName = allBgs.find(g => g.id === selectedOrgId)?.name
    || (selectedOrgId ? selectedOrgId : 'All Organizations');

  const currentPage = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.ceil(total / LIMIT);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal businessGroups={allBgs} onClose={() => setShowBgFilter(false)} onSaved={() => {}} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Exchange Assets</h1>
          <p className="text-gray-500 text-sm mt-1">
            Browse in <span className="text-blue-600">{selectedBgName}</span>
            {total > 0 && <span className="text-gray-500 ml-1">— {total} total</span>}
          </p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* BG selector */}
        <div className="w-52">
          <Select value={selectedOrgId}
            onChange={v => { setSelectedOrgId(v); setOffset(0); setSelected(null); }}
            options={bgOptions} placeholder="Select organization..."
            searchable={filteredBgs.length > 5} disabled={bgLoading} />
        </div>
        {/* BG Filter button */}
        <button onClick={() => setShowBgFilter(true)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg border transition-all ${
            filterActive ? 'bg-blue-100 border-blue-300/50 text-blue-600' : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'
          }`}>
          <SlidersHorizontal size={12} />
          {filterActive ? `${filteredBgs.length}/${allBgs.length} BGs` : 'Filter BGs'}
        </button>
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500" />
        </div>
        {/* Type filter */}
        <select value={assetType} onChange={e => setAssetType(e.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-blue-500">
          {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={() => { setOffset(0); loadAssets(0); }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 px-3 py-2 rounded-lg transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* ── Asset list (2/5) ─────────────────────────────── */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h3 className="text-gray-900 font-semibold text-sm">
              Assets {total > 0 && (
                <span className="text-gray-500 font-normal text-xs ml-1">
                  ({assets.length}{total > assets.length ? ` of ${total}` : ''})
                </span>
              )}
            </h3>
            {totalPages > 1 && (
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <button onClick={() => { const n = Math.max(0, offset - LIMIT); setOffset(n); loadAssets(n); }}
                  disabled={offset === 0} className="p-1 hover:text-gray-900 disabled:opacity-30">
                  <ChevronLeft size={15} />
                </button>
                <span className="text-xs">{currentPage}/{totalPages}</span>
                <button onClick={() => { const n = offset + LIMIT; setOffset(n); loadAssets(n); }}
                  disabled={currentPage >= totalPages} className="p-1 hover:text-gray-900 disabled:opacity-30">
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20 flex-1">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-500" />
            </div>
          ) : (
            <div className="divide-y divide-gray-200 overflow-y-auto flex-1 max-h-[640px]">
              {assets.map((asset, i) => (
                <button key={`${asset.groupId}-${asset.assetId}-${i}`}
                  onClick={() => selectAsset(asset)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 hover:bg-gray-100/50 text-left transition-colors ${
                    selected?.assetId === asset.assetId && selected?.groupId === asset.groupId
                      ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                  }`}>
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Package size={13} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-gray-900 text-sm font-medium truncate">{asset.name || asset.assetId}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeColor(asset.type)}`}>
                        {asset.type}
                      </span>
                    </div>
                    <p className="text-gray-500 text-[10px] mt-0.5 truncate font-mono">{asset.assetId}</p>
                    {asset.description && (
                      <p className="text-gray-500 text-xs mt-0.5 line-clamp-1">{asset.description}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-500 flex-shrink-0 mt-1">v{asset.version}</span>
                </button>
              ))}
              {assets.length === 0 && (
                <div className="px-4 py-16 text-center text-gray-500 text-sm">
                  No assets found. Try a different search, type, or organization.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Asset Detail panel (3/5) ─────────────────────── */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col min-h-[500px]">
          {!selected ? (
            <div className="flex flex-col items-center justify-center flex-1 py-24 gap-3 text-gray-500 text-sm">
              <Package size={40} className="text-gray-500" />
              <p>Select an asset to view details</p>
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="px-5 py-4 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-gray-900 font-bold text-base">{selected.name || selected.assetId}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${typeColor(selected.type)}`}>
                        {selected.type}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                        selected.status === 'published'
                          ? 'bg-emerald-50/40 text-emerald-600 border-emerald-300/40'
                          : 'bg-yellow-50/40 text-yellow-600 border-yellow-300/40'
                      }`}>{selected.status || 'published'}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="font-mono text-xs text-gray-500">{selected.assetId}</span>
                      <span className="text-gray-500 text-xs">·</span>
                      <span className="text-xs text-gray-500">v{selected.version}</span>
                      {selected.minMuleVersion && (
                        <>
                          <span className="text-gray-500 text-xs">·</span>
                          <span className="text-xs text-gray-500">Min Mule: {selected.minMuleVersion}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <a href={`https://anypoint.mulesoft.com/exchange/${selected.groupId}/${selected.assetId}/`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 flex-shrink-0 border border-blue-200/40 px-2.5 py-1.5 rounded-lg bg-blue-50/20 transition-colors">
                    <ExternalLink size={12} /> Open in Exchange
                  </a>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 mt-3 bg-gray-100/50 rounded-lg p-0.5 w-fit">
                  {[
                    { id: 'overview', label: 'Overview', icon: Globe },
                    ...(['rest-api', 'http-api'].includes(selected.type) ? [{ id: 'api', label: 'API Spec', icon: Code2 }] : []),
                    { id: 'files', label: 'Files', icon: FileText },
                  ].map(t => (
                    <button key={t.id} onClick={() => setDetailTab(t.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        detailTab === t.id ? 'bg-gray-200 text-gray-900 shadow' : 'text-gray-500 hover:text-gray-900'
                      }`}>
                      <t.icon size={11} /> {t.label}
                      {t.id === 'api' && pingSpec?.allEndpoints?.length > 0 && (
                        <span className="bg-blue-500/30 text-blue-700 text-[9px] px-1 rounded">{pingSpec.allEndpoints.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── OVERVIEW tab ────────────────────────────── */}
              {detailTab === 'overview' && (
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {detailLoading && (
                    <div className="flex items-center justify-center py-10 text-gray-500">
                      <RefreshCw size={16} className="animate-spin mr-2" /> Loading details…
                    </div>
                  )}

                  {/* Description */}
                  {(selected.description || assetDetail?.description) && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1.5">Description</p>
                      <p className="text-gray-600 text-sm leading-relaxed">
                        {assetDetail?.description || selected.description}
                      </p>
                    </div>
                  )}

                  {/* Key metadata grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Asset ID', value: selected.assetId, mono: true, copy: true },
                      { label: 'Group ID', value: selected.groupId, mono: true, copy: true },
                      { label: 'Version', value: selected.version },
                      { label: 'Type', value: selected.type },
                      { label: 'Status', value: selected.status || 'published' },
                      { label: 'Min Mule Version', value: selected.minMuleVersion },
                      { label: 'Created By', value: selected.createdBy?.username || assetDetail?.createdBy?.username },
                      { label: 'Created', value: selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : null },
                      { label: 'Updated', value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleDateString() : null },
                    ].filter(r => r.value).map(({ label, value, mono, copy }) => (
                      <div key={label} className="bg-gray-100/40 border border-gray-300/30 rounded-lg px-3 py-2.5">
                        <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold mb-0.5">{label}</p>
                        <div className="flex items-center gap-1">
                          <p className={`text-xs break-all ${mono ? 'font-mono text-gray-600' : 'text-gray-900'}`}>{value}</p>
                          {copy && <CopyBtn text={String(value)} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tags / Labels */}
                  {(selected.labels?.length > 0 || assetDetail?.labels?.length > 0) && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1">
                        <Tag size={10} /> Tags
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(assetDetail?.labels || selected.labels || []).map((l, i) => (
                          <span key={i} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded border border-gray-300/50">{l}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Categories */}
                  {assetDetail?.categories?.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1.5">Categories</p>
                      <div className="flex flex-wrap gap-1.5">
                        {assetDetail.categories.map((c, i) => (
                          <span key={i} className="bg-blue-50/30 text-blue-700 text-xs px-2 py-0.5 rounded border border-blue-200/40">
                            {c.key}: {c.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contact info */}
                  {(assetDetail?.contactName || assetDetail?.contactEmail) && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1.5 flex items-center gap-1">
                        <User size={10} /> Contact
                      </p>
                      <div className="bg-gray-100/40 border border-gray-300/30 rounded-lg px-3 py-2">
                        {assetDetail.contactName && <p className="text-gray-900 text-sm">{assetDetail.contactName}</p>}
                        {assetDetail.contactEmail && <p className="text-blue-600 text-xs">{assetDetail.contactEmail}</p>}
                      </div>
                    </div>
                  )}

                  {/* Portal link */}
                  <div className="pt-2 border-t border-gray-200">
                    <a href={`https://anypoint.mulesoft.com/exchange/${selected.groupId}/${selected.assetId}/${selected.version}/`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-700 transition-colors">
                      <Link2 size={11} /> View full documentation on Exchange
                    </a>
                  </div>
                </div>
              )}

              {/* ── API SPEC tab ─────────────────────────────── */}
              {detailTab === 'api' && (
                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {pingSpecLoading && (
                    <div className="flex items-center justify-center py-10 text-gray-500">
                      <RefreshCw size={16} className="animate-spin mr-2" /> Fetching API spec…
                    </div>
                  )}

                  {!pingSpecLoading && pingSpec && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-gray-900 text-sm font-semibold">{pingSpec.assetName}</p>
                          <p className="text-gray-500 text-xs mt-0.5">
                            {pingSpec.specType?.toUpperCase()} · {pingSpec.allEndpoints?.length ?? 0} endpoints
                            {pingSpec.pingEndpoints?.length > 0 && (
                              <span className="ml-2 text-emerald-600 font-medium">· {pingSpec.pingEndpoints.length} ping/health endpoints</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {pingSpec.allEndpoints?.length > 0 ? (
                        <div className="space-y-1.5">
                          {pingSpec.allEndpoints.map((ep, i) => {
                            const isPing = pingSpec.pingEndpoints?.some(p => p.path === ep.path && p.method === ep.method);
                            return (
                              <div key={i} className={`rounded-lg border px-3 py-2.5 ${isPing ? 'bg-emerald-50/15 border-emerald-200/40' : 'bg-gray-100/40 border-gray-300/30'}`}>
                                <div className="flex items-center gap-2.5 flex-wrap">
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${METHOD_COLOR[ep.method] || 'bg-gray-100/60 text-gray-600 border-gray-300/40'}`}>
                                    {ep.method}
                                  </span>
                                  <span className={`font-mono text-xs ${isPing ? 'text-emerald-700' : 'text-gray-700'}`}>{ep.path}</span>
                                  {isPing && <span className="text-[9px] text-emerald-500 font-medium">● health</span>}
                                  {ep.description && <span className="text-gray-500 text-[10px] ml-auto truncate max-w-xs">{ep.description}</span>}
                                </div>
                                {ep.queryParams?.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                    <span className="text-[9px] text-gray-500 uppercase font-bold">Query:</span>
                                    {ep.queryParams.map(p => (
                                      <span key={p.name} title={p.description}
                                        className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${
                                          p.required ? 'bg-orange-50/30 text-orange-700 border-orange-300/40'
                                                     : 'bg-gray-100/60 text-gray-500 border-gray-300/40'
                                        }`}>
                                        {p.name}{p.required ? '*' : ''}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : !pingSpecLoading && (
                        <div className="flex items-start gap-3 bg-gray-100/40 border border-gray-300/30 rounded-xl px-4 py-3">
                          <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                          <p className="text-gray-500 text-xs">
                            No endpoints found in spec. The backend server may need to be restarted to apply the latest spec parsing fixes.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── FILES tab ────────────────────────────────── */}
              {detailTab === 'files' && (
                <div className="overflow-y-auto flex-1 p-5 space-y-3">
                  {detailLoading ? (
                    <div className="flex items-center justify-center py-10 text-gray-500">
                      <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
                    </div>
                  ) : (assetDetail?.files?.length > 0) ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Available Files</p>
                      {assetDetail.files.map((f, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-100/40 border border-gray-300/30 rounded-lg px-3 py-2.5">
                          <div>
                            <p className="text-gray-900 text-xs font-medium">{f.classifier || f.packaging || '—'}</p>
                            <p className="text-gray-500 text-[10px] font-mono">{f.packaging}</p>
                          </div>
                          {f.externalLink && (
                            <a href={f.externalLink} target="_blank" rel="noreferrer"
                              className="text-blue-600 hover:text-blue-700 text-[10px] flex items-center gap-1 border border-blue-200/40 px-2 py-1 rounded bg-blue-50/20">
                              <ExternalLink size={10} /> Download
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm text-center py-8">No file information available</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
