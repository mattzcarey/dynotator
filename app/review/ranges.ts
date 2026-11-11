/** The text node and offset at character `offset` of `el`'s text, or null past its end. */
export function point(el: Node, offset: number): [Node, number] | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (offset < seen + length) return [node, offset - seen];
    seen += length;
    last = node;
  }
  if (offset === seen) return last ? [last, last.textContent?.length ?? 0] : [el, 0];
  return null;
}

/** A range from character `start` of `from`'s text to character `end` of `to`'s. */
export function textRange(from: Node, start: number, end: number, to: Node = from): Range | null {
  const a = point(from, start);
  const b = point(to, end);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(...a);
  range.setEnd(...b);
  return range;
}

/** Where a range boundary falls in `el`'s text: 0 before it, its length after it. */
export function offsetIn(el: Node, node: Node, offset: number): number {
  const all = document.createRange();
  all.selectNodeContents(el);
  const side = all.comparePoint(node, offset);
  if (side < 0) return 0;
  if (side > 0) return el.textContent?.length ?? 0;
  all.setEnd(node, offset);
  return all.toString().length;
}

/** The first occurrence of `text` in `el`, as a range. */
export function findText(el: Node, text: string | undefined): Range | null {
  if (!text) return null;
  const at = (el.textContent ?? "").indexOf(text);
  return at === -1 ? null : textRange(el, at, at + text.length);
}
