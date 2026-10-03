import React from 'react';

// ── Status configuration ──────────────────────────────────────────────────────
// pulse:true  → the indicator dot animates with animate-pulse to signal
//               that this is a transient / in-progress state.
const statusConfig = {
  RUNNING:           { label: 'Running',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/30', pulse: false },
  STARTED:           { label: 'Running',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/30', pulse: false },
  FAILED:            { label: 'Failed',        color: 'bg-red-50 text-red-700 border-red-200/80 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30',          pulse: false },
  DEPLOY_FAILED:     { label: 'Deploy Failed', color: 'bg-red-50 text-red-700 border-red-200/80 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30',          pulse: false },
  STOPPED:           { label: 'Stopped',       color: 'bg-gray-100 text-gray-600 border-gray-200/80 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',       pulse: false },
  UNDEPLOYED:        { label: 'Undeployed',    color: 'bg-gray-100 text-gray-600 border-gray-200/80 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',       pulse: false },
  DEPLOYING:         { label: 'Deploying',     color: 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-400/30',       pulse: true  },
  UPDATING:          { label: 'Updating',      color: 'bg-purple-50 text-purple-700 border-purple-200/80 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-400/30', pulse: true  },
  STARTING:          { label: 'Starting',      color: 'bg-blue-50 text-blue-600 border-blue-200/80 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-400/30',       pulse: true  },
  STOPPING:          { label: 'Stopping',      color: 'bg-orange-50 text-orange-700 border-orange-200/80 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-400/30', pulse: true  },
  PARTIALLY_STARTED: { label: 'Partial',       color: 'bg-yellow-50 text-yellow-700 border-yellow-200/80 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-400/30', pulse: true  },
  PARTIALLY_RUNNING: { label: 'Partial',       color: 'bg-yellow-50 text-yellow-700 border-yellow-200/80 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-400/30', pulse: true  },
  APPLIED:           { label: 'Applied',       color: 'bg-cyan-50 text-cyan-700 border-cyan-200/80 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-400/30',       pulse: false },
  APPLYING:          { label: 'Applying',      color: 'bg-cyan-50 text-cyan-600 border-cyan-200/80 dark:bg-cyan-500/10 dark:text-cyan-300 dark:border-cyan-400/30',       pulse: true  },
  NOT_RUNNING:       { label: 'Not Running',   color: 'bg-gray-100 text-gray-600 border-gray-200/80 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',       pulse: false },
  active:            { label: 'Active',        color: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/30', pulse: false },
  inactive:          { label: 'Inactive',      color: 'bg-gray-100 text-gray-600 border-gray-200/80 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',       pulse: false },
};

// In-progress states whose dot should pulse
const PULSING_STATES = new Set([
  'DEPLOYING', 'UPDATING', 'STARTING', 'STOPPING',
  'APPLYING', 'PARTIALLY_STARTED', 'PARTIALLY_RUNNING',
]);

export default function StatusBadge({ status }) {
  const key = (status || '').toUpperCase();
  const config = statusConfig[key] || statusConfig[status] || {
    label: status || 'Unknown',
    color: 'bg-gray-100 text-gray-600 border-gray-200/80 dark:bg-gray-700/40 dark:text-gray-400 dark:border-gray-600/40',
    pulse: false,
  };

  const shouldPulse = config.pulse || PULSING_STATES.has(key);

  return (
    <span
      role="status"
      aria-label={`Status: ${config.label}`}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border shadow-sm ${config.color}`}
    >
      <span className="relative flex w-1.5 h-1.5 mr-1.5 flex-shrink-0">
        {shouldPulse && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />}
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
      </span>
      {config.label}
    </span>
  );
}
