import { describe, expect, test } from "vite-plus/test";
import { REVIEWER_HEADER } from "../session/http";
import { asReviewer, reviewerEmail } from "./identity";

const access = (identity: Record<string, unknown> | undefined) => ({
  access: { aud: "app", getIdentity: async () => identity },
});

describe("reviewerEmail", () => {
  test("is the email Access verified", async () => {
    expect(await reviewerEmail(access({ email: "ada@example.com", name: "Ada" }))).toBe(
      "ada@example.com",
    );
  });

  test.each([
    ["no Access", {}],
    ["Access without an identity (a WARP client)", access(undefined)],
    ["an identity without an email", access({ name: "Ada" })],
    ["an email that is not a string", access({ email: 5 })],
    ["an empty email", access({ email: "" })],
  ])("is absent with %s", async (_, ctx) => {
    expect(await reviewerEmail(ctx)).toBeUndefined();
  });
});

const spoofed = () =>
  new Request("https://host/s/x/api/feedback", {
    method: "POST",
    headers: { [REVIEWER_HEADER]: "mallory@example.com", "content-type": "application/json" },
    body: '{"feedback":"hi"}',
  });

describe("asReviewer", () => {
  const url = new URL("https://host/api/feedback");
  test("drops a reviewer header the client sent when there is no identity", async () => {
    const forwarded = asReviewer(spoofed(), url, undefined);
    expect(forwarded.headers.has(REVIEWER_HEADER)).toBe(false);
    expect(forwarded.url).toBe(url.href);
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe('{"feedback":"hi"}');
  });

  test("replaces it with the verified email", () => {
    const forwarded = asReviewer(spoofed(), url, "ada@example.com");
    expect(forwarded.headers.get(REVIEWER_HEADER)).toBe("ada@example.com");
    expect(forwarded.headers.get("content-type")).toBe("application/json");
  });
});
