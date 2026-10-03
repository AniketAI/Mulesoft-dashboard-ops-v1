import React, { useState } from 'react';
import { ChevronDown, ChevronUp, X, Clock, Copy, Check } from 'lucide-react';

// ── Method badge — Postman's method color scheme ──────────────────────────────
function MethodBadge({ method }) {
  const colors = {
    GET:    'text-emerald-600',
    POST:   'text-amber-600',
    PUT:    'text-blue-600',
    DELETE: 'text-red-600',
    PATCH:  'text-purple-600',
    HEAD:   'text-gray-500',
    OPTIONS:'text-purple-600',
  };
  const cls = colors[(method || '').toUpperCase()] || 'text-gray-500';
  return (
    <span className={`text-[11px] font-bold uppercase tracking-wide flex-shrink-0 ${cls}`}>
      {method}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const isSuccess = status >= 200 && status < 300;
  const isClientErr = status >= 400 && status < 500;
  const isServerErr = status >= 500;
  const cls = isSuccess
    ? 'bg-emerald-100 text-emerald-600 border-emerald-300/40'
    : isClientErr
    ? 'bg-red-100 text-red-600 border-red-300/40'
    : isServerErr
    ? 'bg-orange-100 text-orange-600 border-orange-300/40'
    : 'bg-gray-100 text-gray-500 border-gray-300/40';
  const label = isSuccess ? 'OK' : isClientErr ? 'Client Error' : isServerErr ? 'Server Error' : '';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
      {status} {label}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyCodeBtn({ text }) {
  const [done, setDone] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      onClick={handle}
      title="Copy to clipboard"
      className="flex items-center gap-1 text-[9px] text-gray-500 hover:text-gray-900 transition-colors px-1.5 py-0.5 rounded border border-gray-300/50 hover:border-gray-300/60 bg-gray-100/60"
    >
      {done ? <Check size={9} className="text-emerald-600" /> : <Copy size={9} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Format JSON (or plain string) for display ─────────────────────────────────
function formatJson(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

// ── Postman-style JSON syntax highlighting ────────────────────────────────────
// Tokenizes a line of JSON text into { text, type } pieces so each piece can be
// coloured like Postman's "Pretty" JSON viewer: keys in rose, strings in green,
// numbers in blue, booleans/null in purple, punctuation in gray.
const JSON_TOKEN_RE = /"(?:[^"\\]|\\.)*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+\.?\d*(?:[eE][+-]?\d+)?/g;

const TOKEN_CLASS = {
  key:    'text-rose-600 font-medium',
  string: 'text-emerald-700',
  number: 'text-blue-600',
  bool:   'text-purple-600 font-medium',
  null:   'text-gray-400 italic',
  punct:  'text-gray-500',
};

function highlightJsonLine(line) {
  const nodes = [];
  let lastIndex = 0;
  let m;
  JSON_TOKEN_RE.lastIndex = 0;
  while ((m = JSON_TOKEN_RE.exec(line)) !== null) {
    if (m.index > lastIndex) nodes.push({ text: line.slice(lastIndex, m.index), type: 'punct' });
    const token = m[0];
    let type = 'punct';
    if (token.startsWith('"')) type = m[1] ? 'key' : 'string';
    else if (token === 'true' || token === 'false') type = 'bool';
    else if (token === 'null') type = 'null';
    else type = 'number';
    nodes.push({ text: token, type });
    lastIndex = m.index + token.length;
  }
  if (lastIndex < line.length) nodes.push({ text: line.slice(lastIndex), type: 'punct' });
  return nodes;
}

// ── Code block — Postman "Pretty" viewer: white panel, line numbers, JSON syntax colors ──
function CodeBlock({ value, isError = false }) {
  const text = formatJson(value);
  if (!text) return <p className="text-[10px] text-gray-500 italic">empty</p>;
  const isJsonLike = typeof value !== 'string';
  const lines = text.split('\n');
  return (
    <div className={`relative group/code rounded-lg border overflow-hidden ${isError ? 'border-red-200/50' : 'border-gray-200'}`}>
      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
        <CopyCodeBtn text={text} />
      </div>
      <pre className={`m-0 flex text-[10px] font-mono leading-relaxed overflow-x-auto max-h-52 overflow-y-auto ${
        isError ? 'bg-red-50/30' : 'bg-white'
      }`}>
        <code className="flex-shrink-0 select-none text-right pr-2.5 pl-3 py-2 text-gray-300 dark:text-gray-600 border-r border-gray-100 bg-gray-50/60">
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </code>
        <code className={`flex-1 pl-3 pr-3 py-2 whitespace-pre-wrap break-words ${isError ? 'text-red-700/85' : 'text-gray-700'}`}>
          {lines.map((line, i) => (
            <div key={i}>
              {isError || !isJsonLike
                ? (line || '\u00A0')
                : highlightJsonLine(line).map((tok, ti) => (
                    <span key={ti} className={TOKEN_CLASS[tok.type]}>{tok.text}</span>
                  ))}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CpsRequestResponsePanel
//
// Props:
//   operation  {object}   Last operation info:
//     label          {string}   e.g. 'Save Properties'
//     timestamp      {string}   ISO timestamp
//     requestDetails {object}   { method, url, body?, params?, headers? }
//     responseDetails{object}   { status, body }
//     success        {boolean}
//   onDismiss  {function}  Called when user clicks ✕
// ─────────────────────────────────────────────────────────────────────────────
export default function CpsRequestResponsePanel({ operation, onDismiss }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!operation) return null;

  const { label, timestamp, requestDetails = {}, responseDetails = {}, success } = operation;
  const { method, url, body, params, headers } = requestDetails;
  const { status, body: resBody } = responseDetails;
  const isError = !success || (status !== undefined && status >= 400);

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      isError ? 'border-red-200/50 bg-red-50/10' : 'border-gray-300/50 bg-white/80'
    }`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none hover:bg-white/5 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 flex-shrink-0">
            Last Operation
          </span>
          {label && (
            <span className="text-[10px] text-gray-600 font-medium truncate">{label}</span>
          )}
          {success !== undefined && (
            success
              ? <span className="text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-300/40 px-1.5 py-0.5 rounded-full flex-shrink-0">✓ Success</span>
              : <span className="text-[9px] text-red-600 bg-red-50 border border-red-300/40 px-1.5 py-0.5 rounded-full flex-shrink-0">✗ Failed</span>
          )}
          {status !== undefined && <StatusBadge status={status} />}
          {timestamp && (
            <span className="text-[9px] text-gray-500 flex items-center gap-1 flex-shrink-0">
              <Clock size={8} />
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          {collapsed
            ? <ChevronDown size={13} className="text-gray-500" />
            : <ChevronUp size={13} className="text-gray-500" />
          }
          <button
            onClick={e => { e.stopPropagation(); onDismiss?.(); }}
            title="Dismiss"
            className="text-gray-500 hover:text-gray-900 p-0.5 rounded transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 border-t border-gray-200/60 divide-y md:divide-y-0 md:divide-x divide-gray-200/60">
          {/* Request pane */}
          <div className="p-4 space-y-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Request</p>

            {/* Method + URL — Postman address-bar style */}
            {(method || url) && (
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                {method && <MethodBadge method={method} />}
                {url && (
                  <span className="font-mono text-[10px] text-gray-700 break-all leading-snug">{url}</span>
                )}
              </div>
            )}

            {/* Query params */}
            {params && Object.keys(params).length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Query Params</p>
                <CodeBlock value={params} />
              </div>
            )}

            {/* Headers (sanitized — no credentials) */}
            {headers && Object.keys(headers).length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Headers</p>
                <CodeBlock value={headers} />
              </div>
            )}

            {/* Request body */}
            {body !== undefined && body !== null && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Body</p>
                <CodeBlock value={body} />
              </div>
            )}

            {!method && !url && !body && !params && (
              <p className="text-[10px] text-gray-500 italic">No request details available</p>
            )}
          </div>

          {/* Response pane */}
          <div className="p-4 space-y-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Response</p>

            {status !== undefined && (
              <div>
                <StatusBadge status={status} />
              </div>
            )}

            {resBody !== undefined && resBody !== null ? (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-500 uppercase tracking-wider font-medium">Body</p>
                <CodeBlock value={resBody} isError={isError} />
              </div>
            ) : status !== undefined ? (
              <p className="text-[10px] text-gray-500 italic">Empty response body</p>
            ) : (
              <p className="text-[10px] text-gray-500 italic">No response details available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}