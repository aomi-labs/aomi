"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { useOptionalAomiRuntime } from "@aomi-labs/react";
import type { AomiWalletKit, WalletFamily } from "@/wallet/types";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import { mergeOfferFrom } from "@/wallet/account/aomi-backend-client";
import { walletKey } from "@/wallet/wallet-utils";
import { formatWalletProvider } from "@/wallet/identity";
import { isExpectedWalletCancellation } from "./wallet-cancellation";
import { useWalletActivationGuard } from "@/wallet/use-wallet-activation-guard";
import {
  buildWalletChoices,
  sameWalletBrand,
  type WalletChoice,
} from "./wallet-options";
import type { SheetRequest } from "./sheet-channel";
import type {
  SheetEvent,
  SheetMode,
  SheetState,
  SheetTarget,
} from "./sheet-machine";
import { WalletSignInOptionsContext } from "./sign-in-options";

// External wallets answer a connect within seconds; a Solana adapter waits on
// its own popup, which can take as long as the user does.
const CONNECT_WAIT_MS: Record<WalletFamily, number> = {
  evm: 10_000,
  svm: 120_000,
};

export type WalletAppSwitch = { row: WalletRow; previous?: WalletRow };

function toTarget(row: WalletRow): SheetTarget {
  return {
    family: row.family,
    address: row.address,
    ...(row.brand ? { brand: row.brand } : {}),
    ...(row.connectionId ? { accountId: row.connectionId } : {}),
    ...(row.chainId ? { chainId: row.chainId } : {}),
  };
}

const MERGE_ERRORS: Record<string, string> = {
  merge_ticket_invalid:
    "This offer expired. Sign the message again to get a new one.",
  account_merge_payment_in_progress:
    "Your last reply is still being billed — try again in a moment.",
  merge_switch_unavailable:
    "Switching isn’t available here. Merge, or sign in to that account directly.",
};

function mergeErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    (typeof code === "string" ? MERGE_ERRORS[code] : undefined) ??
    errorText(error, "The merge didn’t finish. Try again.")
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Everything the wallet sheet does: connect then sign in one gesture, fall
 * back to Verify, wait for a wallet app to switch, and offer a merge.
 */
