import { isDeletion, isGeneral, type Annotation } from "./annotations";
import { codeFenceFor } from "../markdown/structure";
import {
  formatAnswersSection,
  parseAnswer,
  type IndexedQuestion,
  type QuestionAnswer,
} from "../questions/questions";

export interface FeedbackInput {
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

/**
 * Removed lines are numbered in the version the diff compared against, which the annotation's
 * structure does not say: the text does.
 */
export const removedFrom = (against: number | undefined): string =>
  against === undefined || against === 0
    ? "removed from the base"
    : `removed from version ${against}`;

/** `line 3`, `lines 3-4`; removed lines say so, in parentheses or (`inline`) after a comma. */
const lineLabel = ({ lines, side, against }: Annotation, inline = false): string => {
  if (!lines) return "";
  const { start, end } = lines;
  const label = end > start ? `lines ${start}-${end}` : `line ${start}`;
  if (side !== "old") return label;
  return inline ? `${label}, ${removedFrom(against)}` : `${label} (${removedFrom(against)})`;
};
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What the reviewer is sending, as the markdown the agent reads: question answers first, then
 * one numbered entry per annotation, general comments first, each naming the lines it is about.
 * A review of one file reads as a document review; with several files the entries sit under a
 * `## <path>` heading per file, in tree order, each quoting the selected text in a fence.
 */
export function buildFeedback({ files, questions, annotations }: FeedbackInput): string {
  const single = files.length <= 1;
  const subject = single ? "document" : "files";
  const title = single ? "Document" : "Review";

  const rank = new Map(files.map((path, index) => [path, index]));
  const notes = annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => annotation.type !== "answer")
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
    if (isGeneral(ann)) {
      out += `## ${number}General feedback about the ${subject}\n${quote(ann.text)}\n`;
      return;
    }
    const deletion = isDeletion(ann);
    const original = ann.original ?? "";
    const said = ann.type === "replacement" ? quote(`Replace with: ${ann.text}`) : quote(ann.text);
    if (single) {
      out += `## ${number}${ann.lines ? `(${lineLabel(ann, true)}) ` : ""}`;
      if (deletion) {
        out += `Remove this\n${fenced(original)}> I don't want this in the ${subject}.\n`;
      } else if (original.includes("\n")) {
        out += `Feedback on:\n${fenced(original)}${said}`;
      } else {
        out += `Feedback on: "${original}"\n${said}`;
      }
      out += "\n";
      return;
    }
    if (ann.path !== file) {
      file = ann.path;
      out += `## ${oneLine(file)}\n\n`;
    }
    const where = ann.lines ? capitalized(lineLabel(ann)) : "Selection";
    out += `### ${number}${where}${deletion ? ": remove this" : ""}\n${fenced(original)}`;
    out += deletion ? "> I don't want this.\n" : said;
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
