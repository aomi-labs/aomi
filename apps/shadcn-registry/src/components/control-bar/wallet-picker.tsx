"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type SVGProps,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LinkIcon,
  Loader2Icon,
  LogOutIcon,
  MailIcon,
  PlusIcon,
  Settings2Icon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import {
  useAomiWalletKit,
  canonicalWalletKey,
  formatWalletAddress,
  formatWalletProvider,
  normalizeWalletOptionId,
  signOutAndDisconnect,
  useWalletActivationGuard,
} from "../../lib/wallet-kit";
import type { AomiWalletKit, WalletFamily } from "../../lib/wallet-kit/types";
import type { WalletAction as WalletRowAction } from "../../lib/wallet-kit/composer/wallet-state";
import { ModalBackdrop } from "../ui/modal-backdrop";
import { WalletIconSlot } from "./wallet-icon-slot";
import {
  useWalletPicker,
  WalletSignInOptionsContext,
} from "./wallet-picker-context";
import {
  familyLabel,
  providerBackedAccountProvider,
  providerBackedWalletTitle,
  sameWalletAddress,
  type WalletModalRow,
} from "./wallet-account-model";

type SupportedEvmChain = { id: number; name: string };
type ConnectedActionRef = {
  action: WalletRowAction;
  account: WalletModalRow;
};

type WalletAction = {
  id: string;
  provider?: string;
  label: string;
  family: WalletFamily;
  kind: "evm" | "solana" | "walletconnect" | "social";
  source: "option";
  status: "installed" | "available" | "qr" | "unavailable";
  actions: Array<{ kind: "connect" | "authenticate"; label: string }>;
  iconUrl?: string;
  actionKey: string;
  connect: () => Promise<void>;
  ready?: boolean;
  description?: string;
};

const GENERIC_BROWSER_WALLET_ID = "generic-browser-wallet";

function walletStatusLabel(option: WalletAction): string {
  if (option.status === "unavailable") return "Not installed";
  return "Ready";
}

function statusRank(option: WalletAction): number {
  if (option.status === "available") return 1;
  return 3;
}

function walletDisplayRank(option: WalletAction): number {
  const id = option.id.toLowerCase();
  const label = option.label.toLowerCase();
  if (id === GENERIC_BROWSER_WALLET_ID) return 30;
  if (id.includes("metamask") || label.includes("metamask")) return 0;
  if (id.includes("rabby") || label.includes("rabby")) return 1;
  if (id.includes("phantom") || label.includes("phantom")) return 2;
  if (id.includes("solflare") || label.includes("solflare")) return 3;
  if (id.includes("backpack") || label.includes("backpack")) return 4;
  if (id.includes("coinbase") || label.includes("coinbase")) return 5;
  if (id.includes("walletconnect") || label.includes("walletconnect")) return 6;
  return 20;
}

function walletAliasKey(wallet: Pick<WalletAction, "id" | "label">): string {
  const combined = `${wallet.id} ${wallet.label}`;
  const brandKey = canonicalWalletKey(combined);
  // canonicalWalletKey echoes the normalized input when no brand matched —
  // key on the label alone in that case so connector uids don't fragment it.
  return brandKey === normalizeWalletOptionId(combined)
    ? canonicalWalletKey(wallet.label)
    : brandKey;
}

/**
 * Dedup is family-scoped: a dual-chain wallet like Phantom must survive once as
 * an EVM option and once as a Solana option, so its Solana side stays reachable.
 */
function walletFamilyAliasKey(
  wallet: Pick<WalletAction, "id" | "label" | "family">,
): string {
  return `${wallet.family}:${walletAliasKey(wallet)}`;
}

function isGenericBrowserWallet(
  wallet: Pick<WalletAction, "provider" | "id" | "label">,
): boolean {
  const label = normalizeWalletOptionId(wallet.label);
  const id = normalizeWalletOptionId(wallet.id);
  const connectorId = normalizeWalletOptionId(wallet.provider ?? "");
  return (
    label === "browserwallet" || id === "injected" || connectorId === "injected"
  );
}

function dedupeWalletActions(actions: readonly WalletAction[]): WalletAction[] {
  const seen = new Set<string>();
  const result: WalletAction[] = [];

  for (const action of actions) {
    const key = walletFamilyAliasKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }

  return result;
}

