import { describe, expect, test } from "vite-plus/test";
import {
  diffLines,
  diffPlans,
  diffSelection,
  foldUnchanged,
  lineAt,
  lineStarts,
  locateText,
} from "./diff";

const shape = (oldText: string, newText: string) =>
  diffPlans(oldText, newText).map((e) =>
    e.change === "modified"
      ? `~${e.old.map((b) => b.content).join("+")}>${e.block.content}`
      : `${{ unchanged: "=", added: "+", removed: "-" }[e.change]}${e.block.content}`,
  );

test("unchanged documents", () => {
  expect(shape("# A\n\nB", "# A\n\nB")).toEqual(["=A", "=B"]);
});

test("a replaced run reads as one change, extra new blocks as added", () => {
  expect(
    shape("# A\n\nold one\n\nold two\n\n# Z", "# A\n\nnew one\n\nnew two\n\nnew three\n\n# Z"),
  ).toEqual(["=A", "~old one+old two>new one", "+new two", "+new three", "=Z"]);
});

test("pure insertions and removals", () => {
  expect(shape("a\n\nc", "a\n\nb\n\nc")).toEqual(["=a", "+b", "=c"]);
  expect(shape("a\n\nb\n\nc", "a\n\nc")).toEqual(["=a", "-b", "=c"]);
  expect(shape("", "a")).toEqual(["+a"]);
  expect(shape("a", "")).toEqual(["-a"]);
});

test("moved blocks keep the longest common run", () => {
  expect(shape("a\n\nb\n\nc\n\nd", "b\n\nc\n\nd\n\na")).toEqual(["-a", "=b", "=c", "=d", "+a"]);
});

test("a block's kind is part of its identity", () => {
  expect(shape("- item", "1. item")).toEqual(["~item>item"]);
});

const lines = (oldText: string, newText: string) =>
  diffLines(oldText, newText).map(
    (e) =>
      `${{ unchanged: " ", added: "+", removed: "-" }[e.change]}${e.oldLine ?? "_"}:${e.newLine ?? "_"} ${e.text}`,
  );

describe("diffLines", () => {
  test("a changed line reads as removed then added, with both numberings", () => {
    expect(lines("a\nb\nc\n", "a\nB\nc\n")).toEqual([" 1:1 a", "-2:_ b", "+_:2 B", " 3:3 c"]);
  });

  test("added and deleted files are all one side; a final newline is no line", () => {
    expect(lines("", "x\ny\n")).toEqual(["+_:1 x", "+_:2 y"]);
    expect(lines("x\n", "")).toEqual(["-1:_ x"]);
    expect(lines("", "")).toEqual([]);
    expect(lines("same", "same\n")).toEqual([" 1:1 same"]);
  });

  test("insertions keep the common lines around them", () => {
    expect(lines("a\nc", "a\nb\nc")).toEqual([" 1:1 a", "+_:2 b", " 2:3 c"]);
  });

  test("a middle too large to align reads as replaced, quickly", () => {
    const old = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join("\n");
    const next = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join("\n");
    const started = performance.now();
    const out = diffLines(`head\n${old}\ntail`, `head\n${next}\ntail`);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toHaveLength(6002);
    expect(out[0].change).toBe("unchanged");
    expect(out[1].change).toBe("removed");
    expect(out[3001].change).toBe("added");
    expect(out[6001]).toMatchObject({ change: "unchanged", oldLine: 3002, newLine: 3002 });
  });
});

describe("foldUnchanged", () => {
  const entries = diffLines(
    Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n"),
    Array.from({ length: 20 }, (_, i) => (i === 9 ? "changed" : `l${i + 1}`)).join("\n"),
  );
  const folded = foldUnchanged(entries).map((row) =>
    "hidden" in row ? `[${row.hidden.length}]` : `${row.change[0]}${row.text}`,
  );

  test("three lines of context, the rest folded", () => {
    expect(folded).toEqual([
      "[6]",
      "ul7",
      "ul8",
      "ul9",
      "rl10",
      "achanged",
      "ul11",
      "ul12",
      "ul13",
      "[7]",
    ]);
  });

  test("a fold of two lines or fewer stays open; no changes folds everything", () => {
    expect(
      foldUnchanged(diffLines("a\nb\nc\nd\ne", "a\nb\nX\nd\ne"), 1).some((r) => "hidden" in r),
    ).toBe(false);
    expect(foldUnchanged(diffLines("a\nb\nc\nd", "a\nb\nc\nd"))).toEqual([
      { hidden: diffLines("a\nb\nc\nd", "a\nb\nc\nd") },
    ]);
  });
});

describe("a selection in a line diff", () => {
  const OLD = "keep\nold one\nold two\ntail\n";
  const NEW = "keep\nnew one\ntail\nadded\n";
  const rows = diffLines(OLD, NEW);
  const pick = (from: number, to: number) => rows.slice(from, to + 1);

  test("removed lines alone are the old side, numbered in the compared version", () => {
    // keep, -old one, -old two, +new one, tail, +added
    expect(rows.map((r) => r.change[0])).toEqual(["u", "r", "r", "a", "u", "a"]);
    expect(diffSelection(pick(1, 2), 4, 3)).toEqual({
      side: "old",
      lines: { start: 2, end: 3 },
      original: "one\nold",
      col: 4,
    });
  });

  test("added and unchanged lines are the new side; removed rows in between are left out", () => {
    expect(diffSelection(pick(3, 5), 0, 5)).toEqual({
      side: "new",
      lines: { start: 2, end: 4 },
      original: "new one\ntail\nadded",
      col: 0,
    });
    expect(diffSelection(pick(2, 4), 2, 2)).toEqual({
      side: "new",
      lines: { start: 2, end: 3 },
      original: "new one\nta",
      col: 0,
    });
  });

  test("a selection ending at the start of a row does not take it; empty is nothing", () => {
    expect(diffSelection(pick(0, 1), 0, 0)).toMatchObject({
      side: "new",
      lines: { start: 1, end: 1 },
      original: "keep",
    });
    expect(diffSelection(pick(0, 0), 2, 2)).toBeNull();
  });
});

describe("locating an annotation's text in a side's source", () => {
  const text = "foo foo\nbar\nfoo\n";
  const starts = lineStarts(text);

  test("at its column when it still matches, else the first match within its lines", () => {
    expect(starts).toEqual([0, 8, 12, 16]);
    expect(locateText(text, { lines: { start: 1, end: 1 }, col: 4, original: "foo" })).toEqual([
      4, 7,
    ]);
    expect(locateText(text, { lines: { start: 3, end: 3 }, col: 9, original: "foo" })).toEqual([
      12, 15,
    ]);
    expect(locateText(text, { lines: { start: 2, end: 3 }, original: "bar\nfoo" })).toEqual([
      8, 15,
    ]);
    expect(locateText(text, { lines: { start: 2, end: 2 }, original: "foo" })).toBeNull();
    expect(locateText(text, { lines: { start: 9, end: 9 }, original: "foo" })).toBeNull();
  });

  test("lineAt is the inverse of lineStarts", () => {
    expect(lineAt(starts, 0)).toEqual([1, 0]);
    expect(lineAt(starts, 10)).toEqual([2, 2]);
    expect(lineAt(starts, 12)).toEqual([3, 0]);
  });
});
