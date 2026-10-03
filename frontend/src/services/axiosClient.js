import axios from 'axios';
import { isDemoMode } from '../utils/demoMode.js';

// ── Centralized Axios client ──────────────────────────────────────────────────
// Single source of truth for:
//   • base URL  (/api — proxied by Vite in dev, same-origin in prod)
//   • session-cookie credentials  (withCredentials)
//   • default Content-Type header
//   • 401 → login redirect (skipped in demo mode and for per-resource endpoints)
//
// Extracted from api.js so any future service module can import and reuse this
// client without going through the demo-mode facade.

// Track whether a redirect is already in progress to avoid double-redirects
// from concurrent requests all returning 401 simultaneously.
let _redirecting = false;

const axiosClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isDemoMode() && !_redirecting) {
      const url = error.config?.url || '';
      // Some endpoints return 401 for per-resource access issues (not session expiry).
      // Don't redirect to login for those — let the caller handle the rejection.
      const skipRedirect =
        url.includes('/applications/summary') ||  // BG access check (per-BG access)
        url.includes('/environments/')         ||  // env fetch for __all__ or restricted BG
        url.startsWith('/environments/')       ||  // same
        url.includes('/cps/')                  ||  // CPS credential issues
        url.includes('/exchange/')             ||  // Exchange asset access
        url.includes('/apis/');                    // API Manager access

      if (!skipRedirect) {
        _redirecting = true;
        // Reset after 5 s so that if the user navigates back (without a full
        // page reload) and their session has expired again, the redirect fires.
        setTimeout(() => { _redirecting = false; }, 5000);
        window.location.href = '/login';
      } else {
        // For skip-redirect URLs the 401 might be a per-resource access issue
        // OR a fully-expired session (e.g. server restarted while tab was open).
        // Do a lightweight session check and redirect to login only if the session
        // is truly gone, leaving per-resource 401s for the caller to handle.
        if (!_redirecting) {
          axios.get('/api/auth/session', { withCredentials: true })
            .then(r => {
              if (!r.data?.authenticated && !_redirecting) {
                _redirecting = true;
                setTimeout(() => { _redirecting = false; }, 5000);
                window.location.href = '/login';
              }
            })
            .catch(() => { /* server unreachable — don't redirect */ });
        }
      }
    }
    return Promise.reject(error);
  }
);

export default axiosClient;