function walletActionIsVisible(wallet: WalletAction): boolean {
  if (wallet.id === GENERIC_BROWSER_WALLET_ID) return true;
  if (wallet.status === "unavailable") return false;
  if (wallet.family === "evm" && wallet.status !== "available") {
    const key = canonicalWalletKey(`${wallet.id} ${wallet.label}`);
    return key === "coinbase" || key === "basewallet" || key === "base";
  }
  return true;
}

/**
 * Actions that open their own surface (WalletConnect QR, provider handoffs).
 * The picker should close immediately for these instead of flashing success.
 */
function isExternalHandoff(wallet: WalletAction): boolean {
  return wallet.kind === "walletconnect";
}

const EXPECTED_WALLET_CANCELLATION_PATTERNS = [
  "user rejected",
  "user denied",
  "user cancelled",
  "user canceled",
  "request cancelled by user",
  "request canceled by user",
  "connection request reset",
  "connection request rejected",
  "connection proposal expired",
  "walletconnect modal closed",
  "wallet connect modal closed",
] as const;

/** Wallet dismissal is a normal exit path, not an error the user must fix. */
function isExpectedWalletCancellation(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === "string") {
      const message = current.toLowerCase();
      if (
        EXPECTED_WALLET_CANCELLATION_PATTERNS.some((pattern) =>
          message.includes(pattern),
        )
      ) {
        return true;
      }
      continue;
    }
    if (typeof current !== "object") continue;

    const value = current as Record<string, unknown>;
    if (
      value.code === 4001 ||
      value.code === "4001" ||
      value.code === "ACTION_REJECTED" ||
      value.code === "USER_REJECTED"
    ) {
      return true;
    }

    for (const field of ["name", "message", "shortMessage", "details"]) {
      if (field in value) pending.push(value[field]);
    }
    if ("cause" in value) pending.push(value.cause);
  }

  return false;
}

