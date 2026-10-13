# Account Abstraction Architecture

This document describes the current AA architecture in this repository.
It is based on the live code under `packages/client/src/aa` and
`packages/client/src/cli`.

The older persisted-config model is gone. There is no `aa/env.ts`,
`aa/alchemy/resolve.ts`, `aa/resolve.ts`, `cli/aa-config.ts`, or `aomi aa`
subcommand in the current codebase.

**Layout:** All paths below are under `packages/client/src/` unless noted.

---

## Current Model

- `aa/types.ts` owns the shared AA config model, default chain matrix,
  execution planning, and the generic `executeWalletCalls()` router.
- `aa/create.ts` is the provider-neutral async facade that dispatches to
  Alchemy or Pimlico.
- Alchemy has two different direct-owner execution implementations:
  - `4337` uses `@alchemy/wallet-apis`.
  - `7702` uses raw `viem` plus `viem/experimental/erc7821`.
- Pimlico still uses a classic `resolve -> create` split.
- React hook factories only resolve browser-safe config and forward it to
  caller-provided hooks such as `useAlchemyAA` / `usePimlicoAA`.
- The CLI now defaults to AA. With no BYOK credentials it uses the backend
  Alchemy proxy; `--eoa` is the only way to force plain EOA execution.

---

## Module Dependency Graph

```mermaid
%%{init: {'theme': 'neutral'}}%%
graph TB
    subgraph "AA core (aa/)"
        TYPES[types.ts<br/>AAConfig, DEFAULT_AA_CONFIG,<br/>executeWalletCalls]
        OWNER[owner.ts<br/>AAOwner, getOwnerParams]
        ADAPT[adapt.ts<br/>adaptSmartAccount]
        CREATE[create.ts<br/>createAAProviderState]
    end

    subgraph "aa/alchemy/"
        ALCH_PROV[provider.ts<br/>resolveForHook + createAlchemyAAProvider]
        ALCH_CREATE[create.ts<br/>createAlchemyAAState]
    end

    subgraph "aa/pimlico/"
        PIM_RESOLVE[resolve.ts<br/>resolvePimlicoConfig]
        PIM_PROV[provider.ts<br/>createPimlicoAAProvider]
        PIM_CREATE[create.ts<br/>createPimlicoAAState]
    end

    subgraph "External libs"
        WALLET_APIS["@alchemy/wallet-apis"]
        PARA_ALCH["@getpara/aa-alchemy"]
        PARA_PIM["@getpara/aa-pimlico"]
        VIEM_RAW[viem + viem/experimental/erc7821]
    end

    subgraph "CLI"
        CLI_DEF[cli/commands/defs/shared.ts<br/>buildCliConfig]
        CLI_EXEC[cli/execution.ts<br/>resolveCliExecutionDecision<br/>createCliProviderState]
        CLI_WALLET[cli/commands/wallet.ts<br/>signCommand]
        CLI_CHAINS[chains.ts<br/>ALCHEMY_CHAIN_SLUGS]
    end

    TYPES --> ALCH_PROV
    TYPES --> ALCH_CREATE
    TYPES --> PIM_RESOLVE
    TYPES --> CREATE
    TYPES --> CLI_EXEC
    OWNER --> ALCH_CREATE
    OWNER --> PIM_CREATE
    ADAPT --> ALCH_CREATE
    ADAPT --> PIM_CREATE
    CREATE --> ALCH_CREATE
    CREATE --> PIM_CREATE
    PIM_RESOLVE --> PIM_PROV
    PIM_RESOLVE --> PIM_CREATE
    CLI_DEF --> CLI_EXEC
    CLI_CHAINS --> CLI_EXEC
    CLI_EXEC --> CLI_WALLET

    TYPES -.dynamic import.-> VIEM_RAW
    ALCH_CREATE -.dynamic import.-> WALLET_APIS
    ALCH_CREATE -.dynamic import.-> PARA_ALCH
    ALCH_CREATE -.dynamic import.-> VIEM_RAW
    PIM_CREATE -.dynamic import.-> PARA_PIM
```

