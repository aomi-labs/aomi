import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsTab } from "./settings-tab";
const { remove, navigate } = vi.hoisted(() => ({
  remove: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/features/deploy/client", () => ({ deleteProject: remove }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate }) }));
function show() {
  const detail = {
    source: {
      id: 1671,
      repositoryLink: "aomi-labs/sol-dottie",
      platformName: "community",
      installationId: 1,
      apps: [],
    },
    sdk: null,
  } as unknown as Parameters<typeof SettingsTab>[0]["detail"];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsTab detail={detail} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
}
beforeEach(() => {
  remove.mockReset();
  navigate.mockReset();
});
it("requires the exact name and leaves cancellation harmless", () => {
  show();
  expect(
    (
      screen.getByRole("button", {
        name: "Delete project",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Type sol-dottie to confirm"), {
    target: { value: "another-project" },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "Delete project",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(remove).not.toHaveBeenCalled();
});
it("deletes only after confirmation and returns to the bound platform", async () => {
  remove.mockResolvedValue(undefined);
  show();
  fireEvent.change(screen.getByLabelText("Type sol-dottie to confirm"), {
    target: { value: "sol-dottie" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith(1671));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/projects",
      search: { platform: "community" },
    }),
  );
});
it("shows a deletion failure without navigating away", async () => {
  remove.mockRejectedValue(new Error("Permission denied"));
  show();
  fireEvent.change(screen.getByLabelText("Type sol-dottie to confirm"), {
    target: { value: "sol-dottie" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Permission denied",
  );
  expect(navigate).not.toHaveBeenCalled();
});
