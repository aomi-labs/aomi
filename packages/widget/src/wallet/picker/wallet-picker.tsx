"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronDownIcon,
  PlusIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@aomi-labs/react";
import { useAomiWalletKit } from "@/wallet/context";
import { formatWalletAddress, formatWalletProvider } from "@/wallet/identity";
import { signOutAndDisconnect } from "@/wallet/account/sign-out";
import { useWalletActivationGuard } from "@/wallet/use-wallet-activation-guard";
import { ModalBackdrop } from "@/ui/modal-backdrop";
import { useWidgetOverlay } from "@/ui/widget-scope";
import {
  useWalletPicker,
  WalletSignInOptionsContext,
} from "./wallet-picker-context";
import {
  providerBackedAccountProvider,
  providerBackedWalletTitle,
  sameWalletAddress,
  type WalletModalRow,
} from "./wallet-account-model";
import { isExpectedWalletCancellation } from "./wallet-cancellation";
import {
  buildWalletActions,
  filterQuickSignInOptions,
  GENERIC_BROWSER_WALLET_ID,
  isExternalHandoff,
  walletFamilyAliasKey,
  type WalletAction,
} from "./wallet-options";
import {
  ConnectedWalletRow,
  FinishSignInPanel,
  networkNameForChain,
  SectionLabel,
  SocialLoginRow,
  WalletActionRow,
  type ConnectedActionRef,
} from "./wallet-picker-rows";

