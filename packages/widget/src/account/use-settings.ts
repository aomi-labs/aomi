"use client";

import { useShellTransport } from "../transport";
import { useState, useEffect, useCallback } from "react";

const SETTINGS_STORAGE_KEY = "aomi_settings";

export type ColorMode = "light" | "dark" | "auto";

export interface Settings {
  incognitoMode: boolean;
  colorMode: ColorMode;
  chatFont: string;
  notifications: boolean;
  fullName: string;
  preferredName: string;
  workFunction: string;
  personalPreferences: string;
}

const defaultSettings: Settings = {
  incognitoMode: false,
  colorMode: "auto",
  chatFont: "default",
  notifications: true,
  fullName: "",
  preferredName: "",
  workFunction: "",
  personalPreferences: "",
};

export function useSettings() {
  const { themeRoot, embedded } = useShellTransport();
  const [settings, setSettingsState] = useState<Settings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSettingsState({ ...defaultSettings, ...parsed });
        }
      } catch (error) {
        console.error("Failed to load settings from localStorage", error);
      }
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        setSettingsState({
          ...defaultSettings,
          ...(raw ? JSON.parse(raw) : {}),
        });
      } catch {
        /* Storage may be unavailable. */
      }
    };
    window.addEventListener("aomi-settings-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("aomi-settings-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Apply theme based on colorMode
  useEffect(() => {
    if (typeof window === "undefined" || isLoading) return;

    const root = themeRoot ?? (embedded ? null : document.documentElement);
    if (!root) return;
    const applyTheme = () => {
      if (settings.colorMode === "auto") {
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        root.classList.toggle("dark", prefersDark);
      } else {
        root.classList.toggle("dark", settings.colorMode === "dark");
      }
    };

    applyTheme();

    if (settings.colorMode === "auto") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme();
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [settings.colorMode, isLoading, themeRoot, embedded]);

  // Persist settings to localStorage
  const persistSettings = useCallback((newSettings: Settings) => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
        setSettingsState(newSettings);
        window.dispatchEvent(new Event("aomi-settings-changed"));
      } catch (error) {
        console.error("Failed to save settings to localStorage", error);
      }
    }
  }, []);

  // Update a specific setting
  const updateSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const newSettings = { ...settings, [key]: value };
      persistSettings(newSettings);
    },
    [settings, persistSettings],
  );

  // Update multiple settings at once
  const updateSettings = useCallback(
    (updates: Partial<Settings>) => {
      const newSettings = { ...settings, ...updates };
      persistSettings(newSettings);
    },
    [settings, persistSettings],
  );

  // Reset to default settings
  const resetSettings = useCallback(() => {
    persistSettings(defaultSettings);
  }, [persistSettings]);

  return {
    settings,
    updateSetting,
    updateSettings,
    resetSettings,
    isLoading,
  };
}