export function WalletPicker() {
  const { open, closePicker } = useWalletPicker();
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const autoLinkAttempted = useRef(new Set<string>());
  const canActivateWallet = useWalletActivationGuard();

  useEffect(() => {
    if (!open) {
      setPending(null);
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
      if (guard && !canActivateWallet()) return;
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

  useEffect(() => {
    if (
      !open ||
      pending !== null ||
      !adapter.accountUser ||
      !adapter.linkWallet ||
      (adapter.accountWallets?.length ?? 0) > 0
    ) {
      return;
    }
    const target = connectedAccounts.find(
      (account) => account.state === "unlinked" && account.kind === "external",
    );
    if (!target?.address) return;
    const key = target.key;
    if (autoLinkAttempted.current.has(key)) return;
    autoLinkAttempted.current.add(key);
    void runAction(`link:${target.connectionId}`, () =>
      adapter.linkWallet!({
        accountId: target.connectionId,
        family: target.family,
        address: target.address!,
        chainId: target.chainId,
      }),
    );
  }, [
    adapter,
    adapter.accountUser,
    adapter.accountWallets,
    adapter.linkWallet,
    connectedAccounts,
    open,
    pending,
    runAction,
  ]);

  const walletActions = useMemo<WalletAction[]>(() => {
    const optionRows = [
      ...(adapter.evmWallets ?? []).map((option) => ({
        ...option,
        family: "evm" as const,
        status:
          option.status === "unavailable"
            ? ("unavailable" as const)
            : ("available" as const),
      })),
      ...(adapter.solanaWallets ?? []).map((option) => ({
        id: option.name,
        label: option.name,
        family: "svm" as const,
        kind: "solana" as const,
        status: option.ready
          ? ("available" as const)
          : ("unavailable" as const),
        iconUrl: option.iconUrl,
      })),
      ...(adapter.socialLoginOptions ?? []).map((option) => ({
        ...option,
        family: "evm" as const,
        status:
          option.status === "unavailable"
            ? ("unavailable" as const)
            : ("available" as const),
      })),
    ].map((row): WalletAction => {
      const authenticate = row.kind === "social";
      return {
        id: row.id,
        provider: "connectorId" in row ? row.connectorId : undefined,
        label: row.label,
        family: row.family,
        kind: row.kind,
        source: "option",
        status: row.status,
        actions: [
          {
            kind: authenticate ? "authenticate" : "connect",
            label: authenticate ? "Sign in" : "Connect",
          },
        ],
        iconUrl: row.iconUrl,
        ready: row.status !== "unavailable",
        description:
          row.kind === "social"
            ? "Fast account sign-in"
            : row.family === "svm"
              ? "Connect a Solana wallet"
              : "Connect an Ethereum wallet",
        actionKey: `${authenticate ? "authenticate" : "connect"}:${row.family}:${row.id}`,
        connect: async () => {
          if (authenticate) {
            if (adapter.connectSocial && row.kind === "social") {
              await adapter.connectSocial(row.id);
              return;
            }
            await adapter.connect({ family: row.family });
            return;
          }
          if (row.family === "svm") {
            if (adapter.connectSolanaWallet) {
              await adapter.connectSolanaWallet(row.id);
              return;
            }
            await adapter.connect({ family: "svm" });
            return;
          }
          if (adapter.connectEvmWallet) {
            await adapter.connectEvmWallet(row.id);
            return;
          }
          await adapter.connect({ family: "evm" });
        },
      };
    });
    const browserWallet = optionRows.find(isGenericBrowserWallet);
    const walletRowsWithoutBrowser = optionRows.filter(
      (wallet) => !isGenericBrowserWallet(wallet),
    );
    const genericBrowserWallet: WalletAction[] = adapter.canConnect
      ? [
          {
            id: GENERIC_BROWSER_WALLET_ID,
            provider: browserWallet?.provider ?? "injected",
            label: "Browser wallet",
            family: "evm",
            kind: "evm",
            source: "option",
            status: browserWallet?.status ?? "available",
            actions: [{ kind: "connect", label: "Connect" }],
            ready: browserWallet?.ready ?? true,
            iconUrl: browserWallet?.iconUrl,
            description: "Connect an Ethereum wallet",
            actionKey: "connect-browser-wallet",
            connect: async () => {
              if (browserWallet) {
                await browserWallet.connect();
                return;
              }
              if (adapter.connectEvmWallet) {
                await adapter.connectEvmWallet("injected");
                return;
              }
              await adapter.connect({ family: "evm" });
            },
          },
        ]
      : [];

    return dedupeWalletActions([
      ...walletRowsWithoutBrowser,
      ...genericBrowserWallet,
    ])
      .filter(walletActionIsVisible)
      .sort((a, b) => {
        const priority = walletDisplayRank(a) - walletDisplayRank(b);
        if (priority !== 0) return priority;
        return statusRank(a) - statusRank(b) || a.label.localeCompare(b.label);
      });
  }, [
    adapter,
    adapter.canConnect,
    adapter.connectEvmWallet,
    adapter.connectSolanaWallet,
    adapter.connectSocial,
    adapter.evmWallets,
    adapter.solanaWallets,
    adapter.socialLoginOptions,
  ]);

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
    hasConnectedWallets &&
    (!adapter.accountUser || (adapter.accountWallets?.length ?? 0) === 0),
  );
  const pickerTitle = recoveringAccountConflict
    ? "Resolve account conflict"
    : needsFirstWalletLink
      ? "Finish signing in"
      : hasConnectedWallets
        ? "Add a wallet"
        : "Sign in to Aomi";
  const pickerDescription = recoveringAccountConflict
    ? "Sign in another way to open the account that owns this wallet."
    : needsFirstWalletLink
      ? "Verify the connected wallet to finish setting up your account."
      : hasConnectedWallets
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
      linkedMode={hasConnectedWallets}
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
      <Dialog.Portal>
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

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="text-aomi-muted px-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]">
      {children}
    </span>
  );
}

function filterQuickSignInOptions(
  options: readonly WalletAction[],
  authProvider?: string,
): WalletAction[] {
  const seenSocialProviders = new Set<string>();

  return options.filter((option) => {
    const provider = quickSignInProvider(option, authProvider);
    if (option.kind === "social" && provider !== null) {
      if (seenSocialProviders.has(provider)) return false;
      seenSocialProviders.add(provider);
      return true;
    }
    return true;
  });
}

function quickSignInProvider(
  option: WalletAction,
  authProvider?: string,
): string | null {
  if (option.kind === "social") {
    return option.provider ?? authProvider ?? option.id;
  }
  return option.provider ?? null;
}

/**
 * Compact per-row indicator of the wallet's execution family (EVM vs SVM). The
 * chip stays neutral; a small family-tinted dot carries the colour cue so it
 * reads as intentional without a loud full-colour pill.
 */
function ChainTag({
  family,
  capability,
}: {
  family: WalletFamily;
  capability?: "read" | "write";
}) {
  const isSolana = family === "svm";
  const dotColor = capability === "read" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span
      className="text-muted-foreground/70 inline-flex min-w-0 shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
      title={isSolana ? "Solana (SVM)" : "Ethereum-compatible wallet"}
      data-wallet-access={capability === "read" ? "stored" : "connected"}
    >
      <span className={cn("size-1.5 rounded-full", dotColor)} />
      <span className="max-w-20 truncate">{isSolana ? "SVM" : "EVM"}</span>
    </span>
  );
}

