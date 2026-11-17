// @vitest-environment node
import { expect, it, vi } from "vitest";
import { deploymentAttemptsRoute } from "./routes";
import { getGitHubSession } from "./harness";
it("leaves retired deployment attempt paths unhandled", async () => {
  getGitHubSession.mockResolvedValue({ githubUserId: "42" });
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 404 }));
  const response = await deploymentAttemptsRoute(
    new Request(
      "http://localhost:3000/api/build/deployments/attempts?projectId=7",
    ),
  );
  expect(response.status).toBe(404);
  expect(
    upstream.mock.calls.every(([url]) =>
      String(url).startsWith("http://build-vercel.invalid/"),
    ),
  ).toBe(true);
  upstream.mockRestore();
});