**Provider SDK boundary:** provider-specific SDK imports only happen in the
async creator files:

- `aa/alchemy/create.ts`
- `aa/pimlico/create.ts`

The hook factories do not import SDKs themselves. They only resolve config and
hand it to the caller's hook.

`aa/types.ts` also uses lazy `viem` imports at execution time for:

- EOA submission with a local private key
- best-effort 7702 delegation lookup from the on-chain transaction

---

## Shared Types And Defaults

### Core types

`aa/types.ts` defines the shared model:

- `AAProvider = "alchemy" | "pimlico"`
- `AAMode = "4337" | "7702"`
- `AASponsorship = "disabled" | "optional" | "required"`
- `AAConfig`
- `AAChainConfig`
- `AAResolvedConfig`
- `AAState`
- `SmartAccount`
- `ExecutionResult`

`AAConfig` is still the generic contract used by hook factories and planning:

```ts
type AAConfig = {
  enabled: boolean;
  provider: "alchemy" | "pimlico";
  fallbackToEoa: boolean;
  chains: AAChainConfig[];
};
```

### Default chain matrix

`DEFAULT_AA_CONFIG` currently enables AA on five chains:

| Chain | ID | defaultMode | supportedModes | allowBatching | sponsorship |
| --- | --- | --- | --- | --- | --- |
| Ethereum | `1` | `7702` | `4337`, `7702` | `true` | `optional` |
| Polygon | `137` | `4337` | `4337`, `7702` | `true` | `optional` |
| Arbitrum One | `42161` | `4337` | `4337`, `7702` | `true` | `optional` |
| Optimism | `10` | `4337` | `4337`, `7702` | `true` | `optional` |
| Base | `8453` | `4337` | `4337`, `7702` | `true` | `optional` |

Two important details:

- `DEFAULT_AA_CONFIG.fallbackToEoa` is still `true`.
- The CLI chain registry also includes Sepolia (`11155111`), but Sepolia is
  not present in `DEFAULT_AA_CONFIG`, so AA resolution fails there.

### Planning helpers

`getAAChainConfig(config, calls, chainsById)` returns `null` unless all of the
following are true:

- AA is enabled.
- The call list is non-empty.
- All calls target the same chain.
- The target chain exists in `chainsById`.
- The chain is enabled in `config.chains`.
- Batching is allowed when `calls.length > 1`.

`buildAAExecutionPlan(config, chainConfig)` chooses:

- `chainConfig.defaultMode` when it appears in `supportedModes`
- otherwise the first supported mode

and returns:

```ts
type AAResolvedConfig = {
  provider: "alchemy" | "pimlico";
  chainId: number;
  mode: "4337" | "7702";
  batchingEnabled: boolean;
  sponsorship: "disabled" | "optional" | "required";
  fallbackToEoa: boolean;
};
```

`getWalletExecutorReady(providerState)` treats AA as "ready enough" when:

- no AA plan is active, or
- the provider has finished loading and now has either:
  - an account,
  - an error, or
  - `fallbackToEoa === true`

```mermaid
flowchart TD
    START([AAConfig + calls + chainsById]) --> ENABLED{config.enabled?}
    ENABLED -->|no| RET_NULL([return null])
    ENABLED -->|yes| CALLS{calls.length > 0?}
    CALLS -->|no| RET_NULL
    CALLS -->|yes| ONE_CHAIN{exactly one chainId?}
    ONE_CHAIN -->|no| RET_NULL
    ONE_CHAIN -->|yes| KNOWN_CHAIN{chain exists in chainsById?}
    KNOWN_CHAIN -->|no| RET_NULL
    KNOWN_CHAIN -->|yes| CHAIN_CFG[find AAChainConfig by chainId]
    CHAIN_CFG --> CHAIN_ENABLED{chain enabled?}
    CHAIN_ENABLED -->|no| RET_NULL
    CHAIN_ENABLED -->|yes| BATCH_OK{single call or allowBatching?}
    BATCH_OK -->|no| RET_NULL
    BATCH_OK -->|yes| PLAN[buildAAExecutionPlan]
    PLAN --> MODE{defaultMode valid?}
    MODE -->|yes| RESOLVED([AAResolvedConfig])
    MODE -->|no| FIRST_SUPPORTED[use first supported mode]
    FIRST_SUPPORTED --> RESOLVED
```

