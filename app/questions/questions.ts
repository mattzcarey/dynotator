/**
 * `:::question` blocks: questions an agent writes into the document it submits. The review
 * draws each as an answer card (QuestionCard) and puts the answers at the top of the feedback
 * (`formatAnswersSection`). Pure: no DOM, no React.
 *
 * Authoring reference, the only documentation agents get:
 *
 * ```markdown
 * :::question
 * Where should we keep the edit that loses a sync conflict?
 *
 * When two devices edit one note offline, the later save wins and the other is lost.
 *
 * - [ ] Nowhere — silent loss, as today
 * - [ ] Local only, purged after 30 days — cheap, no server change
 * - [ ] Server-side per user — survives reinstall, needs a retention policy
 *
 * Recommended: Local only, purged after 30 days
 * :::
 * ```
 *
 * - `:::question` picks one choice, `:::question-multi` any number, `:::question-text` takes
 *   free text (so does a block with no choices). The block ends at the first `:::` line.
 * - The first line is the question. Every other line is context, shown under it as markdown:
 *   say what the choice affects and why you recommend one, in a few plain sentences.
 * - Choices are `- [ ] label` or `- [ ] label — description`. Without any `- [ ]` item, plain
 *   `- label` bullets are the choices. `- [x] label` marks a choice as already settled.
 * - `Recommended: <label>` marks your recommendation (`A, B and C` on `:::question-multi`).
 *   Text that names no choice is offered as one more answer. Without that line, a choice
 *   whose label ends in `(Recommended)` is the recommendation.
 * - The reviewer can pick, answer "Other", add a note, or skip.
 * - The feedback opens (under its title) with `## Answers to your questions`, then per question
 *   `### Q<n>. <question> (line <n>)` (`(<file>, line <n>)` when the review has several
 *   files) and `Answer: <label>` (`(your recommendation)` when it is yours), a list for several
 *   picks, `Other: …`, free text as a quote, or `Skipped`, and
 *   any `Note: …`; unanswered questions are listed last. A settled question the reviewer
 *   left alone is not reported. When the reviewer only answered, a plan's denial says
 *   `answersOnly: true`.
 * - A `:::question` inside a code fence, a quote or another block is not a question.
 */

import type { Block } from "../markdown/blocks";

export type QuestionKind = "single" | "multi" | "text";

const DIRECTIVE_KINDS: Record<string, QuestionKind> = {
  question: "single",
  "question-multi": "multi",
  "question-text": "text",
};

export const isQuestionDirective = (kind: string | undefined): boolean =>
  kind !== undefined && Object.hasOwn(DIRECTIVE_KINDS, kind);

export interface QuestionChoice {
  /** As written (inline markdown); answers store it. */
  label: string;
  description?: string;
  /** `- [x]`: the agent already decided this one. */
  settled: boolean;
  recommended: boolean;
}

export interface Question {
  kind: QuestionKind;
  /** Inline markdown. */
  prompt: string;
  /** 0-based line of the prompt within the block body. */
  promptLine: number;
  /** Markdown. */
  context: string;
  choices: QuestionChoice[];
  /** A recommendation that names no choice, offered as one more answer. */
  suggestedText?: string;
  /** Identity of the question across revisions: `q-` + a hash of kind and prompt. */
  key: string;
}

const MAX_BODY_CHARS = 20_000;
const MAX_CHOICES = 20;
/** A longer plain-bullet label is cut, the rest going to the description. */
const MAX_BULLET_LABEL_CHARS = 200;
const MAX_ANSWER_TEXT_CHARS = 4000;
const MAX_ANSWER_NOTE_CHARS = 2000;

