import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { GitCompare, RefreshCw, Search, Copy, Check, Download, ArrowLeftRight, AlertTriangle, SlidersHorizontal, Key, X, Eye, EyeOff, ClipboardCopy } from 'lucide-react';
import Select from '../components/Select';
import BgFilterModal, { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import CpsCredentialImportButton from '../components/CpsCredentialImportButton';
import api from '../services/api';
import { getCachedSWR, setCached } from '../services/apiCache';
import { CK } from '../services/cacheKeys';
import { flattenCpsResponse } from '../utils/cpsHelpers';
import { ENV_BADGE } from '../utils/appUtils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCpsProps(appDetail) {
  if (!appDetail) return {};
  const ds = appDetail.target?.deploymentSettings || {};
  const appCfg = appDetail.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const allProps = { ...appDetail.properties, ...runtimeProps, ...ds.properties, ...envVars };
  return {
    cpsBaseUrl:  allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'] || '',
    cpsKey:      allProps['cps.projectName']          || allProps['cloudhub.api.name']       || appDetail.name || '',
    cpsEnv:      allProps['cps.prefix']               || allProps['cps.environment']          || '',
    // CPS client ID — secret resolved from the imported CSV
    cpsClientId: allProps['cps.clientId'] || allProps['cps.client_id'] || allProps['cps.client.id'] || allProps['cps.apiClientId'] || '',
  };
}

const PROP_TYPE_OPTS = [
  { value: 'non-secure', label: 'Non-Secure Properties' },
  { value: 'secure',     label: 'Secure Properties' },
  { value: 'binaries',   label: 'Binary Assets' },
];

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="text-gray-500 hover:text-gray-900 transition-colors p-0.5">
      {done ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
    </button>
  );
}

// ─── Copy Diffs button ───────────────────────────────────────────────────────

