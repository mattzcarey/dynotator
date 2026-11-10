/**
 * Syntax highlighting for code fences, with the Shiki instance that
 * `@pierre/diffs` ships (JavaScript regex engine, every bundled grammar),
 * loaded on the first fence that names a language. Fences without a language
 * stay plain; nothing is guessed.
 *
 * The highlighted text must equal the source byte for byte: annotations
 * address these blocks by text. When the tokens do not spell the code exactly,
 * the block stays plain.
 */

type Pierre = typeof import("@pierre/diffs");

let pierre: Promise<Pierre | null> | undefined;
/** `${lang} ${theme}` → whether the highlighter took it. */
const attached = new Map<string, Promise<boolean>>();

/** Fired on a `<code>` element after its markup was replaced, so annotations inside can be repainted. */
export const HIGHLIGHT_EVENT = "code-highlighted";

export function codeBlockClassName(language?: string): string {
  return `pn-code font-mono${language ? ` language-${language}` : ""}`;
}

/**
 * Fences laid out as a grid (box drawing, aligned columns) keep their layout
 * and scroll sideways instead of soft-wrapping (`data-keep-layout`).
 */
export function codeBlockKeepsLayout(content: string): boolean {
  return /[─-▟]|\S\t+\S|[^\s.!?] {2,}\S/.test(content);
}

function attach(lang: string, theme: string): Promise<boolean> {
  const key = `${lang} ${theme}`;
  let ready = attached.get(key);
  if (!ready) {
    pierre ??= import("@pierre/diffs").catch(() => null);
    ready = pierre
      .then(async (mod) => {
        if (!mod) return false;
        await mod.getSharedHighlighter({
          themes: [theme],
          langs: [lang],
          preferredHighlighter: "shiki-js",
        });
        return true;
      })
      .catch(() => false);
    attached.set(key, ready);
  }
  return ready;
}

interface Token {
  content: string;
  color?: string;
  fontStyle?: number;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tokenStyle({ color, fontStyle = 0 }: Token): string {
  const parts = color ? [`color:${color}`] : [];
  if (fontStyle & 1) parts.push("font-style:italic");
  if (fontStyle & 2) parts.push("font-weight:bold");
  return parts.join(";");
}

async function toHtml(code: string, lang: string, theme: string): Promise<string | null> {
  const mod = await pierre;
  const highlighter = mod?.getHighlighterIfLoaded();
  if (!highlighter) return null;
  const lines = highlighter.codeToTokens(code, { lang, theme }).tokens as Token[][];
  let html = "";
  let plain = "";
  lines.forEach((line, i) => {
    if (i > 0) {
      html += "\n";
      plain += "\n";
    }
    for (const token of line) {
      plain += token.content;
      const style = tokenStyle(token);
      const text = escapeHtml(token.content);
      html += style ? `<span style="${style}">${text}</span>` : text;
    }
  });
  return plain === code ? html : null;
}

const latest = new WeakMap<HTMLElement, number>();
let counter = 0;

/** Show `code` in `el`, plain at once and highlighted once its grammar has loaded. */
export function applyHighlight(
  el: HTMLElement,
  code: string,
  lang: string | undefined,
  theme: string,
): void {
  const run = ++counter;
  latest.set(el, run);
  if (el.textContent !== code || el.childElementCount > 0) el.textContent = code;
  if (!lang) return;
  void attach(lang, theme)
    .then((ok) => (ok ? toHtml(code, lang, theme) : null))
    .catch(() => null)
    .then((html) => {
      if (html === null || latest.get(el) !== run || !el.isConnected) return;
      el.innerHTML = html;
      el.dispatchEvent(new Event(HIGHLIGHT_EVENT, { bubbles: true }));
    });
}
