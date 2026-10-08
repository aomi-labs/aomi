"use client";

import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useState } from "react";

import type { BuildFileNode } from "@/features/build/contracts";
import { cn } from "@/lib/class-names";

function FileTreeNode({
  node,
  depth = 0,
  onFileSelect,
}: {
  node: BuildFileNode;
  depth?: number;
  onFileSelect?: (path: string) => void;
}) {
  const isFolder = node.type === "folder";
  const [open, setOpen] = useState(depth < 2);
  const name = node.path.split("/").pop() ?? node.path;
  const clickable = isFolder || onFileSelect !== undefined;

  return (
    <div>
      <button
        type="button"
        disabled={!clickable}
        onClick={() =>
          isFolder ? setOpen((v) => !v) : onFileSelect?.(node.path)
        }
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] transition-colors",
          clickable ? "hover:bg-accent/40 cursor-pointer" : "cursor-default",
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
        title={node.path}
      >
        {isFolder ? (
          open ? (
            <ChevronDown className="text-dim size-3 shrink-0" />
          ) : (
            <ChevronRight className="text-dim size-3 shrink-0" />
          )
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}
        {isFolder ? (
          <Folder className="text-warning size-3.5 shrink-0" />
        ) : (
          <File className="text-link size-3.5 shrink-0" />
        )}
        <span
          className={cn(
            "truncate",
            isFolder ? "text-foreground" : "text-subtle",
          )}
        >
          {name}
        </span>
      </button>
      {isFolder && open
        ? node.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
            />
          ))
        : null}
    </div>
  );
}

type FileTreePreviewProps = {
  tree: BuildFileNode[];
  className?: string;
  /** When set, files become clickable (source viewer). */
  onFileSelect?: (path: string) => void;
};

export function FileTreePreview({
  tree,
  className,
  onFileSelect,
}: FileTreePreviewProps) {
  if (!tree.length) {
    return (
      <div className={cn("panel-inset p-4 text-center", className)}>
        <p className="text-dim text-[12px]">
          Files appear when generate runs.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("panel-inset overflow-hidden p-2", className)}>
      <p className="text-dim mb-2 px-1.5 text-[11px] font-medium tracking-wide uppercase">
        Generated files
      </p>
      {tree.map((node) => (
        <FileTreeNode key={node.path} node={node} onFileSelect={onFileSelect} />
      ))}
    </div>
  );
}
