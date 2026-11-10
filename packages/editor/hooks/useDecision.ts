import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Annotation } from "@dynotator/ui/types";
import { buildFeedback, type FeedbackInput } from "../feedback";

export type Outcome = "approved" | "changes" | "sent" | "done" | "closed" | "taken";

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

const reload = { label: "Load", onClick: () => window.location.reload() };

/** Approve / request changes (plan) and send feedback / close (annotate). */
export function useDecision({
  planRevision,
  getDraftGeneration,
  onDecided,
}: {
  planRevision: number | null;
  getDraftGeneration: () => number;
  onDecided: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function run(send: () => Promise<Outcome>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await send();
      onDecided();
      setOutcome(result);
    } catch (error) {
      if (error instanceof Refused && error.code === "plan_revised") {
        toast("The plan was revised", {
          description: "Nothing was sent. Load the new version, then decide again.",
          duration: Infinity,
          action: reload,
        });
      } else if (error instanceof Refused && error.code === "already_decided") {
        onDecided();
        setOutcome("taken");
      } else {
        toast.error("Could not send", {
          description: error instanceof Error ? error.message : undefined,
          action: { label: "Retry", onClick: () => void run(send) },
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const revision = () => (planRevision === null ? {} : { planRevision });
  const draftGeneration = () => ({ draftGeneration: getDraftGeneration() });

  const approve = (input: FeedbackInput) =>
    run(async () => {
      const hasNotes = input.annotations.length > 0;
      await post("/api/approve", {
        ...(hasNotes ? { feedback: buildFeedback(input) } : {}),
        ...revision(),
        ...draftGeneration(),
      });
      return "approved";
    });

  const requestChanges = (input: FeedbackInput, answersOnly: boolean) =>
    run(async () => {
      await post("/api/deny", {
        feedback: buildFeedback(input),
        ...(answersOnly ? { answersOnly: true } : {}),
        ...revision(),
        ...draftGeneration(),
      });
      return "changes";
    });

  const sendFeedback = (input: FeedbackInput) =>
    run(async () => {
      const empty = input.annotations.length === 0;
      await post("/api/feedback", {
        feedback: buildFeedback(input),
        annotations: input.annotations satisfies Annotation[],
        ...revision(),
        ...draftGeneration(),
      });
      return empty ? "done" : "sent";
    });

  const close = () =>
    run(async () => {
      await post(`/api/exit?draftGeneration=${getDraftGeneration()}`);
      return "closed";
    });

  return { outcome, busy, approve, requestChanges, sendFeedback, close };
}
