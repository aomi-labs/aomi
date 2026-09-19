import { webcrypto } from "node:crypto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// One DB per environment, no in-code fallback: suites that import the account
// package's query/better-auth modules need a URL present. pg never connects
// until the first query, so a placeholder is safe for unit tests.
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/vitest_placeholder";
process.env.NODE_ENV = "test";
process.env.AOMI_CLI_STRICT_EXIT = "1";

afterEach(() => {
  cleanup();
});

vi.mock("@getpara/solana-wallet-connectors", () => {
  const wallet = (name: string) => ({
    adapter: { name },
    readyState: "Installed",
  });
  return {
    backpackWallet: () => wallet("Backpack"),
    glowWallet: () => wallet("Glow"),
    phantomWallet: () => wallet("Phantom"),
    solflareWallet: () => wallet("Solflare"),
  };
});

vi.mock("@getpara/solana-wallet-connectors/connectors", () => {
  const wallet = (name: string) => ({
    adapter: { name },
    readyState: "Installed",
  });
  return {
    backpackWallet: () => wallet("Backpack"),
    glowWallet: () => wallet("Glow"),
    phantomWallet: () => wallet("Phantom"),
    solflareWallet: () => wallet("Solflare"),
  };
});

vi.mock("@getpara/react-sdk", async () => {
  const React = await import("react");
  return {
    default: {},
    Environment: { BETA: "BETA", PROD: "PROD" },
    ParaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useAccount: () => {
      throw new Error("Para SDK unavailable in tests");
    },
    useClient: () => null,
    useIssueJwt: () => ({ issueJwtAsync: async () => null }),
    useLogout: () => ({ logoutAsync: async () => undefined }),
    useModal: () => ({ openModal: () => undefined }),
  };
});

vi.mock("@getpara/react-sdk/styles.css", () => ({}));

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom doesn't implement ResizeObserver, which cmdk (the Command/combobox
// primitive behind the network + app + model selectors) instantiates on mount.
// Provide a no-op stub so those components can render under test.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement Element.scrollIntoView, which cmdk calls when it
// scrolls the active item into view. Stub it so the combobox can mount.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView !== "function"
) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// Node 25 exposes a stub globalThis.localStorage (via --localstorage-file) that
// lacks the standard Storage API (setItem / getItem / clear / removeItem / key /
// length). Install a real in-memory implementation so that tests relying on
// localStorage work correctly in the jsdom environment.
(function installLocalStorage() {
  let store: Map<string, string> | null = null;

  function ensureStore() {
    if (!store) store = new Map<string, string>();
    return store;
  }

  const impl = {
    getItem(key: string): string | null {
      return ensureStore().get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      ensureStore().set(key, value);
    },
    removeItem(key: string): void {
      ensureStore().delete(key);
    },
    clear(): void {
      ensureStore().clear();
    },
    key(index: number): string | null {
      return Array.from(ensureStore().keys())[index] ?? null;
    },
    get length(): number {
      return ensureStore().size;
    },
  };

  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: impl,
    });
  } catch {
    // Already sealed — skip polyfill.
  }
})();
