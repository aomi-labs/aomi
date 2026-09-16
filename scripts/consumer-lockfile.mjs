function importerResolutions(lockfile, importer) {
  const lines = lockfile.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${importer}:`);
  if (start < 0) throw new Error(`Trusted lockfile lacks importer ${importer}`);
  const resolutions = {};
  let inDependencies = false;
  let dependency;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  \S/.test(line)) break;
    const field = line.match(
      /^    (dependencies|devDependencies|optionalDependencies):$/,
    );
    if (field) {
      inDependencies = true;
      dependency = undefined;
      continue;
    }
    if (/^    \S/.test(line)) {
      inDependencies = false;
      dependency = undefined;
      continue;
    }
    if (!inDependencies) continue;
    const name = line.match(/^      (.+):$/);
    if (name) {
      dependency = name[1].replace(/^['"]|['"]$/g, "");
      continue;
    }
    const locked = line.match(/^        version: (.+)$/);
    if (dependency && locked) {
      resolutions[dependency] = locked[1].replace(/^['"]|['"]$/g, "");
    }
  }
  return resolutions;
}

function exactLockedVersion(value) {
  const version = value.split("(", 1)[0];
  if (/^(?:file|link|workspace):/.test(version)) return undefined;
  return version;
}

export function importerVersions(lockfile, importer) {
  return Object.fromEntries(
    Object.entries(importerResolutions(lockfile, importer)).flatMap(
      ([name, resolution]) => {
        const version = exactLockedVersion(resolution);
        return version ? [[name, version]] : [];
      },
    ),
  );
}

export function importerResolution(lockfile, importer, dependency) {
  const resolution = importerResolutions(lockfile, importer)[dependency];
  if (!resolution) {
    throw new Error(
      `Trusted lockfile lacks ${importer} dependency ${dependency}`,
    );
  }
  return resolution;
}

export function packageVersion(lockfile, packageName, preferredResolution) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [
    ...lockfile.matchAll(new RegExp(`^  '${escaped}@([^']+)':$`, "gm")),
  ].map((match) => match[1].split("(", 1)[0]);
  const versions = [...new Set(matches)];
  if (versions.length === 1) return versions[0];

  const preferred = preferredResolution
    ? [
        ...preferredResolution.matchAll(
          new RegExp(`(?:^|\\()${escaped}@([^()]+)`, "g"),
        ),
      ].map((match) => match[1])
    : [];
  const selected = [...new Set(preferred)].filter((version) =>
    versions.includes(version),
  );
  if (selected.length === 1) return selected[0];

  throw new Error(
    `Trusted lockfile cannot select one ${packageName}; found ${versions.join(",")}`,
  );
}
