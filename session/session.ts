import { type Decision, type Revision, assertRevisable, clearDecision, getDecision } from "./decision";
import type { Files, ReviewInit } from "./files";
import { type Fs, addVersion, initReview } from "./review";
import { handleRequest } from "./router";
import type { Store } from "./store";

const DEFAULT_WAIT_SECONDS = 25;
const MAX_WAIT_SECONDS = 55;

/**
 * One review: what `SessionServer` does, over a key-value store (decision, drafts, the version
 * index) and a filesystem (each version's files), so it runs the same in tests.
 */
export class Session {
  /** Pending `wait` calls, in memory: they last only as long as this instance does. */
  private readonly waiting = new Set<(decision: Decision | null) => void>();
  /** Versions are written one at a time. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: Store,
    private readonly fs: Fs,
  ) {}

  init(input: ReviewInit): Promise<void> {
    return this.serially(() => initReview(this.store, this.fs, input));
  }

  decision(): Decision | null {
    return getDecision(this.store) ?? null;
  }

  /** The decision, or `null` if none arrives within `seconds` (default 25, at most 55). */
  wait(seconds?: number): Promise<Decision | null> {
    const existing = this.decision();
    if (existing) return Promise.resolve(existing);
    const s =
      seconds !== undefined && seconds >= 0
        ? Math.min(seconds, MAX_WAIT_SECONDS)
        : DEFAULT_WAIT_SECONDS;
    return new Promise((resolve) => {
      const done = (decision: Decision | null) => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve(decision);
      };
      const timer = setTimeout(() => done(null), s * 1000);
      this.waiting.add(done);
    });
  }

  /**
   * Puts a full snapshot up as the next version and reopens the decision; files absent from it
   * are gone in that version. Refused once the review is over, including when the reviewer
   * finishes it while the snapshot is being written.
   */
  revise(files: Files): Promise<Revision> {
    return this.serially(async () => {
      assertRevisable(this.store);
      const revision = await addVersion(this.store, this.fs, files, () => {
        assertRevisable(this.store);
        clearDecision(this.store);
      });
      return revision;
    });
  }

  fetch(request: Request): Promise<Response> {
    return handleRequest(request, this.store, this.fs, (decision) => {
      for (const done of this.waiting) done(decision);
    });
  }

  private serially<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writing.then(task, task);
    this.writing = run.catch(() => {});
    return run;
  }
}
