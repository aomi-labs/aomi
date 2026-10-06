"use client";

import { useState, useMemo, useCallback, type FC } from "react";
import { hexToOklch, oklchToHex } from "@/lib/color-convert";
import { Segmented } from "./controls";
import {
  THEME_PRESETS,
  EDITABLE_COLOR_KEYS,
  type ThemeColors,
  type ThemePreset,
} from "@/lib/theme-presets";
import { themeToStyleObject, generateThemeCSS } from "@/lib/theme-utils";

// =============================================================================
// Types
// =============================================================================

export type ThemeMode = "light" | "dark";

export type ThemeState = {
  presetId: string;
  mode: ThemeMode;
  radius: string;
  overrides: {
    light: Partial<ThemeColors>;
    dark: Partial<ThemeColors>;
  };
};

export type ThemeOutput = {
  /** Inline CSS variable style object for the preview container */
  styleObject: Record<string, string>;
  /** Whether the preview should have the .dark class */
  isDark: boolean;
  /** Exportable CSS string */
  css: string;
};

export const DEFAULT_THEME_STATE: ThemeState = {
  presetId: "default",
  mode: "light",
  radius: "0.625rem",
  overrides: { light: {}, dark: {} },
};

// =============================================================================
// Hook: useThemeCustomizer
// =============================================================================

export function useThemeCustomizer() {
  const [state, setState] = useState<ThemeState>(DEFAULT_THEME_STATE);

  const preset = useMemo(
    () => THEME_PRESETS.find((p) => p.id === state.presetId) ?? THEME_PRESETS[0],
    [state.presetId],
  );

  const update = useCallback(
    (patch: Partial<ThemeState>) =>
      setState((prev) => ({ ...prev, ...patch })),
    [],
  );

  const selectPreset = useCallback((id: string) => {
    const p = THEME_PRESETS.find((t) => t.id === id);
    if (!p) return;
    setState((prev) => ({
      ...prev,
      presetId: id,
      radius: p.radius,
      overrides: { light: {}, dark: {} },
    }));
  }, []);

  const setColorOverride = useCallback(
    (mode: ThemeMode, key: keyof ThemeColors, value: string) => {
      setState((prev) => ({
        ...prev,
        overrides: {
          ...prev.overrides,
          [mode]: { ...prev.overrides[mode], [key]: value },
        },
      }));
    },
    [],
  );

  const clearColorOverride = useCallback(
    (mode: ThemeMode, key: keyof ThemeColors) => {
      setState((prev) => {
        const next = { ...prev.overrides[mode] };
        delete next[key];
        return { ...prev, overrides: { ...prev.overrides, [mode]: next } };
      });
    },
    [],
  );

  const output = useMemo<ThemeOutput>(() => {
    const colors =
      state.mode === "dark" ? preset.dark : preset.light;
    const overrides = state.overrides[state.mode];
    return {
      styleObject: themeToStyleObject(colors, overrides, state.radius),
      isDark: state.mode === "dark",
      css: generateThemeCSS(preset, {
        light: state.overrides.light,
        dark: state.overrides.dark,
        radius: state.radius,
      }),
    };
  }, [state, preset]);

  return {
    state,
    preset,
    output,
    update,
    selectPreset,
    setColorOverride,
    clearColorOverride,
  };
}

// =============================================================================
// Sub-components
// =============================================================================

type PresetSwatchProps = {
  preset: ThemePreset;
  selected: boolean;
  onSelect: () => void;
};

