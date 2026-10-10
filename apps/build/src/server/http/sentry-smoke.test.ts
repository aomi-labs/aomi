import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aomi-labs/observability/smoke", () => ({
  BFF_SENTRY_SMOKE_HEADER: "x-aomi-sentry-smoke",
  runBffSentrySmoke: vi.fn(),
}));

import { runBffSentrySmoke } from "@aomi-labs/observability/smoke";
import { GET, OPTIONS, POST } from "./sentry-smoke";

const runSmokeMock = vi.mocked(runBffSentrySmoke);

describe("build Sentry smoke route", () => {
  beforeEach(() => runSmokeMock.mockReset());

  it("stays hidden when the smoke helper rejects the request", async () => {
    runSmokeMock.mockResolvedValue(false);

    const response = await POST(
      new Request("https://build.aomi.dev/api/bff/internal/sentry-smoke"),
    );

    expect(response.status).toBe(404);
    expect(runSmokeMock).toHaveBeenCalledWith({
      service: "build-bff",
      providedSecret: null,
    });
  });

  it("returns no content after fixed telemetry is emitted", async () => {
    runSmokeMock.mockResolvedValue(true);

    const response = await POST(
      new Request("https://build.aomi.dev/api/bff/internal/sentry-smoke", {
        method: "POST",
        headers: { "x-aomi-sentry-smoke": "secret" },
      }),
    );

    expect(response.status).toBe(204);
    expect(runSmokeMock).toHaveBeenCalledWith({
      service: "build-bff",
      providedSecret: "secret",
    });
  });

  it("stays hidden for unsupported methods", () => {
    expect(GET().status).toBe(404);
    expect(OPTIONS().status).toBe(404);
    expect(runSmokeMock).not.toHaveBeenCalled();
  });
});
