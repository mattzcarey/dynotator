import { describe, expect, test } from "vite-plus/test";
import { diffLines, diffPlans, foldUnchanged } from "./diff";

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
