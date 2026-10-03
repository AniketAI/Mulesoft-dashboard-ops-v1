import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Server,
  ShieldCheck,
  Package,
  Activity,
  GitCompare,
  Users,
  Database,
  Globe,
  Wrench,
  ChevronRight
} from 'lucide-react';

const navItems = [
  { to: '/applications', icon: Server, label: 'Applications' },
  { to: '/api-manager', icon: ShieldCheck, label: 'API Manager' },
  { to: '/exchange', icon: Package, label: 'Exchange Assets' },
  { to: '/ping-test', icon: Activity, label: 'Ping Test' },
  { to: '/cps-compare', icon: GitCompare, label: 'CPS Compare' },
  { to: '/cps-manager', icon: Database, label: 'CPS Manager' },
  { to: '/global-cps-manager', icon: Globe, label: 'Global CPS Manager' },
  { to: '/user-search', icon: Users, label: 'Global Search' },
  { to: '/helper', icon: Wrench, label: 'Helper' },
];

export default function Sidebar({ open }) {
  const location = useLocation();
  return (
    <aside
      className={`${
        open ? 'w-64' : 'w-[72px]'
      } relative bg-gradient-to-b from-white via-white to-gray-50/70 dark:from-gray-900 dark:via-gray-900 dark:to-gray-950 border-r border-gray-200/70 dark:border-white/[0.06] flex flex-col transition-all duration-300 flex-shrink-0 shadow-[4px_0_24px_-8px_rgba(15,23,42,0.08)] dark:shadow-[4px_0_24px_-8px_rgba(0,0,0,0.4)] overflow-hidden`}
    >
      {/* Ambient brand glow behind the logo */}
      <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-sf-500/10 dark:bg-sf-500/15 blur-3xl pointer-events-none" />
      <div className="absolute top-24 -right-10 w-32 h-32 rounded-full bg-sfpurple-500/[0.06] dark:bg-sfpurple-500/10 blur-3xl pointer-events-none" />

      {/* Logo */}
      <div className="relative flex items-center h-16 px-4 border-b border-gray-100 dark:border-white/[0.06] flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-sf-500 to-sf-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-sf-500/30 dark:shadow-sf-900/60 ring-1 ring-black/5 dark:ring-white/10">
            <span className="text-white font-bold text-sm tracking-tight">M</span>
            <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-sfgreen-400 border-2 border-white dark:border-gray-900 shadow-sm" />
          </div>
          {open && (
            <div className="min-w-0">
              <p className="text-gray-900 dark:text-gray-100 font-bold text-sm leading-tight tracking-tight truncate">MuleSoft</p>
              <p className="text-gray-400 dark:text-gray-500 text-[10px] font-semibold uppercase tracking-wider">Ops Dashboard</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
        {open && (
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-600">
            Platform
          </p>
        )}
        {navItems.map(({ to, icon: Icon, label }) => {
          // Use prefix matching so sub-routes (e.g. /applications/:org/:env/:id)
          // keep the parent nav item highlighted (Feature 1.6).
          const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
          return (
            <NavLink
              key={to}
              to={to}
              title={!open ? label : undefined}
              className={() =>
                `group relative flex items-center gap-3 px-2.5 py-2.5 rounded-xl transition-all duration-200 text-sm font-medium ${
                  isActive
                    ? 'bg-gradient-to-r from-sf-500/10 via-sf-500/5 to-transparent dark:from-sf-500/15 dark:via-sf-500/5 text-sf-700 dark:text-sf-300'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'
                }`
              }
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-sf-600 shadow-[0_0_10px_rgba(1,118,211,0.7)]" />
              )}
              <span
                className={`relative flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 transition-all duration-200 ${
                  isActive
                    ? 'bg-sf-600 text-white shadow-md shadow-sf-500/40'
                    : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-200 group-hover:bg-white dark:group-hover:bg-gray-800 group-hover:shadow-sm group-hover:scale-105'
                }`}
              >
                {isActive && <span className="absolute inset-0 rounded-lg bg-sf-500 blur-md opacity-50 -z-10" />}
                <Icon size={16} />
              </span>
              {open && <span className="truncate">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      {open && (
        <div className="relative p-3 flex-shrink-0">
          <div className="rounded-xl bg-gradient-to-br from-gray-50 to-gray-100/60 dark:from-gray-800/60 dark:to-gray-800/20 border border-gray-100 dark:border-white/[0.06] px-3.5 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Anypoint Platform</p>
            <a
              href="https://docs.mulesoft.com/general/"
              target="_blank"
              rel="noreferrer"
              className="group/docs text-xs font-semibold text-sf-600 dark:text-sf-400 hover:text-sf-700 dark:hover:text-sf-300 flex items-center gap-1 mt-1.5 transition-colors"
            >
              Documentation
              <ChevronRight size={11} className="transition-transform group-hover/docs:translate-x-0.5" />
            </a>
          </div>
        </div>
      )}
    </aside>
  );
}
