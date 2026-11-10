import { segmentsOf } from "./tree";

/** A place in the review: a file, optionally a line range or a heading anchor in it. */
export interface Location {
  path: string;
  lines?: { start: number; end: number };
  anchor?: string;
}

export const isMarkdown = (path: string): boolean => /\.(?:md|markdown|mdx)$/i.test(path);

/** Shiki grammar per file extension; anything else is plain text. */
const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  ini: "ini",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  lua: "lua",
  zig: "zig",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  scala: "scala",
  dart: "dart",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "proto",
  tf: "hcl",
  hcl: "hcl",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
};

/** The Shiki language for a file, from its name or extension; undefined for plain text. */
export function languageFor(path: string): string | undefined {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (Object.hasOwn(BY_NAME, name)) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1);
  return Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : undefined;
}

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const LINES_RE = /^L(\d+)(?:-L?(\d+))?$/;

function linesOf(start: string, end: string | undefined): Location["lines"] {
  const a = Number(start);
  const b = end === undefined ? a : Number(end);
  if (a < 1 || b < 1) return undefined;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** `#/worker/api.ts`, `#/worker/api.ts:L42`, `#/worker/api.ts:L42-48`, `#/docs/a.md#setup`. */
export function formatHash({ path, lines, anchor }: Location): string {
  let out = `#/${encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
  if (lines) out += `:L${lines.start}${lines.end > lines.start ? `-${lines.end}` : ""}`;
  if (anchor) out += `#${encodeURIComponent(anchor)}`;
  return out;
}

/** The location a hash names, or null when it names none (empty, or not `#/…`). */
export function parseHash(hash: string): Location | null {
  if (!hash.startsWith("#/")) return null;
  let rest = hash.slice(2);
  let anchor: string | undefined;
  const sharp = rest.indexOf("#");
  if (sharp !== -1) {
    anchor = decode(rest.slice(sharp + 1)) || undefined;
    rest = rest.slice(0, sharp);
  }
  let lines: Location["lines"];
  const suffix = /:L(\d+)(?:-L?(\d+))?$/.exec(rest);
  if (suffix) {
    lines = linesOf(suffix[1], suffix[2]);
    rest = rest.slice(0, suffix.index);
  }
  const path = decode(rest);
  if (!path) return null;
  return { path, ...(lines && { lines }), ...(anchor && { anchor }) };
}

/**
 * Where a link in the markdown file `from` leads inside the review, or null when it leads
 * elsewhere: absolute URLs, paths that leave the repository root, and paths with no file in the
 * review stay ordinary links. `/x` is relative to the root, as on GitHub; a directory link opens
 * its README; a `#L10-L20` anchor is a line range.
 */
export function resolveLink(
  from: string,
  href: string,
  has: (path: string) => boolean,
): Location | null {
  const link = href.trim();
  if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) return null;
  const sharp = link.indexOf("#");
  const fragment = sharp === -1 ? "" : decode(link.slice(sharp + 1));
  const target = (sharp === -1 ? link : link.slice(0, sharp)).replace(/\?.*$/, "");
  const lineMatch = LINES_RE.exec(fragment);
  const at = (path: string): Location => ({
    path,
    ...(lineMatch
      ? { lines: linesOf(lineMatch[1], lineMatch[2]) }
      : fragment
        ? { anchor: fragment }
        : {}),
  });
  if (!target) return has(from) ? at(from) : null;

  const segments = target.startsWith("/") ? [] : segmentsOf(from).slice(0, -1);
  for (const segment of decode(target).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.length === 0) return null;
    else segments.pop();
  }
  const path = segments.join("/");
  if (path && has(path)) return at(path);
  for (const readme of ["README.md", "readme.md", "index.md"]) {
    const candidate = path ? `${path}/${readme}` : readme;
    if (has(candidate)) return at(candidate);
  }
  return null;
}