export function useSheetFlow(
  kit: AomiWalletKit,
  sheet: SheetState,
  dispatch: Dispatch<SheetEvent>,
) {
  const kitRef = useRef(kit);
  kitRef.current = kit;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const hostOptions = useContext(WalletSignInOptionsContext);
  const hostOptionsRef = useRef(hostOptions);
  hostOptionsRef.current = hostOptions;
  const runtime = useOptionalAomiRuntime();
  const refreshAccountRef = useRef(runtime?.refreshAccountData);
  refreshAccountRef.current = runtime?.refreshAccountData;
  const canActivateWallet = useWalletActivationGuard();
  const canActivateRef = useRef(canActivateWallet);
  canActivateRef.current = canActivateWallet;
  // Each flow takes a token; closing the sheet or starting another drops it.
  const flowToken = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Waiters re-check the latest kit after every change it publishes.
  const waiters = useRef(new Set<() => void>());
  useEffect(() => {
    for (const check of [...waiters.current]) check();
  }, [kit]);
  const waitFor = useCallback(
    <T>(pick: (kit: AomiWalletKit) => T | undefined, timeoutMs: number) =>
      new Promise<T>((resolve, reject) => {
        const done = () => {
          window.clearTimeout(timer);
          waiters.current.delete(check);
        };
        const check = () => {
          const value = pick(kitRef.current);
          if (value === undefined) return;
          done();
          resolve(value);
        };
        const timer = window.setTimeout(() => {
          done();
          reject(new Error("timeout"));
        }, timeoutMs);
        waiters.current.add(check);
        check();
      }),
    [],
  );

  const start = useCallback(() => {
    setError(null);
    const token = ++flowToken.current;
    return () =>
      token === flowToken.current && sheetRef.current.step !== "closed";
  }, []);

  const close = useCallback(() => {
    flowToken.current++;
    setBusy(false);
    setError(null);
    dispatch({ type: "close" });
  }, [dispatch]);

  const open = useCallback(
    (mode?: SheetMode) => {
      start();
      const current = kitRef.current;
      if (mode) {
        dispatch({
          type: "open",
          mode: current.accountUser ? mode : "sign-in",
        });
        return;
      }
      if (current.accountUser) {
        dispatch({ type: "open", mode: "add" });
        return;
      }
      // Signed out with a wallet still connected: go straight to its Verify.
      const connected = current.wallets.find(
        (row) => row.state === "guest" && row.kind === "external",
      );
      dispatch(
        connected
          ? { type: "verify", target: toTarget(connected) }
          : { type: "open", mode: "sign-in" },
      );
    },
    [dispatch, start],
  );

  /** Sign in with, or add, the address; a dismissed prompt falls back to Verify. */
  const sign = useCallback(
    async (target: SheetTarget) => {
      const live = start();
      dispatch({ type: "sign", target });
      try {
        const linkWallet = kitRef.current.linkWallet;
        if (!linkWallet)
          throw new Error("Signing in with a wallet isn't available here.");
        await linkWallet({
          accountId: target.accountId,
          family: target.family,
          address: target.address,
          chainId: target.chainId,
        });
        if (live()) close();
      } catch (cause) {
        if (!live()) return;
        const offer = mergeOfferFrom(cause);
        if (offer) {
          dispatch({ type: "merge", target, offer });
          return;
        }
        dispatch({
          type: "verify",
          target,
          ...(isExpectedWalletCancellation(cause)
            ? {}
            : { error: errorText(cause, "Signing didn't finish.") }),
        });
      }
    },
    [close, dispatch, start],
  );

  /** Connect the app, then sign at once; an address already in the account just becomes Active. */
  const connectAndSign = useCallback(
    async (
      choice: WalletChoice,
      family: WalletFamily,
      expected?: SheetTarget,
    ) => {
      // Never swap wallets under a transaction waiting for approval.
      if (!canActivateRef.current()) return;
      const live = start();
      const option = choice.options[family];
      if (!option) return;
      dispatch({
        type: "connect",
        brand: choice.label,
        ...(expected ? { expected } : {}),
      });
      const appRow = (current: AomiWalletKit) =>
        current.wallets.find(
          (row) =>
            row.family === family &&
            Boolean(row.connectionId) &&
            sameWalletBrand(row.brand ?? row.walletName, choice.label),
        );
      const before = new Set(
        kitRef.current.wallets
          .filter((row) => row.connectionId)
          .map((row) => row.key),
      );
      let row = appRow(kitRef.current);
      try {
        if (!row) {
          await option.connect();
          row = await waitFor(
            (current) =>
              current.wallets.find(
                (candidate) =>
                  candidate.family === family &&
                  Boolean(candidate.connectionId) &&
                  !before.has(candidate.key),
              ) ?? appRow(current),
            CONNECT_WAIT_MS[family],
          ).catch(() => appRow(kitRef.current));
        }
      } catch (cause) {
        if (!live()) return;
        dispatch({
          type: "back",
          ...(isExpectedWalletCancellation(cause)
            ? {}
            : { error: errorText(cause, `Couldn’t connect ${choice.label}.`) }),
        });
        return;
      }
      if (!live()) return;
      if (!row) {
        dispatch({ type: "back", error: `Couldn’t connect ${choice.label}.` });
        return;
      }
      if (
        expected &&
        walletKey(row.family, row.address) !==
          walletKey(expected.family, expected.address)
      ) {
        dispatch({ type: "switch", target: expected });
        return;
      }
      if (row.linked) {
        if (row.state === "ready" && !row.operating && row.connectionId)
          await kitRef.current.selectAccount(row.connectionId);
        if (live()) close();
        return;
      }
      await sign(toTarget(row));
    },
    [close, dispatch, sign, start, waitFor],
  );

  const pick = useCallback(
    (choice: WalletChoice) => {
      if (choice.families.length > 1) {
        dispatch({
          type: "pick",
          wallet: choice.id,
          brand: choice.label,
          families: choice.families,
        });
        return;
      }
      void connectAndSign(choice, choice.families[0]!);
    },
    [connectAndSign, dispatch],
  );

  const pickChain = useCallback(
    (family: WalletFamily) => {
      const current = sheetRef.current;
      if (current.step !== "chain") return;
      const choice = buildWalletChoices(kitRef.current).find(
        (candidate) => candidate.id === current.wallet,
      );
      if (choice) void connectAndSign(choice, family);
    },
    [connectAndSign],
  );

  /** Privy or Para: their own modal takes over, so the sheet steps aside. */
  const pickSocial = useCallback(
    async (connect: () => Promise<void>) => {
      const live = start();
      setBusy(true);
      try {
        await connect();
        // A merge offer for this login may already own the sheet.
        if (live()) close();
      } catch (cause) {
        setBusy(false);
        if (!isExpectedWalletCancellation(cause))
          setError(errorText(cause, "Sign-in didn't open."));
      }
    },
    [close, start],
  );

  const runMerge = useCallback(
    async (action: "merge" | "switch") => {
      const current = sheetRef.current;
      if (current.step !== "merge") return;
      const live = start();
      setBusy(true);
      try {
        if (action === "merge") {
          const result = await kitRef.current.mergeAccount?.(
            current.offer.ticket,
          );
          if (result) refreshAccountRef.current?.();
        } else {
          await kitRef.current.switchToMergeSource?.(current.offer.ticket);
        }
        if (live()) close();
      } catch (cause) {
        if (!live()) return;
        setBusy(false);
        setError(mergeErrorText(cause));
      }
    },
    [close, start],
  );

  // Signing out drops whatever the sheet was doing for the old account.
  const accountId = kit.accountUser?.id;
  const signedInAs = useRef(accountId);
  useEffect(() => {
    const previous = signedInAs.current;
    signedInAs.current = accountId;
    if (previous && !accountId) close();
  }, [accountId, close]);

  // Adding Privy or Para links it after their own modal closes; when that
  // login opens another account, offer the merge here, once per offer.
  const providerOffer = kit.accountConflict?.mergeOffer;
  const providerOfferFor = kit.accountConflict?.provider;
  const shownOffer = useRef<string | null>(null);
  useEffect(() => {
    if (!providerOffer || !providerOfferFor || !accountId) return;
    if (shownOffer.current === providerOffer.ticket) return;
    shownOffer.current = providerOffer.ticket;
    start();
    setBusy(false);
    // A login has no address of its own; the sheet names the provider.
    const label = formatWalletProvider(providerOfferFor) ?? providerOfferFor;
    dispatch({
      type: "merge",
      target: { family: "evm", address: label, brand: label },
      offer: providerOffer,
    });
  }, [accountId, dispatch, providerOffer, providerOfferFor, start]);

  // The switch card completes on its own once the wallet shows the address.
  const switched = useRef<string | null>(null);
  useEffect(() => {
    if (sheet.step !== "switch") {
      switched.current = null;
      return;
    }
    const key = walletKey(sheet.target.family, sheet.target.address);
    const row = kit.wallets.find((wallet) => wallet.key === key);
    if (row?.state !== "ready" || !kit.activateWallet) return;
    if (switched.current === key) return;
    switched.current = key;
    const live = start();
    void kit.activateWallet(key).finally(() => {
      if (live()) close();
    });
  }, [close, kit, sheet, start]);

  const handleRequest = useCallback(
    (request: SheetRequest) => {
      const current = kitRef.current;
      if (request.kind === "add") {
        open("add");
        return;
      }
      if (request.kind === "verify") {
        if (current.unlinkedWallet) void sign(toTarget(current.unlinkedWallet));
        return;
      }
      const row = current.wallets.find((wallet) => wallet.key === request.key);
      if (!row) return;
      if (request.kind === "switch") {
        start();
        dispatch({ type: "switch", target: toTarget(row) });
        return;
      }
      if (row.kind === "embedded" && row.provider) {
        const provider = row.provider;
        const option = hostOptionsRef.current.find(
          (candidate) => candidate.id === provider,
        );
        void (option ? option.connect() : current.connectSocial?.(provider));
        return;
      }
      const choice = buildWalletChoices(current).find((candidate) =>
        sameWalletBrand(candidate.label, row.brand),
      );
      if (!choice?.options[row.family]) {
        open("add");
        return;
      }
      void connectAndSign(choice, row.family, toTarget(row));
    },
    [connectAndSign, dispatch, open, sign, start],
  );

  const putOff = useRef(new Set<string>());
  const handleAppSwitch = useCallback(
    ({ row, previous }: WalletAppSwitch) => {
      const current = kitRef.current;
      // Signed out, the chip offers sign-in; an account switch asks nothing.
      if (!current.accountUser) return;
      if (row.state === "ready" && current.activateWallet) {
        void current.activateWallet(row.key);
        return;
      }
      // "Not now" only stops this sheet; the Verify row and badge stay.
      if (row.state === "unlinked" && !putOff.current.has(row.key)) {
        dispatch({
          type: "detected",
          target: toTarget(row),
          ...(previous ? { previous: previous.address } : {}),
        });
      }
    },
    [dispatch],
  );

  return useMemo(
    () => ({
      busy,
      error,
      open: () => open(),
      close,
      notNow: () => {
        const current = sheetRef.current;
        if (current.step === "detected")
          putOff.current.add(
            walletKey(current.target.family, current.target.address),
          );
        close();
      },
      back: () => dispatch({ type: "back" }),
      pick,
      pickChain,
      pickSocial,
      sign,
      merge: () => runMerge("merge"),
      switchInstead: () => runMerge("switch"),
      handleRequest,
      handleAppSwitch,
    }),
    [
      busy,
      close,
      dispatch,
      error,
      handleAppSwitch,
      handleRequest,
      open,
      pick,
      pickChain,
      pickSocial,
      runMerge,
      sign,
    ],
  );
}

export type SheetFlow = ReturnType<typeof useSheetFlow>;
