import Link from "next/link";
import { cn } from "@aomi-labs/react";

type SidebarNavProps = {
  sections: {
    title: string;
    items: {
      slug: string;
      title: string;
      description: string;
    }[];
  }[];
  currentSlug?: string;
};

export function SidebarNav({ sections, currentSlug }: SidebarNavProps) {
  return (
    <nav className="space-y-6 text-sm">
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          {section.items[0] ? (
            <Link
              href={`/docs/${section.items[0].slug}`}
              className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase transition hover:text-foreground"
            >
              {section.title}
            </Link>
          ) : (
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {section.title}
            </p>
          )}
          <div className="space-y-1">
            {section.items.map((item) => {
              const isActive = item.slug === currentSlug;
              return (
                <Link
                  key={item.slug}
                  href={`/docs/${item.slug}`}
                  className={cn(
                    "block rounded-lg border border-transparent px-3 py-2 transition hover:border-border/80 hover:bg-card",
                    isActive
                      ? "border-primary/60 bg-primary/5 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <div className="text-sm font-semibold">{item.title}</div>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
