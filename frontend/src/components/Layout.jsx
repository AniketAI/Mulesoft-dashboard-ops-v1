import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

const SIDEBAR_KEY = 'mule_sidebar_open';

export default function Layout() {
  // Feature 2: persist sidebar state across page reloads
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return saved !== null ? saved === 'true' : true;
  });

  const toggleSidebar = () => {
    setSidebarOpen(v => {
      const next = !v;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="relative flex h-screen bg-gradient-to-br from-sf-50 via-sf-50/60 to-sfteal-50/40 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900 overflow-hidden">
      {/* Unified brand accent strip across the very top of the app shell */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sf-500 via-sfteal-400 to-sfpurple-500 z-40 shadow-[0_1px_8px_rgba(1,118,211,0.35)]" />
      <Sidebar open={sidebarOpen} />
      <div className="relative flex flex-col flex-1 overflow-hidden">
        {/* Ambient dark-mode glows behind the main content for depth */}
        <div className="hidden dark:block absolute top-0 right-0 w-[32rem] h-[32rem] rounded-full bg-sf-500/[0.07] blur-3xl pointer-events-none -z-10" />
        <div className="hidden dark:block absolute bottom-0 left-1/4 w-96 h-96 rounded-full bg-sfpurple-500/[0.05] blur-3xl pointer-events-none -z-10" />
        <Header onToggleSidebar={toggleSidebar} />
        <main className="relative flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
