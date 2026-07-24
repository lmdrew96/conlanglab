"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { DEFAULT_MODE, DEFAULT_THEME, isThemeMode, isThemeName, type ThemeMode, type ThemeName } from "@/lib/themes";

const STORAGE_KEY = "cll-theme";
const MODE_STORAGE_KEY = "cll-theme-mode";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
  /** True once Clerk + localStorage have both been checked for an existing preference. */
  ready: boolean;
  /** False until the user has explicitly picked a theme (drives the first-visit picker). */
  hasChosenTheme: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  const [hasChosenTheme, setHasChosenTheme] = useState(false);

  // Resolving from Clerk/localStorage must happen post-mount, not during the
  // initial render, since both are unavailable on the server — reading them
  // synchronously would desync the SSR'd markup from the client's first paint.
  // This must run exactly once, not on every `user` change: setTheme/setMode's
  // own user.update() call changes Clerk's `user` reference once it resolves
  // (and potentially during its own internal revalidation before that), which
  // re-triggers this effect. If that re-fire reads `user` mid-flight, before
  // the metadata write has actually landed, it resets theme back to the OLD
  // value, then flips again once the real update arrives — a visible flicker
  // right after picking a theme. Gating on `resolvedRef` limits this effect
  // to initial resolution only; subsequent changes flow through setTheme/
  // setMode's own optimistic state updates instead.
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (!isLoaded || resolvedRef.current) return;
    resolvedRef.current = true;

    const clerkTheme = user?.unsafeMetadata?.theme;
    const clerkMode = user?.unsafeMetadata?.mode;
    const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
    const resolvedMode = isThemeMode(clerkMode) ? clerkMode : isThemeMode(storedMode) ? storedMode : DEFAULT_MODE;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(resolvedMode);

    if (isThemeName(clerkTheme)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThemeState(clerkTheme);
      setHasChosenTheme(true);
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeName(stored)) {
      setThemeState(stored);
      setHasChosenTheme(true);
      if (user) {
        void user.update({ unsafeMetadata: { ...user.unsafeMetadata, theme: stored, mode: resolvedMode } });
      }
      return;
    }

    setHasChosenTheme(false);
  }, [isLoaded, user]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
  }, [mode]);

  const setTheme = useCallback(
    (next: ThemeName) => {
      setThemeState(next);
      setHasChosenTheme(true);
      window.localStorage.setItem(STORAGE_KEY, next);
      if (user) {
        void user.update({ unsafeMetadata: { ...user.unsafeMetadata, theme: next } });
      }
    },
    [user],
  );

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
      if (user) {
        void user.update({ unsafeMetadata: { ...user.unsafeMetadata, mode: next } });
      }
    },
    [user],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, mode, setMode, ready: isLoaded, hasChosenTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
