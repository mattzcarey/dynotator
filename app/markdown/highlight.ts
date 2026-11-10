import type { HighlighterCore } from "shiki/core";

/**
 * Shiki (JavaScript regex engine, no WASM), loaded on the first highlighted code. The
 * highlighted text must equal the source exactly, since annotations address it by text: when the
 * tokens do not spell the code, the caller keeps it plain.
 */

/** Fired on an element whose markup was replaced, so annotations inside can be repainted. */
export const HIGHLIGHT_EVENT = "code-highlighted";

const THEMES = {
  light: () => import("shiki/themes/vitesse-light.mjs"),
  dark: () => import("shiki/themes/vitesse-dark.mjs"),
};
const THEME_NAMES = { light: "vitesse-light", dark: "vitesse-dark" };

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine() }),
  );
  return highlighter;
}

/** Load a language and theme once; false when the language is unknown or loading failed. */
function load(lang: string, mode: "light" | "dark"): Promise<boolean> {
  const key = `${lang} ${mode}`;
  let ready = loaded.get(key);
  if (!ready) {
    ready = import("shiki/langs")
      .then(async ({ bundledLanguages }) => {
        const grammar = Object.hasOwn(bundledLanguages, lang)
          ? bundledLanguages[lang as keyof typeof bundledLanguages]
          : undefined;
        if (!grammar) return false;
        const shiki = await getHighlighter();
        await Promise.all([shiki.loadLanguage(grammar), shiki.loadTheme(THEMES[mode])]);
        return true;
      })
      .catch(() => false);
    loaded.set(key, ready);
  }
  return ready;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `code` as highlighted HTML, or null when the language is unknown or the tokens differ. */
export async function highlight(
  code: string,
  lang: string,
  mode: "light" | "dark",
): Promise<string | null> {
  if (!(await load(lang, mode))) return null;
  const { tokens } = (await getHighlighter()).codeToTokens(code, {
    lang,
    theme: THEME_NAMES[mode],
  });
  let html = "";
  let plain = "";
  tokens.forEach((line, i) => {
    if (i > 0) {
      html += "\n";
      plain += "\n";
    }
    for (const { content, color, fontStyle = 0 } of line) {
      plain += content;
      const style = [
        color && `color:${color}`,
        fontStyle & 1 && "font-style:italic",
        fontStyle & 2 && "font-weight:bold",
      ]
        .filter(Boolean)
        .join(";");
      html += style ? `<span style="${style}">${escapeHtml(content)}</span>` : escapeHtml(content);
    }
  });
  return plain === code ? html : null;
}
