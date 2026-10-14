import { vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  const { TestNavigationLink } = await import("./src/test-navigation-link");
  return { ...actual, Link: TestNavigationLink };
});
