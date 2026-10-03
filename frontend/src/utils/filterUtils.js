/**
 * Filter utility functions for Business Group and Environment filtering.
 *
 * Extracted from BgFilterModal.jsx and EnvFilterModal.jsx so that utility
 * logic is decoupled from UI modal components.
 *
 * Both modal components import from here and re-export for backward
 * compatibility.  New code should import directly from this file.
 */

// ── Business Group filter ─────────────────────────────────────────────────────

export const BG_FILTER_KEY = 'mulesoft_visible_bgs';

/** Returns the Set of visible BG IDs from localStorage. Empty set = show all. */
export function getVisibleBgIds() {
  try {
    const raw = localStorage.getItem(BG_FILTER_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

/** Persist the visible BG IDs to localStorage. Empty set clears the filter.
 *  Dispatches a 'bgFilterChanged' CustomEvent so pages can react immediately
 *  without a storage listener (which only fires cross-tab in the same browser). */
export function saveVisibleBgIds(idSet) {
  if (!idSet || idSet.size === 0) {
    localStorage.removeItem(BG_FILTER_KEY);
  } else {
    localStorage.setItem(BG_FILTER_KEY, JSON.stringify([...idSet]));
  }
  window.dispatchEvent(new CustomEvent('bgFilterChanged'));
}

/**
 * Filter a list of business groups by the saved visible BG IDs.
 * Returns the full list when no filter is active.
 *
 * @param {Array<{ id: string }>} groups
 * @returns {Array}
 */
export function applyBgFilter(groups) {
  const visible = getVisibleBgIds();
  if (visible.size === 0) return groups; // no filter = show all
  return groups.filter((g) => visible.has(g.id));
}

// ── Environment filter ────────────────────────────────────────────────────────

export const ENV_FILTER_KEY = 'mulesoft_visible_envs';

/** Returns the Set of visible environment IDs from localStorage. Empty set = show all. */
export function getVisibleEnvIds() {
  try {
    const raw = localStorage.getItem(ENV_FILTER_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

/** Persist the visible env IDs to localStorage. Empty set clears the filter.
 *  Dispatches a 'envFilterChanged' CustomEvent so pages can react immediately
 *  without a storage listener (which only fires cross-tab in the same browser). */
export function saveVisibleEnvIds(idSet) {
  if (!idSet || idSet.size === 0) {
    localStorage.removeItem(ENV_FILTER_KEY);
  } else {
    localStorage.setItem(ENV_FILTER_KEY, JSON.stringify([...idSet]));
  }
  window.dispatchEvent(new CustomEvent('envFilterChanged'));
}

/**
 * Filter a list of environments by the saved visible env IDs.
 * Returns the full list when no filter is active.
 *
 * @param {Array<{ id: string }>} envs
 * @returns {Array}
 */
export function applyEnvFilter(envs) {
  const visible = getVisibleEnvIds();
  if (visible.size === 0) return envs; // no filter = show all
  return envs.filter((e) => visible.has(e.id));
}