---

## Owner Model

Smart-account creation takes an `AAOwner`, not a bare key:

- `{ kind: "direct", privateKey }`
- `{ kind: "session", adapter: "para", session, signer?, address? }`

`owner.ts` resolves this into the SDK owner shape:

- direct owner -> `privateKeyToAccount(privateKey)` signer
- Para session owner -> `{ para: session, signer?, address? }`

Current adapter support is narrow by design:

- `para` is implemented
- any other `adapter` returns an `unsupported_adapter` result

The owner helpers also produce consistent error states:

- `getMissingOwnerState(...)`
- `getUnsupportedAdapterState(...)`

These return an `AAState` with `account: null`, `pending: false`, and a clear
error message instead of throwing synchronously.

```mermaid
flowchart TD
    START([getOwnerParams]) --> EXISTS{owner provided?}
    EXISTS -->|no| MISSING([kind: missing])
    EXISTS -->|yes| KIND{owner.kind}

    KIND -->|direct| DIRECT[privateKeyToAccount]
    DIRECT --> READY_DIRECT([kind: ready<br/>ownerParams.signer])

    KIND -->|session| ADAPTER{owner.adapter}
    ADAPTER -->|para| PARA{signer provided?}
    ADAPTER -->|other| UNSUP([kind: unsupported_adapter])

    PARA -->|yes| PARA_SIGNER([kind: ready<br/>para + signer + optional address])
    PARA -->|no| PARA_ONLY([kind: ready<br/>para + optional address])
```

---

## Alchemy Implementation

### Hook path: `aa/alchemy/provider.ts`

`createAlchemyAAProvider()` is the browser-facing factory. It does not know how
to build a smart account by itself; it only resolves config and passes
`AlchemyHookParams` into a caller-provided `useAlchemyAA` hook.

The internal `resolveForHook()` behavior is:

- returns `null` when `calls` is `null`
- returns `null` when `localPrivateKey` is present
- builds a chain plan from `AAConfig`
- reads only:
  - `NEXT_PUBLIC_ALCHEMY_API_KEY`
  - `NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID`
- returns `null` when the public API key is missing

The hook resolver is intentionally simpler than the old architecture:

- there is no shared `resolveAlchemyConfig()`
- there is no `publicOnly` flag for Alchemy anymore
- there is no proxy mode in the React hook path

`CreateAlchemyAAProviderOptions` still includes `chainSlugById`,
`apiKeyEnvVar`, and `gasPolicyEnvVar`, but the current resolver reads the fixed
`NEXT_PUBLIC_*` env vars directly.

```mermaid
sequenceDiagram
    participant App as App
    participant Hook as useAlchemyAAProvider
    participant Resolve as resolveForHook
    participant Types as getAAChainConfig / buildAAExecutionPlan
    participant Env as NEXT_PUBLIC_ALCHEMY_*
    participant UserHook as useAlchemyAA

    App->>Hook: calls, localPrivateKey
    Hook->>Resolve: resolveForHook(...)
    Resolve->>Resolve: reject null calls / localPrivateKey
    Resolve->>Types: getAAChainConfig(config, calls, chainsById)
    Types-->>Resolve: AAChainConfig or null
    Resolve->>Env: read NEXT_PUBLIC_ALCHEMY_API_KEY
    Env-->>Resolve: apiKey or undefined
    Resolve->>Env: read NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID
    Env-->>Resolve: gasPolicyId or undefined
    Resolve->>Types: buildAAExecutionPlan(...)
    Types-->>Resolve: AAResolvedConfig

    alt Config resolved
        Resolve-->>Hook: resolved + apiKey + chain + rpcUrl
        Hook->>UserHook: useAlchemyAA({ enabled, apiKey, chain, rpcUrl, gasPolicyId, mode })
        UserHook-->>Hook: account, pending, error
        Hook-->>App: AAState { resolved, account, pending, error }
    else Config not resolved
        Resolve-->>Hook: null
        Hook->>UserHook: useAlchemyAA(undefined)
        UserHook-->>Hook: idle / empty state
        Hook-->>App: AAState { resolved: null, ... }
    end
```

