import { expect, test } from "vitest";
import { diffPlans } from "./diff";

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
