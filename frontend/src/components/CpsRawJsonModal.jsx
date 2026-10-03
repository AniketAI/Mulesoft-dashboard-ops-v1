import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, AlertTriangle, Save, AlignLeft, ChevronUp, ChevronDown, Search, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

/* ═══════════════════════════════════════════════════
   Postman Light Palette
═══════════════════════════════════════════════════ */
const LIGHT_PM = {
  bg:          '#ffffff',
  panelBg:     '#f5f5f5',
  toolbarBg:   '#efefef',
  editorBg:    '#ffffff',
  border:      '#e0e0e0',
  borderFocus: '#ff6c37',
  orange:      '#ff6c37',
  orangeDim:   'rgba(255,108,55,0.12)',
  orangeHover: '#e05a28',
  text:        '#2d2d2d',
  textMuted:   '#666666',
  textDim:     '#bbbbbb',
  inputBg:     '#ffffff',
  // JSON syntax
  jsonKey:     '#c41a16',
  jsonString:  '#0451a5',
  jsonNumber:  '#098658',
  jsonKeyword: '#0000cc',
  jsonPunct:   '#555555',
  lineNum:     '#c0c0c0',
  lineNumBg:   '#f8f8f8',
  // Error
  errBg:       'rgba(220,38,38,0.05)',
  errBorder:   'rgba(220,38,38,0.25)',
  errText:     '#dc2626',
  overlay:     'rgba(0,0,0,0.55)',
};

/* ═══════════════════════════════════════════════════
   Postman Dark Palette (VS Code Dark+ inspired)
═══════════════════════════════════════════════════ */
const DARK_PM = {
  bg:          '#1e1e1e',
  panelBg:     '#252526',
  toolbarBg:   '#2d2d30',
  editorBg:    '#1e1e1e',
  border:      '#3c3c3c',
  borderFocus: '#ff6c37',
  orange:      '#ff8a5c',
  orangeDim:   'rgba(255,138,92,0.18)',
  orangeHover: '#ff6c37',
  text:        '#d4d4d4',
  textMuted:   '#9a9a9a',
  textDim:     '#5f5f5f',
  inputBg:     '#2d2d30',
  // JSON syntax
  jsonKey:     '#9cdcfe',
  jsonString:  '#ce9178',
  jsonNumber:  '#b5cea8',
  jsonKeyword: '#569cd6',
  jsonPunct:   '#d4d4d4',
  lineNum:     '#6a6a6a',
  lineNumBg:   '#1e1e1e',
  // Error
  errBg:       'rgba(248,81,73,0.1)',
  errBorder:   'rgba(248,81,73,0.35)',
  errText:     '#f85149',
  overlay:     'rgba(0,0,0,0.75)',
};

/* ═══════════════════════════════════════════════════
   JSON Tokenizer  (returns [{text, type, start, end}])
═══════════════════════════════════════════════════ */
function tokenizeJSON(text) {
  if (!text) return [];
  /* Groups:
     1 key-string   2 colon-suffix
     3 string-value
     4 number
     5 keyword (true/false/null)
     6 punctuation  {}[],:
     7 whitespace / plain
  */
  const RE = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],:])|([^"{\}\[\],:\d\-\ntruefals]+|\s+|.)/g;
  const tokens = [];
  let last = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) {
      tokens.push({ text: text.slice(last, m.index), type: 'plain', start: last, end: m.index });
    }
    const s = m.index;
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], type: 'key',        start: s,                   end: s + m[1].length });
      tokens.push({ text: m[2], type: 'colon',      start: s + m[1].length,     end: s + m[0].length });
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], type: 'string',     start: s, end: s + m[3].length });
    } else if (m[4] !== undefined) {
      tokens.push({ text: m[4], type: 'number',     start: s, end: s + m[4].length });
    } else if (m[5] !== undefined) {
      tokens.push({ text: m[5], type: 'keyword',    start: s, end: s + m[5].length });
    } else if (m[6] !== undefined) {
      tokens.push({ text: m[6], type: 'punctuation',start: s, end: s + m[6].length });
    } else {
      tokens.push({ text: m[7] ?? m[0], type: 'plain', start: s, end: s + (m[7] ?? m[0]).length });
    }
    last = RE.lastIndex;
  }
  if (last < text.length) {
    tokens.push({ text: text.slice(last), type: 'plain', start: last, end: text.length });
  }
  return tokens;
}

