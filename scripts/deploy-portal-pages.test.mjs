// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { pageConfig, portalPage } from "./deploy-portal-pages.mjs";

const records = JSON.parse(
  readFileSync(new URL("../apps/portal/pages.json", import.meta.url), "utf8"),
);
const keys = JSON.parse(
  readFileSync(
    new URL("../apps/portal/public-env.keys.json", import.meta.url),
    "utf8",
  ),
);
const generated = {
  main: "index.mjs",
  assets: { binding: "ASSETS", directory: "../public" },
  compatibility_flags: ["nodejs_compat"],
  no_bundle: true,
};

describe("Portal page deploy", () => {
  it("accepts the committed staging record", () => {
    expect(portalPage(records, "staging", keys).script).toBe(
      "aomi-portal-staging",
    );
    expect(() => portalPage(records, "production", keys)).toThrow(
      /no production record/,
    );
  });

  it("refuses a record that is unpinned, misses a wallet setting or names a private one", () => {
    const { staging } = records;
    for (const changed of [
      { script: "https://staging.aomi.chat" },
      { compatibilityDate: "today" },
      { publicEnv: {} },
      { publicEnv: { ...staging.publicEnv, DATABASE_URL: "private" } },
    ]) {
      expect(() =>
        portalPage({ staging: { ...staging, ...changed } }, "staging", keys),
      ).toThrow();
    }
  });

  it("uploads a page Worker with no route, variable or binding of its own", () => {
    const page = portalPage(records, "staging", keys);
    const config = pageConfig(
      {
        ...generated,
        routes: ["aomi.chat/*"],
        hyperdrive: [{ binding: "DB" }],
        vars: { SECRET: "no" },
        services: [{ binding: "EDGE" }],
      },
      page,
    );
    expect(config).toMatchObject({
      name: page.script,
      compatibility_date: page.compatibilityDate,
      workers_dev: false,
      preview_urls: false,
    });
    expect(config.routes).toEqual([]);
    expect(config.services).toEqual([]);
    expect(config.vars).toEqual({});
    expect(config).not.toHaveProperty("hyperdrive");
    expect(() =>
      pageConfig({ ...generated, main: "elsewhere.mjs" }, page),
    ).toThrow(/layout/);
  });
});
