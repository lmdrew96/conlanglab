"use client";

import { useState } from "react";
import { THEME_NAMES, THEMES } from "@/lib/themes";
import { useTheme } from "@/lib/theme-context";

/** Icon reflects the mode currently ACTIVE, not the mode a click would switch to. */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeSwitcher() {
  const { theme, setTheme, mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="rounded-md border border-border px-2 py-1.5 text-text-muted hover:text-text"
      >
        {mode === "light" ? <SunIcon /> : <MoonIcon />}
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:text-text"
        >
          {THEMES[theme].label}
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-2 w-48 rounded-md border border-border bg-surface p-1 shadow-lg">
            {THEME_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setTheme(name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                style={{ color: name === theme ? THEMES[theme].text : undefined }}
              >
                <span
                  className="h-3 w-3 rounded-full border border-white/20"
                  style={{ backgroundColor: THEMES[name].accent }}
                />
                {THEMES[name].label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
