import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ─── Context ──────────────────────────────────────────────────────────────────
const ThemeContext = createContext(null);

const STORAGE_KEY = 'mule_theme';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  // Fall back to OS preference, matching the inline anti-flash script in index.html
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyThemeClass(theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  // Lets native form controls / scrollbars pick the right color scheme too
  root.style.colorScheme = theme;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  // Keep the <html class="dark"> in sync (covers the case where state changes
  // after mount; the inline script in index.html already set it pre-paint).
  useEffect(() => { applyThemeClass(theme); }, [theme]);

  const setThemeAndPersist = useCallback((next) => {
    setTheme(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeAndPersist(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setThemeAndPersist]);

  // Follow OS theme changes live, but only while the user hasn't made an explicit choice
  useEffect(() => {
    let hasExplicitChoice = false;
    try { hasExplicitChoice = localStorage.getItem(STORAGE_KEY) !== null; } catch { /* ignore */ }
    if (hasExplicitChoice) return;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggleTheme, setTheme: setThemeAndPersist }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
