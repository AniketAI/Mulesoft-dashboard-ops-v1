/**
 * Centralised cache key factory — single source of truth for every key
 * pattern used across the application.
 *
 * Using this module instead of inline string literals means:
 *   • Typos are caught at import time (no silent cache misses)
 *   • Key format changes are made in one place
 *   • bustCache() calls are easy to reason about
 *
 * Usage:
 *   import { CK } from '../services/cacheKeys';
 *   getCachedSWR(CK.bgs(orgId))
 *   setCached(CK.apps(bgId, bgIds), data, 3 * 60 * 1000)
 *   bustCache(CK.PREFIX.apps)
 */

export const CK = {
  // ── Business groups ──────────────────────────────────────────────────────
  /** Org-level business group list.  TTL recommendation: 30 min */
  bgs: (orgId) => `bgs:${orgId}`,

  // ── Application summaries ────────────────────────────────────────────────
  /**
   * Merged apps + envs for a specific BG scope.
   * bgId may be '__all__'.
   * bgIds is the array of BG IDs actually fetched.
   * TTL recommendation: 3–5 min (status changes frequently)
   */
  apps: (bgId, bgIds) => `apps:${bgId}:${Array.isArray(bgIds) ? bgIds.join(',') : bgIds}`,

  /**
   * Merged apps for ALL BGs (used by CpsComparisonPage).
   * TTL recommendation: 3–5 min
   */
  appsAll: (bgIds) => `apps:__all__:${Array.isArray(bgIds) ? bgIds.join(',') : bgIds}`,

  // ── CloudHub 2.0 per-app detail ──────────────────────────────────────────
  /** Full CH2 deployment detail for a single app.  TTL recommendation: 5 min */
  appDetail: (appId, envId) => `ch2detail:${appId}:${envId}`,

  // ── CloudHub 1.0 application list ────────────────────────────────────────
  /** CH1 app list for a BG+env.  TTL recommendation: 5 min */
  ch1list: (bgId, envId) => `ch1list:${bgId}:${envId}`,
};

/**
 * Key prefixes for bustCache() — bust an entire category at once.
 *
 * Example:
 *   bustCache(CK.PREFIX.apps)   // invalidate all application caches
 *   bustCache(CK.PREFIX.bgs)    // invalidate all business-group caches
 */
CK.PREFIX = {
  bgs:       'bgs:',
  apps:      'apps:',
  appDetail: 'ch2detail:',
  ch1list:   'ch1list:',
};