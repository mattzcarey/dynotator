import { useEffect, useState } from "react";
import { api } from "../api";

/** File bodies by version and path: fetched on first use, kept for the page's life. */
const contents = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const keyOf = (path: string, version: number) => `${version}\n${path}`;

/** A file's text at a version, LF line endings. Rejects with a message fit to show. */
export function loadFile(path: string, version: number): Promise<string> {
  const key = keyOf(path, version);
  const done = contents.get(key);
  if (done !== undefined) return Promise.resolve(done);
  let request = pending.get(key);
  if (!request) {
    const query = `path=${encodeURIComponent(path)}&v=${version}`;
    request = fetch(api(`/api/file?${query}`))
      .then(async (res) => {
        if (res.status === 404) throw new Error(`${path} is not in version ${version}.`);
        if (!res.ok) throw new Error(`Could not load ${path} (${res.status}).`);
        const { content } = (await res.json()) as { content: string };
        // Line numbers and diffs count "\n" only.
        const text = content.replace(/\r\n?/g, "\n");
        contents.set(key, text);
        return text;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

export type FileState =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; message: string };

const stateOf = (path: string | null, version: number): FileState => {
  if (path === null) return { status: "ready", content: "" };
  const content = contents.get(keyOf(path, version));
  return content === undefined ? { status: "loading" } : { status: "ready", content };
};

/**
 * A file's text at a version, and a retry for a failed load. `null` stands for no file: the
 * empty side of a diff.
 */
export function useFile(path: string | null, version: number): [FileState, () => void] {
  const [state, setState] = useState(() => ({ path, version, file: stateOf(path, version) }));
  const [attempt, setAttempt] = useState(0);
  // A new file shows its cached text, or loading, at once rather than the old file's.
  const current =
    state.path === path && state.version === version
      ? state.file
      : stateOf(path, version);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    const settle = (file: FileState) => live && setState({ path, version, file });
    loadFile(path, version).then(
      (content) => settle({ status: "ready", content }),
      (error: unknown) =>
        settle({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the file.",
        }),
    );
    return () => {
      live = false;
    };
  }, [path, version, attempt]);
  const retry = () => {
    setState({ path, version, file: { status: "loading" } });
    setAttempt((n) => n + 1);
  };
  return [current, retry];
}
