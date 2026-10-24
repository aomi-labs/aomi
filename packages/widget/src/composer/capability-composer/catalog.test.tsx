import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AomiAppDescriptor } from "@aomi-labs/client";

const fixture = vi.hoisted(() => ({
  model: "openai:gpt-6.1-sol",
  apps: [] as AomiAppDescriptor[],
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useControl: () => ({
    state: { appDescriptors: fixture.apps, availableModels: ["openai:gpt-6.1-sol"] },
    getCurrentThreadControl: () => ({ model: fixture.model, modelMode: "manual" }),
  }),
}));
vi.mock("./provider", () => ({ useCapabilityComposer: () => ({ allowAppMentions: true }) }));
vi.mock("@/wallet/network-preferences", () => ({ useOptionalAomiWalletNetworkPreferences: () => null }));
vi.mock("@/composer/capabilities/skill-catalog", () => ({ useSkillCatalog: () => ({ skills: [] }) }));
import { useCapabilityCatalog } from "./catalog";

beforeEach(() => {
  fixture.model = "openai:gpt-6.1-sol";
  fixture.apps = [{ name: "partner", applicationId: 42, metadata: { fundedModelOnly: true, sponsoredModelIds: ["openai:gpt-6.1-sol"] } }];
});
it("disables a funded-only app after a model switch and restores the matching choice", () => {
  const view = renderHook(useCapabilityCatalog);
  expect(view.result.current.find((item) => item.kind === "app")?.disabled).toBe(false);
  fixture.model = "anthropic:claude-sonnet-5-5";
  view.rerender();
  expect(view.result.current.find((item) => item.kind === "app")?.disabled).toBe(true);
  fixture.model = "openai:gpt-6.1-sol";
  view.rerender();
  expect(view.result.current.find((item) => item.kind === "app")?.disabled).toBe(false);
});
it("allows a user-funded mismatch but treats missing sponsorship metadata as unknown", () => {
  fixture.apps = [
    { name: "paid", metadata: { fundedModelOnly: false, sponsoredModelIds: [] } },
    { name: "loading" },
  ];
  const { result } = renderHook(useCapabilityCatalog);
  expect(result.current.find((item) => item.appName === "paid")?.disabled).toBe(false);
  expect(result.current.find((item) => item.appName === "loading")?.disabled).toBe(true);
});
