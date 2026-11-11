import { REVIEWER_HEADER } from "../session/http";

/** The part of `ctx.access` (Cloudflare Access, as the platform reports it) this Worker reads. */
interface AccessContext {
  access?: { getIdentity(): Promise<{ email?: unknown } | undefined> };
}

/** The reviewer's verified email, or `undefined` when Access did not authenticate the request. */
export async function reviewerEmail(ctx: AccessContext): Promise<string | undefined> {
  const email = (await ctx.access?.getIdentity())?.email;
  return typeof email === "string" && email !== "" ? email : undefined;
}

/**
 * `request` as forwarded to a review's server: any reviewer header the client sent is dropped,
 * and only the platform's verified email is set.
 */
export function asReviewer(request: Request, url: URL, email: string | undefined): Request {
  const forwarded = new Request(url, request);
  forwarded.headers.delete(REVIEWER_HEADER);
  if (email !== undefined) forwarded.headers.set(REVIEWER_HEADER, email);
  return forwarded;
}
