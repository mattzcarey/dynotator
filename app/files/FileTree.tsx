import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ancestorDirs, visibleRows, type TreeDir, type TreeNode } from "./tree";

const keyOf = (node: TreeNode) => `${node.kind === "dir" ? "d" : "f"}:${node.path}`;

/**
 * The review's files. Only expanded directories render their rows. Keyboard: up and down move,
 * right opens a directory or steps into it, left closes it or steps out, Enter opens.
 */
export function FileTree({
  root,
  current,
  counts,
  onOpen,
}: {
  root: TreeDir;
  current: string;
  /** Comments per `f:<path>` and `d:<dir>` (see countByPath). */
  counts: ReadonlyMap<string, number>;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => new Set(ancestorDirs(current)));
  const [focused, setFocused] = useState(`f:${current}`);
  const [shown, setShown] = useState(current);
  const listRef = useRef<HTMLUListElement>(null);

  // Opening a file elsewhere (a link, an annotation) reveals it.
  if (shown !== current) {
    setShown(current);
    setFocused(`f:${current}`);
    const missing = ancestorDirs(current).filter((dir) => !expanded.has(dir));
    if (missing.length > 0) setExpanded(new Set([...expanded, ...missing]));
  }

  const rows = useMemo(() => visibleRows(root, expanded), [root, expanded]);
  const focusIndex = Math.max(
    0,
    rows.findIndex((row) => keyOf(row.node) === focused),
  );

  const toggle = (dir: string, open: boolean) =>
    setExpanded((prev) => {
      if (prev.has(dir) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(dir);
      else next.delete(dir);
      return next;
    });

  const moveTo = (index: number) => {
    const row = rows[Math.min(rows.length - 1, Math.max(0, index))];
    if (!row) return;
    const key = keyOf(row.node);
    setFocused(key);
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const row = rows[focusIndex];
    if (!row) return;
    const { node } = row;
    const open = node.kind === "dir" && expanded.has(node.path);
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(focusIndex + 1),
      ArrowUp: () => moveTo(focusIndex - 1),
      Home: () => moveTo(0),
      End: () => moveTo(rows.length - 1),
      ArrowRight: () => {
        if (node.kind !== "dir") return;
        if (open) moveTo(focusIndex + 1);
        else toggle(node.path, true);
      },
      ArrowLeft: () => {
        if (open) toggle(node.path, false);
        else if (row.parent) moveTo(rows.findIndex((r) => r.node === row.parent));
      },
      Enter: () => (node.kind === "dir" ? toggle(node.path, !open) : onOpen(node.path)),
      " ": () => (node.kind === "dir" ? toggle(node.path, !open) : onOpen(node.path)),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  return (
    <ul ref={listRef} role="tree" aria-label="Files" onKeyDown={onKeyDown} className="py-1">
      {rows.map((row, index) => {
        const { node, depth } = row;
        const key = keyOf(node);
        const dir = node.kind === "dir";
        const open = dir && expanded.has(node.path);
        const active = !dir && node.path === current;
        const count = dir && open ? 0 : (counts.get(key) ?? 0);
        return (
          <li
            key={key}
            data-key={key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={dir ? open : undefined}
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            tabIndex={index === focusIndex ? 0 : -1}
            title={node.path}
            onFocus={() => setFocused(key)}
            onClick={() => (dir ? toggle(node.path, !open) : onOpen(node.path))}
            className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-2 text-[13px] outline-offset-[-2px] select-none ${active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
          >
            <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">
              {dir ? (
                <svg
                  className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                </svg>
              ) : (
                <span
                  className={`h-1 w-1 rounded-full ${active ? "bg-primary" : "bg-border-strong"}`}
                />
              )}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${dir ? "font-medium text-foreground/85" : ""}`}
            >
              {node.name}
            </span>
            {count > 0 && (
              <span
                className="shrink-0 font-mono text-[10.5px] text-primary"
                aria-label={`${count} ${count === 1 ? "comment" : "comments"}`}
              >
                {count}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
