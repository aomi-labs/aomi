"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import {
  readColorTheme,
  saveColorTheme,
  type ColorTheme,
} from "@/lib/color-theme";

export function ColorThemeToggle() {
  const [theme, setTheme] = useState<ColorTheme | null>(null);

  useEffect(() => {
    setTheme(readColorTheme());
  }, []);

  function toggleTheme() {
    const nextTheme = readColorTheme() === "dark" ? "light" : "dark";
    saveColorTheme(nextTheme);
    setTheme(nextTheme);
  }

  const nextTheme = theme === "dark" ? "light" : "dark";
  const label = theme ? `Switch to ${nextTheme} mode` : "Toggle color theme";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="icon-button focus-visible:ring-ring inline-flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:ring-1"
    >
      <Sun className="hidden size-4 dark:block" aria-hidden />
      <Moon className="size-4 dark:hidden" aria-hidden />
    </button>
  );
}
