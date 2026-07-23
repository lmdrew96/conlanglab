"use client";

import { useState } from "react";
import { THEME_NAMES, THEMES } from "@/lib/themes";
import { useTheme } from "@/lib/theme-context";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
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
  );
}
