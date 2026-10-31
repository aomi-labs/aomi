import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Teach tailwind-merge the Aomi theme names (themes/default.css): otherwise
 * `cn("rounded-md", "rounded-card")` keeps both and CSS order picks the
 * component default, and `type-*` never replaces a default `text-sm`.
 */
const twMerge = extendTailwindMerge<"aomi-type">({
  extend: {
    theme: {
      radius: ["shell", "card", "control"],
      shadow: ["popover", "modal"],
    },
    classGroups: {
      "aomi-type": [
        {
          type: [
            "title",
            "row",
            "section",
            "control",
            "meta",
            "address",
            "eyebrow",
          ],
        },
      ],
    },
    conflictingClassGroups: {
      "aomi-type": ["font-size", "leading"],
      "font-size": ["aomi-type"],
    },
  },
});

/**
 * Utility function to merge Tailwind CSS classes with conflict resolution.
 * Combines clsx for conditional classes and tailwind-merge for deduplication.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
