import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, RefreshCw, Copy, Check, Clock, Database, Server, Settings, Globe, Search, Eye, EyeOff, Zap, AlertTriangle, X, Key, Package, ChevronDown, ExternalLink, Activity, Share2, ShieldCheck, Trash2, GitBranch, Layers, Hash, Boxes } from 'lucide-react';
import api from '../services/api';
import CpsSettingsModal from '../components/CpsSettingsModal';
import CpsRawJsonModal from '../components/CpsRawJsonModal';
import PostmanJsonViewer from '../components/PostmanJsonViewer';
import PingTestPanel from '../components/PingTestPanel';
import CopyBtn from '../components/CopyBtn';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { availableActions, ACTION_CONFIG } from '../utils/appUtils';
import cronstrue from 'cronstrue';

/* ── Cron next-run calculator ──────────────────────────── */
/**
 * Computes the next scheduled run date from a cron expression.
 * Supports:
 *   5-field Unix cron  : min hr dom mon dow
 *   6-field Quartz cron: sec min hr dom mon dow
 *   7-field Quartz cron: sec min hr dom mon dow year
 * Returns a Date object, or null if the expression cannot be parsed / matched.
 */
function getNextCronRun(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') return null;
  try {
    const parts = cronExpr.trim().replace(/\s+/g, ' ').split(' ');
    if (parts.length < 5 || parts.length > 7) return null;

    // Parse one cron field into a Set of valid integer values.
    // Returns null for wildcards (* or ?) meaning "any value matches".
    const parseField = (field, min, max) => {
      if (field === '*' || field === '?') return null;
      const vals = new Set();
      for (const seg of field.split(',')) {
        if (seg.includes('/')) {
          const [rangePart, stepStr] = seg.split('/');
          const step = Math.max(1, parseInt(stepStr, 10));
          let start = min, end = max;
          if (rangePart !== '*' && rangePart !== '') {
            if (rangePart.includes('-')) {
              const [a, b] = rangePart.split('-').map(Number);
              start = a; end = b;
            } else {
              start = parseInt(rangePart, 10);
            }
          }
          for (let i = start; i <= end; i += step) vals.add(i);
        } else if (seg.includes('-')) {
          const [a, b] = seg.split('-').map(Number);
          for (let i = a; i <= b; i++) vals.add(i);
        } else {
          const n = parseInt(seg, 10);
          if (!isNaN(n)) vals.add(n);
        }
      }
      return vals.size > 0 ? vals : null;
    };

    let secF, minF, hrF, domF, monF, dowF;
    if (parts.length === 5) {
      // Unix cron: min hr dom mon dow  (seconds fixed to 0)
      secF = new Set([0]);
      minF = parseField(parts[0], 0, 59);
      hrF  = parseField(parts[1], 0, 23);
      domF = parseField(parts[2], 1, 31);
      monF = parseField(parts[3], 1, 12);
      dowF = parseField(parts[4], 0, 6); // 0=Sun…6=Sat
    } else {
      // Quartz cron: sec min hr dom mon dow [year]
      secF = parseField(parts[0], 0, 59);
      minF = parseField(parts[1], 0, 59);
      hrF  = parseField(parts[2], 0, 23);
      domF = parseField(parts[3], 1, 31);
      monF = parseField(parts[4], 1, 12);
      // Quartz dow: 1=SUN…7=SAT  →  JS getDay(): 0=SUN…6=SAT
      const rawDow = parseField(parts[5], 1, 7);
      dowF = rawDow ? new Set([...rawDow].map(d => d - 1)) : null;
    }

    // hit(set, val) → true if set is null (wildcard) or contains val
    const hit = (set, val) => set === null || set.has(val);
    // nextHigher(set, cur) → lowest value in set that is > cur, or null if none
    const nextHigher = (set, cur) => {
      const arr = [...set].filter(v => v > cur).sort((a, b) => a - b);
      return arr.length > 0 ? arr[0] : null;
    };

    // DOM/DOW OR-logic: when both are restricted (non-wildcard), Quartz says "either can trigger"
    const domRaw = parts.length === 5 ? parts[2] : parts[3];
    const dowRaw = parts.length === 5 ? parts[4] : parts[5];
    const domWild = domRaw === '*' || domRaw === '?';
    const dowWild = dowRaw === '*' || dowRaw === '?';

    const d = new Date();
    d.setMilliseconds(0);
    d.setSeconds(d.getSeconds() + 1); // start searching from the next second

    const limit = new Date(d.getTime() + 366 * 24 * 3600 * 1000); // search up to 1 year ahead

    while (d <= limit) {
      // ── Month (JS 0-indexed → cron 1-indexed) ────────────────────────────
      if (!hit(monF, d.getMonth() + 1)) {
        const nxt = nextHigher(monF, d.getMonth() + 1);
        if (nxt === null) { d.setFullYear(d.getFullYear() + 1, 0, 1); d.setHours(0, 0, 0); }
        else              { d.setMonth(nxt - 1, 1); d.setHours(0, 0, 0); }
        continue;
      }
      // ── Day-of-month / Day-of-week ────────────────────────────────────────
      const domOk = hit(domF, d.getDate());
      const dowOk = hit(dowF, d.getDay());
      const dayOk = (!domWild && !dowWild) ? (domOk || dowOk)  // both specified → OR
                  : domWild                 ? dowOk              // only DOW matters
                  :                          domOk;              // only DOM matters
      if (!dayOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0); continue; }
      // ── Hour ──────────────────────────────────────────────────────────────
      if (!hit(hrF, d.getHours())) {
        const nxt = nextHigher(hrF, d.getHours());
        if (nxt === null) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0); }
        else              { d.setHours(nxt, 0, 0); }
        continue;
      }
      // ── Minute ────────────────────────────────────────────────────────────
      if (!hit(minF, d.getMinutes())) {
        const nxt = nextHigher(minF, d.getMinutes());
        if (nxt === null) { d.setHours(d.getHours() + 1, 0, 0); }
        else              { d.setMinutes(nxt, 0); }
        continue;
      }
      // ── Second ────────────────────────────────────────────────────────────
      if (!hit(secF, d.getSeconds())) {
        const nxt = nextHigher(secF, d.getSeconds());
        if (nxt === null) { d.setMinutes(d.getMinutes() + 1, 0); }
        else              { d.setSeconds(nxt); }
        continue;
      }
      return new Date(d); // all fields match → found next run
    }
    return null; // no match within 1 year
  } catch {
    return null;
  }
}

/* ── Micro components ──────────────────────────────────── */

// CopyBtn is imported from components/CopyBtn (hover-fade shared component).
// CopyGroupBtn is unique to this page — always visible, orange tint, used for JSON copying.

// Always-visible copy button (no hover-fade) — used only in the secure group header
const CopyGroupBtn = ({ text }) => {
  const [done, setDone] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); };
  return (
    <button onClick={copy} className="flex items-center gap-1 p-1.5 rounded-lg text-sforange-600 dark:text-sforange-400 hover:text-sforange-700 dark:hover:text-sforange-300 hover:bg-sforange-100 dark:hover:bg-sforange-500/10 transition-all flex-shrink-0" title="Copy as JSON">
      {done ? <Check size={10} className="text-emerald-600"/> : <Copy size={10}/>}
    </button>
  );
};

const SecretVal = ({ value }) => {
  const [show, setShow] = useState(false);
  const isSecret = /^\*+$/.test(String(value));
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">{show || !isSecret ? String(value) : '••••••••••••'}</span>
      {isSecret && (
        <button onClick={() => setShow(!show)} className="text-gray-400 dark:text-gray-500 hover:text-sf-600 dark:hover:text-sf-400 flex-shrink-0 transition-colors">
          {show ? <EyeOff size={11}/> : <Eye size={11}/>}
        </button>
      )}
    </span>
  );
};

const TAG_COLORS = {
  cyan:   'text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20 bg-sfteal-50 dark:bg-sfteal-500/10',
  blue:   'text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20 bg-sf-50 dark:bg-sf-500/10',
  purple: 'text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 bg-sfpurple-50 dark:bg-sfpurple-500/10',
  green:  'text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 bg-emerald-50 dark:bg-emerald-500/10',
  red:    'text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 bg-red-50 dark:bg-red-500/10',
  orange: 'text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20 bg-sforange-50 dark:bg-sforange-500/10',
  gray:   'text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60 bg-gray-100/60 dark:bg-gray-800/60',
};

const MetaTag = ({ children, color = 'cyan' }) => (
  <span className={`font-mono text-[11px] px-2 py-0.5 rounded-md border font-medium ${TAG_COLORS[color] || TAG_COLORS.gray} leading-none`}>{children}</span>
);

// Solid dot colors for the small namespace indicator in the Properties table —
// kept separate from TAG_COLORS (which mixes bg/text/border for pill chips).
const NS_DOT_COLORS = {
  blue: 'bg-sf-400 dark:bg-sf-500',
  cyan: 'bg-sfteal-400 dark:bg-sfteal-500',
  purple: 'bg-sfpurple-400 dark:bg-sfpurple-500',
  green: 'bg-emerald-400 dark:bg-emerald-500',
  orange: 'bg-sforange-400 dark:bg-sforange-500',
  red: 'bg-red-400 dark:bg-red-500',
};

