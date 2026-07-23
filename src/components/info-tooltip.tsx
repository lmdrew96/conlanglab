"use client";

import { useLayoutEffect, useRef, useState } from "react";

const TOOLTIP_WIDTH = 224; // matches w-56
const VIEWPORT_MARGIN = 8;
const MIN_SPACE_ABOVE = 90; // below this, flip the tooltip to render under the icon instead

interface Coords {
  left: number;
  placement: "above" | "below";
  anchor: number; // distance from viewport top (below) or viewport bottom (above)
}

export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const placement: Coords["placement"] = rect.top > MIN_SPACE_ABOVE ? "above" : "below";

    let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN);

    // Anchored by `bottom` (not `top`) when placed above, so it grows
    // upward without needing to know its own height in advance — stays
    // fully on-screen regardless of how much text it holds.
    const anchor = placement === "above" ? window.innerHeight - rect.top + 6 : rect.bottom + 6;

    setCoords({ left, placement, anchor });
  }, [open]);

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="More info"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] leading-none text-text-muted hover:border-accent hover:text-accent"
      >
        i
      </button>
      {open && coords && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            left: coords.left,
            width: TOOLTIP_WIDTH,
            ...(coords.placement === "above" ? { bottom: coords.anchor } : { top: coords.anchor }),
          }}
          className="z-50 rounded-md border border-border bg-surface p-2 text-xs font-normal normal-case text-text shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
