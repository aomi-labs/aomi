import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

import { KeysView } from "./keys-view";

const createKey = vi.fn();

vi.mock("@/features/packages/client", async (original) => ({
  ...(await original<typeof import("@/features/packages/client")>()),
  fetchKeys: async () => ({ keys: [] }),
  createKey: (input: unknown) => createKey(input),
}));

vi.mock("@/features/packages/hooks", async (original) => ({
  ...(await original<typeof import("@/features/packages/hooks")>()),
  usePublisher: () => ({
    data: { publisher: "alice", agents: [], packages: [] },
  }),
}));

vi.mock("@/features/operate/client", () => ({
  modelKeysFetch: async () => ({ keys: [], agents: [] }),
}));

it("makes an observe key bound to the builder's publisher", async () => {
  createKey.mockResolvedValue({ id: 1, label: "ops", key: "aomi_key_x" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <KeysView />
    </QueryClientProvider>,
  );

  fireEvent.change(await screen.findByLabelText("Key name"), {
    target: { value: "ops" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Allows/ }));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: /Observe agents/ }),
  );
  expect(screen.getByText(/statements of alice's agents/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New builder key" }));

  await waitFor(() =>
    expect(createKey).toHaveBeenCalledWith({
      label: "ops",
      capabilities: ["publisher:observe"],
      publisher: "alice",
    }),
  );
});
