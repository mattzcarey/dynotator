# Spec: the Dynotator API

This is the contract between agents, `worker/`, `session/` and `app/`. Names, shapes and status
codes are normative. The aim is the smallest API that lets an agent put a plan, documents or a
code change in front of a human and keep that conversation going.

## The whole agent API

```ts
createReview(init: { files: Files; patch?: string; title?: string; open?: string }): Promise<Review>;
revise(id: string, files: Files): Promise<Revision>;
getEvents(id: string, after?: number, wait?: number): Promise<ReviewEvent[]>;
close(id: string): Promise<void>;

type Files = Record<string, string>; // repo-relative path → UTF-8 text
interface Review { id: string; url: string }
interface Revision { version: number; unchanged: boolean }
```

Four methods. One way to send content, one way to say "this is a change", one way to read what
happened. There are no modes.

## 1. A review is a conversation

- A review stays open until the agent calls `close` or it expires. Nothing the reviewer does ends
  it.
- Everything that happens is appended to an event log. Nothing is overwritten.
- The reviewer can submit as often as they like. After sending, the page returns to the document;
  what they sent stays visible as sent, and they can add more.
- The agent can `revise` at any time, including after an approval. A new version has no approval.

```ts
interface ReviewEvent {
  /** 1-based, gapless, increasing. The agent's cursor. */
  seq: number;
  type: "feedback" | "approved" | "revised" | "closed";
  /** The version the event is about. For `revised`, the new version. */
  version: number;
  /** ISO 8601. */
  at: string;
  /** The reviewer's verified email, when the deployment is behind Cloudflare Access. */
  by?: string;
  /** `feedback`, `approved`: what the reviewer said, as markdown for an agent to act on. */
  feedback?: string;
  /** `feedback`, `approved`: the annotations in this submission, structured. */
  annotations?: Annotation[];
}
```

| Type       | Who      | Meaning                                                  |
| ---------- | -------- | -------------------------------------------------------- |
| `feedback` | reviewer | Comments, proposed replacements or answers on `version`. |
| `approved` | reviewer | Approves `version`. May carry notes.                     |
| `revised`  | agent    | `revise` put up `version`.                               |
| `closed`   | agent    | `close` ended the review. Always the last event.         |

Rules:

- The page always offers the reviewer two actions: **Send feedback** and **Approve**. What an
  approval means is the agent's business: an agent that only wants comments ignores it.
- A reviewer event is accepted only for the current version (stale: 409 `revised`) and only while
  the review is open (409 `closed`). A second submission is simply another event.
- An annotation is **sent** if its `id` is in the event log, and unsent otherwise. That is the
  only state there is. A submission carries the page's unsent annotations; the server drops any
  whose `id` it has already logged, appends the rest as one event, and clears the draft. So a
  submission is idempotent: a second tab, a retry or a stale draft cannot send something twice,
  and each event carries only what is new.
- A version is approved if the latest reviewer event on it is `approved`. Feedback sent after an
  approval withdraws it; an agent that keeps reading sees that.
- `revise` takes a full snapshot (files absent from it are deleted in that version). An identical
  snapshot appends nothing and returns `unchanged: true`.
- `close` is idempotent. After it, `revise` and reviewer events are refused; reads keep working
  until expiry.
- `getEvents(id, after = 0, wait = 0)` returns events with `seq > after`, in order. With `wait`
  (seconds, at most 55) it holds the call until there is at least one, and returns `[]` on
  timeout. An agent keeps a cursor: call, process, set the cursor to the last `seq`. Nothing is
  missed or seen twice.

## 2. Reviewing a change

Agents mostly want a human to look at what they changed. `patch` is a unified diff (`git diff`
output) of the change that produced `files`:

```ts
createReview({
  open: "PLAN.md",
  files: { "PLAN.md": plan, "docs/design.md": design, "src/a.ts": newA },
  patch: gitDiff,
});
```

- Dynotator derives the state before the change by applying the patch in reverse to `files`, and
  stores it as **version 0**. Files the patch creates are absent from it; files it deletes exist
  only in it, rebuilt from the patch's removed lines; a rename is a delete plus an add. Every file
  the patch touches, other than deletions, must be in `files`.
- Paths in `files` that the patch does not mention are **context**: identical in version 0, so
  not changes. A plan and its docs ride along with a code change without showing up as added.
- If the patch does not apply cleanly in reverse, `createReview` fails naming the file and hunk.
  Dynotator never guesses. Binary patches and mode-only changes are rejected with a clear message.
- With a patch, the page opens on the changes: the changed-files list, then each file's diff. The
  file tree and full files are one click away. Without one, the page opens on `open`.
- After a revision the reviewer can diff the current version against version 0 or any earlier
  version.
- Diff lines can be annotated. The annotation has a `side`: `"new"` (added or unchanged lines,
  numbered in the current version) or `"old"` (removed lines, numbered in the version compared
  against).
