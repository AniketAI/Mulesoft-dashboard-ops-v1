/**
 * Shared application lifecycle and UI utilities.
 *
 * availableActions and ACTION_CONFIG were independently defined in both
 * ApplicationsPage and ApplicationDetailPage with identical logic.
 * Centralising them prevents the allowed-action rules or button styles
 * from drifting between the list view and the detail view.
 *
 * latencyColor, ENV_BADGE, and STATUS_CONFIG (ping) were duplicated across
 * PingResultCard, PingTestPanel, and PingTestPage.
 */

import { Play, Square, RotateCcw } from 'lucide-react';

// ── App lifecycle actions ─────────────────────────────────────────────────────

/**
 * Determine which lifecycle actions are available for an app based on its
 * current status.
 *
 * @param {string} status  Normalised application status string
 * @returns {Array<'start'|'stop'|'restart'>}
 */
export function availableActions(status) {
  const s = (status || '').toUpperCase();
  if (['RUNNING', 'STARTED', 'PARTIALLY_STARTED', 'PARTIALLY_RUNNING'].includes(s)) {
    return ['stop', 'restart'];
  }
  if (['STOPPED', 'FAILED', 'DEPLOY_FAILED', 'UNDEPLOYED', 'NOT_RUNNING'].includes(s)) {
    return ['start'];
  }
  return [];
}

/**
 * Visual configuration for each lifecycle action.
 *
 * `btnCls`   — used on per-row icon-only buttons in the applications table
 *              (bordered chip at rest, fills solid + glows on hover)
 * `bulkCls`  — used on solid buttons (bulk toolbar actions, confirm modals)
 *              (gradient fill + colored glow shadow, lifts on hover)
 * `detailCls`— detail-page variant (slightly different border style)
 */
export const ACTION_CONFIG = {
  start: {
    label:   'Start',
    Icon:    Play,
    btnCls:  'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/70 dark:border-emerald-400/30 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-500/30',
    bulkCls: 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-md shadow-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/40 ring-1 ring-inset ring-white/20',
    // Detail page variant (slightly different border style)
    detailCls: 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-400/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300',
  },
  stop: {
    label:   'Stop',
    Icon:    Square,
    btnCls:  'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200/70 dark:border-red-400/30 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-md hover:shadow-red-500/30',
    bulkCls: 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white shadow-md shadow-red-500/30 hover:shadow-lg hover:shadow-red-500/40 ring-1 ring-inset ring-white/20',
    detailCls: 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-400/30 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300',
  },
  restart: {
    label:   'Restart',
    Icon:    RotateCcw,
    btnCls:  'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-200/70 dark:border-blue-400/30 hover:bg-blue-600 hover:text-white hover:border-blue-600 hover:shadow-md hover:shadow-blue-500/30',
    bulkCls: 'bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40 ring-1 ring-inset ring-white/20',
    detailCls: 'text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-400/30 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-700 dark:hover:text-blue-300',
  },
};

// ── Environment badge colours ─────────────────────────────────────────────────

/**
 * Tailwind dot-colour class for environment type badges.
 * Used on environment indicator dots in the applications list and ping result cards.
 */
export const ENV_BADGE = {
  production: 'bg-green-400',
  sandbox:    'bg-yellow-400',
  design:     'bg-blue-400',
};

// ── Ping result configuration ─────────────────────────────────────────────────

/**
 * Visual configuration for each ping test result status.
 * Used by PingResultCard and PingTestPage to render status pills consistently.
 */
export const PING_STATUS_CONFIG = {
  SUCCESS: {
    label: 'Healthy',
    cls:   'text-emerald-700 bg-emerald-50 border-emerald-200',
    dot:   'bg-emerald-500',
    ping:  true,
  },
  PARTIAL: {
    label: 'Partial',
    cls:   'text-yellow-700 bg-yellow-50 border-yellow-200',
    dot:   'bg-yellow-500',
    ping:  false,
  },
  FAILED: {
    label: 'Unreachable',
    cls:   'text-red-700 bg-red-50 border-red-200',
    dot:   'bg-red-500',
    ping:  false,
  },
  SKIPPED_CONTRACT_PENDING: {
    label: 'Contract Pending',
    cls:   'text-orange-700 bg-orange-50 border-orange-200',
    dot:   'bg-orange-500',
    ping:  false,
  },
};

// ── Latency colour ────────────────────────────────────────────────────────────

/**
 * Return a Tailwind text-colour class based on response latency.
 *
 * @param {number|null} ms  Response time in milliseconds
 * @returns {string}
 */
