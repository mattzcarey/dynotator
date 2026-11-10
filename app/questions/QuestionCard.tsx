import React, { useId, useRef, useState } from "react";
import {
  emptyAnswer,
  isEmptyAnswer,
  isRecommendedAnswer,
  questionStatus,
  recommendedAnswer,
  type IndexedQuestion,
  type QuestionAnswer,
} from "./questions";
import { InlineMarkdown } from "../markdown/Inline";
import { NestedBlocks } from "../markdown/Nested";

/** Pointer travel (px) above which a press on a choice row is a drag, not a pick. */
const DRAG_THRESHOLD = { mouse: 4, touch: 10 };

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

const PILL =
  "annotation-exclude select-none inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded border px-1.5 text-[10.5px] font-semibold leading-4 tracking-[0.03em]";

const TONES = {
  rec: "border-transparent bg-primary/15 text-primary",
  ok: "border-transparent bg-success/15 text-success",
  skip: "border-transparent bg-muted text-muted-foreground",
  open: "border-dashed border-border text-muted-foreground",
};

const Tag = ({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) => (
  <span className={cx(PILL, TONES[tone])}>{children}</span>
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

const inline = (text: string) => <InlineMarkdown text={text} />;

export interface QuestionCardProps {
  blockId: string;
  indexed: IndexedQuestion;
  /** How many questions the document has, for "Question N of M". */
  total: number;
  answer?: QuestionAnswer;
  /** Called with every change, null once the answer is empty. Absent: read-only. */
  onAnswer?: (blockId: string, answer: QuestionAnswer | null, key: string) => void;
}

/**
 * A `:::question` block as an answer card. The prompt, context and choice text stay ordinary
 * document text a reviewer can select and annotate; only the chrome is `annotation-exclude`.
 */
export function QuestionCard({ blockId, indexed, total, answer, onAnswer }: QuestionCardProps) {
  const { question, number } = indexed;
  const readOnly = !onAnswer;
  const uid = useId().replace(/:/g, "");
  const promptId = `q-prompt-${uid}`;
  const [noteToggled, setNoteToggled] = useState<boolean | null>(null);
  const noteOpen = noteToggled ?? !!answer?.note;
  const [otherFocused, setOtherFocused] = useState(false);
  const pressRef = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const status = questionStatus(question, answer);
  const skipped = status === "skipped";
  const multi = question.kind === "multi";
  const base = answer ?? emptyAnswer(question);
  const recommended = recommendedAnswer(question, base);
  // Offered until the answer is the recommendation.
  const offerAccept =
    !readOnly &&
    !!recommended &&
    status !== "settled" &&
    (status !== "answered" || !isRecommendedAnswer(question, base));
  const selected =
    status === "answered" || skipped
      ? base.selected
      : question.choices.filter((c) => c.settled).map((c) => c.label);
  // A recommendation that is none of the choices is a row of its own; picking it stores the
  // text as the "Other…" answer.
  const suggestion = question.kind === "text" ? undefined : question.suggestedText;
  const suggestionPicked =
    !!suggestion && !otherFocused && (base.other ?? "").trim() === suggestion.trim();
  const other = suggestionPicked ? "" : (base.other ?? "");

  const commit = (next: QuestionAnswer) =>
    onAnswer?.(blockId, isEmptyAnswer(next) ? null : next, question.key);

  const pick = (label: string, checked: boolean) => {
    const { skipped: _s, ...rest } = base;
    if (multi) {
      const next = question.choices
        .map((c) => c.label)
        .filter((l) => (l === label ? checked : selected.includes(l)));
      commit({ ...rest, selected: next });
    } else if (checked) {
      const { other: _o, ...single } = rest;
      commit({ ...single, selected: [label] });
    }
  };

  const pickSuggestion = (checked: boolean) => {
    const { skipped: _s, other: _o, ...rest } = base;
    if (multi) commit({ ...rest, selected, ...(checked ? { other: suggestion } : {}) });
    else if (checked) commit({ ...rest, selected: [], other: suggestion });
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
    const { skipped: _s, other: _o, text: _t, ...rest } = base;
    commit(base.skipped ? rest : { ...rest, selected: [], skipped: true });
  };

  const toggleNote = () => {
    setNoteToggled(!noteOpen);
    if (!noteOpen) requestAnimationFrame(() => noteRef.current?.focus());
  };

  // A <label> forwards its click to the input; cancelling the click keeps a text drag (or a
  // double-click selecting a word) from also picking.
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
      const selecting = !!window.getSelection()?.toString().trim();
      if (moved || selecting || e.detail >= 2) e.preventDefault();
    },
  };
  const rowClass = (checked: boolean) =>
    cx(
      ROW,
      readOnly ? "cursor-default" : "cursor-pointer hover:bg-muted/45",
      checked && "bg-primary/12 hover:bg-primary/12",
    );

  const eyebrow = `Question${number > 0 ? ` ${number} of ${total}` : ""}${multi ? " · pick any" : ""}`;
  const inputType = multi ? "checkbox" : "radio";

  return (
    <fieldset
      className={cx(
        "question-block my-5 min-w-0 rounded-[10px] border px-3.5 pt-3 pb-2.5",
        "bg-[color-mix(in_oklab,var(--background)_35%,var(--card))]",
        status === "answered" ? "border-primary/45" : "border-border/85",
      )}
      data-block-id={blockId}
      data-question-key={question.key}
      aria-labelledby={promptId}
      aria-disabled={readOnly || undefined}
    >
      <div className="annotation-exclude mb-1.5 flex items-center gap-2 select-none">
        <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {eyebrow}
        </span>
        <span className="ml-auto">{STATUS_TAGS[status]}</span>
      </div>

      <p id={promptId} className="m-0 text-[15px] leading-[1.45] font-semibold text-foreground">
        {inline(question.prompt)}
      </p>
      {question.context && (
        <NestedBlocks
          markdown={question.context}
          className="question-context mt-1 text-[13px] leading-normal text-muted-foreground"
        />
      )}

      {question.kind === "text" ? (
        <>
          {question.suggestedText && status !== "answered" && (
            <div className="mt-2 text-[12.5px] text-muted-foreground">
              <Tag tone="rec">Recommended</Tag> {inline(question.suggestedText)}
            </div>
          )}
          <textarea
            className={cx(FIELD, "mt-2.5 min-h-[74px]", skipped && "opacity-55")}
            aria-labelledby={promptId}
            placeholder={readOnly ? "" : "Type your answer…"}
            value={base.text ?? ""}
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
              <label key={choice.label} className={rowClass(checked)} {...rowProps}>
                <input
                  type={inputType}
                  name={uid}
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
          {suggestion && (
            <label className={rowClass(suggestionPicked)} {...rowProps}>
              <input
                type={inputType}
                name={uid}
                checked={suggestionPicked}
                onChange={(e) => pickSuggestion(e.target.checked)}
                className={CONTROL}
                disabled={readOnly}
              />
              <span className={CHOICE_TEXT}>
                <span className="font-[550]">{inline(suggestion)}</span>{" "}
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

      {noteOpen && (!readOnly || !!base.note) && (
        <textarea
          ref={noteRef}
          className={cx(FIELD, "mt-2 min-h-[54px]")}
          aria-label="Note"
          placeholder="Context for the agent…"
          value={base.note ?? ""}
          onChange={(e) => setNote(e.target.value)}
          disabled={readOnly}
        />
      )}

      {!readOnly && (
        <div className="annotation-exclude mt-2 flex flex-wrap items-center gap-1 border-t border-border/55 pt-1.5 select-none">
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
          {offerAccept && recommended && (
            <button
              type="button"
              onClick={() => commit(recommended)}
              className="ml-auto rounded-md border border-primary/45 bg-primary/10 px-2.5 py-[3px] text-[12.5px] font-medium whitespace-nowrap text-primary hover:bg-primary/20"
            >
              Accept recommended
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Scroll a question card into view and focus its first control. */
export function focusQuestionCard(key: string): void {
  const card = document.querySelector<HTMLElement>(
    `fieldset[data-question-key="${CSS.escape(key)}"]`,
  );
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card
    .querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])")
    ?.focus({ preventScroll: true });
}
