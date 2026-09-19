## Intent → build → sign → settle

A coding agent follows a familiar path to production: **intent → build → commit → deploy**. It turns a request into a code change, commits that change and eventually deploys it. The review and deployment controls matter because the original request alone cannot tell us what will run.

An onchain financial agent follows a similar path: **intent → build → sign → settle**. A user might ask it to move idle USDC into a conservative yield position. The agent chooses a venue, builds the contract calls and obtains a signature before submitting the transaction. If it relied on a forged instruction or a false balance, the transaction can still be valid and settle successfully.

![Two parallel paths show a coding agent moving from intent to build to commit to deploy, and a financial agent moving from intent to build to sign to settle. The latter introduces a runtime guard, a wallet policy, an onchain mandate, and a builder assertion.](figures/01-two-paths.svg)

Figure 1. Both pipelines carry checkpoints at the same transitions: a human reviewing the agent's proposed change, CI and a merge decision, runtime checks after deploy. The financial path has analogues at each, but signing is not equivalent to review and settlement is not reversible like a conventional rollout.

We observe that the guardrail in this process is not a single checkpoint but a series of modular ones, each placed at a transition the transaction must cross and each administered by a different party. The runtime can refuse while the agent is still building, under rules the application operates. The wallet provider can refuse to sign, under a policy the application does not control. Account or protocol code can revert the call once it executes. A builder or sequencer can decline to include it. Each sees different evidence, refuses for different reasons and has its own bypass routes.

Before specifying those checkpoints, it is worth asking what they are for. A checkpoint only earns its place if there is a concrete way the transaction crossing it could be wrong. So we start with the ways a transaction goes wrong.

One disclosure up front. We build a runtime of the kind discussed under the first checkpoint, and it appears below wherever the argument needs an implementation to point at. It is held to the same questions as every other product named, and where it fails them we say so.

## The risk landscape: attacks vs defects

Two families of failure end in the same place: a transaction that is valid onchain and wrong for the user.

**Adversarial attacks.** Someone outside the user's trust wants a specific bad transaction and manipulates the agent into building, signing or landing it. The instruction is forged, the observed state is forged, the payload is altered after it was checked, or the transaction is exploited on the way to inclusion. The agent may be working perfectly against corrupted inputs.

**Capability defects.** Nobody is attacking. The agent simply gets it wrong: a mis-encoded call, a missed approval step, a wrong decimal, a stale route, a protocol feature it did not know about. The inputs are honest and the output still loses money.

The gateway policies, wallet policies, onchain mandates and builder assertions surveyed below all address the first family. That is reasonable, because the first family is where an adversary can scale. But in day-to-day operation the second family is the more common source of loss, and it is not solved by a gate at all. It is solved by the combination of model and harness, and the quality of that combination decides how often the gates are even asked to work.

