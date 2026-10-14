"use client";

import { useState, useMemo, useCallback, useEffect, type FC } from "react";
import dynamic from "next/dynamic";
import { CopyButton } from "./copy-button";
import { Segmented, ToggleChip } from "./controls";
import { ThemeCustomizer, useThemeCustomizer } from "./theme-customizer";
import { ChevronDown, ChevronUp } from "lucide-react";

const AomiFramePreview = dynamic(
  () => import("./aomi-frame-preview").then((mod) => mod.AomiFramePreview),
  { ssr: false },
);

// =============================================================================
// Types
// =============================================================================

type ConfigTab = "layout" | "theme";
type CodeTab = "jsx" | "css";
type WalletPosition = "header" | "footer" | "hidden";
type ControlPlacement = "header" | "composer";

type PlaygroundState = {
  sidebarShown: boolean;
  walletPosition: WalletPosition;
  controlPlacement: ControlPlacement;
  showModel: boolean;
  showSafety: boolean;
  showApiKey: boolean;
  showWallet: boolean;
  showNetwork: boolean;
};

const DEFAULT_STATE: PlaygroundState = {
  sidebarShown: true,
  walletPosition: "footer",
  controlPlacement: "header",
  showModel: true,
  showSafety: true,
  showApiKey: false,
  showWallet: false,
  showNetwork: true,
};

// =============================================================================
// Code generation
// =============================================================================

function generateCode(s: PlaygroundState): string {
  const walletProp =
    s.walletPosition === "hidden" ? "null" : `"${s.walletPosition}"`;

  const hasAnyControl =
    s.showModel ||
    s.showSafety ||
    s.showApiKey ||
    s.showWallet ||
    s.showNetwork;

  const controlBarEntries: string[] = [];
  if (!s.showNetwork) controlBarEntries.push("hideNetwork: true");
  if (!s.showModel) controlBarEntries.push("hideModel: true");
  if (!s.showSafety) controlBarEntries.push("hideSafety: true");
  if (!s.showApiKey) controlBarEntries.push("hideApiKey: true");
  if (s.showWallet) controlBarEntries.push("hideWallet: false");

  const controlBarPropsStr =
    controlBarEntries.length > 0
      ? ` controlBarProps={{ ${controlBarEntries.join(", ")} }}`
      : "";

  const rootProps: string[] = ['height="560px"'];
  if (!s.sidebarShown) {
    rootProps.push("showSidebar={false}");
    rootProps.push("walletPosition={null}");
  } else if (s.walletPosition !== "footer") {
    rootProps.push(`walletPosition={${walletProp}}`);
  }

  const headerWithControl = hasAnyControl && s.controlPlacement === "header";
  const composerWithControl =
    hasAnyControl && s.controlPlacement === "composer";

  const sidebarTriggerStr = !s.sidebarShown
    ? " showSidebarTrigger={false}"
    : "";

  let headerLine: string;
  if (headerWithControl) {
    headerLine = `  <AomiFrame.Header${sidebarTriggerStr} withControl${controlBarPropsStr} />`;
  } else {
    headerLine = `  <AomiFrame.Header${sidebarTriggerStr} />`;
  }

  let composerLine: string;
  if (composerWithControl) {
    composerLine = `  <AomiFrame.Composer withControl${controlBarPropsStr} />`;
  } else {
    composerLine = "  <AomiFrame.Composer />";
  }

  return [
    `<AomiFrame.Root ${rootProps.join(" ")}>`,
    headerLine,
    composerLine,
    "</AomiFrame.Root>",
  ].join("\n");
}

// =============================================================================
// Sub-components
// =============================================================================

type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
};

const Checkbox: FC<CheckboxProps> = ({ label, checked, onChange }) => (
  <ToggleChip label={label} checked={checked} onChange={onChange} />
);

/** Tab switcher for the config sidebar & code panel — same segmented recipe. */
const TabBar: FC<{
  tabs: { value: string; label: string }[];
  active: string;
  onChange: (v: string) => void;
}> = ({ tabs, active, onChange }) => (
  <Segmented options={tabs} value={active} onChange={onChange} />
);

// =============================================================================
// Layout config panel (original controls)
// =============================================================================

const LayoutPanel: FC<{
  state: PlaygroundState;
  update: (patch: Partial<PlaygroundState>) => void;
}> = ({ state, update }) => (
  <div className="space-y-5">
    {/* ── Sidebar ── */}
    <fieldset className="space-y-3">
      <legend className="text-fd-muted-foreground text-xs font-semibold tracking-wider uppercase">
        Sidebar
      </legend>
      <Checkbox
        label="Shown"
        checked={state.sidebarShown}
        onChange={(v) => update({ sidebarShown: v })}
      />
      {state.sidebarShown && (
        <div className="space-y-1.5">
          <span className="text-fd-muted-foreground/70 text-[10px] font-medium tracking-wider uppercase">
            Wallet Position
          </span>
          <Segmented
            options={[
              { value: "header", label: "Header" },
              { value: "footer", label: "Footer" },
              { value: "hidden", label: "Hidden" },
            ]}
            value={state.walletPosition}
            onChange={(v) => update({ walletPosition: v as WalletPosition })}
          />
        </div>
      )}
    </fieldset>

    {/* ── Control Panel ── */}
    <fieldset className="space-y-3">
      <legend className="text-fd-muted-foreground text-xs font-semibold tracking-wider uppercase">
        Control Panel
      </legend>
      <Segmented
        options={[
          { value: "header", label: "Header" },
          { value: "composer", label: "Composer" },
        ]}
        value={state.controlPlacement}
        onChange={(v) => update({ controlPlacement: v as ControlPlacement })}
      />
      <div className="flex flex-wrap gap-1.5">
        <Checkbox
          label="Model"
          checked={state.showModel}
          onChange={(v) => update({ showModel: v })}
        />
        <Checkbox
          label="Safety"
          checked={state.showSafety}
          onChange={(v) => update({ showSafety: v })}
        />
        <Checkbox
          label="API Key"
          checked={state.showApiKey}
          onChange={(v) => update({ showApiKey: v })}
        />
        <Checkbox
          label="Wallet"
          checked={state.showWallet}
          onChange={(v) => update({ showWallet: v })}
        />
        <Checkbox
          label="Network"
          checked={state.showNetwork}
          onChange={(v) => update({ showNetwork: v })}
        />
      </div>
    </fieldset>
  </div>
);

