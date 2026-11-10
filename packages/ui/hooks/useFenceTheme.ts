import { useTheme } from "../components/ThemeProvider";
import { SYNTAX_THEME } from "../utils/syntaxTheme";

/** The Shiki theme code snippets render in right now; re-renders on a mode change. */
export function useFenceTheme(): string {
  return SYNTAX_THEME[useTheme().resolvedMode];
}
