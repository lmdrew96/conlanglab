"use client";

import { useTheme } from "@/lib/theme-context";
import { ThemePicker } from "@/components/theme-picker";

export function ThemeGate() {
  const { ready, hasChosenTheme } = useTheme();
  if (!ready || hasChosenTheme) return null;
  return <ThemePicker />;
}