### Async create path: `aa/alchemy/create.ts`

`createAlchemyAAState()` is the real Alchemy constructor. It:

1. Resolves the chain from `DEFAULT_AA_CONFIG`.
2. Applies an explicit `mode` override when one is passed.
3. Resolves `gasPolicyId` from:
   - `options.gasPolicyId`, else
   - `process.env.ALCHEMY_GAS_POLICY_ID`
4. Builds a resolved plan and forces `fallbackToEoa: false`.
5. Splits by owner type and AA mode.

```mermaid
flowchart TD
    START([createAlchemyAAState]) --> CHAIN_CFG[getAAChainConfig]
    CHAIN_CFG --> FOUND{chain configured?}
    FOUND -->|no| THROW_CFG([throw AA is not configured])
    FOUND -->|yes| PLAN[buildAAExecutionPlan + force fallbackToEoa false]
    PLAN --> GAS[resolve gasPolicyId if sponsored]
    GAS --> OWNER[getOwnerParams]

    OWNER --> OWNER_KIND{owner result}
    OWNER_KIND -->|missing| ERR_MISSING([return missing-owner AAState])
    OWNER_KIND -->|unsupported_adapter| ERR_ADAPTER([return unsupported-adapter AAState])
    OWNER_KIND -->|ready| OWNER_TYPE{owner.kind}

    OWNER_TYPE -->|direct| MODE{mode 7702 or 4337?}
    MODE -->|7702| RAW_7702[createAlchemy7702State<br/>raw viem + erc7821]
    MODE -->|4337| WALLET_4337["createAlchemy4337State<br/>@alchemy/wallet-apis"]

    OWNER_TYPE -->|session| NEED_KEY{apiKey provided?}
    NEED_KEY -->|no| ERR_KEY([return session-owner error AAState])
    NEED_KEY -->|yes| SDK_ALCH["@getpara/aa-alchemy"]
    SDK_ALCH --> ADAPT_ALCH[adaptSmartAccount]

    RAW_7702 --> RETURN_7702([AAState])
    WALLET_4337 --> RETURN_4337([AAState])
    ADAPT_ALCH --> RETURN_SESSION([AAState])
```

#### Direct owner, `4337`

Direct-owner `4337` uses `@alchemy/wallet-apis`, not `@getpara/aa-alchemy`.

Key behaviors:

- transport is:
  - `alchemyWalletTransport({ url: proxyBaseUrl })` when proxy mode is active
  - otherwise `alchemyWalletTransport({ apiKey })`
- signer is created from `privateKeyToAccount(...)`
- paymaster config is included only when `gasPolicyId` exists
- the account ID is derived deterministically from the signer address by
  `deriveAlchemy4337AccountId()`
- account creation uses:
  - `requestAccount({ signerAddress, id, creationHint: { accountType: "sma-b", createAdditional: true } })`
- if Alchemy reports `Account with address 0x... already exists`, the code
  retries with `requestAccount({ accountAddress })`
- sends happen through `alchemyClient.sendCalls(...)` +
  `waitForCallsStatus(...)`
- the returned transaction hash comes from `status.receipts?.[0]?.transactionHash`

This path produces a `SmartAccount` whose `AAAddress` is the 4337 account
address returned by Wallet APIs.

#### Direct owner, `7702`

Direct-owner `7702` bypasses Wallet APIs and uses raw `viem`.

Key behaviors:

- fixed delegation target:
  - `0x69007702764179f14F51cdce752f4f775d74E139`
