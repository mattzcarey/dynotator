import { type ReviewEvent, type Revision, append, eventsAfter, isClosed } from "./events";
import type { Files, ReviewInit } from "./files";
import { type Fs, addVersion, currentVersion, initReview } from "./review";
import { handleRequest } from "./router";
import type { Store } from "./store";

const MAX_WAIT_SECONDS = 55;

/**
 * One review: what `SessionServer` does, over a key-value store (events, drafts, the version
 * index) and a filesystem (each version's files), so it runs the same in tests.
 */
export class Session {
  /** Pending waits, in memory: they last only as long as this instance does. */
  private readonly waiting = new Set<() => void>();
  /** Versions are written one at a time. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: Store,
    private readonly fs: Fs,
  ) {}

  init(input: ReviewInit): Promise<void> {
    return this.serially(() => initReview(this.store, this.fs, input));
  }

  /**
   * Puts a full snapshot up as the next version and appends `revised`; files absent from it are
   * gone in that version. An identical snapshot appends nothing. Refused once the review is
   * closed, including when it closes while the snapshot is being written.
   */
  revise(files: Files): Promise<Revision> {
    return this.serially(async () => {
      this.assertOpen();
      const revision = await addVersion(this.store, this.fs, files, () => this.assertOpen());
      if (!revision.unchanged) this.append({ type: "revised", version: revision.version });
      return revision;
    });
  }

  /** Ends the review. Idempotent: `closed` is appended once and is always the last event. */
  close(): Promise<void> {
    return this.serially(async () => {
      if (!isClosed(this.store)) {
        this.append({ type: "closed", version: currentVersion(this.store) });
      }
    });
  }

  /**
   * Events with `seq > after`. With `wait` (seconds, at most 55) and none yet, holds until there
   * is one, or returns `[]` when the time is up.
   */
  async events(after = 0, wait = 0): Promise<ReviewEvent[]> {
    const existing = eventsAfter(this.store, after);
    const seconds = Math.min(Number.isFinite(wait) ? wait : 0, MAX_WAIT_SECONDS);
    if (existing.length > 0 || !(seconds > 0)) return existing;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve();
      };
      const timer = setTimeout(done, seconds * 1000);
      this.waiting.add(done);
    });
    return eventsAfter(this.store, after);
  }

  fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.store, this.fs, () => this.notify());
  }

  private assertOpen() {
    if (isClosed(this.store)) throw new Error("This review is closed.");
  }

  private append(event: Omit<ReviewEvent, "seq" | "at">) {
    append(this.store, event);
    this.notify();
  }

  private notify() {
    for (const done of this.waiting) done();
  }

  private serially<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writing.then(task, task);
    this.writing = run.catch(() => {});
    return run;
  }
}