const TASK_RE = /^\s*(?:[-*+]|\d{1,3}[.)])\s+\[([ xX])\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const RECOMMENDED_RE =
  /^\s*(?:[*_]{1,2})?recommend(?:ed|ation)(?:[*_]{1,2})?\s*:\s*(?:[*_]{1,2})?\s*(.*)$/i;
const ARROW_RE = /^\s*(?:➡️|➡|->|=>|→)\s*(.*)$/;
const LABEL_SEP_RE = /\s+(?:—|–|-)\s+/;
// After a recommendation that is only the start of a label (`Unpin it` for `Unpin it: why`).
const LABEL_HEAD_SEP_RE = /^(?:\s*[:—–(]|\s+-\s)/;
const MARKER = String.raw`[([]\s*recommended\s*[)\]]`;
const TRAILING_MARKER_RE = new RegExp(String.raw`^(.*?\S)\s*${MARKER}([*_]{0,2})\s*$`, "i");
const LEADING_MARKER_RE = new RegExp(String.raw`^${MARKER}:?\s+(\S.*)$`, "i");
const COLON_MARKER_RE = new RegExp(String.raw`^(.*?\S)\s*${MARKER}:\s+(\S.*)$`, "i");
const DESCRIPTION_MARKER_RE = new RegExp(String.raw`^(?:${MARKER}\s*(.*)|recommended[.!]?)$`, "i");

/** For comparing labels: emphasis and code marks out, whitespace collapsed, case folded. */
const normalize = (value: string): string =>
  value
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?:;,]+$/, "")
    .trim()
    .toLowerCase();

/** Inline markup out, words kept: `[Pagefind](x.html)` reads `pagefind`. */
const plainWords = (value: string): string =>
  normalize(
    value
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<\/?[A-Za-z][^<>]*>/g, ""),
  );

const indentWidth = (line: string): number => line.match(/^\s*/)![0].replace(/\t/g, "    ").length;

