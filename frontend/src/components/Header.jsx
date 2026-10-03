import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Menu, LogOut, RefreshCw, Building2, Globe, Bell, X, CheckCheck, Sun, Moon } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { isDemoMode } from '../services/api';
import api from '../services/api';
import CredentialImportButton from './CredentialImportButton';
import CpsCredentialImportButton from './CpsCredentialImportButton';
import BgFilterModal, { applyBgFilter, getVisibleBgIds } from './BgFilterModal';
import EnvFilterModal, { applyEnvFilter, getVisibleEnvIds } from './EnvFilterModal';

// ── Notification Bell Dropdown ────────────────────────────────────────────────
function NotificationBell() {
  const { notifications, unreadCount, markAllRead, dismiss, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const typeIcon = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const typeColor = {
    success: 'text-sfgreen-600',
    error: 'text-sfred-600',
    warning: 'text-sforange-600',
    info: 'text-sf-600',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(v => !v); if (!open && unreadCount > 0) markAllRead(); }}
        className="relative p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 text-[9px] font-bold bg-sfred-500 text-white rounded-full flex items-center justify-center leading-none shadow-sm shadow-sfred-500/40 ring-2 ring-white dark:ring-gray-900">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">Notifications</p>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <>
                  <button onClick={markAllRead} title="Mark all read"
                    className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors">
                    <CheckCheck size={10} /> Mark read
                  </button>
                  <button onClick={clearAll} title="Clear all"
                    className="text-[10px] text-sfred-500 hover:text-sfred-600 transition-colors">
                    Clear all
                  </button>
                </>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={20} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-gray-400 dark:text-gray-500 text-xs">No notifications</p>
              </div>
            ) : notifications.map(n => (
              <div key={n.id} className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${n.read ? 'opacity-60' : ''}`}>
                <span className="text-sm flex-shrink-0 mt-0.5">{typeIcon[n.type] || 'ℹ️'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium ${typeColor[n.type] || 'text-gray-700 dark:text-gray-300'} leading-snug`}>{n.title}</p>
                  {n.body && <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{n.body}</p>}
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1">
                    {new Date(n.ts).toLocaleTimeString()}
                  </p>
                </div>
                <button onClick={() => dismiss(n.id)} className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0 transition-colors">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Header({ onToggleSidebar }) {
  const { user, orgName, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const demo = isDemoMode();

  const [showBgFilter, setShowBgFilter] = useState(false);
  const [showEnvFilter, setShowEnvFilter] = useState(false);
  // Feature 7: last refresh timestamp
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [relativeTime, setRelativeTime] = useState('');
  const timerRef = useRef(null);
  const [allBgs, setAllBgs] = useState([]);
  const [allEnvs, setAllEnvs] = useState([]);
  const [envsLoading, setEnvsLoading] = useState(false);

  // Reactive filter-active state (re-reads localStorage after modal closes)
  const [bgFilterActive, setBgFilterActive] = useState(() => getVisibleBgIds().size > 0);
  const [envFilterActive, setEnvFilterActive] = useState(() => getVisibleEnvIds().size > 0);

  // Load BGs once on mount
  useEffect(() => {
    api.get('/organizations/business-groups')
      .then(r => setAllBgs(r.data?.data || []))
      .catch(() => {});
  }, []);

  // Load environments from all visible BGs when Env filter modal is about to open
  const loadEnvsForFilter = useCallback(async () => {
    if (allBgs.length === 0) return;
    setEnvsLoading(true);
    const visible = applyBgFilter(allBgs);
    const bgsToFetch = visible.length > 0 ? visible : allBgs.slice(0, 3);
    try {
      const results = await Promise.allSettled(bgsToFetch.map(bg => api.get(`/environments/${bg.id}`)));
      const merged = [];
      const seen = new Set();
      results.forEach((r, i) => {
        const bg = bgsToFetch[i];
        if (r.status === 'fulfilled') {
          (r.value.data?.data || []).forEach(e => {
            // Attach bgId + bgName so EnvFilterModal can group by Business Group
            if (!seen.has(e.id)) { seen.add(e.id); merged.push({ ...e, bgId: bg.id, bgName: bg.name }); }
          });
        }
      });
      setAllEnvs(merged);
    } catch { /* ignore */ }
    setEnvsLoading(false);
  }, [allBgs]);

  const handleOpenEnvFilter = () => {
    loadEnvsForFilter();
    setShowEnvFilter(true);
  };

  // Feature 7: update relative time every 30s
  const updateRelative = useCallback((ts) => {
    if (!ts) return;
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 10) setRelativeTime('just now');
    else if (diff < 60) setRelativeTime(`${diff}s ago`);
    else if (diff < 3600) setRelativeTime(`${Math.round(diff / 60)}m ago`);
    else setRelativeTime(`${Math.round(diff / 3600)}h ago`);
  }, []);

  useEffect(() => {
    if (!lastRefreshed) return;
    updateRelative(lastRefreshed);
    timerRef.current = setInterval(() => updateRelative(lastRefreshed), 30000);
    return () => clearInterval(timerRef.current);
  }, [lastRefreshed, updateRelative]);

  const handleRefresh = () => {
    setLastRefreshed(Date.now());
    window.location.reload();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleBgsCount = applyBgFilter(allBgs).length;
  const visibleEnvsCount = applyEnvFilter(allEnvs).length;

  const displayName = user?.firstName
    ? `${user.firstName} ${user.lastName || ''}`.trim()
    : user?.username || 'User';
  const initials = (displayName.match(/\b\w/g) || ['U']).slice(0, 2).join('').toUpperCase();

  return (
    <>
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBgs}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => setBgFilterActive(getVisibleBgIds().size > 0)}
        />
      )}
      {showEnvFilter && (
        <EnvFilterModal
          environments={allEnvs}
          onClose={() => setShowEnvFilter(false)}
          onSaved={() => setEnvFilterActive(getVisibleEnvIds().size > 0)}
        />
      )}

    <header className="relative h-16 bg-gradient-to-r from-white via-white to-sf-50/40 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900/95 backdrop-blur-xl border-b border-gray-200/70 dark:border-white/[0.06] flex items-center justify-between px-6 flex-shrink-0 sticky top-0 z-30 shadow-[0_4px_20px_-4px_rgba(15,23,42,0.06)] dark:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent" />
        <div className="flex items-center gap-2.5">
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 tracking-tight">
              {orgName || 'MuleSoft Dashboard'}
            </h2>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">Anypoint Platform</p>
          </div>
          {demo && (
            <span className="flex items-center gap-1.5 text-[10px] font-bold bg-gradient-to-r from-sfpurple-500/15 to-sfpurple-500/5 text-sfpurple-600 dark:text-sfpurple-300 border border-sfpurple-500/30 px-2.5 py-1 rounded-full shadow-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sfpurple-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sfpurple-500" />
              </span>
              DEMO
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Light / Dark theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="relative p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
        >
          <Sun size={16} className={`absolute inset-0 m-auto transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'}`} />
          <Moon size={16} className={`transition-all duration-300 ${isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'}`} />
        </button>

        <div className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent" />

        {/* Global BG + Env filter buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowBgFilter(true)}
            title="Filter visible Business Groups"
            className={`group/bg relative flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-xl border transition-all font-medium ${
              bgFilterActive
                ? 'bg-sf-50 dark:bg-sf-500/10 border-sf-200/70 dark:border-sf-400/30 text-sf-700 dark:text-sf-300 shadow-sm'
                : 'bg-gray-50/80 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sf-700 dark:hover:text-sf-300 hover:border-sf-200/70 dark:hover:border-sf-400/30 hover:bg-white dark:hover:bg-gray-800'
            }`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-lg flex-shrink-0 transition-colors ${
              bgFilterActive ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30' : 'bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400 group-hover/bg:bg-sf-100 dark:group-hover/bg:bg-sf-500/20 group-hover/bg:text-sf-600 dark:group-hover/bg:text-sf-400'
            }`}>
              <Building2 size={11} />
            </span>
            <span className="hidden sm:inline text-xs">BG</span>
            {bgFilterActive && allBgs.length > 0 && (
              <span className="text-[10px] font-bold px-1 rounded bg-sf-600/10 dark:bg-sf-400/15">{visibleBgsCount}/{allBgs.length}</span>
            )}
            {bgFilterActive && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sf-500 ring-2 ring-white dark:ring-gray-900" />
            )}
          </button>
          <button
            onClick={handleOpenEnvFilter}
            title="Filter visible Environments"
            disabled={envsLoading}
            className={`group/env relative flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-xl border transition-all font-medium disabled:opacity-50 ${
              envFilterActive
                ? 'bg-sfgreen-50 dark:bg-sfgreen-500/10 border-sfgreen-200/70 dark:border-sfgreen-400/30 text-sfgreen-700 dark:text-sfgreen-300 shadow-sm'
                : 'bg-gray-50/80 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-sfgreen-700 dark:hover:text-sfgreen-300 hover:border-sfgreen-200/70 dark:hover:border-sfgreen-400/30 hover:bg-white dark:hover:bg-gray-800'
            }`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-lg flex-shrink-0 transition-colors ${
              envFilterActive ? 'bg-sfgreen-600 text-white shadow-sm shadow-sfgreen-500/30' : 'bg-gray-200/70 dark:bg-gray-700/70 text-gray-500 dark:text-gray-400 group-hover/env:bg-sfgreen-100 dark:group-hover/env:bg-sfgreen-500/20 group-hover/env:text-sfgreen-600 dark:group-hover/env:text-sfgreen-400'
            }`}>
              {envsLoading
                ? <span className="animate-spin inline-block w-2.5 h-2.5 border-[1.5px] border-current rounded-full border-t-transparent" />
                : <Globe size={11} />}
            </span>
            <span className="hidden sm:inline text-xs">Env</span>
            {envFilterActive && allEnvs.length > 0 && (
              <span className="text-[10px] font-bold px-1 rounded bg-sfgreen-600/10 dark:bg-sfgreen-400/15">{visibleEnvsCount}/{allEnvs.length}</span>
            )}
            {envFilterActive && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sfgreen-500 ring-2 ring-white dark:ring-gray-900" />
            )}
          </button>
        </div>

        <div className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent" />

        {/* Global credential imports — always accessible from any page */}
        <div className="flex items-center gap-2">
          <CredentialImportButton compact />
          <CpsCredentialImportButton compact />
        </div>

        <div className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent" />

        {/* Feature 8: Notification bell */}
        <NotificationBell />

        {/* Feature 7: Refresh button with timestamp */}
        <div className="flex items-center gap-1">
          <button onClick={handleRefresh}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"
            title={lastRefreshed ? `Last refreshed ${relativeTime}` : 'Refresh page'}>
            <RefreshCw size={16} />
          </button>
          {relativeTime && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap hidden sm:inline" title="Last refreshed">
              {relativeTime}
            </span>
          )}
        </div>

        <div className="w-px h-6 bg-gradient-to-b from-transparent via-gray-200 dark:via-gray-700 to-transparent" />

        <div className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-sf-500 to-sfteal-500 flex items-center justify-center flex-shrink-0 ring-2 ring-white dark:ring-gray-900 shadow-sm">
            <span className="text-white text-[11px] font-bold">{initials}</span>
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden md:inline">
            {displayName}
          </span>
        </div>

        <button
          onClick={handleLogout}
          title={demo ? 'Exit Demo' : 'Logout'}
          className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-sfred-600 dark:hover:text-sfred-400 transition-colors p-2 rounded-xl hover:bg-sfred-50 dark:hover:bg-sfred-500/10"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
    </>
  );
}
