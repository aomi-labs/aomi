import { describe, expect, it } from "vitest";

import { environmentCard } from "./environment-card";

const slots = (names: string[]) =>
  names.map((name) => ({ name }) as unknown as { name: string });

const base = {
  apps: [] as string[],
  requiredSecrets: null,
  requiredSecretsError: null,
  secretsByApp: {} as Record<string, string[]>,
  secretsError: null,
};

describe("environmentCard", () => {
  it("does not warn when the project declares no required keys", () => {
    const card = environmentCard({
      ...base,
      apps: ["somm-agent"],
      requiredSecrets: {
        "somm-agent": { applicationId: 11, slots: [], missing: [] },
      },
    });

    expect(card).toMatchObject({ value: "No keys required", tone: "good" });
    expect(card.blocked).toBe(false);
  });

  it("does not warn for a source with no apps at all", () => {
    const card = environmentCard(base);

    expect(card).toMatchObject({ value: "No apps yet", tone: "neutral" });
    expect(card.hint).toBe(
      "Deploy an app before configuring its environment keys.",
    );
    expect(card.blocked).toBe(false);
  });

  it("names the app and the keys when required keys are unset", () => {
    const card = environmentCard({
      ...base,
      apps: ["somm-agent"],
      requiredSecrets: {
        "somm-agent": {
          applicationId: 11,
          slots: slots(["OPENAI_API_KEY", "ALCHEMY_API_KEY"]),
          missing: ["OPENAI_API_KEY", "ALCHEMY_API_KEY"],
        },
      },
    });

    expect(card).toMatchObject({
      value: "Keys missing",
      tone: "warn",
      blocked: true,
    });
    expect(card.hint).toBe(
      "2 required keys not set for somm-agent: OPENAI_API_KEY and ALCHEMY_API_KEY. Set them in Environment before deploying.",
    );
  });

  it("elides a long list of missing keys but keeps the count", () => {
    const missing = ["A_KEY", "B_KEY", "C_KEY", "D_KEY", "E_KEY", "F_KEY"];
    const card = environmentCard({
      ...base,
      apps: ["agent"],
      requiredSecrets: {
        agent: { applicationId: 11, slots: slots(missing), missing },
      },
    });

    expect(card.hint).toBe(
      "6 required keys not set for agent: A_KEY, B_KEY, C_KEY, D_KEY and 2 more. Set them in Environment before deploying.",
    );
  });

  it("covers every app that is short a key", () => {
    const card = environmentCard({
      ...base,
      apps: ["one", "two"],
      requiredSecrets: {
        one: {
          applicationId: 11,
          slots: slots(["A_KEY"]),
          missing: ["A_KEY"],
        },
        two: { slots: slots(["B_KEY"]), missing: ["B_KEY"] },
      },
    });

    expect(card.hint).toBe(
      "2 required keys not set for one and two: A_KEY and B_KEY. Set them in Environment before deploying.",
    );
  });

  it("treats a satisfied requirement as set, not missing", () => {
    const card = environmentCard({
      ...base,
      apps: ["somm-agent"],
      requiredSecrets: {
        "somm-agent": {
          applicationId: 11,
          slots: slots(["OPENAI_API_KEY"]),
          missing: [],
        },
      },
      secretsByApp: { "somm-agent": ["OPENAI_API_KEY"] },
    });

    expect(card).toMatchObject({ value: "1 key set", tone: "good" });
    expect(card.blocked).toBe(false);
  });

  it("gates on apps the check named but the source snapshot predates", () => {
    const card = environmentCard({
      ...base,
      apps: ["fresh-agent"],
      requiredSecrets: {
        "fresh-agent": {
          applicationId: 12,
          slots: slots(["NEW_KEY"]),
          missing: ["NEW_KEY"],
        },
      },
    });

    expect(card.blocked).toBe(true);
  });

  it("reports a failed read as unavailable rather than missing", () => {
    const card = environmentCard({
      ...base,
      apps: ["somm-agent"],
      requiredSecretsError: "Backend unreachable.",
    });

    expect(card).toMatchObject({ value: "Unavailable", tone: "warn" });
    expect(card.hint).toContain("Backend unreachable.");
    // Nothing is known to be missing, so this must not read as a key fault.
    expect(card.blocked).toBe(false);
  });

  it("waits for the requirements before judging an app", () => {
    const card = environmentCard({ ...base, apps: ["somm-agent"] });

    expect(card).toMatchObject({ value: "Loading…", tone: "neutral" });
    expect(card.blocked).toBe(false);
  });

  it("waits for the configured keys too", () => {
    const card = environmentCard({
      ...base,
      apps: ["somm-agent"],
      requiredSecrets: {
        "somm-agent": { applicationId: 11, slots: [], missing: [] },
      },
      secretsByApp: null,
    });

    expect(card).toMatchObject({ value: "Loading…", tone: "neutral" });
  });
});
