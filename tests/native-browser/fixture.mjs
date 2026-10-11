import { test as base, expect } from "@playwright/test";
import {
  expectedProviderNetworkError,
  isPrivyRequest,
} from "./requirements.mjs";

const assetTypes = new Set(["script", "stylesheet", "image", "font", "media"]);

export const test = base.extend({
  browserEvidence: [
    async ({ page, baseURL }, use, testInfo) => {
      const origin = new URL(baseURL).origin;
      const evidence = {
        pageErrors: [],
        consoleErrors: [],
        assets: [],
        externalFailures: [],
        documents: [],
      };
      const requests = new WeakMap();
      let navigation = 0;
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigation++;
      });
      page.on("request", (request) => {
        requests.set(request, navigation);
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          evidence.documents.push(request.url());
      });
      page.on("pageerror", (error) =>
        evidence.pageErrors.push({
          message: error.message,
          stack: error.stack,
        }),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          evidence.consoleErrors.push(message.text());
      });
      page.on("response", (response) => {
        const request = response.request();
        if (
          new URL(response.url()).origin === origin &&
          (assetTypes.has(request.resourceType()) ||
            request.isNavigationRequest())
        )
          evidence.assets.push({
            url: response.url(),
            status: response.status(),
            type: request.resourceType(),
          });
        else if (response.status() >= 400)
          evidence.externalFailures.push({
            url: response.url(),
            status: response.status(),
          });
      });
      page.on("requestfailed", (request) => {
        const failure =
          request.failure()?.errorText ?? "Unknown network failure";
        const local = new URL(request.url()).origin === origin;
        // A navigation may cancel the previous document's still-loading assets.
        if (
          failure === "net::ERR_ABORTED" &&
          requests.get(request) !== navigation
        )
          return;
        const target =
          local && assetTypes.has(request.resourceType())
            ? evidence.assets
            : evidence.externalFailures;
        target.push({
          url: request.url(),
          failure,
          type: request.resourceType(),
        });
      });
      await use(evidence);
      if (!page.isClosed()) {
        const screenshot = testInfo.outputPath("rendered.png");
        await page.screenshot({
          path: screenshot,
          animations: "disabled",
          timeout: 10_000,
        });
        await testInfo.attach("rendered", {
          path: screenshot,
          contentType: "image/png",
        });
      }
      await testInfo.attach("browser-evidence", {
        body: Buffer.from(JSON.stringify(evidence, null, 2)),
        contentType: "application/json",
      });
      const failedProviderUrls = evidence.externalFailures
        .map((entry) => entry.url)
        .filter(isPrivyRequest);
      expect(
        evidence.pageErrors.filter(
          (error) => !expectedProviderNetworkError(error, failedProviderUrls),
        ),
        "Unexpected browser page errors",
      ).toEqual([]);
      expect(
        evidence.consoleErrors.filter((error) =>
          /hydration failed|hydration mismatch|hydrated.*didn.t match|Minified React error/i.test(
            error,
          ),
        ),
        "React hydration errors",
      ).toEqual([]);
      expect(
        evidence.assets.filter((asset) => asset.failure || asset.status >= 400),
        "Failed local scripts, styles, images, fonts, media or documents",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function navigate(page, path) {
  const response = await page.goto(path, { waitUntil: "load" });
  expect(response?.status(), `Document ${path} must render`).toBe(200);
}

export async function localImageLoads(page, selector) {
  const image = page.locator(selector).first();
  await image.scrollIntoViewIfNeeded();
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element) =>
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalHeight > 0,
      ),
    )
    .toBe(true);
}
