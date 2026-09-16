"use client";

import type { Chain } from "viem";
import type { Connector } from "wagmi";
import type { WalletEip712Payload, WalletTxPayload } from "@aomi-labs/react";
import type {
  AomiAccount,
  AomiAccountCredential,
  AomiAccountCredentialOptions,
  AomiSessionIdentity,
  AomiTransactionExecution,
  AomiLoginMethod,
  AomiTxResult,
  AuthProviderId,
  AomiWalletOption,
  SvmNetworkOption,
  WalletFamily,
  WalletSource,
} from "../types";
import type { EvmWalletRuntime } from "../runtime/evm/wallet-runtime";
import type { SafeSvmWalletState } from "../runtime/svm/wallet-runtime";
import type { buildSvmTransactionMethods } from "../runtime/svm/transactions";
import type { AccountRuntime } from "../account/types";
import type { EvmIdentity } from "../registry/selectors";
import type {
  NativeWalletExecutionPolicy,
  WalletExecutionKitState,
} from "../execution/wallet-execution";

export type AuthRuntimeStatus = "booting" | "authenticated" | "unauthenticated";

export type AuthRuntime = {
  provider: AuthProviderId;
  status: AuthRuntimeStatus;
  subject?: string;
  primaryLabel?: string;
  authMethod?: AomiLoginMethod;
  authValue?: string;
  sessionProvider?: AomiSessionIdentity["sessionProvider"];
  embeddedProvider?: AomiSessionIdentity["embeddedProvider"];
  providerLabel?: string;
  methods: readonly AomiWalletOption[];
  canOpenModal: boolean;
  login?: (reason: string, step?: string) => Promise<void>;
  logout?: () => Promise<void>;
  openAccountUI?: (reason: string, step?: string) => Promise<void>;
  startFlow?: (reason: string) => void;
  getCredential?: (
    options?: AomiAccountCredentialOptions,
  ) => Promise<AomiAccountCredential | null>;
};

export type SvmIdentity = {
  address?: string;
  walletName?: string;
  cluster?: AomiSessionIdentity["svmCluster"];
  walletSource?: WalletSource;
  transport?: AomiSessionIdentity["svmTransport"];
  capabilities?: AomiSessionIdentity["svmCapabilities"];
};

export type WalletRuntimeIdentity<F extends WalletFamily> = F extends "evm"
  ? EvmIdentity
  : SvmIdentity;

export type WalletRuntime<F extends WalletFamily> = {
  status: "ready" | "unavailable";
  registryStore: import("../registry/store").WalletRegistryStore;
  identity: (now: number) => WalletRuntimeIdentity<F>;
  accounts: (now: number) => AomiAccount[];
  activeAccount?: AomiAccount;
  options: readonly AomiWalletOption[];
  connect: (optionId?: string) => Promise<void>;
  disconnect: (accountId?: string) => Promise<void>;
  selectAccount: (accountId: string) => Promise<void>;
  selectNetwork: (networkId: string | number) => Promise<void>;
};

export type SvmWalletRuntime = WalletRuntime<"svm"> & {
  supportedNetworks: readonly SvmNetworkOption[];
  selectedNetwork?: SvmNetworkOption;
  execution: SvmExecutionRuntime;
};

export type EvmExecutionRuntime = {
  sendTransaction?: (
    payload: WalletTxPayload,
    execution?: AomiTransactionExecution,
  ) => Promise<AomiTxResult>;
  signTypedData?: (p: WalletEip712Payload) => Promise<{ signature: string }>;
  signMessage?: (p: WalletEip712Payload) => Promise<{ signature: string }>;
  activeConnector?: Connector;
  capabilities?: WalletExecutionKitState["capabilities"];
  chainsById: Record<number, Chain>;
  currentChainId?: number;
  getWalletClientFor: EvmWalletRuntime["getWalletClientFor"];
  sendCallsSyncAsync: EvmWalletRuntime["sendCallsSyncAsync"];
  sendTransactionAsync: EvmWalletRuntime["sendTransactionAsync"];
  nativeWalletExecution?: NativeWalletExecutionPolicy;
  waitForTransactionReceipt?: WalletExecutionKitState["waitForTransactionReceipt"];
  shouldUseExternalSigner: boolean;
  signMessageAsync: EvmWalletRuntime["signMessageAsync"];
  signTypedDataAsync: EvmWalletRuntime["signTypedDataAsync"];
  switchChainAsync: EvmWalletRuntime["switchChainAsync"];
  walletClient: EvmWalletRuntime["walletClient"];
};

export type SvmExecutionRuntime = ReturnType<typeof buildSvmTransactionMethods>;

export type ExecutionRuntime = {
  evm: EvmExecutionRuntime;
};

export type AccountTransform = (accounts: AomiAccount[]) => AomiAccount[];

export type EvmIdentityTransform = (identity: EvmIdentity) => EvmIdentity;

export type AomiWalletKitComposerProps = {
  children: React.ReactNode;
  auth: AuthRuntime;
  evm: EvmWalletRuntime;
  svm?: SvmWalletRuntime;
  execution: ExecutionRuntime;
  account?: AccountRuntime;
  additionalEvmWalletOptions?: readonly AomiWalletOption[];
  transformEvmIdentity?: EvmIdentityTransform;
  transformAccounts?: AccountTransform;
  canManageAccount?: (account: AomiAccount) => boolean;
  supportedChains: readonly Chain[];
};

export type WalletKitTxPayload = WalletTxPayload;
export type WalletKitSignPayload = WalletEip712Payload;
