import { useRef, useState } from "react";
import { api } from "../api";
import { buildFeedback, type FeedbackInput } from "./feedback";
import type { Notify } from "./Notices";

export type Outcome = "approved" | "changes" | "sent" | "done" | "closed" | "taken";

/** A 409 from a decision route, by its `code`. */
class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: `/api/${string}`, body?: object): Promise<void> {
  const res = await fetch(api(path), {
    method: "POST",
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  const message = data?.error ?? `The server answered ${res.status}.`;
  if (res.status === 409 && data?.code) throw new Refused(data.code, message);
  throw new Error(message);
}

const reload = () => window.location.reload();

/** Approve / request changes (plan) and send feedback / close (annotate). */
export function useDecision({
  planRevision,
  getDraftGeneration,
  onDecided,
  notify,
}: {
  planRevision: number | null;
  getDraftGeneration: () => number;
  onDecided: () => void;
  notify: Notify;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function run(send: () => Promise<Outcome>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    notify("decision", null);
    try {
      const result = await send();
      onDecided();
      setOutcome(result);
    } catch (error) {
      if (error instanceof Refused && error.code === "already_decided") {
        onDecided();
        setOutcome("taken");
      } else if (error instanceof Refused && error.code === "plan_revised") {
        notify("decision", {
          text: "The plan was revised. Nothing was sent: load the new version, then decide again.",
          actions: [{ label: "Load", onClick: reload }],
        });
      } else {
        notify("decision", {
          text: `Could not send. ${error instanceof Error ? error.message : ""}`,
          actions: [
            { label: "Dismiss", onClick: () => {} },
            { label: "Retry", onClick: () => void run(send) },
          ],
        });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const common = () => ({
    ...(planRevision !== null && { planRevision }),
    draftGeneration: getDraftGeneration(),
  });

  const approve = (input: FeedbackInput) =>
    run(async () => {
      await post("/api/approve", {
        ...(input.annotations.length > 0 && { feedback: buildFeedback(input) }),
        ...common(),
      });
      return "approved";
    });

  const requestChanges = (input: FeedbackInput, answersOnly: boolean) =>
    run(async () => {
      await post("/api/deny", {
        feedback: buildFeedback(input),
        ...(answersOnly && { answersOnly: true }),
        ...common(),
      });
      return "changes";
    });

  const sendFeedback = (input: FeedbackInput) =>
    run(async () => {
      await post("/api/feedback", {
        feedback: buildFeedback(input),
        annotations: input.annotations,
        ...common(),
      });
      return input.annotations.length === 0 ? "done" : "sent";
    });

  const close = () =>
    run(async () => {
      await post(`/api/exit?draftGeneration=${getDraftGeneration()}`);
      return "closed";
    });

  return { outcome, busy, approve, requestChanges, sendFeedback, close };
}
