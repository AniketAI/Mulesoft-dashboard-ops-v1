import React from 'react';

export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {icon && (
        <div className="text-5xl mb-4 select-none" aria-hidden="true">
          {icon}
        </div>
      )}
      {title && (
        <p className="text-base font-semibold text-gray-600 mb-1">{title}</p>
      )}
      {description && (
        <p className="text-sm text-gray-500 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && (
        <div className="mt-5">{action}</div>
      )}
    </div>
  );
}