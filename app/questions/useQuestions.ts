import { useCallback, useEffect, useMemo, useState } from "react";
import { isMarkdown } from "../files/paths";
import type { FileEntry } from "../files/tree";
import { loadFile } from "../files/useFile";
import { parseMarkdownToBlocks, type Block } from "../markdown/blocks";
import type { Annotation } from "../review/annotations";
import { buildFeedback } from "../review/feedback";
import type { PanelQuestion } from "../review/Panel";
import { questionRows } from "./answers";
import { indexQuestions } from "./questions";

/** A larger markdown file shows as source: rendering it would stall the page. */
export const MARKDOWN_MAX_BYTES = 512 * 1024;

/**
 * In a small review the markdown files are read in the background once the first file is on
 * screen, so the panel's questions span every file; a larger one finds questions as files open.
 */
const PREFETCH = { maxFiles: 200, maxMarkdown: 20, maxBytes: 128 * 1024 };

const blockCache = new Map<string, Block[]>();
export function blocksOf(content: string): Block[] {
  let blocks = blockCache.get(content);
  if (!blocks) {
    blocks = parseMarkdownToBlocks(content);
    blockCache.set(content, blocks);
  }
  return blocks;
}

/**
 * The questions of the markdown files read so far (the open one, and in a small review all of
 * them), with their status given the answers in force; and the feedback text for a submission.
 */
export function useQuestions({
  files,
  order,
  version,
  path,
  shown,
  answers,
}: {
  files: FileEntry[];
  /** Every path, in tree order. */
  order: string[];
  version: number;
  /** The open file, once `shown`. */
  path: string;
  shown: boolean;
  /** Answers in force: unsent over sent. */
  answers: Annotation[];
}) {
  const [read, setRead] = useState<ReadonlyMap<string, string>>(new Map());
  const remember = useCallback((file: string, text: string) => {
    if (!isMarkdown(file) || text.length > MARKDOWN_MAX_BYTES) return;
    setRead((prev) => (prev.get(file) === text ? prev : new Map(prev).set(file, text)));
  }, []);
  useEffect(() => {
    // Served from the cache by now: this only records the open file as read.
    if (shown && path)
      loadFile(path, version).then(
        (text) => remember(path, text),
        () => {},
      );
  }, [shown, path, remember, version]);
  useEffect(() => {
    if (!shown || files.length <= 1 || files.length > PREFETCH.maxFiles) return;
    files
      .filter((f) => isMarkdown(f.path) && f.size <= PREFETCH.maxBytes)
      .slice(0, PREFETCH.maxMarkdown)
      .forEach((f) =>
        loadFile(f.path, version).then(
          (text) => remember(f.path, text),
          () => {},
        ),
      );
  }, [files, shown, remember, version]);

  const questions = useMemo<PanelQuestion[]>(
    () =>
      order.flatMap((file) => {
        const text = read.get(file);
        if (text === undefined) return [];
        const own = answers.filter((a) => a.path === file);
        return questionRows(blocksOf(text), own).map((row) => ({ ...row, path: file }));
      }),
    [answers, order, read],
  );

  /**
   * The feedback text for `list`. Questions answered earlier are left out, so an answer sent
   * before is not reported as unanswered now.
   */
  const describe = async (list: Annotation[]): Promise<string> => {
    // An answer restored from a draft may sit in a file not read since the reload.
    const texts = new Map(read);
    const unread = new Set(
      list.filter((a) => a.questionAnswer && a.path && !texts.has(a.path)).map((a) => a.path),
    );
    await Promise.all(
      [...unread].map((file) =>
        loadFile(file, version).then(
          (text) => texts.set(file, text),
          () => {},
        ),
      ),
    );
    const keyOf = (a: Annotation) => `${a.path}\n${a.questionAnswer?.key}`;
    const now = new Set(list.filter((a) => a.questionAnswer).map(keyOf));
    const before = new Set(answers.map(keyOf).filter((key) => !now.has(key)));
    const indexed = order.flatMap((file) => {
      const text = texts.get(file);
      return text === undefined
        ? []
        : indexQuestions(blocksOf(text))
            .map((q) => ({ ...q, path: file }))
            .filter((q) => !before.has(`${file}\n${q.question.key}`));
    });
    return buildFeedback({ files: order, questions: indexed, annotations: list });
  };

  return { questions, describe };
}
