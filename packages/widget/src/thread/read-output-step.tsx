"use client";

import type { FC } from "react";
import type { ToolCallMessagePart } from "@assistant-ui/react";
import {
  BookOpenIcon,
  CopyIcon,
  LayersIcon,
  TriangleAlertIcon,
} from "lucide-react";

import type {
  InterpretedToolStep,
  ToolChip,
} from "@/thread/tool-interpreter/interpret";
import {
  coreToolTitle,
  toolIdentity,
} from "@/thread/tool-interpreter/identity";
import { ToolStepRow } from "./working-trace-rows";

/** The host tool that pages through a tool output it shortened for the model. */
export const READ_OUTPUT_TOOL = "read_tool_output";

export const isReadOutputTool = (toolName: string): boolean =>
  toolIdentity(toolName) === READ_OUTPUT_TOOL;

type Json = Record<string, unknown>;

const record = (value: unknown): Json | null => {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readArgs = (part: ToolCallMessagePart): Json =>
  record(part.args) ?? record(part.argsText) ?? {};

/** The saved-output id a read names: in its args once they stream in, else in its result. */
export const readOutputId = (part: ToolCallMessagePart): string | undefined =>
  str(readArgs(part).id) ?? str(record(part.result)?.id);

/** One answered page, in the shape `read_tool_output` returns. */
type Page = {
  pointer?: string;
  grep?: string;
  error?: string;
  hint?: string;
  offset: number;
  next?: number;
  eof: boolean;
  /** Characters (text) or items (list) in the view being paged. */
  total?: number;
  unit: "chars" | "items" | "value";
  slice: unknown;
};

const toPage = (part: ToolCallMessagePart): Page | null => {
  const result = record(part.result);
  if (!result) return null;
  const args = readArgs(part);
  const totalChars = num(result.total_chars);
  return {
    pointer: str(result.pointer) ?? str(args.pointer),
    grep: str(args.grep),
    error: str(result.error),
    hint: str(result.hint),
    offset: num(result.offset) ?? 0,
    next: num(result.next_offset),
    eof: result.eof === true,
    total: totalChars ?? num(result.total),
    unit:
      totalChars !== undefined
        ? "chars"
        : Array.isArray(result.slice)
          ? "items"
          : "value",
    slice: result.slice,
  };
};

const viewOf = (page: Page) => `${page.pointer ?? ""}\u0000${page.grep ?? ""}`;

/** "71k", "6k", "820" */
const compact = (count: number): string =>
  count >= 1_000 ? `${Math.round(count / 1_000)}k` : String(count);

const ERRORS: Record<string, string> = {
  expired: "Output expired",
  pointer_not_found: "Path not found",
  not_json: "Not JSON",
  truncated_at_intake: "Text only",
  unavailable: "Unavailable",
};

/** Union of the [offset, end) spans the pages covered. */
const covered = (pages: Page[]): number => {
  const spans = pages
    .map(
      (page) => [page.offset, page.next ?? page.total ?? page.offset] as const,
    )
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = 0;
  for (const [from, to] of spans) {
    const start = Math.max(from, reach);
    if (to > start) total += to - start;
    reach = Math.max(reach, to);
  }
  return total;
};

const coverageChip = (pages: Page[]): ToolChip | null => {
  const last = pages[pages.length - 1];
  if (last.unit === "value")
    return { label: "Value", icon: LayersIcon, essential: true };
  const total = last.total ?? 0;
  const read = covered(pages);
  const all = read >= total;
  if (last.unit === "chars") {
    return {
      label: all
        ? `All ${compact(total)} chars`
        : `${Math.min(99, Math.round((read / Math.max(total, 1)) * 100))}% of ${compact(total)} chars`,
      icon: LayersIcon,
      essential: true,
    };
  }
  if (total === 0)
    return { label: "No matches", icon: LayersIcon, essential: true };
  const first = Math.min(...pages.map((page) => page.offset));
  const end = Math.max(...pages.map((page) => page.next ?? total));
  return {
    label: all ? `All ${total} items` : `Items ${first + 1}–${end} of ${total}`,
    icon: LayersIcon,
    essential: true,
  };
};

const sourceLabel = (tool: string | undefined): string | undefined => {
  if (!tool) return undefined;
  const title = coreToolTitle(tool) ?? toolIdentity(tool).replace(/_/g, " ");
  return title.charAt(0).toLowerCase() + title.slice(1);
};

export const interpretReadOutput = (
  parts: readonly ToolCallMessagePart[],
  sourceTool?: string,
): InterpretedToolStep => {
  const pages = parts.map(toPage).filter((page): page is Page => page !== null);
  const answered = pages.filter((page) => !page.error);
  const source = sourceLabel(sourceTool);
  const lastArgs = readArgs(parts[parts.length - 1]);
  const searching = Boolean(str(lastArgs.grep));
  const title = `${searching ? "Searched" : "Read"} ${source ? `${source} output` : "saved tool output"}`;

  // Every page failed: say why instead of pretending something was read.
  if (pages.length > 0 && answered.length === 0) {
    const error = pages[pages.length - 1].error ?? "";
    return {
      icon: BookOpenIcon,
      title,
      chips: [
        {
          label: ERRORS[error] ?? error.replace(/_/g, " "),
          icon: TriangleAlertIcon,
          essential: true,
        },
      ],
      confidence: "high",
      rawLabel: READ_OUTPUT_TOOL,
      failed: true,
    };
  }

  const chips: ToolChip[] = [];
  const latest = answered[answered.length - 1];
  if (latest) {
    const view = answered.filter((page) => viewOf(page) === viewOf(latest));
    const coverage = coverageChip(view);
    if (coverage) chips.push(coverage);
  }
  if (parts.length > 1) {
    chips.push({ label: `${parts.length} reads`, icon: CopyIcon });
  }
  return {
    icon: BookOpenIcon,
    title,
    chips,
    confidence: "high",
    rawLabel: READ_OUTPUT_TOOL,
    failed: false,
  };
};

/**
 * Re-indents JSON text that may be cut off mid-way, as a partial page is.
 * Only structure outside strings is touched, so a cut never corrupts values.
 */
const indentJson = (text: string): string => {
  let out = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => `\n${"  ".repeat(Math.max(0, depth))}`;
  for (const c of text) {
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      depth += 1;
      out += c + newline();
    } else if (c === "}" || c === "]") {
      depth -= 1;
      out += newline() + c;
    } else if (c === ",") {
      out += c + newline();
    } else if (c === ":") {
      out += ": ";
    } else if (!/\s/.test(c)) {
      out += c;
    }
  }
  return out;
};

