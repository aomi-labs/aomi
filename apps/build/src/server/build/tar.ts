import { gunzipSync } from "node:zlib";

/**
 * Minimal ustar reader for the crate tarballs the result phase embeds —
 * enough to pull one file back out of the store after the sandbox is gone.
 * No dependency: headers are 512-byte blocks, name in [0,100) (+ optional
 * prefix in [345,500)), size as octal in [124,136), payload padded to 512.
 */

function headerString(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString("utf8");
}

export function extractFileFromTarGz(
  tarGz: Buffer,
  wantedPath: string,
): Buffer | null {
  let tar: Buffer;
  try {
    tar = gunzipSync(tarGz);
  } catch {
    return null;
  }
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    const name = headerString(block, 0, 100);
    if (!name) break; // Two empty blocks terminate the archive.
    const prefix = headerString(block, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = parseInt(headerString(block, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(block[156] ?? 48);
    offset += 512;
    const isFile = type === "0" || type === "\0";
    // Some tars prefix entries with "./".
    const normalized = fullName.replace(/^\.\//, "");
    if (isFile && normalized === wantedPath) {
      return tar.subarray(offset, offset + size);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return null;
}
