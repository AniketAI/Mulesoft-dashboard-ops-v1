import React from 'react';

/**
 * Animated skeleton placeholder — mirrors the shape of real content while
 * loading. Uses Tailwind's `animate-pulse` so no extra CSS is needed.
 *
 * Pass a `className` that sets the width, height, and any additional
 * shape overrides (e.g. `rounded-full` for a circular avatar placeholder).
 *
 * @example
 *   // Generic text bar
 *   <Skeleton className="h-4 w-40" />
 *
 *   // Badge-shaped pill
 *   <Skeleton className="h-5 w-16 rounded-full" />
 *
 *   // Full-width card block
 *   <Skeleton className="h-32 w-full rounded-lg" />
 *
 *   // Table row (inside a <tr>)
 *   <tr>
 *     <td><Skeleton className="h-4 w-40" /></td>
 *     <td><Skeleton className="h-5 w-16 rounded-full" /></td>
 *     <td><Skeleton className="h-4 w-24" /></td>
 *   </tr>
 */
export default function Skeleton({ className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-gray-200/60 rounded ${className}`}
    />
  );
}