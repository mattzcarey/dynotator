export const MAX_MARKDOWN_BYTES = 1_000_000;
export const MAX_JSON_BODY_BYTES = 4_000_000;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads a JSON object body, refusing anything over `maxBytes` before parsing.
 * An empty body reads as `{}` (upstream's decision routes accept a bare POST).
 */
export async function readJsonObject(
  req: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "Request body too large");
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "Request body too large");
  }
  if (!text.trim()) return {};
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

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
