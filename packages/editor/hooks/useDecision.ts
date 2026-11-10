import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { AnnotationType, type Annotation } from "@dynotator/ui/types";
import { generateId } from "@dynotator/ui/utils/generateId";
import { getIdentity } from "@dynotator/ui/utils/identity";
import type { DecisionActionId } from "@dynotator/ui/utils/decisionSpec";
import type { PermissionMode } from "@dynotator/ui/utils/permissionMode";
import { buildFeedback, hasFeedback, NO_FEEDBACK_SENTENCE, type FeedbackInput } from "../feedback";

export type Submitted = "approved" | "denied" | "done" | "exited" | "closed";

interface Options {
  mode: "plan" | "annotate";
  feedbackInput: FeedbackInput;
  /** Only questions were answered: the deny tells the agent so. */
  answersOnly: boolean;
  /** Sent with an approval when the agent honours it (Claude Code). */
  permissionMode: PermissionMode | null;
  /** The plan revision on screen; the server refuses a decision on an older one. */
  planRevision: number | null;
  getDraftGeneration: () => number;
  addAnnotation: (annotation: Annotation) => void;
  onDecided: () => void;
}

class Refused extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function post(path: string, body?: object): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const error = typeof data?.error === "string" ? data.error : null;
  if (res.status === 409 && error) throw new Refused(error);
  throw new Error(error ?? `The server answered ${res.status}.`);
}

function noteAnnotation(text: string): Annotation {
  return {
    id: generateId("global-note"),
    blockId: "",
    startOffset: 0,
    endOffset: 0,
    type: AnnotationType.GLOBAL_COMMENT,
    text,
    originalText: "",
    createdA: Date.now(),
    author: getIdentity(),
  };
}

/** Approve / deny (plan) and send feedback / close (annotate). */
export function useDecision({
  mode,
  feedbackInput,
  answersOnly,
  permissionMode,
  planRevision,
  getDraftGeneration,
  addAnnotation,
  onDecided,
}: Options) {
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(
    async (what: string, send: () => Promise<Submitted>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setIsSubmitting(true);
      try {
        const outcome = await send();
        onDecided();
        setSubmitted(outcome);
      } catch (error) {
        if (error instanceof Refused && error.code === "plan_revised") {
          toast("The agent revised the plan", {
            description: "Nothing was sent. Load the new version, then decide again.",
            duration: Infinity,
            action: { label: "Load", onClick: () => window.location.reload() },
          });
          return;
        }
        if (error instanceof Refused && error.code === "already_decided") {
          onDecided();
          setSubmitted("closed");
          return;
        }
        toast.error(`Could not send the ${what}`, {
          description: error instanceof Error ? error.message : undefined,
          action: { label: "Retry", onClick: () => void run(what, send) },
        });
      } finally {
        busyRef.current = false;
        setIsSubmitting(false);
      }
    },
    [onDecided],
  );

  const withNote = (note: string | undefined): FeedbackInput => {
    const text = note?.trim();
    if (!text) return feedbackInput;
    const annotation = noteAnnotation(text);
    addAnnotation(annotation);
    return { ...feedbackInput, annotations: [...feedbackInput.annotations, annotation] };
  };

  const approve = (input: FeedbackInput | null) =>
    run("approval", async () => {
      await post("/api/approve", {
        draftGeneration: getDraftGeneration(),
        ...(planRevision !== null ? { planRevision } : {}),
        ...(input && hasFeedback(input) ? { feedback: buildFeedback(input) } : {}),
        ...(permissionMode ? { permissionMode } : {}),
      });
      return "approved";
    });

  const deny = (input: FeedbackInput) =>
    run("feedback", async () => {
      await post("/api/deny", {
        draftGeneration: getDraftGeneration(),
        ...(planRevision !== null ? { planRevision } : {}),
        feedback: buildFeedback(input),
        ...(answersOnly ? { answersOnly: true } : {}),
      });
      return "denied";
    });

  const sendFeedback = (input: FeedbackInput) =>
    run("feedback", async () => {
      const feedback = buildFeedback(input);
      const nothingToSend = feedback === NO_FEEDBACK_SENTENCE;
      await post("/api/feedback", {
        draftGeneration: getDraftGeneration(),
        feedback,
        annotations: input.annotations,
        ...(nothingToSend ? { nothingToSend: true } : {}),
      });
      return nothingToSend ? "done" : "denied";
    });

  const empty: FeedbackInput = { ...feedbackInput, annotations: [], globalAttachments: [] };
  const ready = hasFeedback(feedbackInput);

  const act = (id: DecisionActionId, note?: string) => {
    if (submitted) return;
    if (mode === "plan") {
      switch (id) {
        case "primary":
          return ready ? deny(feedbackInput) : approve(null);
        case "note-with-approval":
          return approve(withNote(note));
        case "request-changes":
        case "note-with-feedback":
          return deny(withNote(note));
        case "approve-with-notes":
          return approve(feedbackInput);
        case "discard-and-finish":
          return approve(null);
      }
    }
    switch (id) {
      case "discard-and-finish":
        return sendFeedback(empty);
      case "primary":
      case "approve-with-notes":
        return sendFeedback(feedbackInput);
      default:
        return sendFeedback(withNote(note));
    }
  };

  const close = () =>
    run("close request", async () => {
      await post(`/api/exit?draftGeneration=${getDraftGeneration()}`);
      return "exited";
    });

  return { submitted, isSubmitting, act, close };
}
