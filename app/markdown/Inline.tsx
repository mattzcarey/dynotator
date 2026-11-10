import React, { useContext } from "react";
import { followInternal, LinkResolver } from "./links";

const LINK_CLASS =
  "text-foreground underline decoration-primary/70 decoration-1 underline-offset-[3px] hover:text-primary-ink hover:decoration-primary";
const CODE_CLASS = "rounded border border-border bg-surface-0 px-1 py-px font-mono text-[0.84em]";

const DANGEROUS_PROTOCOL = /^\s*(javascript|data|vbscript|file)\s*:/i;
const BARE_URL_RE = /^https?:\/\/[^\s<>"']+/;
/** The next bare URL at a word boundary, past the first character. */
const NEXT_URL_RE = /(?<=\W)https?:\/\//;
/** Characters that may start inline syntax. */
const SPECIAL_RE = /[*_`[!~\\<]/;

/**
 * A code span at the start of `text`, as CommonMark reads one: a run of N backticks closed by
 * the next run of exactly N. One space comes off each side when both sides have one.
 */
function matchCodeSpan(text: string): { content: string; length: number } | null {
  const width = /^`+/.exec(text)![0].length;
  const runs = /`+/g;
  runs.lastIndex = width;
  for (let run = runs.exec(text); run; run = runs.exec(text)) {
    if (run[0].length !== width) continue;
    let content = text.slice(width, run.index);
    if (/^ .*\S.* $/s.test(content)) content = content.slice(1, -1);
    return content ? { content, length: run.index + width } : null;
  }
  return null;
}

const balanced = (url: string, open: string, close: string): boolean =>
  url.split(open).length >= url.split(close).length;

/** A bare URL without trailing punctuation, keeping a `)` that closes one inside it. */
function trimUrlTail(url: string): string {
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (!/[.,;:!?)\]}>"']/.test(last)) break;
    if (last === ")" && balanced(url, "(", ")")) break;
    if (last === "]" && balanced(url, "[", "]")) break;
    if (last === "}" && balanced(url, "{", "}")) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** `[label](destination)` at the start of `text`, brackets and parentheses balanced. */
function matchLink(text: string): { label: string; url: string; length: number } | null {
  if (text[0] !== "[") return null;
  let i = 1;
  for (let depth = 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) break;
  }
  if (text[i + 1] !== "(") return null;
  let j = i + 2;
  for (let depth = 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "\n") return null;
    else if (text[j] === "(") depth++;
    else if (text[j] === ")" && --depth === 0) break;
  }
  if (j >= text.length) return null;
  const label = text.slice(1, i);
  const url = text.slice(i + 2, j);
  return label && url ? { label, url, length: j + 1 } : null;
}

const EMPHASIS: [RegExp, (children: React.ReactNode, key: number) => React.ReactNode][] = [
  [/^~~([\s\S]+?)~~/, (c, key) => <del key={key}>{c}</del>],
  [
    /^\*\*\*([\s\S]+?)\*\*\*/,
    (c, key) => (
      <strong key={key} className="font-semibold">
        <em>{c}</em>
      </strong>
    ),
  ],
  [
    /^\*\*([\s\S]+?)\*\*/,
    (c, key) => (
      <strong key={key} className="font-semibold">
        {c}
      </strong>
    ),
  ],
  [/^\*([\s\S]+?)\*/, (c, key) => <em key={key}>{c}</em>],
];

/**
 * Inline markdown as React nodes: emphasis, strikethrough, code spans, links, images (web
 * images only), `<autolinks>`, bare URLs, backslash escapes and hard line breaks. Everything
 * else is shown as written, so a selection quotes the text the agent wrote.
 */
export const InlineMarkdown: React.FC<{
  text: string;
  /** Inside a link's label: nothing that is itself a link. */
  linkLabel?: boolean;
}> = ({ text, linkLabel = false }) => {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  let previous = "";
  const take = (length: number, node: React.ReactNode) => {
    parts.push(node);
    previous = rest[length - 1] ?? previous;
    rest = rest.slice(length);
  };
  const resolve = useContext(LinkResolver);
  const link = (href: string, children: React.ReactNode, length: number) => {
    const internal = resolve?.(href);
    take(
      length,
      internal ? (
        <a
          key={key++}
          href={internal}
          onClick={() => followInternal(internal)}
          className={LINK_CLASS}
        >
          {children}
        </a>
      ) : (
        <a
          key={key++}
          href={href}
          {...(href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          className={LINK_CLASS}
        >
          {children}
        </a>
      ),
    );
  };

  while (rest.length > 0) {
    let m: RegExpExecArray | null;

    // HTML comments are invisible.
    if ((m = /^<!--[\s\S]*?-->/.exec(rest))) {
      take(m[0].length, null);
      continue;
    }
    if ((m = /^\\([\\*_`[\]~!.()\-#>+|{}&$])/.exec(rest))) {
      take(2, m[1]);
      continue;
    }
    if (!linkLabel && !/\w/.test(previous) && (m = BARE_URL_RE.exec(rest))) {
      const url = trimUrlTail(m[0]);
      if (url) {
        link(url, url, url.length);
        continue;
      }
    }
    if (!linkLabel && (m = /^<(https?:\/\/[^>]+)>/.exec(rest))) {
      link(m[1], m[1], m[0].length);
      continue;
    }
    if (!linkLabel && (m = /^<([^@>\s]+@[^>\s]+)>/.exec(rest))) {
      link(`mailto:${m[1]}`, m[1], m[0].length);
      continue;
    }
    const emphasis = EMPHASIS.map(([re, render]) => [re.exec(rest), render] as const).find(
      ([match]) => match,
    );
    if (emphasis?.[0]) {
      const [match, render] = emphasis;
      take(
        match[0].length,
        render(<InlineMarkdown text={match[1]} linkLabel={linkLabel} />, key++),
      );
      continue;
    }
    if (!/\w/.test(previous) && (m = /^_([^_\s](?:[\s\S]*?[^_\s])?)_(?!\w)/.exec(rest))) {
      take(
        m[0].length,
        <em key={key++}>{<InlineMarkdown text={m[1]} linkLabel={linkLabel} />}</em>,
      );
      continue;
    }
    if (rest[0] === "`") {
      const span = matchCodeSpan(rest);
      if (span) {
        take(
          span.length,
          <code key={key++} className={CODE_CLASS}>
            {span.content}
          </code>,
        );
      } else {
        // A run with no closing run of its length is literal, all of it.
        const run = /^`+/.exec(rest)![0];
        take(run.length, run);
      }
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(rest))) {
      const [, alt, src] = m;
      take(
        m[0].length,
        /^https?:\/\//i.test(src) ? (
          <img key={key++} src={src} alt={alt} className="my-2 max-w-full rounded" loading="lazy" />
        ) : (
          <span key={key++} className="text-muted-foreground">
            [{alt || "image"}]
          </span>
        ),
      );
      continue;
    }
    const parsed = linkLabel ? null : matchLink(rest);
    if (parsed) {
      const label = <InlineMarkdown text={parsed.label} linkLabel />;
      if (DANGEROUS_PROTOCOL.test(parsed.url))
        take(parsed.length, <span key={key++}>{label}</span>);
      else link(parsed.url, label, parsed.length);
      continue;
    }
    // Two trailing spaces or a backslash before a newline: a line break.
    if ((m = / {2,}\n|\\\n/.exec(rest))) {
      const before = rest.slice(0, m.index);
      if (before) parts.push(<InlineMarkdown key={key++} text={before} linkLabel={linkLabel} />);
      take(m.index + m[0].length, <br key={key++} />);
      continue;
    }

    // Plain text up to the next character that may start syntax, or the next bare URL.
    let end = rest.slice(1).search(SPECIAL_RE) + 1 || rest.length;
    const url = linkLabel ? -1 : rest.search(NEXT_URL_RE);
    if (url !== -1 && url < end) end = url;
    take(end, rest.slice(0, end));
  }

  return <>{parts}</>;
};