function networkNameForChain(
  chainId: number | undefined,
  supportedEvmChains?: readonly SupportedEvmChain[],
): string | null {
  if (!chainId) return null;
  const configured = supportedEvmChains?.find((chain) => chain.id === chainId);
  if (configured) return configured.name;
  return supportedEvmChains && supportedEvmChains.length > 0
    ? null
    : (getChainInfo(chainId)?.name ?? null);
}

function FinishSignInPanel({
  account,
  identity,
  supportedEvmChains,
  pending,
  linkAction,
  onLink,
  canDisconnect,
  onDisconnect,
}: {
  account: WalletModalRow;
  identity: AomiWalletKit["identity"];
  supportedEvmChains: readonly SupportedEvmChain[];
  pending: string | null;
  linkAction?: WalletModalRow["actions"][number];
  onLink: (ref: ConnectedActionRef) => void;
  canDisconnect: boolean;
  onDisconnect: () => void;
}) {
  const provider = providerBackedAccountProvider(account);
  const title = providerBackedWalletTitle(account);
  const network =
    account.family === "evm"
      ? (networkNameForChain(account.chainId, supportedEvmChains) ??
        networkNameForChain(identity.chainId, supportedEvmChains) ??
        "Ethereum")
      : "Solana";
  const rowId = account.connectionId ?? account.key;
  const actionKey = linkAction ? `${linkAction.kind}:${rowId}` : undefined;
  const busy = actionKey != null && pending === actionKey;

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Connected wallet</SectionLabel>
      <div className="border-aomi-border bg-aomi-bg/20 overflow-hidden rounded-[14px] border">
        <div className="flex items-center gap-3 px-3 py-3">
          <WalletIconSlot
            id={provider ?? rowId}
            label={title}
            provider={provider ?? account.provider}
            className="!bg-transparent"
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-semibold">
                {title}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            </span>
            <span className="text-aomi-muted mt-0.5 block truncate text-xs">
              {[formatWalletAddress(account.address ?? ""), network]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          {canDisconnect ? (
            <RowIconButton
              icon={LogOutIcon}
              ariaLabel={`Disconnect ${familyLabel(account.family)} wallet`}
              disabled={pending !== null}
              loading={pending === `disconnect:${rowId}`}
              onClick={onDisconnect}
            />
          ) : null}
        </div>
        <div className="border-aomi-border border-t p-2.5">
          <button
            type="button"
            disabled={!linkAction || pending !== null}
            onClick={() =>
              linkAction && onLink({ action: linkAction, account })
            }
            className="bg-aomi-fg text-aomi-bg flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            {linkAction ? "Link wallet and sign in" : "Preparing sign-in…"}
          </button>
          <p className="text-aomi-muted mt-2 px-1 text-[10px] leading-snug">
            You’ll sign a message to prove this wallet is yours. No transaction
            is sent.
          </p>
        </div>
      </div>
    </section>
  );
}