- RPC selection prefers:
  - `proxyBaseUrl`, then
  - `alchemyRpcUrl(chainId, apiKey)`, then
  - default transport fallback
- authorization is signed with `walletClient.signAuthorization(...)`
- call bundles are encoded with `encodeExecuteData(...)`
- gas is estimated with `authorizationList` included
- the code adds a hard-coded `25000` gas overhead for the 7702 authorization
- the raw transaction is sent to the signer's own EOA
- receipt status is checked and a reverted receipt throws

This path returns a `SmartAccount` with:

- `provider: "alchemy"`
- `mode: "7702"`
- `AAAddress = signer.address`
- `Delegation7702 = 0x6900...E139`

If a gas policy is configured, the 7702 path prints a warning that raw 7702 is
not paymaster-sponsored and the EOA pays gas directly.

#### Session owner

Alchemy session-owner creation still uses `@getpara/aa-alchemy`.

Current rule:

- session owners require a real `apiKey`
- proxy mode is not supported for session owners

If `options.apiKey` is missing for a session owner, `createAlchemyAAState()`
returns an `AAState` with an error:

```text
Alchemy AA with session/adapter owner requires ALCHEMY_API_KEY.
```

---

## Pimlico Implementation

`aa/pimlico/resolve.ts` is the only remaining provider-specific resolve module.

`resolvePimlicoConfig()` does all of the following:

- disables AA when `calls` is `null`
- disables AA when `localPrivateKey` is present
- builds a chain plan from `AAConfig`
- validates `modeOverride` against `supportedModes`
- resolves the API key from:
  - `options.apiKey`, else
  - `PIMLICO_API_KEY`, else
  - `NEXT_PUBLIC_PIMLICO_API_KEY` when `publicOnly === true`

When `throwOnMissingConfig` is true, Pimlico resolution throws on:

- unsupported / disabled chain
- missing API key
- unsupported mode override

`createPimlicoAAProvider()` is the React-facing factory:

- it calls `resolvePimlicoConfig(... publicOnly: true)`
- it forwards `PimlicoHookParams` into a caller-provided `usePimlicoAA` hook

`createPimlicoAAState()` is the async creator:

- it calls `resolvePimlicoConfig(... throwOnMissingConfig: true)`
- it forces `fallbackToEoa: false`
- it dynamically imports `@getpara/aa-pimlico`
- it uses the shared owner-resolution path from `owner.ts`
- it adapts the SDK smart account through `adaptSmartAccount(...)`

Unlike Alchemy, Pimlico does not have a proxy transport path in the current
code.

```mermaid
flowchart TD
    START([resolvePimlicoConfig]) --> CALLS{calls present?}
    CALLS -->|no| RET_NULL([return null])
    CALLS -->|yes| LOCAL_PK{localPrivateKey present?}
    LOCAL_PK -->|yes| RET_NULL
    LOCAL_PK -->|no| CHAIN_CFG[getAAChainConfig]
    CHAIN_CFG --> FOUND{chain configured?}
    FOUND -->|no| THROW_OR_NULL{throwOnMissingConfig?}
    THROW_OR_NULL -->|yes| THROW_CHAIN([throw chain/batching error])
    THROW_OR_NULL -->|no| RET_NULL
    FOUND -->|yes| API_KEY[resolve apiKey from option or env]
    API_KEY --> HAS_KEY{apiKey found?}
    HAS_KEY -->|no| THROW_KEY{throwOnMissingConfig?}
    THROW_KEY -->|yes| THROW_API([throw missing api key])
    THROW_KEY -->|no| RET_NULL
    HAS_KEY -->|yes| MODE_OK{modeOverride supported?}
    MODE_OK -->|no| THROW_MODE{throwOnMissingConfig?}
    THROW_MODE -->|yes| THROW_MODE_ERR([throw unsupported mode])
    THROW_MODE -->|no| RET_NULL
    MODE_OK -->|yes| PLAN[buildAAExecutionPlan]
    PLAN --> RESOLVED([PimlicoResolvedConfig])

    RESOLVED --> CREATE_PIM[createPimlicoAAState]
    CREATE_PIM --> OWNER_PIM[getOwnerParams]
    OWNER_PIM --> SDK_PIM["@getpara/aa-pimlico"]
    SDK_PIM --> ADAPT_PIM[adaptSmartAccount]
    ADAPT_PIM --> RETURN_PIM([AAState])
```