const PresetSwatch: FC<PresetSwatchProps> = ({ preset, selected, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={`group flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all ${
      selected
        ? "border-fd-primary bg-fd-primary/5 ring-1 ring-fd-primary"
        : "border-fd-border hover:border-fd-primary/40"
    }`}
  >
    <div className="flex gap-0.5">
      <div
        className="size-4 rounded-full border border-black/10"
        style={{ backgroundColor: preset.preview.primary }}
      />
      <div
        className="size-4 rounded-full border border-black/10"
        style={{ backgroundColor: preset.preview.secondary }}
      />
      <div
        className="size-4 rounded-full border border-black/10"
        style={{ backgroundColor: preset.preview.bg }}
      />
    </div>
    <span className="text-[10px] font-medium leading-none text-fd-muted-foreground group-hover:text-fd-foreground">
      {preset.label}
    </span>
  </button>
);

type ColorRowProps = {
  label: string;
  colorKey: keyof ThemeColors;
  baseValue: string;
  override?: string;
  onSet: (hex: string) => void;
  onClear: () => void;
};

const ColorRow: FC<ColorRowProps> = ({
  label,
  baseValue,
  override,
  onSet,
  onClear,
}) => {
  const displayHex = override ?? baseValue;
  // Convert oklch to hex if needed for the color picker
  const pickerHex = displayHex.startsWith("oklch(")
    ? oklchToHex(displayHex)
    : displayHex;

  return (
    <div className="flex items-center gap-2">
      <label className="relative cursor-pointer">
        <input
          type="color"
          value={pickerHex}
          onChange={(e) => onSet(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <div
          className="size-6 rounded border border-fd-border"
          style={{ backgroundColor: displayHex }}
        />
      </label>
      <span className="flex-1 text-xs text-fd-foreground">{label}</span>
      {override && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-fd-muted-foreground hover:text-fd-foreground"
          title="Reset to preset"
        >
          Reset
        </button>
      )}
    </div>
  );
};

// =============================================================================
// Main ThemeCustomizer panel
// =============================================================================

type ThemeCustomizerProps = {
  state: ThemeState;
  preset: ThemePreset;
  selectPreset: (id: string) => void;
  update: (patch: Partial<ThemeState>) => void;
  setColorOverride: (mode: ThemeMode, key: keyof ThemeColors, value: string) => void;
  clearColorOverride: (mode: ThemeMode, key: keyof ThemeColors) => void;
};

export const ThemeCustomizer: FC<ThemeCustomizerProps> = ({
  state,
  selectPreset,
  update,
  setColorOverride,
  clearColorOverride,
}) => {
  const [colorsExpanded, setColorsExpanded] = useState(false);

  const preset = useMemo(
    () => THEME_PRESETS.find((p) => p.id === state.presetId) ?? THEME_PRESETS[0],
    [state.presetId],
  );

  const currentColors = state.mode === "dark" ? preset.dark : preset.light;
  const currentOverrides = state.overrides[state.mode];

  // Parse radius to a number for the slider (rem)
  const radiusNum = parseFloat(state.radius) || 0;

  return (
    <div className="space-y-5">
      {/* ── Presets grid ── */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
          Presets
        </legend>
        <div className="grid grid-cols-2 gap-1.5">
          {THEME_PRESETS.map((p) => (
            <PresetSwatch
              key={p.id}
              preset={p}
              selected={state.presetId === p.id}
              onSelect={() => selectPreset(p.id)}
            />
          ))}
        </div>
      </fieldset>

      {/* ── Mode toggle ── */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
          Preview Mode
        </legend>
        <Segmented
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          value={state.mode}
          onChange={(v) => update({ mode: v as "light" | "dark" })}
        />
      </fieldset>

      {/* ── Radius slider ── */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground">
          Radius
        </legend>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={radiusNum}
            onChange={(e) => update({ radius: `${e.target.value}rem` })}
            className="flex-1 accent-fd-primary"
          />
          <span className="w-14 text-right text-xs tabular-nums text-fd-muted-foreground">
            {state.radius}
          </span>
        </div>
      </fieldset>

      {/* ── Color overrides (collapsible) ── */}
      <fieldset className="space-y-2">
        <button
          type="button"
          onClick={() => setColorsExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-fd-muted-foreground"
        >
          <span>Color Overrides</span>
          <span className="text-[10px]">{colorsExpanded ? "▼" : "▶"}</span>
        </button>
        {colorsExpanded && (
          <div className="space-y-2 pt-1">
            {EDITABLE_COLOR_KEYS.map(({ key, label }) => (
              <ColorRow
                key={key}
                label={label}
                colorKey={key}
                baseValue={currentColors[key]}
                override={currentOverrides[key]}
                onSet={(hex) => setColorOverride(state.mode, key, hex)}
                onClear={() => clearColorOverride(state.mode, key)}
              />
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
};
