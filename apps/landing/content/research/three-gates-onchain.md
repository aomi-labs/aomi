## Intent → build → sign → settle

Agentic finance turns a user instruction into an onchain state transition. The central security question is which actor can block a transaction as it moves toward settlement, and whether that decision remains effective when an earlier component fails.

A coding agent follows a familiar path to production: **intent → build → commit → deploy**. A request becomes a code change before it is committed and deployed. Review and deployment controls are necessary because the original request does not determine what will ultimately run.

An onchain financial agent follows a similar path: **intent → build → sign → settle**. A request to move idle USDC into a conservative yield position must be translated into a venue, a set of contract calls and an authorized transaction. If the agent relies on a forged instruction or an incorrect balance, that transaction may still be valid and settle successfully.

![Two parallel paths show a coding agent moving from intent to build to commit to deploy, and a financial agent moving from intent to build to sign to settle. The latter introduces a runtime guard, a wallet policy, an onchain mandate, and a builder assertion.](figures/01-two-paths.svg)

Figure 1. Both pipelines include controls at critical transitions. Software changes may pass through human review, continuous integration and a merge decision before deployment. Financial transactions have analogous controls, but a signature does not constitute substantive review and settlement may be irreversible.

The transaction passes through a preliminary runtime guard and three later gates. The runtime can reject an action during construction under rules operated by the application. The wallet provider can deny a signature under an independently administered policy. Account or protocol code can revert the call during execution. A builder or sequencer can decline to include it. Each gate evaluates different evidence and has distinct bypass paths.

The relevance of each gate depends on the failure it is intended to prevent. The analysis begins with the ways an otherwise valid transaction can be wrong for the user.

## The risk landscape: attacks vs defects

Two families of failure end in the same place: a transaction that is valid onchain and wrong for the user.

**Adversarial attacks.** An attacker manipulates the agent into constructing, signing or settling a harmful transaction. The attacker may forge an instruction, corrupt observed state, alter a checked payload or exploit the transaction during inclusion. The agent may operate correctly while relying on compromised inputs.

**Capability defects.** An agent may also construct an incorrect transaction without adversarial interference. Examples include a mis-encoded call, an omitted approval, an incorrect decimal conversion, a stale route or an unsupported protocol feature. Valid inputs do not guarantee a correct transaction.

### Adversarial attacks

The attack surface follows the pipeline. Each transition admits a different kind of tampering.

**Intent → build.** *Injected intent* changes what the agent believes the user requested. It may enter through a forged chat turn, a tool result that impersonates the user or a document from a compromised upstream system. A signature over the resulting transaction confirms that a signer authorized specific bytes under a policy. It does not establish that the user intended the transaction. *Injected state* instead corrupts the agent's view of the environment. A compromised RPC, indexer or quote service might report a 2,000-USDC balance when the account holds 3,000. It might also substitute a token address, provide a stale quote or conceal a spender within a route. The agent can then execute an incorrect plan while following an authentic instruction.

Consider a user who wants to keep 2,000 USDC liquid and deposit the rest into a named vault. The actual balance is 3,000 USDC. If the agent sees a forged balance of 2,000, it deposits nothing and silently fails to carry out the strategy. If it sees a forged balance of 4,000, it may try to deposit 2,000 and leave only 1,000 liquid. A wallet rule that checks only the destination could approve the second transaction. A rule that independently checks the reserve could refuse it. A vault-level assertion might see a healthy deposit and miss the wallet-level requirement entirely. Each checkpoint needs the right facts and the right rule to catch the error.

![An attacker can corrupt the interpreted intent or observed state before transaction construction. Later controls see more exact transaction data but less of the original meaning.](figures/02-injection-boundaries.svg)

Figure 2. Later checkpoints are stronger at enforcing narrow invariants, but usually have less direct evidence of what the user meant.

**Build → sign.** The simulated payload may differ from the payload presented for signing. A serialization step, relay, browser extension or model-generated continuation can alter calldata, recipient or value after the checks have completed. Policy scope creates a separate risk. An action that requires human approval may be signed automatically because the authorization rule is too broad. The same problem arises when the application can modify the policy intended to constrain it.

