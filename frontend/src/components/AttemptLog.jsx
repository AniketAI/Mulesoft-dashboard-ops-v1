import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { latencyColor } from '../utils/appUtils';

/**
 * Collapsible attempt log with per-row expandable response payload.
 *
 * Props:
 *   attempts  — array of { url, httpStatus, responseTimeMs, error, payload }
 *   className — optional extra class on the wrapper
 *
 * Behaviour:
 *   • If any attempt has httpStatus >= 500 AND a payload, the log opens
 *     automatically and that row's payload is pre-expanded.
 */
export default function AttemptLog({ attempts, className = '' }) {
  const [showAttempts, setShowAttempts] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);

  useEffect(() => {
    if (!attempts?.length) return;
    const firstErrIdx = attempts.findIndex(a => a.httpStatus >= 500 && a.payload != null);
    if (firstErrIdx !== -1) {
      setShowAttempts(true);
      setExpandedIdx(firstErrIdx);
    }
  }, [attempts]);

  if (!attempts?.length) return null;

  return (
    <div className={className}>
      <button
        onClick={() => setShowAttempts(v => !v)}
        className="flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-xs transition-colors font-medium"
      >
        {showAttempts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Attempt Log ({attempts.length} path{attempts.length !== 1 ? 's' : ''} tried)
      </button>

      {showAttempts && (
        <div className="mt-2 border border-gray-200/60 dark:border-gray-700/60 rounded-lg overflow-hidden">
          {attempts.map((a, i) => {
            const has5xx = a.httpStatus >= 500;
            const isExpanded = expandedIdx === i;
            const hasPayload = a.payload != null;

            return (
              <div key={i} className="border-b border-gray-200/50 dark:border-gray-700/50 last:border-0">
                <button
                  onClick={() => hasPayload && setExpandedIdx(isExpanded ? null : i)}
                  className={[
                    'w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left transition-colors',
                    hasPayload ? 'hover:bg-sf-50/40 dark:hover:bg-sf-500/5 cursor-pointer' : 'cursor-default',
                    isExpanded ? 'bg-sf-50/30 dark:bg-sf-500/5' : '',
                  ].join(' ')}
                >
                  <span className="font-mono text-gray-500 dark:text-gray-400 break-all flex-1">{a.url}</span>
                  <span className="flex-shrink-0 flex items-center gap-2">
                    {a.error ? (
                      <span className="text-red-600 dark:text-red-400 text-[11px] max-w-[160px] truncate" title={a.error}>
                        {a.error}
                      </span>
                    ) : (
                      <span className={`font-bold ${
                        a.httpStatus < 300 ? 'text-emerald-600 dark:text-emerald-400'
                        : a.httpStatus < 500 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-600 dark:text-red-400'
                      }`}>
                        {a.httpStatus}
                      </span>
                    )}
                    <span className={`font-mono ${latencyColor(a.responseTimeMs)}`}>
                      {a.responseTimeMs != null ? `${a.responseTimeMs}ms` : '—'}
                    </span>
                    {hasPayload && (
                      <span className="text-gray-500 dark:text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                    )}
                  </span>
                </button>

                {isExpanded && hasPayload && (
                  <pre className={[
                    'px-3 py-2.5 text-[11px] overflow-auto font-mono border-t leading-relaxed',
                    'whitespace-pre-wrap break-all max-h-52',
                    has5xx
                      ? 'bg-red-50/40 dark:bg-red-500/5 border-red-200/40 dark:border-red-400/15 text-red-700/80 dark:text-red-300/80'
                      : 'bg-[#0B0F17] border-gray-200/40 dark:border-gray-700/40 text-emerald-600/80 dark:text-emerald-400/80',
                  ].join(' ')}>
                    {typeof a.payload === 'string'
                      ? a.payload
                      : JSON.stringify(a.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}