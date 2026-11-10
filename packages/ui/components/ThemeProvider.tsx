import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { storage } from "../utils/storage";
import { parseThemeMode, type Mode } from "./themeModes";

export type { Mode } from "./themeModes";

/** Cookie holding the mode. `app/index.html` reads it before first paint. */
export const THEME_STORAGE_KEY = "dynotator-theme";

type ResolvedMode = "dark" | "light";

type ThemeProviderState = {
  mode: Mode;
  setMode: (mode: Mode) => void;
  resolvedMode: ResolvedMode;
};

const ThemeProviderContext = createContext<ThemeProviderState>({
  mode: "system",
  setMode: () => {},
  resolvedMode: "light",
});

function systemMode(): ResolvedMode {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Put exactly one of `light` / `dark` on <html>; theme.css keys every token off it. */
function applyMode(mode: ResolvedMode): void {
  const el = document.documentElement;
  if (el.classList.contains(mode)) return;
  // Swap instantly: the global colour transition would otherwise fade every element at once.
  const ready = el.classList.contains("transitions-ready");
  el.classList.remove("transitions-ready");
  el.classList.toggle("light", mode === "light");
  el.classList.toggle("dark", mode === "dark");
  el.style.colorScheme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", mode === "dark" ? "#151414" : "#ffffff");
  if (ready) enableTransitionsSoon();
}

function enableTransitionsSoon(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.documentElement.classList.add("transitions-ready")),
  );
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() =>
    parseThemeMode(storage.getItem(THEME_STORAGE_KEY), "system"),
  );
  const [system, setSystem] = useState<ResolvedMode>(systemMode);

  useEffect(enableTransitionsSoon, []);

  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const resolvedMode: ResolvedMode = mode === "system" ? system : mode;
  if (typeof document !== "undefined") applyMode(resolvedMode);

  const setMode = useCallback((next: Mode) => {
    storage.setItem(THEME_STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode, resolvedMode }), [mode, setMode, resolvedMode]);
  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => useContext(ThemeProviderContext);
