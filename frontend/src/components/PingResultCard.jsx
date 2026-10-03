import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Clock, ChevronDown, ChevronRight, RefreshCw, Globe, Lock } from 'lucide-react';
import { ENV_BADGE, PING_STATUS_CONFIG, latencyColor } from '../utils/appUtils';
import AttemptLog from './AttemptLog';

// PingResultCard uses icon-enhanced status config — build it from the shared base
const STATUS_CONFIG = {
  SUCCESS: {
    ...PING_STATUS_CONFIG.SUCCESS,
    icon: <CheckCircle2 size={14} className="text-emerald-600" />,
    cls: 'bg-emerald-50/50 border-emerald-300/50 text-emerald-700',
  },
  PARTIAL: {
    ...PING_STATUS_CONFIG.PARTIAL,
    icon: <AlertCircle size={14} className="text-yellow-600" />,
    cls: 'bg-yellow-50/50 border-yellow-300/50 text-yellow-700',
  },
  FAILED: {
    ...PING_STATUS_CONFIG.FAILED,
    icon: <XCircle size={14} className="text-red-600" />,
    cls: 'bg-red-50/50 border-red-300/50 text-red-700',
  },
};

/**
 * PingResultCard — shows full ping details for a single app result.
 *
 * Props:
 *   app      { name, deploymentType, environment } — app metadata
 *   result   { status, activeEndpoint, responseTimeMs, httpStatus, payload, error, attempts }
 *   loading  {boolean} — true while this app is being pinged
 *   selected {boolean} — whether this card is selected for ping
 *   onToggle {function} — callback to toggle selection
 */
