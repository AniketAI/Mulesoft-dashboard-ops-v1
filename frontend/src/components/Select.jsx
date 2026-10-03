import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export default function Select({
  value,
  onChange,
  options = [],         // [{ value, label, badge, badgeColor, indent }]
  placeholder = 'Select...',
  searchable = false,
  disabled = false,
  className = ''
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = searchable && query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const handleSelect = (opt) => {
    if (opt.value !== value) onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-sm transition-all
          ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-gray-800/40' : 'cursor-pointer bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'}
          ${open ? 'border-sf-500 dark:border-sf-400 ring-2 ring-sf-500/15 dark:ring-sf-400/15 shadow-sm' : 'border-gray-200 dark:border-gray-700'}
          text-gray-900 dark:text-gray-100`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.badge && (
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-white dark:ring-gray-800 ${selected.badgeColor || 'bg-gray-400'}`} />
          )}
          <span className={`truncate ${!selected ? 'text-gray-400 dark:text-gray-500' : ''}`}>{selected?.label || placeholder}</span>
        </span>
        <ChevronDown size={14} className={`flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${open ? 'rotate-180 text-sf-500' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 w-full min-w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl shadow-gray-900/10 dark:shadow-black/40 overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/60 rounded-lg px-2.5 py-1.5">
                <Search size={13} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                />
              </div>
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1.5 px-1">
            {filtered.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 text-center">No results</li>
            )}
            {filtered.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-sm text-left transition-colors
                    ${opt.value === value ? 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}
                    ${opt.indent ? 'pl-6' : ''}`}
                >
                  {opt.badge && (
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${opt.badgeColor || 'bg-gray-400'}`} />
                  )}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.tag && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${opt.tagColor || 'bg-gray-200 text-gray-600'}`}>
                      {opt.tag}
                    </span>
                  )}
                  {opt.value === value && <Check size={14} className="flex-shrink-0 text-sf-600 dark:text-sf-400" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
