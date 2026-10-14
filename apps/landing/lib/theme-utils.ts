/**
 * Theme utility functions for the playground configurator.
 *
 * Converts preset data to inline style objects (for live preview)
 * and generates exportable CSS strings (for the code panel).
 */

import { hexToOklch } from "./color-convert";
import type { ThemeColors, ThemePreset } from "./theme-presets";
import { THEME_COLOR_KEYS } from "./theme-presets";

// ---------------------------------------------------------------------------
// Inline style object (for React `style` prop on preview container)
// ---------------------------------------------------------------------------

/**
 * Merge a preset's color map with optional overrides, then return
 * a flat `Record<string, string>` mapping `"--background"` → value
 * suitable for React's `style` prop.
 *
 * Values are kept as hex (the browser resolves them fine) so the
 * live preview doesn't need a conversion step.
 */
export function themeToStyleObject(
  colors: ThemeColors,
  overrides?: Partial<ThemeColors>,
  radius?: string,
): Record<string, string> {
  const merged = { ...colors, ...overrides };
  const style: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) {
    style[`--${key}`] = merged[key];
  }
  if (radius !== undefined) {
    style["--radius"] = radius;
    // Tailwind v4 resolves @theme inline tokens at build time, so the
    // computed --radius-* values won't update from an inline --radius
    // override alone. We must also set the derived tokens explicitly.
    style["--radius-sm"] = `calc(${radius} - 4px)`;
    style["--radius-md"] = `calc(${radius} - 2px)`;
    style["--radius-lg"] = radius;
    style["--radius-xl"] = `calc(${radius} + 4px)`;
    style["--radius-2xl"] = `calc(${radius} + 8px)`;
    style["--radius-3xl"] = `calc(${radius} + 14px)`;
    style["--radius-4xl"] = `calc(${radius} + 20px)`;
  }
  return style;
}

// ---------------------------------------------------------------------------
// CSS generation (for the code export panel)
// ---------------------------------------------------------------------------

function formatOklch(hex: string): string {
  // If the value is already oklch (e.g. from a text override), pass through.
  if (hex.startsWith("oklch(")) return hex;
  return hexToOklch(hex);
}

/**
 * Generate a complete CSS string for a theme, matching the structure of
 * `@aomi-labs/widget/themes/default.css`.
 */
export function generateThemeCSS(
  preset: ThemePreset,
  overrides?: {
    light?: Partial<ThemeColors>;
    dark?: Partial<ThemeColors>;
    radius?: string;
  },
): string {
  const lightColors = { ...preset.light, ...overrides?.light };
  const darkColors = { ...preset.dark, ...overrides?.dark };
  const radius = overrides?.radius ?? preset.radius;

  const indent = "  ";
  const formatBlock = (colors: ThemeColors) =>
    THEME_COLOR_KEYS
      .map((key) => `${indent}--${key}: ${formatOklch(colors[key])};`)
      .join("\n");

  return `/* Custom Theme: ${preset.label} */
/* Drop this into your globals.css (after importing @aomi-labs/widget/styles.css) */

:root {
  --radius: ${radius};
${formatBlock(lightColors)}
}

.dark {
${formatBlock(darkColors)}
}`;
}
