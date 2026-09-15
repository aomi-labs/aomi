import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    "apps/shadcn-registry/src",
    "packages/client/src",
    "packages/react/src",
  ]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(
    join(root, "apps/portal/tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: {
          "@aomi-labs/widget-lib/host-composition": [
            "../shadcn-registry/src/host-composition.ts",
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(root, "apps/shadcn-registry/package.json"),
    JSON.stringify({ exports: { "./host-composition": "./dist/index.js" } }),
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
      'import { HeaderControls } from "@aomi-labs/widget-lib/host-composition";\n',
    );

    expect(checkFrontendBoundaries(root)).toEqual([]);
  });

  it("rejects representative private and reverse dependencies", () => {
    const root = fixture();
    writeFileSync(
      join(root, "apps/portal/src/private.ts"),
      [
        'import "../../shadcn-registry/src/private";',
        'import "@aomi-labs/widget-lib/components/private";',
      ].join("\n"),
    );
    writeFileSync(
      join(root, "apps/shadcn-registry/src/reverse.ts"),
      'import "@portal/components/private";\n',
    );
    writeFileSync(
      join(root, "packages/react/src/app-ui.ts"),
      'export { AomiWidget } from "@aomi-labs/widget-lib";\n',
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
});