/** FNV-1a, 8 hex digits. */
const hash8 = (value: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

const questionKey = (kind: QuestionKind, prompt: string): string =>
  `q-${hash8(`${kind}\n${normalize(prompt)}`)}`;

const QUESTION_KEY_RE = /^q-[0-9a-f]{8}(?:-\d{1,3})?$/;

const splitLabel = (raw: string): { label: string; description?: string } => {
  const match = LABEL_SEP_RE.exec(raw);
  if (!match) return { label: raw.trim() };
  const description = raw.slice(match.index + match[0].length).trim();
  return { label: raw.slice(0, match.index).trim(), ...(description ? { description } : {}) };
};

/** `**Name:** prose`: the bold name is the label when punctuation sets it off. */
const splitBoldLead = (raw: string): { label: string; description: string } | null => {
  const m = /^\*\*(.+?)\*\*(.*)$/s.exec(raw.trim());
  if (!m) return null;
  const inner = m[1].trim();
  const rest = m[2];
  if (!/[:.?!]$/.test(inner) && !/^\s*[:,;—–]/.test(rest) && !/^\s+-\s/.test(rest)) return null;
  const label = inner.replace(/\s*:$/, "").trim();
  const description = rest.replace(/^\s*[:,;—–-]?\s*/, "").trim();
  return label && description ? { label, description } : null;
};

/** A plain bullet's label and description, the label cut to a readable length. */
const splitBullet = (text: string): { label: string; description?: string } => {
  const split = splitBoldLead(text) ?? splitLabel(text);
  if (split.label.length <= MAX_BULLET_LABEL_CHARS) return split;
  const head = split.label.slice(0, MAX_BULLET_LABEL_CHARS);
  const sentence = /^.+?[.!?]["'”’)\]]?(?=\s)/.exec(head);
  const space = head.lastIndexOf(" ");
  const at = sentence ? sentence[0].length : space > 0 ? space : MAX_BULLET_LABEL_CHARS;
  const description = [split.label.slice(at).trim(), split.description].filter(Boolean).join(" — ");
  return { label: split.label.slice(0, at).trim(), ...(description ? { description } : {}) };
};

/** A choice with a `(Recommended)` / `[Recommended]` marker taken out, or null without one. */
const withoutMarker = (choice: QuestionChoice): QuestionChoice | null => {
  const { label, description } = choice;
  const trailing = TRAILING_MARKER_RE.exec(label);
  if (trailing) return { ...choice, label: trailing[1] + trailing[2] };
  const leading = LEADING_MARKER_RE.exec(label);
  if (leading) return { ...choice, label: leading[1] };
  const colon = COLON_MARKER_RE.exec(label);
  if (colon) {
    const rest = [colon[2], description].filter(Boolean).join(" — ");
    return { ...choice, label: colon[1], description: rest };
  }
  const inDescription = description && DESCRIPTION_MARKER_RE.exec(description.trim());
  if (!inDescription) return null;
  const rest = (inDescription[1] ?? "").replace(/^(?:[:—–]|-(?=\s|$))+\s*/, "").trim();
  const { description: _, ...bare } = choice;
  return rest ? { ...bare, description: rest } : bare;
};

/**
 * The choices a recommendation names, by index. `names` holds each choice's label first,
 * then the text it was written as. A candidate names a choice by its whole label, by the
 * label part of `label — reason`, by its plain words, or as the start of exactly one label.
 * On a pick-any question a `;`, `,` or `and` list may name several.
 */
const matchRecommendation = (text: string, names: string[][], multi: boolean): number[] => {
  const unique = (test: (name: string) => boolean): number => {
    const hits = names.flatMap((list, i) => (list.some(test) ? [i] : []));
    return hits.length === 1 ? hits[0] : -1;
  };
  const one = (candidate: string): number => {
    const leads = [
      candidate,
      splitLabel(candidate).label,
      splitBoldLead(candidate)?.label,
      /^.+?[.!?](?=\s)/.exec(candidate)?.[0],
    ];
    for (const lead of leads) {
      const target = lead && normalize(lead);
      if (!target) continue;
      const exact = names.findIndex((list) => list.some((name) => normalize(name) === target));
      if (exact !== -1) return exact;
    }
    const words = plainWords(candidate);
    const plain = words ? unique((name) => plainWords(name) === words) : -1;
    if (plain !== -1) return plain;
    const target = normalize(candidate);
    return target
      ? unique((name) => {
          const folded = name
            .replace(/[*_`]+/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          return folded.startsWith(target) && LABEL_HEAD_SEP_RE.test(folded.slice(target.length));
        })
      : -1;
  };
  const whole = one(text);
  if (whole !== -1) return [whole];
  if (!multi) return [];
  for (const sep of [/\s*;\s*/, /\s*,\s*|\s+(?:and|&|\+)\s+/i]) {
    const parts = text.split(sep).filter((part) => part.trim());
    if (parts.length < 2) continue;
    const hits = parts.map(one);
    if (hits.every((hit) => hit !== -1)) return [...new Set(hits)];
  }
  return [];
};

/** Parse a question block's body. Null when it is not a question (wrong kind, no prompt). */
export function parseQuestion(directiveKind: string | undefined, body: string): Question | null {
  if (directiveKind === undefined || !isQuestionDirective(directiveKind)) return null;
  if (body.length > MAX_BODY_CHARS) return null;
  const declared = DIRECTIVE_KINDS[directiveKind];
  const lines = body.split("\n");

  let prompt = "";
  let promptLine = -1;
  const context: string[] = [];
  const tasks: { raw: string; choice: QuestionChoice }[] = [];
  /** Plain bullets, with the context lines they span (removed when they become the choices). */
  const bullets: { text: string; contextLines: number[]; indent: number }[] = [];
  let recommendation: string | undefined;
  let recommendationLine = false;
  let lastTask: (typeof tasks)[number] | null = null;
  let openBullet: (typeof bullets)[number] | null = null;

  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") {
      lastTask = null;
      if (context.length > 0 && context[context.length - 1] !== "") context.push("");
      continue;
    }
    const task = declared === "text" ? null : TASK_RE.exec(line);
    if (task) {
      openBullet = null;
      const { label, description } = splitLabel(task[2]);
      if (!label || tasks.length >= MAX_CHOICES) continue;
      const choice = { label, description, settled: task[1] !== " ", recommended: false };
      lastTask = { raw: task[2].trim(), choice };
      tasks.push(lastTask);
      continue;
    }
    const rec = RECOMMENDED_RE.exec(line) ?? ARROW_RE.exec(line);
    if (rec) {
      recommendationLine = true;
      const text = rec[1].replace(/[*_]{1,2}$/, "").trim();
      if (text) recommendation = text;
      lastTask = null;
      openBullet = null;
      continue;
    }
    if (!prompt) {
      prompt = line.trim().replace(/^#{1,6}\s+/, "");
      promptLine = i;
      continue;
    }
    // An indented line under a choice continues its description.
    if (lastTask && /^\s/.test(line)) {
      const extra = line.trim();
      lastTask.choice.description = [lastTask.choice.description, extra].filter(Boolean).join(" ");
      lastTask.raw += ` ${extra}`;
      continue;
    }
    lastTask = null;
    const bullet = BULLET_RE.exec(line);
    if (openBullet && !bullet && indentWidth(line) > openBullet.indent) {
      openBullet.text += ` ${line.trim()}`;
      openBullet.contextLines.push(context.length);
    } else if (bullet?.[1].trim()) {
      openBullet = {
        text: bullet[1].trim(),
        contextLines: [context.length],
        indent: indentWidth(line),
      };
      bullets.push(openBullet);
    } else {
      openBullet = null;
    }
    context.push(line.trimEnd());
  }
  if (!prompt) return null;

  let choices = tasks.map((task) => task.choice);
  let raws = tasks.map((task) => task.raw);
  if (choices.length === 0 && declared !== "text" && bullets.length > 0) {
    const used = bullets.slice(0, MAX_CHOICES);
    choices = used.map((bullet) => ({
      ...splitBullet(bullet.text),
      settled: false,
      recommended: false,
    }));
    raws = used.map((bullet) => bullet.text);
    const drop = new Set(used.flatMap((bullet) => bullet.contextLines));
    for (let i = context.length - 1; i >= 0; i--) if (drop.has(i)) context.splice(i, 1);
  }
  const kind: QuestionKind = choices.length === 0 ? "text" : declared;
  if (kind === "text") choices = [];

  // `(Recommended)` markers leave the labels (unless two labels would then be one); without a
  // `Recommended:` line they are the recommendation: one on pick one, any on pick any.
  const marked: number[] = [];
  choices = choices.map((choice, i) => {
    const bare = withoutMarker(choice);
    if (!bare) return choice;
    marked.push(i);
    const twin = choices.some(
      (other, j) => j !== i && normalize(other.label) === normalize(bare.label),
    );
    return twin ? choice : bare;
  });
  if (!recommendationLine && (marked.length === 1 || (kind === "multi" && marked.length > 0))) {
    for (const i of marked) choices[i].recommended = true;
  }

  let suggestedText: string | undefined;
  if (recommendation) {
    const names = choices.map((choice, i) => [choice.label, raws[i]]);
    const hits =
      kind === "text" ? [] : matchRecommendation(recommendation, names, kind === "multi");
    for (const hit of hits) choices[hit].recommended = true;
    if (hits.length === 0) suggestedText = recommendation;
  }

  // Context keeps its own indentation (nested lists, fences) less what every line shares.
  const shared = Math.min(...context.filter((l) => l !== "").map(indentWidth));
  const text = context
    .map((l) =>
      shared > 0 && Number.isFinite(shared) ? l.replace(/\t/g, "    ").slice(shared) : l,
    )
    .join("\n")
    .trim();

  return {
    kind,
    prompt,
    promptLine,
    context: text,
    choices,
    ...(suggestedText ? { suggestedText } : {}),
    key: questionKey(kind, prompt),
  };
}

export interface IndexedQuestion {
  /** The file it is in, named in the feedback; absent when the review has one file. */
  path?: string;
  blockId: string;
  /** 1-based position among the document's questions. */
  number: number;
  /** 1-based document line of the prompt. */
  line: number;
  question: Question;
}

/** The document's questions in order. Repeated keys get `-2`, `-3`… so answers never collide. */
export function indexQuestions(blocks: readonly Block[]): IndexedQuestion[] {
  const out: IndexedQuestion[] = [];
  const seen = new Map<string, number>();
  for (const block of blocks) {
    if (block.type !== "directive") continue;
    const question = parseQuestion(block.directiveKind, block.content);
    if (!question) continue;
    const count = (seen.get(question.key) ?? 0) + 1;
    seen.set(question.key, count);
    out.push({
      blockId: block.id,
      number: out.length + 1,
      // The body starts on the line after the opening `:::`.
      line: block.startLine + 1 + question.promptLine,
      question: count === 1 ? question : { ...question, key: `${question.key}-${count}` },
    });
  }
  return out;
}

// ─── Answers ───

/** One answer to one question, stored on its annotation (`Annotation.questionAnswer`). */
export interface QuestionAnswer {
  key: string;
  kind: QuestionKind;
  prompt: string;
  /** Picked choice labels. */
  selected: string[];
  /** "Other…" on a choice question. */
  other?: string;
  /** A free-text answer. */
  text?: string;
  note?: string;
  skipped?: true;
}

const optionalString = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;

/**
 * A clean copy of a stored answer (a draft comes back from the server as JSON), or null when
 * it is malformed. Every reader of `questionAnswer` goes through it.
 */
export function parseAnswer(value: unknown): QuestionAnswer | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== "string" || !QUESTION_KEY_RE.test(v.key)) return null;
  if (v.kind !== "single" && v.kind !== "multi" && v.kind !== "text") return null;
  if (typeof v.prompt !== "string") return null;
  if (!Array.isArray(v.selected) || !v.selected.every((s) => typeof s === "string")) return null;
  const answer: QuestionAnswer = {
    key: v.key,
    kind: v.kind,
    prompt: v.prompt,
    selected: [...new Set(v.selected.map((s: string) => s.trim()).filter(Boolean))].slice(
      0,
      MAX_CHOICES,
    ),
  };
  const other = optionalString(v.other, MAX_ANSWER_TEXT_CHARS);
  const text = optionalString(v.text, MAX_ANSWER_TEXT_CHARS);
  const note = optionalString(v.note, MAX_ANSWER_NOTE_CHARS);
  if (other) answer.other = other;
  if (text) answer.text = text;
  if (note) answer.note = note;
  if (v.skipped === true) answer.skipped = true;
  return answer;
}

/** A choice was picked, "Other…" was filled, or free text was written. */
export const isAnswered = (answer: QuestionAnswer): boolean =>
  answer.selected.length > 0 || !!answer.other?.trim() || !!answer.text?.trim();

/** Not answered, not skipped, no note: the answer's annotation goes. */
export const isEmptyAnswer = (answer: QuestionAnswer): boolean =>
  !isAnswered(answer) && !answer.skipped && !answer.note?.trim();

/** `settled`: the agent marked a choice `[x]` and the reviewer did not pick, fill or skip. */
export type QuestionStatus = "open" | "answered" | "skipped" | "settled";

export function questionStatus(question: Question, answer?: QuestionAnswer): QuestionStatus {
  if (answer && isAnswered(answer)) return "answered";
  if (answer?.skipped) return "skipped";
  if (question.choices.some((c) => c.settled)) return "settled";
  return "open";
}

export const emptyAnswer = (question: Question): QuestionAnswer => ({
  key: question.key,
  kind: question.kind,
  prompt: question.prompt,
  selected: [],
});

const recommendedLabels = (question: Question): string[] =>
  question.choices.filter((c) => c.recommended).map((c) => c.label);

/** The answer the recommendation stands for, keeping `base`'s note. Null without one. */
export function recommendedAnswer(question: Question, base: QuestionAnswer): QuestionAnswer | null {
  const { skipped: _s, other: _o, text: _t, ...rest } = base;
  const labels = recommendedLabels(question);
  if (labels.length > 0) return { ...rest, selected: labels };
  if (!question.suggestedText) return null;
  return question.kind === "text"
    ? { ...rest, selected: [], text: question.suggestedText }
    : { ...rest, selected: [], other: question.suggestedText };
}

/** Whether the answer is exactly what the question recommended. */
export function isRecommendedAnswer(question: Question, answer: QuestionAnswer): boolean {
  const suggested = question.suggestedText ? normalize(question.suggestedText) : null;
  if (answer.kind === "text") return !!suggested && normalize(answer.text ?? "") === suggested;
  const labels = recommendedLabels(question);
  if (labels.length === 0) {
    return (
      !!suggested && answer.selected.length === 0 && normalize(answer.other ?? "") === suggested
    );
  }
  if (answer.other?.trim()) return false;
  const want = new Set(labels.map(normalize));
  const got = new Set(answer.selected.map(normalize));
  return want.size === got.size && [...want].every((label) => got.has(label));
}

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();
const quoted = (value: string): string => `> ${value.trim().replace(/\n/g, "\n> ")}\n`;

/** The answer as one line: `Answer: Local only — note: …`, `Skipped`, `Note: …`. */
export function formatAnswerText(answer: QuestionAnswer): string {
  const parts = answer.selected.map(oneLine);
  if (answer.other?.trim()) parts.push(`Other: ${oneLine(answer.other)}`);
  if (answer.text?.trim()) parts.push(oneLine(answer.text));
  let out = parts.length ? `Answer: ${parts.join("; ")}` : answer.skipped ? "Skipped" : "";
  if (answer.note?.trim())
    out = out ? `${out} — note: ${oneLine(answer.note)}` : `Note: ${oneLine(answer.note)}`;
  return out;
}

function formatAnswerLines(
  answer: QuestionAnswer,
  recommended: boolean,
  settled: string[],
): string {
  const rec = recommended ? " (your recommendation)" : "";
  let out = "";
  if (settled.length > 0) {
    out +=
      settled.length > 1
        ? `Answer (already settled in the document):\n${settled.map((l) => `- ${oneLine(l)}\n`).join("")}`
        : `Answer: ${oneLine(settled[0])} (already settled in the document)\n`;
  }
  const picks = answer.selected.map(oneLine);
  if (answer.other?.trim()) picks.push(`Other: ${oneLine(answer.other)}`);
  if (answer.text?.trim()) out += `Answer${rec}:\n${quoted(answer.text)}`;
  else if (picks.length > 1) out += `Answer${rec}:\n${picks.map((p) => `- ${p}\n`).join("")}`;
  else if (picks.length === 1) out += `Answer: ${picks[0]}${rec}\n`;
  else if (answer.skipped) out += "Skipped\n";
  const note = answer.note?.trim();
  if (note) out += note.includes("\n") ? `Note:\n${quoted(note)}` : `Note: ${note}\n`;
  return out;
}

const where = ({ path, line }: IndexedQuestion) =>
  path ? `${path}, line ${line}` : `line ${line}`;

const settledLabels = (q: Question) => q.choices.filter((c) => c.settled).map((c) => c.label);

export const ANSWERS_HEADING = "## Answers to your questions";

/**
 * The feedback's answers section, or "" when there is nothing to report. `Q<n>` numbers match
 * the cards' "Question N of M". A settled question the reviewer left alone is neither counted
 * nor listed; one with only a note counts as answered by its settled choice. An answer whose
 * question left the document is still reported.
 */
export function formatAnswersSection(
  questions: readonly IndexedQuestion[],
  answers: readonly QuestionAnswer[],
): string {
  const byKey = new Map<string, QuestionAnswer>();
  for (const answer of answers) {
    if (!isEmptyAnswer(answer) && !byKey.has(answer.key)) byKey.set(answer.key, answer);
  }
  if (byKey.size === 0) return "";

  const asked = questions.filter(
    ({ question }) => settledLabels(question).length === 0 || byKey.has(question.key),
  );
  const leftAsIs = questions.length - asked.length;
  const answered = asked.filter(({ question }) => {
    const answer = byKey.get(question.key);
    if (!answer) return false;
    return isAnswered(answer) || (settledLabels(question).length > 0 && !answer.skipped);
  }).length;

  let out = `${ANSWERS_HEADING}\n\n${answered} of ${asked.length} question${asked.length === 1 ? "" : "s"} answered.`;
  if (leftAsIs > 0) {
    out += ` ${leftAsIs} already settled in the document ${leftAsIs === 1 ? "was" : "were"} left as is.`;
  }
  out += "\n\n";

  const unanswered: IndexedQuestion[] = [];
  for (const item of asked) {
    const { question, number } = item;
    const answer = byKey.get(question.key);
    if (!answer) {
      unanswered.push(item);
      continue;
    }
    byKey.delete(question.key);
    const standsSettled = !isAnswered(answer) && !answer.skipped ? settledLabels(question) : [];
    out += `### Q${number}. ${oneLine(question.prompt)} (${where(item)})\n`;
    out += formatAnswerLines(
      answer,
      isAnswered(answer) && isRecommendedAnswer(question, answer),
      standsSettled,
    );
    out += "\n";
  }
  for (const answer of byKey.values()) {
    out += `### ${oneLine(answer.prompt)} (this question is no longer in the document)\n`;
    out += `${formatAnswerLines(answer, false, [])}\n`;
  }
  if (unanswered.length > 0) {
    out += "### Unanswered\n";
    for (const item of unanswered) {
      out += `- Q${item.number}. ${oneLine(item.question.prompt)} (${where(item)})\n`;
    }
    out += "\n";
  }
  return out;
}
