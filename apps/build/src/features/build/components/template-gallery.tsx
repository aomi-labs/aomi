"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutTemplate, X } from "lucide-react";

import type { BuildTemplate } from "@/features/build/contracts";
import { FEATURED_TEMPLATE_IDS } from "@/features/build/templates";
import { cn } from "@/lib/class-names";

type TemplateGalleryProps = {
  templates: BuildTemplate[];
  onSelect: (template: BuildTemplate) => void;
};

function TemplateCard({
  template,
  onSelect,
  dense,
}: {
  template: BuildTemplate;
  onSelect: (template: BuildTemplate) => void;
  dense?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="panel-row hover:border-border-hover hover:bg-accent-hover/40 text-left transition-colors"
    >
      <p
        className={cn(
          "text-foreground font-medium",
          dense ? "text-[12px]" : "text-[13px]",
        )}
      >
        {template.name}
      </p>
      <p
        className={cn(
          "text-subtle mt-0.5 line-clamp-2 leading-4",
          dense ? "text-[10px]" : "text-[11px]",
        )}
      >
        {template.description}
      </p>
    </button>
  );
}

export function TemplateGallery({ templates, onSelect }: TemplateGalleryProps) {
  const [browseOpen, setBrowseOpen] = useState(false);

  const { featured, rest } = useMemo(() => {
    const featuredList: BuildTemplate[] = [];
    for (const id of FEATURED_TEMPLATE_IDS) {
      const match = templates.find((t) => t.id === id);
      if (match) featuredList.push(match);
    }
    while (featuredList.length < 3 && featuredList.length < templates.length) {
      const next = templates.find((t) => !featuredList.includes(t));
      if (!next) break;
      featuredList.push(next);
    }
    const featuredIds = new Set(featuredList.map((t) => t.id));
    return {
      featured: featuredList,
      rest: templates.filter((t) => !featuredIds.has(t.id)),
    };
  }, [templates]);

  useEffect(() => {
    if (!browseOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrowseOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browseOpen]);

  const handleSelect = (template: BuildTemplate) => {
    setBrowseOpen(false);
    onSelect(template);
  };

  return (
    <div className="mt-5 w-full">
      <div className="text-subtle mb-2.5 flex items-center gap-2 text-[12px] font-medium">
        <LayoutTemplate className="text-dim size-3.5" />
        Start from a template
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {featured.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {rest.length > 0 ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setBrowseOpen(true)}
            className="text-dim hover:text-foreground inline-flex items-center gap-1 px-1 text-[11px] transition-colors"
          >
            Browse all ({templates.length})
          </button>
        </div>
      ) : null}

      {browseOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--aomi-overlay)]"
            aria-label="Close templates"
            onClick={() => setBrowseOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All templates"
            className="border-border bg-background relative flex h-full w-full max-w-md flex-col border-l shadow-lg sm:max-w-lg"
          >
            <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <p className="text-foreground text-[13px] font-medium">
                  All templates
                </p>
                <p className="text-dim text-[11px]">
                  Pick one to seed the composer
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBrowseOpen(false)}
                className="text-dim hover:text-foreground inline-flex size-8 items-center justify-center rounded-md"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={handleSelect}
                    dense
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
