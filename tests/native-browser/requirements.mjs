import assert from "node:assert/strict";

export const nativeBrowserCases = {
  landing: [
    "homepage scripts, local images and video load",
    "hydrated blog article navigation and history preserve the document",
    "anonymous Polymarket MDX controls edit without sending a request",
    "anonymous configurator hydrates its preview and generated code",
  ],
  telegram: ["hydrated wallet rejects an outside-Telegram launch"],
};

export function nativeBrowserTransport(app, origin) {
  assert.ok(nativeBrowserCases[app], "Unknown native browser app");
  const url = new URL(origin);
  assert.ok(
    url.port &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      url.protocol === (app === "telegram" ? "https:" : "http:") &&
      url.hostname ===
        (app === "telegram" ? "telegram-artifact.localhost" : "127.0.0.1"),
    "Native browser probes require their isolated local origin and transport",
  );
  return { baseURL: origin, ignoreHTTPSErrors: app === "telegram" };
}

/** A green exit cannot conceal omitted, skipped, retried or renamed scenarios. */
export function verifyNativeBrowserReport(report, app) {
  const required = nativeBrowserCases[app];
  assert.ok(required, "Unknown native browser app");
  assert.deepEqual(
    Object.fromEntries(
      ["expected", "unexpected", "skipped", "flaky"].map((key) => [
        key,
        report.stats?.[key],
      ]),
    ),
    { expected: required.length, unexpected: 0, skipped: 0, flaky: 0 },
    "Native browser report contains missing cases, failures, skips or flakes",
  );
  const observed = [];
  function inspect(suite) {
    for (const spec of suite.specs ?? []) {
      assert.equal(spec.ok, true, `Browser scenario failed: ${spec.title}`);
      assert.equal(spec.tests?.length, 1, "Each scenario must run once");
      const result = spec.tests[0];
      assert.equal(result.projectName, app, "Wrong native host project");
      assert.equal(result.status, "expected", "Unexpected browser result");
      assert.equal(result.results?.length, 1, "Browser retries are forbidden");
      assert.equal(
        result.results[0].status,
        "passed",
        "Browser case did not pass",
      );
      observed.push(spec.title);
    }
    for (const child of suite.suites ?? []) inspect(child);
  }
  for (const suite of report.suites ?? []) inspect(suite);
  assert.deepEqual(
    observed.sort(),
    [...required].sort(),
    "Mandatory browser scenarios changed or were omitted",
  );
}

export function isPrivyRequest(url) {
  const parsed = new URL(url);
  return ["auth.privy.io", "api.privy.io"].includes(parsed.hostname);
}

/** Only explicitly identified failed public-provider requests may explain a network error. */
export function expectedProviderNetworkError(error, failedUrls) {
  const message = String(error.message ?? error);
  if (
    !/failed to fetch|networkerror|load failed|<no response>|(?:\b4\d\d\b.*(?:not found|unauthorized|forbidden))/i.test(
      message,
    )
  )
    return false;
  const detail = `${message}\n${error.stack ?? ""}`;
  return failedUrls.some((url) => isPrivyRequest(url) && detail.includes(url));
}

/** Buffered media cancellations require successful playback and a healthy final element. */
export function isVerifiedMediaAbort(asset, evidence) {
  if (
    asset.type !== "media" ||
    asset.failure !== "net::ERR_ABORTED" ||
    asset.status >= 400
  )
    return false;
  let url;
  try {
    url = new URL(asset.url);
  } catch {
    return false;
  }
  if (
    url.pathname !== "/assets/landing/home/media/three-gates.mp4" ||
    url.search ||
    url.hash
  )
    return false;
  const playback = evidence.mediaPlayback?.find(
    (entry) =>
      entry.url === asset.url &&
      Number.isFinite(entry.startTime) &&
      entry.startTime >= 0 &&
      Number.isFinite(entry.endTime) &&
      entry.endTime > entry.startTime + 0.25,
  );
  if (!playback) return false;
  return (
    evidence.mediaStates?.some(
      (media) =>
        media.url === asset.url &&
        media.error === null &&
        media.readyState >= 2 &&
        media.width > 0 &&
        media.height > 0 &&
        Number.isFinite(media.duration) &&
        media.duration > 0 &&
        Number.isFinite(media.currentTime) &&
        media.currentTime >= playback.endTime &&
        media.paused === false,
    ) ?? false
  );
}
