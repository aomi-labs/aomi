import { AppWindowIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { splitCapabilityText } from "./capability-message-text";

describe("splitCapabilityText", () => {
  it("replaces the exact routed capability token without changing surrounding copy", () => {
    const capability = {
      kind: "app" as const,
      id: "name:default",
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
