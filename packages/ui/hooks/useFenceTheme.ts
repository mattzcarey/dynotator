import { useTheme } from "../components/ThemeProvider";

/** The Shiki theme code fences render in, one per mode. */
export function useFenceTheme(): string {
  return useTheme().resolvedMode === "dark" ? "vitesse-dark" : "vitesse-light";
}
