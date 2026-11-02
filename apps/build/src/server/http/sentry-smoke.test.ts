import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aomi-labs/observability/smoke", () => ({
  APP_SENTRY_SMOKE_HEADER: "x-aomi-sentry-smoke",
  runAppSentrySmoke: vi.fn(),
}));

import { runAppSentrySmoke } from "@aomi-labs/observability/smoke";
import { GET, OPTIONS, POST } from "./sentry-smoke";

const runSmokeMock = vi.mocked(runAppSentrySmoke);

describe("build Sentry smoke route", () => {
  beforeEach(() => runSmokeMock.mockReset());

  it("stays hidden when the smoke helper rejects the request", async () => {
    runSmokeMock.mockResolvedValue(false);

    const response = await POST(
      new Request("https://build.aomi.dev/api/build/internal/sentry-smoke"),
    );

    expect(response.status).toBe(404);
    expect(runSmokeMock).toHaveBeenCalledWith({
      service: "build",
      providedSecret: null,
    });
  });

  it("returns no content after fixed telemetry is emitted", async () => {
    runSmokeMock.mockResolvedValue(true);

    const response = await POST(
      new Request("https://build.aomi.dev/api/build/internal/sentry-smoke", {
        method: "POST",
        headers: { "x-aomi-sentry-smoke": "secret" },
      }),
    );

    expect(response.status).toBe(204);
    expect(runSmokeMock).toHaveBeenCalledWith({
      service: "build",
      providedSecret: "secret",
    });
  });

  it("stays hidden for unsupported methods", () => {
    expect(GET().status).toBe(404);
    expect(OPTIONS().status).toBe(404);
    expect(runSmokeMock).not.toHaveBeenCalled();
  });
});
