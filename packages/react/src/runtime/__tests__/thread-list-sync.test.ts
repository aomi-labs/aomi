import { describe, expect, it } from "vitest";

import {
  initThreadControl,
  type ThreadMetadata,
} from "../../state/thread-store";
import {
  initRemoteThreadControl,
  mergeThreadListMetadata,
} from "../thread-list-sync";

function metadata(
  title: string,
  control: ThreadMetadata["control"] = initThreadControl(),
): ThreadMetadata {
  return {
    title,
    status: "regular",
    lastActiveAt: 1,
    control,
  };
}

describe("mergeThreadListMetadata", () => {
  it("does not invent a Direct app for a remote thread without target data", () => {
    expect(initRemoteThreadControl()).toMatchObject({
      agentMode: "auto",
      app: null,
      applicationId: null,
    });
  });

  it("preserves a Direct target selected while the thread list loads", () => {
    const fetched = new Map([
      ["new-thread", metadata("Credential Validation Check")],
    ]);
    const selectedControl = {
      ...initThreadControl(),
      agentMode: "direct" as const,
      app: "credential-demo",
      applicationId: 16,
      controlDirty: true,
    };
    const latest = new Map([
      ["new-thread", metadata("New Chat", selectedControl)],
    ]);

    const merged = mergeThreadListMetadata(fetched, latest);

    expect(merged.get("new-thread")).toMatchObject({
      title: "Credential Validation Check",
      control: selectedControl,
    });
  });

  it("keeps local threads created after the request started", () => {
    const fetched = new Map([["remote-thread", metadata("Existing chat")]]);
    const latest = new Map([["local-thread", metadata("New Chat")]]);

    const merged = mergeThreadListMetadata(fetched, latest);

    expect([...merged.keys()]).toEqual(["remote-thread", "local-thread"]);
  });
});