---

## Smart Account Adapter

`adaptSmartAccount()` is the bridge from provider SDK return values into the
library-level `SmartAccount` interface consumed by `executeWalletCalls()`.

The important normalization is the 7702 guard:

- if the SDK reports the same value for `SmartAccount4337` and
  `Delegation7702`, the adapter drops that delegation address as bogus

---

## Generic Execution Routing

`executeWalletCalls()` in `aa/types.ts` is still the single runtime router for
both the React/widget path and the CLI private-key path.

```mermaid
flowchart TD
    START([executeWalletCalls]) --> HAS_AA{providerState.resolved<br/>and providerState.account?}

    HAS_AA -->|yes| VIA_AA[executeViaAA]
    HAS_AA -->|no| HARD_FAIL{resolved + error<br/>and fallbackToEoa is false?}

    HARD_FAIL -->|yes| THROW_ERR([throw providerState.error])
    HARD_FAIL -->|no| VIA_EOA[executeViaEoa]

    VIA_AA --> BATCH{callList.length > 1?}
    BATCH -->|yes| AA_BATCH[account.sendBatchTransaction]
    BATCH -->|no| AA_SINGLE[account.sendTransaction]
    AA_BATCH --> AA_POST[build ExecutionResult]
    AA_SINGLE --> AA_POST

    AA_POST --> DELEG{mode === 7702<br/>and no Delegation7702?}
    DELEG -->|yes| FETCH_TX[resolve7702Delegation<br/>via authorizationList]
    DELEG -->|no| RETURN_AA([return AA result])
    FETCH_TX --> RETURN_AA

    VIA_EOA --> LOCAL_PK{localPrivateKey?}
    LOCAL_PK -->|yes| EOA_PK[per-call viem sendTransaction<br/>+ waitForTransactionReceipt]
    LOCAL_PK -->|no| WALLET_PATH[mixed-chain guard -> switchChain -><br/>sendCallsSyncAsync or sendTransactionAsync]
    EOA_PK --> RETURN_EOA([return eoa result])
    WALLET_PATH --> RETURN_EOA
```

### AA path

When `providerState.resolved` and `providerState.account` are both present:

- single call -> `account.sendTransaction(...)`
- multi-call -> `account.sendBatchTransaction(...)`

The returned `ExecutionResult` contains:

- `txHash`
- `txHashes`
- `executionKind = "${provider.toLowerCase()}_${mode}"`
- `batched`
- `sponsored = resolved.sponsorship !== "disabled"`
- `AAAddress`
- `Delegation7702`

For `7702`, delegation metadata is best-effort:

- first use `account.Delegation7702`
- if it is missing, fetch the on-chain transaction and read
  `authorizationList[0].address` or `authorizationList[0].contractAddress`

That fallback only knows these chains:

- Ethereum `1`
- Polygon `137`
- Arbitrum `42161`
- Optimism `10`
- Base `8453`

### EOA path

When AA is unavailable, or when `fallbackToEoa` remains enabled, the router
falls back to plain EOA execution.

There are two sub-paths:

#### Local private key path

When `localPrivateKey` is present:

- each call is sent with a chain-specific `viem` wallet client
- the code waits for every transaction receipt
- mixed-chain batches are supported because each call is executed separately

#### External wallet path

When `localPrivateKey` is absent:

- mixed-chain bundles are rejected
- the wallet is switched to the call chain when needed
- if wallet capabilities expose atomic batching as `supported` or `ready`,
  the code uses `sendCallsSyncAsync({ capabilities: { atomic: { required: true }}})`
- otherwise it sends each call individually with `sendTransactionAsync(...)`