export function latencyColor(ms) {
  if (!ms) return 'text-gray-500';
  if (ms < 300) return 'text-emerald-600';
  if (ms < 1000) return 'text-yellow-600';
  return 'text-red-600';
}

// ── Transaction ID generation ────────────────────────────────────────────────

/**
 * Generate a unique transaction ID for ping requests.
 * Uses `crypto.randomUUID()` when available, with a manual fallback.
 *
 * @returns {string}
 */
export function generateTxId() {
  try { return crypto.randomUUID(); } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── CSV download ──────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of a CSV string.
 *
 * @param {string[][]} rows     2-D array of cell values (first row = headers)
 * @param {string}     filename Desired filename including `.csv` extension
 */
export function downloadCsv(rows, filename) {
  const csv = rows
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a browser download of a JSON object.
 *
 * @param {object} data     JSON object to download
 * @param {string} filename Desired filename including `.json` extension
 */
export function downloadJson(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Ping URL construction ─────────────────────────────────────────────────────

/**
 * Returns an optional domain-qualifier segment to insert between the env slug
 * and the shared "internalapi" base hostname.
 *
 * Some environment families are routed through a dedicated sub-domain:
 *
 *   EI-FI-FINANCIALS-*  →  "fin"
 *     {app}.stage.fin.internalapi.sfdcbt.net
 *
 * Add more rules here as new environment families are discovered.
 *
 * @param {string} normalizedEnvName  Upper-cased environment name
 * @returns {string}  qualifier segment, or empty string for standard envs
 */
export function getDomainQualifier(normalizedEnvName) {
  // EI-FI-FINANCIALS-* environments — explicit "FINANCIALS" keyword only
  if (normalizedEnvName.includes('FINANCIALS')) return 'fin';
  // if (/-SEC-/.test(normalizedEnvName)) return 'sec';
  return '';
}

/**
 * Build the ping URL for a CloudHub 1.0 application.
 *
 * Standard pattern:
 *   {appName}.{envSlug}.internalapi.sfdcbt.net
 *
 * With domain qualifier (e.g. EI-FI-FINANCIALS-* environments):
 *   {appName}.{envSlug}.fin.internalapi.sfdcbt.net
 *
 * envSlug mapping from environment name:
 *   "PROD" / "Production" / "EI-PROD"          → "prod"
 *   "EI-STAGING" / "EI-STAGING2" / "STAG"      → "stage"
 *   "EI-UAT"                                   → "uat"
 *   "EI-DEV"                                   → "dev"
 *   "EI-QA"                                    → "qa"
 *   "EI-SANDBOX" / "FI-SANDBOX" / "SB"         → "sb"
 *   "EI-FI-FINANCIALS-STAGING"                 → "stage" with "fin" qualifier
 *   other                                       → lower-case env name
 *
 * Falls back to app.domain / app.defaultDomain when the env name cannot be mapped.
 *
 * @param {string} appName   Application name (used as hostname label)
 * @param {string} envName   Environment display name
 * @returns {string}
 */
export function buildPingUrl(appName, envName) {
  const name = (appName || '').toLowerCase();
  const n = (envName || '').toUpperCase();

  // Map env name → slug
  // Note: "STAG" catches STAGING/STAGE; /\bSTG\b/ catches STG tier suffix (e.g. EI-FI-FINANCIALS-STG)
  let envSlug;
  if (n.includes('PROD'))                                   envSlug = 'prod';
  else if (n.includes('STAG') || /\bSTG\b/.test(n))        envSlug = 'stage';
  else if (n.includes('UAT'))                               envSlug = 'stage'; // UAT envs use .stage. subdomain
  else if (n.includes('DEV'))                               envSlug = 'stage'; // DEV envs also use .stage.
  else if (n.includes('QA'))                                envSlug = 'stage'; // QA envs also use .stage.
  else if (n.includes('SAND') || n.includes('SB'))          envSlug = 'stage'; // Sandbox envs also use .stage.
  else                                                      envSlug = 'stage'; // All non-PROD environments use .stage.

  if (!name || !envSlug) return '';

  // Insert optional domain qualifier between envSlug and internalapi
  // e.g. EI-FI-FINANCIALS-STAGING → slug=stage, qualifier=fin
  //      → ei-app.stage.fin.internalapi.sfdcbt.net
  const qualifier = getDomainQualifier(n);
  const domainPart = qualifier ? `${envSlug}.${qualifier}` : envSlug;
  return `${name}.${domainPart}.internalapi.sfdcbt.net`;
}