import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Source-level invariants — properties that hold across the whole app and
 *  cannot be asserted by running any single unit.
 *
 *  Deliberately few. Behaviour is covered by real tests next to the code; these
 *  exist only where a violation would be invisible until production. */

// Vitest's root is the app directory (see vitest.config.ts).
const appRoot = process.cwd();
const srcRoot = join(appRoot, "src");

function sourceFiles(dir = srcRoot): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

const sources = sourceFiles().map((path) => ({
  path: relative(appRoot, path),
  text: readFileSync(path, "utf8"),
}));

/** Import specifiers only — comments discussing a banned API are fine. */
function importsMatching(pattern: RegExp): { path: string; spec: string }[] {
  return sources.flatMap(({ path, text }) =>
    [...text.matchAll(/from\s+"([^"]+)"/g)]
      .map((match) => match[1])
      .filter((spec) => pattern.test(spec))
      .map((spec) => ({ path, spec })),
  );
}

function named(pattern: RegExp): string[] {
  return sources
    .filter(({ text }) =>
      // Strip comments first: several of these names are discussed at length in
      // the comments that explain why they are not used.
      pattern.test(
        text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
      ),
    )
    .map(({ path }) => path);
}

describe("app invariants", () => {
  it("finds the sources it is asserting over", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it("imports only the Privy-free surface of widget-lib", () => {
    // widget-lib pins Privy v2 while this app runs v3. Its UI primitives and
    // design tokens are safe; anything under `providers/` or `lib/wallet-kit`
    // would pull a second, incompatible Privy runtime into the bundle.
    const imports = importsMatching(/^@aomi-labs\/widget-lib/);
    expect(imports.length).toBeGreaterThan(0);
    for (const { path, spec } of imports) {
      expect(
        spec.startsWith("@aomi-labs/widget-lib/components/ui/"),
        `${path} imports ${spec}`,
      ).toBe(true);
    }
  });

  it("never reads Privy's connected-wallet list", () => {
    // `useWallets().ready` waits on a wallet-proxy iframe that Telegram's
    // webview routinely blocks, so anything gated on it can hang forever on an
    // account whose wallet exists and works. Wallets come off the Privy user.
    expect(named(/\buseWallets\b|\bgetEmbeddedConnectedWallet\b/)).toEqual([]);
  });

  it("never broadcasts or waits on a transaction", () => {
    // The Mini App links a wallet and signs permits. Execution is backend-owned;
    // a send path here would be an unreviewed second broadcaster.
    expect(
      named(/\bsendTransaction\b|\bwaitForTransactionReceipt\b|\beth_sendTransaction\b/),
    ).toEqual([]);
  });

  it("runs exactly one login flow", () => {
    // A second, parallel Privy login strands the page in its signing state.
    const page = sources.find(({ path }) =>
      path.endsWith("app/wallet-client.tsx"),
    );
    expect(page).toBeDefined();
    expect(page?.text).not.toMatch(/useLoginWithTelegram|void login\(\)/);
  });

  it("verifies every Telegram launch server-side", () => {
    const route = sources.find(({ path }) =>
      path.endsWith("api/telegram/launch/route.ts"),
    );
    expect(route?.text).toMatch(/verifyTelegramInitData/);
    const launch = sources.find(({ path }) => path.endsWith("lib/telegram.ts"));
    // The client must never trust `initDataUnsafe`; it posts the raw initData
    // and uses what the server hands back.
    expect(launch?.text).toMatch(/\/api\/telegram\/launch/);
    expect(launch?.text).not.toMatch(/initDataUnsafe/);
  });

  it("carries no legacy wallet stack in its manifest", () => {
    const manifest = readFileSync(join(appRoot, "package.json"), "utf8");
    expect(manifest).not.toMatch(/walletconnect|wagmi|getpara/i);
  });
});
