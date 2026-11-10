import React, { useId, useMemo, useRef, useState } from "react";
import {
  canonicalQuestionAnswer,
  emptyQuestionAnswer,
  isQuestionAnswerEmpty,
  isRecommendedQuestionAnswer,
  questionStatus,
  recommendedQuestionAnswer,
  type IndexedQuestion,
  type QuestionAnswer,
} from "@dynotator/core/question-block";
import { InlineMarkdown } from "../InlineMarkdown";
import { QuestionContext } from "./QuestionContext";

/**
 * A `:::question` block drawn as an answer card: "Question N of M" and a
 * status tag, the prompt and its context, then the choices (radios or
 * checkboxes, the agent's recommended free answer as one more row, and
 * "Other…"), or a text box for a free-text question, and a footer with
 * Add note · Skip · Accept recommended.
 *
 * The prompt, context and choice text stay ordinary document text, so a
 * reviewer can select and annotate any of it; only the chrome is
 * `annotation-exclude`. A click on a choice picks it only when the pointer
 * barely moved and no text is selected, so dragging across a choice makes an
 * annotation, never a pick.
 *
 * The answer lives with the host: every change calls `onAnswer` with the next
 * answer, or null once it is empty. Without `onAnswer` the card is read-only.
 */

/** Pointer travel (px) above which a press on a choice row is a drag. */
const DRAG_THRESHOLD = { mouse: 4, touch: 10 };

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

const PILL =
  "annotation-exclude select-none inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded border px-1.5 text-[10.5px] font-semibold leading-4 tracking-[0.03em]";

const TONES = {
  rec: "border-transparent bg-primary/15 text-primary",
  ok: "border-transparent bg-success/15 text-success",
  skip: "border-transparent bg-muted text-muted-foreground",
  open: "border-dashed border-border text-muted-foreground",
  warn: "border-transparent bg-warning/15 text-warning",
};

const Tag: React.FC<{ tone: keyof typeof TONES; children: React.ReactNode; title?: string }> = ({
  tone,
  children,
  title,
}) => (
  <span className={cx(PILL, TONES[tone])} title={title} data-question-tag={tone}>
    {children}
  </span>
);

const STATUS_TAGS = {
  answered: <Tag tone="ok">Answered</Tag>,
  settled: <Tag tone="ok">Settled</Tag>,
  skipped: <Tag tone="skip">Skipped</Tag>,
  open: <Tag tone="open">Open</Tag>,
};

const ROW = "flex items-start gap-2.5 rounded-[7px] px-[9px] py-1.5 transition-colors";
const CONTROL =
  "mt-[3px] h-[15px] w-[15px] shrink-0 cursor-pointer accent-primary disabled:cursor-default";
const CHOICE_TEXT = "min-w-0 flex-1 select-text text-[13.5px] leading-[1.45] text-foreground";
const FOOT_BUTTON =
  "whitespace-nowrap rounded-[5px] px-[7px] py-[3px] text-xs hover:bg-muted hover:text-foreground";
const FIELD =
  "annotation-exclude block w-full resize-y rounded-[7px] border border-border bg-background px-2.5 py-2 text-[13.5px] leading-normal text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-1 focus:ring-ring";

export interface QuestionBlockProps {
  blockId: string;
  indexed: IndexedQuestion;
  /** How many question blocks the document has (for "Question N of M"). */
  total: number;
  answer?: QuestionAnswer;
  onAnswer?: (blockId: string, answer: QuestionAnswer | null, key: string) => void;
}

