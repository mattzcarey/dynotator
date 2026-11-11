import type { Annotation, Lines } from "../review/annotations";
import type { Block } from "../markdown/blocks";
import {
  formatAnswerText,
  indexQuestions,
  isEmptyAnswer,
  parseAnswer,
  questionStatus,
  type QuestionAnswer,
  type QuestionStatus,
} from "./questions";

/**
 * An answer is one `answer` annotation carrying `questionAnswer`, so drafts and submissions carry
 * it with the comments; its `answer.value` is the answer on one line, for an agent. Every new
 * answer gets its own id: a question answered again after sending is a new annotation.
 */
const answerId = (path: string, key: string) =>
  `question-${key}@${path}#${crypto.randomUUID().slice(0, 8)}`;

/** The valid answers among one file's annotations, by question key. */
export function collectAnswers(annotations: readonly Annotation[]): Map<string, QuestionAnswer> {
  const out = new Map<string, QuestionAnswer>();
  for (const ann of annotations) {
    const answer = ann.questionAnswer && parseAnswer(ann.questionAnswer);
    if (answer && !out.has(answer.key)) out.set(answer.key, answer);
  }
  return out;
}

/** The draft with a question's answer replaced in place, added, or (when empty) removed. */
export function upsertAnswer(
  annotations: Annotation[],
  path: string,
  blockId: string,
  lines: Lines | undefined,
  answer: QuestionAnswer | null,
  key: string,
): Annotation[] {
  const index = annotations.findIndex(
    (a) => a.path === path && a.questionAnswer?.key === key,
  );
  if (!answer || isEmptyAnswer(answer)) {
    return index === -1 ? annotations : annotations.filter((_, i) => i !== index);
  }
  const next: Annotation = {
    id: index === -1 ? answerId(path, key) : annotations[index].id,
    path,
    type: "answer",
    ...(lines && { lines }),
    answer: { key, value: formatAnswerText(answer) },
    blockId,
    questionAnswer: answer,
  };
  return index === -1 ? [...annotations, next] : annotations.with(index, next);
}

export interface QuestionRow {
  key: string;
  prompt: string;
  status: QuestionStatus;
}

/** One file's questions for the panel, in document order. */
export function questionRows(
  blocks: readonly Block[],
  annotations: readonly Annotation[],
): QuestionRow[] {
  const answers = collectAnswers(annotations);
  return indexQuestions(blocks).map(({ question }) => ({
    key: question.key,
    prompt: question.prompt,
    status: questionStatus(question, answers.get(question.key)),
  }));
}
