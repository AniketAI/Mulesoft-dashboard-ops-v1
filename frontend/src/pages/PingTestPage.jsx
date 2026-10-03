import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  AlertCircle, Globe, ShieldCheck, ArrowLeft, Download, RefreshCw,
  UploadCloud, X, Lock, Terminal, Check, History, Trash2, Clock, Zap
} from 'lucide-react';
import api from '../services/api';
import { ENV_BADGE, PING_STATUS_CONFIG as STATUS_CONFIG, latencyColor, generateTxId, downloadCsv } from '../utils/appUtils';
import { findOAuth2Url, findApiIdInProps as findApiId, flattenCpsResponse } from '../utils/cpsHelpers';
import PostmanJsonViewer from '../components/PostmanJsonViewer';
import { useCredentialStore } from '../context/CredentialStoreContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Premium status-pill styling, keyed by ping result status.
// Kept local to this page so the shared PING_STATUS_CONFIG (used elsewhere)
// is untouched while this view gets a richer gradient/badge treatment.
const STATUS_PILL = {
  SUCCESS: {
    Icon: CheckCircle2,
    cls: 'text-sfgreen-700 dark:text-sfgreen-300 bg-sfgreen-50 dark:bg-sfgreen-500/10 border-sfgreen-200/70 dark:border-sfgreen-400/20',
    dot: 'bg-sfgreen-500',
  },
  PARTIAL: {
    Icon: AlertCircle,
    cls: 'text-sforange-700 dark:text-sforange-300 bg-sforange-50 dark:bg-sforange-500/10 border-sforange-200/70 dark:border-sforange-400/20',
    dot: 'bg-sforange-500',
  },
  FAILED: {
    Icon: XCircle,
    cls: 'text-sfred-700 dark:text-sfred-300 bg-sfred-50 dark:bg-sfred-500/10 border-sfred-200/70 dark:border-sfred-400/20',
    dot: 'bg-sfred-500',
  },
  SKIPPED_CONTRACT_PENDING: {
    Icon: Lock,
    cls: 'text-sforange-700 dark:text-sforange-300 bg-sforange-50 dark:bg-sforange-500/10 border-sforange-200/70 dark:border-sforange-400/20',
    dot: 'bg-sforange-500',
  },
};

// ─── Result Row (Feature 1: retry button) ────────────────────────────────────