function ConnectedWalletRow({
  title,
  iconId,
  iconLabel,
  iconProvider,
  family,
  capability,
  addressText,
  detail,
  active,
  selectKey,
  pending,
  onSelect,
  actions,
  onAction,
}: {
  title: string;
  iconId: string;
  iconLabel: string;
  iconProvider?: string;
  family: WalletFamily;
  capability?: "read" | "write";
  addressText: string;
  detail?: string;
  active: boolean;
  selectKey?: string;
  pending: string | null;
  onSelect?: () => void;
  actions: readonly ConnectedActionRef[];
  onAction: (ref: ConnectedActionRef) => void;
}) {
  const selectable = Boolean(onSelect);
  const isSelecting = selectKey != null && pending === selectKey;

  const inner = (
    <>
      <WalletIconSlot
        id={iconId}
        label={iconLabel}
        provider={iconProvider}
        className="!bg-transparent"
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{title}</span>
          <ChainTag family={family} capability={capability} />
          {active ? (
            <CheckIcon className="text-primary size-3.5 shrink-0" />
          ) : null}
        </span>
        <span className="text-muted-foreground block truncate text-[11px]">
          {[addressText, detail].filter(Boolean).join(" · ")}
        </span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "group flex items-center transition-colors duration-200",
        active ? "bg-emerald-500/[0.045]" : "bg-aomi-bg/25",
        selectable && "hover:bg-aomi-hover has-[:focus-visible]:bg-aomi-hover",
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          disabled={pending !== null}
          aria-label={`Make ${title} active`}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none",
            "disabled:cursor-default",
          )}
        >
          {inner}
          {isSelecting ? (
            <span className="ml-1 flex shrink-0 items-center">
              <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
            </span>
          ) : null}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
          {inner}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1 py-3 pl-1 pr-3">
        {actions.map(({ action, account }) =>
          action.kind === "link" ? (
            <button
              key={`${action.kind}:${account.connectionId ?? account.key}`}
              type="button"
              disabled={pending !== null}
              onClick={() => onAction({ action, account })}
              className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50"
            >
              {pending ===
              `${action.kind}:${account.connectionId ?? account.key}` ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <LinkIcon className="size-3.5" />
              )}
              Link wallet
            </button>
          ) : (
            <RowIconButton
              key={`${action.kind}:${account.connectionId ?? account.key}`}
              icon={action.kind === "manage" ? Settings2Icon : LogOutIcon}
              ariaLabel={
                action.kind === "manage"
                  ? `Manage ${title}`
                  : action.kind === "signout"
                    ? "Sign out"
                    : `Disconnect ${familyLabel(account.family)} wallet`
              }
              disabled={pending !== null}
              loading={
                pending ===
                `${action.kind}:${account.connectionId ?? account.key}`
              }
              onClick={() => onAction({ action, account })}
            />
          ),
        )}
      </div>
    </div>
  );
}

function WalletActionRow({
  wallet,
  pending,
  linkedMode,
  onClick,
}: {
  wallet: WalletAction;
  pending: string | null;
  linkedMode: boolean;
  onClick: () => void;
}) {
  const disabled = wallet.ready === false || pending !== null;
  const showStatus = wallet.status === "unavailable";
  const actionVerb = linkedMode ? "Link" : "Connect";
  const description =
    wallet.description ??
    (wallet.family === "svm"
      ? `${actionVerb} a Solana wallet`
      : `${actionVerb} an Ethereum wallet`);
  const visibleDescription = linkedMode
    ? description.replace(/^Connect /, "Link ")
    : description;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${actionVerb} ${wallet.label}`}
      className={cn(
        "bg-aomi-bg/20 hover:bg-aomi-hover flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <WalletIconSlot
        iconUrl={wallet.iconUrl}
        id={wallet.id}
        label={wallet.label}
        className="!bg-transparent"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {wallet.label}
        </span>
        <span className="text-aomi-muted block truncate text-[11px]">
          {visibleDescription}
        </span>
      </span>
      {showStatus ? (
        <span className="bg-aomi-surface-2 text-aomi-muted shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium">
          {walletStatusLabel(wallet)}
        </span>
      ) : null}
      {pending === wallet.actionKey ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRightIcon className="text-aomi-muted size-3.5 shrink-0" />
      )}
    </button>
  );
}

function SocialLoginRow({
  option,
  pending,
  brandLabel,
  onClick,
}: {
  option: WalletAction;
  pending: string | null;
  /** Account-provider brand (e.g. "Para") shown as the row title, with the
   * sign-in method ("Email or Google") beneath it. Falls back to the method
   * label + mail icon when the provider has no brand. */
  brandLabel?: string;
  onClick: () => void;
}) {
  const title = brandLabel ?? option.label;
  const subtitle =
    brandLabel && brandLabel !== option.label
      ? option.label
      : (option.description ?? "Use an Aomi account");
  return (
    <button
      type="button"
      disabled={pending !== null || option.ready === false}
      onClick={onClick}
      aria-label={option.label}
      className={cn(
        "bg-aomi-bg/20 hover:bg-aomi-hover flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {brandLabel ? (
        <WalletIconSlot
          id={brandLabel}
          label={brandLabel}
          className="!bg-transparent"
        />
      ) : (
        <span className="text-aomi-muted flex size-9 shrink-0 items-center justify-center">
          <MailIcon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="text-aomi-muted block truncate text-[11px]">
          {subtitle}
        </span>
      </span>
      {pending === `social:${option.id}` ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRightIcon className="text-aomi-muted size-3.5 shrink-0" />
      )}
    </button>
  );
}

function RowIconButton({
  icon: Icon,
  onClick,
  disabled,
  loading,
  ariaLabel,
}: {
  icon: FC<SVGProps<SVGSVGElement>>;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      className={cn(
        "rounded-full p-1.5 transition-colors",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {loading ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
    </button>
  );
}
