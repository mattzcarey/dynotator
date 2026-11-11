# Spec: fluid reviews, change review, sources, identity

This is the contract for the next shape of Dynotator. It replaces the single-decision model with
an event log, adds reviewing a change against a base, lets Dynotator pull files instead of
receiving one message, and records who reviewed. It also answers the feature requests that came
from agent teams using Dynotator, including the ones we are not doing.

Everything here is normative: names, shapes and status codes are the contract between `worker/`,
`session/` and `app/`.

## 1. A review is a conversation, not a verdict

Today a review ends when the reviewer approves or closes, the reviewer cannot add anything after
submitting, and only the latest decision exists. That is upstream's one-shot model with a longer
lease. The new model:

- A review stays open until the **agent** closes it or it expires. Nothing the reviewer does is
  terminal.
- Everything that happens is appended to an **event log**. Nothing is overwritten.
- The reviewer can submit as often as they like. After sending, the page goes back to the
  document; what they sent stays visible as sent, and they can add more.
- The agent can revise at any time, including after an approval. A new version needs a new
  approval.

### Events

```ts
interface ReviewEvent {
  /** 1-based, gapless, increasing. The agent's cursor. */
  seq: number;
  type: "approved" | "changes_requested" | "feedback" | "dismissed" | "revised" | "closed";
  /** The version the event is about. For `revised`, the new version. */
  version: number;
  /** ISO 8601. */
  at: string;
  /** The reviewer's verified email, when the deployment is behind Cloudflare Access. */
  by?: string;
  /** Reviewer events: the feedback as markdown for an agent to act on. */
  feedback?: string;
  /** `changes_requested` only: the reviewer answered the questions and said nothing else. */
  answersOnly?: true;
  /** Reviewer events: the annotations in this submission, structured (section 3). */
  annotations?: Annotation[];
}
```

| Type                | Who      | Mode     | Meaning                                                              |
| ------------------- | -------- | -------- | -------------------------------------------------------------------- |
| `approved`          | reviewer | plan     | Approves `version`. May carry notes in `feedback` and `annotations`. |
| `changes_requested` | reviewer | plan     | Wants changes to `version`.                                          |
| `feedback`          | reviewer | annotate | Sends feedback on `version`.                                         |
| `dismissed`         | reviewer | annotate | "Nothing from me" on `version`. No feedback.                         |
| `revised`           | agent    | both     | `revise` put up `version`.                                           |
| `closed`            | agent    | both     | `close` ended the review. Always the last event.                     |

Rules:

- A reviewer event is accepted only for the current version (stale: 409 `revised`) and only while
  the review is open (closed: 409 `closed`). There is no "already decided": a second submission
  is another event.
- Each submission carries only the annotations made since the reviewer's previous submission on
  that version. Events are deltas; the log is the whole.
- Approval is a fact about a version. The current version is approved if its latest
  `approved` / `changes_requested` event is `approved`. A later `changes_requested` withdraws it;
  an agent that keeps listening sees that. `revise` does not need to clear anything: the new
  version simply has no approval yet.
- `revise` with an identical snapshot appends nothing and returns `unchanged: true`.
- `close` is idempotent. After it, `revise` and reviewer events are refused; reads keep working
  until expiry.

### RPC (`Dynotator` entrypoint)

```ts
createReview(init: ReviewInit): Promise<Review>;            // { id, url }
revise(id: string, content: Content): Promise<Revision>;    // { version, unchanged }
getEvents(id: string, after?: number): Promise<ReviewEvent[]>;
waitForEvents(id: string, after: number, seconds?: number): Promise<ReviewEvent[]>;
close(id: string): Promise<void>;
```

- `getEvents(id, after = 0)` returns events with `seq > after`, in order.
- `waitForEvents` returns as soon as there is at least one such event, or `[]` after `seconds`
  (default 25, at most 55). An agent loop is: keep `cursor`, call, process, set `cursor` to the
  last `seq`. Nothing is missed or seen twice across restarts.
- `getDecision` and `waitForDecision` are removed. No shims.

### Browser API changes

- `GET /api/events?after=N` → `{ events: ReviewEvent[] }`. The page paints sent annotations and
  the review's state from it.
- `GET /api/review` gains `closed: boolean` and `base: boolean` (section 2).
- `POST /api/approve`, `/api/deny`, `/api/feedback`, `/api/exit` keep their paths and bodies and
  now answer `{ ok: true, seq }`. Every reviewer body except `exit` carries `annotations` (the
  delta) as well as `feedback`, in both modes. 409 codes: `revised` (with `revision`), `closed`.
  `already_decided` is gone.
- `GET /api/revision` → `{ revision, seq }` where `seq` is the last event's, so one poll tells the
  page about new versions, other tabs' submissions and closure.
- Drafts are unchanged in shape; a successful submission clears the draft of what was sent.

### Browser behaviour

- After a submission the page shows a brief confirmation and returns to the document. Sent
  annotations stay highlighted and listed under a "Sent" heading, read-only, per version. New
  annotations go in a new draft. The primary action is always available while the review is open.
- The header shows the state of the current version: nothing, "Approved" or "Changes requested",
  with the time and, if known, who.
- When the review is closed: a banner, no actions, everything readable.
- Another tab's or reviewer's events appear without a reload.

## 2. Reviewing a change

The request was code review: a diff UI. It is right. Agents mostly want a human to look at what
they changed, and Dynotator already stores versions and diffs them; what was missing is a starting
point and the ability to comment on a diff.

- `ReviewInit.base?: Content` is the state the change is against. It is stored as **version 0**.
  `GET /api/review` says `base: true`; `/api/files?v=0`, `/api/file?...&v=0` and
  `/api/changes?from=0&to=N` work like any version. Version 0 never appears in `versions`.
