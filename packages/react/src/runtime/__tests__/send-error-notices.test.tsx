import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AgentApiError, type AomiClient } from "@aomi-labs/client";

const showNotification = vi.fn();
const clearPersistedThreadId = vi.fn();
let onSendError: ((threadId: string, error: unknown) => void) | undefined;

vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: { children: unknown }) => children,
  useExternalStoreRuntime: () => ({ thread: { composer: {} } }),
}));

vi.mock("../orchestrator", () => ({
  useRuntimeOrchestrator: (
    _client: unknown,
    options: { onSendError: typeof onSendError },
  ) => {
    onSendError = options.onSendError;
    return {
      sessionManager: { get: () => undefined },
      currentSession: undefined,
      snapshot: { events: [], isSubmitting: false },
      getSession: () => undefined,
      ensureInitialState: async () => {},
      sendMessage: async () => {},
      cancelGeneration: async () => {},
      closeSession: () => {},
      closeAllSessions: () => {},
      aomiClientRef: { current: null },
    };
  },
}));

vi.mock("../thread-persistence", () => ({
  clearPersistedThreadId: (key: string) => clearPersistedThreadId(key),
  writePersistedThreadId: () => {},
}));

vi.mock("../thread-list-sync", () => ({
  useThreadListSync: () => ({
    isThreadListLoading: false,
    threadListError: null,
  }),
}));

vi.mock("../threadlist-adapter", () => ({
  buildThreadListAdapter: () => ({}),
}));

vi.mock("../../actions/use-actions", () => ({
  useActions: () => ({}),
}));

vi.mock("../../contexts/notification-context", () => ({
  useNotification: () => ({ showNotification, notifications: [] }),
}));

vi.mock("../../contexts/ext-user-context", () => ({
  useUser: () => ({ getUserState: () => ({}) }),
}));

vi.mock("../../contexts/thread-context", () => ({
  useThreadContext: () => ({
    currentThreadId: "thread-1",
    allThreadsMetadata: new Map(),
  }),
}));

vi.mock("../../contexts/control-context", () => ({
  useControl: () => ({
    getControlState: () => ({}),
    getCurrentThreadControl: () => ({}),
    getCurrentThreadTarget: () => undefined,
    getPreferredThreadControl: () => ({}),
    markControlSynced: () => {},
  }),
}));

const { AomiRuntimeCore } = await import("../core");

function apiError(status: number, code: string): AgentApiError {
  return new AgentApiError(status, code, `${code} from server`, false);
}

describe("AomiRuntimeCore send errors", () => {
  beforeEach(() => {
    onSendError = undefined;
    showNotification.mockReset();
    clearPersistedThreadId.mockReset();
    render(
      <AomiRuntimeCore
        aomiClient={{} as AomiClient}
        threadPersistenceKey="aomi:thread"
      >
        {null}
      </AomiRuntimeCore>,
    );
  });

  afterEach(() => cleanup());

  it.each([
    [404, "app_not_found", "App not found", /doesn't exist/],
    [409, "app_inactive", "App not active", /isn't active yet/],
    [401, "app_key_required", "App key required", /private.*App key/],
    [
      403,
      "app_key_not_scoped",
      "App key not valid for this App",
      /doesn't grant access/,
    ],
  ])(
    "explains %s %s without dropping the persisted thread",
    (status, code, title, message) => {
      onSendError!("thread-1", apiError(status, code));

      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(showNotification).toHaveBeenCalledWith({
        type: "error",
        title,
        message: expect.stringMatching(message),
      });
      expect(clearPersistedThreadId).not.toHaveBeenCalled();
    },
  );

  it("still drops the pinned thread when the session is gone", () => {
    onSendError!("thread-1", apiError(404, "session_not_found"));

    expect(clearPersistedThreadId).toHaveBeenCalledWith("aomi:thread");
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Conversation unavailable" }),
    );
  });

  it("shows the server message for other failures", () => {
    onSendError!("thread-1", apiError(400, "invalid_request"));

    expect(showNotification).toHaveBeenCalledWith({
      type: "error",
      title: "Message not sent",
      message: "invalid_request from server",
    });
    expect(clearPersistedThreadId).not.toHaveBeenCalled();
  });
});
