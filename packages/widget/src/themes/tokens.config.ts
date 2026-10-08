export type ThemeMetadata = {
  /** File name without extension, e.g. `default` */
  id: string;
  /** Human friendly name to show in docs or CLIs. */
  label: string;
  /** Short marketing blurb for selection menus. */
  description: string;
  /** Relative CSS path emitted to `dist/`. */
  cssPath: string;
  /** Preview colors so docs can render swatches. */
  preview: {
    background: string;
    foreground: string;
  };
  /** Whether this theme should be copied to `dist/styles.css`. */
  isDefault?: boolean;
};

export const themes: ThemeMetadata[] = [
  {
    id: "default",
    label: "Default",
    description:
      "Neutral finance-friendly palette with soft gradients and AppKit-friendly overrides.",
    cssPath: "./themes/default.css",
    preview: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.21 0.006 285.885)",
    },
    isDefault: true,
  },
];

export const DEFAULT_THEME =
  themes.find((theme) => theme.isDefault) ?? themes[0];

export function getTheme(id: string): ThemeMetadata | undefined {
  return themes.find((theme) => theme.id === id);
}
