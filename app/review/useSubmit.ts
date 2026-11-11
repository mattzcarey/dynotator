import { useRef, useState } from "react";
import { api } from "../api";
import { toWire, type Annotation } from "./annotations";
import type { Notify } from "./Notices";

export type Kind = "feedback" | "approve";

/** A 409 from a submission, by its `code`. */
class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: `/api/${string}`, body: object): Promise<void> {
  const res = await fetch(api(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  const message = data?.error ?? `The server answered ${res.status}.`;
  if (res.status === 409 && data?.code) throw new Refused(data.code, message);
  throw new Error(message);
}

const DONE: Record<Kind, string> = { feedback: "Feedback sent.", approve: "Approved." };

/**
 * Send feedback and Approve. A submission carries the unsent annotations and the feedback text
 * for just those; the server drops ids it already logged, so a retry cannot send twice. Once it
 * is in, the log is read again and the sent annotations move to "Sent" by themselves.
 */
export function useSubmit({
  revision,
  describe,
  refresh,
  onLoad,
  notify,
}: {
  revision: number;
  /** The feedback text for these annotations; it may first read the files their answers are in. */
  describe: (annotations: Annotation[]) => Promise<string>;
  refresh: () => Promise<void>;
  onLoad: () => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function submit(kind: Kind, annotations: Annotation[]): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    notify("submit", null);
    try {
      const notes =
        annotations.length > 0
          ? { feedback: await describe(annotations), annotations: annotations.map(toWire) }
          : {};
      await post(kind === "approve" ? "/api/approve" : "/api/feedback", { ...notes, revision });
      await refresh();
      notify("submit", { text: DONE[kind], actions: [], ttl: 2500 });
      return true;
    } catch (error) {
      if (error instanceof Refused && error.code === "revised") {
        notify("submit", {
          text: "The agent put up a new version. Nothing was sent: load it, then send again.",
          actions: [{ label: "Load", onClick: onLoad }],
        });
      } else if (error instanceof Refused && error.code === "closed") {
        await refresh();
        notify("submit", {
          text: "The agent closed this review. Nothing was sent.",
          actions: [{ label: "OK", onClick: () => {} }],
        });
      } else {
        notify("submit", {
          text: `Could not send. ${error instanceof Error ? error.message : ""}`,
          actions: [
            { label: "Dismiss", onClick: () => {} },
            { label: "Retry", onClick: () => void submit(kind, annotations) },
          ],
        });
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { busy, submit };
}
