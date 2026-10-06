"use client";

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { cn } from "@aomi-labs/react";
import { Button, Card, CardContent } from "@aomi-labs/widget-lib";
import { CopyButton } from "./CopyButton";

type PreviewProps = {
  title: string;
  description?: string;
  code: string;
  lang?: string;
  children: ReactNode;
  badge?: string;
};

export function Preview({
  title,
  description,
  code,
  lang = "tsx",
  children,
  badge,
}: PreviewProps) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [highlighted, setHighlighted] = useState<string | null>(null);

  useEffect(() => {
    import("shiki").then(({ codeToHtml }) =>
      codeToHtml(code, { lang, theme: "catppuccin-mocha" }).then(
        setHighlighted,
      ),
    );
  }, [code, lang]);

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {badge ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={view === "preview" ? "default" : "ghost"}
            onClick={() => setView("preview")}
          >
            Preview
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "code" ? "default" : "ghost"}
            onClick={() => setView("code")}
          >
            Code
          </Button>
          <CopyButton value={code} label="Copy code" />
        </div>
      </div>
      <CardContent className="p-0">
        {view === "preview" ? (
          <div className="relative overflow-hidden rounded-b-2xl bg-muted/30 px-5 py-6">
            <div className={cn("relative", badge ? "pt-1" : undefined)}>
              {children}
            </div>
          </div>
        ) : highlighted ? (
          <div
            className="not-fumadocs-codeblock overflow-auto rounded-b-2xl text-sm [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!rounded-b-2xl [&_pre]:!border-0 [&_pre]:px-5 [&_pre]:py-4 [&_code]:!bg-transparent [&_code]:!border-0 [&_code]:!p-0"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <pre className="rounded-b-2xl bg-[#18181b] px-5 py-4 font-mono text-sm leading-relaxed text-[#d4d4d8]">
            <code className="whitespace-pre-wrap bg-transparent text-inherit p-0">
              {code}
            </code>
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
