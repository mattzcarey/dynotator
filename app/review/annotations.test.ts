import { describe, expect, test } from "vite-plus/test";
import {
  fromWire,
  globalComment,
  isDeletion,
  isGeneral,
  toWire,
  type Annotation,
} from "./annotations";

const meta = { parentTagName: "P", parentIndex: 2, textOffset: 5 };

describe("toWire: the spec's Annotation, private fields under ui", () => {
  test("a comment in a rendered file keeps its positions privately", () => {
    const a: Annotation = {
      id: "a1",
      path: "PLAN.md",
      type: "comment",
      lines: { start: 3, end: 4 },
      original: "roll out",
      text: "Slower.",
      blockId: "block-2",
      startMeta: meta,
      endMeta: { ...meta, textOffset: 13 },
    };
    expect(toWire(a)).toEqual({
      id: "a1",
      path: "PLAN.md",
      type: "comment",
      lines: { start: 3, end: 4 },
      original: "roll out",
      text: "Slower.",
      ui: { blockId: "block-2", startMeta: meta, endMeta: { ...meta, textOffset: 13 } },
    });
  });

  test("a replacement on a removed diff line carries side, and the compared version privately", () => {
    const wire = toWire({
      id: "r1",
      path: "src/a.ts",
      type: "replacement",
      lines: { start: 12, end: 12 },
      side: "old",
      original: "x = 1",
      text: "x = 2",
      col: 4,
      against: 0,
    });
    expect(wire).toEqual({
      id: "r1",
      path: "src/a.ts",
      type: "replacement",
      lines: { start: 12, end: 12 },
      side: "old",
      original: "x = 1",
      against: 0,
      text: "x = 2",
      ui: { col: 4 },
    });
  });

  test("a deletion is a replacement with empty text; new-side diff notes say so", () => {
    const wire = toWire({
      id: "d1",
      path: "a.ts",
      type: "replacement",
      lines: { start: 1, end: 2 },
      side: "new",
      original: "a\nb",
      text: "",
    });
    expect(wire).toEqual({
      id: "d1",
      path: "a.ts",
      type: "replacement",
      lines: { start: 1, end: 2 },
      side: "new",
      original: "a\nb",
      text: "",
    });
    expect(isDeletion(wire)).toBe(true);
    expect(isDeletion({ type: "replacement", text: "y" })).toBe(false);
  });

  test("a general comment has no path and no lines", () => {
    const g = globalComment("Fine overall.");
    expect(toWire(g)).toEqual({ id: g.id, path: "", type: "comment", text: "Fine overall." });
    expect(isGeneral(g)).toBe(true);
  });

  test("an answer carries key and value, the full answer privately", () => {
    const questionAnswer = {
      key: "q-0123abcd",
      kind: "single" as const,
      prompt: "Store?",
      selected: ["Redis"],
    };
    const wire = toWire({
      id: "question-q-0123abcd@PLAN.md#ab",
      path: "PLAN.md",
      type: "answer",
      lines: { start: 9, end: 14 },
      answer: { key: "q-0123abcd", value: "Redis" },
      blockId: "block-7",
      questionAnswer,
    });
    expect(wire).toEqual({
      id: "question-q-0123abcd@PLAN.md#ab",
      path: "PLAN.md",
      type: "answer",
      lines: { start: 9, end: 14 },
      answer: { key: "q-0123abcd", value: "Redis" },
      ui: { blockId: "block-7", questionAnswer },
    });
    expect(fromWire(wire)).toMatchObject({ questionAnswer: { selected: ["Redis"] } });
  });
});

describe("fromWire", () => {
  test("round-trips what toWire writes", () => {
    const a: Annotation = {
      id: "x",
      path: "a.ts",
      type: "comment",
      lines: { start: 2, end: 2 },
      side: "old",
      original: "o",
      text: "t",
      col: 0,
      against: 1,
    };
    expect(fromWire(JSON.parse(JSON.stringify(toWire(a))))).toEqual(a);
  });

  test("drops what this page did not write, and unknown fields", () => {
    expect(fromWire({ id: 1, path: "a" })).toBeNull();
    expect(fromWire({ id: "a", path: "a", type: "deletion" })).toBeNull();
    expect(fromWire({ id: "a", path: "a", type: "answer" })).toBeNull();
    expect(fromWire({ id: "a", path: "", type: "comment", text: "t", extra: 1 })).toEqual({
      id: "a",
      path: "",
      type: "comment",
      text: "t",
    });
    expect(
      fromWire({ id: "a", path: "a", type: "comment", lines: { start: 3, end: 1 }, side: "x" }),
    ).toEqual({ id: "a", path: "a", type: "comment" });
  });
});