// =============================================================================
// Main Playground
// =============================================================================

export function PlaygroundConfigurator({
  forceEmbed,
}: {
  forceEmbed?: boolean;
}) {
  const [state, setState] = useState<PlaygroundState>(DEFAULT_STATE);
  const [configTab, setConfigTab] = useState<ConfigTab>("layout");
  const [codeTab, setCodeTab] = useState<CodeTab>("jsx");
  const [isEmbedded, setIsEmbedded] = useState(forceEmbed ?? false);
  const [codeExpanded, setCodeExpanded] = useState(!(forceEmbed ?? false));
  const backendUrl = "/";

  useEffect(() => {
    if (forceEmbed) {
      setIsEmbedded(true);
      setCodeExpanded(false);
      return;
    }
    const detected =
      typeof window !== "undefined" && window.top !== window.self;
    if (detected) {
      setIsEmbedded(true);
      setCodeExpanded(false);
    }
  }, [forceEmbed]);

  const update = useCallback((patch: Partial<PlaygroundState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const jsxCode = useMemo(() => generateCode(state), [state]);

  // Theme customizer state
  const theme = useThemeCustomizer();

  const walletPropValue =
    !state.sidebarShown || state.walletPosition === "hidden"
      ? undefined
      : state.walletPosition;

  const controlBarProps = useMemo(
    () => ({
      hideNetwork: !state.showNetwork,
      hideModel: !state.showModel,
      hideSafety: !state.showSafety,
      hideApiKey: !state.showApiKey,
      hideWallet: !state.showWallet,
    }),
    [state],
  );

  const hasAnyControl =
    state.showModel ||
    state.showSafety ||
    state.showApiKey ||
    state.showWallet ||
    state.showNetwork;

  const activeCode = codeTab === "jsx" ? jsxCode : theme.output.css;

  const embedHeight = isEmbedded ? 400 : 560;

  return (
    <div className={isEmbedded ? "space-y-2" : "space-y-4"}>
      {/* Main split panel */}
      <div
        className={`flex flex-col ${isEmbedded ? "gap-2" : "gap-4"} md:flex-row`}
      >
        {/* Left: Live preview */}
        <div className="min-w-0 flex-1">
          <div
            className={`border-fd-border overflow-hidden rounded-xl border ${
              theme.output.isDark ? "dark" : ""
            }`}
            style={theme.output.styleObject}
          >
            <AomiFramePreview
              backendUrl={backendUrl}
              controlBarProps={controlBarProps}
              controlPlacement={state.controlPlacement}
              embedHeight={embedHeight}
              hasAnyControl={hasAnyControl}
              showSidebar={state.sidebarShown}
              walletPosition={walletPropValue}
            />
          </div>
        </div>

        {/* Right: Config sidebar with tabs */}
        <div
          className="w-full shrink-0 md:w-72"
          style={{ maxHeight: embedHeight }}
        >
          <div className="border-fd-border bg-fd-card flex h-full max-h-[inherit] flex-col rounded-xl border">
            {/* Tab header */}
            <div className="border-fd-border border-b px-4 py-3">
              <TabBar
                tabs={[
                  { value: "layout", label: "Layout" },
                  { value: "theme", label: "Theme" },
                ]}
                active={configTab}
                onChange={(v) => setConfigTab(v as ConfigTab)}
              />
            </div>
            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {configTab === "layout" ? (
                <LayoutPanel state={state} update={update} />
              ) : (
                <ThemeCustomizer
                  state={theme.state}
                  preset={theme.preset}
                  selectPreset={theme.selectPreset}
                  update={theme.update}
                  setColorOverride={theme.setColorOverride}
                  clearColorOverride={theme.clearColorOverride}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Generated code panel with tabs (collapsible when embedded) */}
      <div className="border-fd-border rounded-xl border">
        <div className="border-fd-border flex items-center justify-between border-b px-4 py-2">
          <TabBar
            tabs={[
              { value: "jsx", label: "JSX" },
              { value: "css", label: "Theme CSS" },
            ]}
            active={codeTab}
            onChange={(v) => setCodeTab(v as CodeTab)}
          />
          <div className="flex items-center gap-2">
            <CopyButton value={activeCode} label="Copy" />
            {isEmbedded && (
              <button
                type="button"
                onClick={() => setCodeExpanded((v) => !v)}
                className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
                aria-label={codeExpanded ? "Collapse code" : "Expand code"}
              >
                {codeExpanded ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
            )}
          </div>
        </div>
        {codeExpanded && (
          <pre className="bg-fd-secondary/30 text-fd-foreground overflow-x-auto px-4 py-3 text-xs leading-relaxed">
            <code>{activeCode}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