const PulseDot = ({ active }) => (
  <span className="relative flex h-2 w-2 flex-shrink-0">
    {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"/>}
    <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600'}`}/>
  </span>
);

const KVRow = ({ label, value, mono, secret }) => (
  <div className="group relative flex items-start gap-3 py-2.5 px-4 rounded-xl hover:bg-sf-50/50 dark:hover:bg-sf-500/5 transition-colors -mx-4">
    <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-0 group-hover:h-4 rounded-full bg-sf-400 dark:bg-sf-500 transition-all duration-200"/>
    <span className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex-shrink-0 w-40 pt-0.5">{label}</span>
    <div className="flex items-start gap-1.5 flex-1 min-w-0">
      {secret ? <SecretVal value={value}/> :
        <span className={`${mono?'font-mono text-xs text-gray-700 dark:text-gray-300':'text-sm text-gray-700 dark:text-gray-300'} break-all leading-relaxed`}>
          {value != null && value !== '' ? value : <span className="text-gray-400 dark:text-gray-600">—</span>}
        </span>
      }
      {value && <CopyBtn text={String(value)}/>}
    </div>
  </div>
);

const CARD_ACCENTS = {
  blue:   { chip:'bg-gradient-to-br from-sf-500 to-sf-600 shadow-sf-500/30',             border:'border-sf-200/60 dark:border-sf-400/15',             headerBg:'bg-sf-50/60 dark:bg-sf-500/5',             badge:'bg-sf-100 dark:bg-sf-500/15 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20' },
  purple: { chip:'bg-gradient-to-br from-sfpurple-500 to-sfpurple-600 shadow-sfpurple-500/30', border:'border-sfpurple-200/60 dark:border-sfpurple-400/15', headerBg:'bg-sfpurple-50/60 dark:bg-sfpurple-500/5', badge:'bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20' },
  cyan:   { chip:'bg-gradient-to-br from-sfteal-500 to-sfteal-600 shadow-sfteal-500/30',  border:'border-sfteal-200/60 dark:border-sfteal-400/15',    headerBg:'bg-sfteal-50/60 dark:bg-sfteal-500/5',    badge:'bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20' },
  orange: { chip:'bg-gradient-to-br from-sforange-500 to-sforange-600 shadow-sforange-500/30', border:'border-sforange-200/60 dark:border-sforange-400/15', headerBg:'bg-sforange-50/60 dark:bg-sforange-500/5', badge:'bg-sforange-100 dark:bg-sforange-500/15 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' },
  green:  { chip:'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30', border:'border-emerald-200/60 dark:border-emerald-400/15', headerBg:'bg-emerald-50/60 dark:bg-emerald-500/5', badge:'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20' },
  gray:   { chip:'bg-gray-200/80 dark:bg-gray-700',                                       border:'border-gray-200/70 dark:border-gray-700/60',         headerBg:'bg-gray-50/70 dark:bg-gray-800/40',        badge:'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60' },
};

const GlassCard = ({ icon: Icon, title, count, accent='gray', children, noPad }) => {
  const a = CARD_ACCENTS[accent] || CARD_ACCENTS.gray;
  return (
    <div className={`group rounded-2xl border ${a.border} bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 hover:shadow-xl transition-all duration-300 overflow-hidden`}>
      <div className={`flex items-center gap-3 px-5 py-4 border-b ${a.border} ${a.headerBg}`}>
        {Icon && (
          <div className={`flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 shadow-sm ${a.chip} ${accent==='gray' ? 'text-gray-500 dark:text-gray-400' : 'text-white shadow-lg'}`}>
            <Icon size={13} />
          </div>
        )}
        <span className="text-gray-800 dark:text-gray-100 font-semibold text-sm">{title}</span>
        {count != null && <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold border ${a.badge}`}>{count}</span>}
      </div>
      <div className={noPad?'':'px-5 py-4'}>{children}</div>
    </div>
  );
};

const HERO_ACTION_ACCENTS = {
  sf:      { chip:'bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400',             chipHover:'group-hover:bg-sf-600 group-hover:text-white',             text:'group-hover:text-sf-700 dark:group-hover:text-sf-300' },
  sfteal:  { chip:'bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-600 dark:text-sfteal-400', chipHover:'group-hover:bg-sfteal-600 group-hover:text-white',    text:'group-hover:text-sfteal-700 dark:group-hover:text-sfteal-300' },
  emerald: { chip:'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', chipHover:'group-hover:bg-emerald-600 group-hover:text-white', text:'group-hover:text-emerald-700 dark:group-hover:text-emerald-300' },
};

const HeroActionBtn = ({ icon: Icon, label, accent='sf', onClick, title }) => {
  const a = HERO_ACTION_ACCENTS[accent] || HERO_ACTION_ACCENTS.sf;
  return (
    <button type="button" onClick={onClick} title={title}
      className="group flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-medium text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 hover:border-transparent hover:bg-white dark:hover:bg-gray-800 hover:shadow-md transition-all">
      <span className={`flex items-center justify-center w-6 h-6 rounded-lg transition-all duration-200 ${a.chip} ${a.chipHover}`}>
        <Icon size={12} />
      </span>
      <span className={`transition-colors ${a.text}`}>{label}</span>
    </button>
  );
};

const STAT_TILE_ACCENTS = {
  blue:    { chip:'bg-gradient-to-br from-sf-500 to-sf-600 shadow-sf-500/30',             ring:'group-hover:border-sf-300/70 dark:group-hover:border-sf-500/40' },
  teal:    { chip:'bg-gradient-to-br from-sfteal-500 to-sfteal-600 shadow-sfteal-500/30',  ring:'group-hover:border-sfteal-300/70 dark:group-hover:border-sfteal-500/40' },
  purple:  { chip:'bg-gradient-to-br from-sfpurple-500 to-sfpurple-600 shadow-sfpurple-500/30', ring:'group-hover:border-sfpurple-300/70 dark:group-hover:border-sfpurple-500/40' },
  emerald: { chip:'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30', ring:'group-hover:border-emerald-300/70 dark:group-hover:border-emerald-500/40' },
  amber:   { chip:'bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-500/30',     ring:'group-hover:border-amber-300/70 dark:group-hover:border-amber-500/40' },
  red:     { chip:'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30',           ring:'group-hover:border-red-300/70 dark:group-hover:border-red-500/40' },
  gray:    { chip:'bg-gray-300 dark:bg-gray-700',                                          ring:'group-hover:border-gray-300/70 dark:group-hover:border-gray-600/50' },
};

// Hero-style stat tile used atop the Overview tab — surfaces the handful of facts
// that matter most at a glance, instead of burying them in a flat KV list.
const StatTile = ({ icon: Icon, label, value, sub, accent='blue' }) => {
  const a = STAT_TILE_ACCENTS[accent] || STAT_TILE_ACCENTS.blue;
  return (
    <div className={`group relative rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md px-4 py-3.5 shadow-sm hover:shadow-lg transition-all duration-300 ${a.ring}`}>
      <div className="flex items-center gap-3">
        <div className={`flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 text-white shadow-md ${a.chip}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase">{label}</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate" title={typeof value === 'string' ? value : undefined}>
            {value ?? <span className="text-gray-400 dark:text-gray-600 font-normal">—</span>}
          </p>
          {sub && <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
};

// Groups KVRows within a card under a small uppercase section label with a divider —
// turns a long flat list of facts into scannable, named clusters.
const SectionLabel = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-1.5 pt-1 pb-1.5 mt-1 first:mt-0">
    {Icon && <Icon size={10} className="text-gray-400 dark:text-gray-500" />}
    <span className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase">{children}</span>
    <span className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
  </div>
);

/* ── Action helpers ────────────────────────────────────── */
// availableActions and ACTION_CONFIG are imported from utils/appUtils.
// Use detailCls (detail-page border style) instead of btnCls for action buttons here.

function AppConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, appName } = state;
  const cfg = ACTION_CONFIG[action];
  const { Icon, label, bulkCls } = cfg;
  const dangerous = action === 'stop';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl flex-shrink-0 ${dangerous ? 'bg-red-50 dark:bg-red-500/10' : 'bg-sf-50 dark:bg-sf-500/10'}`}>
            <AlertTriangle size={20} className={dangerous ? 'text-red-600 dark:text-red-400' : 'text-sf-600 dark:text-sf-400'} />
          </div>
          <div className="flex-1">
            <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base mb-1">{label} Application?</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Are you sure you want to <span className="font-semibold text-gray-900 dark:text-gray-100">{label.toLowerCase()}</span>{' '}
              <span className="font-mono text-sf-700 dark:text-sf-300 text-xs bg-sf-50 dark:bg-sf-500/15 px-1.5 py-0.5 rounded-md">{appName}</span>?
            </p>
            {dangerous && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ This will stop all running flows and connections.</p>}
          </div>
          <button onClick={onCancel} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${bulkCls}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : <><Icon size={13} /> Confirm {label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function SchedulerConfirmModal({ schedulerKey, onConfirm, onCancel, loading }) {
  if (!schedulerKey) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl flex-shrink-0 bg-sfpurple-50 dark:bg-sfpurple-500/10">
            <Zap size={20} className="text-sfpurple-600 dark:text-sfpurple-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base mb-1">Run Scheduler Now?</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Are you sure you want to trigger{' '}
              <span className="font-mono text-sfpurple-700 dark:text-sfpurple-300 text-xs bg-sfpurple-50 dark:bg-sfpurple-500/15 px-1.5 py-0.5 rounded-md">{schedulerKey}</span>{' '}
              immediately?
            </p>
            <p className="text-amber-600 dark:text-amber-400 text-xs mt-2 font-medium">⚠ This will execute the scheduler flow outside its normal schedule.</p>
          </div>
          <button onClick={onCancel} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 bg-gradient-to-b from-sfpurple-500 to-sfpurple-600 hover:from-sfpurple-400 hover:to-sfpurple-500 text-white shadow-md shadow-sfpurple-500/30 hover:shadow-lg hover:shadow-sfpurple-500/40 ring-1 ring-inset ring-white/20">
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Running…</>
              : <><Zap size={13} /> Run Now</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContractConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, appName } = state;
  const isRevoke = action === 'revoke';
  const isDelete = action === 'delete';
  const dangerous = isDelete || isRevoke;
  const confirmCls = isDelete
    ? 'bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white shadow-md shadow-red-500/30 hover:shadow-lg hover:shadow-red-500/40 ring-1 ring-inset ring-white/20'
    : isRevoke
    ? 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white shadow-md shadow-red-500/30 hover:shadow-lg hover:shadow-red-500/40 ring-1 ring-inset ring-white/20'
    : 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white shadow-md shadow-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/40 ring-1 ring-inset ring-white/20';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl mx-4">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl flex-shrink-0 ${dangerous ? 'bg-red-50 dark:bg-red-500/10' : 'bg-emerald-50 dark:bg-emerald-500/10'}`}>
            {isDelete ? <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              : isRevoke ? <X size={20} className="text-red-600 dark:text-red-400" />
              : <Check size={20} className="text-emerald-600 dark:text-emerald-400" />}
          </div>
          <div className="flex-1">
            <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base mb-1">
              {isDelete ? 'Delete Contract?' : isRevoke ? 'Revoke Contract?' : 'Approve Contract?'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Are you sure you want to{' '}
              <span className={`font-semibold ${dangerous ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {isDelete ? 'permanently delete' : isRevoke ? 'revoke' : 'approve'}
              </span>{' '}
              the contract for{' '}
              <span className="font-mono text-sf-700 dark:text-sf-300 text-xs bg-sf-50 dark:bg-sf-500/15 px-1.5 py-0.5 rounded-md">{appName}</span>?
            </p>
            {isDelete && (
              <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ This action is irreversible. The contract will be permanently removed.</p>
            )}
            {isRevoke && !isDelete && (
              <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ The client application will immediately lose access to this API.</p>
            )}
          </div>
          <button onClick={onCancel} className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl disabled:opacity-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${confirmCls}`}>
            {loading
              ? <><span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /> Working…</>
              : isDelete
                ? <><Trash2 size={13} /> Delete</>
                : isRevoke
                  ? <><X size={13} /> Revoke</>
                  : <><Check size={13} /> Approve</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────── */

export default function ApplicationDetailPage() {
  const { orgId: authOrgId } = useAuth();
  const { orgId: paramOrgId, envId, appId } = useParams();
  const orgId = paramOrgId || authOrgId;
  const navigate = useNavigate();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [propSearch, setPropSearch] = useState('');
  const [schedulerSearch, setSchedulerSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const { getSecret, hasCredentials: hasCpsCsvCredentials, getAllCredentials } = useCpsCredentialStore();
  const [cpsCredsResolved, setCpsCredsResolved] = useState(false);

  // Feature 3: resolve BG name and env name for context badges
  const [bgName, setBgName] = useState('');
  const [resolvedEnvName, setResolvedEnvName] = useState('');
  useEffect(() => {
    if (!orgId) return;
    api.get('/organizations/business-groups').then(r => {
      const groups = r.data?.data || [];
      const match = groups.find(g => g.id === orgId);
      if (match) setBgName(match.name);
    }).catch(() => {});
  }, [orgId]);
  useEffect(() => {
    if (!orgId || !envId) return;
    api.get(`/environments/${orgId}`).then(r => {
      const envs = r.data?.data || r.data?.environments || r.data || [];
      const match = (Array.isArray(envs) ? envs : []).find(e => e.id === envId);
      if (match) setResolvedEnvName(match.name);
    }).catch(() => {});
  }, [orgId, envId]);

  // CH2 schedulers from dedicated /schedulers endpoint
  const [ch2PrivateIPs, setCh2PrivateIPs] = useState([]);
  const [ch2Schedulers, setCh2Schedulers] = useState(null);
  const [schedulersLoading, setSchedulersLoading] = useState(false);
  // CPS properties fetched specifically to resolve ${...} placeholders in scheduler expressions
  const [cpsSchedulerProps, setCpsSchedulerProps] = useState({});
  const [cpsSecureSchedulerLoading, setCpsSecureSchedulerLoading] = useState(false);
  // Scheduler trigger state
  const [triggerLoadingSet, setTriggerLoadingSet] = useState(new Set());
  const [triggerResult, setTriggerResult] = useState(null);
  const [schedulerConfirmKey, setSchedulerConfirmKey] = useState(null);

  // Ping spec from Exchange (auto-fetched when app has application.ref)
  const [pingSpec, setPingSpec] = useState(null);
  const [pingSpecLoading, setPingSpecLoading] = useState(false);

  // Feature 4: contracts tab state
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contracts, setContracts] = useState(null);
  const [contractsError, setContractsError] = useState('');
  const [contractApiInstanceId, setContractApiInstanceId] = useState(null);
  const [contractActionLoading, setContractActionLoading] = useState(null); // contractId being actioned
  const [contractActionResult, setContractActionResult] = useState(null);   // { success, message }
  const [contractConfirmState, setContractConfirmState] = useState(null);   // { contractId, action, appName }

  // Feature 4: load contracts — defined here (before early returns) to satisfy Rules of Hooks.
  // Resolves the API Manager instance the same way PingTestPanel does:
  //   Step 1 — extract CPS config from ARM deployment properties
  //   Step 2 — post CPS credentials so the CPS server accepts the fetch
  //   Step 3 — fetch CPS non-secure to discover the Autodiscovery api.id
  //   Step 4 — pass apiId to /health/auto-credentials for a direct Layer 1 lookup
  //   Step 5 — fetch contracts for the matched API Manager instance
  const loadContracts = useCallback(async () => {
    if (!orgId || !envId) return;
    setContractsLoading(true);
    setContractsError('');
    setContracts(null);
    try {
      const appData = app;
      let apiId;

      // ── Step 1-3: get api.id from CPS non-secure properties ──────────────
      if (appData) {
        const ds = appData.target?.deploymentSettings || {};
        const appCfg = appData.application?.configuration || {};
        const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
        const armProps = {
          ...appData.properties,
          ...(propsSvc.properties || {}),
          ...(ds.properties || {}),
          ...(ds.environmentVariables || ds.environmentVars || {}),
        };
        const cpsUrl  = armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'] || '';
        const cpsKey  = armProps['cps.projectName'] || armProps['cloudhub.api.name'] || appData.name || '';
        const cpsPfx  = armProps['cps.prefix'] || armProps['cps.environment'] || '';
        const cpsCId  = armProps['cps.clientId'] || armProps['cps.client_id'] ||
                        armProps['cps.client.id'] || armProps['cps.apiClientId'] || '';

        if (cpsUrl && cpsKey) {
          // Post CPS creds to backend session if available
          if (cpsCId && hasCpsCsvCredentials) {
            const secret = getSecret(cpsCId);
            if (secret) {
              try {
                const credKey = `${cpsUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}::${orgId}`;
                await api.post('/cps/credentials', { credentials: { [credKey]: { clientId: cpsCId, clientSecret: secret } } });
              } catch {}
            }
          }
          try {
            const r = await api.get('/cps/fetch', { params: { baseUrl: cpsUrl, type: 'non-secure', keys: cpsKey, ...(cpsPfx && { environment: cpsPfx }), bgOrgId: orgId } });
            const data = r.data;
            let props = {};
            if (Array.isArray(data?.responses)) data.responses.forEach(r2 => Object.assign(props, r2.properties || {}));
            else if (Array.isArray(data)) data.forEach(r2 => { if (r2?.properties) Object.assign(props, r2.properties); });
            else if (data && typeof data === 'object') {
              const fv = Object.values(data)[0];
              props = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
            }
            // Find numeric api.id
            const findId = () => {
              const isValidId = v => /^\d+$/.test(String(v).trim()) && String(v).trim() !== '0';
              if ('api.id' in props && isValidId(props['api.id'])) return String(props['api.id']).trim();
              const e1 = Object.entries(props).find(([k]) => k.endsWith('.api.id'));
              if (e1 && isValidId(e1[1])) return String(e1[1]).trim();
              const e2 = Object.entries(props).find(([k, v]) => k.endsWith('.id') && isValidId(v));
              if (e2) return String(e2[1]).trim();
              if ('id' in props && isValidId(props['id'])) return String(props['id']).trim();
              return null;
            };
            apiId = findId();
          } catch {}
        }
      }

      // ── Step 4: find API Manager instance (Layer 1 if apiId, else fuzzy) ─
      const acRes = await api.post('/health/auto-credentials', {
        orgId, envId,
        appName: appData?.name,
        ...(apiId && { apiId }),
      });
      const instanceId = acRes.data?.matchedApis?.[0]?.id;
      if (!instanceId) {
        setContractsError('No API Manager instance found for this application. Ensure it is registered in API Manager.');
        setContractsLoading(false);
        return;
      }

      // ── Step 5: fetch contracts ───────────────────────────────────────────
      setContractApiInstanceId(instanceId);
      const contractsRes = await api.get(`/apis/${orgId}/${envId}/${instanceId}/contracts`);
      const raw = contractsRes.data?.contracts || contractsRes.data || [];
      setContracts(Array.isArray(raw) ? raw : []);
    } catch (e) {
      setContractsError(e.response?.data?.error || e.message || 'Failed to load contracts');
    }
    setContractsLoading(false);
  }, [orgId, envId, app, hasCpsCsvCredentials, getSecret]);

  // Contract action handler (approve / revoke / delete)
  const handleContractAction = useCallback(async () => {
    if (!contractConfirmState || !contractApiInstanceId) return;
    const { contractId, action, appName } = contractConfirmState;
    setContractActionLoading(contractId);
    try {
      if (action === 'delete') {
        await api.delete(`/apis/${orgId}/${envId}/${contractApiInstanceId}/contracts/${contractId}`);
        setContracts(prev => Array.isArray(prev)
          ? prev.filter(c => c.id !== contractId)
          : prev
        );
        setContractActionResult({
          success: true,
          message: `✓ Contract for "${appName}" deleted successfully`,
        });
      } else {
        const newStatus = action === 'approve' ? 'APPROVED' : 'REVOKED';
        await api.patch(`/apis/${orgId}/${envId}/${contractApiInstanceId}/contracts/${contractId}`, { status: newStatus });
        setContracts(prev => Array.isArray(prev)
          ? prev.map(c => (c.id === contractId ? { ...c, status: newStatus } : c))
          : prev
        );
        setContractActionResult({
          success: true,
          message: `✓ Contract for "${appName}" ${action === 'approve' ? 'approved' : 'revoked'} successfully`,
        });
      }
    } catch (e) {
      setContractActionResult({
        success: false,
        message: `✗ Failed to ${action} contract: ${e.response?.data?.error || e.message}`,
      });
    } finally {
      setContractActionLoading(null);
      setContractConfirmState(null);
      setTimeout(() => setContractActionResult(null), 6000);
    }
  }, [contractConfirmState, contractApiInstanceId, orgId, envId]);

  // CPS state
  const [copiedCpsNs, setCopiedCpsNs] = useState(false);
  const [copiedCpsSec, setCopiedCpsSec] = useState(false);
  const [cpsLoading, setCpsLoading] = useState(false);
  const [cpsData, setCpsData] = useState(null);
  const [cpsError, setCpsError] = useState('');
  const [cpsMissingCred, setCpsMissingCred] = useState(null);
  const [showCpsSettings, setShowCpsSettings] = useState(false);
  const [rawJsonView, setRawJsonView] = useState(null); // { title: string, data: any }
  const [cpsSearch, setCpsSearch] = useState('');
  const [depSearch, setDepSearch] = useState('');
  const [cpsKeyOverride, setCpsKeyOverride] = useState('');
  const [cpsEnvOverride, setCpsEnvOverride] = useState('');
  const [cpsAttemptedUrl, setCpsAttemptedUrl] = useState('');
  const [secureLoading, setSecureLoading] = useState(false);
  const [binaryLoading, setBinaryLoading] = useState(false);
  const [cpsOpen, setCpsOpen] = useState({ ns: true, sec: false, bin: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`);
      setApp(res.data);
      // CH2 Private Space static outbound IPs
      const targetId = res.data?.target?.targetId || '';
      const isPrivate = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
      if (isPrivate) {
        try {
          const psRes = await api.get(`/applications/private-spaces/${orgId}/${targetId}`);
          const ips = psRes.data?.network?.outboundStaticIps || [];
          if (Array.isArray(ips) && ips.length) setCh2PrivateIPs(ips.filter(Boolean));
        } catch { /* not accessible */ }
      }
    } catch {
      try {
        const res2 = await api.get(`/applications/cloudhub1/${envId}/${appId}`, { params: { orgId } });
        const c = res2.data;
        let sch = [];
        try {
          const sr = await api.get(`/applications/cloudhub1/${envId}/${appId}/schedules`, { params: { orgId } });
          sch = Array.isArray(sr.data) ? sr.data : (sr.data?.schedules || []);
        } catch {}
        // Fetch actual static IP addresses from dedicated endpoint when enabled
        let staticIPs = [];
        if (c.staticIPsEnabled) {
          try {
            const sipRes = await api.get(`/applications/cloudhub1/${envId}/${appId}/static-ips`, { params: { orgId } });
            const sipArr = Array.isArray(sipRes.data) ? sipRes.data
              : (sipRes.data?.staticIps || sipRes.data?.staticIPs || sipRes.data?.items || []);
            staticIPs = sipArr
              .map(s => typeof s === 'string' ? s : (s.ipAddress || s.staticIPAddress || s.address || s.ip))
              .filter(Boolean);
          } catch { /* endpoint not available — fall through to raw field check */ }
        }
        // Fallback: check raw response field names (some API versions include them inline)
        if (staticIPs.length === 0) {
          const rawIPs = c.staticIPs || c.staticIps || c.staticIPAddresses || c.ipAddresses || [];
          if (Array.isArray(rawIPs) && rawIPs.length > 0) {
            staticIPs = rawIPs.map(s => typeof s === 'string' ? s : (s.ipAddress || s.address || s.ip)).filter(Boolean);
          }
        }
        setApp({ _type:'ch1', id:c.domain, name:c.domain, status:c.status, region:c.region,
          muleVersion:typeof c.muleVersion==='string'?c.muleVersion:c.muleVersion?.version,
          lastModifiedDate:c.lastUpdateTime?new Date(c.lastUpdateTime).toISOString():null,
          properties:c.properties||{}, persistentQueues:c.persistentQueues,
          staticIPsEnabled:c.staticIPsEnabled,
          staticIPs,
          loggingCustomLog4JEnabled:c.loggingCustomLog4JEnabled,
          monitoringEnabled:c.monitoringAutoRestart??c.monitoringEnabled,
          workers:{ amount:typeof c.workers==='number'?c.workers:c.workers?.amount, type:c.workerType||c.workers?.type },
          _ch1Schedules:sch, _raw:c });
      } catch { setApp(null); }
    }
    setLoading(false);
  }, [orgId, envId, appId]);

  // Load CH2 schedulers from dedicated endpoint when infrastructure tab is opened.
  // If any scheduler expression is a ${...} placeholder, also silently fetch
  // CPS non-secure properties to resolve the actual cron values.
  const loadCh2Schedulers = useCallback(async () => {
    if (app?._type === 'ch1' || ch2Schedulers !== null) return;
    setSchedulersLoading(true);
    try {
      const res = await api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}/schedulers`);
      const rawItems = Array.isArray(res.data) ? res.data
        : (res.data?.schedulers || res.data?.items || []);
      const items = rawItems;
      if (items.length > 0) {
        console.log('[Schedulers] raw sample item:', JSON.stringify(items[0], null, 2));
      }
      setCh2Schedulers(items);

      // Auto-resolve CPS properties for ${...} placeholder expressions
      const hasPlaceholders = items.some(s =>
        (s.expression || s.schedule?.expression || '').includes('${')
      );
      if (hasPlaceholders) {
        // Extract CPS config from app ARM props
        const appDs = app.target?.deploymentSettings || {};
        const appCfg2 = app.application?.configuration || {};
        const ps2 = appCfg2['mule.agent.application.properties.service'] || {};
        const rp = { ...ps2.properties, ...appDs.properties, ...appDs.environmentVariables, ...app.properties };
        const cpsBUrl = rp['cps.configServerBaseUrl'] || rp['config.server.base.url'];
        const cpsK = rp['cps.projectName'] || rp['cloudhub.api.name'] || app.name;
        const cpsE = rp['cps.prefix'] || rp['cps.environment'];
        const cpsCId = rp['cps.clientId'] || rp['cps.client_id'] || rp['cps.client.id'] || rp['cps.apiClientId'];
        if (cpsBUrl && cpsK) {
          try {
            // Post CPS credentials if available
            if (cpsCId) {
              try {
                const normBase = cpsBUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
                await api.post('/cps/credentials', { credentials: { [`${normBase}::${orgId}`]: {} } });
              } catch { /* non-fatal */ }
            }
            const cpsRes = await api.get('/cps/fetch', {
              params: { baseUrl: cpsBUrl, type: 'non-secure', keys: cpsK, ...(cpsE && { environment: cpsE }), bgOrgId: orgId }
            });
            const data = cpsRes.data;
            let flat = {};
            if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(flat, r.properties || {}));
            else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(flat, r.properties); });
            else if (data && typeof data === 'object') {
              const fv = Object.values(data)[0];
              flat = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
            }
            if (Object.keys(flat).length > 0) setCpsSchedulerProps(flat);
          } catch { /* CPS not available — placeholders will show as unresolved */ }
        }
      }
    } catch {
      setCh2Schedulers([]);
    }
    setSchedulersLoading(false);
  }, [orgId, envId, appId, ch2Schedulers, app]);

  useEffect(() => { if (orgId && envId && appId) load(); }, [load]);

  // ── CPS auto-load on page open ───────────────────────────────────────────
  // `loadCpsData` is defined after the early-return guards (it closes over
  // render-time derived values). We keep a ref to its latest version so this
  // effect can call it safely once the app data arrives.
  const loadCpsDataRef = useRef(null);

  useEffect(() => {
    if (!app) return;
    // Derive cpsBaseUrl from raw app data so we know whether CPS is configured
    const _ds  = app.target?.deploymentSettings || {};
    const _cfg = app.application?.configuration || {};
    const _ps  = _cfg['mule.agent.application.properties.service'] || {};
    const _allP = {
      ...(_ps.properties || {}),
      ...(_ds.properties || {}),
      ...(_ds.environmentVariables || _ds.environmentVars || {}),
      ...(app.properties || {}),
    };
    const _url = _allP['cps.configServerBaseUrl'] || _allP['config.server.base.url'] || '';
    // Only auto-load when CPS is configured and data isn't already present
    if (_url && loadCpsDataRef.current) loadCpsDataRef.current();
  }, [app]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestAction = (action) => {
    setActionResult(null);
    setConfirmState({ action, appName: app?.name });
  };

  const executeAction = async () => {
    if (!confirmState || !app) return;
    const { action } = confirmState;
    setActionLoading(action);
    try {
      if (app._type === 'ch1') {
        await api.post(`/applications/cloudhub1/${envId}/${appId}/action?orgId=${orgId}`, { action });
      } else {
        await api.post(`/applications/cloudhub2/${orgId}/${envId}/${appId}/action`, { action });
      }
      const nextStatus = action === 'start' ? 'RUNNING' : action === 'stop' ? 'STOPPED' : 'DEPLOYING';
      setApp((prev) => prev ? { ...prev,
        status: nextStatus,
        application: prev.application ? { ...prev.application, status: nextStatus } : prev.application
      } : prev);
      setActionResult({ success: true, message: `✓ ${app.name}: ${action} initiated successfully` });
    } catch (e) {
      setActionResult({ success: false, message: `✗ Failed to ${action}: ${e.response?.data?.error || e.message}` });
    } finally {
      setActionLoading(null);
      setConfirmState(null);
      setTimeout(() => setActionResult(null), 6000);
    }
  };

  // Fetch Exchange ping spec — also callable manually via Refresh button.
  // NOTE: app.application.ref points to the *deployed Mule artifact* in Exchange
  // (e.g. job-ldp-ripjar-bulk-clear/1.0.3), NOT the API specification asset
  // (e.g. job-ldp-ripjar-bulk-clear-ch2-api/1.0.0). Always use appName so the
  // backend can run its name-normalisation + variant-probing to find the correct
  // API spec asset, regardless of what ref.artifactId points to.
  const fetchPingSpec = useCallback((currentApp) => {
    const a = currentApp || app;
    if (!a) return;
    setPingSpecLoading(true);
    setPingSpec(null);
    api.get('/exchange/ping-spec', {
      params: {
        orgId,
        appName: a.name,   // backend always searches Exchange by name
      }
    }).then(r => {
      setPingSpec(r.data);
      const total = r.data?.allEndpoints?.length ?? 0;
      const ping  = r.data?.pingEndpoints?.length ?? 0;
      console.log(`[pingSpec] ${a.name}: specType=${r.data?.specType}, total=${total} endpoints, ${ping} ping paths found`);
      if (total > 0 && ping === 0) {
        console.log(`[pingSpec] All paths:`, r.data.allEndpoints.map(e => `${e.method} ${e.path}`));
      }
    }).catch(err => { console.warn('[pingSpec] fetch failed:', err.message); setPingSpec(null); })
      .finally(() => setPingSpecLoading(false));
  }, [app, orgId]);

  // Don't auto-fetch — load only when user clicks the API Spec tab
  // (avoids slow Exchange searches on every app detail page open)

  // Trigger a scheduler to run immediately (Run Now)
  const triggerScheduler = useCallback(async (schedulerKey) => {
    if (!schedulerKey) return;
    setTriggerLoadingSet(prev => new Set([...prev, schedulerKey]));
    setTriggerResult(null);
    try {
      if (app?._type === 'ch1') {
        await api.post(
          `/applications/cloudhub1/${envId}/${appId}/schedules/${encodeURIComponent(schedulerKey)}/run`,
          {},
          { params: { orgId } }
        );
      } else {
        await api.post(
          `/applications/cloudhub2/${orgId}/${envId}/${appId}/schedulers/${encodeURIComponent(schedulerKey)}/run`
        );
      }
      setTriggerResult({ success: true, message: `✓ Scheduler "${schedulerKey}" triggered successfully` });
    } catch (e) {
      setTriggerResult({ success: false, message: `✗ Failed to trigger "${schedulerKey}": ${e.response?.data?.error || e.message}` });
    } finally {
      setTriggerLoadingSet(prev => { const next = new Set(prev); next.delete(schedulerKey); return next; });
      setTimeout(() => setTriggerResult(null), 5000);
    }
  }, [app, orgId, envId, appId]);

  const isCH1 = app?._type === 'ch1';

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"/></div>;
  if (!app) return (
    <div className="space-y-4">
      <button onClick={()=>navigate('/applications')} className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm"><ArrowLeft size={16}/> Back</button>
      <div className="bg-red-50/30 border border-red-200/50 rounded-2xl p-10 text-center text-red-600">Application not found or access denied.</div>
    </div>
  );

  const actions = availableActions(app.application?.status || app.status);

  const ds = app.target?.deploymentSettings || {};
  const appCfg = app.application?.configuration || {};
  const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
  const schedSvc = appCfg['mule.agent.scheduling.service'] || {};
  const runtimeProps = propsSvc.properties || {};
  const secureProps = propsSvc.secureProperties || {};
  // CH2: use dedicated /schedulers endpoint result; fallback to configuration-embedded schedulers
  // CH1: use schedules fetched at load time
  const allSchedulers = isCH1
    ? (app._ch1Schedules || [])
    : (ch2Schedulers ?? schedSvc.schedulers ?? []);
  const schedulers = schedulerSearch
    ? allSchedulers.filter((s) => {
        const q = schedulerSearch.toLowerCase();
        const flow = (s.flow || s.flowName || s.name || '').toLowerCase();
      const cron = (s.schedule?.cronExpression || s.schedule?.expression || s.expression || s.cronExpression || '').toLowerCase();
      const freq = String(s.frequency || s.schedule?.frequency || s.schedule?.period || '').toLowerCase();
        return flow.includes(q) || cron.includes(q) || freq.includes(q);
      })
    : allSchedulers;
  const httpInbound = ds.http?.inbound || {};
  const endpoints = httpInbound.endpoints || [];
  const envVars = ds.environmentVariables || ds.environmentVars || {};
  const replicas = app.target?.replicas ?? ds.replicas;
  const osEnabled = ds.persistentObjectStore ?? ds.hasPersistentObjectStore ?? false;
  const replicaList = app.replicas || [];
  const allProps = { ...runtimeProps, ...ds.properties, ...envVars, ...app.properties };
  const filteredProps = Object.entries(allProps).filter(([k]) => !propSearch || k.toLowerCase().includes(propSearch.toLowerCase()));

  // CPS computed values — read directly from runtime properties
  const cpsBaseUrl = allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'];
  const cpsClientId = allProps['cps.clientId'] || allProps['cps.client_id'] || allProps['cps.client.id'] || allProps['cps.apiClientId'] || '';
  const cpsProjectName = allProps['cps.projectName'] || allProps['cloudhub.api.name'] || app.name;
  const cpsEnv = allProps['cps.prefix'] || allProps['cps.environment'] || (() => {
    // fallback: derive from Anypoint env name if cps.prefix not set
    const s = `${app.environment?.name || ''} ${app.environment?.type || ''}`.toLowerCase();
    if (/\b(prod|pd)\b/.test(s)) return 'prod';
    if (/\b(uat|ut|stg|stage|sandbox|uap)\b/.test(s)) return 'uat';
    return app.environment?.type === 'production' ? 'prod' : 'uat';
  })();
  const appEnvName = app.environment?.name || '';
  const cpsDepType = isCH1 ? 'ch1' : 'ch2';

  const effectiveCpsKey = cpsKeyOverride || cpsProjectName;
  const effectiveCpsEnv = cpsEnvOverride || cpsEnv;

  const loadCpsData = async (keyOverride, envOverride) => {
    if (!cpsBaseUrl) return;
    // Guard: skip the silent auto-trigger when data is already loaded/loading.
    // A manual call (Refresh button / key-override change) always passes args so
    // it bypasses this guard and forces a fresh fetch.
    if (!keyOverride && !envOverride && (cpsData || cpsLoading)) return;
    const useKey = keyOverride || effectiveCpsKey;
    const useEnv = envOverride || effectiveCpsEnv;
    setCpsLoading(true); setCpsError(''); setCpsMissingCred(null); setCpsData(null); setCpsAttemptedUrl('');
    setCpsCredsResolved(false);

    // ── Auto-resolve CPS credentials from the imported CSV ────────────────
    if (hasCpsCsvCredentials) {
      const normBase = cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
      const urlBgKey = `${normBase}::${orgId}`;
      let resolved = false;

      // Strategy 1: look up the specific cpsClientId from ARM props.
      // Skip if the value is masked (e.g. "****") — Anypoint Platform redacts
      // secure ARM properties; in that case fall straight to Strategy 2.
      const isMasked = (v) => !v || /^\*+$/.test(v.trim());
      if (cpsClientId && !isMasked(cpsClientId)) {
        const secret = getSecret(cpsClientId);
        if (secret) {
          try {
            await api.post('/cps/credentials', { credentials: { [urlBgKey]: { clientId: cpsClientId, clientSecret: secret } } });
            setCpsCredsResolved(true);
            resolved = true;
            console.log(`[CPS auto-resolve] Strategy 1 matched cpsClientId "${cpsClientId.slice(0,8)}…"`);
          } catch { /* non-fatal */ }
        } else {
          console.log(`[CPS auto-resolve] cpsClientId "${cpsClientId.slice(0,8)}…" not in CSV → falling back to Strategy 2`);
        }
      } else if (cpsClientId && isMasked(cpsClientId)) {
        console.log('[CPS auto-resolve] cpsClientId is masked in ARM props → skipping Strategy 1, using Strategy 2');
      }

      // Strategy 2: store ALL credentials so backend can find them.
      // getCredentials looks for url::bgOrgId first, then url-only.
      // Also store all as url::clientId for the 401-retry fallback.
      if (!resolved) {
        const allCreds = getAllCredentials();
        if (allCreds.length > 0) {
          // Strategy 2: post each credential under url::clientId (unique per cred).
          // Do NOT overwrite url::bgOrgId — the backend's 401-retry loop will
          // promote the correct one to url::bgOrgId once it finds a 200 response.
          // getCredentials() now also falls back to url::clientId* entries (step 2b).
          const credMap = {};
          for (const { clientId, clientSecret } of allCreds) {
            credMap[`${normBase}::${clientId}`] = { clientId, clientSecret };
          }
          try {
            await api.post('/cps/credentials', { credentials: credMap });
          } catch { /* non-fatal */ }
          setCpsCredsResolved(true);
          resolved = true;
          console.log(`[CPS auto-resolve] Strategy 2: posted ${allCreds.length} credential(s) under url::clientId keys; backend will try each and promote the correct one`);
        }
      }

      if (!resolved) {
        console.log('[CPS auto-resolve] No matching credentials found in CSV — will show 422 error');
      }
    }

    try {
      // Fetch non-secure properties for this specific project key
      const nsRes = await api.get('/cps/fetch', { params: {
        baseUrl: cpsBaseUrl, type: 'non-secure', environment: useEnv,
        keys: useKey, deploymentType: cpsDepType, envName: appEnvName, bgOrgId: orgId
      }});
      const nsRaw = nsRes.data;

      // CPS response can be one of several shapes:
      // 1. { responses: [{ key, environment, properties: { k:v } }] }   ← actual API response
      // 2. [{ key, environment, properties: { k:v } }]
      // 3. { properties: [{ key, environment, properties: { k:v } }] }
      // 4. { k:v } (flat map directly)
      let flatNs = {};

      // Normalise: extract the array of property entries regardless of wrapper key
      const propsArray =
        Array.isArray(nsRaw) ? nsRaw
        : Array.isArray(nsRaw?.responses) ? nsRaw.responses
        : Array.isArray(nsRaw?.properties) ? nsRaw.properties
        : null;

      if (propsArray) {
        const match = propsArray.find((p) => p.key === useKey) || propsArray[0];
        const inner = match?.properties || match;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          flatNs = inner;
        } else if (Array.isArray(inner)) {
          // Handle array of {key, value} pairs: [{key:"api.id", value:"12345"}, ...]
          inner.forEach(p => { if (p?.key != null) flatNs[String(p.key)] = p.value ?? p.val ?? ''; });
        }
      } else if (nsRaw && typeof nsRaw === 'object') {
        // Flat map or top-level object — if the first value is an object, try to unwrap
        const firstVal = Object.values(nsRaw)[0];
        if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
          flatNs = nsRaw[useKey] || firstVal;
        } else {
          flatNs = nsRaw;
        }
      }

      // Store secure/binary keys for on-demand fetching; do NOT auto-fetch them
      // Also store the raw API response for clipboard copying
      setCpsData({
        nonSecure: flatNs,
        rawNsResponse: nsRaw,   // original CPS API response (unmodified)
        secureGroups: [],
        rawSecureResponse: null,
        binaryList: [], 
        secureKeys: flatNs['cps.secure.properties'] || '',
        binaryKeys: flatNs['cps.secure.binaries'] || '',
        useEnv,  // store for later fetches
      });
    } catch (e) {
      if (e.response?.status === 422 || e.response?.data?.needsConfig) {
        setCpsMissingCred(e.response.data.credKey);
      } else {
        setCpsError(e.response?.data?.error || e.message || 'CPS fetch failed');
        setCpsAttemptedUrl(e.response?.data?.attemptedUrl || '');
      }
    }
    setCpsLoading(false);
  };
  // Keep the ref in sync with the latest closure so the auto-load useEffect
  // always calls the version that closes over the current derived values.
  loadCpsDataRef.current = loadCpsData;

  const rStatus = (app.application?.status || app.status || '').toUpperCase();
  const isRunning = rStatus === 'RUNNING' || rStatus === 'STARTED';

  const statusStyle = { RUNNING:'text-emerald-700 bg-emerald-50/50 border-emerald-300/50 shadow-emerald-900/30',
    STARTED:'text-emerald-700 bg-emerald-50/50 border-emerald-300/50 shadow-emerald-900/30',
    FAILED:'text-red-700 bg-red-50/50 border-red-300/50 shadow-red-900/30',
    STOPPED:'text-gray-500 bg-gray-100/50 border-gray-300/50',
    DEPLOYING:' text-blue-700 bg-blue-50/50 border-blue-300/50 shadow-blue-900/30',
    APPLIED:'text-cyan-700 bg-cyan-50/50 border-cyan-300/50' }[rStatus] || 'text-gray-500 bg-gray-100/50 border-gray-300/50';

  // Feature 14: tab badges with live counts
  const tabs = [
    { id:'overview', label:'Overview' },
    { id:'properties', label:'Properties', badge: Object.keys(allProps).length },
    ...(cpsBaseUrl ? [{ id:'cps', label:'CPS Config', badge: cpsData ? (cpsError ? '⚠' : '✓') : undefined, badgeErr: !!cpsError }] : []),
    { id:'infrastructure', label:'Schedulers', badge: allSchedulers.length > 0 ? allSchedulers.length : undefined },
    { id:'dependencies', label:'Dependencies' },
    { id:'contracts', label:'Contracts', badge: contracts !== null && !contractsError ? contracts.length : undefined },
    { id:'apispec', label:'API Spec', badge: pingSpec?.allEndpoints?.length > 0 ? pingSpec.allEndpoints.length : undefined },
    { id:'ping', label:'Ping Test', badge: pingSpec?.pingEndpoints?.length > 0 ? pingSpec.pingEndpoints.length : undefined },
    { id:'raw', label:'Raw JSON' },
  ];

  return (
    <div className="space-y-6 min-h-screen">
      {/* Feature 3: Breadcrumb navigation */}
      <nav className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 flex-wrap">
        <button onClick={() => navigate('/applications')}
          className="hover:text-sf-600 dark:hover:text-sf-400 transition-colors">Applications</button>
        {bgName && (
          <>
            <span>/</span>
            <span className="text-gray-400 dark:text-gray-500">{bgName}</span>
          </>
        )}
        {(resolvedEnvName || app.environment?.name) && (
          <>
            <span>/</span>
            <span className={`font-medium ${app.environment?.type === 'production' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {resolvedEnvName || app.environment?.name}
            </span>
          </>
        )}
        <span>/</span>
        <span className="text-gray-600 dark:text-gray-300 font-medium truncate max-w-xs">{app.name}</span>
      </nav>

      {showCpsSettings && <CpsSettingsModal
        prefilledUrl={cpsBaseUrl ? cpsBaseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '') : ''}
        prefilledBgId={orgId}
        prefilledBgName={app.environment?.organizationId === orgId ? '' : ''}
        onClose={() => { setShowCpsSettings(false); if (cpsMissingCred) { setCpsMissingCred(null); loadCpsData(); } }}
      />}
      <CpsRawJsonModal
        isOpen={!!rawJsonView}
        onClose={() => setRawJsonView(null)}
        initialJson={rawJsonView?.data}
        title={rawJsonView?.title || 'Raw JSON'}
        description="View the exact JSON response returned by the CPS API."
        readOnly={true}
      />
      <AppConfirmModal
        state={confirmState}
        onConfirm={executeAction}
        onCancel={() => setConfirmState(null)}
        loading={!!actionLoading}
      />
      <SchedulerConfirmModal
        schedulerKey={schedulerConfirmKey}
        onConfirm={() => { triggerScheduler(schedulerConfirmKey); setSchedulerConfirmKey(null); }}
        onCancel={() => setSchedulerConfirmKey(null)}
        loading={triggerLoadingSet.has(schedulerConfirmKey)}
      />
      <ContractConfirmModal
        state={contractConfirmState}
        onConfirm={handleContractAction}
        onCancel={() => setContractConfirmState(null)}
        loading={!!contractActionLoading}
      />

      {/* Action toast */}
      {actionResult && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
          actionResult.success
            ? 'bg-emerald-50/40 border-emerald-200/50 text-emerald-700'
            : 'bg-red-50/40 border-red-200/50 text-red-700'
        }`}>
          <span>{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* ── Hero Header ─────────────────────────────── */}
      <div className="relative rounded-2xl border border-gray-200/60 dark:border-gray-700/60 overflow-hidden shadow-lg shadow-gray-900/5 dark:shadow-black/20">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sf-500 via-sfteal-400 to-sfpurple-500 z-10"/>
        <div className="absolute inset-0 bg-gradient-to-br from-sf-50 via-white to-sfteal-50/50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800"/>
        <div className="absolute inset-0 dark:hidden" style={{background:'radial-gradient(ellipse at 70% 50%, rgba(1,118,211,0.06) 0%, transparent 60%)'}}/>
        <div className="absolute inset-0 hidden dark:block" style={{background:'radial-gradient(ellipse at 70% 50%, rgba(1,118,211,0.12) 0%, transparent 60%)'}}/>
        {isRunning && <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"/>}
        <div className="relative p-6 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <button onClick={()=>navigate('/applications')} className="mt-0.5 p-2 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-white dark:hover:bg-gray-800 border border-transparent hover:border-gray-200/60 dark:hover:border-gray-700/60 hover:shadow-sm transition-all">
              <ArrowLeft size={16}/>
            </button>
            <div className={`mt-0.5 flex items-center justify-center w-11 h-11 rounded-2xl flex-shrink-0 shadow-lg ring-1 ring-white/20 ${isCH1 ? 'bg-gradient-to-br from-sfpurple-500 to-sfpurple-700 shadow-sfpurple-500/30' : 'bg-gradient-to-br from-sf-500 to-sf-700 shadow-sf-500/30'}`}>
              <Package size={19} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">{app.name}</h1>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold border shadow-lg ${statusStyle}`}>
                  <PulseDot active={isRunning}/> {rStatus || 'Unknown'}
                </span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${isCH1?'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20':'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'}`}>
                  {isCH1?'CloudHub 1.0':'CloudHub 2.0'}
                </span>
                {/* Feature 3: BG & Env context badges */}
                {bgName && (
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-100/70 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60">
                    🏢 {bgName}
                  </span>
                )}
                {(resolvedEnvName || app.environment?.name) && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                    app.environment?.type === 'production'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-400/20'
                      : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-400/20'
                  }`}>
                    🌐 {resolvedEnvName || app.environment?.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <MetaTag color="gray">{app.id}</MetaTag>
                {app.application?.ref && <MetaTag color="blue">{app.application.ref.artifactId} v{app.application.ref.version}</MetaTag>}
                {(app.region||ds.runtime?.version) && <MetaTag color="cyan">{ds.runtime?.version||ds.runtimeVersion||app.muleVersion}</MetaTag>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Action buttons */}
            {actions.length > 0 && (
              <div className="flex items-center gap-1.5">
                {actionLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60">
                    <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-sf-500" />
                    <span className="text-gray-500 dark:text-gray-400 text-xs">Working…</span>
                  </div>
                ) : actions.map((action) => {
                  const { Icon, label, detailCls } = ACTION_CONFIG[action];
                  return (
                    <button key={action} title={label} onClick={() => requestAction(action)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border bg-white/70 dark:bg-gray-800/60 shadow-sm transition-all ${detailCls}`}>
                      <Icon size={13} /> {label}
                    </button>
                  );
                })}
              </div>
            )}
            {/* API Manager shortcut — pre-selects the current BG + env (+ API instance if known) */}
            <HeroActionBtn
              icon={ShieldCheck}
              label="API Manager"
              accent="sf"
              title="Open API Manager filtered to this environment"
              onClick={() => {
                localStorage.setItem('mule_apimgr_bg', orgId);
                if (envId) localStorage.setItem('mule_apimgr_env', envId);
                if (contractApiInstanceId) {
                  localStorage.setItem('mule_apimgr_instance', String(contractApiInstanceId));
                } else if (app?.name) {
                  // No instance ID yet (contracts not loaded) — pre-fill search with app name
                  // so the API Manager page auto-filters to likely matching instances.
                  localStorage.setItem('mule_apimgr_search', app.name);
                }
                navigate('/api-manager');
              }}
            />
            {/* CPS Manager shortcut — navigates with pre-selected BG+Env+App */}
            <HeroActionBtn
              icon={Database}
              label="CPS Manager"
              accent="sfteal"
              title="Open this app in CPS Manager"
              onClick={() => navigate('/cps-manager', {
                state: {
                  cpsAutoSelect: {
                    bgId: orgId,
                    envId: envId,
                    compositeId: `${appId}|${envId}|${orgId}`,
                    appName: app.name,
                  },
                },
              })}
            />
            {/* Open in Exchange button — navigates to our Exchange page and auto-selects the asset */}
            {(() => {
              const ref = app.application?.ref;
              return (
                <HeroActionBtn
                  icon={ExternalLink}
                  label="Exchange"
                  accent="emerald"
                  title="View in Exchange Assets"
                  onClick={() => navigate('/exchange', {
                    state: {
                      assetId: ref?.artifactId || app.name,
                      groupId: ref?.groupId || null,
                      version: ref?.version || null,
                      name: app.name
                    }
                  })}
                />
              );
            })()}
            {/* Open in Anypoint Platform:
                Step 1 — switch BG via home/organizations/{orgId}/
                Step 2 — navigate to env-in-path URL after 4s
                If env selector appears, the tooltip tells the user exactly which env to click. */}
            <HeroActionBtn
              icon={ExternalLink}
              label="Anypoint"
              accent="sf"
              title={
                resolvedEnvName || app.environment?.name
                  ? `Open in Anypoint Platform — app name copied to clipboard. If prompted, select "${resolvedEnvName || app.environment?.name}"`
                  : 'Open in Anypoint Platform — app name copied to clipboard'
              }
              onClick={() => {
                // Copy the app name to clipboard so the user can paste it into
                // CloudHub's search box if the env-selector page appears first.
                try { navigator.clipboard.writeText(app.name); } catch { /* non-fatal */ }
                const envName = resolvedEnvName || app.environment?.name || '';
                const envAppUrl = envId
                  ? (isCH1
                      ? `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/cloudhub/${appId}/settings`
                      : `https://anypoint.mulesoft.com/cloudhub/#/console/home/${envId}/applications/runtimeFabric/${appId}/settings`)
                  : (isCH1
                      ? `https://anypoint.mulesoft.com/cloudhub/#/console/applications/cloudhub/${appId}/settings`
                      : `https://anypoint.mulesoft.com/cloudhub/#/console/applications/runtimeFabric/${appId}/settings`);

                if (!orgId) { window.open(envAppUrl, '_blank', 'noreferrer'); return; }

                const win = window.open(
                  `https://anypoint.mulesoft.com/home/organizations/${orgId}/`,
                  '_blank'
                );
                if (win) {
                  setTimeout(() => {
                    try { win.location.href = envAppUrl; }
                    catch { window.open(envAppUrl, '_blank', 'noreferrer'); }
                  }, 4000);
                } else {
                  window.open(envAppUrl, '_blank', 'noreferrer');
                }
              }}
            />
            <button onClick={load} title="Refresh" className="p-2.5 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 hover:bg-white dark:hover:bg-gray-800 hover:shadow-md transition-all">
              <RefreshCw size={14}/>
            </button>
          </div>
        </div>
      </div>

      {/* ── Segmented Tabs ──────────────────────────── */}
      <div className="bg-white/80 dark:bg-gray-900/60 backdrop-blur-md p-1.5 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 w-fit flex gap-1 shadow-sm overflow-x-auto max-w-full">
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => {
            setTab(t.id);
            if (t.id === 'infrastructure' && app?._type !== 'ch1' && ch2Schedulers === null && !schedulersLoading) loadCh2Schedulers();
            if (t.id === 'cps' && !cpsData && !cpsLoading) loadCpsData();
            if (t.id === 'contracts' && contracts === null && !contractsLoading) loadContracts();
            if (t.id === 'apispec' && pingSpec === null && !pingSpecLoading) fetchPingSpec();
          }}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${tab===t.id?'bg-gradient-to-br from-sf-500 to-sf-600 text-white shadow-md shadow-sf-500/30':'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/70 dark:hover:bg-gray-800/60'}`}>
            {t.id === 'cps' && <Key size={11} />}
            {t.id === 'ping' && <Activity size={11} />}
            {t.label}
            {t.badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                t.badgeErr ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400' :
                t.badge === '✓' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                tab===t.id ? 'bg-white/25 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ────────────────────────────────── */}
      {tab==='overview' && (() => {
        const statusAccent = isRunning ? 'emerald' : rStatus === 'FAILED' ? 'red' : rStatus === 'DEPLOYING' ? 'blue' : 'amber';
        const versionVal = isCH1 ? app.muleVersion : (ds.runtime?.version || ds.runtimeVersion);
        const versionSub = isCH1 ? app.region : (ds.runtime?.java ? `Java ${ds.runtime.java}` : (ds.runtime?.releaseChannel || undefined));
        const scaleVal = isCH1
          ? (app.workers?.amount != null ? `${app.workers.amount} worker${app.workers.amount === 1 ? '' : 's'}` : undefined)
          : (replicas != null ? `${replicas} replica${replicas === 1 ? '' : 's'}` : undefined);
        const scaleSub = isCH1
          ? (typeof app.workers?.type === 'string' ? app.workers.type : app.workers?.type?.name)
          : (app.application?.vCores != null ? `${app.application.vCores} vCores` : undefined);
        const lastMod = app.lastModifiedDate ? new Date(app.lastModifiedDate) : null;
        return (
        <div className="space-y-5">
          {/* ── Stat tiles — the handful of facts that matter most, at a glance ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile icon={Activity} label="Runtime Status" accent={statusAccent}
              value={rStatus || 'Unknown'} sub={isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'} />
            <StatTile icon={GitBranch} label="Mule Runtime" accent="blue"
              value={versionVal || '—'} sub={versionSub} />
            <StatTile icon={Layers} label="Scale" accent="purple"
              value={scaleVal || '—'} sub={scaleSub} />
            <StatTile icon={Clock} label="Last Modified" accent="teal"
              value={lastMod ? lastMod.toLocaleDateString() : '—'} sub={lastMod ? lastMod.toLocaleTimeString() : undefined} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard icon={Server} title="Deployment Details" accent="blue">
              {isCH1 ? (<>
                <SectionLabel icon={Hash}>Identity</SectionLabel>
                <KVRow label="App ID" value={app.id} mono />
                <KVRow label="Status" value={app.status} />
                <KVRow label="Region" value={app.region} mono />

                <SectionLabel icon={Boxes}>Network</SectionLabel>
                <KVRow label="Static IPs" value={app.staticIPsEnabled!=null?(app.staticIPsEnabled?'✅ Enabled':'❌ Disabled'):undefined} />
                {app.staticIPs && app.staticIPs.length > 0 && (
                  <KVRow label="Static IP Addresses" value={app.staticIPs.join(', ')} mono />
                )}
              </>) : (<>
                <SectionLabel icon={Hash}>Runtime</SectionLabel>
                <KVRow label="Desired State" value={app.application?.desiredState} />
                <KVRow label="Deployment Status" value={app.status} />
                <KVRow label="Release Channel" value={ds.runtime?.releaseChannel} />

                <SectionLabel icon={Boxes}>Scaling & Network</SectionLabel>
                <KVRow label="Static IPs" value={ds.staticIpEnabled!=null?(ds.staticIpEnabled?'✅ Enabled':'❌ Disabled'):undefined} />
                {/* Private Space static outbound IPs */}
                {ch2PrivateIPs.length > 0 && (
                  <KVRow label="Static Outbound IPs" value={ch2PrivateIPs.join(', ')} mono />
                )}
                {/* Replica IPs (shared space) */}
                {ch2PrivateIPs.length === 0 && replicaList.filter(r => r.ipAddress || r.publicIpAddress).length > 0 && (
                  <KVRow label="Replica IPs" value={replicaList.filter(r => r.ipAddress || r.publicIpAddress).map(r => r.ipAddress || r.publicIpAddress).join(', ')} mono />
                )}
                <KVRow label="Update Strategy" value={typeof ds.updateStrategy==='string'?ds.updateStrategy:undefined} />

                <SectionLabel icon={Package}>Artifact</SectionLabel>
                <KVRow label="Artifact" value={app.application?.ref?`${app.application.ref.artifactId} v${app.application.ref.version}`:undefined} />
              </>)}
            </GlassCard>

            <GlassCard icon={Server} title="Replica Instances" count={replicaList.length} accent="purple">
              {replicaList.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {replicaList.map(r => {
                    const ip = r.ipAddress || r.publicIpAddress;
                    const active = r.state === 'STARTED' || r.state === 'RUNNING';
                    return (
                      <div key={r.id} className="flex items-center gap-2.5 bg-gray-50/70 dark:bg-gray-800/40 border border-gray-200/60 dark:border-gray-700/50 rounded-xl px-3.5 py-3">
                        <PulseDot active={active} />
                        <div className="min-w-0 flex-1">
                          <p className="text-gray-700 dark:text-gray-200 text-xs font-mono truncate">{r.id}</p>
                          {ip && <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono truncate mt-0.5">{ip}</p>}
                        </div>
                        <MetaTag color={active?'green':'gray'}>{r.state}</MetaTag>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800">
                    <Server size={18} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-gray-400 dark:text-gray-500 text-xs">No replica instances reported</p>
                </div>
              )}
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard icon={Database} title="Object Store & Settings" accent="cyan">
              <KVRow label="Persistent Object Store" value={osEnabled?'✅ Enabled':'❌ Disabled'} />
              {isCH1 && <KVRow label="Persistent Queues" value={app.persistentQueues!=null?String(app.persistentQueues):undefined} />}
              {isCH1 && <KVRow label="Monitoring" value={app.monitoringEnabled!=null?String(app.monitoringEnabled):undefined} />}
              {isCH1 && <KVRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled!=null?String(app.loggingCustomLog4JEnabled):undefined} />}
              {!isCH1 && <KVRow label="AM Log Forwarding" value={ds.disableAmLogForwarding!=null?String(!ds.disableAmLogForwarding):undefined} />}
            </GlassCard>

            {(httpInbound.publicUrl||endpoints.length>0) ? (
              <GlassCard icon={Globe} title="HTTP Endpoints" count={endpoints.length} accent="green" noPad>
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 space-y-1">
                  {httpInbound.publicUrl && <KVRow label="Public URL" value={httpInbound.publicUrl} mono />}
                  {httpInbound.internalUrl && <KVRow label="Internal URL" value={httpInbound.internalUrl} mono />}
                  <KVRow label="Last Mile Security" value={httpInbound.lastMileSecurity!=null?String(httpInbound.lastMileSecurity):undefined} />
                  <KVRow label="Forward SSL" value={httpInbound.forwardSslSession!=null?String(httpInbound.forwardSslSession):undefined} />
                </div>
                {endpoints.length>0 && (
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="bg-gray-50/80 dark:bg-gray-800/60"><th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Access</th><th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">URL</th></tr></thead>
                    <tbody>
                      {endpoints.map((ep,i)=>(
                        <tr key={i} className="border-t border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors group">
                          <td className="px-5 py-3"><MetaTag color={ep.access==='external'?'blue':'gray'}>{ep.access}</MetaTag></td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-600 dark:text-gray-300 text-xs font-mono break-all">{ep.url}</span>
                              <CopyBtn text={ep.url}/>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </GlassCard>
            ) : (
              <GlassCard icon={Globe} title="HTTP Endpoints" accent="green">
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                  <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800">
                    <Globe size={18} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-gray-400 dark:text-gray-500 text-xs">No HTTP endpoints configured</p>
                </div>
              </GlassCard>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── PROPERTIES ──────────────────────────────── */}
      {tab==='properties' && (() => {
        const namespaceOf = (k) => (k.includes('.') ? k.slice(0, k.indexOf('.')) : 'other');
        const NS_PALETTE = ['blue', 'cyan', 'purple', 'green', 'orange', 'red'];
        const namespaceColor = (ns) => {
          let hash = 0;
          for (let i = 0; i < ns.length; i++) hash = (hash * 31 + ns.charCodeAt(i)) >>> 0;
          return NS_PALETTE[hash % NS_PALETTE.length];
        };
        const namespaceCount = new Set(Object.keys(allProps).map(namespaceOf)).size;
        return (
        <div className="space-y-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile icon={Settings} label="Total Properties" accent="blue" value={Object.keys(allProps).length} />
            <StatTile icon={Key} label="Secure Properties" accent="amber" value={Object.keys(secureProps).length} />
            <StatTile icon={Boxes} label="Namespaces" accent="purple" value={namespaceCount} sub="unique key prefixes" />
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"/>
            <input value={propSearch} onChange={e=>setPropSearch(e.target.value)} placeholder="Filter properties by key…"
              className="w-full bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-sm"/>
          </div>

          <GlassCard icon={Settings} title="Properties" count={filteredProps.length} accent="blue" noPad>
            {filteredProps.length>0 ? (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-700/60">
                    <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase w-[46%]">Property Key</th>
                    <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProps.sort(([a],[b])=>a.localeCompare(b)).map(([k,v]) => (
                    <tr key={k} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                      <td className="px-5 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${NS_DOT_COLORS[namespaceColor(namespaceOf(k))]}`} title={namespaceOf(k)} />
                          <span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all leading-relaxed">{k}</span>
                          <CopyBtn text={k}/>
                        </div>
                      </td>
                      <td className="px-5 py-3 align-top">
                        <div className="flex items-start gap-1.5">
                          <SecretVal value={String(v)}/>
                          <CopyBtn text={String(v)}/>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800">
                  <Search size={16} className="text-gray-400 dark:text-gray-500" />
                </div>
                <p className="text-gray-400 dark:text-gray-500 text-sm">{propSearch?`No matches for "${propSearch}"`:'No properties found'}</p>
              </div>
            )}
          </GlassCard>

          {Object.keys(secureProps).length>0 && (
            <GlassCard icon={Key} title="Secure Properties" count={Object.keys(secureProps).length} accent="orange">
              <div className="flex items-center gap-2 mb-3.5 -mt-1">
                <AlertTriangle size={12} className="text-sforange-500 dark:text-sforange-400 flex-shrink-0" />
                <span className="text-xs text-sforange-600 dark:text-sforange-400">Values are redacted by Anypoint Platform</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {Object.entries(secureProps).map(([k,v]) => (
                  <div key={k} className="group bg-sforange-50/40 dark:bg-sforange-500/5 border border-sforange-200/50 dark:border-sforange-400/15 rounded-xl px-3.5 py-2.5">
                    <p className="text-gray-500 dark:text-gray-400 text-[10px] font-mono break-all leading-relaxed mb-1">{k}</p>
                    <div className="flex items-center justify-between gap-1.5">
                      <SecretVal value={String(v)}/>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
        );
      })()}

      {/* ── INFRA & CONFIG ───────────────────────────── */}
      {tab==='infrastructure' && (() => {
        const enabledCount = allSchedulers.filter(s => s.enabled !== false).length;
        const disabledCount = allSchedulers.length - enabledCount;
        const hasUnresolved = allSchedulers.some(s => {
          const expr = s.expression || s.schedule?.expression || '';
          if (!expr.startsWith('${')) return false;
          const propName = expr.slice(2, -1);
          return !cpsSchedulerProps[propName] && !cpsSchedulerProps[propName.toLowerCase()] && !allProps[propName];
        });
        const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return (
        <div className="space-y-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile icon={Clock} label="Total Schedulers" accent="purple" value={allSchedulers.length} />
            <StatTile icon={Zap} label="Enabled" accent="emerald" value={enabledCount} sub={disabledCount > 0 ? `${disabledCount} disabled` : undefined} />
            <StatTile icon={Activity} label="App State" accent={isRunning ? 'emerald' : 'amber'} value={isRunning ? 'Running' : (rStatus || 'Unknown')} sub={isRunning ? 'Schedulers can fire' : 'Triggers unavailable'} />
          </div>

          <GlassCard icon={Clock} title="Scheduled Flows" count={allSchedulers.length} accent="purple" noPad>
            {/* Show "Get Cron Expressions" button when there are unresolved ${...} placeholders
                and CPS is configured for this app (even if cps.secure.properties wasn't auto-discovered) */}
            {hasUnresolved && cpsBaseUrl && (
              <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-sfpurple-50/50 dark:bg-sfpurple-500/5">
                <p className="text-[10px] text-sfpurple-600 dark:text-sfpurple-400 flex items-center gap-1.5 font-medium">
                  <Key size={9} /> Some cron expressions may be in CPS properties
                </p>
                <button
                  disabled={cpsSecureSchedulerLoading}
                  onClick={async () => {
                    setCpsSecureSchedulerLoading(true);
                    try {
                      // Step 1: If cps.secure.properties key is not yet known, fetch non-secure to discover it
                      let secureKeys = cpsSchedulerProps['cps.secure.properties'];
                      if (!secureKeys) {
                        try {
                          const nsRes = await api.get('/cps/fetch', {
                            params: { baseUrl: cpsBaseUrl, type: 'non-secure', keys: effectiveCpsKey, environment: effectiveCpsEnv, bgOrgId: orgId }
                          });
                          const data = nsRes.data;
                          let flat = {};
                          if (Array.isArray(data?.responses)) data.responses.forEach(r => Object.assign(flat, r.properties || {}));
                          else if (Array.isArray(data)) data.forEach(r => { if (r?.properties) Object.assign(flat, r.properties); });
                          else if (data && typeof data === 'object') {
                            const fv = Object.values(data)[0];
                            flat = (fv && typeof fv === 'object') ? Object.values(data).reduce((m, v) => (v && typeof v === 'object' ? Object.assign(m, v) : m), {}) : data;
                          }
                          if (Object.keys(flat).length > 0) {
                            setCpsSchedulerProps(prev => ({ ...prev, ...flat }));
                            secureKeys = flat['cps.secure.properties'];
                          }
                        } catch { /* continue */ }
                      }
                      if (!secureKeys) { setCpsSecureSchedulerLoading(false); return; }
                      // Step 2: Fetch secure properties using the discovered keys
                      const sr = await api.get('/cps/fetch', {
                        params: { baseUrl: cpsBaseUrl, type: 'secure', environment: effectiveCpsEnv, keys: secureKeys, bgOrgId: orgId }
                      });
                      const data = sr.data;
                      const groups = Array.isArray(data?.responses) ? data.responses
                        : Array.isArray(data?.properties) ? data.properties
                        : Array.isArray(data) ? data : [];
                      const merged = {};
                      groups.forEach(g => Object.assign(merged, g.properties || {}));
                      if (Object.keys(merged).length > 0) setCpsSchedulerProps(prev => ({ ...prev, ...merged }));
                    } catch { /* silently fail — button stays visible for retry */ }
                    setCpsSecureSchedulerLoading(false);
                  }}
                  className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 bg-sfpurple-100 dark:bg-sfpurple-500/15 border border-sfpurple-200/60 dark:border-sfpurple-400/20 text-sfpurple-700 dark:text-sfpurple-300 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600 rounded-lg transition-all disabled:opacity-50 font-semibold flex-shrink-0">
                  {cpsSecureSchedulerLoading
                    ? <><RefreshCw size={9} className="animate-spin" /> Loading…</>
                    : <><Key size={9} /> Get Cron Expressions</>}
                </button>
              </div>
            )}
            {/* Trigger result toast inside the scheduler card */}
            {triggerResult && (
              <div className={`mx-5 mt-3 flex items-center justify-between px-4 py-2.5 rounded-xl border text-xs ${
                triggerResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-500/10 border-red-200/60 dark:border-red-400/20 text-red-700 dark:text-red-300'
              }`}>
                <span>{triggerResult.message}</span>
                <button onClick={() => setTriggerResult(null)} className="ml-3 opacity-60 hover:opacity-100 flex-shrink-0"><X size={12} /></button>
              </div>
            )}
            {allSchedulers.length>0 && (
              <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"/>
                  <input
                    value={schedulerSearch}
                    onChange={(e) => setSchedulerSearch(e.target.value)}
                    placeholder="Filter by flow name or cron…"
                    className="w-full bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 rounded-xl pl-8 pr-4 py-2.5 text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sfpurple-400 dark:focus:border-sfpurple-500 focus:ring-2 focus:ring-sfpurple-500/10 focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                  {schedulerSearch && (
                    <button onClick={() => setSchedulerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xs">✕</button>
                  )}
                </div>
                {schedulerSearch && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
                    Showing {schedulers.length} of {allSchedulers.length} scheduler{allSchedulers.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}
            {allSchedulers.length>0 ? (
              <div className="p-4 space-y-3">
                {schedulers.map((s,i) => {
                  // CH2 uses s.schedule.expression; CH1 uses s.schedule.cronExpression or s.expression
                  const rawCron = s.schedule?.cronExpression ||
                                  s.schedule?.expression ||
                                  s.expression ||
                                  s.cronExpression;
                  // Scheduler-configured timezone (CH2 returns this in schedule.timeZone)
                  const rawTz = s.schedule?.timeZone || s.schedule?.timezone || s.timeZone || s.timezone || null;
                  // Resolve ${...} placeholders in timezone value (same as cron expression)
                  const schedulerTz = rawTz?.replace(/\$\{([^}]+)\}/g, (match, propName) =>
                    allProps[propName] ||
                    allProps[propName.toLowerCase()] ||
                    cpsSchedulerProps[propName] ||
                    cpsSchedulerProps[propName.toLowerCase()] ||
                    cpsData?.nonSecure?.[propName] ||
                    match
                  ) || null;
                  // Resolve ${propName} placeholders: check runtime props first, then CPS props
                  const resolvedCron = rawCron?.replace(/\$\{([^}]+)\}/g, (match, propName) =>
                    allProps[propName] ||
                    allProps[propName.toLowerCase()] ||
                    cpsSchedulerProps[propName] ||
                    cpsSchedulerProps[propName.toLowerCase()] ||
                    cpsData?.nonSecure?.[propName] ||
                    match
                  );
                  const isUnresolvedPlaceholder = rawCron?.startsWith('${') && resolvedCron === rawCron;
                  const wasResolved = rawCron !== resolvedCron;
                  const cron = resolvedCron; // display the resolved value
                  let decodedCron = '';
                  if (cron && !isUnresolvedPlaceholder) {
                    try {
                      decodedCron = cronstrue.toString(cron, { throwExceptionOnParseError: true });
                    } catch (e) {
                      // ignore parsing errors (e.g. non-standard crons)
                    }
                  }
                  // Compute next run from cron expression (works for both CH1 and CH2 since
                  // the Anypoint Platform schedulers API does not return nextRun reliably).
                  // Only compute for ENABLED schedulers — a disabled scheduler has no next run.
                  const active = s.enabled!==false;
                  const computedNextRun = (cron && !isUnresolvedPlaceholder && active) ? getNextCronRun(cron) : null;
                  // CH2 fixed-frequency: s.schedule.frequency; CH1: s.frequency or s.schedule.period
                  const freq = s.frequency ||
                               s.schedule?.frequency ||
                               (s.schedule?.period > 0 ? s.schedule.period : null);
                  const timeUnit = s.timeUnit || s.schedule?.timeUnit;
                  const flowName = s.flow||s.flowName||s.name;
                  const schedulerKey = s.name || s.schedulerName || s.flow || s.flowName || `scheduler-${i}`;
                  const isTriggering = triggerLoadingSet.has(schedulerKey);

                  // Lastrun lookup
                  const lastRunCandidates = [
                    s.lastRun, s.schedule?.lastRun, s.status?.lastRun,
                    s.lastRunAt, s.schedule?.lastRunAt, s.status?.lastRunAt,
                    s.lastFireAt, s.schedule?.lastFireAt, s.status?.lastFireAt,
                    s.lastFiredAt, s.schedule?.lastFiredAt, s.status?.lastFiredAt,
                    s.lastFired, s.schedule?.lastFired, s.status?.lastFired,
                    s.lastRunTime, s.schedule?.lastRunTime, s.status?.lastRunTime,
                    s.lastExecution, s.schedule?.lastExecution, s.status?.lastExecution,
                    s.lastTriggerTime, s.schedule?.lastTriggerTime, s.stats?.lastRun,
                    s.trigger?.lastFireTime, s.meta?.lastRun,
                  ];
                  const lastRunRaw = lastRunCandidates.find(v => v != null && v !== 0 && v !== '');
                  let lastRunNode;
                  if (!lastRunRaw) {
                    lastRunNode = <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>;
                  } else {
                    const d = new Date(lastRunRaw);
                    const valid = !isNaN(d.getTime()) && d.getFullYear() > 1970;
                    lastRunNode = valid ? (
                      <>
                        <span className="text-gray-600 dark:text-gray-300 text-xs font-mono">{d.toLocaleDateString()}</span>
                        <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono">{d.toLocaleTimeString()}</p>
                      </>
                    ) : <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{String(lastRunRaw)}</span>;
                  }

                  return (
                    <div key={i} className={`group relative rounded-2xl border bg-white/70 dark:bg-gray-900/40 backdrop-blur-sm shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden ${active ? 'border-gray-200/70 dark:border-gray-700/60' : 'border-gray-200/50 dark:border-gray-800/60 opacity-70'}`}>
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${active ? 'bg-gradient-to-b from-sfpurple-400 to-sfpurple-600' : 'bg-gray-300 dark:bg-gray-700'}`} />
                      <div className="flex flex-wrap items-center gap-4 px-5 py-4 pl-6">
                        {/* Flow identity */}
                        <div className="flex items-center gap-2.5 min-w-[160px] flex-shrink-0">
                          <PulseDot active={active}/>
                          <div className="min-w-0">
                            <p className="text-gray-800 dark:text-gray-100 text-sm font-semibold font-mono break-all leading-tight">{flowName}</p>
                            <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md font-semibold mt-1 ${active?'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400':'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                              {active?'Enabled':'Disabled'}
                            </span>
                          </div>
                        </div>

                        {/* Cron / frequency */}
                        <div className="flex-1 min-w-[200px]">
                          {cron && !isUnresolvedPlaceholder ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <MetaTag color="cyan">{cron}</MetaTag>
                                {schedulerTz && <span className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {schedulerTz}</span>}
                              </div>
                              {decodedCron && (
                                <p className="text-[12px] text-gray-600 dark:text-gray-300 font-medium">{decodedCron}</p>
                              )}
                              {wasResolved && (
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono" title="Property placeholder resolved from app properties">{rawCron}</p>
                              )}
                            </div>
                          ) : isUnresolvedPlaceholder ? (
                            <div className="space-y-1">
                              <MetaTag color="gray">{rawCron}</MetaTag>
                              <p className="text-[10px] text-amber-600 dark:text-amber-400">⚠ property not in runtime props — check CPS</p>
                              {schedulerTz && <p className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {schedulerTz}</p>}
                            </div>
                          ) : freq ? (
                            <div className="space-y-1">
                              <MetaTag color="blue">{freq}{timeUnit ? ` ${timeUnit}` : ''}</MetaTag>
                              {schedulerTz && <p className="text-[10px] text-sfteal-600 dark:text-sfteal-400">🕐 {schedulerTz}</p>}
                            </div>
                          ) : <span className="text-gray-400 dark:text-gray-600 text-xs">No schedule info</span>}
                        </div>

                        {/* Last run */}
                        <div className="flex-shrink-0 min-w-[90px]">
                          <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1">Last Run</p>
                          {lastRunNode}
                        </div>

                        {/* Next run */}
                        <div className="flex-shrink-0 min-w-[90px]">
                          <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1">Next Run</p>
                          {computedNextRun ? (
                            <>
                              <span className="text-sfpurple-700 dark:text-sfpurple-300 text-xs font-mono font-semibold">{computedNextRun.toLocaleDateString()}</span>
                              <p className="text-sfpurple-500 dark:text-sfpurple-400 text-[10px] font-mono">{computedNextRun.toLocaleTimeString()}</p>
                            </>
                          ) : freq ? (
                            <span className="text-gray-400 dark:text-gray-600 text-xs" title="Fixed-frequency scheduler — next run not calculable from frequency alone">—</span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
                          )}
                        </div>

                        {/* Action */}
                        <div className="flex-shrink-0 ml-auto">
                          <button
                            onClick={() => setSchedulerConfirmKey(schedulerKey)}
                            disabled={isTriggering || !isRunning}
                            title={!isRunning ? 'App must be RUNNING to trigger a scheduler' : `Run "${schedulerKey}" immediately`}
                            className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:bg-sfpurple-600 hover:text-white hover:border-sfpurple-600 hover:shadow-md hover:shadow-sfpurple-500/30">
                            {isTriggering
                              ? <><RefreshCw size={11} className="animate-spin" /> Running…</>
                              : <><Zap size={11} /> Run Now</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : schedulerSearch ? (
              <div className="px-5 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">No schedulers match <span className="text-gray-700 dark:text-gray-300 font-mono">"{schedulerSearch}"</span></div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sfpurple-100 dark:bg-sfpurple-500/10">
                  <Clock size={24} className="text-sfpurple-500 dark:text-sfpurple-400" />
                </div>
                <p className="text-gray-400 dark:text-gray-500 text-sm">No schedulers configured for this application</p>
              </div>
            )}
          </GlassCard>
        </div>
        );
      })()}

      {/* ── CPS CONFIG ──────────────────────────────── */}
      {tab==='cps' && cpsBaseUrl && (() => {
        const nsCount = cpsData ? Object.keys(cpsData.nonSecure).length : 0;
        const secCount = cpsData ? cpsData.secureGroups.reduce((sum, g) => sum + (g.properties && typeof g.properties === 'object' ? Object.keys(g.properties).length : 0), 0) : 0;
        const binCount = cpsData?.binaryKeys ? cpsData.binaryKeys.split(',').map(f => f.trim()).filter(Boolean).length : 0;
        return (
        <div className="space-y-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile icon={Settings} label="Non-Secure Properties" accent="blue" value={cpsData ? nsCount : '—'} />
            <StatTile icon={Key} label="Secure Properties" accent="purple" value={cpsData ? secCount : '—'} sub={cpsData?.secureKeys && secCount===0 ? 'available to load' : undefined} />
            <StatTile icon={Package} label="Binary Assets" accent="amber" value={cpsData ? binCount : '—'} />
          </div>

          {/* Info bar */}
          <div className="relative rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-sm overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-4 px-5 py-4">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-sf-500 to-sf-600 shadow-sm shadow-sf-500/30 flex-shrink-0">
                    <Key size={13} className="text-white" />
                  </div>
                  <span className="text-gray-900 dark:text-gray-100 text-sm font-semibold">Config Property Server</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${cpsEnv==='prod'?'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20':'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20'}`}>{cpsEnv.toUpperCase()}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isCH1?'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20':'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'}`}>{isCH1?'CH1':'CH2'}</span>
                  {cpsCredsResolved && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-400/20 px-1.5 py-0.5 rounded-full">
                      <Key size={8} /> Creds auto-resolved
                    </span>
                  )}
                  {hasCpsCsvCredentials && !cpsCredsResolved && !cpsData && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">🔑 CSV loaded — will auto-resolve on load</span>
                  )}
                </div>
                <p className="text-gray-400 dark:text-gray-500 text-xs font-mono break-all">{cpsBaseUrl}</p>
                {/* Editable key + env overrides */}
                <div className="flex flex-wrap gap-2 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Env</span>
                    <input
                      value={cpsEnvOverride || effectiveCpsEnv}
                      onChange={(e) => { setCpsEnvOverride(e.target.value); setCpsData(null); setCpsError(''); }}
                      className="bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-gray-200 font-mono w-24 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">Key</span>
                    <input
                      value={cpsKeyOverride || effectiveCpsKey}
                      onChange={(e) => { setCpsKeyOverride(e.target.value); setCpsData(null); setCpsError(''); }}
                      className="bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-lg px-2 py-1 text-xs text-gray-700 dark:text-gray-200 font-mono w-56 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {cpsData && Object.keys(cpsData.nonSecure).length > 0 && (
                  <>
                    <button
                      onClick={() => {
                        const raw = cpsData.rawNsResponse;
                        setRawJsonView({
                          title: 'Non-Secure Properties (Raw JSON)',
                          data: raw
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sf-700 dark:text-sf-300 hover:text-white bg-sf-50 dark:bg-sf-500/10 hover:bg-sf-600 border border-sf-200/60 dark:border-sf-400/20 hover:border-sf-600 rounded-lg transition-all">
                      <Database size={11} /> Raw JSON (NS)
                    </button>
                    <button
                      onClick={() => {
                        // Copy the original raw CPS API response (not the parsed flat object)
                        const raw = cpsData.rawNsResponse;
                        navigator.clipboard.writeText(
                          typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
                        );
                        setCopiedCpsNs(true);
                        setTimeout(() => setCopiedCpsNs(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:text-white bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-600 border border-emerald-200/60 dark:border-emerald-400/20 hover:border-emerald-600 rounded-lg transition-all">
                      {copiedCpsNs ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Non-Secure</>}
                    </button>
                  </>
                )}
                {cpsData && cpsData.secureGroups.length > 0 && (
                  <>
                    <button
                      onClick={() => {
                        const raw = cpsData.rawSecureResponse;
                        setRawJsonView({
                          title: 'Secure Properties (Raw JSON)',
                          data: raw
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sf-700 dark:text-sf-300 hover:text-white bg-sf-50 dark:bg-sf-500/10 hover:bg-sf-600 border border-sf-200/60 dark:border-sf-400/20 hover:border-sf-600 rounded-lg transition-all">
                      <Database size={11} /> Raw JSON (Sec)
                    </button>
                    <button
                      onClick={() => {
                        // Copy the original raw secure CPS API response
                        const raw = cpsData.rawSecureResponse;
                        navigator.clipboard.writeText(
                          typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
                        );
                        setCopiedCpsSec(true);
                        setTimeout(() => setCopiedCpsSec(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sfpurple-700 dark:text-sfpurple-300 hover:text-white bg-sfpurple-50 dark:bg-sfpurple-500/10 hover:bg-sfpurple-600 border border-sfpurple-200/60 dark:border-sfpurple-400/20 hover:border-sfpurple-600 rounded-lg transition-all">
                      {copiedCpsSec ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Secure</>}
                    </button>
                  </>
                )}
                <button onClick={() => loadCpsData(cpsKeyOverride, cpsEnvOverride)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 rounded-lg transition-all"><RefreshCw size={11}/> {cpsData ? 'Refresh' : 'Load'}</button>
                <button onClick={() => setShowCpsSettings(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white rounded-lg shadow-sm shadow-sf-500/30 hover:shadow-md transition-all"><Key size={11}/> Configure CPS</button>
              </div>
            </div>
          </div>

          {/* Missing credentials warning */}
          {cpsMissingCred && (
            <div className="flex items-center justify-between gap-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex-shrink-0">
                  <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold">CPS credentials not configured</p>
                  <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-0.5">Missing <code className="bg-amber-100 dark:bg-amber-500/15 px-1 rounded">{cpsMissingCred}</code> credentials. Click "Configure CPS" to add them.</p>
                </div>
              </div>
              <button onClick={() => setShowCpsSettings(true)} className="flex-shrink-0 px-3.5 py-2 text-xs font-semibold bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white rounded-xl shadow-md shadow-amber-500/30 hover:shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0">Configure</button>
            </div>
          )}

          {/* Error */}
          {cpsError && (
            <div className="bg-red-50 dark:bg-red-500/5 border border-red-200/60 dark:border-red-400/15 rounded-2xl px-5 py-4 space-y-2">
              <div className="flex items-center gap-3 text-red-700 dark:text-red-300 text-sm font-medium">
                <AlertTriangle size={14} className="flex-shrink-0" /> {cpsError}
              </div>
              {cpsAttemptedUrl && (
                <div className="text-[10px] text-red-500/80 dark:text-red-400/70 font-mono break-all border-t border-red-200/40 dark:border-red-400/15 pt-2">
                  Attempted: {cpsAttemptedUrl}
                </div>
              )}
              <div className="text-[10px] text-red-500/70 dark:text-red-400/60 pt-0.5">
                💡 Check the <strong>Env</strong> and <strong>Key</strong> fields above — they must match exactly what's stored in CPS.
                Check the backend console for the full URL that was called.
              </div>
            </div>
          )}

          {/* Loading */}
          {cpsLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Loading CPS properties…</span>
            </div>
          )}

          {/* Not loaded yet */}
          {!cpsLoading && !cpsData && !cpsError && !cpsMissingCred && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
                <Key size={24} className="text-sf-500 dark:text-sf-400" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Click to load properties from the Config Property Server</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs">Will fetch <code className="text-gray-500 dark:text-gray-400">{effectiveCpsKey}</code> in <code className="text-gray-500 dark:text-gray-400">{effectiveCpsEnv}</code></p>
              <button onClick={() => loadCpsData(cpsKeyOverride, cpsEnvOverride)} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white text-sm font-semibold rounded-xl shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20 transition-all hover:-translate-y-0.5 active:translate-y-0">
                <Key size={13} /> Load CPS Properties
              </button>
            </div>
          )}

          {/* CPS data loaded */}
          {cpsData && (
            <div className="space-y-5">
              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input value={cpsSearch} onChange={(e) => setCpsSearch(e.target.value)} placeholder="Filter CPS properties by key or value…"
                  className="w-full bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 shadow-sm transition-all" />
              </div>

              {/* Non-secure properties — flat table from the properties object */}
              {Object.keys(cpsData.nonSecure).length > 0 && (() => {
                const CHIP_KEYS = new Set(['cps.secure.properties', 'cps.secure.binaries']);
                const searchLo = cpsSearch.toLowerCase();
                const visibleEntries = Object.entries(cpsData.nonSecure)
                  .filter(([k, v]) => !searchLo || k.toLowerCase().includes(searchLo) || String(v).toLowerCase().includes(searchLo))
                  .sort(([a], [b]) => a.localeCompare(b));

                return (
                  <GlassCard icon={Settings} title="Non-Secure Properties" count={visibleEntries.length} accent="blue" noPad>
                    <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-700/60">
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase w-[42%]">Property Key</th>
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleEntries.map(([k, v]) => {
                          const isChip = CHIP_KEYS.has(k);
                          const isNum = typeof v === 'number';
                          const display = v === null || v === undefined ? '—'
                            : typeof v === 'object' ? JSON.stringify(v)
                            : String(v);
                          return (
                            <tr key={k} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                              <td className="px-5 py-3 align-top">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all">{k}</span>
                                  <CopyBtn text={k} />
                                </div>
                              </td>
                              <td className="px-5 py-3 align-top">
                                {isChip ? (
                                  <div className="flex flex-wrap gap-1">
                                    {display.split(',').map((item) => item.trim()).filter(Boolean).map((item) => (
                                      <span key={item} className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-mono border ${
                                        k === 'cps.secure.binaries'
                                          ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20'
                                          : 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20'
                                      }`}>{item}</span>
                                    ))}
                                    <CopyBtn text={display} />
                                  </div>
                                ) : (
                                  <div className="flex items-start gap-1.5">
                                    <span className={`text-xs font-mono break-all ${isNum ? 'text-sfteal-700 dark:text-sfteal-300' : 'text-gray-700 dark:text-gray-200'}`}>{display}</span>
                                    <CopyBtn text={display} />
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </GlassCard>
                );
              })()}

              {/* ── Get Secure Properties button ── */}
              {cpsData.secureKeys && cpsData.secureGroups.length === 0 && (
                <div className="flex items-center justify-between bg-sfpurple-50/60 dark:bg-sfpurple-500/5 border border-sfpurple-200/50 dark:border-sfpurple-400/15 rounded-2xl px-5 py-4">
                  <div className="space-y-1">
                    <p className="text-sfpurple-700 dark:text-sfpurple-300 text-sm font-semibold flex items-center gap-2">
                      <Key size={13} /> Secure Properties
                    </p>
                    <p className="text-sfpurple-500 dark:text-sfpurple-400 text-xs">Keys: {cpsData.secureKeys}</p>
                  </div>
                  <button
                    disabled={secureLoading}
                    onClick={async () => {
                      try {
                        setSecureLoading(true);
                        // Re-post ALL CSV credentials before the secure fetch.
                        // The session may have expired or been cleared since the
                        // non-secure load — this ensures getCredentials() can find
                        // a valid credential and doesn't return 422.
                        if (hasCpsCsvCredentials && cpsBaseUrl) {
                          const normBase = cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
                          const allCreds = getAllCredentials();
                          if (allCreds.length > 0) {
                            const credMap = {};
                            for (const { clientId, clientSecret } of allCreds) {
                              credMap[`${normBase}::${clientId}`] = { clientId, clientSecret };
                            }
                            try { await api.post('/cps/credentials', { credentials: credMap }); } catch {}
                          }
                        }
                        const sr = await api.get('/cps/fetch', { params: {
                          baseUrl: cpsBaseUrl, type: 'secure', environment: cpsData.useEnv,
                          keys: cpsData.secureKeys, deploymentType: cpsDepType, envName: appEnvName, bgOrgId: orgId
                        }});
                        const raw = sr.data;
                        const groups = Array.isArray(raw?.responses) ? raw.responses
                          : Array.isArray(raw?.properties) ? raw.properties
                          : Array.isArray(raw) ? raw : [];
                        setCpsData((prev) => ({ ...prev, secureGroups: groups, rawSecureResponse: raw }));
                      } catch (e) {
                        // show error in the secure section
                        setCpsData((prev) => ({ ...prev, secureGroups: [{ key: '__error__', _error: e.response?.data?.error || e.message }] }));
                      }
                      setSecureLoading(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-sfpurple-500 to-sfpurple-600 hover:from-sfpurple-400 hover:to-sfpurple-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-sfpurple-500/30 hover:shadow-lg hover:shadow-sfpurple-500/40 ring-1 ring-inset ring-white/20 transition-all disabled:opacity-50 flex-shrink-0 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    {secureLoading
                      ? <><RefreshCw size={12} className="animate-spin" /> Loading…</>
                      : <><Key size={12} /> Get Secure Properties</>}
                  </button>
                </div>
              )}

              {/* Secure property groups */}
              {cpsData.secureGroups.length > 0 && cpsData.secureGroups.map((group) => {
                // Error group — show error message instead of a property card
                if (group.key === '__error__' || group._error) {
                  return (
                    <div key="__error__" className="flex items-start gap-3 bg-red-50 dark:bg-red-500/5 border border-red-200/60 dark:border-red-400/15 rounded-xl px-5 py-4 text-red-700 dark:text-red-300 text-sm">
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Secure properties could not be loaded</p>
                        <p className="text-xs text-red-500/80 dark:text-red-400/70 mt-1">{group._error || 'Unknown error'}</p>
                        <p className="text-xs text-red-600/60 dark:text-red-400/50 mt-1">
                          The credential may not have access to this project's secure properties. Try refreshing the page to retry with a different credential.
                        </p>
                      </div>
                    </div>
                  );
                }
                const groupProps = group.properties || {};
                // Skip groups where properties is a "COULD NOT ACCESS" string
                if (typeof groupProps === 'string') {
                  return (
                    <div key={group.key} className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-xl px-5 py-3 text-amber-700 dark:text-amber-300 text-xs">
                      <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                      <span>🔒 <strong>{group.key}</strong>: {groupProps}</span>
                    </div>
                  );
                }
                const filtered = Object.entries(groupProps).filter(([k, v]) =>
                  !cpsSearch || k.toLowerCase().includes(cpsSearch.toLowerCase()) || String(v).toLowerCase().includes(cpsSearch.toLowerCase()));
                if (filtered.length === 0 && cpsSearch) return null;
                return (
                  <GlassCard key={group.key} icon={Key} title={`🔒 ${group.key}`} count={Object.keys(groupProps).length} accent="orange" noPad>
                    <div className="px-5 py-2 bg-sforange-50/60 dark:bg-sforange-500/5 border-b border-sforange-200/40 dark:border-sforange-400/10 flex items-center justify-between">
                      <span className="text-[10px] text-sforange-600 dark:text-sforange-400">Secure property group — treat values as sensitive</span>
                      <CopyGroupBtn text={JSON.stringify({
                        responses: [{
                          environment: group.environment || cpsData.useEnv || effectiveCpsEnv,
                          key: group.key,
                          properties: groupProps,
                        }]
                      }, null, 2)} />
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm border-collapse">
                      <tbody>
                        {(cpsSearch ? filtered : Object.entries(groupProps).sort(([a],[b])=>a.localeCompare(b))).map(([k, v]) => (
                          <tr key={k} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                            <td className="px-5 py-3 w-[42%]"><span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all">{k}</span></td>
                            <td className="px-5 py-3"><SecretVal value={String(v)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </GlassCard>
                );
              })}

              {/* ── Binary Assets — displayed directly from cps.secure.binaries ── */}
              {cpsData.binaryKeys && (() => {
                const binaryFiles = cpsData.binaryKeys.split(',').map((f) => f.trim()).filter(Boolean)
                  .filter((f) => !cpsSearch || f.toLowerCase().includes(cpsSearch.toLowerCase()));
                if (binaryFiles.length === 0) return null;
                return (
                  <GlassCard icon={Package} title="Binary Assets" count={binaryFiles.length} accent="purple" noPad>
                    <div className="px-5 py-2 bg-sfpurple-50/60 dark:bg-sfpurple-500/5 border-b border-sfpurple-200/40 dark:border-sfpurple-400/10">
                      <span className="text-[10px] text-sfpurple-600 dark:text-sfpurple-400">Binary files configured in <code className="text-sfpurple-700 dark:text-sfpurple-300">cps.secure.binaries</code></span>
                    </div>
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-700/60">
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">File Name</th>
                          <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">Extension</th>
                        </tr>
                      </thead>
                      <tbody>
                        {binaryFiles.map((fileName, i) => {
                          const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '—';
                          const extColor = ext === 'jks' ? 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'
                            : ext === 'pem' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20'
                            : ext === 'gpg' || ext === 'pgp' ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20'
                            : ext === 'crt' || ext === 'cer' ? 'bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60';
                          return (
                            <tr key={i} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-gray-700 dark:text-gray-200 text-xs font-mono">{fileName}</span>
                                  <CopyBtn text={fileName} />
                                </div>
                              </td>
                              <td className="px-5 py-3">
                                <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-md font-mono border uppercase ${extColor}`}>{ext}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </GlassCard>
                );
              })()}
            </div>
          )}
        </div>
        );
      })()}

      {/* ── DEPENDENCIES ────────────────────────────── */}
      {tab==='dependencies' && (() => {
        // ── Dependency-detection helpers ──────────────────────────────────────
        // Matches property keys that typically point to upstream hosts / URLs.
        const DEP_KEY_RE = /(host|url|uri|endpoint|address|base[-_.]?url|server|upstream|callback|redirect|webhook)/i;

        const isLikelyUrl = (v) => {
          if (typeof v !== 'string' || !v.trim()) return false;
          const s = v.trim();
          if (s.startsWith('${')) return false; // unresolved placeholder
          if (/^(true|false|\d+)$/i.test(s)) return false; // booleans / plain numbers
          return (
            s.startsWith('http://') || s.startsWith('https://') ||
            /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)
          );
        };

        const classifyHost = (h) => {
          if (h.endsWith('.cloudhub.io'))
            return { type: 'CH1', label: 'CloudHub 1.0', color: 'purple', internal: true };
          if (h.endsWith('.sfdcbt.net') || h.endsWith('.msap.io') || /\.[a-z]+-[a-z0-9]+\.msap\.io$/.test(h))
            return { type: 'CH2', label: 'CloudHub 2.0', color: 'blue', internal: true };
          if (h.endsWith('.mulesoft.com') || h.includes('anypoint.mulesoft'))
            return { type: 'ANYPOINT', label: 'Anypoint Platform', color: 'cyan', internal: true };
          return { type: 'EXTERNAL', label: 'External', color: 'gray', internal: false };
        };

        const seen = new Map();
        const addEntry = (key, rawVal, source) => {
          if (!DEP_KEY_RE.test(key)) return;
          const v = String(rawVal ?? '').trim();
          if (!isLikelyUrl(v)) return;
          let host;
          try {
            host = new URL(v.startsWith('http') ? v : `https://${v}`).hostname.toLowerCase();
          } catch { host = v.toLowerCase(); }
          if (!host || host === 'localhost' || host.startsWith('127.') || host.startsWith('0.0.0.')) return;
          const appNameLo = (app.name || '').toLowerCase().replace(/-/g, '');
          if (appNameLo && host.replace(/-/g, '').startsWith(appNameLo)) return;

          if (!seen.has(host)) seen.set(host, { host, ...classifyHost(host), refs: [], _dup: new Set() });
          const entry = seen.get(host);
          const triplet = `${key}::${v}::${source}`;
          if (entry._dup.has(triplet)) return;
          entry._dup.add(triplet);
          entry.refs.push({ key, value: v, source });
        };

        // Scan all three sources
        Object.entries(allProps).forEach(([k, v]) => addEntry(k, v, 'ARM'));
        if (cpsData?.nonSecure)
          Object.entries(cpsData.nonSecure).forEach(([k, v]) => addEntry(k, v, 'CPS (non-secure)'));
        if (cpsData?.secureGroups)
          cpsData.secureGroups.forEach(g => {
            if (g.properties && typeof g.properties === 'object')
              Object.entries(g.properties).forEach(([k, v]) => addEntry(k, v, 'CPS (secure)'));
          });

        let deps = [...seen.values()];
        const searchLo = depSearch.toLowerCase();
        if (searchLo)
          deps = deps.filter(d =>
            d.host.includes(searchLo) ||
            d.refs.some(r => r.key.toLowerCase().includes(searchLo) || r.value.toLowerCase().includes(searchLo))
          );

        const internal = deps.filter(d => d.internal);
        const external = deps.filter(d => !d.internal);
        const total = seen.size; // unfiltered count

        const srcBadge = (source) => {
          const s = {
            'ARM': 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20',
            'CPS (non-secure)': 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60',
            'CPS (secure)': 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20',
          }[source] || 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60';
          return <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${s}`}>{source}</span>;
        };

        const typeBadge = (dep) => {
          const cls = {
            CH1:      'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20',
            CH2:      'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20',
            ANYPOINT: 'bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20',
            EXTERNAL: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60',
          }[dep.type] || 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60';
          return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{dep.label}</span>;
        };

        const DepTable = ({ rows, title, accent }) => (
          <GlassCard icon={Share2} title={title} count={rows.length} accent={accent} noPad>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-700/60">
                  {['Host / URL', 'Type', 'Discovered via (property key → value)'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((dep) => (
                  <tr key={dep.host} className="border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors align-top">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-200 break-all">{dep.host}</span>
                        <CopyBtn text={dep.host} />
                      </div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">{typeBadge(dep)}</td>
                    <td className="px-5 py-3">
                      <div className="space-y-1.5">
                        {dep.refs.map((r, i) => (
                          <div key={i} className="flex flex-wrap items-start gap-1.5">
                            {srcBadge(r.source)}
                            <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 break-all">{r.key}</span>
                            <span className="text-gray-400 dark:text-gray-600 text-[10px]">→</span>
                            <span className="font-mono text-[10px] text-gray-600 dark:text-gray-300 break-all">{r.value}</span>
                            <CopyBtn text={r.value} />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        );

        return (
          <div className="space-y-5">
            {/* Stat tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatTile icon={Share2} label="Total Hosts" accent="teal" value={total} />
              <StatTile icon={ShieldCheck} label="Internal Apps" accent="blue" value={internal.length} sub="CH1 / CH2 / Anypoint" />
              <StatTile icon={Globe} label="External Hosts" accent="amber" value={external.length} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm flex items-center gap-2">
                  <Share2 size={14} className="text-sfteal-600 dark:text-sfteal-400" /> App Dependencies
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                  Upstream hosts and external services detected from ARM properties
                  {cpsData ? ' and CPS properties' : ''}.
                  {!cpsData && cpsBaseUrl && (
                    <button onClick={() => { setTab('cps'); loadCpsData(); }}
                      className="ml-1.5 text-sf-600 dark:text-sf-400 hover:text-sf-700 dark:hover:text-sf-300 underline underline-offset-2 font-medium">
                      Load CPS to discover more
                    </button>
                  )}
                </p>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <input
                value={depSearch}
                onChange={e => setDepSearch(e.target.value)}
                placeholder="Filter by host, property key, or value…"
                className="w-full bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 shadow-sm transition-all"
              />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
              <span className="font-semibold text-gray-500 dark:text-gray-400">Sources:</span>
              <span className="px-1.5 py-0.5 rounded border bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20 font-mono">ARM</span>
              <span className="text-gray-400 dark:text-gray-500">= CloudHub deployment properties</span>
              <span className="px-1.5 py-0.5 rounded border bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60 font-mono">CPS (non-secure)</span>
              <span className="px-1.5 py-0.5 rounded border bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20 font-mono">CPS (secure)</span>
            </div>

            {deps.length === 0 && !searchLo && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sfteal-100 dark:bg-sfteal-500/10">
                  <Share2 size={24} className="text-sfteal-500 dark:text-sfteal-400" />
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">No upstream dependencies detected</p>
                <p className="text-gray-400 dark:text-gray-500 text-xs text-center max-w-sm">
                  No properties containing <code className="text-gray-500 dark:text-gray-400">host</code>, <code className="text-gray-500 dark:text-gray-400">url</code>,
                  <code className="text-gray-500 dark:text-gray-400"> endpoint</code>, or <code className="text-gray-500 dark:text-gray-400">uri</code> patterns were found
                  with URL-like values.
                  {!cpsData && cpsBaseUrl && ' Load CPS properties above to scan more sources.'}
                </p>
              </div>
            )}

            {deps.length === 0 && searchLo && (
              <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                No dependencies match <span className="ml-1 font-mono text-gray-700 dark:text-gray-300">"{depSearch}"</span>
              </div>
            )}

            {internal.length > 0 && <DepTable rows={internal} title="Internal MuleSoft Apps" accent="blue" />}
            {external.length > 0 && <DepTable rows={external} title="External Hosts" accent="amber" />}
          </div>
        );
      })()}

      {/* ── CONTRACTS ───────────────────────────────── */}
      {tab==='contracts' && (() => {
        const approvedCount = contracts ? contracts.filter(c => (c.status || '').toUpperCase() === 'APPROVED').length : 0;
        const pendingCount = contracts ? contracts.filter(c => !['APPROVED','REVOKED'].includes((c.status || '').toUpperCase())).length : 0;
        return (
        <div className="space-y-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile icon={Key} label="Total Contracts" accent="emerald" value={contracts ? contracts.length : '—'} />
            <StatTile icon={Check} label="Approved" accent="emerald" value={contracts ? approvedCount : '—'} />
            <StatTile icon={AlertTriangle} label="Pending / Other" accent="amber" value={contracts ? pendingCount : '—'} />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm">API Consumer Contracts</h2>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                Client applications approved to consume this API instance
                {contractApiInstanceId && <span className="ml-2 font-mono text-gray-400 dark:text-gray-500">API ID: {contractApiInstanceId}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  localStorage.setItem('mule_apimgr_bg', orgId);
                  if (envId) localStorage.setItem('mule_apimgr_env', envId);
                  if (contractApiInstanceId) localStorage.setItem('mule_apimgr_instance', String(contractApiInstanceId));
                  navigate('/api-manager');
                }}
                title="Open API Manager for this environment"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sf-700 dark:text-sf-300 hover:text-white bg-sf-50 dark:bg-sf-500/10 hover:bg-sf-600 border border-sf-200/60 dark:border-sf-400/20 hover:border-sf-600 rounded-lg transition-all">
                <ShieldCheck size={11} /> Open in API Manager
              </button>
              <button onClick={loadContracts} disabled={contractsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 rounded-lg transition-all">
                <RefreshCw size={11} className={contractsLoading ? 'animate-spin' : ''} />
                {contracts ? 'Refresh' : 'Load'}
              </button>
            </div>
          </div>

          {/* Contract action result toast */}
          {contractActionResult && (
            <div className={`flex items-center justify-between px-4 py-3 rounded-xl border text-sm ${
              contractActionResult.success
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-400/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-500/10 border-red-200/60 dark:border-red-400/20 text-red-700 dark:text-red-300'
            }`}>
              <span>{contractActionResult.message}</span>
              <button onClick={() => setContractActionResult(null)} className="ml-4 opacity-60 hover:opacity-100"><X size={14} /></button>
            </div>
          )}

          {contractsLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Loading contracts…</span>
            </div>
          )}

          {contractsError && !contractsLoading && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/15 flex-shrink-0">
                <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold">No contracts available</p>
                <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-1">{contractsError}</p>
              </div>
            </div>
          )}

          {contracts !== null && !contractsLoading && !contractsError && (
            contracts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
                <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10">
                  <Key size={24} className="text-emerald-500 dark:text-emerald-400" />
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">No approved contracts for this API instance</p>
              </div>
            ) : (
              <GlassCard icon={Key} title="Consumer Contracts" count={contracts.length} accent="green" noPad>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-700/60">
                        {['Client App', 'Client ID', 'Status', 'SLA Tier', 'Requested', 'Actions'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c, i) => {
                        const status = (c.status || 'UNKNOWN').toUpperCase();
                        const statusCls = status === 'APPROVED'
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20'
                          : status === 'REVOKED'
                          ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20'
                          : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20';
                        const clientId =
                          c.application?.coreServicesId ||
                          c.application?.clientId ||
                          c.clientApplication?.coreServicesId ||
                          c.clientId || '—';
                        const slaTier = c.tier?.name || c.slaTier?.name || c.tierLabel || '—';
                        const reqDate = c.requestedAt || c.createdDate
                          ? new Date(c.requestedAt || c.createdDate).toLocaleDateString()
                          : '—';
                        const appName = c.application?.name || c.clientApplication?.name || '—';
                        const contractId = c.id;
                        const isActioning = contractActionLoading === contractId;
                        // Determine which action buttons to show based on current status
                        const canApprove = status === 'PENDING' || status === 'REVOKED';
                        const canRevoke  = status === 'APPROVED' || status === 'PENDING';
                        return (
                          <tr key={i} className="border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                            <td className="px-5 py-3">
                              <p className="text-gray-700 dark:text-gray-200 text-xs font-medium">{appName}</p>
                              {c.application?.description && (
                                <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5 truncate max-w-xs">{c.application.description}</p>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{clientId}</span>
                                {clientId !== '—' && <CopyBtn text={String(clientId)} />}
                              </div>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full border font-bold ${statusCls}`}>{status}</span>
                            </td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{slaTier}</td>
                            <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{reqDate}</td>
                            <td className="px-5 py-3">
                              {contractId ? (
                                <div className="flex items-center gap-1.5">
                                  {isActioning ? (
                                    <span className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 px-2 py-1">
                                      <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400 dark:border-gray-500" /> Working…
                                    </span>
                                  ) : (
                                    <>
                                      {canApprove && (
                                        <button
                                          onClick={() => setContractConfirmState({ contractId, action: 'approve', appName })}
                                          title={`Approve contract for ${appName}`}
                                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-500/30">
                                          <Check size={9} /> Approve
                                        </button>
                                      )}
                                      {canRevoke && (
                                        <button
                                          onClick={() => setContractConfirmState({ contractId, action: 'revoke', appName })}
                                          title={`Revoke contract for ${appName}`}
                                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-md hover:shadow-red-500/30">
                                          <X size={9} /> Revoke
                                        </button>
                                      )}
                                      <button
                                        onClick={() => setContractConfirmState({ contractId, action: 'delete', appName })}
                                        title={`Permanently delete contract for ${appName}`}
                                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200/50 dark:border-red-400/20 hover:bg-red-700 hover:text-white hover:border-red-700 hover:shadow-md hover:shadow-red-500/30">
                                        <Trash2 size={9} /> Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            )
          )}

          {contracts === null && !contractsLoading && !contractsError && (
            <div className="flex flex-col items-center justify-center py-16 gap-4 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
                <Key size={24} className="text-sf-500 dark:text-sf-400" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">Click <strong className="text-gray-700 dark:text-gray-200">Load</strong> to fetch consumer contracts from API Manager</p>
              <button onClick={loadContracts}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 text-white text-sm font-semibold rounded-xl shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20 transition-all hover:-translate-y-0.5 active:translate-y-0">
                <Key size={13} /> Load Contracts
              </button>
            </div>
          )}
        </div>
        );
      })()}

      {/* ── PING TEST ───────────────────────────────── */}
      {tab==='ping' && (
        <PingTestPanel
          appName={app.name}
          isCH1={isCH1}
          orgId={orgId}
          envId={envId}
          ch2IngressUrl={
            httpInbound.publicUrl ||
            endpoints.find(e => e.access === 'external')?.url ||
            endpoints[0]?.url ||
            null
          }
          defaultClientId={
            allProps['client_id'] ||
            allProps['clientId'] ||
            allProps['client.id'] ||
            ''
          }
          defaultClientSecret={
            allProps['client_secret'] ||
            allProps['clientSecret'] ||
            allProps['client.secret'] ||
            ''
          }
          cpsBaseUrl={cpsBaseUrl || ''}
          cpsClientId={cpsClientId || ''}
          cpsKey={effectiveCpsKey || ''}
          cpsEnv={effectiveCpsEnv || ''}
          pingSpec={pingSpec}
          pingSpecLoading={pingSpecLoading}
          envType={app.environment?.type || ''}
          envName={resolvedEnvName || app.environment?.name || ''}
        />
      )}

      {/* ── API SPEC ────────────────────────────────── */}
      {tab==='apispec' && (() => {
        const methodCls = (m) => m === 'GET' ? 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'
          : m === 'POST' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20'
          : m === 'PUT' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20'
          : m === 'DELETE' ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200/60 dark:border-gray-700/60';
        return (
        <div className="space-y-5">
          {/* Stat tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile icon={Globe} label="Total Endpoints" accent="blue" value={pingSpec?.allEndpoints?.length ?? '—'} sub={pingSpec?.specType ? pingSpec.specType.toUpperCase() : undefined} />
            <StatTile icon={Activity} label="Ping / Health Paths" accent="emerald" value={pingSpec?.pingEndpoints?.length ?? '—'} />
            <StatTile icon={Package} label="Exchange Asset" accent="purple" value={pingSpec?.assetName || '—'} />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm flex items-center gap-2">
                <Globe size={14} className="text-sf-600 dark:text-sf-400" /> API Specification — Exchange
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                {pingSpecLoading ? 'Searching Exchange and parsing spec…' :
                  pingSpec ? <>
                    <span className="text-gray-500 dark:text-gray-400">{pingSpec.assetName}</span>
                    {' · '}{pingSpec.specType?.toUpperCase()} · {pingSpec.allEndpoints?.length ?? 0} endpoints
                    {pingSpec.pingEndpoints?.length > 0 && (
                      <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                        · {pingSpec.pingEndpoints.length} ping path{pingSpec.pingEndpoints.length !== 1 ? 's' : ''} found
                      </span>
                    )}
                  </> : 'No spec available — app may not have an Exchange asset linked'}
              </p>
            </div>
            <button onClick={() => fetchPingSpec()} disabled={pingSpecLoading}
              title="Re-fetch API spec from Exchange"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 rounded-lg transition-all disabled:opacity-50">
              <RefreshCw size={11} className={pingSpecLoading ? 'animate-spin' : ''} />
              {pingSpec ? 'Refresh' : 'Fetch Spec'}
            </button>
          </div>

          {pingSpecLoading && (
            <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
              <RefreshCw size={18} className="animate-spin" />
              <span className="text-sm">Searching Exchange and parsing API spec…</span>
            </div>
          )}

          {!pingSpecLoading && !pingSpec && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
                <Globe size={24} className="text-sf-500 dark:text-sf-400" />
              </div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">No Exchange spec found for this application</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs">The app needs an Exchange asset linked via <code className="text-gray-500 dark:text-gray-400">application.ref</code> in its ARM descriptor</p>
            </div>
          )}

          {pingSpec && !pingSpecLoading && (
            <>
              {/* Ping endpoints highlighted */}
              {pingSpec.pingEndpoints?.length > 0 && (
                <GlassCard icon={Activity} title="Ping / Health Endpoints" count={pingSpec.pingEndpoints.length} accent="green" noPad>
                  <div className="px-5 py-2 bg-emerald-50/60 dark:bg-emerald-500/5 border-b border-emerald-200/40 dark:border-emerald-400/10">
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400">
                      These endpoints will be tried first during ping tests. Required query params are auto-filled.
                    </span>
                  </div>
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/60 dark:border-gray-700/60">
                        {['Method', 'Path', 'Query Params', 'Headers', 'Description'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pingSpec.pingEndpoints.map((ep, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/30 dark:hover:bg-sf-500/5 transition-colors">
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${methodCls(ep.method)}`}>{ep.method}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-sfteal-700 dark:text-sfteal-300">{ep.path}</td>
                          <td className="px-4 py-3">
                            {ep.queryParams?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ep.queryParams.map(p => (
                                  <span key={p.name} title={`${p.description}${p.example ? ` (e.g. ${p.example})` : ''}`}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${p.required ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
                                    {p.name}{p.required ? '*' : ''}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {ep.headers?.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {ep.headers.map(h => (
                                  <span key={h.name} title={h.description}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${h.required ? 'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
                                    {h.name}{h.required ? '*' : ''}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{ep.description || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </GlassCard>
              )}

              {/* All endpoints table */}
              {pingSpec.allEndpoints?.length > 0 && (
                <GlassCard icon={Globe} title="All Endpoints" count={pingSpec.allEndpoints.length} accent="cyan" noPad>
                  <div className="max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead className="sticky top-0">
                        <tr className="bg-gray-50/95 dark:bg-gray-800/90 border-b border-gray-200/60 dark:border-gray-700/60">
                          {['Method', 'Path', 'Query Params', 'Headers', 'Description'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pingSpec.allEndpoints.map((ep, i) => {
                          const isPing = pingSpec.pingEndpoints?.some(p => p.path === ep.path && p.method === ep.method);
                          return (
                            <tr key={i} className={`border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/30 dark:hover:bg-sf-500/5 transition-colors ${isPing ? 'bg-emerald-50/40 dark:bg-emerald-500/5' : ''}`}>
                              <td className="px-4 py-2.5">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border ${methodCls(ep.method)}`}>{ep.method}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`font-mono text-xs ${isPing ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-300'}`}>{ep.path}</span>
                                {isPing && <span className="ml-1.5 text-[9px] text-emerald-500 dark:text-emerald-400">● ping</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {ep.queryParams?.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {ep.queryParams.map(p => (
                                      <span key={p.name} title={p.description}
                                        className={`text-[9px] px-1 py-0.5 rounded border font-mono ${p.required ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
                                        {p.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-gray-400 dark:text-gray-600 text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                {ep.headers?.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {ep.headers.map(h => (
                                      <span key={h.name} title={h.description}
                                        className="text-[9px] px-1 py-0.5 rounded border font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60">
                                        {h.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : <span className="text-gray-400 dark:text-gray-600 text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs max-w-xs truncate">{ep.description || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-5 py-2 border-t border-gray-200/60 dark:border-gray-700/60 text-[10px] text-gray-400 dark:text-gray-500">
                    * = required · <span className="text-sforange-600 dark:text-sforange-400">orange</span> = required query param · <span className="text-sfpurple-600 dark:text-sfpurple-400">purple</span> = required header · <span className="text-emerald-600 dark:text-emerald-400">● ping</span> = health check endpoint
                  </div>
                </GlassCard>
              )}

              {pingSpec.pingEndpoints?.length === 0 && (
                <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
                  <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-700 dark:text-amber-300 text-sm font-medium">No ping/health endpoints detected</p>
                    <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-1">
                      The spec doesn't contain paths matching: ping, health, status, liveness, readiness, or heartbeat.
                      The dashboard will still try the standard paths: <code className="text-amber-700 dark:text-amber-300">/api/v1/ping → /api/v2/ping → /api/ping → /ping</code>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        );
      })()}

      {/* ── RAW JSON ────────────────────────────────── */}
      {tab==='raw' && (
        <GlassCard icon={Copy} title="Raw JSON">
          <PostmanJsonViewer data={app} />
        </GlassCard>
      )}
    </div>
  );
}
