import { AppWindowIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { splitCapabilityText } from "./capability-message-text";

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

it("shows selected agents alongside inline skills without duplicating existing agent mentions", () => {
  const agent = {
    kind: "agent" as const,
    id: "agent:2937773",
    label: "Cambrian",
    token: "▦ Cambrian",
    Icon: AppWindowIcon,
  };
  const skill = {
    kind: "skill" as const,
    id: "across",
    label: "Across",
    token: "✦ Across",
    Icon: AppWindowIcon,
  };
  const segments = splitCapabilityText(
    "✦ Across now what can you do?",
    [agent, skill],
    [agent, skill],
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
