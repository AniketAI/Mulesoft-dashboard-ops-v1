import React, { useState, useEffect } from 'react';
import { X, Building2, Check, Search, SlidersHorizontal, RefreshCw } from 'lucide-react';

// Import for internal use within this component
import { getVisibleBgIds, saveVisibleBgIds } from '../utils/filterUtils';

// Re-export so existing callers can still import from this file
export { BG_FILTER_KEY, getVisibleBgIds, saveVisibleBgIds, applyBgFilter } from '../utils/filterUtils';

export default function BgFilterModal({ businessGroups = [], onClose, onSaved }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [saved, setSaved] = useState(false);

  // Initialise from localStorage
  useEffect(() => {
    const current = getVisibleBgIds();
    if (current.size > 0) {
      setSelected(current);
    } else {
      // "all selected" by default if no filter is saved
      setSelected(new Set(businessGroups.map((g) => g.id)));
    }
  }, [businessGroups]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(businessGroups.map((g) => g.id)));
  const deselectAll = () => setSelected(new Set());

  const handleSave = () => {
    // If all are selected → clear filter (show all)
    const allSelected = selected.size === businessGroups.length;
    saveVisibleBgIds(allSelected ? new Set() : selected);
    setSaved(true);
    setTimeout(() => {
      onSaved?.();
      onClose();
    }, 600);
  };

  const handleReset = () => {
    saveVisibleBgIds(new Set());
    setSelected(new Set(businessGroups.map((g) => g.id)));
    onSaved?.();
    onClose();
  };

  const root = businessGroups.find((g) => !g.parentId);
  const children = businessGroups.filter((g) => g.parentId);
  const orderedGroups = root ? [root, ...children] : businessGroups;
  const filteredOrdered = orderedGroups.filter((g) =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/80 rounded-3xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-700/60 flex-shrink-0">
          <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-blue-50/80 dark:from-blue-500/[0.07] to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-3.5">
            <div className="p-3 rounded-2xl bg-blue-100 dark:bg-blue-500/15 shadow-sm">
              <SlidersHorizontal size={18} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-gray-900 dark:text-gray-100 font-bold text-base">Business Group Filter</h2>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Choose which groups to show in dropdowns</p>
            </div>
          </div>
          <button onClick={onClose} className="relative text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-xl transition-colors flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Search + Select All */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700/60 space-y-3 flex-shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search business groups…"
              className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition-all"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              <span className="text-gray-900 dark:text-gray-100 font-bold">{selected.size}</span> of {businessGroups.length} selected
            </span>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900/60 rounded-lg p-0.5">
              <button onClick={selectAll} className="text-[11px] font-semibold px-2 py-1 rounded-md text-blue-600 dark:text-blue-400 hover:bg-white dark:hover:bg-gray-800 transition-colors">All</button>
              <button onClick={deselectAll} className="text-[11px] font-semibold px-2 py-1 rounded-md text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 transition-colors">None</button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2 px-3">
          {filteredOrdered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10">
              <div className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center">
                <Search size={16} className="text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-center text-gray-500 dark:text-gray-400 text-xs">No groups found</p>
            </div>
          ) : filteredOrdered.map((g) => {
            const isChecked = selected.has(g.id);
            const isRoot = !g.parentId;
            return (
              <label
                key={g.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 ${g.parentId ? 'ml-4' : ''}`}
              >
                {/* Custom checkbox */}
                <div
                  onClick={() => toggle(g.id)}
                  className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center flex-shrink-0 transition-all ${
                    isChecked ? 'bg-blue-600 border-blue-500 shadow-sm shadow-blue-500/40' : 'border-gray-300 dark:border-gray-600 hover:border-blue-500'
                  }`}
                >
                  {isChecked && <Check size={11} className="text-white" />}
                </div>
                <Building2 size={14} className={isChecked ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'} />
                <span className={`text-sm flex-1 truncate ${isChecked ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400 font-medium'}`}>
                  {g.name}
                </span>
                {isRoot && (
                  <span className="text-[9px] bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-200/60 dark:border-blue-400/30 px-1.5 py-0.5 rounded-full font-bold">ROOT</span>
                )}
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 gap-3 flex-shrink-0 bg-gray-50/50 dark:bg-gray-900/30">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            title="Show all business groups (clear filter)"
          >
            <RefreshCw size={11} /> Reset
          </button>
          <div className="flex gap-2.5">
            <button onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-xl transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={selected.size === 0}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white rounded-xl disabled:opacity-50 shadow-md shadow-blue-500/30 hover:shadow-lg hover:shadow-blue-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              {saved
                ? <><Check size={14} /> Saved</>
                : <><SlidersHorizontal size={14} /> Apply Filter</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