export default function PingResultCard({ app, result, loading, selected, onToggle, autoResolved }) {
  // Auto-expand payload for 5xx responses so the error body is immediately visible
  const [showPayload, setShowPayload] = useState(false);

  useEffect(() => {
    if (result?.payload && result?.httpStatus >= 500) setShowPayload(true);
  }, [result?.httpStatus, result?.payload]);

  const isCH1 = app?.deploymentType !== 'CloudHub 2.0';
  const cfg = result ? STATUS_CONFIG[result.status] || STATUS_CONFIG.FAILED : null;

  return (
    <div className={`border rounded-xl overflow-hidden bg-white/60 transition-all ${selected ? 'border-cyan-300/60 ring-1 ring-cyan-200' : 'border-gray-200'}`}>
      {/* App header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/60 bg-gray-100/20">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app?.environment?.type] || 'bg-gray-400'}`} />
          <div className="min-w-0">
            <p className="text-gray-900 text-sm font-medium truncate">{app?.name}</p>
            <p className="text-gray-500 text-xs mt-0.5">
              {app?.environment?.name} ·{' '}
              <span className={isCH1 ? 'text-purple-600' : 'text-blue-600'}>{isCH1 ? 'CH1' : 'CH2'}</span>
            </p>
          </div>
        </div>

        {/* Status pill + selection checkbox */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onToggle && (
            <button
              onClick={onToggle}
              title={selected ? 'Deselect' : 'Select for ping'}
              className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 ${
                selected ? 'bg-cyan-500 border-cyan-400' : 'border-gray-300 hover:border-cyan-500 bg-gray-100/60'
              }`}
            >
              {selected && <span className="text-white text-[11px] font-bold leading-none">✓</span>}
            </button>
          )}
          {loading && (
            <div className="flex items-center gap-1.5 text-gray-500 text-xs">
              <RefreshCw size={12} className="animate-spin" /> Pinging…
            </div>
          )}
          {!loading && !result && (
            <span className="text-gray-500 text-xs">Pending</span>
          )}
          {!loading && result && cfg && (
            <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold ${cfg.cls}`}>
              <span className="relative flex h-2 w-2 flex-shrink-0">
                {cfg.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.dot}`} />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
              </span>
              {cfg.icon}
              {cfg.label}
              {result.responseTimeMs != null && (
                <span className={`font-mono font-bold ml-0.5 ${latencyColor(result.responseTimeMs)}`}>
                  {result.responseTimeMs}ms
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Detail rows — only when result exists */}
      {result && (
        <div className="px-4 py-3 space-y-2.5 text-sm">
          {/* Active endpoint */}
          <div className="flex items-start gap-2">
            <Globe size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
            <span className="text-gray-500 w-28 flex-shrink-0 font-medium">Endpoint</span>
            <span className={`font-mono text-xs break-all leading-relaxed ${result.activeEndpoint ? 'text-cyan-700' : 'text-gray-500'}`}>
              {result.activeEndpoint || '—'}
            </span>
          </div>

          {/* HTTP status + response time */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-28 flex-shrink-0 font-medium">HTTP Status</span>
              {result.httpStatus != null ? (
                <span className={`font-mono font-bold text-sm ${
                  result.httpStatus < 300 ? 'text-emerald-600' :
                  result.httpStatus < 500 ? 'text-yellow-600' : 'text-red-600'
                }`}>{result.httpStatus}</span>
              ) : <span className="text-gray-500">—</span>}
            </div>
            {result.responseTimeMs != null && (
              <div className="flex items-center gap-1.5">
                <Clock size={13} className="text-gray-500" />
                <span className={`font-mono font-bold text-sm ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span>
              </div>
            )}
          </div>

          {/* Auto-resolved credential info — shown when bulk ping resolved creds automatically */}
          {autoResolved && !autoResolved.error && (
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
              autoResolved.source === 'contract-pending'
                ? 'bg-orange-50/20 border-orange-200/40 text-orange-600/80'
                : 'bg-emerald-50/20 border-emerald-200/40 text-emerald-600/80'
            }`}>
              <span className="flex-shrink-0">🔑</span>
              <span>
                {autoResolved.source === 'contract' ? 'Contract: ' : autoResolved.source === 'contract-pending' ? 'Pending: ' : ''}
                <span className="font-medium">{autoResolved.apiInstanceName}</span>
                {' → '}<span className="font-mono">{autoResolved.clientId?.slice(0, 8)}…</span>
                {autoResolved.contractApp && autoResolved.contractApp !== '—' && (
                  <span className="text-emerald-600/60"> ({autoResolved.contractApp})</span>
                )}
              </span>
            </div>
          )}

          {/* JWT auto-used indicator */}
          {result._jwtUsed && (
            <div className="flex items-center gap-1.5 text-indigo-600 text-xs bg-indigo-50/30 border border-indigo-200/40 rounded-lg px-2.5 py-1.5">
              <Lock size={11} /> JWT Bearer token was auto-fetched from CPS and used for this ping
            </div>
          )}

          {/* JWT may be required hint (PARTIAL + 401/400, no JWT yet) */}
          {result.status === 'PARTIAL' && !result._jwtUsed && (result.httpStatus === 401 || result.httpStatus === 400) && (
            <div className="flex items-center gap-1.5 text-indigo-600/70 text-xs">
              <Lock size={11} /> May require JWT token — open App Detail to auto-fetch
            </div>
          )}

          {/* Error message */}
          {result.error && (
            <div className="flex items-start gap-2 text-red-600 text-xs">
              <XCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="break-all">{result.error}</span>
            </div>
          )}

          {/* Response payload — auto-expanded for 5xx errors */}
          {result.payload && (
            <div>
              <button onClick={() => setShowPayload(!showPayload)}
                className={`flex items-center gap-1 text-xs transition-colors font-medium ${
                  result.httpStatus >= 500
                    ? 'text-red-600/80 hover:text-red-700'
                    : 'text-gray-500 hover:text-gray-900'
                }`}>
                {showPayload ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {result.httpStatus >= 500 ? `API Response (HTTP ${result.httpStatus})` : 'Response Payload'}
              </button>
              {showPayload && (
                <pre className={`mt-2 rounded-lg px-3 py-2.5 text-xs overflow-auto font-mono border leading-relaxed whitespace-pre-wrap break-all max-h-60 ${
                  result.httpStatus >= 500
                    ? 'bg-red-50/20 border-red-200/40 text-red-700/80'
                    : 'bg-[#0B0F17] border-gray-200/60 text-emerald-600/90'
                }`}>
                  {typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Attempt log — collapsible, each row expandable to show response payload */}
          {result.attempts && result.attempts.length > 0 && (
            <AttemptLog attempts={result.attempts} />
          )}
        </div>
      )}
    </div>
  );
}