- Diffs are line-based and dependency-free. No word-level diff, no side-by-side view.

`revise` takes files only: the base is fixed when the review is created. A patch without its
files is not supported: it cannot be rendered in context or annotated reliably.

## 3. Annotations

```ts
interface Annotation {
  id: string;
  /** "" for a comment on the review as a whole. */
  path: string;
  type: "comment" | "replacement" | "answer";
  /** 1-based, inclusive. Absent for a comment on the whole review. */
  lines?: { start: number; end: number };
  /** Present when made in a diff. Default "new". */
  side?: "old" | "new";
  /** The exact text selected. */
  original?: string;
  /** `comment`: the comment. `replacement`: the proposed text ("" proposes deleting). */
  text?: string;
  /** `answer`: the question's key and the answer given. */
  answer?: { key: string; value: string };
}
```

Three types. A deletion is a replacement with empty text; a general comment is a comment with no
path. The server stores annotations as sent and checks only that each is an object with a string
`id` and `path`, that there are at most 2,000, and that the body is at most 2 MB. The page may
keep extra private fields for repainting highlights; agents ignore unknown fields.

## 4. Who reviewed

When the deployment is behind Cloudflare Access, the host Worker takes the reviewer's email from
the platform (`ctx.access`, never from a client-supplied header) and reviewer events carry it as
`by`. Without Access, `by` is absent. There is no self-declared name. The Worker still holds no
secrets and checks no tokens.

## 5. The browser's API

All under `/s/:id/api`.

| Route                      | Answer                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /review`              | `{ title?, open, version, versions: [{ version, timestamp }], base: boolean, closed: boolean }`                                         |
| `GET /revision`            | `{ revision, seq }`: the current version and the last event's `seq`. One poll covers new versions, other tabs' submissions and closure. |
| `GET /events?after=N`      | `{ events: ReviewEvent[] }`                                                                                                             |
| `GET /files?v=N`           | `{ files: [{ path, size }] }`                                                                                                           |
| `GET /file?path=P&v=N`     | `{ path, content }`                                                                                                                     |
| `GET /changes?from=A&to=B` | `{ files: [{ path, status: "added" \| "modified" \| "deleted" }] }`                                                                     |
| `POST /feedback`           | body `{ feedback, annotations, revision }` → `{ ok: true, seq }`                                                                        |
| `POST /approve`            | body `{ feedback?, annotations?, revision }` → `{ ok: true, seq }`                                                                      |
| `GET /draft`               | `{ annotations: Annotation[] }`: the unsent annotations saved for the current version (`[]` if none)                                    |
| `POST /draft`              | body `{ annotations }` → `{ ok: true }`. Last write wins.                                                                               |

`base` is true when the review was created with a patch; then version 0 can be read through
`/files`, `/file` and `/changes` like any version. It never appears in `versions`.

Errors: 409 `{ code: "revised", revision }`, 409 `{ code: "closed" }`, 404 unknown path or
version, 400 invalid input.

Drafts are a convenience, not a source of truth: one blob per version, last write wins, no
generations or tombstones. The page shows as editable whatever is in the draft and not in the
log, so a draft that still holds sent annotations is harmless.

Page behaviour: after a submission, a brief confirmation, then back to the document. Sent
annotations (those in the log) stay highlighted and listed under "Sent", read-only. The header shows whether the
current version is approved, when, and by whom if known. A closed review shows a banner and no
actions. Other tabs' and reviewers' events appear without a reload.

## 6. Deliberately not here

Each of these was asked for or drafted. They are out so the API stays small; each has a clear way
back in if a real case appears.

- **Modes.** "Plan" versus "annotate" only changed which buttons the reviewer saw. Two actions for
  everyone, four event types, and the agent decides what it needs.
- **A separate base tree.** `patch` covers it with less work for the agent. Version 0 already
  exists internally, so a `base` input is a small addition later.
- **Pulling files from a source, bigger limits.** With a patch an agent sends the files it
  touched plus its plan, which is small. A snapshot is bounded by the 32 MiB RPC message: 5,000
  files, 1 MiB each, 20 MiB in total. Raise this with a pull API when someone actually hits it.
- **Binary files and images.** Files are text.
- **Reviewer image uploads, export, in-place editing.** Feedback is text an agent acts on; a
  proposed replacement gives the agent `path`, `lines`, `original` and `text` to apply exactly,
  which is a better contract than an edited file.
- **Reading live from a container.** A review is of a fixed version and must outlive where it
  came from.

## 7. Migration

Breaking, with no shims: `getDecision`, `waitForDecision`, `mode`, `/api/deny`, `/api/exit`,
`/api/plan*`, `DELETE /api/draft`, `draftGeneration` and the `already_decided` code are deleted.
