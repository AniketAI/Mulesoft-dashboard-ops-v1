import React, { useState, useRef } from 'react';
import { X, Upload, RefreshCw, AlertTriangle, Check, FileText } from 'lucide-react';
import { parseCsvLine } from '../utils/csvCredentialStore';
import api from '../services/api';

/**
 * CpsImportModal
 *
 * Bulk import CPS properties from a CSV or JSON file.
 * File is parsed client-side; user reviews a preview before confirming.
 * Calls PUT /api/cps/write with the merged property map.
 *
 * Props:
 *   baseUrl       {string}   CPS server base URL
 *   type          {string}   'non-secure' | 'secure'
 *   environment   {string}   CPS environment prefix
 *   projectKey    {string}   CPS project key
 *   bgOrgId       {string}   Business Group org ID
 *   isProd        {boolean}  Production warning flag
 *   existingProps {object}   Current { key: value } map (for conflict detection)
 *   onClose       {function}
 *   onImported    {function} Called after successful import
 */
export default function CpsImportModal({
  baseUrl,
  type = 'non-secure',
  environment,
  projectKey,
  bgOrgId,
  isProd = false,
  existingProps = {},
  onClose,
  onImported,
}) {
  const fileInputRef = useRef(null);
  const [parsedRows, setParsedRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [conflictMode, setConflictMode] = useState('overwrite');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const parseFile = (file) => {
    setFileName(file.name);
    setParsedRows(null);
    setParseError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result || '';
      try {
        if (file.name.endsWith('.json')) {
          const json = JSON.parse(text);
          let rows = [];
          if (Array.isArray(json)) {
            rows = json.map(item =>
              typeof item === 'object' && item.key
                ? { key: String(item.key), value: String(item.value ?? '') }
                : null
            ).filter(Boolean);
          } else if (json.properties && typeof json.properties === 'object') {
            rows = Object.entries(json.properties).map(([k, v]) => ({ key: k, value: String(v ?? '') }));
          } else {
            rows = Object.entries(json).map(([k, v]) => ({ key: k, value: String(v ?? '') }));
          }
          if (rows.length === 0) { setParseError('No valid key-value pairs found in JSON'); return; }
          setParsedRows(rows);
        } else {
          // CSV: key,value per line; auto-detect header
          const lines = text.split(/\r?\n/).filter(l => l.trim());
          if (lines.length === 0) { setParseError('File is empty'); return; }

          const firstCells = parseCsvLine(lines[0]);
          const isHeader = firstCells[0]?.toLowerCase().includes('key') || firstCells[0]?.toLowerCase().includes('property');
          const dataLines = isHeader ? lines.slice(1) : lines;

          const rows = dataLines
            .map(line => {
              const cells = parseCsvLine(line);
              const key = cells[0]?.replace(/^"|"$/g, '').trim();
              const value = cells[1]?.replace(/^"|"$/g, '') ?? '';
              return key ? { key, value } : null;
            })
            .filter(Boolean);

          if (rows.length === 0) { setParseError('No valid key-value rows found in CSV'); return; }
          setParsedRows(rows);
        }
      } catch (err) {
        setParseError(`Failed to parse file: ${err.message}`);
      }
    };
    reader.onerror = () => setParseError('Failed to read file');
    reader.readAsText(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const conflicts = parsedRows
    ? parsedRows.filter(r => r.key in existingProps && existingProps[r.key] !== r.value)
    : [];
  const newKeys = parsedRows
    ? parsedRows.filter(r => !(r.key in existingProps))
    : [];

  const handleImport = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    setImportError('');
    setImporting(true);

    // Apply conflict mode
    const toImport = parsedRows.filter(r => {
      if (!(r.key in existingProps)) return true; // new key — always include
      return conflictMode === 'overwrite'; // existing key — only include if overwrite
    });

    if (toImport.length === 0) {
      setImportError('No properties to import after applying conflict handling');
      setImporting(false);
      return;
    }

    // Merge: start from existing, apply imports
    const merged = { ...existingProps };
    toImport.forEach(({ key, value }) => { merged[key] = value; });

    try {
      await api.post('/cps/write', {
        baseUrl,
        type,
        method: 'PUT',
        environment,
        projectKey,
        properties: merged,
        bgOrgId,
      });
      onImported?.({ count: toImport.length, conflictCount: conflicts.length, mergedProps: merged });
      onClose();
    } catch (err) {
      setImportError(err.response?.data?.error || err.message || 'Import failed');
    }
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-300 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50/50 border border-blue-200/40">
              <Upload size={15} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-gray-900 font-semibold text-base">Import Properties from CSV / JSON</h2>
              <p className="text-gray-500 text-xs mt-0.5">
                {projectKey} · {environment}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Production warning */}
          {isProd && (
            <div className="flex items-start gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3">
              <AlertTriangle size={13} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs">
                <strong>PRODUCTION</strong> — imported properties will be applied immediately via PUT.
              </p>
            </div>
          )}

          {/* Drop zone */}
          {!parsedRows && (
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300/60 hover:border-gray-300 bg-gray-100/20 rounded-xl px-6 py-10 text-center cursor-pointer transition-colors"
            >
              <Upload size={28} className="text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-500">Drop CSV or JSON file here, or click to browse</p>
              <p className="text-[10px] text-gray-500 mt-1">
                CSV: <code>key,value</code> per line &nbsp;·&nbsp; JSON: <code>{"{ key: value }"}</code> object
              </p>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".csv,.json,text/csv,application/json" onChange={handleFileSelect} className="hidden" />

          {/* Parse error */}
          {parseError && (
            <div className="flex items-center gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-xs">
              <AlertTriangle size={12} className="flex-shrink-0" /> {parseError}
            </div>
          )}

          {/* Parsed preview */}
          {parsedRows && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5">
                  <FileText size={11} /> {fileName}
                </div>
                <span className="text-xs text-emerald-600 font-medium">{parsedRows.length} properties found</span>
                {conflicts.length > 0 && (
                  <span className="text-xs text-yellow-600 font-medium">{conflicts.length} conflicts</span>
                )}
                {newKeys.length > 0 && (
                  <span className="text-xs text-blue-600 font-medium">{newKeys.length} new keys</span>
                )}
                <button
                  onClick={() => { setParsedRows(null); setFileName(''); }}
                  className="text-[10px] text-gray-500 hover:text-gray-900 underline ml-auto"
                >
                  Change file
                </button>
              </div>

              {/* Conflict handling */}
              {conflicts.length > 0 && (
                <div className="bg-yellow-50/20 border border-yellow-200/40 rounded-xl px-4 py-3 space-y-2">
                  <p className="text-xs text-yellow-600 font-medium">
                    {conflicts.length} properties already exist with different values. How to handle conflicts?
                  </p>
                  <div className="flex gap-2">
                    {[
                      { value: 'overwrite', label: 'Overwrite existing', cls: 'bg-orange-100 border-orange-300/40 text-orange-700' },
                      { value: 'skip', label: 'Skip conflicts', cls: 'bg-gray-200 border-gray-300 text-gray-600' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setConflictMode(opt.value)}
                        className={`text-xs px-3 py-1 rounded-lg border font-medium transition-all ${
                          conflictMode === opt.value ? opt.cls : 'bg-gray-100 border-gray-300 text-gray-500'
                        }`}
                      >
                        {conflictMode === opt.value && <Check size={10} className="inline mr-1" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div className="border border-gray-300/50 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-100/50 border-b border-gray-300/40">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Preview</span>
                  <span className="text-[10px] text-gray-500">{parsedRows.length} rows</span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {parsedRows.map((row, i) => {
                    const isConflict = row.key in existingProps && existingProps[row.key] !== row.value;
                    const isNew = !(row.key in existingProps);
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-3 px-3 py-2 border-b border-gray-200/30 last:border-0 ${
                          isConflict ? 'bg-yellow-50/10' : isNew ? 'bg-emerald-50/10' : ''
                        }`}
                      >
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
                          isConflict ? 'bg-yellow-100 text-yellow-600' :
                          isNew ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200/60 text-gray-500'
                        }`}>
                          {isConflict ? 'CONFLICT' : isNew ? 'NEW' : 'UPDATE'}
                        </span>
                        <span className="font-mono text-[10px] text-gray-600 truncate w-48">{row.key}</span>
                        <span className="font-mono text-[10px] text-gray-500 truncate flex-1">{row.value || '(empty)'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Import error */}
          {importError && (
            <div className="flex items-center gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-xs">
              <AlertTriangle size={12} className="flex-shrink-0" /> {importError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 gap-3 flex-shrink-0">
          <p className="text-gray-500 text-xs">
            {parsedRows
              ? `${conflictMode === 'overwrite' ? parsedRows.length : parsedRows.length - conflicts.length} properties will be imported`
              : 'Select a CSV or JSON file to continue'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !parsedRows || parsedRows.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {importing
                ? <><RefreshCw size={13} className="animate-spin" /> Importing…</>
                : <><Upload size={13} /> Import All ({parsedRows ? (conflictMode === 'overwrite' ? parsedRows.length : parsedRows.length - conflicts.length) : 0})</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}