export const QuestionBlock: React.FC<QuestionBlockProps> = ({
  blockId,
  indexed,
  total,
  answer: storedAnswer,
  onAnswer,
}) => {
  const { question, number } = indexed;
  const readOnly = !onAnswer;
  // An answer saved under an older label of a choice still shows it picked.
  const answer = useMemo(
    () => (storedAnswer ? canonicalQuestionAnswer(question, storedAnswer) : undefined),
    [question, storedAnswer],
  );
  const uid = useId().replace(/:/g, "");
  const promptId = `q-prompt-${uid}`;
  const contextId = `q-context-${uid}`;
  const [noteToggled, setNoteToggled] = useState<boolean | null>(null);
  const noteOpen = noteToggled ?? !!answer?.note?.trim();
  const [otherFocused, setOtherFocused] = useState(false);
  const pressRef = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const inline = (text: string) => <InlineMarkdown text={text} />;

  const status = questionStatus(question, answer);
  const answered = status === "answered";
  const skipped = status === "skipped";
  const multi = question.kind === "multi";
  const recommendedLabels = question.choices.filter((c) => c.recommended).map((c) => c.label);
  const hasRecommendation = recommendedLabels.length > 0 || !!question.suggestedText;
  // Offered until the answer is the recommendation (a pick-any question keeps
  // it while some recommended boxes are still unticked).
  const offerAccept =
    !readOnly &&
    hasRecommendation &&
    status !== "settled" &&
    (!answered ||
      (multi &&
        recommendedLabels.length > 0 &&
        !isRecommendedQuestionAnswer(answer!, recommendedLabels, question.suggestedText)));
  const selected =
    answered || skipped
      ? answer!.selected
      : question.choices.filter((c) => c.settled).map((c) => c.label);
  const base = answer ?? emptyQuestionAnswer(indexed);
  const storedOther = answer?.other ?? "";
  // The agent's recommended answer that is none of the choices is a row of
  // its own; picking it stores the text as the "Other…" answer.
  const suggestionRow = question.kind !== "text" && !!question.suggestedText;
  const suggestionPicked =
    suggestionRow && !otherFocused && storedOther.trim() === question.suggestedText!.trim();
  const other = suggestionPicked ? "" : storedOther;

  const commit = (next: QuestionAnswer) =>
    onAnswer?.(blockId, isQuestionAnswerEmpty(next) ? null : next, question.key);

  const pick = (label: string, checked: boolean) => {
    const { skipped: _s, ...rest } = base;
    if (multi) {
      const order = question.choices.map((c) => c.label);
      const next = (
        checked
          ? [...selected.filter((l) => l !== label), label]
          : selected.filter((l) => l !== label)
      ).sort((a, b) => order.indexOf(a) - order.indexOf(b));
      commit({ ...rest, selected: next });
    } else if (checked) {
      const { other: _o, ...single } = rest;
      commit({ ...single, selected: [label] });
    }
  };

  const pickSuggestion = (checked: boolean) => {
    const { skipped: _s, other: _o, ...rest } = base;
    if (multi) commit({ ...rest, selected, ...(checked ? { other: question.suggestedText } : {}) });
    else if (checked) commit({ ...rest, selected: [], other: question.suggestedText });
  };

  const setOther = (value: string) => {
    const { skipped: _s, other: _o, ...rest } = base;
    const keep = multi ? selected : value.trim() ? [] : rest.selected;
    commit({ ...rest, selected: keep, ...(value ? { other: value } : {}) });
  };

  const setText = (value: string) => {
    const { skipped: _s, text: _t, ...rest } = base;
    commit({ ...rest, ...(value ? { text: value } : {}) });
  };

  const setNote = (value: string) => {
    const { note: _n, ...rest } = base;
    commit({ ...rest, ...(value ? { note: value } : {}) });
  };

  const toggleSkip = () => {
    if (base.skipped) {
      const { skipped: _s, ...rest } = base;
      commit(rest);
    } else {
      const { other: _o, text: _t, ...rest } = base;
      commit({ ...rest, selected: [], skipped: true });
    }
  };

  const acceptRecommended = () => {
    const next = recommendedQuestionAnswer(indexed, base);
    if (next) commit(next);
  };

  const toggleNote = () => {
    setNoteToggled(!noteOpen);
    if (!noteOpen) requestAnimationFrame(() => noteRef.current?.focus());
  };

  // A <label> forwards its click to the input; cancelling the click keeps a
  // text drag (or a double-click selecting a word) from also picking.
  const rowProps = {
    onPointerDown: (e: React.PointerEvent) => {
      pressRef.current = { x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" };
    },
    onClickCapture: (e: React.MouseEvent) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (e.target instanceof HTMLInputElement) return;
      const limit = press?.touch ? DRAG_THRESHOLD.touch : DRAG_THRESHOLD.mouse;
      const moved = !!press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > limit;
      const selection = window.getSelection();
      const selecting = !!selection && !selection.isCollapsed && !!selection.toString().trim();
      if (moved || selecting || e.detail >= 2) e.preventDefault();
    },
  };

  const eyebrow = `Question${number > 0 ? ` ${number} of ${total}` : ""}${multi ? " · pick any" : ""}`;
  const groupName = `question-${uid}`;
  const inputType = multi ? "checkbox" : "radio";

  return (
    <fieldset
      className={cx(
        "question-block my-5 min-w-0 rounded-[10px] border px-3.5 pb-2.5 pt-3",
        "bg-[color-mix(in_oklab,var(--background)_35%,var(--card))]",
        answered ? "border-primary/45" : "border-border/85",
      )}
      data-block-id={blockId}
      data-block-type="directive"
      data-directive-kind={question.directiveKind}
      data-question-key={question.key}
      data-question-status={status}
      aria-labelledby={promptId}
      aria-describedby={question.context ? contextId : undefined}
      aria-disabled={readOnly || undefined}
    >
      <div className="annotation-exclude mb-1.5 flex select-none items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {eyebrow}
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          {(question.decision || question.decisionOnAnswer) && <Tag tone="rec">Decision</Tag>}
          {question.reversible && (
            <Tag tone="warn" title={question.reversible.why}>
              Can&rsquo;t be undone
            </Tag>
          )}
          {STATUS_TAGS[status]}
        </span>
      </div>

      <p id={promptId} className="m-0 text-[15px] font-semibold leading-[1.45] text-foreground">
        {inline(question.prompt)}
      </p>
      {question.stakes && (
        <p className="m-0 mt-1 text-[13px] font-medium leading-[1.45] text-foreground/90">
          {inline(question.stakes)}
        </p>
      )}
      {question.shows && (
        <p className="m-0 mt-1.5 text-[12.5px]">
          <span className="annotation-exclude select-none text-muted-foreground">Shows </span>
          {inline(`[${question.shows.label || question.shows.src}](${question.shows.src})`)}
        </p>
      )}
      {question.decision ? (
        <p className="annotation-exclude m-0 mt-2 rounded-lg bg-primary/8 px-[9px] py-1.5 text-[12.5px]">
          <span className="select-none text-muted-foreground">Decision: </span>
          <a
            href={question.decision.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {question.decision.statement}
          </a>
        </p>
      ) : (
        question.decisionOnAnswer && (
          <p className="annotation-exclude m-0 mt-2 select-none rounded-lg bg-primary/8 px-[9px] py-1.5 text-[12.5px]">
            Answering this records a decision
          </p>
        )
      )}
      {question.context && <QuestionContext id={contextId} markdown={question.context} />}

      {question.kind === "text" ? (
        <>
          {question.suggestedText && !answered && (
            <div className="mt-2 text-[12.5px] text-muted-foreground">
              <Tag tone="rec">Recommended</Tag> {inline(question.suggestedText)}
            </div>
          )}
          <textarea
            className={cx(FIELD, "mt-2.5 min-h-[74px]", skipped && "opacity-55")}
            aria-labelledby={promptId}
            placeholder={readOnly ? "" : "Type your answer…"}
            value={answer?.text ?? ""}
            onChange={(e) => setText(e.target.value)}
            disabled={readOnly}
          />
        </>
      ) : (
        <div
          className={cx("mt-2.5 grid gap-0.5", skipped && "opacity-55")}
          role={multi ? "group" : "radiogroup"}
          aria-labelledby={promptId}
        >
          {question.choices.map((choice) => {
            const checked = selected.includes(choice.label);
            return (
              <label
                key={choice.label}
                className={cx(
                  ROW,
                  readOnly ? "cursor-default" : "cursor-pointer hover:bg-muted/45",
                  checked && "bg-primary/12 hover:bg-primary/12",
                )}
                data-question-option=""
                {...rowProps}
              >
                <input
                  type={inputType}
                  name={groupName}
                  checked={checked}
                  onChange={(e) => pick(choice.label, e.target.checked)}
                  className={CONTROL}
                  disabled={readOnly}
                />
                <span className={CHOICE_TEXT}>
                  <span className="font-[550]">{inline(choice.label)}</span>
                  {choice.description && (
                    <span className="text-muted-foreground"> — {inline(choice.description)}</span>
                  )}
                  {choice.recommended && (
                    <>
                      {" "}
                      <Tag tone="rec">Recommended</Tag>
                    </>
                  )}
                </span>
              </label>
            );
          })}
          {suggestionRow && (
            <label
              className={cx(
                ROW,
                readOnly ? "cursor-default" : "cursor-pointer hover:bg-muted/45",
                suggestionPicked && "bg-primary/12 hover:bg-primary/12",
              )}
              data-question-option=""
              {...rowProps}
            >
              <input
                type={inputType}
                name={groupName}
                checked={suggestionPicked}
                onChange={(e) => pickSuggestion(e.target.checked)}
                className={CONTROL}
                disabled={readOnly}
              />
              <span className={CHOICE_TEXT}>
                <span className="font-[550]">{inline(question.suggestedText!)}</span>{" "}
                <Tag tone="rec">Recommended</Tag>
              </span>
            </label>
          )}
          {(!readOnly || other.trim()) && (
            <div className="flex items-center gap-2.5 rounded-[7px] px-[9px] py-[5px]">
              <span
                aria-hidden="true"
                className="annotation-exclude w-[15px] text-center text-muted-foreground"
              >
                +
              </span>
              <input
                type="text"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onFocus={() => setOtherFocused(true)}
                onBlur={() => setOtherFocused(false)}
                disabled={readOnly}
                placeholder={readOnly ? "" : "Other…"}
                aria-label={number > 0 ? `Other answer to question ${number}` : "Other answer"}
                className="annotation-exclude min-w-0 flex-1 border-0 border-b border-transparent bg-transparent py-[3px] text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring"
              />
            </div>
          )}
        </div>
      )}

      {question.why && (
        <p className="m-0 mt-2 text-[12.5px] leading-[1.45] text-muted-foreground">
          <span className="font-semibold text-foreground/85">
            {recommendedLabels.length > 0 ? `Why ${recommendedLabels.join(", ")}:` : "Why:"}
          </span>{" "}
          {inline(question.why)}
        </p>
      )}

      {noteOpen && (!readOnly || !!answer?.note?.trim()) && (
        <textarea
          ref={noteRef}
          className={cx(FIELD, "mt-2 min-h-[54px]")}
          aria-label="Note"
          placeholder="Context for the agent…"
          value={answer?.note ?? ""}
          onChange={(e) => setNote(e.target.value)}
          disabled={readOnly}
        />
      )}

      {!readOnly && (
        <div className="annotation-exclude mt-2 flex select-none flex-wrap items-center gap-1 border-t border-border/55 pt-1.5">
          <button
            type="button"
            onClick={toggleNote}
            aria-expanded={noteOpen}
            className={cx(FOOT_BUTTON, noteOpen ? "text-foreground" : "text-muted-foreground")}
          >
            {noteOpen ? "Hide note" : "Add note"}
          </button>
          <button
            type="button"
            onClick={toggleSkip}
            aria-pressed={skipped}
            className={cx(FOOT_BUTTON, skipped ? "text-foreground" : "text-muted-foreground")}
          >
            {skipped ? "Unskip" : "Skip"}
          </button>
          {offerAccept && (
            <button
              type="button"
              onClick={acceptRecommended}
              className="ml-auto whitespace-nowrap rounded-md border border-primary/45 bg-primary/10 px-2.5 py-[3px] text-[12.5px] font-medium text-primary hover:bg-primary/20"
            >
              Accept recommended
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
};
