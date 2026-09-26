"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import { resourceResultForCall } from "@aomi-labs/client";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import { ResourceResultView } from "./resource-result";
import { Button } from "@/components/ui/button";

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  toolCallId,
  argsText,
  result,
}) => {
  const runtime = useOptionalAomiRuntime();
  const resourceResult = resourceResultForCall(
    runtime?.events ?? [],
    toolCallId,
  );
  const [isCollapsed, setIsCollapsed] = useState(true);
  return (
    <div className="aui-tool-fallback-root mb-4 flex w-full flex-col gap-3 overflow-hidden rounded-2xl border py-3">
      <div className="aui-tool-fallback-header flex items-center gap-2 px-4">
        <CheckIcon className="aui-tool-fallback-icon size-4" />
        <p className="aui-tool-fallback-title flex-grow">
          Used tool: <b>{toolName}</b>
        </p>
        <Button
          className="rounded-xl"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </Button>
      </div>
      {!isCollapsed && (
        <div className="aui-tool-fallback-content bg-muted flex flex-col gap-2 border-t pt-2">
          <div className="aui-tool-fallback-args-root px-4">
            <pre className="aui-tool-fallback-args-value whitespace-pre-wrap">
              {argsText}
            </pre>
          </div>
          {result !== undefined && (
            <div className="aui-tool-fallback-result-root border-t border-dashed px-4 pt-2">
              <p className="aui-tool-fallback-result-header font-semibold">
                Result:
              </p>
              {resourceResult && (
                <ResourceResultView
                  result={resourceResult}
                  toolCallId={toolCallId}
                />
              )}
              <pre className="aui-tool-fallback-result-content whitespace-pre-wrap text-[012px]">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
