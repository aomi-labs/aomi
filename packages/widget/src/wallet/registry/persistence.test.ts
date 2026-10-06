import { beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "./reducer";
import { loadPersisted, savePersisted, toPersisted } from "./persistence";

const KEY = "test.aomi.wallet.registry";
const LEGACY_ACTIVE_EVM_ADDRESS_KEY = "aomi.wallet.active-evm-address";
const LEGACY_DETACHED_PARA_EVM_ADDRESS_KEY =
  "aomi.wallet.detached-para-evm-address";

describe("WalletRegistry persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the persisted registry shape", () => {
    const state = {
      ...createInitialState(),
      activeByFamily: {
        evm: {
          family: "evm" as const,
          address: "0xabc",
          stableId: "metaMaskSDK",
          uid: "runtime",
        },
      },
      intents: {
        ...createInitialState().intents,
        droppedAddresses: ["0xdef"],
      },
    };

    savePersisted(state, KEY);
    expect(loadPersisted(KEY)).toEqual(toPersisted(state));
  });

  it("migrates legacy keys without deleting them by default", () => {
    localStorage.setItem(LEGACY_ACTIVE_EVM_ADDRESS_KEY, "0xABC");
    localStorage.setItem(LEGACY_DETACHED_PARA_EVM_ADDRESS_KEY, "0xDEF");

    expect(loadPersisted(KEY)).toEqual({
      version: 1,
      active: { evm: { address: "0xabc" } },
      droppedAddresses: ["0xdef"],
      order: [],
      providerSessionDetached: true,
    });
    expect(localStorage.getItem(LEGACY_ACTIVE_EVM_ADDRESS_KEY)).toBe("0xABC");
  });

  it("can migrate legacy keys destructively once old readers are removed", () => {
    localStorage.setItem(LEGACY_ACTIVE_EVM_ADDRESS_KEY, "0xABC");

    expect(loadPersisted(KEY, { migrateDestructively: true })).toMatchObject({
      active: { evm: { address: "0xabc" } },
    });
    expect(localStorage.getItem(LEGACY_ACTIVE_EVM_ADDRESS_KEY)).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem(KEY, "{bad");

    expect(loadPersisted(KEY)).toBeNull();
  });
});
