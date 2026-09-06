"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type SVGProps,
} from "react";
import {
  CheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LinkIcon,
  Loader2Icon,
  LogOutIcon,
  MailIcon,
  PencilIcon,
  PlusIcon,
  Settings2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  UserRoundIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { cn, getChainInfo } from "@aomi-labs/react";
import {
  useAomiWalletKit,
  canonicalWalletKey,
  formatWalletAddress,
  formatAuthMethod,
  formatWalletProvider,
  normalizeWalletOptionId,
  signOutAndDisconnect,
  useWalletActivationGuard,
} from "../../lib/wallet-kit";
import type { AomiWalletKit, WalletFamily } from "../../lib/wallet-kit/types";
import { ModalBackdrop } from "../ui/modal-backdrop";
import { WalletIconSlot } from "./wallet-icon-slot";
import { useWalletPicker } from "./wallet-picker-context";
import {
  buildAccountAccessEntries,
  buildConnectedEntries,
  connectedLinkState,
  familyLabel,
  familyRank,
  isProviderAuthProvider,
  providerBackedAccountProvider,
  providerBackedWalletTitle,
  sameWalletAddress,
  type ConnectedEntry,
  type LinkedAccountRow,
  type LinkedWalletRow,
  type ProviderAccountAccessGroup,
  type WalletModalRow,
} from "./wallet-account-model";

type ProviderAccountRenameInput = {
  provider: string;
  identityIds: readonly string[];
  displayLabel: string | null;
};

type ProviderAccountUnlinkInput = {
  provider: string;
  identityIds: readonly string[];
};

type SupportedEvmChain = { id: number; name: string };
type ConnectedActionRef = {
  action: WalletModalRow["actions"][number];
  account: WalletModalRow;
};

type WalletAction = WalletModalRow & {
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

function buildConnectedWalletRows(
  walletRows: readonly WalletModalRow[],
  identity: AomiWalletKit["identity"],
): WalletModalRow[] {
  if (!identity.isConnected) return [];
  return walletRows.filter(
    (row) =>
      row.source === "live" &&
      (row.status === "active" || row.status === "connected"),
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

function toPublicFamily(family: WalletFamily): WalletFamily {
  return family;
}

export function WalletPicker() {
  const { open, closePicker } = useWalletPicker();
  const adapter = useAomiWalletKit();
  const identity = adapter.identity;
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const autoLinkAttempted = useRef(new Set<string>());
  // Which screen of the push-nav modal is showing. The account view slides in
  // from the right over the wallet manager.
  const [view, setView] = useState<"wallets" | "account">("wallets");
  const canActivateWallet = useWalletActivationGuard();

  useEffect(() => {
    if (!open) {
      setPending(null);
      setActionError(null);
      setAddOpen(false);
      setView("wallets");
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
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

  const walletRows = adapter.walletModalRows ?? [];
  const connectedAccounts = useMemo(
    () => buildConnectedWalletRows(walletRows, identity),
    [identity, walletRows],
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
      (account) =>
        !account.linked &&
        Boolean(account.address) &&
        (account.family === "evm" ||
          (account.family === "svm" &&
            account.walletKind !== "embedded" &&
            account.walletKind !== "smart_account")),
    );
    if (!target?.address) return;
    const key = `${target.family}:${target.id}:${
      target.family === "evm" ? target.address.toLowerCase() : target.address
    }`;
    if (autoLinkAttempted.current.has(key)) return;
    autoLinkAttempted.current.add(key);
    void runAction(`link:${target.id}`, () =>
      adapter.linkWallet!({
        accountId: target.id,
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
    const optionRows = walletRows
      .filter(
        (row) =>
          (row.source === "option" ||
            (row.source === "stored" &&
              row.actions.some((action) => action.kind === "authenticate"))) &&
          row.actions.some(
            (action) =>
              action.kind === "connect" || action.kind === "authenticate",
          ),
      )
      .map((row): WalletAction => {
        const action = row.actions.find(
          (candidate) =>
            candidate.kind === "connect" || candidate.kind === "authenticate",
        );
        return {
          ...row,
          ready: row.status !== "unavailable",
          description:
            row.kind === "social"
              ? "Fast account sign-in"
              : row.family === "svm"
                ? "Connect a Solana wallet"
                : "Connect an Ethereum wallet",
          actionKey: `${action?.kind ?? "connect"}:${row.family}:${row.id}`,
          connect: async () => {
            if (action?.kind === "authenticate") {
              if (adapter.connectSocial && row.kind === "social") {
                await adapter.connectSocial(row.id);
                return;
              }
              await adapter.connect({ family: toPublicFamily(row.family) });
              return;
            }
            if (row.source === "stored") {
              await adapter.connect({ family: toPublicFamily(row.family) });
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
    walletRows,
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
  const providerSubtitle =
    identity.secondaryLabel ?? formatAuthMethod(identity.authMethod);
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
  const supportedEvmChains =
    adapter.supportedNetworks?.evm ?? adapter.supportedChains ?? [];
  const socialOptionsToShow = providerAccountConnected
    ? []
    : providerSignInOptions;
  const hasAccountManagement = Boolean(adapter.accountUser);
  const accountView = hasAccountManagement && view === "account";
  const accountDisplayName =
    adapter.accountUser?.displayName ??
    accountProfileEmail(adapter.accountUser) ??
    identity.primaryLabel ??
    identity.authValue ??
    providerBrandLabel ??
    "Your account";
  const needsFirstWalletLink = Boolean(
    hasConnectedWallets &&
    (!adapter.accountUser || (adapter.accountWallets?.length ?? 0) === 0),
  );
  const pickerTitle = needsFirstWalletLink
    ? "Finish signing in"
    : hasConnectedWallets
      ? "Add a wallet"
      : "Sign in to Aomi";
  const pickerDescription = needsFirstWalletLink
    ? "Verify the connected wallet to finish setting up your account."
    : hasConnectedWallets
      ? "Connect another wallet to this account."
      : "Choose a wallet or another sign-in method.";

  // Pop back to the wallet manager if the signed account becomes unavailable.
  useEffect(() => {
    if (!hasAccountManagement && view !== "wallets") setView("wallets");
  }, [hasAccountManagement, view]);

  const signOutAccount = useCallback(
    () => signOutAndDisconnect(adapter),
    [adapter],
  );

  const deleteAccount = useCallback(async () => {
    const confirmed = window.confirm(
      "Delete this Aomi account? Linked wallets and sign-ins will be freed for a new account.",
    );
    if (!confirmed) return;
    try {
      await adapter.deleteAccount?.();
    } finally {
      await adapter.disconnect?.({ family: "all" });
    }
  }, [adapter]);

  const quickSignInSection = socialOptionsToShow.length ? (
    <section className="flex flex-col gap-2">
      <SectionLabel>Other ways to sign in</SectionLabel>
      <div className="border-aomi-border divide-aomi-border divide-y overflow-hidden rounded-xl border">
        {socialOptionsToShow.map((option) => (
          <SocialLoginRow
            key={option.id}
            option={option}
            pending={pending}
            brandLabel={providerBrandLabel}
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
    const actionKey = `${action.kind}:${account.id}`;
    if (action.kind === "manage") {
      void runAction(actionKey, async () => {
        await adapter.openAccountUI?.({
          family: toPublicFamily(account.family),
        });
        closePicker();
      });
      return;
    }
    if (action.kind === "link") {
      if (!account.address) return;
      void runAction(actionKey, async () => {
        await adapter.linkWallet!({
          accountId: account.id,
          family: account.family,
          address: account.address!,
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
        ? { accountId: account.id }
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

    const active = account.status === "active";
    const selectable =
      account.family === "evm" &&
      account.status !== "active" &&
      account.source === "live" &&
      account.capability !== "read";

    const actions: ConnectedActionRef[] = [];
    for (const action of filterRowActions(account)) {
      actions.push({ action, account });
    }

    const providerHint =
      account.linkedVia &&
      account.linkedVia !== "challenge" &&
      account.linkedVia !== "import" &&
      account.linkedVia !== "observed"
        ? account.linkedVia
        : provider !== null
          ? provider
          : account.manageable
            ? (identity.embeddedProvider ?? identity.sessionProvider)
            : undefined;

    return (
      <ConnectedWalletRow
        key={`row:${account.family}:${account.id}:${account.address ?? ""}`}
        title={title}
        iconId={provider !== null ? provider : account.id}
        iconLabel={title}
        iconProvider={provider ?? providerHint}
        family={account.family}
        capability={capability}
        addressText={addressText}
        detail={detail}
        active={active}
        selectKey={selectable ? `select:${account.id}` : undefined}
        pending={pending}
        onSelect={
          selectable
            ? () =>
                void runAction(
                  `select:${account.id}`,
                  () => adapter.selectAccount(account.id),
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
          className="border-aomi-border bg-aomi-bg/40 hover:bg-aomi-hover flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
        >
          <span className="bg-aomi-surface-2 text-aomi-muted flex size-9 shrink-0 items-center justify-center rounded-full">
            <PlusIcon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              Add another wallet
            </span>
            <span className="text-aomi-muted block truncate text-[11px]">
              Choose a different Ethereum or Solana wallet
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
            <div className="border-aomi-border divide-aomi-border mt-0.5 divide-y overflow-hidden rounded-xl border">
              {renderGroupedActions(addableWalletActions)}
            </div>
          </div>
        </div>
      </section>
    ) : (
      <section className="flex flex-col gap-2">
        <SectionLabel>Choose a wallet</SectionLabel>
        <div className="border-aomi-border divide-aomi-border divide-y overflow-hidden rounded-xl border">
          {renderGroupedActions(addableWalletActions)}
        </div>
      </section>
    )
  ) : null;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aomi-wallet-picker-title"
      className="animate-in fade-in-0 fixed inset-0 z-50 flex items-center justify-center px-4 py-4 duration-150"
    >
      <ModalBackdrop aria-label="Close" onClick={closePicker} />
      <div
        className={cn(
          "relative z-10 flex max-h-[min(760px,92vh)] w-full max-w-[460px] flex-col overflow-hidden",
          "border-aomi-border bg-aomi-raised text-aomi-fg rounded-2xl border text-left shadow-2xl",
          "animate-in zoom-in-95 fade-in-0 duration-200",
        )}
      >
        {!accountView ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-start gap-4 px-5 pb-3 pt-5">
              <div className="min-w-0 flex-1">
                <span className="text-aomi-muted text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Aomi account
                </span>
                <h2
                  id="aomi-wallet-picker-title"
                  className="text-aomi-fg mt-1 text-lg font-semibold tracking-tight"
                >
                  {pickerTitle}
                </h2>
                <p className="text-aomi-muted mt-1 text-[13px] leading-snug">
                  {pickerDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={closePicker}
                aria-label="Close"
                className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
              >
                <XIcon className="size-4" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-2">
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
                        `disconnect:${finishAccount.id}`,
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
        ) : hasAccountManagement ? (
          <AccountManagerPanel
            inertPanel={!accountView}
            pending={pending}
            displayName={accountDisplayName}
            subtitle={providerSubtitle}
            brandLabel={providerBrandLabel}
            user={adapter.accountUser}
            linkedAccounts={adapter.accountLinkedAccounts ?? []}
            wallets={adapter.accountWallets ?? []}
            connectedAccounts={connectedAccounts}
            connectedCount={connectedAccounts.length}
            supportedEvmChains={supportedEvmChains}
            canManageProvider={canManageAccounts}
            canSignOut={Boolean(adapter.signOutAccount || adapter.disconnect)}
            canDeleteAccount={Boolean(adapter.deleteAccount)}
            onBack={() => setView("wallets")}
            onClose={closePicker}
            onRenameWallet={
              adapter.updateLinkedWallet
                ? (input) =>
                    runAction(`wallet:rename:${input.walletId}`, () =>
                      adapter.updateLinkedWallet!(input),
                    )
                : undefined
            }
            onRenameAccount={
              adapter.updateAccount
                ? (input) =>
                    runAction("account:rename", () =>
                      adapter.updateAccount!(input),
                    )
                : undefined
            }
            onRenameLinkedAccount={
              adapter.updateLinkedAccount
                ? (input) =>
                    runAction(`identity:rename:${input.identityId}`, () =>
                      adapter.updateLinkedAccount!(input),
                    )
                : undefined
            }
            onRenameProviderAccounts={
              adapter.updateLinkedAccount
                ? (input) =>
                    runAction(`provider-account:rename:${input.provider}`, () =>
                      runSequential(
                        input.identityIds,
                        (identityId) =>
                          adapter.updateLinkedAccount!({
                            identityId,
                            displayLabel: input.displayLabel,
                          }),
                        "rename",
                      ),
                    )
                : undefined
            }
            onUnlinkWallet={
              adapter.unlinkLinkedWallet
                ? (walletId) =>
                    runAction(`wallet:unlink:${walletId}`, () =>
                      adapter.unlinkLinkedWallet!(walletId),
                    )
                : undefined
            }
            onUnlinkAccount={
              adapter.unlinkLinkedAccount
                ? (identityId) =>
                    runAction(`identity:unlink:${identityId}`, () =>
                      adapter.unlinkLinkedAccount!(identityId),
                    )
                : undefined
            }
            onUnlinkProviderAccounts={
              adapter.unlinkLinkedAccount
                ? (input) =>
                    runAction(`provider-account:unlink:${input.provider}`, () =>
                      runSequential(
                        input.identityIds,
                        (identityId) =>
                          adapter.unlinkLinkedAccount!(identityId),
                        "unlink",
                      ),
                    )
                : undefined
            }
            onSignOut={() =>
              void runAction("account:signout", signOutAccount, true)
            }
            onDeleteAccount={() =>
              void runAction("account:delete", deleteAccount, true)
            }
            onOpenProviderUI={() =>
              void runAction("manage:account", async () => {
                await adapter.openAccountUI?.();
                closePicker();
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="text-aomi-muted px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
      {children}
    </span>
  );
}

/**
 * Run a bulk provider-account operation one item at a time, collecting
 * per-item failures instead of racing them with `Promise.all`. A partial
 * failure no longer aborts the remaining items mid-flight, and the summarized
 * throw lets the picker surface exactly how many succeeded.
 */
async function runSequential<T>(
  items: readonly T[],
  op: (item: T) => Promise<unknown>,
  verb: string,
): Promise<void> {
  const failures: unknown[] = [];
  let succeeded = 0;
  for (const item of items) {
    try {
      await op(item);
      succeeded += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 0) return;
  const total = items.length;
  const firstMessage =
    failures[0] instanceof Error && failures[0].message
      ? `: ${failures[0].message}`
      : "";
  throw new Error(
    `Could not ${verb} ${failures.length} of ${total} account${
      total === 1 ? "" : "s"
    } (${succeeded} succeeded)${firstMessage}`,
  );
}

function filterQuickSignInOptions(
  options: readonly WalletAction[],
  authProvider?: string,
): WalletAction[] {
  const providerAuthOptions = new Set(
    options
      .filter((option) => option.kind === "social")
      .map((option) => quickSignInProvider(option, authProvider))
      .filter((provider): provider is string => provider !== null),
  );
  const seenSocialProviders = new Set<string>();
  const seenStoredProviders = new Set<string>();

  return options.filter((option) => {
    const provider = quickSignInProvider(option, authProvider);
    if (option.kind === "social" && provider !== null) {
      if (seenSocialProviders.has(provider)) return false;
      seenSocialProviders.add(provider);
      return true;
    }
    const storedProviderAuth =
      option.source === "stored" &&
      provider !== null &&
      option.actions.some((action) => action.kind === "authenticate");

    if (!storedProviderAuth) return true;
    // A configured social option is the canonical provider entry. Stored
    // embedded wallets from that provider are account data, not extra sign-in
    // buttons, and belong in the host's account settings surface.
    if (providerAuthOptions.size > 0) return false;
    if (providerAuthOptions.has(provider)) return false;
    if (seenStoredProviders.has(provider)) return false;
    seenStoredProviders.add(provider);
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

function AccountManagerPanel({
  inertPanel,
  pending,
  displayName,
  subtitle,
  brandLabel,
  user,
  linkedAccounts,
  wallets,
  connectedAccounts,
  connectedCount,
  supportedEvmChains,
  canManageProvider,
  canSignOut,
  canDeleteAccount,
  onBack,
  onClose,
  onRenameAccount,
  onRenameLinkedAccount,
  onRenameProviderAccounts,
  onRenameWallet,
  onUnlinkWallet,
  onUnlinkAccount,
  onUnlinkProviderAccounts,
  onSignOut,
  onDeleteAccount,
  onOpenProviderUI,
}: {
  inertPanel: boolean;
  pending: string | null;
  displayName: string;
  subtitle?: string | null;
  brandLabel?: string;
  user?: AomiWalletKit["accountUser"];
  linkedAccounts: readonly LinkedAccountRow[];
  wallets: readonly LinkedWalletRow[];
  connectedAccounts: readonly WalletModalRow[];
  connectedCount: number;
  supportedEvmChains: readonly SupportedEvmChain[];
  canManageProvider: boolean;
  canSignOut: boolean;
  canDeleteAccount: boolean;
  onBack: () => void;
  onClose: () => void;
  onRenameAccount?: NonNullable<AomiWalletKit["updateAccount"]>;
  onRenameLinkedAccount?: NonNullable<AomiWalletKit["updateLinkedAccount"]>;
  onRenameProviderAccounts?: (
    input: ProviderAccountRenameInput,
  ) => Promise<void>;
  onRenameWallet?: NonNullable<AomiWalletKit["updateLinkedWallet"]>;
  onUnlinkWallet?: NonNullable<AomiWalletKit["unlinkLinkedWallet"]>;
  onUnlinkAccount?: NonNullable<AomiWalletKit["unlinkLinkedAccount"]>;
  onUnlinkProviderAccounts?: (
    input: ProviderAccountUnlinkInput,
  ) => Promise<void>;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onOpenProviderUI: () => void;
}) {
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [editingLinkedAccountId, setEditingLinkedAccountId] = useState<
    string | null
  >(null);
  const [editingProviderKey, setEditingProviderKey] = useState<string | null>(
    null,
  );
  const [draftLabel, setDraftLabel] = useState("");
  const [draftLinkedAccountLabel, setDraftLinkedAccountLabel] = useState("");
  const [draftProviderLabel, setDraftProviderLabel] = useState("");
  const [editingAccountName, setEditingAccountName] = useState(false);
  const [draftAccountName, setDraftAccountName] = useState("");
  const walletSummary = `${connectedCount} wallet${
    connectedCount === 1 ? "" : "s"
  } connected`;
  const userEmail =
    user?.email && !isSyntheticAomiEmail(user.email) ? user.email : undefined;
  const headerTitle = formatAccountDisplayName(displayName);
  const headerTitleIsEmail =
    userEmail !== undefined &&
    headerTitle.toLowerCase() === userEmail.toLowerCase();
  const primarySubtitle =
    userEmail && !headerTitleIsEmail
      ? userEmail
      : user
        ? walletSummary
        : (subtitle ?? walletSummary);
  const visibleLinkedAccounts = linkedAccounts.filter(isVisibleLinkedAccount);
  const connectedEntries = buildConnectedEntries(connectedAccounts, wallets);
  const { providerAccounts, standaloneAccounts, standaloneWallets } =
    buildAccountAccessEntries(visibleLinkedAccounts, wallets);
  const hasAccountAccess =
    providerAccounts.length > 0 ||
    standaloneAccounts.length > 0 ||
    standaloneWallets.length > 0;
  const headerBrandLabel = user ? undefined : brandLabel;

  const startRenaming = (wallet: LinkedWalletRow) => {
    setEditingWalletId(wallet.id);
    setDraftLabel(wallet.label ?? "");
  };

  const startRenamingLinkedAccount = (account: LinkedAccountRow) => {
    setEditingLinkedAccountId(account.id);
    setDraftLinkedAccountLabel(linkedAccountTitle(account));
  };

  const startRenamingProviderAccount = (group: ProviderAccountAccessGroup) => {
    setEditingProviderKey(group.key);
    setDraftProviderLabel(providerAccountTitle(group));
  };

  const startRenamingAccount = () => {
    setEditingAccountName(true);
    setDraftAccountName(displayName);
  };

  const submitAccountRename = async () => {
    if (!onRenameAccount) return;
    await onRenameAccount({ displayName: draftAccountName.trim() || null });
    setEditingAccountName(false);
  };

  const submitRename = async (wallet: LinkedWalletRow) => {
    if (!onRenameWallet) return;
    await onRenameWallet({
      walletId: wallet.id,
      label: draftLabel.trim() || null,
    });
    setEditingWalletId(null);
  };

  const submitLinkedAccountRename = async (account: LinkedAccountRow) => {
    if (!onRenameLinkedAccount) return;
    await onRenameLinkedAccount({
      identityId: account.id,
      displayLabel: draftLinkedAccountLabel.trim() || null,
    });
    setEditingLinkedAccountId(null);
  };

  const submitProviderAccountRename = async (
    group: ProviderAccountAccessGroup,
  ) => {
    if (!onRenameProviderAccounts) return;
    await onRenameProviderAccounts({
      provider: group.provider,
      identityIds: group.accounts.map((account) => account.id),
      displayLabel: draftProviderLabel.trim() || null,
    });
    setEditingProviderKey(null);
  };

  return (
    <section
      inert={inertPanel ? true : undefined}
      className={cn(
        "flex w-1/2 min-w-0 shrink-0 flex-col",
        inertPanel && "h-0 overflow-hidden",
      )}
    >
      <div className="border-border/70 bg-background/80 flex items-center gap-2 border-b px-3 pb-3 pt-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to wallets"
          className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-base font-semibold tracking-tight">
            Manage account
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
            Manage your linked wallets and sign-in methods.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="bg-aomi-surface-2 text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        <div className="border-border/70 bg-card flex items-center gap-3 rounded-xl border px-3 py-2.5">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl">
            {headerBrandLabel ? (
              <WalletIconSlot id={headerBrandLabel} label={headerBrandLabel} />
            ) : (
              <UserRoundIcon className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            {editingAccountName ? (
              <input
                value={draftAccountName}
                onChange={(event) => setDraftAccountName(event.target.value)}
                disabled={pending === "account:rename"}
                aria-label="Account display name"
                className="border-input bg-background text-foreground focus:border-primary h-8 w-full rounded-lg border px-2 text-sm outline-none"
              />
            ) : (
              <>
                <p className="text-foreground truncate text-sm font-semibold">
                  {headerTitle}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {primarySubtitle}
                </p>
              </>
            )}
          </div>
          {onRenameAccount ? (
            <div className="flex shrink-0 items-center gap-1">
              {editingAccountName ? (
                <>
                  <RowIconButton
                    icon={CheckIcon}
                    ariaLabel="Save account display name"
                    disabled={pending === "account:rename"}
                    loading={pending === "account:rename"}
                    onClick={submitAccountRename}
                  />
                  <RowIconButton
                    icon={XIcon}
                    ariaLabel="Cancel account display name edit"
                    disabled={pending === "account:rename"}
                    onClick={() => setEditingAccountName(false)}
                  />
                </>
              ) : (
                <RowIconButton
                  icon={PencilIcon}
                  ariaLabel="Rename account"
                  disabled={pending !== null}
                  onClick={startRenamingAccount}
                />
              )}
            </div>
          ) : null}
        </div>

        <section className="flex flex-col gap-1.5">
          <SectionLabel>Connected now</SectionLabel>
          {connectedEntries.map((entry) => (
            <ConnectedWalletSummaryRow
              key={entry.key}
              entry={entry}
              supportedEvmChains={supportedEvmChains}
            />
          ))}
        </section>

        {hasAccountAccess ? (
          <section className="flex flex-col gap-1.5">
            <SectionLabel>Account access</SectionLabel>
            {providerAccounts.map((group) => (
              <ProviderAccountAccessRow
                key={group.key}
                group={group}
                connectedAccounts={connectedAccounts}
                editing={editingProviderKey === group.key}
                draftLabel={draftProviderLabel}
                pending={pending}
                onDraftLabelChange={setDraftProviderLabel}
                onStartRename={
                  onRenameProviderAccounts && group.accounts.length > 0
                    ? () => startRenamingProviderAccount(group)
                    : undefined
                }
                onCancelRename={() => setEditingProviderKey(null)}
                onSubmitRename={() => void submitProviderAccountRename(group)}
                onUnlink={
                  onUnlinkProviderAccounts && group.accounts.length > 0
                    ? () =>
                        void onUnlinkProviderAccounts({
                          provider: group.provider,
                          identityIds: group.accounts.map(
                            (account) => account.id,
                          ),
                        })
                    : undefined
                }
              />
            ))}
            {standaloneAccounts.map((account) => (
              <LinkedAuthAccountRow
                key={account.id}
                account={account}
                editing={editingLinkedAccountId === account.id}
                draftLabel={draftLinkedAccountLabel}
                pending={pending}
                onDraftLabelChange={setDraftLinkedAccountLabel}
                onStartRename={
                  onRenameLinkedAccount
                    ? () => startRenamingLinkedAccount(account)
                    : undefined
                }
                onCancelRename={() => setEditingLinkedAccountId(null)}
                onSubmitRename={() => void submitLinkedAccountRename(account)}
                onUnlink={
                  onUnlinkAccount
                    ? () => void onUnlinkAccount(account.id)
                    : undefined
                }
              />
            ))}
            {standaloneWallets.map((wallet) => (
              <LinkedWalletManagementRow
                key={wallet.id}
                wallet={wallet}
                supportedEvmChains={supportedEvmChains}
                live={connectedAccounts.some(
                  (account) =>
                    account.family === wallet.family &&
                    sameWalletAddress(
                      wallet.family,
                      wallet.address,
                      account.address,
                    ),
                )}
                editing={editingWalletId === wallet.id}
                draftLabel={draftLabel}
                pending={pending}
                onDraftLabelChange={setDraftLabel}
                onStartRename={() => startRenaming(wallet)}
                onCancelRename={() => setEditingWalletId(null)}
                onSubmitRename={() => void submitRename(wallet)}
                onUnlink={
                  onUnlinkWallet
                    ? () => void onUnlinkWallet(wallet.id)
                    : undefined
                }
              />
            ))}
          </section>
        ) : (
          <section className="flex flex-col gap-1.5">
            <SectionLabel>Account access</SectionLabel>
            <div className="border-border/60 bg-card/60 flex items-center gap-3 rounded-2xl border border-dashed px-3 py-2.5">
              <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
                <ShieldCheckIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm font-medium">
                  No linked access yet
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  Verify a wallet or sign in with an account provider
                </span>
              </span>
            </div>
          </section>
        )}

        {canManageProvider ? (
          <button
            type="button"
            onClick={onOpenProviderUI}
            disabled={pending !== null}
            className="border-border/70 bg-card hover:border-primary/30 hover:bg-accent/40 flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="bg-muted/50 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
              <Settings2Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block truncate text-sm font-medium">
                Open provider settings
              </span>
              <span className="text-muted-foreground block truncate text-[11px]">
                Manage this account with its provider
              </span>
            </span>
            {pending === "manage:account" ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin" />
            ) : (
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
            )}
          </button>
        ) : null}

        {canSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            disabled={pending !== null}
            className="border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="bg-destructive/10 flex size-9 shrink-0 items-center justify-center rounded-xl">
              <LogOutIcon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                Sign out
              </span>
              <span className="block truncate text-[11px] opacity-80">
                End this account session
              </span>
            </span>
            {pending === "account:signout" ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin" />
            ) : null}
          </button>
        ) : null}

        {canDeleteAccount ? (
          <button
            type="button"
            onClick={onDeleteAccount}
            disabled={pending !== null}
            className="border-destructive/40 bg-background text-destructive hover:bg-destructive/10 flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="bg-destructive/10 flex size-9 shrink-0 items-center justify-center rounded-xl">
              <Trash2Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                Delete account
              </span>
              <span className="block truncate text-[11px] opacity-80">
                Free linked wallets and sign-ins
              </span>
            </span>
            {pending === "account:delete" ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin" />
            ) : null}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function isVisibleLinkedAccount(account: LinkedAccountRow): boolean {
  return (
    account.provider !== "better_auth" &&
    account.provider !== "wallet" &&
    account.provider !== "siwe" &&
    account.provider !== "siws" &&
    account.provider !== "email"
  );
}

function accountProfileEmail(
  user: AomiWalletKit["accountUser"],
): string | undefined {
  return user?.email && !isSyntheticAomiEmail(user.email)
    ? user.email
    : undefined;
}

function formatAccountDisplayName(value: string): string {
  return /^0x[a-f0-9]{40}$/i.test(value)
    ? (formatWalletAddress(value) ?? value)
    : value;
}

function isSyntheticAomiEmail(email: string): boolean {
  return (
    /^0x[a-f0-9]{40}@aomi\.dev$/i.test(email) ||
    /@auth\.aomi\.local$/i.test(email)
  );
}

function chainIdFromScope(chainScope?: string): number | undefined {
  if (!chainScope) return undefined;
  const chainId = Number(chainScope);
  return Number.isInteger(chainId) && chainId > 0 ? chainId : undefined;
}

type ProviderFamilyAccess = {
  family: WalletFamily;
  address?: string;
  capability: "read" | "write";
};

function providerAccountTitle(group: ProviderAccountAccessGroup): string {
  const account = group.accounts[0];
  return account
    ? linkedAccountTitle(account)
    : (formatWalletProvider(group.provider) ?? group.provider);
}

function providerFamilyAccess(
  group: ProviderAccountAccessGroup,
  connectedAccounts: readonly WalletModalRow[],
): ProviderFamilyAccess[] {
  const accessByFamily = new Map<WalletFamily, ProviderFamilyAccess>();

  for (const wallet of group.wallets) {
    accessByFamily.set(wallet.family, {
      family: wallet.family,
      address: wallet.address,
      capability: "read",
    });
  }

  for (const account of connectedAccounts) {
    const provider = providerBackedAccountProvider(account)?.toLowerCase();
    if (provider !== group.provider) continue;
    accessByFamily.set(account.family, {
      family: account.family,
      address: account.address ?? accessByFamily.get(account.family)?.address,
      capability: "write",
    });
  }

  return [...accessByFamily.values()].sort(
    (left, right) => familyRank(left.family) - familyRank(right.family),
  );
}

function ProviderAccountAccessRow({
  group,
  connectedAccounts,
  editing,
  draftLabel,
  pending,
  onDraftLabelChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onUnlink,
}: {
  group: ProviderAccountAccessGroup;
  connectedAccounts: readonly WalletModalRow[];
  editing: boolean;
  draftLabel: string;
  pending: string | null;
  onDraftLabelChange: (value: string) => void;
  onStartRename?: () => void;
  onCancelRename: () => void;
  onSubmitRename: () => void;
  onUnlink?: () => void;
}) {
  const title = providerAccountTitle(group);
  const providerLabel = formatWalletProvider(group.provider) ?? group.provider;
  const familyAccess = providerFamilyAccess(group, connectedAccounts);
  const addressSubtitle = familyAccess
    .map((access) => formatWalletAddress(access.address))
    .filter(Boolean)
    .join(" · ");
  const subtitle = addressSubtitle || "Provider sign-in";
  const renameKey = `provider-account:rename:${group.provider}`;
  const unlinkKey = `provider-account:unlink:${group.provider}`;
  const busy = pending === renameKey || pending === unlinkKey;

  return (
    <div
      role="group"
      aria-label={`${providerLabel} account access`}
      className="border-border/70 bg-card flex items-center gap-3 rounded-2xl border px-3 py-2.5"
    >
      <WalletIconSlot
        id={group.provider}
        label={providerLabel}
        provider={group.provider}
      />
      <span className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draftLabel}
            onChange={(event) => onDraftLabelChange(event.target.value)}
            disabled={busy}
            aria-label={`Sign-in label for ${title}`}
            className="border-input bg-background text-foreground focus:border-primary h-8 w-full rounded-lg border px-2 text-sm outline-none"
          />
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-foreground truncate text-sm font-medium">
                {title}
              </span>
              {familyAccess.map((access) => (
                <ChainTag
                  key={access.family}
                  family={access.family}
                  capability={access.capability}
                />
              ))}
            </span>
            <span className="text-muted-foreground block truncate text-[11px]">
              {subtitle}
            </span>
          </>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <RowIconButton
              icon={CheckIcon}
              ariaLabel={`Save label for ${title}`}
              disabled={busy}
              loading={pending === renameKey}
              onClick={onSubmitRename}
            />
            <RowIconButton
              icon={XIcon}
              ariaLabel={`Cancel renaming ${title}`}
              disabled={busy}
              onClick={onCancelRename}
            />
          </>
        ) : (
          <>
            {onStartRename ? (
              <RowIconButton
                icon={PencilIcon}
                ariaLabel={`Rename ${title}`}
                disabled={busy}
                onClick={onStartRename}
              />
            ) : null}
            {onUnlink ? (
              <RowIconButton
                icon={Trash2Icon}
                ariaLabel={`Unlink ${title}`}
                disabled={busy}
                loading={pending === unlinkKey}
                onClick={onUnlink}
              />
            ) : (
              <CheckCircle2Icon className="text-primary size-4 shrink-0" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LinkedAuthAccountRow({
  account,
  editing,
  draftLabel,
  pending,
  onDraftLabelChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onUnlink,
}: {
  account: LinkedAccountRow;
  editing: boolean;
  draftLabel: string;
  pending: string | null;
  onDraftLabelChange: (value: string) => void;
  onStartRename?: () => void;
  onCancelRename: () => void;
  onSubmitRename: () => void;
  onUnlink?: () => void;
}) {
  const providerLabel =
    formatWalletProvider(account.provider) ?? account.provider;
  const title = linkedAccountTitle(account);
  const subtitle = linkedAccountSubtitle(account, title);
  const busy =
    pending === `identity:rename:${account.id}` ||
    pending === `identity:unlink:${account.id}`;
  return (
    <div className="border-border/70 bg-card flex items-center gap-3 rounded-2xl border px-3 py-2.5">
      <WalletIconSlot
        id={account.provider}
        label={providerLabel}
        provider={account.provider}
      />
      <span className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draftLabel}
            onChange={(event) => onDraftLabelChange(event.target.value)}
            disabled={busy}
            aria-label={`Sign-in label for ${title}`}
            className="border-input bg-background text-foreground focus:border-primary h-8 w-full rounded-lg border px-2 text-sm outline-none"
          />
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-foreground truncate text-sm font-medium">
                {title}
              </span>
            </span>
            <span className="text-muted-foreground block truncate text-[11px]">
              {subtitle}
            </span>
          </>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <RowIconButton
              icon={CheckIcon}
              ariaLabel={`Save label for ${title}`}
              disabled={busy}
              loading={pending === `identity:rename:${account.id}`}
              onClick={onSubmitRename}
            />
            <RowIconButton
              icon={XIcon}
              ariaLabel={`Cancel renaming ${title}`}
              disabled={busy}
              onClick={onCancelRename}
            />
          </>
        ) : (
          <>
            {onStartRename ? (
              <RowIconButton
                icon={PencilIcon}
                ariaLabel={`Rename ${title}`}
                disabled={busy}
                onClick={onStartRename}
              />
            ) : null}
            {onUnlink ? (
              <RowIconButton
                icon={Trash2Icon}
                ariaLabel={`Unlink ${title}`}
                disabled={busy}
                loading={pending === `identity:unlink:${account.id}`}
                onClick={onUnlink}
              />
            ) : (
              <CheckCircle2Icon className="text-primary size-4 shrink-0" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function linkedAccountSubtitle(
  account: LinkedAccountRow,
  title?: string,
): string {
  if (isProviderAuthAccount(account.provider)) {
    return "Provider sign-in";
  }
  if (
    account.email &&
    !isSyntheticAomiEmail(account.email) &&
    account.email.toLowerCase() !== title?.toLowerCase()
  ) {
    return account.email;
  }
  return account.subject;
}

function linkedAccountTitle(account: LinkedAccountRow): string {
  const providerLabel =
    formatWalletProvider(account.provider) ?? account.provider;
  const displayLabel = account.displayLabel?.trim();
  if (!displayLabel) return providerLabel;
  if (
    isProviderAuthAccount(account.provider) &&
    account.email &&
    displayLabel.toLowerCase() === account.email.toLowerCase()
  ) {
    return providerLabel;
  }
  return displayLabel;
}

function isProviderAuthAccount(provider: string): boolean {
  return isProviderAuthProvider(provider);
}

function ConnectedWalletSummaryRow({
  entry,
  supportedEvmChains,
}: {
  entry: ConnectedEntry;
  supportedEvmChains: readonly SupportedEvmChain[];
}) {
  const address = formatWalletAddress(entry.address);
  const networkName =
    entry.family === "evm"
      ? networkNameForChain(entry.chainId, supportedEvmChains)
      : "Solana";
  const linkState = connectedLinkState(entry);
  return (
    <div className="border-border/70 bg-card flex items-center gap-3 rounded-2xl border px-3 py-2.5">
      <WalletIconSlot
        id={entry.iconId}
        label={entry.iconLabel}
        provider={entry.iconProvider}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-foreground truncate text-sm font-medium">
            {entry.title}
          </span>
          <ChainTag family={entry.family} capability={entry.capability} />
        </span>
        <span className="text-muted-foreground block truncate text-[11px]">
          {[address, networkName, linkState].filter(Boolean).join(" · ")}
        </span>
      </span>
    </div>
  );
}

function LinkedWalletManagementRow({
  wallet,
  supportedEvmChains,
  live,
  editing,
  draftLabel,
  pending,
  onDraftLabelChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onUnlink,
}: {
  wallet: LinkedWalletRow;
  supportedEvmChains: readonly SupportedEvmChain[];
  live: boolean;
  editing: boolean;
  draftLabel: string;
  pending: string | null;
  onDraftLabelChange: (value: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: () => void;
  onUnlink?: () => void;
}) {
  const providerTitle = providerBackedAccountProvider(wallet)
    ? providerBackedWalletTitle({
        provider: wallet.provider,
        walletName: wallet.label,
        family: wallet.family,
        kind: wallet.kind,
      })
    : null;
  const title = wallet.label ?? providerTitle ?? "Wallet";
  const busy =
    pending === `wallet:rename:${wallet.id}` ||
    pending === `wallet:unlink:${wallet.id}`;
  const networkName =
    wallet.family === "evm"
      ? networkNameForChain(
          wallet.chainId ?? chainIdFromScope(wallet.chainScope),
          supportedEvmChains,
        )
      : undefined;

  return (
    <div className="border-border/70 bg-card flex items-center gap-3 rounded-2xl border px-3 py-2.5">
      <WalletIconSlot
        id={wallet.providerWalletId ?? wallet.provider ?? wallet.id}
        label={wallet.provider ?? title}
      />
      <span className="min-w-0 flex-1">
        {editing ? (
          <input
            value={draftLabel}
            onChange={(event) => onDraftLabelChange(event.target.value)}
            disabled={busy}
            aria-label={`Wallet label for ${title}`}
            className="border-input bg-background text-foreground focus:border-primary h-8 w-full rounded-lg border px-2 text-sm outline-none"
          />
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-foreground truncate text-sm font-medium">
                {title}
              </span>
              <ChainTag
                family={wallet.family}
                capability={live ? "write" : wallet.capability}
              />
            </span>
            <span className="text-muted-foreground block truncate text-[11px]">
              {[formatWalletAddress(wallet.address), networkName]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <RowIconButton
              icon={CheckIcon}
              ariaLabel={`Save label for ${title}`}
              disabled={busy}
              loading={pending === `wallet:rename:${wallet.id}`}
              onClick={onSubmitRename}
            />
            <RowIconButton
              icon={XIcon}
              ariaLabel={`Cancel renaming ${title}`}
              disabled={busy}
              onClick={onCancelRename}
            />
          </>
        ) : (
          <>
            <RowIconButton
              icon={PencilIcon}
              ariaLabel={`Rename ${title}`}
              disabled={busy}
              onClick={onStartRename}
            />
            {onUnlink ? (
              <RowIconButton
                icon={Trash2Icon}
                ariaLabel={`Unlink ${title}`}
                disabled={busy}
                loading={pending === `wallet:unlink:${wallet.id}`}
                onClick={onUnlink}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
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
  const actionKey = linkAction ? `${linkAction.kind}:${account.id}` : undefined;
  const busy = actionKey != null && pending === actionKey;

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Connected wallet</SectionLabel>
      <div className="border-aomi-border overflow-hidden rounded-xl border">
        <div className="flex items-center gap-3 bg-emerald-500/[0.045] px-4 py-3.5">
          <WalletIconSlot
            id={provider ?? account.id}
            label={title}
            provider={provider ?? account.provider}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Connected now
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
              loading={pending === `disconnect:${account.id}`}
              onClick={onDisconnect}
            />
          ) : null}
        </div>
        <div className="border-aomi-border bg-aomi-bg/35 border-t p-3">
          <button
            type="button"
            disabled={!linkAction || pending !== null}
            onClick={() =>
              linkAction && onLink({ action: linkAction, account })
            }
            className="bg-aomi-fg text-aomi-bg flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <LinkIcon className="size-4" />
            )}
            {linkAction ? "Link wallet and sign in" : "Preparing sign-in…"}
          </button>
          <p className="text-aomi-muted mt-2 text-center text-[11px] leading-snug">
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
      <WalletIconSlot id={iconId} label={iconLabel} provider={iconProvider} />
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
              key={`${action.kind}:${account.id}`}
              type="button"
              disabled={pending !== null}
              onClick={() => onAction({ action, account })}
              className="border-aomi-border text-aomi-fg hover:bg-aomi-surface-2 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors disabled:opacity-50"
            >
              {pending === `${action.kind}:${account.id}` ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <LinkIcon className="size-3.5" />
              )}
              Link wallet
            </button>
          ) : (
            <RowIconButton
              key={`${action.kind}:${account.id}`}
              icon={action.kind === "manage" ? Settings2Icon : LogOutIcon}
              ariaLabel={
                action.kind === "manage"
                  ? `Manage ${title}`
                  : action.kind === "signout"
                    ? "Sign out"
                    : `Disconnect ${familyLabel(account.family)} wallet`
              }
              disabled={pending !== null}
              loading={pending === `${action.kind}:${account.id}`}
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
        "bg-aomi-bg/25 hover:bg-aomi-hover flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <WalletIconSlot
        iconUrl={wallet.iconUrl}
        id={wallet.id}
        label={wallet.label}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
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
        <ChevronRightIcon className="text-aomi-muted size-4 shrink-0" />
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
  const subtitle = brandLabel
    ? option.label
    : (option.description ?? "Use an Aomi account");
  return (
    <button
      type="button"
      disabled={pending !== null || option.ready === false}
      onClick={onClick}
      aria-label={option.label}
      className={cn(
        "bg-aomi-bg/25 hover:bg-aomi-hover flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {brandLabel ? (
        <WalletIconSlot id={brandLabel} label={brandLabel} />
      ) : (
        <span className="bg-aomi-surface-2 text-aomi-muted flex size-9 shrink-0 items-center justify-center rounded-full">
          <MailIcon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="text-aomi-muted block truncate text-[11px]">
          {subtitle}
        </span>
      </span>
      {pending === `social:${option.id}` ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" />
      ) : (
        <ChevronRightIcon className="text-aomi-muted size-4 shrink-0" />
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