### `fallbackToEoa` in current code

The generic router still honors `AAResolvedConfig.fallbackToEoa`.

That matters for app/widget usage where callers may want:

- "try AA if available"
- "drop to EOA if AA resolves with an error"

It does **not** drive the CLI's behavior. CLI-created AA states explicitly set
`fallbackToEoa: false`.

---

## CLI Execution Model

The relevant CLI files are:

- `cli/commands/defs/shared.ts`
- `cli/execution.ts`
- `cli/commands/wallet.ts`

The active command surface is `aomi tx sign`, not the old top-level `aomi sign`
alias described by older docs.

### Config parsing

`buildCliConfig(args)` creates a `CliConfig` directly from citty args + env:

- `execution` is:
  - `"eoa"` when `--eoa` is passed
  - `"aa"` when `--aa`, `--aa-provider`, or `--aa-mode` is passed
  - `undefined` otherwise
- `aaProvider` comes from:
  - `--aa-provider`, else
  - `AOMI_AA_PROVIDER`
- `aaMode` comes from:
  - `--aa-mode`, else
  - `AOMI_AA_MODE`

`--eoa` cannot be combined with `--aa-provider` or `--aa-mode`.

### Provider decision tree

`resolveCliExecutionDecision()` currently uses this order:

| Condition | Result |
| --- | --- |
| `config.execution === "eoa"` | plain EOA |
| `PIMLICO_API_KEY` is set and `config.aaProvider === "pimlico"` | Pimlico BYOK |
| `ALCHEMY_API_KEY` is set | Alchemy BYOK |
| otherwise | Alchemy proxy |

So the zero-config default is now:

```ts
{ execution: "aa", provider: "alchemy", aaMode, proxy: true }
```

There is no persisted AA JSON config anymore.

```mermaid
flowchart TD
    START([resolveCliExecutionDecision]) --> FORCE_EOA{config.execution === eoa?}
    FORCE_EOA -->|yes| EOA([execution: eoa])
    FORCE_EOA -->|no| PIM_KEY{PIMLICO_API_KEY set<br/>and aaProvider === pimlico?}
    PIM_KEY -->|yes| PIM_MODE[Pick mode]
    PIM_MODE --> PIM_DECISION([aa: pimlico BYOK])
    PIM_KEY -->|no| ALCH_KEY{ALCHEMY_API_KEY set?}
    ALCH_KEY -->|yes| ALCH_MODE[Pick mode]
    ALCH_MODE --> ALCH_DECISION([aa: alchemy BYOK])
    ALCH_KEY -->|no| PROXY_MODE[Pick mode]
    PROXY_MODE --> PROXY_DECISION([aa: alchemy proxy])
```

### Mode selection and ERC-20 guardrail

`resolveMode()` uses `DEFAULT_AA_CONFIG` for the chain's default mode, then
passes the result through `maybeOverride4337ForTokenOps(...)`.

That helper inspects calldata selectors for:

- `approve(address,uint256)` -> `0x095ea7b3`
- `transfer(address,uint256)` -> `0xa9059cbb`
- `transferFrom(address,address,uint256)` -> `0x23b872dd`

Behavior:

- if the chosen mode is `4337`
- and the call list contains ERC-20 operations
- and the chain supports `7702`
- and the user did **not** explicitly force `--aa-mode 4337`

then the CLI logs a warning and auto-switches to `7702`.

If the user explicitly requested `4337`, the CLI keeps `4337` and warns that
tokens must already be in the smart account.

```mermaid
flowchart TD
    START([resolveMode]) --> BASE[use explicit aaMode or chain defaultMode]
    BASE --> TOKENS{mode === 4337<br/>and ERC20 selector detected?}
    TOKENS -->|no| KEEP_BASE([keep chosen mode])
    TOKENS -->|yes| SUPPORTED{chain supports 7702?}
    SUPPORTED -->|no| WARN_KEEP([warn and keep 4337])
    SUPPORTED -->|yes| EXPLICIT{explicit aaMode?}
    EXPLICIT -->|yes| WARN_KEEP
    EXPLICIT -->|no| SWITCH_7702([warn and switch to 7702])
```

