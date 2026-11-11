// Bounds every browser body, a submission with up to 2,000 annotations included.
const MAX_JSON_BODY_BYTES = 2_000_000;

/**
 * The reviewer's verified email, set by the host Worker on requests it forwards (worker/identity.ts)
 * after removing any copy the client sent.
 */
export const REVIEWER_HEADER = "x-dynotator-reviewer";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra fields for the JSON error body, e.g. a `code` the browser switches on. */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

/** Reads a JSON object body, refusing oversize bodies before parsing. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? "0") > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "Request body too large");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "Request body too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}