**Sign → settle.** After signing, an agent-built transaction faces the same inclusion risks as any other transaction. These include sandwiching, front-running, adverse execution against a stale quote and chain reorganization. Controls that terminate at signing cannot address these risks. Within the architecture examined here, only the builder gate observes the transaction in its prospective inclusion context.

Key compromise remains relevant, but it predates agentic execution and falls outside the failure modes examined here.

### Capability defects

The runtime policies, wallet policies, onchain mandates and builder assertions surveyed below may reject defective transactions that violate a defined invariant. They do not correct the capability failure that produced the transaction. Reducing those failures requires improvements to the model, its tools, its protocol knowledge and its execution feedback.

Agent benchmarks demonstrate how strongly performance depends on the execution environment. The [SWE-agent](https://arxiv.org/abs/2405.15793) authors reported an approximately tenfold difference between a retrieval baseline and an agent-computer interface for one model on the same repair benchmark. [AomiBench v0.1](/research/aomibench-v0-1) produced 65 strict failures across 694 scorable runs. All were capability defects involving tool order, arguments or missing evidence rather than adversarial inputs. These results measure the joint behavior of model and harness; they do not estimate the prevalence or financial impact of real-world attacks.

## A gate is defined by its enforcement point

Attacks and capability defects have different causes but can produce the same policy violation. A spending limit may block both an attacker and an agent that calculated the amount incorrectly. The gate does not improve the agent's capability. It prevents a transaction that violates the defined limit from reaching settlement.

The enforcement points follow the transaction path. Gate 0.5 acts while the transaction is being built. Gate 1 controls signing. Gate 2 enforces the mandate during onchain execution. Gate 3 evaluates the transaction before inclusion. Each later gate sees a more concrete transaction but less of the user's original intent.

![Nested regions: the runtime sits inside the application, the wallet provider beside it and the chain beyond. Gate 0.5 guards tool calls inside the runtime, Gate 1 is signing policy at the wallet boundary, Gate 2 is a mandate enforced by the smart account or protocol and Gate 3 is an assertion the builder evaluates before inclusion.](figures/00-gate-architecture.svg)

Figure 3. The model builds against forked chain state. The runtime guard rejects prohibited tool calls, the wallet denies a signature, the account or protocol reverts and the builder declines inclusion. Each gate is administered by a different party.

### Coverage requires an unavoidable path

A warning, score, simulation or dashboard is not a gate merely because it appears before a transaction. A gate requires a **defined decision**, a **specific enforcement point** and a **failure posture**. Coverage depends on the action it can reject, the authority that can change its rule, the routes that can bypass it and its behavior when the evaluator is unavailable. Evidence must also show that the transaction presented at settlement is the transaction that passed the check.

Coverage analysis begins by tracing every path from an agent-controlled request to a movement of value. A gate protects an invariant only when **every relevant path crosses that check** or a stricter one. Adding a vendor does not create a new trust boundary when the application can modify both policies or select an uncovered route. The gate must remain effective even if the application stops cooperating. The analysis therefore classifies each gate by its enforcement point rather than the location of a warning or dashboard.

## Gate 0.5: Runtime controls remain inside the application boundary

The earliest gate operates while the agent is constructing a transaction. A runtime can limit available tools and reject a call before execution. It can restrict destinations or function selectors, require authorization and stage a transaction for simulation before broadcast. Because the runtime also controls tools and context, it can detect some capability defects and return a specific explanation. It remains inside the application trust boundary and cannot protect the user from an operator that controls both the runtime and the signing route.

### Construction quality depends on the harness

Three deployment models illustrate how the execution environment affects capability defects. The first provides no harness. The second provides a generic tool layer. The third uses the integrated runtime measured in AomiBench.

**A frontier model with no harness.** A frontier model operating directly from a funded wallet must identify the relevant program or contract, retrieve the IDL or ABI, determine the required accounts or approvals, encode the instruction, estimate compute or gas and broadcast the transaction. Without pre-execution feedback, the first error signal may be a live-chain revert. The error arrives after broadcast, may incur a fee and may provide limited diagnostic information.

**A frontier model on a generic tool layer.** A wallet or RPC tool server can abstract broadcasting and key management. The model may still need to select the contract, retrieve and interpret the ABI, encode the arguments and convert amounts into base units. If the tool layer does not execute the call against a fork before staging, the first error signal remains a live-chain revert. A wallet simulation may provide a warning at signing, after the agent has already completed transaction construction.

**A smaller model with an integrated harness.** A model such as minimax-m2.5 can operate through a runtime with EVM and SVM integrations. The model invokes a typed tool while the runtime constructs the instruction. The runtime can supply current chain state, public contract source and protocol-specific procedures. It can also execute the transaction on a sandboxed fork before signing. Reverts and invalid arguments then return as structured feedback within the agent loop. Runtime guards can evaluate tool calls before and after execution.

![Two columns run the same instruction, approve 500 USDC for the Uniswap router. On the left a frontier model with no harness performs eight steps by hand, four of which can be silently wrong until a revert on the live chain. On the right a smaller model on an integrated runtime emits one typed tool call and the harness encodes, simulates in a sandbox, runs guards and stages, with the first error signal arriving before anything is signed.](figures/02b-same-task-two-worlds.svg)

Figure 4. The same instruction under the first and third deployment models. Without a harness, four of eight steps may fail without producing a signal before the chain rejects the transaction. With an integrated harness, the model emits one typed call and receives feedback before authorization. A generic tool layer occupies the middle position. It removes steps 6 and 7 from the model while leaving steps 1, 4 and 5 under model control.

The following argument was submitted to the staging tool for the instruction in Figure 4 and is reproduced from [AomiBench v0.1](/research/aomibench-v0-1):

```jsonc
{
  "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",      // USDC contract address
  "description": "Approve 500 USDC for Uniswap V3 Router",  // human-readable label
  "data": {
    "encode": {
      "signature": "approve(address,uint256)",             // Solidity-style signature
      "args": [
        "0xE592427A0AEce92De3Edee1F18E0157C05861564",       // spender (the router)
        "500000000"                                         // amount in base units
      ]
    }
  },
  "value": "0",
  "kind": "erc20_approve"                                   // semantic tag for guards
}
```

The model supplies this structured argument rather than raw calldata. The harness computes the four-byte selector and ABI-encodes the arguments. It also injects the sender and chain identifier from wallet context. The resulting call is executed on a forked chain and evaluated by runtime guards before it is staged for signing. The amount in base units remains model-supplied in this example, although protocol-specific tooling can derive that value.

| | Frontier model, no harness | Frontier model, generic tool layer | Smaller model, integrated harness |
| --- | --- | --- | --- |
| Who encodes the call | The model, by hand | The model, from an ABI it fetched; the tool signs what it is given | The runtime, from a typed tool |
| What the model sees | Whatever it fetches itself | RPC reads through tools, no forked execution | Live state, contract source, protocol skills |
| Knowledge of the protocol | In-weights only | In-weights, plus whatever it retrieves | Skill-supplied: addresses, ABI, procedure |
| First signal of error | Revert on the live chain | Live revert, or a wallet's simulation warning at signing | Sandbox revert, tool failure, guard refusal |
| Cost of a mistake | Potential fee or position loss | Potential fee or position loss | Offchain compute and a retry |

AomiBench also records the limits of the harness. One of the highest-scoring models failed both attempts at a read-only ZORA balance task on Base. The trace is reproduced below:

```
Task:           check_zora_token_balance, read-only
Model:          gpt-5.5, a top scorer overall
What it did:    activated the zora skill but never issued a well-formed encode_and_call
First bad step: no matching `to` (ZORA contract), no matching `function_signature` (balanceOf)
Failed check:   tool assertion, both passes
```

The runtime did not supply the ZORA contract address, and the model did not produce a valid call. A generic tool layer with current web search could have retrieved the missing address and may have performed better on this task. The result does not establish that packaged protocol knowledge is superior to retrieval. It shows that accurate encoding depends on correct protocol information being available before staging. This failure arose from missing knowledge rather than adversarial input.

An execution harness improves transaction construction but does not independently enforce the user's policy. The same runtime can host Gate 0.5 by evaluating the simulated result and applying guards to tool calls. That coverage is limited to actions routed through those tools. A model that constructs calldata through another path may avoid the guard entirely.

### Runtime policy at the pre-commit boundary

A source review of the Aomi Labs runtime identifies three enforcement mechanisms. Tool hooks can reject a call before execution, while tools associated with an inactive skill remain unavailable. Guard code evaluates EVM restrictions on chain, target, function selector and approval spender. For Solana, it evaluates program and instruction-discriminator restrictions when a transaction is staged. A separate signing-policy step rejects commits from read-only threads and wallets not owned by the thread. The child-agent path for committing staged work also requires a passing simulation result. These controls operate in software rather than through model instructions.

Coverage remains path-specific. Not every commit route requires a passing simulation. A guard that relies on a caller-declared dollar amount does not independently measure the limit it enforces. A guard implemented in source also has no effect on a route that does not invoke it. Source inspection therefore cannot replace an end-to-end test of the staging path. Until that test succeeds, the route should not be classified as covered. The runtime provides a *development and operational control*, not an independent settlement guarantee. Its operator remains inside the trust boundary.

Comparable products target the same enforcement point. [AWS AgentCore Gateway Policy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/use-gateway-with-policy.html) evaluates MCP tool calls and can deny them by default. AWS limits this policy surface to MCP tools, which leaves other action paths outside its scope. [Permit MCP Gateway](https://docs.permit.io/permit-mcp-gateway/guide/) and [Cloudflare MCP portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/) also apply controls at the tool boundary. [Lakera's agent behavior defense](https://docs.lakera.ai/docs/agent-behavior-defense) evaluates agent behavior for suspicious activity. For each product, coverage depends on whether every path capable of moving value passes through the policy.

### Simulation supports a decision but does not provide authority

Simulation can reveal a revert, a bad route or an excessive allowance before signing. It cannot freeze chain state until inclusion or prove that the user wanted the trade. The RPC state, quotes and token metadata it relies on may themselves be compromised. A passing result should be tied to the exact call bytes and account, as well as the chain, block reference and policy version. After settlement, those details should be compared with the receipt. If the bytes change, the simulation result no longer applies.

## Gate 1: Wallet custody becomes a gate only with independent policy

An embedded-wallet provider separates key custody from an application for users who do not manage their own keys. That separation is conditional. The provider becomes an independent gate only when it enforces a rule **outside the application's unilateral control** and the application cannot obtain the same signature through another route. Hardware isolation protects key material. It does not establish whether a transaction reflects the user's intent.

![The user gives an agent runtime an intent and separately establishes delegated signing policy with a wallet provider. The runtime sends an exact signing request through MCP but never receives the private key. The provider evaluates the request against user-controlled policy and signs inside a trusted execution environment only when the request is permitted.](figures/05-wallet-policy-tee.svg)

Figure 5. The runtime supplies the signing request, while policy rooted in the user's consent supplies the authority. The wallet provider retains the private key inside a trusted execution environment. This is a joint authorization decision, not a joint custody arrangement.

The architecture separates proposal, authority and custody. The agent proposes an exact transaction through MCP. The wallet provider evaluates that request against the user's delegated policy and executes an approved signature inside its enclave. The runtime never receives the private key. This boundary is meaningful only when the application cannot change the policy or obtain the same signature through another route.

### Independent custody is not independent policy

An effective signing policy applies to the exact request. It can restrict the chain and account, limit destinations or functions and cap spending over time. It may also require a simulation. Policy governance is equally important. If the application server controls both signing requests and policy administration, a well-protected key does not provide an independent gate against that server. The trust boundary changes when the user controls an authorization key, an independent party participates in the quorum or the provider enforces a restriction that the application cannot modify.

[Privy](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) documents enclave-enforced authorization and wallet policies. It also describes service-controlled wallets and checks, including simulation, that may run outside the enclave. [Turnkey](https://www.turnkey.com/solutions/ai-agents) provides programmable signing within secure enclaves. [Coinbase CDP's Policy Engine](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/evm-policies) specifies EVM restrictions on signing activity. [Fireblocks](https://developers.fireblocks.com/docs/what-is-fireblocks) combines MPC custody with transaction policy and approval workflows. These products differ in key custody, policy administration and enforcement location. Independence depends on whether an adversary controlling the agent application can obtain a prohibited signature or relax the governing rule.

| Provider | Documented signing control | Independence question |
| --- | --- | --- |
| [Privy](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) | The enclave checks authorization keys, quorums and wallet policies before signing. Separate screening or simulation may run outside it. | Does the user or an independent quorum control the wallet, or does the application hold the decisive authorization key? |
| [Turnkey](https://www.turnkey.com/blog/turnkey-policy-engine-guardrails-web3-transactions) | Policy evaluation and signing occur inside secure enclaves. Policies can constrain transaction structure and require approvals. | Who holds root authority to change policy or satisfy the approval quorum? |
| [Coinbase CDP](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/policy-engine/create-policy) | Project- or account-scoped rules govern specified signing and sending operations. | Can the same application credentials edit the policy and initiate the transaction? |
| [Fireblocks](https://developers.fireblocks.com/docs/raw-signing) | MPC signing is paired with transaction authorization policy. Raw signing is blocked without appropriate rules. | Which workspace roles can change the policy, approve the request, or use a different vault path? |

Table 1. Documented controls are not a ranking. Independence is a property of the deployment's authority graph, not of its wallet provider.

### Coverage ends at the first bypass route

A signing policy governs only the key and API path within its scope. Alternative signers, exported keys, root owners, existing token allowances, permit signatures, delegated smart-account keys or activity on another chain may fall outside that scope. A provider may inspect the outer transaction without reliable visibility into a router's internal effects. Offchain risk scoring and simulation add useful signals, but they constitute policy enforcement only when the provider fails closed on their results. Gate 1 is strongest when the signed payload is narrowly scoped, intelligible to the authorizing party and mechanically bound to the transaction simulated by the runtime.

## Gate 2: Onchain mandates govern only the execution paths they cover

A smart account or settlement contract can express an agent's authority as an execution rule rather than an offchain policy promise. A mandate can restrict the agent key to specified calls, recipients, assets, amounts, intervals or state outcomes. A transaction may be validly signed and still revert because it violates the account or protocol rule. The application cannot unilaterally broaden a correctly installed and non-bypassable contract mandate. Coverage still depends on the contract code, configuration, upgrade authority and execution path.

Onchain mandates are usually tied to account abstraction or a smart-wallet implementation. A conventional EOA does not expose programmable account-level authorization. A smart account inserts contract logic between a delegated signer and the assets it controls. EIP-7702 can give an EOA address smart-account behavior through delegated code, but the enforceable rule still comes from contract execution. Protocol contracts can impose their own mandates, although those rules govern protocol state rather than every action available to the user's account.

![An agent or session account requests execution from a Safe Smart Account. The Safe invokes an installed Guard before executing the target call and again after execution. Either Guard check can revert the covered transaction.](figures/06-safe-guard-mandate.svg)

Figure 6. Safe Guards illustrate the smart-account pattern. The Safe calls an installed Guard before execution to inspect transaction parameters and after execution to inspect the result or final state. The Guard can block the transaction at either point. This protection applies only to execution routed through that Safe and Guard. Adapted from the [Safe Guards documentation](https://docs.safe.global/advanced/smart-account-guards).

The draft [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715) standardizes how an application requests scoped execution permissions from a wallet through `wallet_requestExecutionPermissions`. It does not itself define the onchain gate. The granted permission is redeemed through the delegation interface in [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710), where a delegation manager validates the permission context before calling the user's smart account. MetaMask's [Advanced Permissions](https://support.metamask.io/more-web3/dapps/advanced-permissions/) uses this model and requires smart-account functionality. The session account may submit an action without another interactive signature, but it can exercise only the authority encoded in the granted permission.

### Mandates live in smart accounts, guards and delegation managers

[ZeroDev Kernel permissions](https://docs.zerodev.app/smart-accounts/permissions/intro) combine a signer with policies over the actions it may perform. [Biconomy Smart Sessions](https://docs.biconomy.io/sdk-reference/sessions), [Rhinestone spending limits](https://docs.rhinestone.dev/smart-wallet/smart-sessions/policies/spending-limit), MetaMask's ERC-7710 delegations and [Coinbase smart-account spend permissions](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-smart-accounts/create-spend-permission) provide other mechanisms for constraining delegated authority. [Safe Guards](https://docs.safe.global/advanced/smart-account-guards) can evaluate transaction parameters before execution and final state afterward. [Zodiac Roles](https://docs.zodiac.eco/developers/roles/permissions) provides granular permissions. Onchain controls can therefore evaluate both transaction inputs and resulting state. Their effective scope depends on whether the relevant account path exposes the state required to evaluate the invariant at an acceptable cost.

| Contract pattern | What it can enforce | Boundary to test |
| --- | --- | --- |
| Wallet-requested delegation: [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715), [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710) | A wallet grants scoped authority to a session account. A delegation manager validates the permission context when that authority is redeemed. | ERC-7715 defines the request interface. The smart account and delegation contracts provide enforcement. Test alternate account paths and root authority. |
| Session policies: [ZeroDev](https://docs.zerodev.app/smart-accounts/permissions/intro), [Biconomy](https://docs.biconomy.io/sdk-reference/sessions), [Rhinestone](https://docs.rhinestone.dev/smart-wallet/smart-sessions/policies/spending-limit) | Installed validator and policy modules restrict a delegated key's calls, time, usage or spend. | Owner calls, alternative validators, upgrades and accounting across batches or fee tokens. |
| Account guards and roles: [Safe](https://docs.safe.global/advanced/smart-account-guards), [Zodiac](https://docs.zodiac.eco/developers/roles/permissions) | Rules check transaction parameters before execution or state after execution. Roles provide granular permissions. | Module routes, guard replacement authority and denial of service from an over-restrictive guard. |
| Delegated EOA: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) | Delegated code implements smart-account behavior, potentially including session validation. | The EOA root key can originate transactions and change or clear delegation. Not every path enters the session validator. |

Table 2. “Onchain” describes the enforcement location. It does not answer whether every path to the asset is covered.

### Policy precision depends on accounting semantics

A nominal limit such as “spend no more than 100 USDC today” leaves several accounting questions unresolved. The policy must specify whether gas paid in the same token counts toward the limit. It must also define the treatment of approvals, router-mediated transfers and balance changes in rebasing tokens. The scope may apply per chain, account, session key or user. Biconomy's session documentation, for example, notes that fee payment in the spend token can affect the effective limit. A robust mandate defines the measured asset delta, the applicable time or nonce window and every call path that can modify the same balance.

An [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) delegated EOA illustrates this boundary. Delegated code can implement smart-account behavior, but the original EOA key retains protocol-level authority to change the delegation. Direct transaction paths may also avoid the delegated account's session validator. A session mandate therefore governs the **session route**, not every action available to the address. Existing approvals, owner modules, upgrade authority and escape paths require the same analysis. Onchain enforcement is authoritative only for the state and authority paths it controls.

### Contract enforcement is strongest for essential invariants

Rules that are essential to asset safety and inexpensive to evaluate are candidates for enforcement near the account or asset. Examples include a recipient allowlist, a maximum debit or a collateral floor. Contract enforcement adds gas cost and upgrade complexity. An incorrect rule may also deny legitimate transactions. Rules that require broad cross-protocol state or rapid incident response may not fit contract execution. An offchain gate can address part of that gap, but it does not provide equivalent onchain enforcement.

## Gate 3: Builder assertions are final but path-dependent

A builder or sequencer sees a fully formed transaction against a prospective block state. An assertion can evaluate the transaction immediately before inclusion and reject it when the resulting state violates a protected invariant. This remains a **pre-inclusion** control rather than a universal guarantee of finality. Its authority derives from a specific builder or rollup sequencer path rather than the base consensus rules. Among the gates examined here, the builder alone observes transaction ordering and prospective block state. It can therefore evaluate inclusion-time risks such as sandwiching, front-running and execution outside a price bound.

### Phylax evaluates prospective state beside the builder

[Phylax Credible Layer](https://docs.phylax.systems/credible/architecture-overview) attaches protocol-authored assertions to protected contracts. Its documented flow simulates candidate transactions and supplies assertions with pre-state and post-state snapshots. Transactions that violate an assertion are removed during block construction. The [assertion overview](https://docs.phylax.systems/credible/assertions-overview) describes cross-call and cross-contract checks that do not require modification of the protected contract. It also documents a default evaluation limit of 3 million gas. A protocol can therefore define a state invariant, such as a minimum collateralization ratio, instead of enumerating every call sequence that might violate it.

![An integrated block builder sends a candidate transaction to the Phylax Assertion Enforcer sidecar. PhEVM simulates the transaction against pre-transaction and post-transaction state, executes active assertions, and returns a valid or invalid report before the network applies its inclusion policy.](figures/07-phylax-credible-layer.svg)

Figure 7. Phylax separates the assertion lifecycle from the transaction hot path. Protocol teams publish assertion releases, Credible Layer contracts identify the active rules and Assertion DA makes their code available to the enforcer. During block production, the builder-operated sidecar evaluates a candidate transaction in PhEVM and returns a validation report. The network then applies that report through its inclusion policy. This is enforcement on an integrated builder route, not a base-consensus validity rule. Adapted from the [Phylax Credible Layer architecture](https://docs.phylax.systems/credible/architecture-overview).

Builder evaluation differs from runtime simulation because it occurs against the block-construction context and can determine inclusion. Coverage requires the assertion to be installed for the affected contract and triggered by the relevant state change. The assertion must also satisfy the builder's operational requirements and run on a supported block-building path. It observes a state transition rather than the original user instruction. A transaction based on injected intent may therefore pass when it does not violate the protected invariant.

### Pre-inclusion controls form an emerging market

[Forta Firewall's OP Enterprise integration](https://forta.org/blog/forta-firewall-on-op-enterprise-a-sequencer) describes sequencer-level screening for sanctions and freeze-list use cases, with Ink identified as the first adopter. [BlockSec STOP](https://blocksec.com/blog/revolutionizing-l2-chains-building-intrinsic-security-from-sequencers) and [Hypernative's chain integrations](https://www.hypernative.io/solutions/chain-integrations) describe related forms of pre-execution intervention. Comparison requires attention to enforcement location and rule ownership. A detector that alerts after inclusion supports incident response but cannot prevent settlement. A sequencer filter can reject a transaction on an integrated route without becoming a protocol-level validity rule for every inclusion path.

| System | Decision surface | Published deployment evidence |
| --- | --- | --- |
| [Phylax Credible Layer](https://docs.phylax.systems/credible/network-integrations/architecture-linea) | Contract-linked, deterministic assertions evaluated by a block-builder integration with pre/post-state access. | Linea/Besu plugin and sidecar integration are documented. Current Linea support is Legacy V1. |
| [Forta Firewall](https://forta.org/blog/forta-firewall-on-op-enterprise-a-sequencer) | Sequencer screening policies, initially described for sanctions and freeze lists. | Forta names Ink as the first OP Enterprise adopter. |
| [BlockSec STOP](https://blocksec.com/blog/revolutionizing-l2-chains-building-intrinsic-security-from-sequencers) | A threat-inspection node in front of the sequencer scans and quarantines suspect transactions. | BlockSec describes a co-developed Manta Pacific deployment. |
| [Hypernative chain integrations](https://www.hypernative.io/solutions/chain-integrations) | Marketed sequencer- or protocol-level detection and automated response. | The cited product page describes the offering, not a named deployment or a particular fail posture. |

Table 3. These mechanisms all act before inclusion, but they are not equivalent assertion systems. The descriptions come from each vendor's documentation.

### Coverage depends on the builder route and failure posture

Gate 3 can prevent inclusion only when three conditions hold. The transaction must pass through an integrated builder, an active assertion must cover its effects and the operator must enforce the result. Phylax's [trust model](https://docs.phylax.systems/credible/trust-model) and [FAQ](https://docs.phylax.systems/credible/faq) qualify the scope of that protection. The current Linea integration supports Legacy V1 assertions, while forced-inclusion handling remains a separate workstream. More broadly, L1 deposit and forced-inclusion mechanisms can limit a rollup sequencer's discretion. The [OP Stack protocol overview](https://specs.optimism.io/protocol/overview.html) illustrates why a sequencer does not constitute the entire settlement system.

A fail-open builder preserves liveness but may include a transaction that violates an assertion. A fail-closed builder protects its route but may halt legitimate activity when the evaluator fails or becomes unavailable. Policy activation, upgrades, gas limits and alternative builders also affect coverage. Phylax's [0x Settler mitigation report](https://phylax.systems/blog/0x-settler-mitigation-report/) documents a targeted deployment. Its prevented-loss estimates are vendor-reported and do not provide an independent measure of general protection for agent wallets.

![A comparison matrix maps four veto locations to the object they inspect, who administers them, and the most important escape path.](figures/03-gate-matrix.svg)

Figure 8. An additional gate changes the authority an attacker must subvert only if it is independently administered and unavoidable on the relevant execution path.

## The gates must evaluate the same transaction

Each gate has a partial view of the transaction. The runtime observes the user's instruction, the agent's tool calls and the simulation. The wallet evaluates the signing request against account policy. The contract evaluates the executed call and resulting state changes. The builder evaluates the transaction within a prospective block. The architecture is effective only when these partial views constrain the same action under independently administered rules. Multiple vendors do not create independent controls when each relies on the application's assertion that a transaction is safe.

### Transaction provenance links decisions across gates

Every security decision should remain associated with the transaction it evaluated. The transaction trace should identify the authorizing principal, account, chain, destination, calldata, value limits, deadline, simulation reference and applicable policy versions. Each layer should authenticate the fields available to it against the exact signing request. A payload change after simulation should invalidate the earlier result. After settlement, the receipt and balance changes should be compared with the same trace. Inclusion alone does not establish that the intended economic outcome occurred.

This requirement extends the coding-agent analogy beyond workflow. A deployment system preserves the relationship between source code, the reviewed artifact, the approved environment and the running service. Agentic finance requires comparable transaction provenance because settlement may be irreversible and value may move through contracts the agent did not author.

### Bypass tests demonstrate coverage

Coverage is a property of the execution path rather than the presence of a configured control. Validation should deliberately attempt to route around each gate. The test may alter a quote or payload after simulation but before signing. It may submit the same operation through a direct commit path or request a signature through another credential. It should also exercise an owner key or existing allowance against a session limit. Builder coverage requires submission through a route without the assertion and an evaluator outage test to determine whether the integrated route fails open or closed.

Each attempt should record the gate that rejects the transaction and confirm that the decision applies to the exact transaction bytes. Any route that avoids rejection should be documented as uncovered. An intended architecture does not by itself demonstrate enforced coverage.

## Conclusion

Two failure classes can produce a transaction that is valid onchain and wrong for the user. Adversarial attacks corrupt intent, state or transaction handling. Capability defects cause the agent to construct an incorrect transaction without hostile input. A gate can constrain unsafe outcomes from either class when they violate a defined policy. It does not correct the capability defect itself. Reducing defect frequency requires improvements to the model and execution harness, while resistance to adversarial manipulation requires enforcement outside the compromised component.

The resulting control map is specific. Runtime guardrails can reject unsafe construction under rules operated by the application. Independent wallet policy can deny signatures that the application cannot authorize alone. Onchain mandates can define delegated authority as an execution rule. Builder assertions can reject protected state transitions immediately before inclusion. No gate protects a transaction path that does not cross its enforcement point.

A security evaluation should specify the user's mandate, enumerate every path to value movement, identify the authority that can block each path and test the claimed coverage under injected intent, injected state and degraded operation. These tests distinguish an intended security architecture from an enforceable one.

## Method and scope

### Evidence standard

We classify each control by the evidence it evaluates, the authority that can modify it and its position relative to signing and inclusion. The analysis also examines bypass routes. A vendor feature description supports a claim about the documented mechanism, not a customer's configuration. A named integration provides deployment evidence but does not establish complete coverage or an independently measured prevention rate. The discussion of the Aomi Labs runtime is a first-party source review of `product-mono` at commit `a63f5f4f593f`, not an external audit. The reviewed child-agent path uses `commit_staged`, while the direct commit path does not require a passing simulation. The EVM guard table also relies on a caller-declared `usd_amount` for its dollar limit. Coverage of that path remains unverified pending an end-to-end test confirming that the staging tool invokes the guard. The benchmark figures are drawn from [AomiBench v0.1](/research/aomibench-v0-1), which ran two passes per specification. They measure joint model-and-harness performance rather than model intelligence in isolation.

### Limits

The sources were reviewed on 18 September 2026. Product capabilities and chain deployments can change. Every deployment should be tested against its own configuration and transaction routes. We did not independently reproduce provider signing-policy decisions or builder failures. We also did not measure false positives or audit the cited smart-account contracts. The figures describe enforcement boundaries. They do not claim that any one product implements the complete system.
