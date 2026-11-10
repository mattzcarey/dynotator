import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** The cookie holding the mode. `index.html` reads it before first paint. */
const COOKIE = "dynotator-theme";

type Mode = "light" | "dark" | "system";
type ResolvedMode = "light" | "dark";

const ICON_PATHS: Record<Mode, string> = {
  light:
    "M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z",
  dark: "M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z",
  system:
    "M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25",
};
const MODES: Mode[] = ["light", "dark", "system"];
const LABEL: Record<Mode, string> = { light: "Light", dark: "Dark", system: "System" };

function readMode(): Mode {
  const value = new RegExp(`(?:^|; )${COOKIE}=([^;]*)`).exec(document.cookie)?.[1];
  return MODES.find((mode) => mode === value) ?? "system";
}

const systemMode = (): ResolvedMode =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** Exactly one of `light` / `dark` on <html>; theme.css keys every token off it. */
function applyMode(mode: ResolvedMode): void {
  const root = document.documentElement;
  if (root.classList.contains(mode)) return;
  // Swap instantly: the global colour transition would otherwise fade every element at once.
  const ready = root.classList.contains("transitions-ready");
  root.classList.remove("transitions-ready");
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
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

interface ThemeState {
  mode: Mode;
  setMode: (mode: Mode) => void;
  resolvedMode: ResolvedMode;
}

const ThemeContext = createContext<ThemeState>({
  mode: "system",
  setMode: () => {},
  resolvedMode: "light",
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState(readMode);
  const [system, setSystem] = useState(systemMode);

  useEffect(enableTransitionsSoon, []);

  useEffect(() => {
    if (mode !== "system") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const resolvedMode = mode === "system" ? system : mode;
  applyMode(resolvedMode);

  const value = useMemo(
    () => ({
      mode,
      resolvedMode,
      setMode: (next: Mode) => {
        document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
        setModeState(next);
      },
    }),
    [mode, resolvedMode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Cycles light → dark → system. */
export function ModeToggle() {
  const { mode, setMode } = useTheme();
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      title={`Theme: ${LABEL[mode]}`}
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[next]}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[mode]} />
      </svg>
    </button>
  );
}
