import { useEffect, useRef } from "react";
import type { HighlighterCore } from "shiki/core";
import type { Block } from "./blocks";
import { blockId } from "./BlockRenderer";
import { useTheme } from "../theme";

/**
 * Fenced code, highlighted by Shiki (JavaScript regex engine, no WASM) once the fence's
 * grammar has loaded; fences without a known language stay plain. The highlighted text must
 * equal the source exactly, since annotations address it by text: if the tokens do not spell
 * the code, the block stays plain.
 */

/** Fired on a `<code>` whose markup was replaced, so annotations inside can be repainted. */
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

async function toHtml(code: string, lang: string, mode: "light" | "dark"): Promise<string | null> {
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

/** Grid-shaped fences (box drawing, aligned columns) keep their layout and scroll sideways. */
const keepsLayout = (content: string): boolean => /[─-▟]|\S\t+\S|[^\s.!?] {2,}\S/.test(content);

export function CodeBlock({ block }: { block: Block }) {
  const ref = useRef<HTMLElement>(null);
  const mode = useTheme().resolvedMode;
  const { content, language } = block;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.textContent !== content || el.childElementCount > 0) el.textContent = content;
    if (!language) return;
    let current = true;
    void load(language.toLowerCase(), mode)
      .then((ok) => (ok ? toHtml(content, language.toLowerCase(), mode) : null))
      .catch(() => null)
      .then((html) => {
        if (html === null || !current || !el.isConnected) return;
        el.innerHTML = html;
        el.dispatchEvent(new Event(HIGHLIGHT_EVENT, { bubbles: true }));
      });
    return () => {
      current = false;
    };
  }, [content, language, mode]);

  return (
    <div className="my-5" data-block-id={blockId(block)}>
      <pre className="overflow-x-auto rounded-md text-[13px]">
        <code
          ref={ref}
          className={`fence font-mono${language ? ` language-${language}` : ""}`}
          data-keep-layout={keepsLayout(content) ? "" : undefined}
        >
          {content}
        </code>
      </pre>
    </div>
  );
}
