"use client";

import { THEME_NAMES, THEMES, type ThemeName } from "@/lib/themes";
import { useTheme } from "@/lib/theme-context";

function ThemeCard({
  name,
  onPick,
}: {
  name: ThemeName;
  onPick: (name: ThemeName) => void;
}) {
  const t = THEMES[name];
  return (
    <button
      type="button"
      onClick={() => onPick(name)}
      className="flex flex-col overflow-hidden rounded-lg border border-white/10 text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/40"
      style={{ backgroundColor: t.bg }}
    >
      <div className="flex flex-col gap-3 p-5" style={{ backgroundColor: t.surface }}>
        <span className="text-lg font-semibold" style={{ color: t.text }}>
          {t.label}
        </span>
        <span className="text-sm" style={{ color: t.textMuted }}>
          {t.mood}
        </span>
        <span
          className="inline-block w-fit rounded-md px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: t.accent, color: t.accentText }}
        >
          Generate Language
        </span>
      </div>
      <div className="p-4" style={{ backgroundColor: t.bg }}>
        <span className="text-xs" style={{ color: t.textMuted }}>
          Aa Bb Cc — sample phonology output
        </span>
      </div>
    </button>
  );
}

export function ThemePicker() {
  const { setTheme } = useTheme();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-neutral-900 p-5 sm:p-8">
        <h2 className="mb-1 text-xl font-semibold text-white">Pick a look</h2>
        <p className="mb-6 text-sm text-neutral-400">
          Purely aesthetic — you can change this anytime in settings.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {THEME_NAMES.map((name) => (
            <ThemeCard key={name} name={name} onPick={setTheme} />
          ))}
        </div>
      </div>
    </div>
  );
}
