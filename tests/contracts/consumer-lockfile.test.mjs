import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  importerResolution,
  importerVersions,
  packageVersion,
  snapshotDependencyVersion,
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

test("restores a transitive version from the exact trusted peer snapshot", () => {
  const snapshots = `${lockfile}
snapshots:
  '@assistant-ui/react@0.14.26(react@19.2.7)':
    dependencies:
      radix-ui: 1.6.2(react@19.2.7)
  '@assistant-ui/react@0.14.26(react@18.3.1)':
    dependencies:
      radix-ui: 1.4.3(react@18.3.1)
`;
  assert.equal(
    snapshotDependencyVersion(
      snapshots,
      "@assistant-ui/react",
      "0.14.26(react@19.2.7)",
      "radix-ui",
    ),
    "1.6.2",
  );
  assert.throws(
    () =>
      snapshotDependencyVersion(
        snapshots,
        "@assistant-ui/react",
        "0.14.26(react@17.0.2)",
        "radix-ui",
      ),
    /lacks snapshot/,
  );
  assert.throws(
    () =>
      snapshotDependencyVersion(
        snapshots,
        "@assistant-ui/react",
        "0.14.26(react@19.2.7)",
        "missing",
      ),
    /lacks dependency/,
  );
});
