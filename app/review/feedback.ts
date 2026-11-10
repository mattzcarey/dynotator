import { AnnotationType, type Annotation } from "./annotations";
import { codeFenceFor } from "../markdown/structure";
import {
  formatAnswersSection,
  parseAnswer,
  type IndexedQuestion,
  type QuestionAnswer,
} from "../questions/questions";

/** The feedback text when nothing was annotated. Agents key off it. */
export const NO_FEEDBACK = "User reviewed the document and has no feedback.";

export interface FeedbackInput {
  mode: "plan" | "annotate";
  /** Every file of the review, in the order the tree shows them. */
  files: readonly string[];
  /** The questions of the markdown files read so far, each with its `path`. */
  questions: readonly IndexedQuestion[];
  annotations: readonly Annotation[];
}

const quote = (text = "") => `> ${text.replace(/\n/g, "\n> ")}\n`;
const fenced = (text: string) => {
  const fence = codeFenceFor(text);
  return `${fence}\n${text}\n${fence}\n`;
};
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const lineLabel = ({ start, end }: { start: number; end: number }): string =>
  end > start ? `lines ${start}-${end}` : `line ${start}`;
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The reviewer's feedback as the markdown the agent reads: question answers first, then one
 * numbered entry per annotation, general comments first, each naming the lines it is about.
 * A review of one file reads as a document review; with several files the entries sit under a
 * `## <path>` heading per file, in tree order, each quoting the selected text in a fence.
 */
export function buildFeedback({ mode, files, questions, annotations }: FeedbackInput): string {
  if (annotations.length === 0) return NO_FEEDBACK;
  const single = files.length <= 1;
  const subject = mode === "plan" ? "plan" : single ? "document" : "files";
  const title = mode === "plan" ? "Plan" : single ? "Document" : "Review";

  const rank = new Map(files.map((path, index) => [path, index]));
  const notes = annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => !annotation.questionAnswer)
    .toSorted(
      (x, y) =>
        (x.annotation.path ? (rank.get(x.annotation.path) ?? files.length) : -1) -
          (y.annotation.path ? (rank.get(y.annotation.path) ?? files.length) : -1) ||
        x.annotation.path.localeCompare(y.annotation.path) ||
        (x.annotation.lines?.start ?? 0) - (y.annotation.lines?.start ?? 0) ||
        x.index - y.index,
    )
    .map(({ annotation }) => annotation);

  let out = `# ${title} Feedback\n\n`;
  out += answersSection(questions, annotations, single);
  if (notes.length > 0) {
    out += `I've reviewed ${subject === "files" ? "these files" : `this ${subject}`} and have ${notes.length} piece${notes.length > 1 ? "s" : ""} of feedback:\n\n`;
  }
  let file: string | null = null;
  notes.forEach((ann, index) => {
    const number = `${index + 1}. `;
    if (ann.type === AnnotationType.GLOBAL_COMMENT) {
      out += `## ${number}General feedback about the ${subject}\n${quote(ann.text)}\n`;
      return;
    }
    const deletion = ann.type === AnnotationType.DELETION;
    if (single) {
      out += `## ${number}${ann.lines ? `(${lineLabel(ann.lines)}) ` : ""}`;
      if (deletion) {
        out += `Remove this\n${fenced(ann.originalText)}> I don't want this in the ${subject}.\n`;
      } else if (ann.originalText.includes("\n")) {
        out += `Feedback on:\n${fenced(ann.originalText)}${quote(ann.text)}`;
      } else {
        out += `Feedback on: "${ann.originalText}"\n${quote(ann.text)}`;
      }
      out += "\n";
      return;
    }
    if (ann.path !== file) {
      file = ann.path;
      out += `## ${oneLine(file)}\n\n`;
    }
    const where = ann.lines ? capitalized(lineLabel(ann.lines)) : "Selection";
    out += `### ${number}${where}${deletion ? ": remove this" : ""}\n${fenced(ann.originalText)}`;
    out += deletion ? "> I don't want this.\n" : quote(ann.text);
    out += "\n";
  });
  return `${out}---\n`;
}

/**
 * Question keys are unique within a file only: across files the section keys them by path too,
 * and names each question's file.
 */
function answersSection(
  questions: readonly IndexedQuestion[],
  annotations: readonly Annotation[],
  single: boolean,
): string {
  const scoped = (path: string, key: string) => (single ? key : `${path}\n${key}`);
  const answers: QuestionAnswer[] = annotations.flatMap((a) => {
    const answer = a.questionAnswer && parseAnswer(a.questionAnswer);
    return answer ? [{ ...answer, key: scoped(a.path, answer.key) }] : [];
  });
  if (answers.length === 0) return "";
  return formatAnswersSection(
    questions.map(({ path = "", ...q }) => ({
      ...q,
      ...(!single && { path }),
      question: { ...q.question, key: scoped(path, q.question.key) },
    })),
    answers,
  );
}
