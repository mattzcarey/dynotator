import { useRef, useState } from "react";
import { api } from "../api";
import type { Annotation } from "./annotations";
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
  revision,
  getFeedback,
  getDraftGeneration,
  onDecided,
  notify,
}: {
  revision: number;
  /** The feedback input as of now; it may first read the files that answered questions sit in. */
  getFeedback: (annotations: Annotation[]) => Promise<FeedbackInput>;
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
      } else if (error instanceof Refused && error.code === "revised") {
        notify("decision", {
          text: "The agent put up a new version. Nothing was sent: load it, then decide again.",
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

  const common = () => ({ revision, draftGeneration: getDraftGeneration() });

  const approve = (annotations: Annotation[]) =>
    run(async () => {
      const feedback = annotations.length > 0 && buildFeedback(await getFeedback(annotations));
      await post("/api/approve", { ...(feedback && { feedback }), ...common() });
      return "approved";
    });

  const requestChanges = (annotations: Annotation[], answersOnly: boolean) =>
    run(async () => {
      await post("/api/deny", {
        feedback: buildFeedback(await getFeedback(annotations)),
        ...(answersOnly && { answersOnly: true }),
        ...common(),
      });
      return "changes";
    });

  const sendFeedback = (annotations: Annotation[]) =>
    run(async () => {
      await post("/api/feedback", {
        feedback: buildFeedback(await getFeedback(annotations)),
        annotations,
        ...common(),
      });
      return annotations.length === 0 ? "done" : "sent";
    });

  const close = () =>
    run(async () => {
      await post(`/api/exit?draftGeneration=${getDraftGeneration()}`);
      return "closed";
    });

  return { outcome, busy, approve, requestChanges, sendFeedback, close };
}
