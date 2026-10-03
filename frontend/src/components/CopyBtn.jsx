import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * CopyBtn
 *
 * A small inline button that copies `text` to the clipboard and briefly
 * shows a green check-mark confirmation.
 *
 * This component was independently re-implemented in ApplicationsPage,
 * ApplicationDetailPage, CpsComparisonPage, and GlobalSearchPage — all with
 * the same behaviour but slightly different styling.  This canonical version
 * supports both common visual variants through props.
 *
 * Props:
 *   text       {string}   The text to copy.
 *   fade       {boolean}  When true (default), the button is invisible until
 *                         the parent element is hovered (requires the parent
 *                         to have the `group` Tailwind class).
 *                         When false, the button is always visible.
 *   size       {number}   Icon size in px (default: 11).
 *   className  {string}   Additional classes for the button element.
 */
export default function CopyBtn({ text, fade = true, size = 11, className = '' }) {
  const [done, setDone] = useState(false);

  const handleClick = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  const baseClass = [
    'p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 transition-all flex-shrink-0',
    fade ? 'opacity-0 group-hover:opacity-100' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button onClick={handleClick} title="Copy" className={baseClass}>
      {done
        ? <Check size={size} className="text-emerald-600" />
        : <Copy size={size} />}
    </button>
  );
}