function ResultRow({ app, result, autoResolved, expandedId, setExpandedId, onRetry, onCheckContract, checkingContract, retrying, onGetJwt, jwtLoading, navigate, rowNum }) {
  const rowKey = `${app.id}|${app.environment?.id}`;
  const isExpanded = expandedId === rowKey;
  const isCH1 = app.deploymentType !== 'CloudHub 2.0';
  const [copiedCurl, setCopiedCurl] = useState(false);

  const buildRowCurl = () => {
    const url = result?.activeEndpoint;
    if (!url) return null;
    const lines = [`curl -X GET \\`, `  "${url}" \\`];
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -H "x-transaction-id: smokeTest" \\`);
    if (autoResolved?.clientId) lines.push(`  -H "client_id: ${autoResolved.clientId}" \\`);
    if (autoResolved?.clientSecret) {
      lines.push(`  -H "client_secret: ${autoResolved.clientSecret.slice(0, 4)}…"`);
    } else if (autoResolved?.clientId) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
    return lines.join('\n');
  };
  const cfg = result ? STATUS_CONFIG[result.status] || STATUS_CONFIG.FAILED : null;
  const isPendingContract = result?.status === 'SKIPPED_CONTRACT_PENDING';
  // Normal retry: FAILED or PARTIAL (not pending contract)
  const canRetry = result && (result.status === 'FAILED' || result.status === 'PARTIAL');
  // Contract approved and creds resolved → can ping
  const contractApproved = isPendingContract && autoResolved?.source === 'contract';

  return (
    <>
      <tr
        onClick={() => result && setExpandedId(isExpanded ? null : rowKey)}
        className={`border-t border-gray-100 dark:border-gray-700/50 transition-colors ${result ? 'cursor-pointer hover:bg-sf-50/40 dark:hover:bg-sf-500/[0.04]' : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/30'}`}>
        {/* Row number */}
        <td className="px-3 py-3 text-center text-gray-400 dark:text-gray-500 text-xs font-mono select-none w-8">
          {rowNum}
        </td>
        {/* App name */}
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-900 ${ENV_BADGE[app.environment?.type] || 'bg-gray-400'}`} />
            <div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => app._bgId && app.environment?.id && navigate(`/applications/${app._bgId}/${app.environment.id}/${app.id}`)}
                  title="Open application detail"
                  className="text-gray-900 dark:text-gray-100 text-sm font-semibold hover:text-sf-600 dark:hover:text-sf-400 transition-colors text-left">
                  {app.name}
                </button>
                {autoResolved && (
                  <span title={`Auto-resolved: ${autoResolved.apiInstanceName} → ${autoResolved.contractApp}`}
                    className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 bg-sfgreen-50 dark:bg-sfgreen-500/10 border border-sfgreen-300/40 dark:border-sfgreen-400/20 text-sfgreen-600 dark:text-sfgreen-400 rounded-full">
                    🔑 auto
                  </span>
                )}
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{app.environment?.name}</p>
              {result?._jwtError && (
                <p className="text-[10px] text-sfred-600/80 dark:text-sfred-400/80 mt-0.5">{result._jwtError}</p>
              )}
            </div>
          </div>
        </td>

        {/* Type */}
        <td className="px-3 py-3">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${isCH1 ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-600 dark:text-sfpurple-400 border-sfpurple-200/60 dark:border-sfpurple-400/20' : 'bg-sf-50 dark:bg-sf-500/10 text-sf-600 dark:text-sf-400 border-sf-200/60 dark:border-sf-400/20'}`}>
            {isCH1 ? 'CH1' : 'CH2'}
          </span>
        </td>

        {/* Ping status */}
        <td className="px-3 py-3">
          {retrying ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold text-sf-600 dark:text-sf-400 bg-sf-50 dark:bg-sf-500/10 border-sf-300/40 dark:border-sf-400/20">
              <RefreshCw size={10} className="animate-spin" /> Retrying…
            </span>
          ) : contractApproved ? (
            /* Contract was approved — show green "Approved" badge */
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold bg-sfgreen-50 dark:bg-sfgreen-500/10 text-sfgreen-700 dark:text-sfgreen-300 border-sfgreen-300/40 dark:border-sfgreen-400/20">
              <CheckCircle2 size={11} /> Approved — Ping Ready
            </span>
          ) : cfg ? (
            <div className="space-y-1">
              <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold ${(STATUS_PILL[result.status] || STATUS_PILL.FAILED).cls}`}>
                <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                  {cfg.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${(STATUS_PILL[result.status] || STATUS_PILL.FAILED).dot}`} />}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${(STATUS_PILL[result.status] || STATUS_PILL.FAILED).dot}`} />
                </span>
                {cfg.label}
              </span>
              {/* Show short reason inline for FAILED / SKIPPED rows */}
              {result.error && (result.status === 'FAILED' || result.status === 'SKIPPED_CONTRACT_PENDING') && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400 max-w-[200px] leading-tight">
                  {result.error.length > 80 ? result.error.slice(0, 77) + '…' : result.error}
                </p>
              )}
              {/* JWT auto-used badge */}
              {result._jwtUsed && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 bg-sfpurple-50 dark:bg-sfpurple-500/10 border border-sfpurple-300/40 dark:border-sfpurple-400/20 text-sfpurple-600 dark:text-sfpurple-400 rounded-full">
                  <Lock size={8} /> JWT auto
                </span>
              )}
              {/* JWT may be needed hint */}
              {result.status === 'PARTIAL' && !result._jwtUsed && (result.httpStatus === 401 || result.httpStatus === 400) && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-sfpurple-500/70 dark:text-sfpurple-400/70">
                  <Lock size={8} /> may need JWT
                </span>
              )}
            </div>
          ) : <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
        </td>

        {/* Active Endpoint */}
        <td className="px-3 py-3 max-w-xs">
          {result?.activeEndpoint ? (
            <span className="inline-block font-mono text-[11px] text-sf-700 dark:text-sf-400 bg-sf-50/60 dark:bg-sf-500/10 border border-sf-200/50 dark:border-sf-400/15 rounded-md px-1.5 py-0.5 truncate max-w-full" title={result.activeEndpoint}>
              {result.activeEndpoint}
            </span>
          ) : <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
        </td>

        {/* HTTP */}
        <td className="px-3 py-3 text-center">
          {result?.httpStatus != null ? (
            <span className={`inline-flex font-mono font-bold text-xs px-2 py-0.5 rounded-full border ${result.httpStatus < 300 ? 'text-sfgreen-700 dark:text-sfgreen-300 bg-sfgreen-50 dark:bg-sfgreen-500/10 border-sfgreen-200/60 dark:border-sfgreen-400/20' : result.httpStatus < 500 ? 'text-sforange-700 dark:text-sforange-300 bg-sforange-50 dark:bg-sforange-500/10 border-sforange-200/60 dark:border-sforange-400/20' : 'text-sfred-700 dark:text-sfred-300 bg-sfred-50 dark:bg-sfred-500/10 border-sfred-200/60 dark:border-sfred-400/20'}`}>
              {result.httpStatus}
            </span>
          ) : <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
        </td>

        {/* Latency */}
        <td className="px-3 py-3 text-right">
          {result?.responseTimeMs != null ? (
            <span className={`inline-flex items-center gap-1 font-mono font-semibold text-xs ${latencyColor(result.responseTimeMs)}`}>
              <Zap size={10} className="flex-shrink-0" />{result.responseTimeMs}ms
            </span>
          ) : <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
        </td>

        {/* Actions: retry + expand */}
        <td className="px-3 py-3">
          <div className="flex items-center justify-center gap-1.5">
            {/* Feature 1: Retry button for FAILED / PARTIAL rows */}
            {/* Pending contract: two separate buttons */}
            {/* Contract pending — show Check button only while not yet approved */}
            {isPendingContract && !contractApproved && !retrying && !checkingContract && (
              <button
                onClick={() => onCheckContract(app)}
                title="Check if the contract has been approved in API Manager"
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap text-sforange-600 dark:text-sforange-400 hover:text-sforange-700 dark:hover:text-sforange-300 bg-sforange-50/70 dark:bg-sforange-500/10 hover:bg-sforange-100 dark:hover:bg-sforange-500/20 border border-sforange-200/60 dark:border-sforange-400/20 shadow-sm hover:shadow transition-all">
                🔑 Check
              </button>
            )}
            {isPendingContract && checkingContract && (
              <span className="text-[10px] text-sforange-600/80 dark:text-sforange-400/80 flex items-center gap-1">
                <RefreshCw size={9} className="animate-spin" /> Checking…
              </span>
            )}
            {/* Contract approved — show only the Ping button */}
            {isPendingContract && contractApproved && !retrying && (
              <button
                onClick={() => onRetry(app)}
                title="Run ping test with resolved credentials"
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap text-sfgreen-600 dark:text-sfgreen-400 hover:text-sfgreen-700 dark:hover:text-sfgreen-300 bg-sfgreen-50/70 dark:bg-sfgreen-500/10 hover:bg-sfgreen-100 dark:hover:bg-sfgreen-500/20 border border-sfgreen-200/60 dark:border-sfgreen-400/20 shadow-sm hover:shadow transition-all">
                <RefreshCw size={10} /> Ping
              </button>
            )}
            {/* Get JWT button for PARTIAL results with 401/403 */}
            {result && result.status === 'PARTIAL' && !result._jwtUsed && !retrying &&
              (result.httpStatus === 401 || result.httpStatus === 403 || result.httpStatus === 400) && (
              <button
                onClick={() => onGetJwt(app)}
                disabled={jwtLoading}
                title="Fetch JWT token from CPS and retry ping"
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg font-semibold whitespace-nowrap disabled:opacity-50 text-sfpurple-600 dark:text-sfpurple-400 hover:text-sfpurple-700 dark:hover:text-sfpurple-300 bg-sfpurple-50/70 dark:bg-sfpurple-500/10 hover:bg-sfpurple-100 dark:hover:bg-sfpurple-500/20 border border-sfpurple-200/60 dark:border-sfpurple-400/20 shadow-sm hover:shadow transition-all">
                {jwtLoading ? <RefreshCw size={9} className="animate-spin" /> : <Lock size={9} />} JWT
              </button>
            )}
            {/* Normal retry for FAILED / PARTIAL */}
            {canRetry && !retrying && (
              <button
                onClick={() => onRetry(app)}
                title="Retry ping for this app"
                className="p-1.5 rounded-lg text-sfred-600 dark:text-sfred-400 hover:text-sfred-700 dark:hover:text-sfred-300 hover:bg-sfred-50 dark:hover:bg-sfred-500/10 transition-colors">
                <RefreshCw size={13} />
              </button>
            )}
            {result?.activeEndpoint && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const curl = buildRowCurl();
                  if (curl) {
                    navigator.clipboard.writeText(curl);
                    setCopiedCurl(true);
                    setTimeout(() => setCopiedCurl(false), 2000);
                  }
                }}
                title="Copy cURL for this endpoint"
                className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-sf-700 dark:hover:text-sf-300 hover:bg-sf-50 dark:hover:bg-sf-500/10 transition-colors">
                {copiedCurl ? <Check size={12} className="text-sfgreen-600 dark:text-sfgreen-400" /> : <Terminal size={12} />}
              </button>
            )}
            {result && (
              <span className={`flex items-center justify-center w-6 h-6 rounded-lg transition-colors ${isExpanded ? 'bg-sf-100 dark:bg-sf-500/20 text-sf-600 dark:text-sf-400' : 'text-gray-400 dark:text-gray-500'}`} title={isExpanded ? 'Click row to collapse' : 'Click row to expand'}>
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && result && (
        <tr className="border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/60 dark:bg-gray-900/30">
          <td colSpan={8} className="px-6 py-5">
            <div className="space-y-4 text-sm rounded-xl border border-gray-200/70 dark:border-gray-700/50 bg-white/80 dark:bg-gray-800/50 backdrop-blur-sm p-4 shadow-sm">
              {result._jwtUsed && (
                <div className="flex items-center gap-2 bg-sfpurple-50/60 dark:bg-sfpurple-500/10 border border-sfpurple-200/50 dark:border-sfpurple-400/20 rounded-lg px-3 py-2 text-sfpurple-700 dark:text-sfpurple-300 text-xs">
                  <Lock size={12} className="flex-shrink-0" />
                  JWT Bearer token was auto-fetched from CPS and used for this ping
                </div>
              )}
              {autoResolved && (
                <div className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sfgreen-50 dark:bg-sfgreen-500/15 text-sfgreen-600 dark:text-sfgreen-400 flex-shrink-0"><ShieldCheck size={13} /></span>
                  <div>
                    <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider">Credentials (Auto-resolved)</span>
                    <p className="text-sfgreen-700 dark:text-sfgreen-300 text-xs mt-0.5">
                      API Manager: <span className="font-semibold">{autoResolved.apiInstanceName}</span>
                      {' · '}Contract: <span className="font-semibold">{autoResolved.contractApp}</span>
                      {' · '}client_id: <span className="font-mono">{autoResolved.clientId?.slice(0, 8)}…</span>
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-sf-50 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400 flex-shrink-0"><Globe size={13} /></span>
                <div>
                  <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider">Full Endpoint</span>
                  <p className="font-mono text-xs text-sf-700 dark:text-sf-400 break-all mt-0.5">{result.activeEndpoint || '—'}</p>
                </div>
              </div>
              {result.error && (
                <div className="flex items-start gap-3">
                  <span className={`flex items-center justify-center w-6 h-6 rounded-lg flex-shrink-0 ${contractApproved ? 'bg-sfgreen-50 dark:bg-sfgreen-500/15 text-sfgreen-600 dark:text-sfgreen-400' : 'bg-sfred-50 dark:bg-sfred-500/15 text-sfred-600 dark:text-sfred-400'}`}>
                    {contractApproved ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  </span>
                  <div>
                    <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider">
                      {contractApproved ? 'Status' : 'Error'}
                    </span>
                    <p className={`text-xs mt-0.5 break-all ${contractApproved ? 'text-sfgreen-700 dark:text-sfgreen-300' : 'text-sfred-600 dark:text-sfred-400'}`}>
                      {result.error}
                    </p>
                  </div>
                </div>
              )}
              {result.payload && (() => {
                const endpoints = result.payload?.pingResponse?.endpoints;
                const summary = result.payload?.pingResponse?.summary;
                return (
                  <div className="space-y-3">
                    {/* Structured endpoint health table when pingResponse.endpoints exists */}
                    {Array.isArray(endpoints) && endpoints.length > 0 && (() => {
                      const ok = endpoints.filter(e => e && (e.status || '').toLowerCase() === 'success').length;
                      return (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider">Endpoint Health</span>
                            <div className="flex items-center gap-2 text-[10px]">
                              <span className="text-sfgreen-600 dark:text-sfgreen-400 font-bold">✓ {ok}</span>
                              {endpoints.length - ok > 0 && <span className="text-sfred-600 dark:text-sfred-400 font-bold">✗ {endpoints.length - ok}</span>}
                              {summary?.serviceName && <span className="text-gray-400 dark:text-gray-500 font-mono">{summary.serviceName}</span>}
                            </div>
                          </div>
                          <div className="space-y-1">
                            {endpoints.map((ep, i) => {
                              if (!ep) return null;
                              const isOk = (ep.status || '').toLowerCase() === 'success';
                              return (
                                <div key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs border ${isOk ? 'bg-sfgreen-50/40 dark:bg-sfgreen-500/5 border-sfgreen-200/40 dark:border-sfgreen-400/15' : 'bg-sfred-50/40 dark:bg-sfred-500/5 border-sfred-200/40 dark:border-sfred-400/15'}`}>
                                  {isOk ? <CheckCircle2 size={12} className="text-sfgreen-600 dark:text-sfgreen-400 flex-shrink-0 mt-0.5" /> : <XCircle size={12} className="text-sfred-600 dark:text-sfred-400 flex-shrink-0 mt-0.5" />}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="font-semibold text-gray-700 dark:text-gray-200">{ep.serviceName}</span>
                                      {ep.endpointName && <span className="text-[10px] text-gray-400 dark:text-gray-500">· {ep.endpointName}</span>}
                                    </div>
                                    {ep.apiUser && <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">{ep.apiUser}</p>}
                                    <p className={`text-[10px] mt-0.5 ${isOk ? 'text-sfgreen-600/80 dark:text-sfgreen-400/80' : 'text-sfred-600/80 dark:text-sfred-400/80'}`}>
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
                    <div>
                      <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider block mb-1.5">Response Body</span>
                      <PostmanJsonViewer data={result.payload} maxHeight="400px" />
                    </div>
                  </div>
                );
              })()}
              {result.attempts?.length > 0 && (
                <div>
                  <span className="text-gray-400 dark:text-gray-500 text-[10px] font-bold uppercase tracking-wider block mb-1.5">
                    Attempt Log — {result.attempts.length} path{result.attempts.length !== 1 ? 's' : ''} tried
                  </span>
                  <table className="w-full text-xs border-collapse rounded-lg overflow-hidden border border-gray-200/60 dark:border-gray-700/50">
                    <thead>
                      <tr className="bg-gray-100/80 dark:bg-gray-900/50">
                        <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-semibold">URL</th>
                        <th className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-semibold w-32">Result</th>
                        <th className="px-3 py-2 text-right text-gray-500 dark:text-gray-400 font-semibold w-24">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.attempts.map((a, i) => (
                        <tr key={i} className="border-t border-gray-200/40 dark:border-gray-700/40 hover:bg-gray-100/40 dark:hover:bg-gray-800/40">
                          <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-300 break-all">{a.url}</td>
                          <td className="px-3 py-2">
                            {a.error
                              ? <span className="text-sfred-600 dark:text-sfred-400 text-[11px]">{a.error}</span>
                              : <span className={`font-bold ${a.httpStatus < 300 ? 'text-sfgreen-600 dark:text-sfgreen-400' : a.httpStatus < 500 ? 'text-sforange-600 dark:text-sforange-400' : 'text-sfred-600 dark:text-sfred-400'}`}>HTTP {a.httpStatus}</span>}
                          </td>
                          <td className={`px-3 py-2 font-mono text-right ${latencyColor(a.responseTimeMs)}`}>
                            {a.responseTimeMs != null ? `${a.responseTimeMs}ms` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const SESSION_KEY = 'pingTestResults_v1';

// ─── PingHistoryView ─────────────────────────────────────────────────────────

function PingHistoryView({ globalHistory, onClose, onClear, historyLoading }) {
  const exportHistoryCsv = useCallback(() => {
    const rows = [
      ['Timestamp', 'Application', 'Environment', 'Type', 'Status', 'HTTP Code', 'Active Endpoint', 'Latency (ms)', 'Credentials', 'Error', 'Response Payload'],
    ];
    globalHistory.forEach(entry => {
      let payloadStr = '—';
      if (entry.payload != null) {
        payloadStr = typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload);
      }
      rows.push([
        new Date(entry.timestamp).toLocaleString(),
        entry.appName || '—',
        entry.env_name || '—',
        entry.target_type || '—',
        entry.status,
        entry.http_status ?? '—',
        entry.endpoint || '—',
        entry.responseTimeMs ?? '—',
        entry.credentials || '—',
        entry.error || '—',
        payloadStr
      ]);
    });
    downloadCsv(rows, `ping-history-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [globalHistory]);

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 px-6 py-5">
        <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-sfpurple-50/80 dark:from-sfpurple-500/[0.07] to-transparent pointer-events-none" />
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-sfpurple-500 to-sfpurple-600 shadow-lg shadow-sfpurple-500/30">
              <History size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Ping Test History</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5 flex items-center gap-1.5">
                {globalHistory.length} recorded ping test results in this session
                {historyLoading && <RefreshCw size={12} className="animate-spin text-sfpurple-500 dark:text-sfpurple-400" />}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {globalHistory.length > 0 && (
              <button onClick={exportHistoryCsv}
                className="group/exp flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-sfgreen-600 dark:text-sfgreen-400 bg-white dark:bg-gray-800 hover:text-sfgreen-700 dark:hover:text-sfgreen-300 border border-gray-200 dark:border-gray-700 hover:border-sfgreen-200/70 dark:hover:border-sfgreen-400/30 shadow-sm hover:shadow-md transition-all">
                <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfgreen-50 dark:bg-sfgreen-500/15 group-hover/exp:bg-sfgreen-100 dark:group-hover/exp:bg-sfgreen-500/25 text-sfgreen-600 dark:text-sfgreen-400 flex-shrink-0 transition-colors"><Download size={11} /></span>
                Export CSV
              </button>
            )}
            {globalHistory.length > 0 && (
              <button onClick={onClear}
                className="group/clr flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-sfred-600 dark:text-sfred-400 bg-white dark:bg-gray-800 hover:text-sfred-700 dark:hover:text-sfred-300 border border-gray-200 dark:border-gray-700 hover:border-sfred-200/70 dark:hover:border-sfred-400/30 shadow-sm hover:shadow-md transition-all">
                <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfred-50 dark:bg-sfred-500/15 group-hover/clr:bg-sfred-100 dark:group-hover/clr:bg-sfred-500/25 text-sfred-600 dark:text-sfred-400 flex-shrink-0 transition-colors"><Trash2 size={11} /></span>
                Clear History
              </button>
            )}
            <button onClick={onClose}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
              <ArrowLeft size={13} /> Back to Results
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 overflow-hidden">
        {globalHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-1">
              <History size={24} className="text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">No ping test history available yet.</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Run a batch ping or ping individual apps to generate history.</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[75vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/95 dark:bg-gray-900/90 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider backdrop-blur-sm">
                  <th className="px-4 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 w-44 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Timestamp</th>
                  <th className="px-4 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Application</th>
                  <th className="px-3 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Environment</th>
                  <th className="px-3 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Type</th>
                  <th className="px-3 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Status</th>
                  <th className="px-3 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">HTTP Code</th>
                  <th className="px-3 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Active Endpoint</th>
                  <th className="px-3 py-3 font-semibold text-right sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Latency</th>
                  <th className="px-4 py-3 font-semibold text-left sticky top-0 bg-gray-50/95 dark:bg-gray-900/90 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.1)]">Credentials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {globalHistory.map((entry, i) => {
                  const isOk = entry.status === 'SUCCESS';
                  const isPartial = entry.status === 'PARTIAL';
                  const statusConfig = STATUS_PILL[entry.status] || { Icon: XCircle, cls: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700' };
                  const statusLabel = (STATUS_CONFIG[entry.status] || {}).label || entry.status;

                  return (
                    <React.Fragment key={entry.id || i}>
                      <tr className="hover:bg-sf-50/40 dark:hover:bg-sf-500/[0.04] transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400 dark:text-gray-500 font-mono">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-200">
                          {entry.appName || '—'}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                          {entry.env_name || '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {entry.target_type ? (
                            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">
                              {entry.target_type}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusConfig.cls}`}>
                            <statusConfig.Icon size={10} />
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {entry.http_status ? (
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${
                              entry.http_status >= 200 && entry.http_status < 300 ? 'bg-sfgreen-50 dark:bg-sfgreen-500/10 text-sfgreen-700 dark:text-sfgreen-300 border-sfgreen-200/60 dark:border-sfgreen-400/20' :
                              entry.http_status >= 400 && entry.http_status < 500 ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' :
                              'bg-sfred-50 dark:bg-sfred-500/10 text-sfred-700 dark:text-sfred-300 border-sfred-200/60 dark:border-sfred-400/20'
                            }`}>
                              {entry.http_status}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-sf-600 dark:text-sf-400 truncate max-w-xs" title={entry.endpoint}>
                          {entry.endpoint || '—'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-right font-mono text-xs">
                          {entry.responseTimeMs != null ? (
                            <span className={latencyColor(entry.responseTimeMs)}>{entry.responseTimeMs}ms</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-[10px] text-gray-400 dark:text-gray-500">
                          {entry.credentials || '—'}
                        </td>
                      </tr>
                      {(entry.error || entry.payload) && (
                        <tr className="bg-gray-50/40 dark:bg-gray-900/20">
                          <td colSpan={9} className="px-4 py-2 pb-4">
                            <div className="pl-4 border-l-2 border-sf-200 dark:border-sf-500/30 space-y-2">
                              {entry.error && <p className="text-xs text-sfred-600 dark:text-sfred-400">{entry.error}</p>}
                              {entry.payload && (
                                <div>
                                  <span className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase block mb-1">Response</span>
                                  <PostmanJsonViewer data={entry.payload} maxHeight="160px" />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PingTestPage ─────────────────────────────────────────────────────────────

export default function PingTestPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const csvInputRef = useRef(null);

  const [results, setResults] = useState({});
  const [apps, setApps] = useState([]);
  const [autoResolvedMap, setAutoResolvedMap] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Feature 1.8: timestamp when the last batch was tested
  const [testedAt, setTestedAt] = useState(null);

  // Feature 1: per-app retry state
  const { hasCredentials, resolveFromCandidates } = useCredentialStore();
  const [retryingIds, setRetryingIds] = useState(new Set());
  const [checkingContractIds, setCheckingContractIds] = useState(new Set());
  const [jwtLoadingIds, setJwtLoadingIds] = useState(new Set());
  const [resolvingAll, setResolvingAll] = useState(false);

  // Feature 2: CSV upload state
  const [csvMatchedNames, setCsvMatchedNames] = useState(null); // null = not uploaded yet
  const [csvFileName, setCsvFileName] = useState('');

  // Load preloaded results from bulk ping modal (passed via location.state)
  // OR restore from sessionStorage (survives navigation)
  useEffect(() => {
    const state = location.state;
    if (state?.preloadedResults && state?.preloadedApps) {
      const now = new Date().toISOString();
      setResults(state.preloadedResults);
      setApps(state.preloadedApps);
      setAutoResolvedMap(state.autoResolvedMap || {});
      setTestedAt(now);
      window.history.replaceState({}, '');
      // Persist so they survive navigation away and back
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          results: state.preloadedResults,
          apps: state.preloadedApps,
          autoResolvedMap: state.autoResolvedMap || {},
          testedAt: now,
        }));
      } catch {}
    } else {
      // Restore from sessionStorage if no fresh state was passed
      try {
        const saved = sessionStorage.getItem(SESSION_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.results && parsed.apps) {
            setResults(parsed.results);
            setApps(parsed.apps);
            setAutoResolvedMap(parsed.autoResolvedMap || {});
            if (parsed.testedAt) setTestedAt(parsed.testedAt);
          }
        }
      } catch {}
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep sessionStorage in sync with live state (retry / batch updates)
  useEffect(() => {
    if (apps.length > 0) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results, apps, autoResolvedMap, testedAt }));
      } catch {}
    }
  }, [results, apps, autoResolvedMap, testedAt]);

  const clearResults = useCallback(() => {
    setResults({});
    setApps([]);
    setAutoResolvedMap({});
    setCsvMatchedNames(null);
    setCsvFileName('');
    setStatusFilter('ALL');
    setExpandedId(null);
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  const testedApps = useMemo(() => {
    const ord = { SUCCESS: 0, PARTIAL: 1, FAILED: 2 };
    return [...apps.filter(a => results[a.id])].sort(
      (a, b) => (ord[results[a.id]?.status] ?? 3) - (ord[results[b.id]?.status] ?? 3)
    );
  }, [apps, results]);

  // ─── Check contract approval (no ping — just updates creds + status) ──────

  const checkContractApproval = useCallback(async (app) => {
    const appId = app.id;
    const prevResult = results[appId];
    if (!prevResult?.apiInstanceId) return;
    const bgId = app._bgId;
    const envId = app.environment?.id;
    if (!bgId || !envId) return;

    setCheckingContractIds(prev => new Set([...prev, appId]));
    try {
      const contractRes = await api.post('/health/auto-contract-creds', {
        orgId: bgId, envId, apiId: prevResult.apiInstanceId,
        envType: app.environment?.type || '',
        envName: app.environment?.name || '',
      });
      const cd = contractRes.data;
      if (cd.contractStatus === 'approved' && cd.clientId && cd.clientSecret) {
        // Store credentials — user can now click "Retry Ping"
        setAutoResolvedMap(prev => ({ ...prev, [appId]: {
          clientId: cd.clientId,
          clientSecret: cd.clientSecret,
          apiInstanceName: String(prevResult.apiInstanceId),
          contractApp: cd.appName || prevResult.contractApp,
          source: 'contract',
        }}));
        // Update error message to show approval
        setResults(prev => ({ ...prev, [appId]: {
          ...prevResult,
          error: `✅ Contract approved for "${cd.appName}". Click Retry Ping to run the test.`,
        }}));
      } else {
        // Still pending — update error message
        setResults(prev => ({ ...prev, [appId]: {
          ...prevResult,
          error: `⏳ Contract still pending approval for "${cd.appName || prevResult.contractApp}". Approve in API Manager and check again.`,
        }}));
      }
    } catch (err) {
      setResults(prev => ({ ...prev, [appId]: {
        ...prevResult,
        error: `Contract check failed: ${err.message}`,
      }}));
    } finally {
      setCheckingContractIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    }
  }, [results]);

  // ─── Retry ping (uses already-resolved credentials from autoResolvedMap) ──

  const retryApp = useCallback(async (app) => {
    const appId = app.id;
    const auto = autoResolvedMap[appId];
    setRetryingIds(prev => new Set([...prev, appId]));
    try {
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      let ch2IngressUrl;
      if (!isCH1 && app._bgId && app.environment?.id) {
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
      const { data } = await api.post('/health/ping', {
        targetType: isCH1 ? 'CH1' : 'CH2',
        appName: app.name,
        ch2IngressUrl,
        clientId: auto?.clientId || undefined,
        clientSecret: auto?.clientSecret || undefined,
        transactionId: generateTxId(),
        envType: app.environment?.type || '',
        envName: app.environment?.name || '',
        orgId: app._bgId,
        envId: app.environment?.id,
        credentialsLabel: auto ? `Auto (${auto.contractApp})` : 'Manual / None',
      });
      setResults(prev => ({ ...prev, [appId]: data }));
    } catch (err) {
      setResults(prev => ({ ...prev, [appId]: { status: 'FAILED', error: err.message } }));
    } finally {
      setRetryingIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    }
  }, [autoResolvedMap]);

  // ─── Get JWT Token and retry ping ────────────────────────────────────────
  // Full flow: app detail → CPS scan (apiId + OAuth2 URL) → credentials → JWT → ping

  const getJwtAndRetry = useCallback(async (app) => {
    const appId = app.id;
    setJwtLoadingIds(prev => new Set([...prev, appId]));
    try {
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      const orgId = app._bgId;

      // Step 1: Fetch full app detail to extract CPS config + ingress URL
      // CH2: fetch deployment detail (has target.deploymentSettings.{properties,runtimeProperties})
      // CH1: fetch app properties directly (/cloudhub1/:envId/:appName/properties)
      let ch2IngressUrl;
      let allProps = {};

      if (!isCH1 && orgId && app.environment?.id) {
        try {
          const r = await api.get(`/applications/cloudhub2/${orgId}/${app.environment.id}/${app.id}`);
          const detail = r.data;
          const ds = detail?.target?.deploymentSettings || {};
          const ps = (detail?.application?.configuration || {})['mule.agent.application.properties.service'] || {};
          // Also check _settings (populated by backend from /deployments/:id/settings)
          const settingsProps = detail?._settings?.properties || {};
          allProps = {
            ...(detail?.properties || {}),
            ...(ps.properties || {}),
            ...(ds.runtimeProperties || {}),
            ...(ds.properties || {}),
            ...(ds.environmentVariables || ds.environmentVars || {}),
            ...settingsProps,
          };
          const hi = ds.http?.inbound || {};
          const eps = hi.endpoints || [];
          ch2IngressUrl = hi.publicUrl || eps.find(e => e.access === 'external')?.url || eps[0]?.url;
        } catch {}
      } else if (isCH1 && app.environment?.id && app.name) {
        // CH1: properties are returned by the list/detail endpoint directly
        try {
          const r = await api.get(`/applications/cloudhub1/${app.environment.id}/${app.name}/properties`,
            { params: { orgId: orgId || app._bgId } });
          allProps = { ...(r.data?.properties || {}) };
        } catch {}
      }

      const cpsBaseUrl = allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'] || '';
      const cpsKey = allProps['cps.projectName'] || allProps['cloudhub.api.name'] || app.name;
      const cpsEnv = allProps['cps.prefix'] || allProps['cps.environment'] || '';

      if (!cpsBaseUrl) throw new Error('No CPS URL configured for this app');

      // Step 2: Scan CPS non-secure — extract both apiId and OAuth2 token URL
      const nsRes = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: cpsKey, ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId } });
      const nsFlat = flattenCpsResponse(nsRes.data, cpsKey);

      const cpsApiId = findApiId(nsFlat);
      let tokenUrl = findOAuth2Url(nsFlat);

      // Step 3: If token URL not in non-secure, scan ALL secure keys for OAuth2 URL.
      // Token URLs can be in any secure group, not just jwt/auth named keys.
      if (!tokenUrl) {
        const secureKeys = (nsFlat['cps.secure.properties'] || '').split(',').map(k => k.trim()).filter(Boolean);
        if (secureKeys.length > 0) {
          try {
            const sr = await api.get('/cps/fetch', { params: { baseUrl: cpsBaseUrl, type: 'secure', keys: secureKeys.join(','), ...(cpsEnv && { environment: cpsEnv }), bgOrgId: orgId } });
            const sg = Array.isArray(sr.data?.responses) ? sr.data.responses : Array.isArray(sr.data?.properties) ? sr.data.properties : Array.isArray(sr.data) ? sr.data : [];
            for (const g of sg) { const u = findOAuth2Url(g.properties || {}); if (u) { tokenUrl = u; break; } }
          } catch {}
        }
      }
      if (!tokenUrl) throw new Error('No OAuth2 token URL found in CPS');

      // Step 4: Resolve credentials (cached → auto-fill with CPS-derived apiId)
      let auto = autoResolvedMap[appId];
      if (!auto?.clientId || !auto?.clientSecret) {
        try {
          const acRes = await api.post('/health/auto-credentials', {
            orgId, envId: app.environment?.id, appName: app.name,
            ...(cpsApiId && { apiId: cpsApiId }),
          });
          const apiInstanceId = acRes.data?.matchedApis?.[0]?.id;
          if (apiInstanceId) {
            const cd = (await api.post('/health/auto-contract-creds', {
              orgId, envId: app.environment?.id, apiId: apiInstanceId,
              envType: app.environment?.type || '',
              envName: app.environment?.name || '',
            })).data;
            if (cd.clientId && cd.clientSecret) {
              auto = { clientId: cd.clientId, clientSecret: cd.clientSecret };
              setAutoResolvedMap(prev => ({
                ...prev,
                [appId]: { ...auto, apiInstanceName: String(apiInstanceId), contractApp: cd.appName || '—', source: cd.contractStatus === 'approved' ? 'contract' : 'contract-pending' }
              }));
            }
          }
        } catch {}
        if (!auto?.clientId || !auto?.clientSecret) {
          throw new Error('No credentials found — import a CSV or register a contract in API Manager first.');
        }
      }

      // Step 5: Fetch JWT
      const tokenRes = await api.post('/health/oauth2-token', { tokenUrl, clientId: auto.clientId, clientSecret: auto.clientSecret });
      const jwt = tokenRes.data.access_token;

      // Step 6: Retry ping with JWT Bearer token
      const pingRes = await api.post('/health/ping', {
        targetType: isCH1 ? 'CH1' : 'CH2',
        appName: app.name,
        ch2IngressUrl,
        bearerToken: jwt,
        transactionId: generateTxId(),
        envType: app.environment?.type || '',
        envName: app.environment?.name || '',
        orgId,
        envId: app.environment?.id,
        credentialsLabel: auto ? `Auto (${auto.contractApp})` : 'Manual / None',
      });
      setResults(prev => ({ ...prev, [appId]: { ...pingRes.data, _jwtUsed: true } }));
    } catch (err) {
      setResults(prev => ({ ...prev, [appId]: { ...prev[appId], _jwtError: err.response?.data?.error || err.message } }));
    } finally {
      setJwtLoadingIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    }
  }, [autoResolvedMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Feature 2: CSV Upload & Batch Ping ───────────────────────────────────

  const handleCsvUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result || '';
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) { setCsvMatchedNames([]); return; }

      // Detect header row and find the app name column
      const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
      const nameColIdx = header.findIndex(h => ['appname', 'name', 'domain', 'application'].includes(h));

      let rawNames;
      if (nameColIdx >= 0) {
        // Has recognised header — skip header row and read that column
        rawNames = lines.slice(1).map(l => l.split(',')[nameColIdx]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      } else {
        // No header match — treat every non-empty line as a name (single-column CSV)
        rawNames = lines.map(l => l.split(',')[0]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
      setCsvMatchedNames(rawNames.map(n => n.toLowerCase()));
    };
    reader.readAsText(file);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }, []);

  // Apps matched by CSV: cross-reference parsed names against current app list
  const csvMatchedApps = useMemo(() => {
    if (!csvMatchedNames) return [];
    return apps.filter(a => csvMatchedNames.some(n => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase())));
  }, [apps, csvMatchedNames]);

  // Batch-ping all CSV-matched apps (Feature 2)
  const [batchRunning, setBatchRunning] = useState(false);
  const runBatchPing = useCallback(async () => {
    if (csvMatchedApps.length === 0) return;
    setBatchRunning(true);
    const BATCH = 5;
    for (let i = 0; i < csvMatchedApps.length; i += BATCH) {
      const batch = csvMatchedApps.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(app => retryApp(app)));
    }
    setBatchRunning(false);
    setShowAll(true); // switch to "show all" so CSV results are visible
  }, [csvMatchedApps, retryApp]);

  // ─── Export CSV ─────────────────────────────────────────────────────────────

  const exportCsv = useCallback(() => {
    const rows = [
      ['Application', 'Environment', 'Type', 'Status', 'HTTP Code', 'Active Endpoint', 'Latency (ms)', 'Credentials', 'Error', 'Response Payload'],
    ];
    testedApps.forEach(app => {
      const result = results[app.id];
      const auto = autoResolvedMap[app.id];
      const isCH1 = app.deploymentType !== 'CloudHub 2.0';
      const statusLabel = result ? (STATUS_CONFIG[result.status]?.label || result.status) : '—';
      const creds = auto ? `Auto (${auto.contractApp})` : result ? 'Manual / None' : '—';
      let payloadStr = '—';
      if (result?.payload != null) {
        payloadStr = typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload);
        // No truncation — full response is exported; downloadCsv handles quoting/escaping
      }
      rows.push([app.name, app.environment?.name || '—', isCH1 ? 'CH1' : 'CH2', statusLabel,
        result?.httpStatus ?? '—', result?.activeEndpoint || '—', result?.responseTimeMs ?? '—',
        creds, result?.error || '—', payloadStr]);
    });
    downloadCsv(rows, `ping-test-results-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [testedApps, results, autoResolvedMap]);

  // ─── Status filter ───────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('ALL');
  const filteredApps = useMemo(() => {
    const base = showAll ? apps : testedApps;
    if (statusFilter === 'ALL') return base;
    if (statusFilter === 'CONTRACT_PENDING') {
      return base.filter(a =>
        results[a.id]?.status === 'SKIPPED_CONTRACT_PENDING' &&
        autoResolvedMap[a.id]?.source !== 'contract'
      );
    }
    if (statusFilter === 'CONTRACT_APPROVED') {
      return base.filter(a =>
        results[a.id]?.status === 'SKIPPED_CONTRACT_PENDING' &&
        autoResolvedMap[a.id]?.source === 'contract'
      );
    }
    return base.filter(a => results[a.id]?.status === statusFilter);
  }, [showAll, apps, testedApps, results, statusFilter, autoResolvedMap]);

  const displayApps = filteredApps;
  const done = testedApps.length;
  const successCount = testedApps.filter(a => results[a.id]?.status === 'SUCCESS').length;
  const partialCount = testedApps.filter(a => results[a.id]?.status === 'PARTIAL').length;
  const failedCount  = testedApps.filter(a => results[a.id]?.status === 'FAILED').length;
  // Only count apps whose contract is still pending (not yet approved)
  const pendingContractCount = testedApps.filter(a =>
    results[a.id]?.status === 'SKIPPED_CONTRACT_PENDING' &&
    autoResolvedMap[a.id]?.source !== 'contract'
  ).length;
  const approvedContractCount = testedApps.filter(a =>
    results[a.id]?.status === 'SKIPPED_CONTRACT_PENDING' &&
    autoResolvedMap[a.id]?.source === 'contract'
  ).length;
  const autoResolvedCount = Object.keys(autoResolvedMap).length;
  const hasResults = done > 0;

  const [retryingAll, setRetryingAll] = useState(false);
  const [pingingAllApproved, setPingingAllApproved] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);

  // History State
  const [showHistoryView, setShowHistoryView] = useState(false);
  const [globalHistory, setGlobalHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchGlobalHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const { data } = await api.get('/health/ping/history');
      setGlobalHistory(data || []);
    } catch (e) {
      console.error('Failed to fetch global history', e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const clearGlobalHistory = async () => {
    try {
      setHistoryLoading(true);
      await api.delete('/health/ping/history');
      setGlobalHistory([]);
    } catch (e) {
      console.error('Failed to clear global history', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (showHistoryView) {
      fetchGlobalHistory();
    }
  }, [showHistoryView, fetchGlobalHistory]);

  const pingAllApproved = useCallback(async () => {
    const approvedApps = testedApps.filter(a =>
      results[a.id]?.status === 'SKIPPED_CONTRACT_PENDING' &&
      autoResolvedMap[a.id]?.source === 'contract'
    );
    if (!approvedApps.length) return;
    setPingingAllApproved(true);
    const BATCH = 5;
    for (let i = 0; i < approvedApps.length; i += BATCH) {
      await Promise.allSettled(approvedApps.slice(i, i + BATCH).map(app => retryApp(app)));
    }
    setPingingAllApproved(false);
  }, [testedApps, results, autoResolvedMap, retryApp]);

  const retryAllFailed = useCallback(async () => {
    const failedApps = testedApps.filter(a => results[a.id]?.status === 'FAILED');
    if (!failedApps.length) return;
    setRetryingAll(true);
    const BATCH = 5;
    for (let i = 0; i < failedApps.length; i += BATCH) {
      await Promise.allSettled(failedApps.slice(i, i + BATCH).map(app => retryApp(app)));
    }
    setRetryingAll(false);
  }, [testedApps, results, retryApp]);

  // ─── Re-resolve credentials for apps that don't have them yet ────────────
  const unresolvedApps = useMemo(() =>
    apps.filter(a =>
      results[a.id] &&
      !autoResolvedMap[a.id] &&
      results[a.id].status !== 'SKIPPED_CONTRACT_PENDING'
    ),
  [apps, results, autoResolvedMap]);

  const resolveUnresolved = useCallback(async () => {
    if (!unresolvedApps.length) return;
    setResolvingAll(true);
    const settled = await Promise.allSettled(
      unresolvedApps.map(async (app) => {
        const bgId = app._bgId;
        const envId = app.environment?.id;
        if (!bgId || !envId) return null;
        try {
          const { data } = await api.post('/health/auto-credentials', {
            orgId: bgId, envId, appName: app.name,
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
                source: 'csv',
              };
            }
            const apiInstanceId = data.matchedApis?.[0]?.id;
            if (apiInstanceId) {
              try {
                const cd = (await api.post('/health/auto-contract-creds', {
                  orgId: bgId, envId, apiId: apiInstanceId,
                  envType: app.environment?.type || '',
                  envName: app.environment?.name || '',
                })).data;
                if (cd.clientId && cd.clientSecret && cd.contractStatus === 'approved') {
                  return {
                    appId: app.id,
                    clientId: cd.clientId,
                    clientSecret: cd.clientSecret,
                    apiInstanceName: data.matchedApis[0]?.label || '—',
                    contractApp: cd.appName || '—',
                    source: 'contract',
                  };
                }
              } catch {}
            }
          }
          return null;
        } catch { return null; }
      })
    );
    const newlyResolved = {};
    settled.forEach(r => { if (r.status === 'fulfilled' && r.value) newlyResolved[r.value.appId] = r.value; });
    if (Object.keys(newlyResolved).length > 0) {
      setAutoResolvedMap(prev => ({ ...prev, ...newlyResolved }));
    }
    setResolvingAll(false);
  }, [unresolvedApps, resolveFromCandidates]);

  const checkAllContracts = useCallback(async () => {
    const pendingApps = testedApps.filter(a => results[a.id]?.status === 'SKIPPED_CONTRACT_PENDING');
    if (!pendingApps.length) return;
    setCheckingAll(true);
    await Promise.allSettled(pendingApps.map(app => checkContractApproval(app)));
    setCheckingAll(false);
  }, [testedApps, results, checkContractApproval]);

  // ─── Results view ─────────────────────────────────────────────────────────────

  if (showHistoryView) {
    return (
      <PingHistoryView 
        globalHistory={globalHistory} 
        onClose={() => setShowHistoryView(false)} 
        onClear={clearGlobalHistory} 
        historyLoading={historyLoading} 
      />
    );
  }

  // ─── Empty state ─────────────────────────────────────────────────────────────

  if (!hasResults && apps.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-sf-500 to-sf-600 shadow-md shadow-sf-500/30"><Activity size={16} className="text-white" /></span>
            Ping Test Results
          </h1>
        </div>
        <div className="relative overflow-hidden flex flex-col items-center justify-center py-24 gap-5 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20">
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-sf-50/80 dark:from-sf-500/[0.06] to-transparent pointer-events-none" />
          <div className="relative w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Activity size={28} className="text-gray-400 dark:text-gray-500" />
          </div>
          <div className="relative text-center space-y-1.5">
            <p className="text-gray-900 dark:text-gray-100 font-semibold">No ping results yet</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Run a bulk ping test from the <strong>Applications</strong> page or view past history.</p>
          </div>
          <div className="relative flex items-center gap-3">
            <button onClick={() => navigate('/applications')}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20">
              <ArrowLeft size={14} /> Go to Applications
            </button>
            <button onClick={() => setShowHistoryView(true)}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
              <History size={14} /> View History
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hidden CSV file input */}
      <input ref={csvInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="hidden" />

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 px-6 py-5">
        <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-sf-50/80 dark:from-sf-500/[0.07] to-transparent pointer-events-none" />
        <div className="relative flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-sf-500 to-sf-600 shadow-lg shadow-sf-500/30">
            <Activity size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Ping Test Results</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5 flex items-center flex-wrap gap-x-1">
              {done} apps tested
              {done > 0 && (<span className="inline-flex items-center gap-1.5 ml-1">
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-sfgreen-600 dark:text-sfgreen-400 font-semibold">{successCount} ✓</span>
                {partialCount > 0 && <span className="text-sforange-600 dark:text-sforange-400 font-semibold">{partialCount} ~</span>}
                {failedCount  > 0 && <span className="text-sfred-600 dark:text-sfred-400 font-semibold">{failedCount} ✗</span>}
              </span>)}
              {autoResolvedCount > 0 && (
                <span className="inline-flex items-center gap-1 ml-1 text-sfgreen-600/80 dark:text-sfgreen-400/80 text-xs">
                  <span className="text-gray-300 dark:text-gray-600">·</span> 🔑 {autoResolvedCount} auto-creds
                </span>
              )}
              {/* Feature 1.8: show when the batch was tested */}
              {testedAt && (
                <span className="inline-flex items-center gap-1 ml-1 text-gray-400 dark:text-gray-500 text-xs">
                  <span className="text-gray-300 dark:text-gray-600">·</span> <Clock size={10} /> Tested at {new Date(testedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Re-resolve credentials for apps without auto-creds.
              Shown whenever unresolved apps exist — does not require CSV since
              it also tries the auto-contract-creds (API Manager contract) path. */}
          {unresolvedApps.length > 0 && (
            <button onClick={resolveUnresolved} disabled={resolvingAll}
              title={`Auto-resolve credentials for ${unresolvedApps.length} app${unresolvedApps.length !== 1 ? 's' : ''} that have no credentials yet`}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sfteal-500 to-sfteal-600 hover:from-sfteal-400 hover:to-sfteal-500 text-white shadow-md shadow-sfteal-500/30 hover:shadow-lg hover:shadow-sfteal-500/40 ring-1 ring-inset ring-white/20">
              <ShieldCheck size={13} className={resolvingAll ? 'animate-spin' : ''} />
              {resolvingAll ? 'Resolving…' : `Re-resolve Creds (${unresolvedApps.length})`}
            </button>
          )}
          {/* Retry all failed */}
          {failedCount > 0 && (
            <button onClick={retryAllFailed} disabled={retryingAll}
              title={`Retry all ${failedCount} failed ping test${failedCount !== 1 ? 's' : ''}`}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sfred-500 to-sfred-600 hover:from-sfred-400 hover:to-sfred-500 text-white shadow-md shadow-sfred-500/30 hover:shadow-lg hover:shadow-sfred-500/40 ring-1 ring-inset ring-white/20">
              <RefreshCw size={13} className={retryingAll ? 'animate-spin' : ''} />
              {retryingAll ? 'Retrying…' : `Retry Failed (${failedCount})`}
            </button>
          )}
          {/* Ping all approved contracts */}
          {approvedContractCount > 0 && (
            <button onClick={pingAllApproved} disabled={pingingAllApproved}
              title={`Ping all ${approvedContractCount} approved app${approvedContractCount !== 1 ? 's' : ''}`}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sfgreen-500 to-sfgreen-600 hover:from-sfgreen-400 hover:to-sfgreen-500 text-white shadow-md shadow-sfgreen-500/30 hover:shadow-lg hover:shadow-sfgreen-500/40 ring-1 ring-inset ring-white/20">
              <Activity size={13} className={pingingAllApproved ? 'animate-pulse' : ''} />
              {pingingAllApproved ? 'Pinging…' : `Ping Approved (${approvedContractCount})`}
            </button>
          )}
          {/* Check all pending contracts */}
          {pendingContractCount > 0 && (
            <button onClick={checkAllContracts} disabled={checkingAll}
              title={`Check contract approval for ${pendingContractCount} pending app${pendingContractCount !== 1 ? 's' : ''}`}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sforange-500 to-sforange-600 hover:from-sforange-400 hover:to-sforange-500 text-white shadow-md shadow-sforange-500/30 hover:shadow-lg hover:shadow-sforange-500/40 ring-1 ring-inset ring-white/20">
              <RefreshCw size={13} className={checkingAll ? 'animate-spin' : ''} />
              {checkingAll ? 'Checking…' : `Check Contracts (${pendingContractCount})`}
            </button>
          )}
          {/* Feature 2: CSV Upload button */}
          <button onClick={() => csvInputRef.current?.click()}
            title="Upload a CSV of app names to batch-ping"
            className="group/csv flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-sf-600 dark:text-sf-400 bg-white dark:bg-gray-800 hover:text-sf-700 dark:hover:text-sf-300 border border-gray-200 dark:border-gray-700 hover:border-sf-200/70 dark:hover:border-sf-400/30 shadow-sm hover:shadow-md transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sf-50 dark:bg-sf-500/15 group-hover/csv:bg-sf-100 dark:group-hover/csv:bg-sf-500/25 text-sf-600 dark:text-sf-400 flex-shrink-0 transition-colors"><UploadCloud size={11} /></span>
            Upload CSV
          </button>
          {hasResults && (
            <button onClick={exportCsv}
              className="group/exp flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-sfgreen-600 dark:text-sfgreen-400 bg-white dark:bg-gray-800 hover:text-sfgreen-700 dark:hover:text-sfgreen-300 border border-gray-200 dark:border-gray-700 hover:border-sfgreen-200/70 dark:hover:border-sfgreen-400/30 shadow-sm hover:shadow-md transition-all">
              <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfgreen-50 dark:bg-sfgreen-500/15 group-hover/exp:bg-sfgreen-100 dark:group-hover/exp:bg-sfgreen-500/25 text-sfgreen-600 dark:text-sfgreen-400 flex-shrink-0 transition-colors"><Download size={11} /></span>
              Export CSV
            </button>
          )}
          {hasResults && (
            <button onClick={clearResults}
              className="group/clr flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-sfred-600 dark:text-sfred-400 bg-white dark:bg-gray-800 hover:text-sfred-700 dark:hover:text-sfred-300 border border-gray-200 dark:border-gray-700 hover:border-sfred-200/70 dark:hover:border-sfred-400/30 shadow-sm hover:shadow-md transition-all">
              <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfred-50 dark:bg-sfred-500/15 group-hover/clr:bg-sfred-100 dark:group-hover/clr:bg-sfred-500/25 text-sfred-600 dark:text-sfred-400 flex-shrink-0 transition-colors"><X size={11} /></span>
              Clear Results
            </button>
          )}
          <button onClick={() => setShowHistoryView(true)}
            className="group/hist flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-sfpurple-600 dark:text-sfpurple-400 bg-white dark:bg-gray-800 hover:text-sfpurple-700 dark:hover:text-sfpurple-300 border border-gray-200 dark:border-gray-700 hover:border-sfpurple-200/70 dark:hover:border-sfpurple-400/30 shadow-sm hover:shadow-md transition-all">
            <span className="flex items-center justify-center w-5 h-5 rounded-lg bg-sfpurple-50 dark:bg-sfpurple-500/15 group-hover/hist:bg-sfpurple-100 dark:group-hover/hist:bg-sfpurple-500/25 text-sfpurple-600 dark:text-sfpurple-400 flex-shrink-0 transition-colors"><History size={11} /></span>
            View History
          </button>
          <button onClick={() => navigate('/applications')}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl transition-colors">
            <ArrowLeft size={13} /> Back to Applications
          </button>
        </div>
        </div>
      </div>

      {/* Feature 2: CSV match banner */}
      {csvMatchedNames !== null && (
        <div className={`relative overflow-hidden flex items-center justify-between flex-wrap gap-3 px-5 py-3.5 rounded-2xl border backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 text-sm ${
          csvMatchedApps.length > 0
            ? 'bg-sf-50/60 dark:bg-sf-500/10 border-sf-200/70 dark:border-sf-400/20'
            : 'bg-white/70 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700/60'
        }`}>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-sf-100 dark:bg-sf-500/20 text-sf-600 dark:text-sf-400 flex-shrink-0"><UploadCloud size={14} /></span>
            <span className="text-gray-600 dark:text-gray-300 text-xs">
              <span className="font-mono text-gray-500 dark:text-gray-400">{csvFileName}</span>
              {' — '}
              {csvMatchedApps.length > 0
                ? <span className="text-sf-700 dark:text-sf-300 font-semibold">{csvMatchedApps.length} app{csvMatchedApps.length !== 1 ? 's' : ''} matched from CSV</span>
                : <span className="text-gray-500 dark:text-gray-400">No apps matched</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {csvMatchedApps.length > 0 && (
              <button onClick={runBatchPing} disabled={batchRunning}
                className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white shadow-sm shadow-sf-500/30 hover:shadow-md hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20">
                {batchRunning
                  ? <><RefreshCw size={10} className="animate-spin" /> Running…</>
                  : <><Activity size={10} /> Run Batch Ping ({csvMatchedApps.length})</>}
              </button>
            )}
            <button onClick={() => { setCsvMatchedNames(null); setCsvFileName(''); }}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-lg transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Summary + toggle */}
      {hasResults && (
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3.5 rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-gray-500 dark:text-gray-400 font-medium">{done} tested</span>
            <span className="inline-flex items-center gap-1 text-sfgreen-600 dark:text-sfgreen-400 font-semibold"><CheckCircle2 size={12} /> {successCount} healthy</span>
            {partialCount > 0 && <span className="inline-flex items-center gap-1 text-sforange-600 dark:text-sforange-400 font-semibold"><AlertCircle size={12} /> {partialCount} partial</span>}
            {failedCount  > 0 && <span className="inline-flex items-center gap-1 text-sfred-600 dark:text-sfred-400 font-semibold"><XCircle size={12} /> {failedCount} failed</span>}
            {autoResolvedCount > 0 && (
              <span className="flex items-center gap-1 text-sfgreen-600/80 dark:text-sfgreen-400/80 text-xs font-medium">
                <ShieldCheck size={11} /> {autoResolvedCount} auto-creds
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {/* Status filter chips */}
            {[
              { key: 'ALL',               label: 'All',           count: null,                  cls: 'text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500' },
              { key: 'SUCCESS',           label: 'Healthy',       count: successCount,          cls: 'text-sfgreen-600 dark:text-sfgreen-400 border-sfgreen-200/60 dark:border-sfgreen-400/20 hover:border-sfgreen-300 dark:hover:border-sfgreen-400/40' },
              { key: 'PARTIAL',           label: 'Partial',       count: partialCount,          cls: 'text-sforange-600 dark:text-sforange-400 border-sforange-200/60 dark:border-sforange-400/20 hover:border-sforange-300 dark:hover:border-sforange-400/40' },
              { key: 'FAILED',            label: 'Failed',        count: failedCount,           cls: 'text-sfred-600 dark:text-sfred-400 border-sfred-200/60 dark:border-sfred-400/20 hover:border-sfred-300 dark:hover:border-sfred-400/40' },
              { key: 'CONTRACT_PENDING',  label: '🔑 Pending',    count: pendingContractCount,  cls: 'text-sforange-600 dark:text-sforange-400 border-sforange-200/60 dark:border-sforange-400/20 hover:border-sforange-300 dark:hover:border-sforange-400/40' },
              { key: 'CONTRACT_APPROVED', label: '✅ Approved',   count: approvedContractCount, cls: 'text-sfgreen-700 dark:text-sfgreen-300 border-sfgreen-300/60 dark:border-sfgreen-400/30 hover:border-sfgreen-500 dark:hover:border-sfgreen-400/60' },
            ].filter(f => f.key === 'ALL' || f.count > 0).map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-all ${f.cls} ${statusFilter === f.key ? 'shadow-sm ring-1 ring-inset ring-current bg-white dark:bg-gray-800' : 'bg-transparent hover:bg-white/60 dark:hover:bg-gray-800/60'}`}>
                {f.label}{f.count != null ? ` (${f.count})` : ''}
              </button>
            ))}
            <button onClick={() => setShowAll(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                showAll ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100' : 'bg-gradient-to-b from-sf-500 to-sf-600 border-sf-500 text-white shadow-sm shadow-sf-500/30'
              }`}>
              {showAll ? 'Show tested only' : `✓ Showing tested (${done})`}
            </button>
          </div>
        </div>
      )}

      {/* Results table */}
      {displayApps.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 overflow-hidden">
          <table className="w-full text-sm">
            {/* Feature 23: sticky App Name + Status columns */}
            <thead>
              <tr className="bg-gray-50/95 dark:bg-gray-900/90 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider backdrop-blur-sm">
                <th className="px-3 py-3 font-semibold text-center w-8 sticky left-0 z-20 bg-gray-50/95 dark:bg-gray-900/90">#</th>
                <th className="text-left px-4 py-3 font-semibold sticky left-8 z-20 bg-gray-50/95 dark:bg-gray-900/90 shadow-[2px_0_8px_rgba(0,0,0,0.08)]">Application</th>
                <th className="text-left px-3 py-3 font-semibold">Type</th>
                <th className="text-left px-3 py-3 font-semibold sticky left-64 z-20 bg-gray-50/95 dark:bg-gray-900/90 shadow-[2px_0_8px_rgba(0,0,0,0.06)]">Status</th>
                <th className="text-left px-3 py-3 font-semibold">Active Endpoint</th>
                <th className="text-center px-3 py-3 font-semibold">HTTP</th>
                <th className="text-right px-3 py-3 font-semibold">Latency</th>
                <th className="px-3 py-3 w-16 text-center font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayApps.map((app, idx) => (
                <ResultRow
                  key={`${app.id}|${app.environment?.id}`}
                  app={app}
                  result={results[app.id]}
                  autoResolved={autoResolvedMap[app.id]}
                  expandedId={expandedId}
                  setExpandedId={setExpandedId}
                  onRetry={retryApp}
                  onCheckContract={checkContractApproval}
                  checkingContract={checkingContractIds.has(app.id)}
                  retrying={retryingIds.has(app.id)}
                  onGetJwt={getJwtAndRetry}
                  jwtLoading={jwtLoadingIds.has(app.id)}
                  navigate={navigate}
                  rowNum={idx + 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