The coding-agent world has already measured this. The same model scores very differently on the same repair benchmark depending on the scaffold it runs in; the [SWE-agent](https://arxiv.org/abs/2405.15793) authors reported roughly an order of magnitude between a retrieval baseline and an agent-computer interface for one model, and nobody calls the interface a security product. Our own benchmark shows the same shape for onchain work. In [AomiBench v0.1](/research/aomibench-v0-1), 65 strict failures across 694 scorable runs were all defects of the second family, mis-sequenced tools, wrong arguments, missing evidence, and none involved an adversary. Under an identical harness the frontier models clustered between 94.8 and 99.0 percent task success while two small models fell to 74 and 77 percent, which is the model half of the combination; the harness half is what the next two sections are about. The two families need to be kept apart, because a strong harness makes an honest agent accurate and does nothing against a forged instruction, while a strong gate refuses the forged instruction and does nothing to make the agent competent.

### Adversarial attacks

The attack surface follows the pipeline. Each transition admits a different kind of tampering.

**Intent → build.** *Injected intent* changes what the agent believes the user asked for. It can arrive in a forged chat turn, a tool result that impersonates the user or a document from a compromised upstream system. A signature over the resulting transaction does not prove the user wanted it. It only shows that a signer authorized those bytes under some policy. Inside the build runtime, *injected state* changes the agent's picture of the world when the software it reads from is itself vulnerable. A compromised RPC, indexer or quote service might report a 2,000-USDC balance when the account holds 3,000, substitute a token address, supply a stale quote or hide a spender inside a route. The agent then faithfully executes the wrong plan even though the user's instruction is intact.

Consider a user who wants to keep 2,000 USDC liquid and deposit the rest into a named vault. The actual balance is 3,000 USDC. If the agent sees a forged balance of 2,000, it deposits nothing and silently fails to carry out the strategy. If it sees a forged balance of 4,000, it may try to deposit 2,000 and leave only 1,000 liquid. A wallet rule that checks only the destination could approve the second transaction. A rule that independently checks the reserve could refuse it. A vault-level assertion might see a healthy deposit and miss the wallet-level requirement entirely. Each checkpoint needs the right facts and the right rule to catch the error.

![An attacker can corrupt the interpreted intent or observed state before transaction construction. Later controls see more exact transaction data but less of the original meaning.](figures/02-injection-boundaries.svg)

Figure 2. Later checkpoints are stronger at enforcing narrow invariants, but usually have less direct evidence of what the user meant.

**Build → sign.** The payload that was simulated is not necessarily the payload that gets signed. Anything sitting between the builder and the signer, a serialization step, a relay, a browser extension, a routed continuation that a model retypes, can alter calldata, recipient or value after the checks have run. The second failure at this transition is scope rather than tampering: an action that should have waited for a human is signed automatically because the policy that decides what is auto-signable was too broad, or because the application that wrote the policy is the same party the policy was meant to constrain.

**Sign → settle.** Once signed, an agent-built transaction faces the same hazards as any other: sandwiching, front-running, a stale quote executing at a worse price, a reorg. None of this is agent-specific, and it is worth saying so plainly, because the products that claim to secure agents usually stop at signing. The only checkpoint positioned to act on inclusion-time risk is the builder itself, which we return to in Gate 3.

Key compromise matters too, but it predates agents and does not explain any of these failure modes.

### Capability defects

Three scenarios show how much of the defect problem is decided before any gate is consulted. The first is a thought experiment, the second is how most agents are deployed today, and the third is the design we measure.

**A frontier model with no harness.** Put a current frontier model on a fresh machine with a funded wallet and ask it to stake on Kamino or lend on Aave. It has to find the right program or contract, fetch the IDL or ABI, work out the account list or the approval step, encode the instruction by hand, guess at compute units or gas and then broadcast. Every one of those steps is a place to be subtly wrong, and the model's only back-pressure is a revert on a live chain. That revert costs a fee, arrives late and says almost nothing about which step failed. A capable model will often get there, but it gets there by paying for its mistakes in public.

**A frontier model on a generic tool layer.** This is the common deployment: the same model, now with a wallet or RPC tool server, a signing SDK and perhaps a search tool. The tools remove the broadcast step and the key handling, and that is real progress. But the model still chooses the contract address, still fetches and reads the ABI, still decides the argument encoding and the amount in base units, and the tool signs and sends whatever it is handed. Nothing in that layer executes the call against a fork before it is staged, so the first error signal is still the live revert, or at best a wallet's simulation warning at the moment of signing, when the model's turn is already over.

**A cheap model with an integrated harness.** Put a much smaller model, say minimax-m2.5, on a runtime that has already integrated the EVM and SVM. The model calls a tool named for what it wants to do and the system builds the instruction. It does not encode calldata. It is handed a current view of chain state, the source of any public contract it touches and skills that describe how a specific protocol behaves. Back-pressure now arrives before anything is signed: the transaction is executed in a sandboxed fork and a revert comes back as a readable error, the tool itself fails loudly on bad arguments, and guards run before and after each tool hook. The small model self-corrects inside the loop instead of on the chain.

![Two columns run the same instruction, approve 500 USDC for the Uniswap router. On the left a frontier model with no harness performs eight steps by hand, four of which can be silently wrong until a revert on the live chain. On the right a small model on an integrated runtime emits one typed tool call and the harness encodes, simulates in a sandbox, runs guards and stages, with the first error signal arriving before anything is signed.](figures/02b-same-task-two-worlds.svg)

Figure 3. The same instruction in the first and third worlds. Without a harness, four of eight steps can be wrong without any signal until the chain rejects the transaction. With an integrated one, the model emits a single typed call and the first failure arrives inside the loop, before authorization. The generic tool layer sits between: it removes steps 6 and 7 from the model's hands and leaves steps 1, 4 and 5 there.

What the model actually writes in the second world is worth seeing. This is a real argument to the staging tool for the instruction in Figure 3, taken from the [AomiBench v0.1](/research/aomibench-v0-1) write-up:

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

Every character of that is the model's, and none of it is calldata. The harness computes the four-byte selector, ABI-encodes the two arguments, injects the sender and chain id from wallet context, executes the result on a forked chain, runs the guards against the simulated outcome and only then stages it for signing. The one place the model still touches a raw quantity is the amount in base units, and a protocol skill can close even that.

| | Frontier model, no harness | Frontier model, generic tool layer | Small model, integrated harness |
| --- | --- | --- | --- |
| Who encodes the call | The model, by hand | The model, from an ABI it fetched; the tool signs what it is given | The runtime, from a typed tool |
| What the model sees | Whatever it fetches itself | RPC reads through tools, no forked execution | Live state, contract source, protocol skills |
| Knowledge of the protocol | In-weights only | In-weights, plus whatever it retrieves | Skill-supplied: addresses, ABI, procedure |
| First signal of error | Revert on the live chain | Live revert, or a wallet's simulation warning at signing | Sandbox revert, tool failure, guard refusal |
| Cost of a mistake | A fee, and possibly the position | A fee, and possibly the position | Tokens and a retry; nothing onchain |

The harness is not magic, and the bench write-up records where it runs out. One of the strongest models in that matrix failed a read-only task, checking a ZORA token balance on Base, on both passes. The trace is short:

```
Task:           check_zora_token_balance, read-only
Model:          gpt-5.5, a top scorer overall
What it did:    activated the zora skill but never issued a well-formed encode_and_call
First bad step: no matching `to` (ZORA contract), no matching `function_signature` (balanceOf)
Failed check:   tool assertion, both passes
```

ZORA is a newer token whose address is not reliably in any model's weights. The harness could encode the call perfectly, but only once the model asked for the right contract, and nothing in the runtime supplied that fact. The obvious rebuttal is correct: a frontier model with a web search tool would have found the address in one query, and on this task the second world beats the third. The lesson is not that skills are the answer. It is that the knowledge has to arrive before staging, whether a skill ships it or a search fetches it, and that a harness which encodes perfectly is still only half a harness. This is the defect family at its purest: honest inputs, a competent model, a wrong result, and no adversary anywhere. It is why the knowledge row in the table matters as much as the encoding rows.

The harness is not a gate either. It does not refuse anything on the user's behalf. What it does is make the built transaction correct in the first place, which is why the defect family mostly disappears once the harness is good, and why it reappears the moment the harness is removed. It also creates the conditions for the first gate: the guards that run on the simulated result are exactly what Gate 0.5 looks like inside a real runtime, and tool hooks can only guard tool calls. A model encoding calldata by hand has no tool calls to guard.

## Where the gates sit

With both families in view, the checkpoints can be placed. We number them by how far the transaction has travelled: Gate 0.5 while it is still being built, Gate 1 at signing, Gate 2 at onchain execution, Gate 3 at inclusion.

![Nested regions: the runtime sits inside the application, the wallet provider beside it and the chain beyond. Gate 0.5 guards tool calls inside the runtime, Gate 1 is signing policy at the wallet boundary, Gate 2 is a mandate enforced by the smart account or protocol and Gate 3 is an assertion the builder evaluates before inclusion.](figures/00-gate-architecture.svg)

Figure 4. Where the gates sit. The model builds against forked chain state, the runtime guard refuses bad tool calls, the wallet refuses to sign, the account or protocol reverts and the builder declines to include. Each region is administered by a different party.

### What a gate must actually do

A warning, score, simulation, or dashboard is not a gate merely because it appears before a transaction. A gate must have a **defined decision**, a **specific enforcement point**, and a **failure posture**. We ask: What exact action can it reject? Who can change the rule? Which route bypasses it? What does it do if its evaluator is unavailable? What evidence proves the same transaction passed the check? These questions are more useful than calling an entire wallet, framework, or chain “secure.”

For this analysis, trace every path from an agent-controlled request to a movement of value. A veto protects an invariant only if **every relevant path must cross a check of that invariant** or a stricter one. Adding a vendor does not create a new trust boundary if the application can change both policies or use an uncovered route. The check must sit across all routes to the protected assets. A bypass test should fail even if the application stops cooperating. We therefore classify gates by *where they can actually refuse an action*, not by where a product displays a warning. The sections that follow apply these questions to each gate and to the products now competing to implement it.

## Gate 0.5: Guardrails during building

The first useful “no” can happen while an agent is building a transaction. A runtime can limit the model's tools and reject a call before execution. It can restrict destinations or function selectors, require authorization and stage a transaction for simulation before broadcast. Because the runtime also shapes what the model sees, it can prevent mistakes and explain refusals in context. But it cannot protect the user from an application operator who controls the runtime and its signing route.

### The pre-commit veto in practice

Our own runtime is a fair specimen, because we can read it. Its refusals come in three kinds. Tool hooks can block a call before it executes, and tools belonging to a skill that is not active are refused outright. Guard code interprets restrictions on chain, target, function selector and approval spender for the EVM, and on program and instruction discriminator for Solana, at the moment a transaction is staged. A separate signing-policy step denies commits from read-only threads and from wallets the thread does not own. The path a child agent uses to commit staged work requires simulation evidence to have passed. These are concrete vetoes, not model instructions.

They are also path-specific, and this is the part worth generalising. Not every commit route is conditioned on a passed simulation. A guard that trusts the caller's declared dollar amount is not an independently measured limit. A guard table that is correct in source has no effect on any route where dispatch never invokes it, so reading the code is not the same as an end-to-end test showing the staging tool actually calls it. Until that test passes for a given route, the route should not be counted as covered. We would apply the same three questions to any runtime, and we describe our own as a *development and operational control*, not an independent settlement guarantee. It cannot protect the user from the operator that runs it.

The surrounding market is moving toward the same enforcement point. [AWS AgentCore Gateway Policy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/use-gateway-with-policy.html) evaluates MCP tool calls and can deny them by default. AWS limits this policy surface to MCP tools, so other actions may not pass through it. [Permit MCP Gateway](https://docs.permit.io/permit-mcp-gateway/guide/) and [Cloudflare MCP portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/) also put controls at the tool boundary. [Lakera's agent behavior defense](https://docs.lakera.ai/docs/agent-behavior-defense) looks for suspicious agent behavior. All can intervene early. The question for each is whether every path that can move value passes through the check.

### Simulation is evidence, not authority

Simulation can reveal a revert, a bad route or an excessive allowance before signing. It cannot freeze chain state until inclusion or prove that the user wanted the trade. The RPC state, quotes and token metadata it relies on may themselves be compromised. A passing result should be tied to the exact call bytes and account, as well as the chain, block reference and policy version. After settlement, those details should be compared with the receipt. If the bytes change, the simulation result no longer applies.

## Gate 1: The wallet that can refuse to sign

An embedded-wallet provider is often presented as the trusted party “on the user's side.” It protects the key for someone who does not want to manage one. That trust is conditional. The provider becomes an independent gate only if it enforces a rule **outside the app's unilateral control** and the app cannot use another route to make the same key sign. Hardware isolation protects key material. On its own, it cannot tell whether a transaction reflects the user's intent.

### Independent policy, not merely independent custody

A useful signing policy applies to the exact request. It can restrict the chain and account, limit destinations or functions and cap spending over time. It may also require a simulation. Just as important, it must define who can install or relax the rule. If the application server controls both signing requests and policy administration, even a well-protected key is not an independent veto against that server. A user-controlled authorization key or an independently held quorum member changes the trust boundary. So can a provider-enforced restriction that the application cannot change.

[Privy](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) documents enclave-enforced authorization and wallet policies. It also describes service-controlled wallets and checks, such as simulation, that may run outside the enclave. [Turnkey](https://www.turnkey.com/solutions/ai-agents) centers programmable signing in secure enclaves. [Coinbase CDP's Policy Engine](https://docs.cdp.coinbase.com/wallets/security-and-policies/policy-engine/evm-policies) specifies EVM restrictions on signing activity. [Fireblocks](https://developers.fireblocks.com/docs/what-is-fireblocks) combines MPC custody with transaction policy and approval workflows. The products differ in who holds the key, who administers policy and where checks run. None is independent by brand name alone. The test is whether an adversary controlling the agent application can obtain a forbidden signature or relax the rule.

| Provider | Documented signing control | Independence question |
| --- | --- | --- |
| [Privy](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls) | The enclave checks authorization keys, quorums and wallet policies before signing. Separate screening or simulation may run outside it. | Does the user or an independent quorum control the wallet, or does the application hold the decisive authorization key? |
| [Turnkey](https://www.turnkey.com/blog/turnkey-policy-engine-guardrails-web3-transactions) | Policy evaluation and signing occur inside secure enclaves. Policies can constrain transaction structure and require approvals. | Who holds root authority to change policy or satisfy the approval quorum? |
| [Coinbase CDP](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/policy-engine/create-policy) | Project- or account-scoped rules govern specified signing and sending operations. | Can the same application credentials edit the policy and initiate the transaction? |
| [Fireblocks](https://developers.fireblocks.com/docs/raw-signing) | MPC signing is paired with transaction authorization policy. Raw signing is blocked without appropriate rules. | Which workspace roles can change the policy, approve the request, or use a different vault path? |

Table 1. Documented controls are not a ranking. Independence is a property of the deployment's authority graph, not of its wallet provider.

### The bypass ledger

Signing policy binds the key and API path it actually governs. An alternative signer, exported key, root owner, preexisting token allowance, permit signature, delegated smart-account key, or second chain can sit outside that scope. A provider may inspect the outer transaction yet lack reliable visibility into a router's internal effects. Off-chain risk scoring and simulation can add useful signals, but unless the provider fails closed on their results they are not policy enforcement. Gate 1 is strongest when the signed payload is narrow, human-readable to the authorizing party, and mechanically linked to what the runtime simulated.

## Gate 2: Mandates enforced onchain

The smart account or settlement contract can make an agent's authority a property of execution rather than of a server's promise. A mandate can restrict the agent key to particular calls, recipients, assets, amounts, intervals, or state outcomes. A violating transaction may be validly signed yet revert under the account or protocol's rules. This is the trust upgrade: the application's policy service cannot silently widen a correctly installed, non-bypassable contract rule. The rule still depends on the contract code, configuration, upgrade keys, and exact execution path.

### Where the mandate lives

[ZeroDev Kernel permissions](https://docs.zerodev.app/smart-accounts/permissions/intro) combine a signer with policies over the action it can take. [Biconomy Smart Sessions](https://docs.biconomy.io/sdk-reference/sessions), [Rhinestone spending limits](https://docs.rhinestone.dev/smart-wallet/smart-sessions/policies/spending-limit), [MetaMask delegations](https://docs.gator.metamask.io/) and [Coinbase smart-account spend permissions](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-smart-accounts/create-spend-permission) offer other ways to constrain delegated authority. [Safe Guards](https://docs.safe.global/advanced/smart-account-guards) can check transaction parameters before execution and final state afterward. [Zodiac Roles](https://docs.zodiac.eco/developers/roles/permissions) provides granular permissions. Onchain controls are therefore not limited to checking inputs. The design question is whether the *particular* account path exposes the post-state needed for the invariant at an acceptable cost.

| Contract pattern | What it can enforce | Boundary to test |
| --- | --- | --- |
| Session policies: [ZeroDev](https://docs.zerodev.app/smart-accounts/permissions/intro), [Biconomy](https://docs.biconomy.io/sdk-reference/sessions), [Rhinestone](https://docs.rhinestone.dev/smart-wallet/smart-sessions/policies/spending-limit) | Installed validator and policy modules restrict a delegated key's calls, time, usage or spend. | Owner calls, alternative validators, upgrades and accounting across batches or fee tokens. |
| Account guards and roles: [Safe](https://docs.safe.global/advanced/smart-account-guards), [Zodiac](https://docs.zodiac.eco/developers/roles/permissions) | Rules check transaction parameters before execution or state after execution. Roles provide granular permissions. | Module routes, guard replacement authority and denial of service from an over-restrictive guard. |
| Delegated EOA: [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) | Delegated code implements smart-account behavior, potentially including session validation. | The EOA root key can originate transactions and change or clear delegation. Not every path enters the session validator. |

Table 2. “Onchain” describes the enforcement location. It does not answer whether every path to the asset is covered.

### Expressiveness versus coverage

“Spend no more than 100 USDC today” hides several semantics. Is gas paid in the same token? Are approvals counted as spend? Can a router transfer from another account? Does a rebasing token alter measured deltas? Is the cap per chain, account, session key, or user? Biconomy's session documentation, for example, calls out how fee payment in the spend token can affect the effective limit. A robust mandate should define the measured asset delta, the time or nonce window, and the calls that can change the same balance by another route. Otherwise the policy looks precise while its accounting is not.

An [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) delegated EOA is a particularly important boundary. Delegated code can implement smart-account behavior, but the original EOA key retains authority at the protocol level, including the ability to change delegation, and direct transaction paths may not traverse the delegated account's session validator. A session mandate is therefore trusted for the **session route**, not automatically for every action the address could take. Existing approvals, owner modules, upgrade authority, and escape hatches deserve the same explicit map. Onchain is the strongest of these gates only for the state and authority paths it actually controls.

### When to put the invariant in the contract

If a rule is essential and cheap to evaluate, enforce it as close to the asset or account as possible. Examples include a recipient allowlist, a maximum debit or a collateral floor. The tradeoff is more gas and upgrade complexity. A broken guard may also deny legitimate transactions. Rules that require broad cross-protocol state or rapid incident response may fit poorly in contract code. That gap motivates a separate final veto. It does not make an off-chain check equivalent to onchain enforcement.

## Gate 3: Assertions at the builder boundary

A builder or sequencer sees a fully formed transaction against a prospective block state. An assertion can evaluate its effects just before inclusion and reject a transaction that violates a protected invariant, even when the signer and smart account would otherwise allow it. It is a final **pre-inclusion** guard, not a universal guarantee of finality: its force comes from a specific builder's or rollup sequencer's transaction path, not from the base consensus rules. It is also the only gate that sits where the sign → settle hazards live. Sandwiching and front-running happen in block construction, after every earlier gate has finished, so the builder is the one party that can price-bound an inclusion or refuse an ordering the earlier gates never saw.

### What the builder can see

[Phylax Credible Layer](https://docs.phylax.systems/credible/architecture-overview) attaches protocol-authored assertions to protected contracts. Its documented flow simulates candidate transactions, gives assertions pre- and post-state snapshots, and drops violating transactions during block building. Its [assertion overview](https://docs.phylax.systems/credible/assertions-overview) makes the advantage concrete: an assertion can check effects across calls and contracts without modifying the protected contract, and currently describes a default 3 million gas evaluation limit. That lets a protocol express, for example, “the collateralization ratio must not deteriorate below this bound” rather than enumerate every call sequence that might cause it.

This is not the same as the runtime's simulation. The builder evaluates the candidate against its construction context and can choose not to include it. But the assertion must be installed for the affected contract, triggered by the relevant change, deterministic enough to operate, and supported by the chain's block-building path. It sees a transition, not the original user conversation. An injected-intent transfer that stays inside its invariant may still pass.

### An emerging competitive category

[Forta Firewall's OP Enterprise integration](https://forta.org/blog/forta-firewall-on-op-enterprise-a-sequencer) describes sequencer-level screening, initially for sanctions and freeze-list use cases, with Ink as the first adopter. [BlockSec STOP](https://blocksec.com/blog/revolutionizing-l2-chains-building-intrinsic-security-from-sequencers) and [Hypernative's chain integrations](https://www.hypernative.io/solutions/chain-integrations) pursue related pre-execution intervention. These should be compared by enforcement location and rule ownership, not placed in one bucket with monitoring. A detector that alerts after inclusion is valuable incident response, but it is not a settlement veto. Conversely, a sequencer filter may reject on one route without becoming a protocol-level validity rule across all inclusion routes.

| System | Decision surface | Published deployment evidence |
| --- | --- | --- |
| [Phylax Credible Layer](https://docs.phylax.systems/credible/network-integrations/architecture-linea) | Contract-linked, deterministic assertions evaluated by a block-builder integration with pre/post-state access. | Linea/Besu plugin and sidecar integration are documented. Current Linea support is Legacy V1. |
| [Forta Firewall](https://forta.org/blog/forta-firewall-on-op-enterprise-a-sequencer) | Sequencer screening policies, initially described for sanctions and freeze lists. | Forta names Ink as the first OP Enterprise adopter. |
| [BlockSec STOP](https://blocksec.com/blog/revolutionizing-l2-chains-building-intrinsic-security-from-sequencers) | A threat-inspection node in front of the sequencer scans and quarantines suspect transactions. | BlockSec describes a co-developed Manta Pacific deployment. |
| [Hypernative chain integrations](https://www.hypernative.io/solutions/chain-integrations) | Marketed sequencer- or protocol-level detection and automated response. | The cited product page describes the offering, not a named deployment or a particular fail posture. |

Table 3. These mechanisms all act before inclusion, but they are not equivalent assertion systems. The descriptions come from each vendor's documentation.

### Coverage, liveness, and the bypass question

Gate 3 can stop inclusion only when the transaction passes through an integrated builder, an active assertion covers its effects and the operator enforces the result. Phylax's [trust model](https://docs.phylax.systems/credible/trust-model) and [FAQ](https://docs.phylax.systems/credible/faq) are important qualifications. The current Linea integration supports Legacy V1 assertions, while forced-inclusion handling remains a separate workstream. More broadly, L1 deposit and forced-inclusion mechanisms can limit a rollup sequencer's discretion. The [OP Stack protocol overview](https://specs.optimism.io/protocol/overview.html) shows why a sequencer cannot be treated as the entire settlement system.

A fail-open builder preserves liveness but may allow a violation. A fail-closed builder protects its route but can halt legitimate activity when an assertion fails or becomes unavailable. Policy activation, upgrades, gas limits and alternative builders also affect coverage. Phylax's published [0x Settler mitigation report](https://phylax.systems/blog/0x-settler-mitigation-report/) documents a targeted deployment. Its prevented-loss estimates are vendor-reported, not an independent measure of general protection for agent wallets.

![A comparison matrix maps four veto locations to the object they inspect, who administers them, and the most important escape path.](figures/03-gate-matrix.svg)

Figure 5. An additional gate changes the authority an attacker must subvert only if it is independently administered and unavoidable on the relevant execution path.

## Designing the composite, not collecting logos

The system objective is not “four checks passed.” It is that a specific action has one traceable identity as it moves from user authorization to transaction construction, signing, execution, and receipt. Each gate should add a constraint or an independently sourced observation. If every layer merely repeats the application's assertion that “this is a safe swap,” then four vendors may amount to one trust assumption.

### Bind evidence to the exact action

An action envelope records who authorized a transaction and which account will send it. It identifies the chain, destination, calldata, spend limits, deadline and mandate. It should also record the replay domain, simulation reference and policy versions. Bind the fields that can be bound to the final signing request. The wallet should evaluate that exact request rather than an earlier natural-language summary. The onchain validator should enforce the same delegated authority and cap. A builder assertion should check a post-state invariant that still matters if the application's explanation is false. After settlement, compare the receipt and balance changes with the envelope. Inclusion alone does not prove the intended economic outcome occurred.

This is where the coding-agent analogy becomes operational. A deployment pipeline records which source produced which artifact, who approved it, which environment deployed it, and what actually ran. Agentic finance needs a similarly inspectable provenance chain, but with stricter authority because settlement may be irreversible and funds may move through contracts the agent did not author.

The runtime is the natural party to assemble this envelope, since it is the only one that sees the conversation, the simulation and the signing request together. For the record, ours carries part of it today: a staged transaction travels with the simulated result and the guard decisions that ran against it. It does not yet carry a policy version, and nothing compares the receipt back against the envelope after settlement. We list these as gaps rather than features because the test plan below would find them.

![An action envelope binds the mandate and transaction data to limits, simulation evidence and policy versions. The runtime, wallet, contract, builder and receipt verification each read a different part of it.](figures/04-action-envelope.svg)

Figure 6. The envelope is not another gate. It links decisions about the same action. Each gate receives only the fields its interface can authenticate and inspect.

### A test plan for claimed coverage

The most revealing tests try to bypass a gate. Change a quote after simulation but before signing. Omit a declared dollar amount, or route the same operation through a direct commit tool instead of the staged child path. Try signing through a different provider API key. Exercise an owner key or existing allowance against a session limit. Submit through a builder without the assertion, then disable the evaluator and observe whether the integrated route fails open or closed. Record which gate rejects each attempt. If none does, explain why. This kind of evidence is more useful than a diagram of the intended architecture.

## Conclusion

A transaction that is valid onchain and wrong for the user can come from two places, and they call for different remedies. When an adversary forged the intent or the state, a gate is the answer: a party who sees the transaction at a transition and can refuse it under a rule the attacker does not control. When nobody attacked and the agent simply built the wrong thing, no gate helps and the remedy is the model and harness that built it. Most products in this space are sold against the first problem while most day-to-day loss comes from the second, and a harness that makes an honest agent accurate does nothing about a forged instruction. Keeping the two apart is the main claim of this note.

On the gate side the map is now specific. Runtime guardrails can prevent bad construction and make failures legible, under rules the application operates. Independent wallet policy can deny signatures the application cannot authorize alone. Onchain mandates can make delegated authority a settlement rule. Builder assertions can reject harmful state transitions just before inclusion, and are the only checkpoint positioned where inclusion-time risk lives. None should be credited with protecting a path it does not see.

The research task is therefore precise: specify the user's mandate, enumerate the paths to value movement, identify the actor who can say “no” on each path, and test every claimed veto under injected intent, injected state and degraded operation. That is the route from a persuasive safety story to an enforceable one.

## Method and scope

### Evidence standard

We classify a control by what it evaluates, who can change it and where it acts relative to signing or inclusion. We also examine possible bypass routes. A vendor's feature description supports a claim about the mechanism, not how a customer configured it. A named integration establishes more than a product page, but it still does not prove complete coverage or an independently measured prevention rate. Our discussion of our own runtime is a first-party source review of `product-mono` at commit `a63f5f4f593f`. It is not an external audit. Specifically: the child-agent path is `commit_staged`, the direct commit path is not conditioned on simulation, the EVM guard table reads a caller-declared `usd_amount` for its dollar limit, and that guard-table path remains unverified pending an end-to-end test that the staging tool invokes it. The benchmark figures quoted in the risk-landscape section are from [AomiBench v0.1](/research/aomibench-v0-1), two passes per spec, and are joint model-and-harness scores rather than a ranking of model intelligence.

### Limits

The sources were reviewed on 18 September 2026. Product capabilities and chain deployments can change. Every deployment should be tested against its own configuration and transaction routes. We did not independently reproduce provider signing-policy decisions or builder failures. We also did not measure false positives or audit the cited smart-account contracts. The figures describe enforcement boundaries. They do not claim that any one product implements the complete system.
