import React, { useRef } from 'react';
import { Upload, Key, X, ShieldCheck } from 'lucide-react';
import { useCredentialStore } from '../context/CredentialStoreContext';

/**
 * CredentialImportButton (Ping credentials)
 *
 * Renders either:
 *   - An "Import Credentials CSV" button (when no credentials are loaded)
 *   - A "N creds loaded" badge + clear button (when credentials are in memory)
 *
 * The implementation now delegates to the generic ImportButton component.
 * CpsCredentialImportButton is a separate thin component that passes
 * different colours/labels — both share zero duplicated code.
 *
 * Props:
 *   compact {boolean}  – smaller size variant for tight toolbars
 */
export default function CredentialImportButton({ compact = false }) {
  const { loadedCount, hasCredentials, loadFromCsv, clearCredentials } =
    useCredentialStore();

  return (
    <ImportCredentialButton
      loadedCount={loadedCount}
      hasCredentials={hasCredentials}
      loadFromCsv={loadFromCsv}
      clearCredentials={clearCredentials}
      compact={compact}
      accentColor="emerald"
      loadedLabel={(n) => `${n} creds`}
      importLabel="Ping Creds"
      logPrefix="[CredentialImport]"
      ariaLabel="Import credentials CSV file"
      importTitle="Import your client_id/client_secret CSV — parsed locally, never uploaded"
      loadedTitle="Credentials are loaded in memory only — never stored to disk or sent to the server"
      clearTitle="Clear all credentials from memory"
    />
  );
}

// ── Generic import button ─────────────────────────────────────────────────────

const ACCENT = {
  emerald: {
    iconBg:  'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
    iconHoverBg: 'group-hover/import:bg-emerald-100 dark:group-hover/import:bg-emerald-500/20 group-hover/import:text-emerald-600 dark:group-hover/import:text-emerald-400',
    badge:   'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/30 text-emerald-700 dark:text-emerald-300',
    hoverBorder: 'hover:border-emerald-300/60 dark:hover:border-emerald-400/40',
    hoverText:   'hover:text-emerald-700 dark:hover:text-emerald-300',
  },
  purple: {
    iconBg:  'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400',
    iconHoverBg: 'group-hover/import:bg-purple-100 dark:group-hover/import:bg-purple-500/20 group-hover/import:text-purple-600 dark:group-hover/import:text-purple-400',
    badge:   'bg-purple-50 dark:bg-purple-500/10 border-purple-200/60 dark:border-purple-400/30 text-purple-700 dark:text-purple-300',
    hoverBorder: 'hover:border-purple-300/60 dark:hover:border-purple-400/40',
    hoverText:   'hover:text-purple-700 dark:hover:text-purple-300',
  },
  indigo: {
    iconBg:  'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
    iconHoverBg: 'group-hover/import:bg-indigo-100 dark:group-hover/import:bg-indigo-500/20 group-hover/import:text-indigo-600 dark:group-hover/import:text-indigo-400',
    badge:   'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200/60 dark:border-indigo-400/30 text-indigo-700 dark:text-indigo-300',
    hoverBorder: 'hover:border-indigo-300/60 dark:hover:border-indigo-400/40',
    hoverText:   'hover:text-indigo-700 dark:hover:text-indigo-300',
  },
};

/**
 * Generic credential import button.
 * Shared by CredentialImportButton (ping), CpsCredentialImportButton (CPS),
 * and GlobalCpsCsvUpload (global BG creds).
 * Not exported as part of the public API — use the named wrappers instead.
 */
export function ImportCredentialButton({
  loadedCount,
  hasCredentials,
  loadFromCsv,
  clearCredentials,
  compact = false,
  accentColor = 'emerald',
  loadedLabel,
  importLabel,
  logPrefix,
  ariaLabel,
  importTitle,
  loadedTitle,
  clearTitle,
}) {
  const inputRef = useRef(null);
  const accent = ACCENT[accentColor] || ACCENT.emerald;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const count = loadFromCsv(ev.target.result);
      console.info(`${logPrefix} Loaded ${count} credential pairs from "${file.name}" (in-memory only)`);
    };
    reader.onerror = () => {
      console.error(`${logPrefix} Failed to read file`);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-imported if needed
    e.target.value = '';
  };

  const iconSize = compact ? 11 : 12;
  const chipPad = compact ? 'pl-1 pr-1.5 py-1' : 'pl-1.5 pr-2 py-1.5';

  if (hasCredentials) {
    return (
      <div
        className={`group/chip flex items-center gap-1 ${chipPad} rounded-xl border transition-all ${accent.badge}`}
        title={loadedTitle}
      >
        <span className={`flex items-center justify-center w-5 h-5 rounded-lg flex-shrink-0 ${accent.iconBg}`}>
          <Key size={iconSize - 1} />
        </span>
        <span className={`font-semibold ${compact ? 'text-[10px]' : 'text-xs'} whitespace-nowrap`}>
          {loadedLabel(loadedCount)}
        </span>
        <ShieldCheck size={iconSize} className="opacity-50 flex-shrink-0" />
        <button
          onClick={clearCredentials}
          title={clearTitle}
          className="flex items-center justify-center w-5 h-5 rounded-lg text-current opacity-40 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 hover:text-red-600 dark:hover:text-red-400 transition-all flex-shrink-0"
        >
          <X size={compact ? 11 : 12} />
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="hidden"
        aria-label={ariaLabel}
      />
      <button
        onClick={() => inputRef.current?.click()}
        title={importTitle}
        className={`group/import flex items-center gap-1.5 ${chipPad} ${compact ? 'pr-2.5' : 'pr-3'} rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-800/40 text-gray-500 dark:text-gray-400 ${accent.hoverText} ${accent.hoverBorder} hover:border-solid hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all font-medium`}
      >
        <span className={`flex items-center justify-center w-5 h-5 rounded-lg bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400 ${accent.iconHoverBg} flex-shrink-0 transition-colors`}>
          <Upload size={iconSize - 1} />
        </span>
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} whitespace-nowrap`}>{importLabel}</span>
      </button>
    </>
  );
}
