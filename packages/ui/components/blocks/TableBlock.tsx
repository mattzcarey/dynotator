import React from "react";
import type { Block } from "../../types";
import { InlineMarkdown } from "../InlineMarkdown";

/** Pipe-delimited markdown table content as headers and rows. */
const parseTableContent = (content: string): { headers: string[]; rows: string[][] } => {
  const lines = content.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, "|"));

  const headers = parseRow(lines[0]);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^[|\-:\s]+$/.test(line)) continue; // separator row
    rows.push(parseRow(line));
  }
  return { headers, rows };
};

export const TableBlock: React.FC<{ block: Block }> = ({ block }) => {
  const { headers, rows } = parseTableContent(block.content);

  return (
    <div className="my-5 overflow-x-auto rounded-md border border-border" data-block-id={block.id}>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-0">
            {headers.map((header, i) => (
              <th key={i} className="px-3 py-2 text-left text-[13px] font-medium text-foreground">
                <InlineMarkdown text={header} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="border-b border-border last:border-b-0 hover:bg-surface-0">
              {row.map((cell, cellIdx) => (
                <td key={cellIdx} className="px-3 py-2 text-foreground/85">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
