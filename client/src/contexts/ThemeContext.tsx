import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

interface ThemeContextType {
  theme: Theme;
  preference: ThemePreference;
  toggleTheme: () => void;
  setPreference: (preference: ThemePreference) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const STORAGE_KEY = "nginx-gateway-theme";

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveThemePreference(preference: ThemePreference, systemIsDark: boolean): Theme {
  return preference === "system" ? (systemIsDark ? "dark" : "light") : preference;
}

function resolveTheme(preference: ThemePreference): Theme {
  return resolveThemePreference(preference, systemTheme() === "dark");
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemePreference;
  switchable?: boolean;
}

export function ThemeProvider({ children, defaultTheme = "system", switchable = false }: ThemeProviderProps) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    if (!switchable || typeof window === "undefined") return defaultTheme;
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    return stored === "light" || stored === "dark" || stored === "system" ? stored : defaultTheme;
  });
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(preference));

  useEffect(() => {
    const update = () => setTheme(resolveTheme(preference));
    update();
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (switchable) localStorage.setItem(STORAGE_KEY, preference);
  }, [preference, switchable, theme]);

  const value = useMemo<ThemeContextType>(() => ({
    theme,
    preference,
    switchable,
    setPreference,
    toggleTheme: () => setPreference(theme === "dark" ? "light" : "dark"),
  }), [preference, switchable, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
