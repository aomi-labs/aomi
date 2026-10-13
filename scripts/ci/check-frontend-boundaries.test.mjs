import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkFrontendBoundaries } from "./check-frontend-boundaries.mjs";

const fixtures = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aomi-frontend-boundaries-"));
  fixtures.push(root);
  for (const directory of [
    "apps/portal/src",
    "packages/widget/src",
    "packages/client/src",
    "packages/react/src",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(
    join(root, "apps/portal/package.json"),
    JSON.stringify({ dependencies: { "@aomi-labs/widget": "workspace:*" } }),
  );
  writeFileSync(
    join(root, "apps/portal/tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: {
          "@aomi-labs/widget/host-composition": [
            "../../packages/widget/src/host-composition.ts",
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(root, "packages/widget/package.json"),
    JSON.stringify({ exports: { "./host-composition": "./dist/index.js" } }),
  );
  writeFileSync(
    join(root, "packages/widget/tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
      },
    }),
  );
  return root;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("frontend dependency boundaries", () => {
  it("accepts the declared Portal host contract", () => {
    const root = fixture();
    writeFileSync(
      join(root, "apps/portal/src/shell.ts"),
      'import { HeaderControls } from "@aomi-labs/widget/host-composition";\n',
    );

    expect(checkFrontendBoundaries(root)).toEqual([]);
  });

  it("rejects representative private and reverse dependencies", () => {
    const root = fixture();
    writeFileSync(
      join(root, "apps/portal/src/private.ts"),
      [
        'import "../../../packages/widget/src/private";',
        'import "@aomi-labs/widget/components/private";',
      ].join("\n"),
    );
    writeFileSync(
      join(root, "packages/widget/src/reverse.ts"),
      'import "@portal/components/private";\n',
    );
    writeFileSync(
      join(root, "packages/react/src/app-ui.ts"),
      'export { AomiWidget } from "@aomi-labs/widget";\n',
    );
    writeFileSync(
      join(root, "packages/client/src/react.ts"),
      'export { useAomiRuntime } from "@aomi-labs/react";\n',
    );

    expect(checkFrontendBoundaries(root).map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        "Portal must consume widget-owned UI through a package entrypoint",
        "Portal may use only the declared widget host/provider entrypoints",
        "the shared widget implementation cannot depend on Portal",
        "the SDK cannot depend on the React runtime",
        "the React runtime cannot depend on widget UI",
      ]),
    );
  });

  it("rejects a Portal alias that resolves to private widget source", () => {
    const root = fixture();
    const configPath = join(root, "apps/portal/tsconfig.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.compilerOptions.paths["@private-widget/*"] = [
      "../../packages/widget/src/*",
    ];
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(
      join(root, "apps/portal/src/private-alias.ts"),
      'import "@private-widget/components/account-shell/lib/use-settings";\n',
    );

    expect(checkFrontendBoundaries(root).map(({ reason }) => reason)).toContain(
      "Portal must consume widget-owned UI through a package entrypoint",
    );
  });

  it("rejects a relative client import into the React runtime", () => {
    const root = fixture();
    writeFileSync(
      join(root, "packages/client/src/bypass.ts"),
      'import "../../react/src/index";\n',
    );

    expect(checkFrontendBoundaries(root).map(({ reason }) => reason)).toContain(
      "the SDK cannot depend on the React runtime",
    );
  });

  it("rejects reverse aliases from the widget and workspace packages", () => {
    const root = fixture();
    const widgetConfigPath = join(root, "packages/widget/tsconfig.json");
    const widgetConfig = JSON.parse(readFileSync(widgetConfigPath, "utf8"));
    widgetConfig.compilerOptions.paths["@portal-private/*"] = [
      "../../apps/portal/src/*",
    ];
    writeFileSync(widgetConfigPath, JSON.stringify(widgetConfig));
    writeFileSync(
      join(root, "packages/widget/src/portal-alias.ts"),
      'import "@portal-private/components/private";\n',
    );

    writeFileSync(
      join(root, "packages/client/tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: {
            "@*": ["./src/*"],
            "@widget-private/*": ["../../packages/widget/src/*"],
          },
        },
      }),
    );
    writeFileSync(
      join(root, "packages/client/src/widget-alias.ts"),
      'import "@widget-private/components/private";\n',
    );

    expect(checkFrontendBoundaries(root).map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        "the shared widget implementation cannot depend on Portal",
        "workspace packages cannot depend on app-owned UI",
      ]),
    );
  });

  it("accepts the widget's internal source alias inside the widget", () => {
    const root = fixture();
    writeFileSync(
      join(root, "packages/widget/src/internal.ts"),
      'import "@/components/account-shell/lib/use-settings";\n',
    );

    expect(checkFrontendBoundaries(root)).toEqual([]);
  });
});