- An agent can send only the files it touched: `files` holds their new contents, `base` their old
  contents (a file absent from `base` is added; a file only in `base` is deleted). Or it can send
  whole trees. Dynotator does not care.
- With a base, the page opens on the **changes**: the changed-files list, then each file's diff
  against the base. The file tree and full-file views remain one click away. Without a base,
  nothing changes from today.
- After a revision the reviewer can diff against the base or against any earlier version.
- **Annotating a diff**: selecting lines in a diff makes an annotation with a `side`: `"new"`
  (added or unchanged lines, numbered in the current version) or `"old"` (removed lines, numbered
  in the version compared against). Feedback text names it (`Line 12 (removed)`).
- Diffs stay line-based and dependency-free. No word-level diff, no side-by-side view, no syntax
  colouring inside diffs.

`createReview` with a `git diff` string is not supported and will not be: a patch without the
files cannot be rendered in context or annotated by line reliably. Send the files.

## 3. Annotations are structured, always

```ts
interface Annotation {
  id: string;
  /** "" for a general comment. */
  path: string;
  type: "comment" | "deletion" | "replacement" | "general" | "answer";
  /** 1-based, inclusive. Absent for general comments. */
  lines?: { start: number; end: number };
  /** Present when made in a diff. Default "new". */
  side?: "old" | "new";
  /** The exact text selected. */
  original?: string;
  /** `comment`, `general`: the comment. `replacement`: the proposed text. */
  text?: string;
  /** `answer`: the question key and the answer. */
  answer?: { key: string; value: string };
}
```

The server stores annotations as sent and does not interpret them beyond checking each is an
object with a string `id` and `path`, the array is bounded (2,000) and the body is bounded (2 MB).
The browser may keep extra private fields for repainting highlights; agents must ignore unknown
fields.

This is the answer to **in-place editing**: we are not shipping an editor. A reviewer who wants
different text selects it and proposes a replacement; the agent receives `path`, `lines`,
`original` and the replacement `text`, which it can apply exactly. That is a better contract for
an agent than a silently edited file, and it costs no editor dependency.

## 4. Getting content in

The complaint: content must be a text snapshot in one RPC message (20 MiB, 5,000 files) instead of
being read from where the agent's files are.

Half right. The snapshot is deliberate and stays: a review is of a fixed version, and it must
outlive the container or workspace it came from. What is wrong is forcing it through one message
and making the agent read everything itself. So content can be **pushed or pulled**:

```ts
type Files = Record<string, string | Uint8Array>;

/** An RPC target the caller passes; Dynotator calls it during the request, then drops it. */
interface FileSource {
  /** Every file path, repo-relative. */
  list(): Promise<string[]>;
  /** One file's contents. */
  read(path: string): Promise<string | Uint8Array>;
}

type Content = { files: Files } | { source: FileSource };

type ReviewInit = Content & {
  mode: "plan" | "annotate";
  title?: string;
  /** The path shown first. */
  open?: string;
  base?: Content;
};
```

- `{ files }` is today's push, for small content. It is bounded by the 32 MiB RPC message.
- `{ source }` is a pull: Dynotator lists, then reads files in bounded batches and writes them
  into the review's Workspace as it goes. The source is used only during the `createReview` or
  `revise` call; nothing is retained.
- `dynotator/source` exports `workspaceSource(workspace, { root?, ignore? })`, which wraps a
  `@cloudflare/computer` `Workspace` (or anything with the same `fs`) as a `FileSource`, so an
  agent with a Workspace does `createReview({ mode, source: workspaceSource(this.workspace, {
  root: "/workspace/repo" }) })`. Default ignores: `.git`, `node_modules`, and files over the
  per-file limit are reported, not silently dropped (the call fails naming them unless they match
  `ignore`).
- A version is committed only when every file has been written; a failed pull leaves no version.
- Limits with a source are those of storage, not of a message. They are set by measurement and
  documented in `session/files.ts` (target: 20,000 files and 200 MiB per version; 5 MiB per
  file).

**Binary files** are accepted (`Uint8Array`). `/api/files` marks them `binary: true`.
`GET /api/raw?path=P&v=N` serves bytes for images only (png, jpeg, gif, webp, avif, svg; type
decided from the bytes, never from the name; `Content-Security-Policy: sandbox`, `nosniff`).
The page shows images as images, including relative images in markdown, and other binary files as
a one-line placeholder. `/api/file` answers 415 for a binary file.

Reading live from a container is not supported and will not be: a review that changes under the
reviewer, or dies with the container, is not a review.

## 5. Who reviewed

Decisions did not say who decided. They now can, without Dynotator authenticating anyone.

- When the deployment is behind Cloudflare Access, the host Worker takes the reviewer's identity
  from the platform (`ctx.access`, not from a client-supplied header) and passes the email to the
  review's server on each reviewer request. Events carry it as `by`.
- Without Access there is no identity and `by` is absent. There is no self-declared name: an
  unverified name in an audit field is worse than none.
- The Worker still holds no secrets and checks no tokens.

## 6. Not doing

- **Reviewer image uploads.** Feedback is text an agent acts on. Screenshots matter for visual
  review, but that needs storage, serving and a way to hand binaries to agents, and no agent team
  has shown a flow that needs it. Revisit with a concrete case.
- **Export.** The agent already receives the feedback as markdown and as structure in every
  event; the embedding product owns what to do with it.
- **In-place editing.** See section 3.
- **Live container reads, patch-only reviews.** See sections 4 and 2.

## 7. Migration

This is a breaking change to the RPC surface and the browser API. There are no deployed consumers
to keep working, so there are no compatibility shims: old names are deleted.
