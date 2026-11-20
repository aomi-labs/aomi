import { render } from "@testing-library/react";
import { AppWindowIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

const hints = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@assistant-ui/react", () => ({
  useMessage: (select: (state: unknown) => unknown) =>
    select({ metadata: { custom: { aomiCapabilityHints: hints.value } } }),
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useControl: () => ({ state: { agentCards: [] } }),
}));
vi.mock("@/composer/capability-composer/catalog", async (original) => ({
  ...(await original<
    typeof import("@/composer/capability-composer/catalog")
  >()),
  usePackagePickerItems: () => [],
}));
vi.mock("@/wallet/network-preferences", () => ({
  useOptionalAomiWalletNetworkPreferences: () => null,
}));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({ wallets: [] }),
}));

import {
  CapabilityMessageText,
  splitCapabilityText,
} from "./capability-message-text";

describe("splitCapabilityText", () => {
  it("replaces the exact routed capability token without changing surrounding copy", () => {
    const capability = {
      kind: "agent" as const,
      id: "agent:aomi/default",
      label: "Basic",
      token: "▦ Basic",
      Icon: AppWindowIcon,
    };

    expect(
      splitCapabilityText("Ask ▦ Basic to check Base", [capability]),
    ).toEqual([
      { type: "text", text: "Ask " },
      { type: "capability", capability },
      { type: "text", text: " to check Base" },
    ]);
  });

  it("leaves ordinary message text untouched", () => {
    expect(splitCapabilityText("Ask Basic to check Base", [])).toEqual([
      { type: "text", text: "Ask Basic to check Base" },
    ]);
  });
});

it("shows selected agents alongside inline packages without duplicating existing agent mentions", () => {
  const agent = {
    kind: "agent" as const,
    id: "agent:2937773",
    label: "Cambrian",
    token: "▦ Cambrian",
    Icon: AppWindowIcon,
  };
  const pkg = {
    kind: "package" as const,
    id: "aomi/across",
    label: "Across",
    token: "▣ Across",
    Icon: AppWindowIcon,
  };
  const segments = splitCapabilityText(
    "▣ Across now what can you do?",
    [agent, pkg],
    [agent, pkg],
  );
  expect(
    segments
      .filter((s) => s.type === "capability")
      .map((s) => s.type === "capability" && s.capability.label),
  ).toEqual(["Cambrian", "Across"]);
  expect(
    splitCapabilityText("▦ Cambrian hello", [agent], [agent]).filter(
      (s) => s.type === "capability",
    ),
  ).toHaveLength(1);
  expect(splitCapabilityText("hello", [agent], [])).toEqual([
    { type: "text", text: "hello" },
  ]);
});

it("old_skill_mention_renders_as_package", () => {
  // A message saved before skills folded into packages: "✦ Aave" in the text,
  // and the history hint line read back as a package id.
  hints.value = [{ kind: "package", id: "aave" }];
  const props = {
    type: "text",
    text: "✦ Aave supply 5 USDC",
    status: { type: "complete" },
  } as unknown as ComponentProps<typeof CapabilityMessageText>;
  const { container } = render(<CapabilityMessageText {...props} />);
  const chip = container.querySelector(".text-aomi-accent");
  expect(chip?.textContent).toBe("Aave");
  expect(chip?.querySelector("svg")).not.toBeNull();
  expect(container.textContent).toBe("Aave supply 5 USDC");
});
