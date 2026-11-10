export interface Session {
  id: string;
  url: string;
  apiUrl: string;
}

export interface Decision {
  approved: boolean;
  feedback?: string;
  permissionMode?: string;
  answersOnly?: boolean;
  exit?: boolean;
  [key: string]: unknown;
}

export interface CreateSessionBody {
  mode: "plan" | "annotate";
  markdown: string;
  title?: string;
  origin?: string;
  permissionMode?: string;
  filePath?: string;
  project?: string;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function failure(res: Response, what: string): Promise<HttpError> {
  const text = (await res.text().catch(() => "")).trim().slice(0, 300);
  return new HttpError(res.status, `${what}: HTTP ${res.status}${text ? ` ${text}` : ""}`);
}

export async function createSession(
  baseUrl: string,
  token: string | undefined,
  body: CreateSessionBody,
  fetchImpl: Fetch = fetch,
): Promise<Session> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, "creating the session failed");
  const data = (await res.json()) as Partial<Session>;
  if (typeof data.url !== "string" || typeof data.apiUrl !== "string") {
    throw new Error("creating the session failed: response has no url/apiUrl");
  }
  return { id: String(data.id ?? ""), url: data.url, apiUrl: data.apiUrl.replace(/\/+$/, "") };
}

export async function revise(apiUrl: string, markdown: string, fetchImpl: Fetch = fetch) {
  const res = await fetchImpl(`${apiUrl}/revise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  if (!res.ok) throw await failure(res, "submitting the revision failed");
}

export interface WaitOptions {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutSeconds?: number;
  /** Consecutive transient failures tolerated before giving up. */
  maxFailures?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 408/429/5xx and network errors are retried: a laptop sleeping or a redeploy should not
// cost the reviewer their decision. Other 4xx mean the session is gone or the URL is wrong.
function isTransient(error: unknown): boolean {
  return (
    !(error instanceof HttpError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export async function waitForDecision(
  apiUrl: string,
  options: WaitOptions = {},
): Promise<Decision> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? sleepMs;
  const timeout = options.timeoutSeconds ?? 25;
  const maxFailures = options.maxFailures ?? 20;
  let failures = 0;
  for (;;) {
    try {
      const res = await fetchImpl(`${apiUrl}/wait?timeout=${timeout}`, {
        signal: AbortSignal.timeout((timeout + 20) * 1000),
      });
      if (!res.ok) throw await failure(res, "waiting for the decision failed");
      const data = (await res.json()) as { status?: string; decision?: Decision };
      if (data.status === "decided" && data.decision && typeof data.decision === "object") {
        return { ...data.decision, approved: data.decision.approved === true };
      }
      if (data.status !== "pending") {
        throw new Error(`unexpected wait response: ${JSON.stringify(data).slice(0, 300)}`);
      }
      failures = 0;
    } catch (error) {
      if (!isTransient(error)) throw error;
      failures += 1;
      if (failures > maxFailures) throw error;
      options.onRetry?.(error, failures);
      await sleep(Math.min(1000 * 2 ** (failures - 1), 15_000));
    }
  }
}