function tokenColor(type, pm) {
  switch (type) {
    case 'key':         return pm.jsonKey;
    case 'string':      return pm.jsonString;
    case 'number':      return pm.jsonNumber;
    case 'keyword':     return pm.jsonKeyword;
    case 'punctuation':
    case 'colon':       return pm.jsonPunct;
    default:            return pm.text;
  }
}

/* ═══════════════════════════════════════════════════
   Component
═══════════════════════════════════════════════════ */
export default function CpsRawJsonModal({
  isOpen,
  onClose,
  initialJson,
  onSave,
  title       = 'Edit Raw JSON',
  description = 'Paste or edit your raw JSON payload here.',
  readOnly    = false,
}) {
  const [jsonText,        setJsonText]        = useState('');
  const [error,           setError]           = useState('');
  const [findText,        setFindText]        = useState('');
  const [replaceText,     setReplaceText]     = useState('');
  const [useRegex,        setUseRegex]        = useState(false);
  const [matchCase,       setMatchCase]       = useState(false);
  const [activeMatchIdx,  setActiveMatchIdx]  = useState(0);
  const [showReplace,     setShowReplace]     = useState(false);
  const [isFullscreen,    setIsFullscreen]    = useState(false);

  const { isDark } = useTheme();
  const PM = isDark ? DARK_PM : LIGHT_PM;

  const backdropRef   = useRef(null);
  const textareaRef   = useRef(null);
  const activeMarkRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setJsonText(JSON.stringify(initialJson, null, 2));
      setError(''); setFindText(''); setReplaceText(''); setActiveMatchIdx(0);
      setIsFullscreen(false);
    }
  }, [isOpen, initialJson]);

  /* ── Build search regex ── */
  const { searchRegex, searchError } = useMemo(() => {
    if (!findText) return { searchRegex: null, searchError: '' };
    const flags = matchCase ? 'g' : 'gi';
    try {
      const r = useRegex
        ? new RegExp(findText, flags)
        : new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      return { searchRegex: r, searchError: '' };
    } catch {
      return { searchRegex: null, searchError: 'Invalid regex' };
    }
  }, [findText, useRegex, matchCase]);

  /* ── Build match ranges ── */
  const matchRanges = useMemo(() => {
    if (!searchRegex || !jsonText) return [];
    searchRegex.lastIndex = 0;
    const ranges = [];
    let m, idx = 0;
    while ((m = searchRegex.exec(jsonText)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, matchIndex: idx++ });
      if (m[0].length === 0) searchRegex.lastIndex++;
    }
    return ranges;
  }, [searchRegex, jsonText]);

  const totalMatches = matchRanges.length;

  useEffect(() => {
    if (totalMatches > 0 && activeMatchIdx >= totalMatches) setActiveMatchIdx(totalMatches - 1);
    else if (totalMatches === 0) setActiveMatchIdx(0);
  }, [totalMatches, activeMatchIdx]);

  useEffect(() => {
    if (totalMatches > 0 && activeMarkRef.current && textareaRef.current && backdropRef.current) {
      activeMarkRef.current.scrollIntoView({ block: 'center', inline: 'nearest' });
      textareaRef.current.scrollTop  = backdropRef.current.scrollTop;
      textareaRef.current.scrollLeft = backdropRef.current.scrollLeft;
    }
  }, [activeMatchIdx, totalMatches]);

  /* ── Render backdrop: syntax-highlight + search marks ── */
  const backdropContent = useMemo(() => {
    const syntaxTokens = tokenizeJSON(jsonText);
    if (matchRanges.length === 0) {
      return syntaxTokens.map((tok, i) => (
        <span key={i} style={{ color: tokenColor(tok.type, PM) }}>{tok.text}</span>
      ));
    }

    const nodes = [];
    for (const tok of syntaxTokens) {
      const { start: tS, end: tE, text: tT, type: tType } = tok;
      const color = tokenColor(tType, PM);
      const overlaps = matchRanges.filter(mr => mr.start < tE && mr.end > tS);

      if (!overlaps.length) {
        nodes.push(<span key={`p${tS}`} style={{ color }}>{tT}</span>);
        continue;
      }

      let cur = tS;
      for (const mr of overlaps.sort((a, b) => a.start - b.start)) {
        const mS = Math.max(mr.start, tS);
        const mE = Math.min(mr.end, tE);
        if (cur < mS)
          nodes.push(<span key={`pre${cur}`} style={{ color }}>{tT.slice(cur - tS, mS - tS)}</span>);
        const isActive = mr.matchIndex === activeMatchIdx;
        nodes.push(
          <mark
            key={`m${mS}`}
            ref={isActive ? activeMarkRef : null}
            style={{
              background: isActive ? 'rgba(255,108,55,0.30)' : 'rgba(255,200,0,0.38)',
              color,
              borderRadius: '2px',
            }}
          >
            {tT.slice(mS - tS, mE - tS)}
          </mark>
        );
        cur = mE;
      }
      if (cur < tE)
        nodes.push(<span key={`post${cur}`} style={{ color }}>{tT.slice(cur - tS)}</span>);
    }
    return nodes;
  }, [jsonText, matchRanges, activeMatchIdx]);

  /* ── Line numbers ── */
  const lineCount = useMemo(() => jsonText.split('\n').length || 1, [jsonText]);

  /* ── Handlers ── */
  const handleReplace = () => {
    if (!totalMatches || !searchRegex) return;
    let ci = 0;
    searchRegex.lastIndex = 0;
    setJsonText(jsonText.replace(searchRegex, match => ci++ === activeMatchIdx ? replaceText : match));
  };
  const handleReplaceAll = () => { if (searchRegex) setJsonText(jsonText.replace(searchRegex, replaceText)); };
  const handleSave = () => {
    try { const p = JSON.parse(jsonText); onSave(p); onClose(); }
    catch (e) { setError(`Invalid JSON: ${e.message}`); }
  };
  const handleFormat = () => {
    try { setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2)); setError(''); }
    catch (e) { setError(`Cannot format: ${e.message}`); }
  };

  if (!isOpen) return null;

  // ── Shared micro-styles (recomputed each render so they track the active PM) ──
  const btnBase = {
    display: 'flex', alignItems: 'center', gap: '5px',
    borderRadius: '4px', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.15s', padding: '5px 11px',
    whiteSpace: 'nowrap',
  };
  const ghostBtn = {
    ...btnBase,
    background: 'transparent',
    border: `1px solid ${PM.border}`,
    color: PM.textMuted,
  };
  const iconToggle = (active) => ({
    padding: '2px 6px', borderRadius: '3px',
    fontSize: '10px', fontFamily: 'monospace', fontWeight: 700,
    background: active ? PM.orangeDim : 'transparent',
    color: active ? PM.orange : PM.textMuted,
    border: `1px solid ${active ? PM.orange : 'transparent'}`,
    cursor: 'pointer', transition: 'all 0.15s',
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: PM.overlay,
      padding: isFullscreen ? 0 : '16px',
    }}>
      <div style={{
        background: PM.bg,
        border: isFullscreen ? 'none' : `1px solid ${PM.border}`,
        borderRadius: isFullscreen ? 0 : '8px',
        width: '100%', maxWidth: isFullscreen ? '100%' : '920px',
        maxHeight: isFullscreen ? '100vh' : '92vh', height: isFullscreen ? '100vh' : '84vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: isFullscreen ? 'none' : '0 20px 60px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>

        {/* ══ Postman-style Header / Tab bar ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 14px', height: '40px',
          background: PM.toolbarBg,
          borderBottom: `1px solid ${PM.border}`,
          flexShrink: 0,
        }}>
          {/* Left: tabs */}
          <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: '0' }}>
            {/* Active tab */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '0 14px', height: '100%',
              background: PM.bg,
              borderRight: `1px solid ${PM.border}`,
              borderLeft: `1px solid ${PM.border}`,
              borderTop: `2px solid ${PM.orange}`,
              fontSize: '12px', fontWeight: 600, color: PM.text,
              cursor: 'default',
            }}>
              <span style={{
                fontSize: '11px', fontFamily: 'monospace', fontWeight: 700,
                color: PM.orange,
              }}>{'{}'}</span>
              JSON
              {readOnly && (
                <span style={{
                  fontSize: '9px', padding: '1px 5px', borderRadius: '2px',
                  background: PM.orangeDim, color: PM.orange,
                  border: `1px solid rgba(255,108,55,0.3)`, fontWeight: 700, letterSpacing: '0.04em',
                }}>READ ONLY</span>
              )}
            </div>
          </div>

          {/* Right: title + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: PM.textMuted }}>{title}</span>
            <button
              onClick={() => setIsFullscreen(v => !v)}
              title={isFullscreen ? 'Exit full page' : 'Expand to full page'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: PM.textMuted, padding: '3px', borderRadius: '3px',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = PM.text; e.currentTarget.style.background = PM.border; }}
              onMouseLeave={e => { e.currentTarget.style.color = PM.textMuted; e.currentTarget.style.background = 'transparent'; }}
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: PM.textMuted, padding: '3px', borderRadius: '3px',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = PM.text; e.currentTarget.style.background = PM.border; }}
              onMouseLeave={e => { e.currentTarget.style.color = PM.textMuted; e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ══ Find / Replace toolbar ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
          padding: '6px 12px',
          borderBottom: `1px solid ${PM.border}`,
          background: PM.panelBg,
          flexShrink: 0,
        }}>
          {/* Find input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Search size={12} style={{ color: PM.textMuted, flexShrink: 0 }} />
            <div style={{
              display: 'flex', alignItems: 'center',
              background: PM.inputBg,
              border: `1px solid ${searchError ? '#ef4444' : PM.border}`,
              borderRadius: '3px', padding: '0 4px 0 8px', gap: '3px',
            }}>
              <input
                type="text"
                placeholder="Find…"
                value={findText}
                onChange={e => setFindText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') setActiveMatchIdx(p => p < totalMatches - 1 ? p + 1 : 0);
                }}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: '12px', color: PM.text, minWidth: '150px', padding: '4px 0',
                }}
              />
              <button onClick={() => setMatchCase(!matchCase)} style={iconToggle(matchCase)} title="Match Case">Aa</button>
              <button onClick={() => setUseRegex(!useRegex)}   style={iconToggle(useRegex)}  title="Regex">.*</button>
            </div>
          </div>

          {/* Match counter + nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ fontSize: '11px', color: PM.textMuted, minWidth: '48px', textAlign: 'center', tabularNums: true }}>
              {totalMatches > 0 ? `${activeMatchIdx + 1} / ${totalMatches}` : '0 / 0'}
            </span>
            <button
              onClick={() => setActiveMatchIdx(p => p > 0 ? p - 1 : totalMatches - 1)}
              disabled={totalMatches === 0}
              style={{
                background: PM.inputBg, border: `1px solid ${PM.border}`,
                borderRadius: '3px 0 0 3px', padding: '3px 5px', cursor: totalMatches > 0 ? 'pointer' : 'default',
                color: totalMatches === 0 ? PM.textDim : PM.textMuted,
                display: 'flex', alignItems: 'center',
              }}
            >
              <ChevronUp size={12} />
            </button>
            <button
              onClick={() => setActiveMatchIdx(p => p < totalMatches - 1 ? p + 1 : 0)}
              disabled={totalMatches === 0}
              style={{
                background: PM.inputBg, border: `1px solid ${PM.border}`, borderLeft: 'none',
                borderRadius: '0 3px 3px 0', padding: '3px 5px', cursor: totalMatches > 0 ? 'pointer' : 'default',
                color: totalMatches === 0 ? PM.textDim : PM.textMuted,
                display: 'flex', alignItems: 'center',
              }}
            >
              <ChevronDown size={12} />
            </button>
          </div>

          {/* Replace toggle (only in edit mode) */}
          {!readOnly && (
            <button
              onClick={() => setShowReplace(!showReplace)}
              style={iconToggle(showReplace)}
            >
              <RefreshCw size={10} style={{ display: 'inline', marginRight: '3px', verticalAlign: 'middle' }} />
              Replace
            </button>
          )}

          {searchError && <span style={{ fontSize: '11px', color: '#ef4444' }}>{searchError}</span>}
        </div>

        {/* ══ Replace bar (collapsible) ══ */}
        {showReplace && !readOnly && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '5px 12px',
            borderBottom: `1px solid ${PM.border}`,
            background: PM.panelBg,
            flexShrink: 0,
          }}>
            <RefreshCw size={12} style={{ color: PM.textMuted, flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Replace with…"
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              style={{
                background: PM.inputBg, border: `1px solid ${PM.border}`,
                borderRadius: '3px', padding: '4px 8px',
                fontSize: '12px', color: PM.text, outline: 'none', minWidth: '170px',
              }}
            />
            <button
              onClick={handleReplace}
              disabled={totalMatches === 0}
              style={{ ...ghostBtn, opacity: totalMatches === 0 ? 0.45 : 1 }}
              onMouseEnter={e => totalMatches > 0 && (e.currentTarget.style.color = PM.text)}
              onMouseLeave={e => (e.currentTarget.style.color = PM.textMuted)}
            >
              Replace
            </button>
            <button
              onClick={handleReplaceAll}
              disabled={totalMatches === 0}
              style={{
                ...btnBase,
                background: totalMatches === 0 ? 'transparent' : PM.orangeDim,
                border: `1px solid ${totalMatches === 0 ? PM.border : 'rgba(255,108,55,0.4)'}`,
                color: totalMatches === 0 ? PM.textDim : PM.orange,
                opacity: totalMatches === 0 ? 0.45 : 1,
              }}
            >
              Replace All
            </button>
          </div>
        )}

        {/* ══ Editor ══ */}
        <div style={{
          flex: 1, overflow: 'hidden',
          display: 'flex', flexDirection: 'row',
          borderBottom: `1px solid ${PM.border}`,
        }}>

          {/* Line numbers gutter */}
          <div style={{
            flexShrink: 0, width: '44px',
            background: PM.lineNumBg,
            borderRight: `1px solid ${PM.border}`,
            padding: '12px 0',
            overflowY: 'hidden',
            userSelect: 'none',
          }}
            onScroll={e => { if (textareaRef.current) textareaRef.current.scrollTop = e.currentTarget.scrollTop; }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} style={{
                height: '21.45px',  // matches lineHeight 1.65 × 13px
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: '10px',
                fontSize: '11px',
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
                color: PM.lineNum,
                lineHeight: '1.65',
              }}>
                {i + 1}
              </div>
            ))}
          </div>

          {/* Editor canvas (backdrop + textarea) */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

            {/* Syntax + search highlight backdrop */}
            <div
              ref={backdropRef}
              style={{
                position: 'absolute', inset: 0,
                padding: '12px 16px',
                fontSize: '13px', lineHeight: '21.45px',
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
                whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                pointerEvents: 'none',
                overflow: 'hidden',
                color: 'transparent',
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                transform: 'translateZ(0)',
                letterSpacing: 'normal',
                wordSpacing: 'normal',
                textRendering: 'optimizeSpeed',
              }}
              aria-hidden="true"
            >
              {backdropContent}
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={jsonText}
              readOnly={readOnly}
              onChange={e => { if (!readOnly) { setJsonText(e.target.value); setError(''); } }}
              onScroll={e => {
                if (backdropRef.current) {
                  backdropRef.current.scrollTop  = e.target.scrollTop;
                  backdropRef.current.scrollLeft = e.target.scrollLeft;
                }
              }}
              spellCheck={false}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                padding: '12px 16px',
                fontSize: '13px', lineHeight: '21.45px',
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
                color: 'transparent',
                caretColor: PM.orange,
                background: 'transparent',
                border: 'none', outline: 'none',
                resize: 'none',
                overflowY: 'auto', overflowX: 'hidden',
                whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                transform: 'translateZ(0)',
                letterSpacing: 'normal',
                wordSpacing: 'normal',
                textRendering: 'optimizeSpeed',
              }}
            />

            {/* Placeholder */}
            {!jsonText && (
              <div style={{
                position: 'absolute', top: '14px', left: '18px',
                color: PM.textDim, fontSize: '12px',
                fontFamily: '"JetBrains Mono", monospace', pointerEvents: 'none',
              }}>
                {'// Paste or type your JSON here…'}
              </div>
            )}
          </div>
        </div>

        {/* ══ Error banner ══ */}
        {error && (
          <div style={{ padding: '6px 12px', flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              background: PM.errBg, border: `1px solid ${PM.errBorder}`,
              borderRadius: '4px', padding: '6px 10px',
              color: PM.errText, fontSize: '12px',
            }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{error}</span>
            </div>
          </div>
        )}

        {/* ══ Footer ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px',
          background: PM.panelBg,
          flexShrink: 0,
        }}>
          <button
            onClick={handleFormat}
            style={ghostBtn}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#c0c0c0'; e.currentTarget.style.color = PM.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = PM.border; e.currentTarget.style.color = PM.textMuted; }}
          >
            <AlignLeft size={12} /> Format JSON
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onClose}
              style={ghostBtn}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#c0c0c0'; e.currentTarget.style.color = PM.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = PM.border; e.currentTarget.style.color = PM.textMuted; }}
            >
              {readOnly ? 'Close' : 'Cancel'}
            </button>

            {!readOnly && (
              <button
                onClick={handleSave}
                disabled={!!error}
                style={{
                  ...btnBase,
                  background: error ? 'rgba(255,108,55,0.15)' : PM.orange,
                  border: `1px solid ${error ? 'rgba(255,108,55,0.3)' : PM.orange}`,
                  color: error ? 'rgba(180,80,30,0.6)' : '#ffffff',
                  cursor: error ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
                onMouseEnter={e => !error && (e.currentTarget.style.background = PM.orangeHover)}
                onMouseLeave={e => !error && (e.currentTarget.style.background = PM.orange)}
              >
                <Save size={12} /> Save JSON
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}