import React, { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Feature 29: Styled Tooltip with configurable delay.
 *
 * Usage:
 *   <Tooltip content="Open in Anypoint Platform" sub="Ctrl+Click to copy URL">
 *     <button>…</button>
 *   </Tooltip>
 *
 * Props:
 *   content  string | ReactNode  — primary tooltip text (required)
 *   sub      string              — secondary grey subtext (optional)
 *   side     'top' | 'bottom' | 'left' | 'right'  — default: 'top'
 *   delay    number              — ms before tooltip shows, default 300
 *   disabled boolean             — suppress tooltip
 */
export default function Tooltip({
  children,
  content,
  sub,
  side = 'top',
  delay = 300,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timerRef = useRef(null);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  const show = useCallback(() => {
    if (disabled || !content) return;
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [disabled, content, delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // Position the tooltip after it becomes visible
  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;
    const trig = triggerRef.current.getBoundingClientRect();
    const tip  = tooltipRef.current.getBoundingClientRect();
    const scroll = { x: window.scrollX, y: window.scrollY };
    const gap = 6;

    let top = 0, left = 0;
    if (side === 'top') {
      top  = trig.top  + scroll.y - tip.height - gap;
      left = trig.left + scroll.x + trig.width / 2 - tip.width / 2;
    } else if (side === 'bottom') {
      top  = trig.bottom + scroll.y + gap;
      left = trig.left   + scroll.x + trig.width / 2 - tip.width / 2;
    } else if (side === 'left') {
      top  = trig.top + scroll.y + trig.height / 2 - tip.height / 2;
      left = trig.left + scroll.x - tip.width - gap;
    } else if (side === 'right') {
      top  = trig.top   + scroll.y + trig.height / 2 - tip.height / 2;
      left = trig.right + scroll.x + gap;
    }

    // Clamp to viewport
    const vw = window.innerWidth;
    left = Math.max(8, Math.min(left, vw - tip.width - 8));

    setPos({ top, left });
  }, [visible, side]);

  if (!content || disabled) return <>{children}</>;

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </span>

      {visible && (
        <div
          ref={tooltipRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9998 }}
          className="pointer-events-none"
          role="tooltip"
        >
          <div className="bg-gray-100 border border-gray-300 rounded-lg px-2.5 py-1.5 shadow-xl max-w-xs">
            <p className="text-xs text-gray-900 font-medium leading-snug">{content}</p>
            {sub && <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{sub}</p>}
          </div>
        </div>
      )}
    </>
  );
}