const pretty = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return /^\s*[[{]/.test(text) ? indentJson(text) : text;
  }
};

/** Pages of one view stitched back together, in offset order. */
const stitch = (pages: Page[]): string => {
  const sorted = [...pages].sort((a, b) => a.offset - b.offset);
  if (sorted[0].unit === "items") {
    const items = new Map<number, unknown>();
    for (const page of sorted) {
      for (const entry of page.slice as unknown[]) {
        const item = record(entry);
        if (item && typeof item.index === "number")
          items.set(item.index, item.item);
      }
    }
    return JSON.stringify([...items.values()], null, 2);
  }
  if (sorted[0].unit === "value")
    return JSON.stringify(sorted[0].slice, null, 2);
  let text = "";
  let reach = sorted[0].offset;
  for (const page of sorted) {
    // Offsets count code points, as the host does, not UTF-16 units.
    const chars = Array.from(typeof page.slice === "string" ? page.slice : "");
    if (page.offset > reach) text += "\n…\n";
    text += chars.slice(Math.max(0, reach - page.offset)).join("");
    reach = Math.max(reach, page.offset + chars.length);
  }
  // JSON reads far better re-indented than as one long line, even cut off.
  return sorted[0].offset === 0 ? pretty(text) : text;
};

/** What the model actually read, rather than the paging envelopes around it. */
export const readOutputDetail = (
  parts: readonly ToolCallMessagePart[],
): string | undefined => {
  const pages = parts.map(toPage).filter((page): page is Page => page !== null);
  if (pages.length === 0) return undefined;
  const views = new Map<string, Page[]>();
  for (const page of pages) {
    if (page.error) continue;
    const key = viewOf(page);
    views.set(key, [...(views.get(key) ?? []), page]);
  }
  if (views.size === 0) {
    const last = pages[pages.length - 1];
    return last.hint ?? ERRORS[last.error ?? ""] ?? last.error;
  }
  return [...views.values()]
    .map((view) => {
      const { pointer, grep } = view[0];
      const label = [pointer, grep && `matching “${grep}”`]
        .filter(Boolean)
        .join(" · ");
      const body = stitch(view);
      return views.size > 1 && label ? `${label}\n${body}` : body;
    })
    .join("\n\n");
};

/**
 * Consecutive `read_tool_output` calls on one saved output, folded into a
 * single row named after the tool that produced the output.
 */
export const ReadOutputRow: FC<{
  parts: readonly ToolCallMessagePart[];
  sourceTool?: string;
  stepKey: string;
  active: boolean;
  animate: boolean;
  live: boolean;
}> = ({ parts, sourceTool, stepKey, active, animate, live }) => {
  const done = parts.every((part) => part.result !== undefined);
  return (
    <ToolStepRow
      viewKey={stepKey}
      interpretation={interpretReadOutput(parts, sourceTool)}
      detailText={readOutputDetail(parts)}
      done={done}
      active={active}
      animate={animate}
      animateUpdates={live}
    />
  );
};
