import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  importerResolution,
  importerVersions,
  packageVersion,
} from "../../scripts/consumer-lockfile.mjs";

const lockfile = `importers:

  .:
    devDependencies:
      '@assistant-ui/react-ai-sdk':
        specifier: ^1.3.0
        version: 1.3.40(@assistant-ui/tap@0.9.3(react@19.2.7))(react@19.2.7)
      react:
        specifier: ^19.0.0
        version: 19.2.7

packages:

  '@assistant-ui/tap@0.3.6':
    resolution: {integrity: old}

  '@assistant-ui/tap@0.9.3':
    resolution: {integrity: current}
`;

test("selects the trusted importer's peer when a lockfile has historical versions", () => {
  const resolution = importerResolution(
    lockfile,
    ".",
    "@assistant-ui/react-ai-sdk",
  );

  assert.equal(
    packageVersion(lockfile, "@assistant-ui/tap", resolution),
    "0.9.3",
  );
  assert.equal(importerVersions(lockfile, ".").react, "19.2.7");
});

test("fails closed when an ambiguous package has no trusted peer resolution", () => {
  assert.throws(
    () => packageVersion(lockfile, "@assistant-ui/tap"),
    /cannot select one @assistant-ui\/tap/,
  );
});