function CopyDiffsBtn({ diff, keyA, keyB }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    const diffRows = diff.filter(d => d.status !== 'matching');
    const lines = [`CPS Diff Summary — Side A: ${keyA || 'A'} vs Side B: ${keyB || 'B'}`, `${diffRows.length} difference(s) found`, ''];
    diffRows.forEach(d => {
      lines.push(`[${d.status.toUpperCase()}] ${d.key}`);
      if (d.status === 'different') {
        lines.push(`  A: ${d.valA ?? '(not set)'}`);
        lines.push(`  B: ${d.valB ?? '(not set)'}`);
      } else if (d.status === 'only-a') {
        lines.push(`  A: ${d.valA}`);
        lines.push(`  B: (not present)`);
      } else {
        lines.push(`  A: (not present)`);
        lines.push(`  B: ${d.valB}`);
      }
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border text-purple-600 bg-purple-50/30 border-purple-200/50 hover:bg-purple-50/50 transition-colors">
      {done ? <><Check size={11} className="text-emerald-600" /> Copied!</> : <><ClipboardCopy size={11} /> Copy Diffs</>}
    </button>
  );
}

// ─── Word-level diff highlighter ─────────────────────────────────────────────

function wordDiff(a, b) {
  const wordsA = (a || '').split(/(\s+|[,;:|\/\\])/);
  const wordsB = (b || '').split(/(\s+|[,;:|\/\\])/);
  // Simple diff: mark words that are in A but not B as removed, and vice versa
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  return {
    aTokens: wordsA.map(w => ({ word: w, changed: !setB.has(w) && w.trim() !== '' })),
    bTokens: wordsB.map(w => ({ word: w, changed: !setA.has(w) && w.trim() !== '' })),
  };
}

// ─── Diff Detail Modal ───────────────────────────────────────────────────────

function DiffModal({ row, labelA, labelB, onClose }) {
  if (!row) return null;
  const isOnlyA = row.status === 'only-a';
  const isOnlyB = row.status === 'only-b';
  const isDiff  = row.status === 'different';
  const { aTokens, bTokens } = isDiff ? wordDiff(row.valA, row.valB) : { aTokens: [], bTokens: [] };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white border border-gray-300 rounded-2xl w-full max-w-2xl shadow-2xl mx-4"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Property</p>
            <p className="font-mono text-sm text-gray-900 font-semibold">{row.displayKey}</p>
            {row.groupName && <p className="text-[10px] text-cyan-600/70 mt-0.5">Group: {row.groupName}</p>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Diff body */}
        <div className="px-5 py-4 space-y-4">
          {/* Side A */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isOnlyB ? 'text-gray-500' : 'text-blue-600'}`}>
              Side A — {labelA}
              {isOnlyB && <span className="ml-2 normal-case font-normal text-gray-500">(not set)</span>}
            </p>
            <div className={`rounded-xl px-4 py-3 font-mono text-sm leading-relaxed break-all min-h-[48px] border ${
              isOnlyB ? 'bg-gray-100/30 border-gray-300/30 text-gray-500 italic' :
              isDiff   ? 'bg-red-50/30 border-red-200/40 text-gray-700' :
                         'bg-gray-100/60 border-gray-300/40 text-gray-700'
            }`}>
              {isOnlyB ? '(not present in Side A)' : isDiff ? (
                aTokens.map((t, i) => (
                  <span key={i} className={t.changed ? 'bg-red-200 text-red-800 font-semibold rounded px-0.5' : ''}>
                    {t.word}
                  </span>
                ))
              ) : (row.valA ?? '—')}
            </div>
          </div>

          {/* Side B */}
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${isOnlyA ? 'text-gray-500' : 'text-orange-600'}`}>
              Side B — {labelB}
              {isOnlyA && <span className="ml-2 normal-case font-normal text-gray-500">(not set)</span>}
            </p>
            <div className={`rounded-xl px-4 py-3 font-mono text-sm leading-relaxed break-all min-h-[48px] border ${
              isOnlyA ? 'bg-gray-100/30 border-gray-300/30 text-gray-500 italic' :
              isDiff   ? 'bg-orange-50/30 border-orange-200/40 text-gray-700' :
                         'bg-gray-100/60 border-gray-300/40 text-gray-700'
            }`}>
              {isOnlyA ? '(not present in Side B)' : isDiff ? (
                bTokens.map((t, i) => (
                  <span key={i} className={t.changed ? 'bg-orange-200 text-orange-800 font-semibold rounded px-0.5' : ''}>
                    {t.word}
                  </span>
                ))
              ) : (row.valB ?? '—')}
            </div>
          </div>

          {/* Summary */}
          {isDiff && (
            <div className="flex items-start gap-2 bg-yellow-50/20 border border-yellow-200/40 rounded-xl px-4 py-3 text-xs text-yellow-600/80">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <span>Values differ — highlighted words show what changed between the two sides.</span>
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 py-3 border-t border-gray-200">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const ENV_TAG = { production: 'bg-green-100 text-green-600', sandbox: 'bg-yellow-100 text-yellow-600' };

// ─── MultiAppChecklist ────────────────────────────────────────────────────────

function MultiAppChecklist({ apps, selectedIds, loading, onToggle, onSelectAll, onClearAll, isBlue }) {
  const [localSearch, setLocalSearch] = useState('');
  const filtered = apps.filter(a => !localSearch || a.name.toLowerCase().includes(localSearch.toLowerCase()));
  const selectedSet = new Set(selectedIds);
  const accentText = isBlue ? 'text-blue-600' : 'text-orange-600';
  const accentBg = isBlue ? 'bg-blue-600' : 'bg-orange-600';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider flex items-center gap-1">
          Applications {loading && <RefreshCw size={9} className="animate-spin text-gray-500" />}
          {selectedIds.length > 0 && <span className={`ml-1 font-bold ${accentText}`}>{selectedIds.length} selected</span>}
        </p>
        <div className="flex items-center gap-1.5">
          <button onClick={onSelectAll} className={`text-[9px] ${accentText} hover:opacity-80`}>All</button>
          <span className="text-gray-500 text-[9px]">·</span>
          <button onClick={onClearAll} className="text-[9px] text-gray-500 hover:text-gray-900">Clear</button>
        </div>
      </div>
      {/* Search */}
      <div className="relative">
        <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input value={localSearch} onChange={e => setLocalSearch(e.target.value)} placeholder="Filter apps…"
          className="w-full bg-gray-100 border border-gray-300 rounded-lg pl-6 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-cyan-300/50" />
      </div>
      {/* App list */}
      <div className="max-h-48 overflow-y-auto border border-gray-300/50 rounded-lg divide-y divide-gray-200/30">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-gray-500">
            {apps.length === 0 ? 'Select a BG and Environment first' : 'No apps match'}
          </p>
        ) : filtered.map(a => {
          const compositeId = `${a.id}|${a.environment?.id || ''}|${a._bgId || ''}`;
          const isChecked = selectedSet.has(compositeId);
          const order = selectedIds.indexOf(compositeId) + 1; // 1-based order
          return (
            <button key={compositeId} onClick={() => onToggle(compositeId)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 hover:bg-gray-100/40 transition-colors text-left ${isChecked ? (isBlue ? 'bg-blue-50/20' : 'bg-orange-50/10') : ''}`}>
              <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[9px] font-bold ${isChecked ? `${accentBg} border-transparent text-white` : 'border-gray-300'}`}>
                {isChecked ? order : ''}
              </div>
              <span className={`text-xs font-mono truncate flex-1 ${isChecked ? 'text-gray-900' : 'text-gray-500'}`}>{a.name}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 ${a.deploymentType === 'CloudHub 2.0' ? 'bg-blue-50 text-blue-500' : 'bg-purple-50 text-purple-500'}`}>
                {a.deploymentType === 'CloudHub 2.0' ? 'CH2' : 'CH1'}
              </span>
            </button>
          );
        })}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-[9px] text-gray-500">Numbers show comparison order (1st A paired with 1st B)</p>
      )}
    </div>
  );
}

// ─── SidePanel ────────────────────────────────────────────────────────────────

function SidePanel({ label, color, state, filteredBgs, propType, onPropTypeChange, onUpdate, onLoadEnvs, onLoadApps, onSelectApp, hideAppSelector, collapsed, onToggleCollapse }) {
  const { bgId, envId, envs, apps, appId, loadingEnvs, loadingApps, loadingDetail, cpsUrl, cpsEnv, cpsKey, cpsClientId, cpsClientSecret, credsResolved } = state;
  const [showSecret, setShowSecret] = useState(false);
  const isBlue = color === 'border-blue-300/50';
  const showEnvInLabel = bgId === '__all__' || !envId;
  const bgName = filteredBgs.find(g => g.id === bgId)?.name || (bgId === '__all__' ? 'All BGs' : '—');
  const envName = envs.find(e => e.id === envId)?.name || (envId === '__all__' ? 'All Envs' : '—');
  const selCount = (state.selectedAppIds || []).length;
  const appSummary = hideAppSelector ? (selCount > 0 ? `${selCount} apps selected` : `${apps.length} apps`) : (cpsKey || '—');

  if (collapsed) {
    return (
      <div className={`flex-1 min-w-0 bg-white border ${color} rounded-xl`}>
        <button onClick={onToggleCollapse} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100/20 transition-colors">
          <div className="flex items-center gap-2 min-w-0">
            <p className={`text-xs font-bold uppercase tracking-wider flex-shrink-0 ${isBlue ? 'text-blue-600' : 'text-orange-600'}`}>{label}</p>
            {bgId ? (
              <span className="text-[10px] text-gray-500 truncate">
                {bgName} · {envName}
                {appSummary !== '—' && <span className={`ml-1 font-medium ${isBlue ? 'text-blue-700' : 'text-orange-700'}`}> · {appSummary}</span>}
              </span>
            ) : <span className="text-[10px] text-gray-500">not configured</span>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {credsResolved && <span className="text-[9px] text-emerald-600">🔑</span>}
            <span className="text-gray-500 text-[10px] border border-gray-300 rounded px-1.5 py-0.5 bg-gray-100">▼ Edit</span>
          </div>
        </button>
      </div>
    );
  }

  const bgOptions = [
    { value: '__all__', label: 'All Organizations', tag: `${filteredBgs.length}`, tagColor: 'bg-gray-200 text-gray-600' },
    ...filteredBgs.map(g => ({ value: g.id, label: g.name, tag: !g.parentId ? 'Root' : undefined, tagColor: 'bg-blue-100 text-blue-600', indent: !!g.parentId })),
  ];

  const visibleEnvs = applyEnvFilter(envs);
  const envOptions = [
    { value: '__all__', label: 'All Environments' },
    ...visibleEnvs.map(e => ({ value: e.id, label: e.name, badge: true, badgeColor: ENV_BADGE[e.type] || 'bg-gray-400', tag: e.type, tagColor: ENV_TAG[e.type] || 'bg-gray-200 text-gray-500' })),
  ];

  // App options: when showing all, include env name in label for disambiguation
  const appOptions = apps.map(a => ({
    value: `${a.id}|${a.environment?.id || ''}|${a._bgId || ''}`,
    label: showEnvInLabel ? `${a.name} (${a.environment?.name || ''})` : a.name,
    tag: a.deploymentType === 'CloudHub 2.0' ? 'CH2' : 'CH1',
    tagColor: a.deploymentType === 'CloudHub 2.0' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600',
  }));

  return (
    <div className={`flex-1 min-w-0 bg-white border ${color} rounded-xl p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <p className={`text-xs font-bold uppercase tracking-wider ${isBlue ? 'text-blue-600' : 'text-orange-600'}`}>{label}</p>
        <div className="flex items-center gap-2">
          {credsResolved && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-300/40 px-1.5 py-0.5 rounded">
              <Key size={8} /> CPS creds
            </span>
          )}
          <button onClick={onToggleCollapse} className="text-[10px] text-gray-500 hover:text-gray-900 border border-gray-300 rounded px-1.5 py-0.5 bg-gray-100/60 transition-colors">
            ▲ Collapse
          </button>
        </div>
      </div>

      {/* Property type tabs — per-side selection */}
      <div className="flex gap-1">
        {PROP_TYPE_OPTS.map(opt => (
          <button key={opt.value} onClick={() => onPropTypeChange(opt.value)}
            className={`flex-1 text-[10px] py-1 px-1.5 rounded-lg border font-medium transition-all text-center ${
              propType === opt.value
                ? (isBlue ? 'bg-blue-100 border-blue-300/50 text-blue-700' : 'bg-orange-100 border-orange-300/50 text-orange-700')
                : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'
            }`}>
            {opt.value === 'non-secure' ? 'Non-Secure' : opt.value === 'secure' ? 'Secure' : 'Binaries'}
          </button>
        ))}
      </div>

      {/* BG — includes "All Organizations" option */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Business Group</p>
        <Select
          value={bgId}
          onChange={v => {
            onUpdate({ bgId: v, envId: '__all__', appId: '', envs: [], apps: [], cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false });
            onLoadEnvs(v);
            onLoadApps(v, '__all__');
          }}
          options={bgOptions}
          placeholder="Select Business Group…"
          searchable
        />
      </div>

      {/* Env — optional; "All Environments" triggers loading all apps */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
          Environment {loadingEnvs && <RefreshCw size={9} className="animate-spin text-gray-500" />}
        </p>
        <Select
          value={envId || '__all__'}
          onChange={v => { onUpdate({ envId: v, appId: '', apps: [], cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false }); onLoadApps(bgId, v); }}
          options={envOptions}
          placeholder="All Environments"
          disabled={!bgId}
          searchable
        />
      </div>

      {/* App selector: single dropdown (1 App mode) or multi-select checklist (All Apps mode) */}
      {!hideAppSelector ? (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
            Application {loadingApps && <RefreshCw size={9} className="animate-spin text-gray-500" />}
            {loadingDetail && <span className="text-[9px] text-cyan-600 ml-1">Resolving CPS config…</span>}
            {apps.length > 0 && <span className="text-[9px] text-gray-500 ml-auto">{apps.length} apps</span>}
          </p>
          <Select
            value={appId}
            onChange={v => onSelectApp(v)}
            options={appOptions}
            placeholder={bgId ? 'Search application…' : 'Select a BG first…'}
            disabled={!bgId}
            searchable
          />
        </div>
      ) : (
        <MultiAppChecklist
          apps={apps}
          selectedIds={state.selectedAppIds || []}
          loading={loadingApps}
          onToggle={(compositeId) => {
            const current = state.selectedAppIds || [];
            const next = current.includes(compositeId)
              ? current.filter(id => id !== compositeId)
              : [...current, compositeId];
            onUpdate({ selectedAppIds: next });
          }}
          onSelectAll={() => onUpdate({ selectedAppIds: appOptions.map(a => a.value) })}
          onClearAll={() => onUpdate({ selectedAppIds: [] })}
          isBlue={isBlue}
        />
      )}

      {/* CPS config — auto-filled, editable */}
      <div className="pt-2 border-t border-gray-200/60 space-y-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">CPS Configuration (auto-filled)</p>
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">CPS Base URL</label>
          <input value={cpsUrl} onChange={e => onUpdate({ cpsUrl: e.target.value })} placeholder="https://cps-server.api.sfdcbt.net"
            className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 placeholder-gray-400" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">CPS Environment</label>
            <input value={cpsEnv} onChange={e => onUpdate({ cpsEnv: e.target.value })} placeholder="prod / uat"
              className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 placeholder-gray-400" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Project Key</label>
            <input value={cpsKey} onChange={e => onUpdate({ cpsKey: e.target.value })} placeholder="my-api-name"
              className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 placeholder-gray-400" />
          </div>
        </div>
        {/* CPS Credentials — shown after auto-resolve; editable for override */}
        <div className="pt-1 border-t border-gray-200/40 space-y-1.5">
          <p className="text-[10px] text-gray-500 flex items-center gap-1"><Key size={8} /> CPS Credentials (auto-resolved · override if needed)</p>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Client ID</label>
            <input value={cpsClientId} onChange={e => onUpdate({ cpsClientId: e.target.value, credsResolved: !!e.target.value })} placeholder="auto-resolved"
              className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 placeholder-gray-400" />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-0.5">Client Secret</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={cpsClientSecret}
                onChange={e => onUpdate({ cpsClientSecret: e.target.value })}
                placeholder="auto-resolved"
                className="w-full bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 pr-8 text-xs text-gray-700 font-mono focus:outline-none focus:border-cyan-300/50 placeholder-gray-400"
              />
              <button onClick={() => setShowSecret(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-900">
                {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const INIT_SIDE = { bgId: '', envId: '__all__', envs: [], apps: [], appId: '', selectedAppIds: [], loadingEnvs: false, loadingApps: false, loadingDetail: false, cpsUrl: '', cpsEnv: '', cpsKey: '', cpsClientId: '', cpsClientSecret: '', credsResolved: false };

export default function CpsComparisonPage() {
  const { getSecret, hasCredentials, getAllCredentials } = useCpsCredentialStore();
  const [allBgs, setAllBgs] = useState([]);
  const [showBgFilter, setShowBgFilter] = useState(false);
  // ── Env filter version ────────────────────────────────────────────────────
  // Increments when the Env Filter modal saves — causes SidePanel to re-render
  // and call applyEnvFilter(envs) with the fresh localStorage value.
  const [envFilterVer, setEnvFilterVer] = useState(0); // eslint-disable-line no-unused-vars
  const [bgFilterVer, setBgFilterVer] = useState(0); // eslint-disable-line no-unused-vars
  useEffect(() => {
    const h = () => setEnvFilterVer(v => v + 1);
    window.addEventListener('envFilterChanged', h);
    return () => window.removeEventListener('envFilterChanged', h);
  }, []);
  useEffect(() => {
    const h = () => setBgFilterVer(v => v + 1);
    window.addEventListener('bgFilterChanged', h);
    return () => window.removeEventListener('bgFilterChanged', h);
  }, []);
  const [compareMode, setCompareMode] = useState('single'); // 'single' | 'multi'
  // Each side has its own property type
  const [propTypeA, setPropTypeA] = useState('non-secure');
  const [propTypeB, setPropTypeB] = useState('non-secure');
  const [sideA, setSideA] = useState({ ...INIT_SIDE });
  const [sideB, setSideB] = useState({ ...INIT_SIDE });
  const [comparing, setComparing] = useState(false);
  const [compareProgress, setCompareProgress] = useState({ done: 0, total: 0 });
  // Multi-app results: array of { appName, diff[], stats, error }
  const [multiResults, setMultiResults] = useState([]);
  const [expandedApps, setExpandedApps] = useState(new Set());
  // Single-app comparison results
  const [propsA, setPropsA] = useState(null);
  const [propsB, setPropsB] = useState(null);
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showDiffsOnly, setShowDiffsOnly] = useState(false);
  const [diffRow, setDiffRow] = useState(null);
  const [collapsedA, setCollapsedA] = useState(false);
  const [collapsedB, setCollapsedB] = useState(false);

  // Load BGs on mount and default to "All Organizations"
  useEffect(() => {
    api.get('/organizations/business-groups')
      .then(r => {
        const bgs = r.data.data || [];
        setAllBgs(bgs);
        // Default both sides to "All Organizations"
        setSideA(prev => ({ ...prev, bgId: '__all__' }));
        setSideB(prev => ({ ...prev, bgId: '__all__' }));
        // Load apps for all BGs on mount — pass fresh bgs directly
        // (allBgs state won't be set yet when these run)
        loadApps('A', '__all__', '__all__', bgs);
        loadApps('B', '__all__', '__all__', bgs);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSide = useCallback((side, updates) => {
    (side === 'A' ? setSideA : setSideB)(prev => ({ ...prev, ...updates }));
  }, []);

  const loadEnvs = useCallback(async (side, bgId) => {
    // '__all__' is not a real org — skip the environments fetch entirely
    if (!bgId || bgId === '__all__') {
      updateSide(side, { loadingEnvs: false, envs: [] });
      return;
    }
    updateSide(side, { loadingEnvs: true, envs: [] });
    try {
      const r = await api.get(`/environments/${bgId}`);
      updateSide(side, { envs: r.data.data || [], loadingEnvs: false });
    } catch {
      updateSide(side, { loadingEnvs: false });
    }
  }, [updateSide]);

  const loadApps = useCallback(async (side, bgId, envId, bgsOverride) => {
    if (!bgId) return;
    updateSide(side, { loadingApps: true, apps: [] });
    try {
      // Use bgsOverride when called on mount (before allBgs state has updated)
      const visible = applyBgFilter(bgsOverride || allBgs);
      // Determine which BG IDs to fetch from
      const bgIds = bgId === '__all__'
        ? (visible.length > 0 ? visible.map(g => g.id) : [])
        : [bgId];

      if (bgIds.length === 0) { updateSide(side, { loadingApps: false }); return; }

      // ── Frontend cache — SWR (reuse warm data, bg refresh when stale) ────────
      const cacheKey = CK.appsAll(bgIds);
      const swr = getCachedSWR(cacheKey);
      if (swr) {
        const envFiltered = (envId && envId !== '__all__')
          ? (swr.data.apps || []).filter(a => a.environment?.id === envId)
          : (swr.data.apps || []);
        updateSide(side, { apps: envFiltered, loadingApps: false });
        // If stale, silently re-fetch in background and update the side
        if (swr.stale) {
          Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`)))
            .then(results => {
              const fresh = [];
              const seen = new Set();
              results.forEach((r, i) => {
                if (r.status === 'fulfilled') {
                  (r.value.data.data || []).forEach(a => {
                    const k = `${a.id}|${a.environment?.id || ''}`;
                    if (!seen.has(k)) { seen.add(k); fresh.push({ ...a, _bgId: bgIds[i] }); }
                  });
                }
              });
              setCached(cacheKey, { apps: fresh, envs: [] }, 3 * 60 * 1000);
              const freshFiltered = (envId && envId !== '__all__')
                ? fresh.filter(a => a.environment?.id === envId)
                : fresh;
              updateSide(side, { apps: freshFiltered });
            })
            .catch(() => {});
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────

      const results = await Promise.allSettled(bgIds.map(id => api.get(`/applications/summary/${id}`)));
      const mergedAll = [];
      const seen = new Set();
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          (r.value.data.data || []).forEach(a => {
            const key = `${a.id}|${a.environment?.id || ''}`;
            if (!seen.has(key)) { seen.add(key); mergedAll.push({ ...a, _bgId: bgIds[i] }); }
          });
        }
      });
      // Store all (unfiltered) in cache with 3-min freshness window
      setCached(cacheKey, { apps: mergedAll, envs: [] }, 3 * 60 * 1000);
      const merged = (envId && envId !== '__all__')
        ? mergedAll.filter(a => a.environment?.id === envId)
        : mergedAll;
      updateSide(side, { apps: merged, loadingApps: false });
    } catch {
      updateSide(side, { loadingApps: false });
    }
  }, [allBgs, updateSide]);

  const selectApp = useCallback(async (side, compositeId) => {
    const sideState = side === 'A' ? sideA : sideB;
    // compositeId = "appId|envId|bgId"
    const [appId, envId, bgId] = compositeId.split('|');
    const app = sideState.apps.find(a =>
      String(a.id) === appId &&
      (a.environment?.id === envId || !envId) &&
      (a._bgId === bgId || !bgId)
    ) || sideState.apps.find(a => String(a.id) === appId);
    if (!app) return;

    const resolvedBgId = bgId || app._bgId || sideState.bgId;
    const resolvedEnvId = envId || app.environment?.id || sideState.envId;

    updateSide(side, { appId: compositeId, loadingDetail: true, cpsUrl: '', cpsEnv: '', cpsKey: '', credsResolved: false });
    try {
      let detail;
      if (app.deploymentType === 'CloudHub 2.0') {
        const r = await api.get(`/applications/cloudhub2/${resolvedBgId}/${resolvedEnvId}/${app.id}`);
        detail = r.data;
      } else {
        const r = await api.get(`/applications/cloudhub1/${resolvedEnvId}/${app.id}`, { params: { orgId: resolvedBgId } });
        detail = { name: app.name, properties: r.data.properties || {} };
      }
      const extracted = extractCpsProps(detail);

      // Auto-resolve CPS credentials from the imported CPS CSV
      // Strategy 1: specific cpsClientId (skip if masked as ****)
      // Strategy 2: store ALL CSV credentials so backend can try each on 401
      let credsResolved = false;
      if (extracted.cpsBaseUrl && hasCredentials) {
        const normBase = extracted.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
        const isMasked = v => !v || /^\*+$/.test(v.trim());

        if (extracted.cpsClientId && !isMasked(extracted.cpsClientId)) {
          // Strategy 1: exact clientId match from CSV
          const clientSecret = getSecret(extracted.cpsClientId);
          if (clientSecret) {
            try {
              await api.post('/cps/credentials', {
                credentials: { [`${normBase}::${resolvedBgId}`]: { clientId: extracted.cpsClientId, clientSecret } }
              });
              credsResolved = true;
            } catch { /* non-fatal */ }
          }
        }

        if (!credsResolved) {
          // Strategy 2: post each credential under url::clientId (unique per cred).
          // Do NOT overwrite url::bgOrgId — backend's 401-retry + getCredentials step 2b
          // will try each url::clientId* entry and promote the correct one to url::bgOrgId.
          const allCreds = getAllCredentials();
          if (allCreds.length > 0) {
            const credMap = {};
            for (const { clientId, clientSecret } of allCreds) {
              credMap[`${normBase}::${clientId}`] = { clientId, clientSecret };
            }
            try { await api.post('/cps/credentials', { credentials: credMap }); } catch {}
            credsResolved = true;
          }
        }
      }

      // Store the resolved client ID so the user can see/override it.
      // For masked cpsClientId: leave fields empty so fetchSide doesn't
      // overwrite the backend's auto-discovered (promoted) correct credential.
      let resolvedClientId = '';
      let resolvedClientSecret = '';
      if (extracted.cpsClientId && hasCredentials) {
        const isMasked = v => !v || /^\*+$/.test(v.trim());
        if (!isMasked(extracted.cpsClientId)) {
          // Strategy 1 exact match — show the known credential
          const secret = getSecret(extracted.cpsClientId);
          if (secret) { resolvedClientId = extracted.cpsClientId; resolvedClientSecret = secret; }
        }
        // If masked or not found in CSV, leave empty — backend will discover via step 2b retry
      }

      updateSide(side, {
        loadingDetail: false,
        cpsUrl: extracted.cpsBaseUrl,
        cpsEnv: extracted.cpsEnv,
        cpsKey: extracted.cpsKey,
        cpsClientId: resolvedClientId,
        cpsClientSecret: resolvedClientSecret,
        credsResolved,
      });
    } catch {
      updateSide(side, { loadingDetail: false });
    }
  }, [sideA, sideB, updateSide, hasCredentials, getSecret]);

  // ─── Multi-app compare ───────────────────────────────────────────────────────

  /** Build a diff array from two flat {k:v} maps */
  function buildDiff(a, b) {
    const allKeys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();
    return allKeys.map(key => {
      const valA = key in (a || {}) ? String(a[key] ?? '') : null;
      const valB = key in (b || {}) ? String(b[key] ?? '') : null;
      const status = valA === null ? 'only-b' : valB === null ? 'only-a' : valA === valB ? 'matching' : 'different';
      const hasGroup = key.includes('::');
      const [groupName, displayKey] = hasGroup ? key.split('::') : ['', key];
      return { key, displayKey: hasGroup ? displayKey : key, groupName, valA, valB, status };
    });
  }

  const compareAll = async () => {
    if (!sideA.bgId || !sideB.bgId) return;
    setComparing(true);
    setMultiResults([]);
    setPropsA(null); setPropsB(null);
    setErrorA(''); setErrorB('');

    // 1. Get selected apps from each side (in selection order)
    const getSelectedApps = (side) => {
      const ids = side.selectedAppIds || [];
      if (ids.length > 0) {
        // Return in the order user selected them
        return ids.map(compositeId => {
          const [appId, envId, bgId] = compositeId.split('|');
          return side.apps.find(a =>
            String(a.id) === appId &&
            (a.environment?.id === envId || !envId) &&
            (a._bgId === bgId || !bgId)
          );
        }).filter(Boolean);
      }
      // No selection → use all apps
      return side.apps;
    };

    const appsA = getSelectedApps(sideA);
    const appsB = getSelectedApps(sideB);

    // 2. Pair apps positionally (1st A with 1st B, etc.)
    //    If sides have different counts, unpaired apps have no counterpart.
    const maxLen = Math.max(appsA.length, appsB.length);
    const pairs = Array.from({ length: maxLen }, (_, i) => ({
      appA: appsA[i] || null,
      appB: appsB[i] || null,
    })).filter(p => p.appA || p.appB); // at least one side must have an app

    const total = pairs.length;
    setCompareProgress({ done: 0, total });

    // 3. Helper to fetch CPS props for one app
    const fetchAppCps = async (app, bgId, propTypeForSide) => {
      if (!app) return null;
      const resolvedBgId = bgId || app._bgId;
      const resolvedEnvId = app.environment?.id;
      if (!resolvedBgId || !resolvedEnvId) return null;
      try {
        let detail;
        if (app.deploymentType === 'CloudHub 2.0') {
          const r = await api.get(`/applications/cloudhub2/${resolvedBgId}/${resolvedEnvId}/${app.id}`);
          detail = r.data;
        } else {
          const r = await api.get(`/applications/cloudhub1/${resolvedEnvId}/${app.id}`, { params: { orgId: resolvedBgId } });
          detail = { name: app.name, properties: r.data.properties || {} };
        }
        const extracted = extractCpsProps(detail);
        if (!extracted.cpsBaseUrl || !extracted.cpsKey) return null;

        // Auto-save CPS creds if available from CSV
        if (extracted.cpsClientId && hasCredentials) {
          const secret = getSecret(extracted.cpsClientId);
          if (secret) {
            try {
              const credKey = `${extracted.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${resolvedBgId}`;
              await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: extracted.cpsClientId, clientSecret: secret } } });
            } catch {}
          }
        }

        const baseP = { baseUrl: extracted.cpsBaseUrl, environment: extracted.cpsEnv || undefined, bgOrgId: resolvedBgId };
        const pt = propTypeForSide;

        if (pt === 'non-secure') {
          const r = await api.get('/cps/fetch', { params: { ...baseP, type: 'non-secure', keys: extracted.cpsKey } });
          return flattenCpsResponse(r.data);
        }
        // secure/binaries: get non-secure first to discover keys
        const nsR = await api.get('/cps/fetch', { params: { ...baseP, type: 'non-secure', keys: extracted.cpsKey } });
        const nsFlat = flattenCpsResponse(nsR.data);

        if (pt === 'secure') {
          const secKeys = (nsFlat['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean).sort();
          if (!secKeys.length) return {};
          const r = await api.get('/cps/fetch', { params: { ...baseP, type: 'secure', keys: secKeys.join(',') } });
          const raw = r.data;
          const groups = Array.isArray(raw?.responses) ? raw.responses : Array.isArray(raw) ? raw : [];
          const map = {};
          [...groups].sort((a, b) => (a.key || '').localeCompare(b.key || '')).forEach(g => {
            Object.keys(g.properties || {}).sort().forEach(k => { map[`${g.key}::${k}`] = String(g.properties[k] ?? ''); });
          });
          return map;
        }

        if (pt === 'binaries') {
          const binKeys = (nsFlat['cps.secure.binaries'] || '').split(',').map(k => k.trim()).filter(Boolean).sort();
          if (!binKeys.length) return {};
          const r = await api.get('/cps/fetch', { params: { ...baseP, type: 'binaries', keys: binKeys.join(',') } });
          const binData = r.data?.binaries || r.data || [];
          const map = {};
          (Array.isArray(binData) ? binData : []).forEach(b => {
            const fn = b.key || b.name || '?';
            const gn = binKeys.find(g => fn.startsWith(g) || fn.includes(g)) || binKeys[0] || 'binaries';
            map[`${gn}::${fn}`] = b.size != null ? `${b.contentType || 'binary'} (${b.size} bytes)` : 'present';
          });
          return map;
        }
        return {};
      } catch { return null; }
    };

    // 4. Process in batches of 5
    const BATCH = 5;
    const results = [];
    for (let i = 0; i < pairs.length; i += BATCH) {
      const batch = pairs.slice(i, i + BATCH);
      const batchRes = await Promise.allSettled(
        batch.map(async ({ appA, appB }) => {
          const [mA, mB] = await Promise.allSettled([
            fetchAppCps(appA, sideA.bgId, propTypeA),
            fetchAppCps(appB, sideB.bgId, propTypeB),
          ]);
          const prA = mA.status === 'fulfilled' ? mA.value : null;
          const prB = mB.status === 'fulfilled' ? mB.value : null;
          const d = buildDiff(prA, prB);
          return {
            appName: appA.name,
            appB: appB?.name || null,
            diff: d,
            stats: {
              total: d.length,
              different: d.filter(x => x.status === 'different').length,
              'only-a': d.filter(x => x.status === 'only-a').length,
              'only-b': d.filter(x => x.status === 'only-b').length,
              matching: d.filter(x => x.status === 'matching').length,
            },
            errorA: mA.status === 'rejected' ? mA.reason?.message : (!prA ? 'No CPS config found' : null),
            errorB: mB.status === 'rejected' ? mB.reason?.message : (!prB ? appB ? 'No CPS config found' : 'Not in Side B' : null),
          };
        })
      );
      batchRes.forEach(r => { if (r.status === 'fulfilled') results.push(r.value); });
      setCompareProgress(p => ({ ...p, done: Math.min(i + BATCH, pairs.length) }));
    }

    setMultiResults(results);
    setComparing(false);
    setCollapsedA(true);
    setCollapsedB(true);
  };

  // Swap sides
  const swapSides = () => {
    setSideA({ ...sideB });
    setSideB({ ...sideA });
    setPropsA(propsB);
    setPropsB(propsA);
    setErrorA(errorB);
    setErrorB(errorA);
  };

  // Filtered BGs (respects BG filter modal)
  const filteredBgs = applyBgFilter(allBgs);
  const filterActive = filteredBgs.length < allBgs.length;

  // Compare — each side uses its own propType
  const compare = async () => {
    setComparing(true);
    setPropsA(null); setPropsB(null);
    setErrorA(''); setErrorB('');

    /**
     * Fetch CPS properties for one side.
     *
     * For non-secure: direct fetch, flatten to {key: value} map.
     *
     * For secure / binaries: the keys are NOT known up-front — they live inside
     * the non-secure response as:
     *   cps.secure.properties  →  comma-separated list of keys for secure fetch
     *   cps.secure.binaries    →  comma-separated list of keys for binary fetch
     *
     * So we always fetch non-secure first, extract those key lists, then fetch
     * the requested type using the discovered keys.
     */
    const fetchSide = async (s, pt) => {
      if (!s.cpsUrl || !s.cpsKey) throw new Error('CPS URL and project key are required');

      // Re-post credentials if user manually provided clientId/secret.
      // Post under url::clientId (NOT url::bgOrgId) so we never overwrite
      // the backend's promoted correct credential from the step-2b retry.
      if (s.cpsClientId && s.cpsClientSecret) {
        try {
          const normBase = s.cpsUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
          await api.post('/cps/credentials', {
            credentials: {
              [`${normBase}::${s.cpsClientId}`]: { clientId: s.cpsClientId, clientSecret: s.cpsClientSecret },
            }
          });
        } catch { /* non-fatal */ }
      }

      const baseParams = {
        baseUrl: s.cpsUrl,
        environment: s.cpsEnv || undefined,
        bgOrgId: (s.bgId && s.bgId !== '__all__') ? s.bgId : undefined,
      };

      if (pt === 'non-secure') {
        const r = await api.get('/cps/fetch', { params: { ...baseParams, type: 'non-secure', keys: s.cpsKey } });
        return flattenCpsResponse(r.data);
      }

      // For secure or binaries — first fetch non-secure to discover the sub-keys
      const nsR = await api.get('/cps/fetch', { params: { ...baseParams, type: 'non-secure', keys: s.cpsKey } });
      const nsFlat = flattenCpsResponse(nsR.data);

      if (pt === 'secure') {
        const secureKeysRaw = nsFlat['cps.secure.properties'] || '';
        if (!secureKeysRaw.trim()) return {};

        // Sort group names alphabetically — ensures both sides produce identical
        // groupName prefixes even if cps.secure.properties lists them in different order.
        const groupNames = secureKeysRaw.split(',').map(k => k.trim()).filter(Boolean).sort();
        const r = await api.get('/cps/fetch', { params: { ...baseParams, type: 'secure', keys: groupNames.join(',') } });
        const raw = r.data;

        // Normalize response to array of { key, properties }
        const groups = Array.isArray(raw?.responses) ? raw.responses
          : Array.isArray(raw?.properties) ? raw.properties
          : Array.isArray(raw) ? raw : [];

        const map = {};
        if (groups.length > 0) {
          // Sort groups by key for consistent ordering between sides
          [...groups].sort((a, b) => (a.key || '').localeCompare(b.key || '')).forEach(g => {
            const gKey = g.key || 'unknown';
            // Sort property keys within each group for consistent ordering
            Object.keys(g.properties || {}).sort().forEach(k => {
              map[`${gKey}::${k}`] = String(g.properties[k] ?? '');
            });
          });
        } else {
          const flat = flattenCpsResponse(raw);
          const prefix = groupNames[0] || 'secure';
          Object.keys(flat).sort().forEach(k => {
            map[`${prefix}::${k}`] = String(flat[k] ?? '');
          });
        }
        return map;
      }

      if (pt === 'binaries') {
        const binaryKeysRaw = nsFlat['cps.secure.binaries'] || '';
        if (!binaryKeysRaw.trim()) return {};

        // Sort group names alphabetically so both sides use identical group prefixes
        const groupNames = binaryKeysRaw.split(',').map(k => k.trim()).filter(Boolean).sort();
        // Build a set for fast group lookup
        const groupSet = new Set(groupNames);

        const r = await api.get('/cps/fetch', { params: { ...baseParams, type: 'binaries', keys: groupNames.join(',') } });
        const binData = r.data?.binaries || r.data || [];

        // Binaries: use "groupName::fileName" as the key.
        // Priority for group resolution:
        //   1. b.groupKey (explicit from API)
        //   2. A groupName that matches the file's key/name exactly
        //   3. A groupName that is a prefix of the filename
        //   4. A groupName that the filename contains
        //   5. Sort-stable first groupName as fallback
        const resolveGroup = (fileName) => {
          if (groupSet.has(fileName)) return fileName;
          const exactPrefix = groupNames.find(g => fileName.startsWith(g + '-') || fileName.startsWith(g + '.') || fileName.startsWith(g + '_'));
          if (exactPrefix) return exactPrefix;
          const contains = groupNames.find(g => fileName.includes(g));
          if (contains) return contains;
          return groupNames[0] || 'binaries';
        };

        const map = {};
        (Array.isArray(binData) ? binData : [])
          .sort((a, b) => (a.key || a.name || '').localeCompare(b.key || b.name || ''))
          .forEach(b => {
            const fileName = b.key || b.name || '?';
            const groupName = b.groupKey || resolveGroup(fileName);
            const value = b.size != null ? `${b.contentType || 'binary'} (${b.size} bytes)` : (b.contentType || 'present');
            map[`${groupName}::${fileName}`] = value;
          });
        return map;
      }

      return {};
    };

    const [resA, resB] = await Promise.allSettled([fetchSide(sideA, propTypeA), fetchSide(sideB, propTypeB)]);

    if (resA.status === 'fulfilled') setPropsA(resA.value);
    else setErrorA(resA.reason?.response?.data?.error || resA.reason?.message || 'Failed');

    if (resB.status === 'fulfilled') setPropsB(resB.value);
    else setErrorB(resB.reason?.response?.data?.error || resB.reason?.message || 'Failed');

    // After compare — query stored credentials and populate the credential fields
    // if they are still empty (e.g., cpsClientId was masked and backend auto-discovered)
    try {
      const credRes = await api.get('/cps/credentials');
      const byUrlBg = credRes.data?.byUrlBg || {};

      const fillCredsFromStore = (s, side) => {
        if (s.cpsClientId && s.cpsClientSecret) return; // already populated
        if (!s.cpsUrl) return;
        const normBase = s.cpsUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
        const bgKey = s.bgId && s.bgId !== '__all__' ? s.bgId : null;
        // Check url::bgId first, then fall back to url-only (for __all__ / no bgOrgId cases)
        const storeKey = bgKey ? `${normBase}::${bgKey}` : null;
        const byUrl = credRes.data?.byUrl || {};
        const stored = (storeKey ? byUrlBg[storeKey] : null) || byUrl[normBase];
        if (stored?.maskedId) {
          // maskedId is first 8 chars + '…' — find the full credential from getAllCredentials
          const allCreds = getAllCredentials();
          const prefix = stored.maskedId.replace('…', '');
          const match = allCreds.find(c => c.clientId.startsWith(prefix));
          if (match) {
            updateSide(side, { cpsClientId: match.clientId, cpsClientSecret: match.clientSecret });
          }
        }
      };

      fillCredsFromStore(sideA, 'A');
      fillCredsFromStore(sideB, 'B');
    } catch { /* non-fatal */ }

    setComparing(false);
    setFilter('all');
    setSearch('');
    setCollapsedA(true);
    setCollapsedB(true);
  };

  // Build diff — keys may contain "groupName::propKey" for grouped types
  const diff = useMemo(() => {
    if (!propsA && !propsB) return [];
    const a = propsA || {};
    const b = propsB || {};
    const allKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return allKeys.map(key => {
      const valA = key in a ? String(a[key] ?? '') : null;
      const valB = key in b ? String(b[key] ?? '') : null;
      let status;
      if (valA === null) status = 'only-b';
      else if (valB === null) status = 'only-a';
      else if (valA === valB) status = 'matching';
      else status = 'different';
      // Parse group and display key
      const hasGroup = key.includes('::');
      const [groupName, displayKey] = hasGroup ? key.split('::') : ['', key];
      return { key, displayKey: hasGroup ? displayKey : key, groupName, valA, valB, status };
    });
  }, [propsA, propsB]);

  const stats = useMemo(() => ({
    total: diff.length,
    different: diff.filter(d => d.status === 'different').length,
    'only-a': diff.filter(d => d.status === 'only-a').length,
    'only-b': diff.filter(d => d.status === 'only-b').length,
    matching: diff.filter(d => d.status === 'matching').length,
  }), [diff]);

  // Feature 5: search across keys AND values (A and B)
  const displayRows = useMemo(() => {
    let rows = filter === 'all' ? diff : diff.filter(d => d.status === filter);
    if (showDiffsOnly) rows = rows.filter(d => d.status !== 'matching');
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(d =>
        d.key.toLowerCase().includes(q) ||
        (d.valA || '').toLowerCase().includes(q) ||
        (d.valB || '').toLowerCase().includes(q)
      );
    }
    return rows;
  }, [diff, filter, search, showDiffsOnly]);

  const selectedCountA = (sideA.selectedAppIds || []).length;
  const selectedCountB = (sideB.selectedAppIds || []).length;
  const multiAppCount = selectedCountA || selectedCountB
    ? Math.max(selectedCountA, selectedCountB)
    : Math.max(sideA.apps.length, sideB.apps.length);
  const canMultiCompare = sideA.bgId && sideB.bgId && multiAppCount > 0;
  const canCompare = compareMode === 'multi' ? canMultiCompare : (sideA.cpsUrl && sideA.cpsKey) || (sideB.cpsUrl && sideB.cpsKey);
  const hasResults = propsA !== null || propsB !== null;

  // Export CSV
  const exportCsv = () => {
    const rows = [['Property Key', `Side A (${sideA.cpsKey || 'A'})`, `Side B (${sideB.cpsKey || 'B'})`, 'Status']];
    diff.forEach(d => rows.push([d.key, d.valA ?? '(not set)', d.valB ?? '(not set)', d.status.toUpperCase()]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cps-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const STATUS_ROW = {
    different: 'bg-red-50/20 border-l-2 border-red-500',
    'only-a':  'bg-blue-50/20 border-l-2 border-blue-500',
    'only-b':  'bg-amber-50/20 border-l-2 border-amber-500',
    matching:  'bg-gray-50/60',   // muted — eye focuses on diffs
  };
  const STATUS_BADGE = {
    different: 'text-red-700 bg-red-100 border-red-300/60 ring-1 ring-red-200',
    'only-a':  'text-blue-700 bg-blue-100 border-blue-300/60',
    'only-b':  'text-amber-700 bg-amber-100 border-amber-300/60',
    matching:  'text-gray-500 bg-gray-200/20 border-gray-300/40',
  };
  const STATUS_LABEL = { different: 'DIFF', 'only-a': 'A ONLY', 'only-b': 'B ONLY', matching: 'MATCH' };

  return (
    <div className="space-y-5">
      {showBgFilter && (
        <BgFilterModal businessGroups={allBgs} onClose={() => setShowBgFilter(false)} onSaved={() => {}} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <GitCompare size={20} className="text-cyan-600" /> CPS Properties Comparison
          </h1>
          <p className="text-gray-500 text-sm mt-1">Compare CPS property values between two environments side-by-side</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* CPS credentials import */}
          <CpsCredentialImportButton />
          {/* BG Filter button */}
          <button onClick={() => setShowBgFilter(true)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${filterActive ? 'bg-blue-100 border-blue-300/50 text-blue-600' : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'}`}>
            <SlidersHorizontal size={11} />
            {filterActive ? `${filteredBgs.length}/${allBgs.length} BGs` : 'Filter BGs'}
          </button>
          {hasResults && (
            <button onClick={exportCsv}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-600 hover:text-emerald-700 bg-emerald-50/40 hover:bg-emerald-50/60 border border-emerald-200/50 rounded-lg transition-colors">
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Side panels */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">
        <SidePanel
          label="Side A"
          color="border-blue-300/50"
          state={sideA}
          filteredBgs={filteredBgs}
          propType={propTypeA}
          onPropTypeChange={setPropTypeA}
          onUpdate={u => updateSide('A', u)}
          onLoadEnvs={bgId => loadEnvs('A', bgId)}
          onLoadApps={(bgId, envId) => loadApps('A', bgId, envId)}
          onSelectApp={id => selectApp('A', id)}
          hideAppSelector={compareMode === 'multi'}
          collapsed={collapsedA}
          onToggleCollapse={() => setCollapsedA(v => !v)}
        />

        {/* Swap + Compare button column */}
        <div className="flex lg:flex-col items-center justify-center gap-3 lg:py-4">
          <button onClick={swapSides} title="Swap sides"
            className="p-2 text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg border border-gray-300 transition-colors">
            <ArrowLeftRight size={14} />
          </button>
          {/* Mode toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 border border-gray-300">
            {['single', 'multi'].map(m => (
              <button key={m} onClick={() => setCompareMode(m)}
                className={`text-[10px] px-2 py-1 rounded-md font-medium transition-all ${compareMode === m ? 'bg-cyan-700 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                {m === 'single' ? '1 App' : 'All Apps'}
              </button>
            ))}
          </div>
          <button onClick={compareMode === 'multi' ? compareAll : compare}
            disabled={comparing || !canCompare}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg transition-colors">
            {comparing
              ? <><RefreshCw size={13} className="animate-spin" /> {compareMode === 'multi' && compareProgress.total > 0 ? `${compareProgress.done}/${compareProgress.total}` : 'Comparing…'}</>
              : <><GitCompare size={13} /> {compareMode === 'multi' ? `Compare (${multiAppCount})` : 'Compare'}</>}
          </button>
        </div>

        <SidePanel
          label="Side B"
          color="border-orange-300/50"
          state={sideB}
          filteredBgs={filteredBgs}
          propType={propTypeB}
          onPropTypeChange={setPropTypeB}
          onUpdate={u => updateSide('B', u)}
          onLoadEnvs={bgId => loadEnvs('B', bgId)}
          onLoadApps={(bgId, envId) => loadApps('B', bgId, envId)}
          onSelectApp={id => selectApp('B', id)}
          hideAppSelector={compareMode === 'multi'}
          collapsed={collapsedB}
          onToggleCollapse={() => setCollapsedB(v => !v)}
        />
      </div>

      {/* Errors */}
      {(errorA || errorB) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {errorA && (
            <div className="flex items-start gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-xs">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span><strong>Side A:</strong> {errorA}</span>
            </div>
          )}
          {errorB && (
            <div className={`flex items-start gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-xs ${!errorA ? 'lg:col-start-2' : ''}`}>
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span><strong>Side B:</strong> {errorB}</span>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {hasResults && diff.length > 0 && (
        <div className="space-y-3">
          {/* Stats + filter tabs */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {['all', 'different', 'only-a', 'only-b', 'matching'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                    filter === f ? 'bg-cyan-100 border-cyan-300/60 text-cyan-700' : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'
                  }`}>
                  {f === 'all' ? `All (${stats.total})`
                    : f === 'different' ? `🔴 Diff (${stats.different})`
                    : f === 'only-a'   ? `🔵 A Only (${stats['only-a']})`
                    : f === 'only-b'   ? `🟠 B Only (${stats['only-b']})`
                    : `✅ Match (${stats.matching})`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Show Diffs Only toggle */}
              <button
                onClick={() => setShowDiffsOnly(v => !v)}
                title="Hide matching rows"
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-all ${
                  showDiffsOnly
                    ? 'bg-cyan-100 border-cyan-300/50 text-cyan-700'
                    : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'
                }`}>
                <span className={`w-6 h-3.5 rounded-full flex items-center transition-colors ${showDiffsOnly ? 'bg-cyan-600' : 'bg-gray-200'}`}>
                  <span className={`w-2.5 h-2.5 rounded-full bg-white shadow transition-transform mx-0.5 ${showDiffsOnly ? 'translate-x-2.5' : 'translate-x-0'}`} />
                </span>
                Diffs Only
              </button>
              {/* Export Diffs Only */}
              {(stats.different + stats['only-a'] + stats['only-b']) > 0 && (
                <button
                  onClick={() => {
                    const diffRows = diff.filter(d => d.status !== 'matching');
                    const rows = [['Property Key', `Side A (${sideA.cpsKey || 'A'})`, `Side B (${sideB.cpsKey || 'B'})`, 'Status']];
                    diffRows.forEach(d => rows.push([d.key, d.valA ?? '(not set)', d.valB ?? '(not set)', d.status.toUpperCase()]));
                    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `cps-diffs-only-${new Date().toISOString().slice(0, 10)}.csv`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border text-red-600 bg-red-50/30 border-red-200/50 hover:bg-red-50/50 transition-colors">
                  <Download size={11} /> Export Diffs
                </button>
              )}
              {/* Copy Diffs */}
              {(stats.different + stats['only-a'] + stats['only-b']) > 0 && (
                <CopyDiffsBtn diff={diff} keyA={sideA.cpsKey} keyB={sideB.cpsKey} />
              )}
              {/* Search */}
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by key or value…"
                  className="bg-gray-100 border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-cyan-300/50 w-48" />
              </div>
            </div>
          </div>

          {/* Diff table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Feature 3: scroll container wraps both headers and rows so sticky top-0 works */}
            <div className="divide-y divide-gray-200/40 max-h-[60vh] overflow-y-auto">
              {/* Sticky column headers */}
              <div className="grid grid-cols-[36px_1fr_1fr_1fr_80px] bg-gray-100/95 text-gray-500 text-[10px] uppercase tracking-wider px-4 py-2.5 gap-3 sticky top-0 z-10 backdrop-blur-sm border-b border-gray-300/60">
                <span className="text-center">#</span>
                <span>Property Key</span>
                <span>Side A ({sideA.cpsKey || '—'})</span>
                <span>Side B ({sideB.cpsKey || '—'})</span>
                <span className="text-center">Status</span>
              </div>

              {displayRows.length === 0 ? (
                <div className="px-4 py-10 text-center text-gray-500 text-sm">No properties match the current filter.</div>
              ) : (() => {
                  const rendered = [];
                  let lastGroup = null;
                  let lineNum = 0;
                  displayRows.forEach((row) => {
                    if (row.groupName && row.groupName !== lastGroup) {
                      lastGroup = row.groupName;
                      rendered.push(
                        <div key={`__group__${row.groupName}`}
                          className="col-span-full px-4 py-1.5 bg-gray-100/70 border-b border-gray-300/60 flex items-center gap-2">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Group</span>
                          <span className="font-mono text-[10px] text-cyan-600/80 font-semibold">{row.groupName}</span>
                        </div>
                      );
                    }
                    lineNum++;
                    const clickable = row.status === 'different' || row.status === 'only-a' || row.status === 'only-b';
                    rendered.push(
                      <div key={row.key}
                        onClick={() => clickable && setDiffRow(row)}
                        className={`grid grid-cols-[36px_1fr_1fr_1fr_80px] gap-3 px-4 py-2.5 transition-colors hover:bg-gray-100/20 ${STATUS_ROW[row.status] || ''} ${clickable ? 'cursor-pointer' : ''}`}>
                        {/* Line number */}
                        <div className="flex items-center justify-center">
                          <span className="text-[10px] text-gray-500 font-mono select-none">{lineNum}</span>
                        </div>
                        {/* Key */}
                        <div className="flex items-center gap-1.5 min-w-0" onClick={e => e.stopPropagation()}>
                          <span className="font-mono text-xs text-gray-600 truncate" title={row.displayKey}>{row.displayKey}</span>
                          <CopyBtn text={row.displayKey} />
                        </div>
                        {/* Value A — inline word-diff for DIFF rows */}
                        <div className="flex items-center gap-1.5 min-w-0" onClick={e => e.stopPropagation()}>
                          {row.valA !== null ? (
                            <>
                              {row.status === 'different' ? (() => {
                                const { aTokens } = wordDiff(row.valA, row.valB);
                                return (
                                  <span className="font-mono text-xs leading-snug break-all line-clamp-2 flex-1 min-w-0" title={row.valA}>
                                    {aTokens.map((t, i) => (
                                      <span key={i} className={t.changed ? 'bg-red-200 text-red-800 font-semibold rounded-sm px-0.5' : 'text-gray-600'}>{t.word}</span>
                                    ))}
                                  </span>
                                );
                              })() : (
                                <span className="font-mono text-xs text-gray-600 truncate" title={row.valA}>{row.valA}</span>
                              )}
                              <CopyBtn text={row.valA} />
                            </>
                          ) : <span className="text-[10px] text-gray-500 italic">not set</span>}
                        </div>
                        {/* Value B — inline word-diff for DIFF rows */}
                        <div className="flex items-center gap-1.5 min-w-0" onClick={e => e.stopPropagation()}>
                          {row.valB !== null ? (
                            <>
                              {row.status === 'different' ? (() => {
                                const { bTokens } = wordDiff(row.valA, row.valB);
                                return (
                                  <span className="font-mono text-xs leading-snug break-all line-clamp-2 flex-1 min-w-0" title={row.valB}>
                                    {bTokens.map((t, i) => (
                                      <span key={i} className={t.changed ? 'bg-amber-200 text-amber-900 font-semibold rounded-sm px-0.5' : 'text-gray-600'}>{t.word}</span>
                                    ))}
                                  </span>
                                );
                              })() : (
                                <span className="font-mono text-xs text-gray-600 truncate" title={row.valB}>{row.valB}</span>
                              )}
                              <CopyBtn text={row.valB} />
                            </>
                          ) : <span className="text-[10px] text-gray-500 italic">not set</span>}
                        </div>
                        {/* Status badge — clickable for non-matching rows */}
                        <div className="flex items-center justify-center">
                          <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold ${STATUS_BADGE[row.status]} ${clickable ? 'hover:opacity-80' : ''}`}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </div>
                      </div>
                    );
                  });
                  return rendered;
                })()}
            </div>

            {/* Footer */}
            {displayRows.length > 0 && (
              <div className="px-4 py-2 bg-gray-100/30 border-t border-gray-200 text-[10px] text-gray-500 flex items-center justify-between">
                <span>Showing {displayRows.length} of {diff.length} properties{search && ` · search "${search}" matches keys and values`}</span>
                {stats.different + stats['only-a'] + stats['only-b'] > 0 && (
                  <span className="text-gray-500">Click any 🔴🔵🟠 row to see the diff detail</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diff detail modal */}
      {diffRow && (
        <DiffModal
          row={diffRow}
          labelA={sideA.cpsKey || 'Side A'}
          labelB={sideB.cpsKey || 'Side B'}
          onClose={() => setDiffRow(null)}
        />
      )}

      {/* Empty state after compare */}
      {hasResults && diff.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white border border-gray-200 rounded-xl">
          <GitCompare size={40} className="text-gray-500" />
          <p className="text-gray-500 text-sm">No properties found — check the CPS URL, credentials and project key.</p>
        </div>
      )}

      {/* Multi-app results accordion */}
      {compareMode === 'multi' && multiResults.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-gray-500">
              <span className="text-gray-900 font-semibold">{multiResults.length}</span> apps compared ·{' '}
              <span className="text-red-600">{multiResults.filter(r => r.stats.different > 0 || r.stats['only-a'] > 0 || r.stats['only-b'] > 0).length} with diffs</span> ·{' '}
              <span className="text-emerald-600">{multiResults.filter(r => r.stats.different === 0 && r.stats['only-a'] === 0 && r.stats['only-b'] === 0 && r.stats.total > 0).length} identical</span>
            </p>
            <button
              onClick={() => {
                const rows = [['App Name', 'Property Key', `Side A`, `Side B`, 'Status']];
                multiResults.forEach(mr => mr.diff.forEach(d => rows.push([mr.appName, d.key, d.valA ?? '(not set)', d.valB ?? '(not set)', d.status.toUpperCase()])));
                const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `cps-multi-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-600 hover:text-emerald-700 bg-emerald-50/40 border border-emerald-200/50 rounded-lg transition-colors">
              <Download size={11} /> Export All CSV
            </button>
          </div>

          {multiResults.map(mr => {
            const isExpanded = expandedApps.has(mr.appName);
            const hasDiffs = mr.stats.different > 0 || mr.stats['only-a'] > 0 || mr.stats['only-b'] > 0;
            return (
              <div key={mr.appName} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* App header row */}
                <button
                  onClick={() => setExpandedApps(prev => { const n = new Set(prev); n.has(mr.appName) ? n.delete(mr.appName) : n.add(mr.appName); return n; })}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-gray-900 font-medium truncate">{mr.appName}</span>
                    {!mr.appB && <span className="text-[9px] text-orange-600 bg-orange-50/30 border border-orange-200/40 px-1.5 py-0.5 rounded">No match in B</span>}
                    {mr.errorA && <span className="text-[9px] text-red-600">A: {mr.errorA}</span>}
                    {mr.errorB && <span className="text-[9px] text-orange-600">B: {mr.errorB}</span>}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {hasDiffs
                      ? <span className="text-xs text-red-600 font-semibold">🔴 {mr.stats.different + mr.stats['only-a'] + mr.stats['only-b']} diffs</span>
                      : mr.stats.total > 0 ? <span className="text-xs text-emerald-600 font-semibold">✅ identical</span>
                      : <span className="text-xs text-gray-500">—</span>}
                    <span className="text-gray-500 text-xs">{mr.stats.total} props</span>
                    <span className={`text-gray-500 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </button>

                {/* Expanded diff rows */}
                {isExpanded && mr.diff.length > 0 && (
                  <div className="border-t border-gray-200">
                    <div className="grid grid-cols-[36px_1fr_1fr_1fr_80px] bg-gray-100/40 text-gray-500 text-[9px] uppercase tracking-wider px-4 py-1.5 gap-3">
                      <span className="text-center">#</span>
                      <span>Key</span><span>Side A</span><span>Side B</span><span className="text-center">Status</span>
                    </div>
                    <div className="divide-y divide-gray-200/30 max-h-64 overflow-y-auto">
                      {mr.diff.filter(d => d.status !== 'matching').concat(mr.diff.filter(d => d.status === 'matching')).map((row, idx) => (
                        <div key={row.key}
                          onClick={() => (row.status !== 'matching') && setDiffRow(row)}
                          className={`grid grid-cols-[36px_1fr_1fr_1fr_80px] gap-3 px-4 py-2 text-xs transition-colors hover:bg-gray-100/20 ${STATUS_ROW[row.status] || ''} ${row.status !== 'matching' ? 'cursor-pointer' : ''}`}>
                          <span className="flex items-center justify-center text-[10px] text-gray-500 font-mono">{idx + 1}</span>
                          <span className="font-mono text-gray-600 truncate" title={row.displayKey}>{row.displayKey}</span>
                          <span className={`font-mono truncate ${row.status === 'different' ? 'text-red-700' : 'text-gray-500'}`}>{row.valA ?? <em className="text-gray-500">not set</em>}</span>
                          <span className={`font-mono truncate ${row.status === 'different' ? 'text-orange-700' : 'text-gray-500'}`}>{row.valB ?? <em className="text-gray-500">not set</em>}</span>
                          <div className="flex items-center justify-center">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${STATUS_BADGE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Initial empty state */}
      {!hasResults && !(compareMode === 'multi' && multiResults.length > 0) && !comparing && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white border border-gray-200 rounded-xl">
          <GitCompare size={40} className="text-gray-500" />
          <p className="text-gray-500 text-sm">Select apps on both sides, then click <strong className="text-gray-900">Compare</strong></p>
          <p className="text-gray-500 text-xs">CPS URL and project key will be auto-filled from the selected app's runtime properties</p>
        </div>
      )}
    </div>
  );
}
