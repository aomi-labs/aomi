import type { WalletFamily } from "@/wallet/types";
import type { MergeOffer } from "@/wallet/account/aomi-backend-client";

/** Signed out, the sheet signs in; signed in, it adds to the account. */
export type SheetMode = "sign-in" | "add";

/** An address the sheet is working on. */
export type SheetTarget = {
  family: WalletFamily;
  address: string;
  /** The wallet app, e.g. "Rabby". */
  brand?: string;
  /** The kit account id that signs for it, once connected. */
  accountId?: string;
  chainId?: number;
};

export type SheetState =
  | { step: "closed" }
  | { step: "choose"; mode: SheetMode; error?: string }
  /** Wallets with both chains (Phantom) ask which one first. */
  | { step: "chain"; mode: SheetMode; wallet: string; brand: string }
  | {
      step: "connecting";
      mode: SheetMode;
      brand: string;
      /** Set when the user asked for one address (activateWallet). */
      expected?: SheetTarget;
    }
  | { step: "signing"; mode: SheetMode; target: SheetTarget }
  /** The signature prompt was dismissed or failed; one click asks again. */
  | { step: "verify"; mode: SheetMode; target: SheetTarget; error?: string }
  /** The wallet app moved to an address that is not in the account. */
  | { step: "detected"; target: SheetTarget; previous?: string }
  /** Waiting for the wallet app to show this address. */
  | { step: "switch"; target: SheetTarget }
  | { step: "merge"; target: SheetTarget; offer: MergeOffer };

export type SheetEvent =
  | { type: "open"; mode: SheetMode }
  | { type: "pick"; wallet: string; brand: string; families: WalletFamily[] }
  | { type: "connect"; brand: string; expected?: SheetTarget }
  | { type: "sign"; target: SheetTarget }
  | { type: "verify"; target: SheetTarget; error?: string }
  | { type: "detected"; target: SheetTarget; previous?: string }
  | { type: "switch"; target: SheetTarget }
  | { type: "merge"; target: SheetTarget; offer: MergeOffer }
  | { type: "back"; error?: string }
  | { type: "close" };

export const CLOSED_SHEET: SheetState = { step: "closed" };

function modeOf(state: SheetState, fallback: SheetMode = "add"): SheetMode {
  return "mode" in state ? state.mode : fallback;
}

export function sheetReducer(state: SheetState, event: SheetEvent): SheetState {
  switch (event.type) {
    case "open":
      return { step: "choose", mode: event.mode };
    case "pick":
      // Picking a one-chain wallet goes straight to connect.
      return event.families.length > 1
        ? {
            step: "chain",
            mode: modeOf(state),
            wallet: event.wallet,
            brand: event.brand,
          }
        : { step: "connecting", mode: modeOf(state), brand: event.brand };
    case "connect":
      return {
        step: "connecting",
        mode: modeOf(state),
        brand: event.brand,
        ...(event.expected ? { expected: event.expected } : {}),
      };
    case "sign":
      return { step: "signing", mode: modeOf(state), target: event.target };
    case "verify":
      return {
        step: "verify",
        mode: modeOf(state),
        target: event.target,
        ...(event.error ? { error: event.error } : {}),
      };
    case "detected":
      // Never interrupt a flow the user started.
      return state.step === "closed"
        ? {
            step: "detected",
            target: event.target,
            ...(event.previous ? { previous: event.previous } : {}),
          }
        : state;
    case "switch":
      return { step: "switch", target: event.target };
    case "merge":
      return { step: "merge", target: event.target, offer: event.offer };
    case "back":
      return {
        step: "choose",
        mode: modeOf(state),
        ...(event.error ? { error: event.error } : {}),
      };
    case "close":
      return CLOSED_SHEET;
  }
}