export function WalletPicker() {
  const widgetOverlay = useWidgetOverlay();
  const { open, closePicker } = useWalletPicker();
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const canActivateWallet = useWalletActivationGuard();

  useEffect(() => {
    if (!open) {
      if (!pendingRef.current) setPending(null);
      setActionError(null);
      setAddOpen(false);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [open, closePicker]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<void> | void, guard = false) => {
      if (pendingRef.current) return;
      if (guard && !canActivateWallet()) return;
      pendingRef.current = true;
      setPending(key);
      setActionError(null);
      try {
        await fn();
      } catch (err) {
        if (isExpectedWalletCancellation(err)) return;
        console.warn("[WalletPicker] action failed", key, err);
        setActionError(
          err instanceof Error && err.message
            ? err.message
            : "Wallet action failed",
        );
      } finally {
        pendingRef.current = false;
        setPending(null);
      }
    },
    [canActivateWallet],
  );

  const walletRows = adapter.wallets;
  const connectedAccounts = useMemo(
    () => walletRows.filter((row) => row.connected),
    [walletRows],
  );
  const canManageAccounts = Boolean(
    adapter.openAccountUI && adapter.canOpenAccountUI,
  );

  const walletActions = useMemo(() => buildWalletActions(adapter), [adapter]);

  // Brands already connected, scoped by family. A connected EVM Phantom should
  // hide the EVM "add" row but still leave its Solana entry connectable.
  const connectedFamilyBrandKeys = useMemo(() => {
    const set = new Set<string>();
    for (const account of connectedAccounts) {
      const name = account.walletName ?? account.label ?? "";
      set.add(
        walletFamilyAliasKey({ id: name, label: name, family: account.family }),
      );
    }
    return set;
  }, [connectedAccounts]);

  const addableWalletActions = useMemo(
    () =>
      walletActions.filter(
        (wallet) =>
          wallet.kind !== "social" &&
          !wallet.actions.some((action) => action.kind === "authenticate") &&
          (wallet.id === GENERIC_BROWSER_WALLET_ID ||
            !connectedFamilyBrandKeys.has(walletFamilyAliasKey(wallet))),
      ),
    [walletActions, connectedFamilyBrandKeys],
  );

  const hostSignInOptions = useContext(WalletSignInOptionsContext);
  const socialLoginOptions = useMemo(
    () =>
      walletActions.filter(
        (action) =>
          action.kind === "social" ||
          action.actions.some((rowAction) => rowAction.kind === "authenticate"),
      ),
    [walletActions],
  );
  const sessionProvider = identity.sessionProvider ?? identity.embeddedProvider;
  const providerSignInOptions = useMemo(
    () => filterQuickSignInOptions(socialLoginOptions, sessionProvider),
    [sessionProvider, socialLoginOptions],
  );
  // Social sign-in goes through the account provider, so the row reads as that
  // provider brand with the method beneath.
  const providerBrandLabel = formatWalletProvider(sessionProvider);
  const hasConnectedWallets = connectedAccounts.length > 0;
  // The provider sign-in row shows whenever the provider itself is not signed
  // in, even alongside external wallets, and hides once that account exists.
  const providerAccountConnected = Boolean(
    identity.walletProviderSubject ||
    connectedAccounts.some((account) => account.manageable),
  );
  const recoveringAccountConflict = Boolean(adapter.accountConflict);
  const supportedEvmChains =
    adapter.supportedNetworks?.evm ?? adapter.supportedChains ?? [];
  // Host provider choices: while no provider account exists they are ways to
  // sign in. Once one is connected, the connected provider disappears and the
  // remaining choices become ways to link another provider.
  const socialOptionsToShow: WalletAction[] = hostSignInOptions.length
    ? hostSignInOptions
        .filter(
          (option) =>
            !providerAccountConnected || option.id !== sessionProvider,
        )
        .map((option) => ({
          ...option,
          family: "evm",
          source: "option",
          status: option.ready === false ? "unavailable" : "available",
          provider: option.id,
          actionKey: `social:${option.id}`,
          actions: [
            {
              kind: "authenticate",
              label:
                providerAccountConnected && !recoveringAccountConflict
                  ? "Link"
                  : "Sign in",
            },
          ],
        }))
    : providerAccountConnected
      ? []
      : providerSignInOptions;
  const socialSectionLabel = recoveringAccountConflict
    ? "Sign in another way"
    : providerAccountConnected
      ? "Link another provider"
      : "Other ways to sign in";
  const needsFirstWalletLink = Boolean(
    hasConnectedWallets && !adapter.accountUser,
  );
  const pickerTitle = recoveringAccountConflict
    ? "Resolve account conflict"
    : needsFirstWalletLink
      ? "Finish signing in"
      : adapter.accountUser || hasConnectedWallets
        ? "Add a wallet"
        : "Sign in to Aomi";
  const pickerDescription = recoveringAccountConflict
    ? "Sign in another way to open the account that owns this wallet."
    : needsFirstWalletLink
      ? "Verify the connected wallet to finish setting up your account."
      : adapter.accountUser || hasConnectedWallets
        ? "Connect another wallet to this account."
        : "Choose a wallet or another sign-in method.";

  const signOutAccount = useCallback(
    () => signOutAndDisconnect(adapter),
    [adapter],
  );

  const quickSignInSection = socialOptionsToShow.length ? (
    <section className="flex flex-col gap-2">
      <SectionLabel>{socialSectionLabel}</SectionLabel>
      <div className="border-aomi-border divide-aomi-border divide-y overflow-hidden rounded-xl border">
        {socialOptionsToShow.map((option) => (
          <SocialLoginRow
            key={option.id}
            option={option}
            pending={pending}
            brandLabel={
              formatWalletProvider(option.provider) ?? providerBrandLabel
            }
            onClick={() =>
              void runAction(`social:${option.id}`, async () => {
                await option.connect();
                closePicker();
              })
            }
          />
        ))}
      </div>
    </section>
  ) : null;

  const filterRowActions = (account: WalletModalRow) =>
    account.actions.filter((action) => {
      if (action.kind === "manage") return canManageAccounts;
      if (action.kind === "link") {
        return Boolean(
          adapter.linkWallet &&
          (account.family === "evm" || account.family === "svm"),
        );
      }
      if (action.kind === "disconnect" || action.kind === "signout") {
        return Boolean(adapter.disconnect || adapter.signOutAccount);
      }
      return false;
    });

  const runConnectedAction = ({ action, account }: ConnectedActionRef) => {
    const actionKey = `${action.kind}:${account.connectionId ?? account.key}`;
    if (action.kind === "manage") {
      void runAction(actionKey, async () => {
        await adapter.openAccountUI?.({
          family: account.family,
        });
        closePicker();
      });
      return;
    }
    if (action.kind === "link") {
      void runAction(actionKey, async () => {
        await adapter.linkWallet!({
          accountId: account.connectionId,
          family: account.family,
          address: account.address,
          chainId: account.chainId,
        });
        closePicker();
      });
      return;
    }
    if (action.kind === "signout") {
      void runAction(actionKey, signOutAccount, true);
      return;
    }
    if (action.kind === "disconnect") {
      void runAction(
        actionKey,
        () => disconnectConnectedAccount(account),
        true,
      );
    }
  };

  const disconnectConnectedAccount = (account: WalletModalRow) =>
    adapter.disconnect!({
      ...(account.family === "evm"
        ? { accountId: account.connectionId }
        : { family: "svm" as const }),
    });

  const renderConnectedAccount = (account: WalletModalRow) => {
    const provider = providerBackedAccountProvider(account);
    const title = providerBackedWalletTitle(account);

    const svmCluster = identity.svmCluster?.replace("solana:", "");
    const detail =
      account.family === "evm"
        ? (networkNameForChain(account.chainId, supportedEvmChains) ??
          networkNameForChain(identity.chainId, supportedEvmChains) ??
          undefined)
        : svmCluster
          ? svmCluster.charAt(0).toUpperCase() + svmCluster.slice(1)
          : undefined;

    const linkedWallet = (adapter.accountWallets ?? []).find(
      (wallet) =>
        wallet.family === account.family &&
        sameWalletAddress(wallet.family, wallet.address, account.address),
    );
    const capability = account.capability ?? linkedWallet?.capability;
    const addressText =
      account.label ?? formatWalletAddress(account.address ?? "") ?? "";

    const active = account.operating;
    const selectable = account.actions.some(
      (action) => action.kind === "select",
    );

    const actions: ConnectedActionRef[] = [];
    for (const action of filterRowActions(account)) {
      actions.push({ action, account });
    }

    const providerHint =
      provider !== null
        ? provider
        : account.manageable
          ? (identity.embeddedProvider ?? identity.sessionProvider)
          : undefined;

    return (
      <ConnectedWalletRow
        key={`row:${account.key}`}
        title={title}
        iconId={
          provider !== null ? provider : (account.connectionId ?? account.key)
        }
        iconLabel={title}
        iconProvider={provider ?? providerHint}
        family={account.family}
        capability={capability}
        addressText={addressText}
        detail={detail}
        active={active}
        selectKey={selectable ? `select:${account.connectionId}` : undefined}
        pending={pending}
        onSelect={
          selectable
            ? () =>
                void runAction(
                  `select:${account.connectionId}`,
                  () => adapter.selectAccount(account.connectionId!),
                  true,
                )
            : undefined
        }
        actions={actions}
        onAction={runConnectedAction}
      />
    );
  };

  const connectedSection = hasConnectedWallets ? (
    <section className="flex flex-col gap-2">
      <SectionLabel>Connected on this device</SectionLabel>
      <div className="border-aomi-border divide-aomi-border divide-y overflow-hidden rounded-xl border">
        {connectedAccounts.map(renderConnectedAccount)}
      </div>
    </section>
  ) : null;

  const finishAccount = needsFirstWalletLink
    ? (connectedAccounts.find((account) =>
        account.actions.some((action) => action.kind === "link"),
      ) ?? connectedAccounts[0])
    : undefined;
  const finishLinkAction = finishAccount?.actions.find(
    (action) => action.kind === "link",
  );
  const showFinishPanel = Boolean(
    needsFirstWalletLink &&
    connectedAccounts.length === 1 &&
    finishAccount &&
    finishLinkAction,
  );

  const renderWalletActionRow = (wallet: WalletAction) => (
    <WalletActionRow
      key={`${wallet.family}:${wallet.id}`}
      wallet={wallet}
      pending={pending}
      linkedMode={Boolean(adapter.accountUser) || hasConnectedWallets}
      onClick={() =>
        void runAction(
          wallet.actionKey,
          async () => {
            await wallet.connect();
            // WalletConnect/provider handoffs open their own surface, so the
            // picker steps aside. Direct connects stay open — the new wallet
            // simply appears in the connected list — and the add-list collapses.
            if (isExternalHandoff(wallet)) {
              closePicker();
            } else {
              setAddOpen(false);
            }
          },
          true,
        )
      }
    />
  );

  // Connect options render as one flat list — EVM brands, then Solana brands,
  // then the generic browser-wallet row — with no separators between families.
  const renderGroupedActions = (actions: WalletAction[]) => {
    const ordered = [
      ...actions.filter(
        (a) => a.family === "evm" && a.id !== GENERIC_BROWSER_WALLET_ID,
      ),
      ...actions.filter((a) => a.family === "svm"),
      ...actions.filter((a) => a.family !== "evm" && a.family !== "svm"),
      ...actions.filter((a) => a.id === GENERIC_BROWSER_WALLET_ID),
    ];
    return ordered.map(renderWalletActionRow);
  };

  const addWalletSection = addableWalletActions.length ? (
    hasConnectedWallets ? (
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setAddOpen((value) => !value)}
          aria-expanded={addOpen}
          aria-label="Add another wallet"
          className="border-aomi-border bg-aomi-bg/20 hover:bg-aomi-hover flex items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition-colors"
        >
          <span className="text-aomi-muted flex size-9 shrink-0 items-center justify-center">
            <PlusIcon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              Add another wallet
            </span>
            <span className="text-aomi-muted block truncate text-[11px]">
              Choose a different EVM or SVM wallet
            </span>
          </span>
          <ChevronDownIcon
            className={cn(
              "text-aomi-muted size-4 shrink-0 transition-transform duration-300 ease-out",
              addOpen && "rotate-180",
            )}
          />
        </button>
        <div
          aria-hidden={!addOpen}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
            addOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="border-aomi-border divide-aomi-border mt-0.5 divide-y overflow-hidden rounded-[14px] border">
              {renderGroupedActions(addableWalletActions)}
            </div>
          </div>
        </div>
      </section>
    ) : (
      <section className="flex flex-col gap-2">
        <SectionLabel>Choose a wallet</SectionLabel>
        <div className="border-aomi-border divide-aomi-border divide-y overflow-hidden rounded-[14px] border">
          {renderGroupedActions(addableWalletActions)}
        </div>
      </section>
    )
  ) : null;

  if (!open) return null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) closePicker();
      }}
      modal={false}
    >
      <Dialog.Portal container={widgetOverlay}>
        {/* Register above the mobile sidebar's dismiss/focus layer. Keep external
            wallet-provider dialogs usable while their connection is pending. */}
        <Dialog.Content
          onOpenAutoFocus={() => {
            openerRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (openerRef.current?.isConnected) openerRef.current.focus();
            openerRef.current = null;
          }}
          aria-modal="true"
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
          className="animate-in fade-in-0 pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center px-4 py-4 outline-none duration-150"
        >
          <ModalBackdrop aria-label="Close" onClick={closePicker} />
          <div
            className={cn(
              "relative z-10 flex max-h-[min(720px,92vh)] w-full max-w-[460px] flex-col overflow-hidden",
              "border-aomi-border bg-aomi-raised text-aomi-fg rounded-[22px] border text-left shadow-[0_24px_70px_rgba(20,24,32,0.18)]",
              "animate-in zoom-in-95 fade-in-0 duration-200",
            )}
          >
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-aomi-border flex items-center gap-3 border-b px-4 py-4">
                <span className="text-aomi-accent flex size-9 shrink-0 items-center justify-center">
                  <ShieldCheckIcon className="size-5" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-aomi-muted text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Aomi account
                  </span>
                  <Dialog.Title asChild>
                    <h2 className="text-aomi-fg text-[15px] font-semibold tracking-[-0.01em]">
                      {pickerTitle}
                    </h2>
                  </Dialog.Title>
                  <p className="text-aomi-muted mt-0.5 truncate text-[11px] leading-snug">
                    {pickerDescription}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePicker}
                  aria-label="Close"
                  className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
                >
                  <XIcon className="size-4" />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
                {actionError || adapter.accountError ? (
                  <div
                    role="alert"
                    className="border-destructive/25 bg-destructive/10 text-destructive rounded-xl border px-3 py-2 text-xs leading-snug"
                  >
                    {actionError ?? adapter.accountError}
                  </div>
                ) : null}
                {showFinishPanel && finishAccount ? (
                  <>
                    <FinishSignInPanel
                      account={finishAccount}
                      identity={identity}
                      supportedEvmChains={supportedEvmChains}
                      pending={pending}
                      linkAction={finishLinkAction}
                      onLink={runConnectedAction}
                      canDisconnect={Boolean(adapter.disconnect)}
                      onDisconnect={() =>
                        void runAction(
                          `disconnect:${finishAccount.connectionId ?? finishAccount.key}`,
                          () => disconnectConnectedAccount(finishAccount),
                          true,
                        )
                      }
                    />
                    {quickSignInSection}
                    {addWalletSection}
                  </>
                ) : hasConnectedWallets ? (
                  <>
                    {connectedSection}
                    {quickSignInSection}
                    {addWalletSection}
                  </>
                ) : (
                  <>
                    {quickSignInSection}
                    {addWalletSection}
                  </>
                )}
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
