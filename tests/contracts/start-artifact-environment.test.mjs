import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactFixtureEnvironment,
  baselineAssetHash,
  landingAssetPaths,
} from "../../scripts/test-start-artifacts.mjs";

test("artifact workflows cannot inherit provider, deployment or live database credentials", () => {
  const env = artifactFixtureEnvironment({
    PATH: "/fixture/bin",
    AOMI_ARTIFACT_SECRET_CANARY: "throwaway-private-canary",
    ANTHROPIC_API_KEY: "must-not-inherit",
    OPENAI_API_KEY: "must-not-inherit",
    OPENROUTER_API_KEY: "must-not-inherit",
    VERCEL_TOKEN: "must-not-inherit",
    VERCEL: "1",
    VERCEL_ENV: "production",
    GH_TOKEN: "must-not-inherit",
    DATABASE_URL: "must-not-inherit",
    SMITHER_DATABASE_URL: "must-not-inherit",
    AOMI_BUILD_RUNNER: "vercel-sandbox",
    AOMI_ALLOW_STALE_SDK: "1",
    NODE_OPTIONS: "must-not-inherit",
    NODE_PATH: "must-not-inherit",
  });
  assert.equal(env.PATH, "/fixture/bin");
  assert.equal(env.AOMI_ARTIFACT_SECRET_CANARY, "throwaway-private-canary");
  assert.equal(env.AOMI_BUILD_RUNNER, "local");
  assert.equal(env.AOMI_ALLOW_STALE_SDK, "0");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.SENTRY_ENABLED, "0");
  assert.ok(!Object.values(env).includes("must-not-inherit"));
  assert.equal(Object.keys(env).length, 6);
});

test("immutable LFS video pointers require the original object bytes rather than serving the pointer", () => {
  const digest =
    "013f91c98c61e1119f047efb8f8a040d18bebad32b9c3b8888f00691975bf5c2";
  assert.equal(
    baselineAssetHash(
      Buffer.from(
        `version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize 14978071\n`,
      ),
    ),
    digest,
  );
  assert.notEqual(
    baselineAssetHash(Buffer.from("ordinary static asset")),
    digest,
  );
  assert.throws(
    () =>
      baselineAssetHash(
        Buffer.from(
          "version https://git-lfs.github.com/spec/v1\noid sha256:broken\nsize 1\n",
        ),
      ),
    /Malformed immutable Git LFS/,
  );
});

test("Landing runtime assets use the HTML base, CSS-relative URLs and unique local paths", () => {
  assert.deepEqual(
    landingAssetPaths(`
    <base href="/assets/landing/home/">
    <link href="./theme.css?v=3">
    <script src="./theme.js"></script><script src="./theme.js?duplicate=1"></script>
    <img src="/assets/logos/aomi.svg"><img src="https://external.invalid/pixel.png">
    <style>@font-face {src: url('./fonts/geist-latin.woff2')}</style>
    <div style="background-image: url(&quot;./hero.jpg&quot;)"></div>
    <div style="background-image: url(&#39;./media/hero&#x2d;mobile.jpg&#39;)"></div>
    <style>
      .texture { background: url("data:image/svg+xml,%3Csvg%3E%3Crect filter='url(%23sand)'/%3E%3C/svg%3E") }
      .filter { filter: url(#sand); clip-path: url(\\#clip); mask: url(\\23 mask) }
      .image { background: url('./media/escaped\\2d image.png') }
    </style>
    <a href="/docs">Docs</a>
  `),
    [
      "/assets/landing/home/fonts/geist-latin.woff2",
      "/assets/landing/home/hero.jpg",
      "/assets/landing/home/media/escaped-image.png",
      "/assets/landing/home/media/hero-mobile.jpg",
      "/assets/landing/home/theme.css",
      "/assets/landing/home/theme.js",
      "/assets/logos/aomi.svg",
    ],
  );
  assert.deepEqual(
    landingAssetPaths(
      "url('../fonts/local.woff2')",
      "/assets/styles/theme.css",
    ),
    ["/assets/fonts/local.woff2"],
  );
});
