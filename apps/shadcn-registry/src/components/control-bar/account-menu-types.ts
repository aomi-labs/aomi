/** Optional account-menu layer for the sidebar wallet chip (portal supplies live data). */
export type WalletAccountMenuOptions = {
  /** When true, the chip represents an authenticated account and opens AccountMenu. */
  enabled?: boolean;
  /** Primary account label shown on the chip and at the top of the menu. */
  primaryLine?: string;
  /** Second line on the chip (e.g. monthly allowance). Omit to show network detail. */
  secondaryLine?: string;
  /**
   * Full-length problem description. The chip only has room for one truncated
   * line, so anything longer than a few words belongs here — the menu renders
   * it wrapped instead of clipping it mid-sentence.
   */
  noticeLine?: string;
  /** Menu header wallet label (e.g. MetaMask, Para). */
  walletLabel?: string;
  /** Shown on the Switch network row trailing label. */
  networkLabel?: string;
  /** Shown on the Theme row trailing label. */
  themeLabel?: string;
  onSwitchNetwork?: () => void;
  onToggleTheme?: () => void;
  /** Open the host's canonical account-and-wallet management surface. */
  onManageAccount?: () => void;
  onOpenSettings?: () => void;
  onOpenDeployments?: () => void;
  /** Finish Aomi account sign-in (wallet connected, session missing). */
  onSignIn?: () => void;
  /** End the Aomi account session while preserving live wallet connections. */
  onSignOut?: () => void | Promise<void>;
  /**
   * Disconnect live wallet connectors while preserving the Aomi account
   * session. Omit to use the wallet-kit connector teardown.
   */
  onDisconnect?: () => void | Promise<void>;
};
