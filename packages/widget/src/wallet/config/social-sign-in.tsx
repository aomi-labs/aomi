"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WalletAuthStore } from "@/wallet/providers/auth-store";
import { getWalletProvider } from "@/wallet/providers/plugin-registry";
import { WalletSignInOptionsContext } from "@/wallet/picker/wallet-picker-context";
import { formatWalletProvider } from "@/wallet/identity";
import { useAomiWalletKit } from "@/wallet/context";
import { isExpectedWalletCancellation } from "@/wallet/picker/wallet-cancellation";
import type { AomiWalletKit } from "@/wallet/types";

// How long a click waits for a provider SDK that is still starting.
const LOGIN_OPEN_TIMEOUT_MS = 15_000;

type WaitingLogin = { provider: string; timer: number };

/** The active provider's runtime can open its login now. */
function canOpenLogin(kit: AomiWalletKit, provider: string): boolean {
  return Boolean(
    kit.isReady &&
    !kit.isSettling &&
    kit.identity.sessionProvider === provider &&
    kit.connectSocial,
  );
}

/**
 * Privy and Para sign-in. Opening the sheet warms each provider SDK, and a
 * warm SDK stays mounted. Login always opens through the active provider's
 * runtime (`connectSocial`), which first prepares the wallet registry for the
 * new session: inside the click when that runtime is up, otherwise once it
 * is. A provider that cannot start reports an error inside the widget.
 */
export function useSocialSignIn(store: WalletAuthStore, active?: string) {
  const [warmProviders, setWarmProviders] = useState<readonly string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [waitingVersion, setWaitingVersion] = useState(0);
  const waiting = useRef<WaitingLogin | null>(null);
  const shellFailures = useRef(new Map<string, string>());
  const activeRef = useRef(active);
  activeRef.current = active;

  const warm = useCallback((provider: string) => {
    if (!getWalletProvider(provider)) return;
    setWarmProviders((current) =>
      current.includes(provider) ? current : [...current, provider],
    );
  }, []);

  const fail = useCallback(
    (provider: string, message: string) => {
      const pending = waiting.current;
      if (pending?.provider === provider) {
        waiting.current = null;
        window.clearTimeout(pending.timer);
      }
      if (pending?.provider === provider || activeRef.current === provider)
        store.publishFailure(message);
    },
    [store],
  );

  const open = useCallback(
    (kit: AomiWalletKit, provider: string) => {
      void kit.connectSocial!(provider).catch((error: unknown) => {
        if (isExpectedWalletCancellation(error)) return;
        store.publishFailure(
          `Couldn’t open ${formatWalletProvider(provider) ?? provider}. Choose it again to retry.`,
        );
      });
    },
    [store],
  );

  /** Opens a waiting login once its provider is active and its runtime is up. */
  const openWaiting = useCallback(
    (kit: AomiWalletKit) => {
      const pending = waiting.current;
      if (!pending || activeRef.current !== pending.provider) return;
      if (!canOpenLogin(kit, pending.provider)) return;
      waiting.current = null;
      window.clearTimeout(pending.timer);
      open(kit, pending.provider);
    },
    [open],
  );

  const onFailure = useCallback(
    (provider: string, message: string | null) => {
      const previous = shellFailures.current.get(provider);
      if (message) {
        shellFailures.current.set(provider, message);
        fail(provider, message);
        return;
      }
      shellFailures.current.delete(provider);
      if (previous && store.getSnapshot().failure === previous)
        store.publishFailure(null);
    },
    [fail, store],
  );

  const start = useCallback(
    (provider: string): void => {
      warm(provider);
      const superseded = waiting.current;
      if (superseded) {
        waiting.current = null;
        window.clearTimeout(superseded.timer);
      }
      // A failed SDK is remounted; its login opens once it is up again.
      const failed = Boolean(store.getSnapshot().failure);
      if (failed) {
        store.publishFailure(null);
        setAttempt((value) => value + 1);
      }
      const kit = store.getSnapshot().kit;
      if (
        !failed &&
        activeRef.current === provider &&
        canOpenLogin(kit, provider)
      ) {
        open(kit, provider);
        return;
      }
      // Not active or still starting: the sheet steps aside now, and the
      // provider's own modal opens over the page once its runtime is up.
      const timer = window.setTimeout(
        () =>
          fail(
            provider,
            `Couldn’t open ${formatWalletProvider(provider) ?? provider}. Check your connection and try again.`,
          ),
        LOGIN_OPEN_TIMEOUT_MS,
      );
      waiting.current = { provider, timer };
      setWaitingVersion((value) => value + 1);
    },
    [fail, open, store, warm],
  );

  return {
    attempt,
    warmProviders,
    waitingVersion,
    warm,
    start,
    fail,
    onFailure,
    openWaiting,
  };
}

export type SocialSignIn = ReturnType<typeof useSocialSignIn>;

/**
 * Opens a waiting login from an effect after the kit publishes a ready
 * runtime, as the host did before provider SDKs stayed mounted: by then the
 * runtime has run its first effects and the login lands on a settled SDK.
 */
export function SocialLoginOpener({
  signIn,
}: {
  signIn: Pick<SocialSignIn, "openWaiting" | "waitingVersion">;
}) {
  const kit = useAomiWalletKit();
  const { openWaiting, waitingVersion } = signIn;
  useEffect(() => {
    openWaiting(kit);
  }, [kit, openWaiting, waitingVersion]);
  return null;
}

/**
 * The host lists which providers to offer and records the choice; the kit
 * warms their SDKs and opens their login.
 */
export function SocialSignInOptions({
  signIn,
  children,
}: {
  signIn: Pick<SocialSignIn, "start" | "warm">;
  children: ReactNode;
}) {
  const hostOptions = useContext(WalletSignInOptionsContext);
  const { start, warm } = signIn;
  const options = useMemo(
    () =>
      hostOptions.map((option) =>
        getWalletProvider(option.id)
          ? {
              ...option,
              preload: () => warm(option.id),
              connect: async () => {
                start(option.id);
                await option.connect();
              },
            }
          : option,
      ),
    [hostOptions, start, warm],
  );
  return (
    <WalletSignInOptionsContext.Provider value={options}>
      {children}
    </WalletSignInOptionsContext.Provider>
  );
}
