import { AnnotationType, type Annotation } from "../review/annotations";
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
 * An answer is one annotation carrying `questionAnswer` (id `question-<key>`), so drafts and
 * decisions carry it with the comments. Its text is the answer on one line, for a reader of the
 * raw annotations.
 */
const answerId = (key: string) => `question-${key}`;

/** The valid answers among the annotations, by question key. */
export function collectAnswers(annotations: readonly Annotation[]): Map<string, QuestionAnswer> {
  const out = new Map<string, QuestionAnswer>();
  for (const ann of annotations) {
    const answer = ann.questionAnswer && parseAnswer(ann.questionAnswer);
    if (answer && !out.has(answer.key)) out.set(answer.key, answer);
  }
  return out;
}

/** The annotations with a question's answer replaced in place, added, or (when empty) removed. */
export function upsertAnswer(
  annotations: Annotation[],
  blockId: string,
  answer: QuestionAnswer | null,
  key: string,
): Annotation[] {
  const id = answerId(key);
  const index = annotations.findIndex((a) => a.id === id);
  if (!answer || isEmptyAnswer(answer)) {
    return index === -1 ? annotations : annotations.filter((_, i) => i !== index);
  }
  const next: Annotation = {
    id,
    blockId,
    type: AnnotationType.COMMENT,
    text: formatAnswerText(answer),
    originalText: answer.prompt,
    questionAnswer: answer,
  };
  return index === -1 ? [...annotations, next] : annotations.with(index, next);
}

export interface QuestionRow {
  key: string;
  prompt: string;
  status: QuestionStatus;
}

/** The panel's question list, in document order. */
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
