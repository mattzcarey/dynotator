import { describe, expect, test } from "bun:test";
import { parseWaitSeconds } from "./decision";
import { parseSessionInit } from "./plan";
import { sniffImageType } from "./uploads";

describe("parseSessionInit", () => {
  test("accepts the CLI's plan and annotate bodies", () => {
    expect(
      parseSessionInit({
        mode: "plan",
        markdown: "# p",
        origin: "claude-code",
        permissionMode: "default",
        project: "demo",
      }),
    ).toEqual({
      mode: "plan",
      markdown: "# p",
      origin: "claude-code",
      permissionMode: "default",
      project: "demo",
    });
    expect(
      parseSessionInit({ mode: "annotate", markdown: "", filePath: "a.md", title: null }),
    ).toEqual({ mode: "annotate", markdown: "", filePath: "a.md" });
  });

  test("rejects bad modes, non-string markdown, oversize input and stray types", () => {
    expect(() => parseSessionInit({ mode: "review", markdown: "x" })).toThrow();
    expect(() => parseSessionInit({ mode: "plan" })).toThrow();
    expect(() => parseSessionInit({ mode: "plan", markdown: "é".repeat(500_001) })).toThrow(
      /exceeds/,
    );
    expect(() => parseSessionInit({ mode: "plan", markdown: "x", title: 5 })).toThrow();
  });
});

test("parseWaitSeconds defaults to 25 and caps at 55", () => {
  expect(parseWaitSeconds(null)).toBe(25);
  expect(parseWaitSeconds("abc")).toBe(25);
  expect(parseWaitSeconds("-1")).toBe(25);
  expect(parseWaitSeconds("0")).toBe(0);
  expect(parseWaitSeconds("10")).toBe(10);
  expect(parseWaitSeconds("600")).toBe(55);
});

const b = (...xs: number[]) => new Uint8Array(xs);
const s = (text: string) => new TextEncoder().encode(text);

test("sniffImageType reads signatures, not names", () => {
  expect(sniffImageType(b(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  expect(sniffImageType(s("GIF89a...."))).toBe("image/gif");
  expect(sniffImageType(s("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  expect(sniffImageType(s("\0\0\0\x1cftypavif"))).toBe("image/avif");
  expect(sniffImageType(s('  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
  expect(sniffImageType(s('<?xml version="1.0"?><svg/>'))).toBe("image/svg+xml");
  expect(sniffImageType(s("<html><svg/></html>"))).toBeNull();
  expect(sniffImageType(s("%PDF-1.7"))).toBeNull();
});
