import { useSyncExternalStore } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommitController,
  type AomiClient,
  type CommitView,
} from "@aomi-labs/client";
import { CommitReview } from "./commit-review";

const fixture = vi.hoisted(() => ({
  controller: undefined as CommitController | undefined,
  capabilities: {},
}));
vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useAomiRuntime: () => {
    const controller = fixture.controller!;
    return {
      commitController: controller,
      commits: useSyncExternalStore(controller.subscribe, controller.all),
    };
  },
}));
vi.mock("../../lib/wallet-kit/use-action-capabilities", () => ({
  useCommitCapabilities: () => fixture.capabilities,
}));
afterEach(() => {
  cleanup();
  fixture.controller?.close();
});

const pending: CommitView = {
  version: 1,
  commit_id: "commit-1",
  thread_id: "thread",
  stage_id: "svm:1",
  chain_family: "svm",
  chain_ref: "localnet",
  signer: "expected-payer",
  broadcaster: "wallet",
  state: "needs_signature",
  action: {
    kind: "sign",
    payload: {
      kind: "svm_transaction",
      signer: "expected-payer",
      transaction_base64: "exact-unsigned",
    },
  },
  transaction_id: null,
  failure_code: null,
};

describe("Commit wallet and signing surface", () => {
  it.each(["wallet", "venue", "hosted"] as const)(
    "manual %s uses the tagged view and never displays submitted as confirmed",
    async (broadcaster) => {
      let current: CommitView = { ...pending, broadcaster };
      const request = vi.fn(
        async (
          method: string,
          _path: string,
          options?: { body?: { kind: string } },
        ) => {
          if (method === "POST") {
            if (options?.body?.kind === "signed" && broadcaster !== "hosted") {
              current = {
                ...current,
                version: 2,
                state: "awaiting_broadcast",
                action: {
                  kind: "broadcast",
                  signed_transaction: "exact-signed",
                  transaction_id: "chain-signature",
                },
              };
            } else {
              current = {
                ...current,
                version: 3,
                state: "submitted",
                action: null,
                transaction_id: "chain-signature",
              };
            }
          }
          return current;
        },
      );
      const sign = vi.fn(async () => ["exact-signed"]);
      const broadcast = vi.fn(async () => "chain-signature");
      fixture.capabilities = { sign, walletBroadcast: broadcast };
      fixture.controller = new CommitController(
        { request } as unknown as AomiClient,
        "thread",
        { venueBroadcast: broadcast },
      );
      fixture.controller.ingest(current);
      render(<CommitReview />);
      fireEvent.click(screen.getByText("Exact request"));
      expect(screen.getByText(/exact-unsigned/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Sign$/ }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "Submitted — awaiting chain confirmation",
        ),
      );
      expect(sign).toHaveBeenCalledTimes(1);
      expect(broadcast).toHaveBeenCalledTimes(broadcaster === "hosted" ? 0 : 1);
      expect(screen.queryByRole("button", { name: /^Sign$/ })).toBeNull();
      current = { ...current, version: 4, state: "confirmed" };
      await act(async () => {
        await fixture.controller!.refresh(current.commit_id);
      });
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(/^confirmed$/),
      );
    },
  );

  it("rejects without asking a wallet to sign", async () => {
    const sign = vi.fn();
    fixture.capabilities = { sign };
    const request = vi.fn(async () => ({
      ...pending,
      version: 2,
      state: "rejected",
      action: null,
    }));
    fixture.controller = new CommitController(
      { request } as unknown as AomiClient,
      "thread",
    );
    fixture.controller.ingest(pending);
    render(<CommitReview />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/^rejected$/),
    );
    expect(sign).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/commits/commit-1/manual",
      { sessionId: "thread", body: { kind: "rejected" } },
    );
  });
});
