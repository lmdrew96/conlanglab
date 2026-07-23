"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { DEFAULT_THEME, isThemeName, type ThemeName } from "@/lib/themes";

const STORAGE_KEY = "cll-theme";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  /** True once Clerk + localStorage have both been checked for an existing preference. */
  ready: boolean;
  /** False until the user has explicitly picked a theme (drives the first-visit picker). */
  hasChosenTheme: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [hasChosenTheme, setHasChosenTheme] = useState(false);

  // Resolving from Clerk/localStorage must happen post-mount, not during the
  // initial render, since both are unavailable on the server — reading them
  // synchronously would desync the SSR'd markup from the client's first paint.
  useEffect(() => {
    if (!isLoaded) return;

    const clerkTheme = user?.unsafeMetadata?.theme;
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
        void user.update({ unsafeMetadata: { ...user.unsafeMetadata, theme: stored } });
      }
      return;
    }

    setHasChosenTheme(false);
  }, [isLoaded, user]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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

  return (
    <ThemeContext.Provider value={{ theme, setTheme, ready: isLoaded, hasChosenTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