### Provider state creation

`createCliProviderState()` turns the decision into a concrete `AAState`:

- `eoa` -> `DISABLED_PROVIDER_STATE`
- `aa` -> `createAAProviderState(...)`

For Alchemy proxy mode it derives:

```text
${baseUrl}/aa/v1/${ALCHEMY_CHAIN_SLUGS[chain.id]}
```

and passes that as `proxyBaseUrl`.

CLI AA always uses a direct owner:

```ts
owner: { kind: "direct", privateKey }
```

### `signCommand()` flow

```mermaid
sequenceDiagram
    participant User as User
    participant Sign as signCommand
    participant Sim as session.client.simulateBatch
    participant Exec as resolveCliExecutionDecision
    participant Create as createCliProviderState
    participant AA as createAAProviderState
    participant Router as executeWalletCalls
    participant Backend as session.client.sendSystemMessage

    User->>Sign: aomi tx sign <tx-id>...
    Sign->>Sim: simulate pending tx batch
    Sim-->>Sign: batch_success + optional fee
    Sign->>Sign: append fee transfer when present
    Sign->>Exec: resolve provider + mode
    Exec-->>Sign: CliExecutionDecision

    Sign->>Create: build provider state
    Create->>AA: create Alchemy/Pimlico AA state
    AA-->>Create: AAState
    Create-->>Sign: providerState
    Sign->>Router: executeWalletCalls(...)

    alt primary mode succeeds
        Router-->>Sign: ExecutionResult
    else primary mode fails
        Sign->>Sign: getAlternativeAAMode()
        Sign->>Create: rebuild provider state with opposite mode
        Sign->>Router: retry once
        Router-->>Sign: ExecutionResult or error
    end

    Sign->>Backend: wallet:tx_complete
    Sign-->>User: tx hash + AA metadata
```

Important runtime details:

- transaction batches are simulated first with `session.client.simulateBatch(...)`
- when simulation returns a fee, the CLI appends one extra native transfer call
- AA execution is attempted with the resolved mode
- if that AA attempt fails, the CLI retries once with the opposite mode:
  - `7702 -> 4337`
  - `4337 -> 7702`
- if both AA modes fail, the command exits with an error and suggests `--eoa`

There is **no** automatic AA -> EOA fallback in `signCommand()`.

Typed-data signing is separate:

- `kind === "eip712_sign"` bypasses the AA pipeline completely
- the CLI signs via `walletClient.signTypedData(...)`

---

## Public Surface

`packages/client/src/index.ts` re-exports the current AA API:

- `DEFAULT_AA_CONFIG`
- `getAAChainConfig`
- `buildAAExecutionPlan`
- `getWalletExecutorReady`
- `executeWalletCalls`
- `createAlchemyAAProvider`
- `createPimlicoAAProvider`
- `adaptSmartAccount`
- `isAlchemySponsorshipLimitError`
- `resolvePimlicoConfig`
- `createAAProviderState`

The generic AA facade is intentionally small now:

- planning lives in `aa/types.ts`
- provider-specific behavior lives in `aa/alchemy/*` and `aa/pimlico/*`
- CLI selection logic lives in `cli/execution.ts`

---

## Current Differences From Older Specs

These are the main corrections relative to stale documentation:

- No persisted `~/.aomi/aa.json` config remains.
- No `aomi aa status|set|test|reset` commands remain.
- No shared env-resolution layer remains for Alchemy.
- React Alchemy AA is driven by an inlined `resolveForHook()` that reads
  `NEXT_PUBLIC_*` env vars directly.
- CLI default execution is AA, not EOA.
- CLI zero-config AA uses the backend Alchemy proxy.
- CLI failure fallback is AA-mode-to-AA-mode, not AA-to-EOA.
- `fallbackToEoa` still exists in the generic AA config model, but CLI-created
  AA states force it to `false`.
