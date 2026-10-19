<!--
Aomi Blog post — introducing-the-aomi-task-api
slug: introducing-the-aomi-task-api
tag: launch
Figures live in public/research/introducing-the-aomi-task-api/figures/.
-->

# Introducing the Aomi Task API: verified execution as a service, settled in USDC on Arc

_Updated October 18, 2026 for the two-purchase protocol._

## The agentic economy needs reliable execution and two-sided services

Since launch, [Arc](https://www.arc.io/blog/arc-economic-os-internet) has been building an agentic economy with real participants. Trading venues are opening their markets to agents. Protocols are exposing their contracts to them. Builders are shipping agents that pay invoices, rebalance treasuries and route liquidity. The agents are arriving, and the [onchain settlement rail](https://www.circle.com/usdc) is already here.

For that economy to thrive beyond the noise, two conditions must hold.

### #1 Agents deliver reliable onchain execution

Reliable execution starts with a result the buyer can inspect before signing an onchain transaction. Simulation makes the proposed effects and constraints concrete, while the buyer retains the final execution decision.

### #2 Agents participate on both sides of the service market

Take Arc as an example: builders are creating new protocols, workflows and data products. In an agentic economy, these become callable services. Today’s agents are mostly buyers. They need to become sellers too.

The Task API itself participates as a service-selling agent, packaging simulation-verified execution as a priced service that other agents can inspect and buy.

## Industry Insights: Why now?

Arc is one settlement rail for this emerging economy, but the shift extends well beyond crypto. AI, cloud, payments and commerce companies are building the same missing machinery: verifiable intent, bounded authority, deterministic guardrails and payment tied to observable outcomes.

| Industry signal           | What is changing                                                                                                                                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google · AP2**          | [Signed mandates](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol) preserve what a buyer requested, approved and ultimately purchased—even when an agent finishes the job later.                                                                               |
| **Visa · Cloudflare**     | [Trusted Agent Protocol](https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-unveils-trusted-agent-protocol-for-ai-commerce.html) and [secure agentic commerce](https://blog.cloudflare.com/secure-agentic-commerce/) give merchants signals for distinguishing authorized agents from hostile bots. |
| **AWS · AgentCore**       | [Payment guardrails](https://aws.amazon.com/blogs/machine-learning/enable-safe-agentic-payments-with-built-in-guardrails-using-amazon-bedrock-agentcore-payments/) evaluate identity, tool and parameters before an agent action is allowed.                                                                         |
| **Mysten · Google Cloud** | [Verifiable Agent Arbiter](https://www.prnewswire.com/news-releases/mysten-labs-announces-verifiable-agent-arbiter-in-collaboration-with-google-cloud-302899202.html) is designed to prove what an agent was allowed to do, what it did and what resulted.                                                           |
| **Intercom · Salesforce** | [Fin prices resolved outcomes](https://www.intercom.com/blog/building-outcome-based-pricing-for-fin-for-sales); [Agentforce meters agent work](https://help.salesforce.com/s/articleView?id=004811240&language=en_US&type=1). Software economics are moving closer to completed work.                                |
| **Arc · Circle**          | [Arc](https://www.arc.io/blog/arc-economic-os-internet), [USDC](https://www.circle.com/usdc) and [Gateway with x402](https://www.circle.com/blog/enabling-machine-to-machine-micropayments-with-gateway-and-usdc) provide dollar-denominated settlement that software can use directly.                              |

## How it works

The Task API turns an intent into an unsigned transaction bundle, rehearsed against pinned Arc state. Buying the service and executing the transaction are separate decisions. There is no separate TaskAuthorization signature: the sender address is simulation input, while the verified payment identifies the payer.

### 1. Prepare for 0.01 USDC

Send an intent, chain, sender and constraints to `POST /v1/task/build`. A valid request returns an x402 payment challenge for **0.01 USDC**. Retry the same request with payment to start planning and simulation. The API returns `202`, a `quoteId`, a private retrieval token and polling instructions.

Preparation is a paid attempt. Planning or simulation failures still cost 0.01 USDC. Invalid requests are rejected before payment.

### 2. Inspect the result for free

Poll `POST /v1/task/{quoteId}/status` with the retrieval token. Status checks are free. When preparation finishes, inspect the signed preview, simulated effects, frozen bundle hash and retrieval price. A simulation describes the pinned state it ran against; it does not guarantee the same outcome after chain state changes.

### 3. Purchase the frozen bundle

Request `POST /v1/task/{quoteId}/result` with the retrieval token. While preparation is running, the result route returns `202`. Once ready, a nonzero retrieval fee produces a second x402 challenge. Retry the same request with payment to receive the exact frozen bundle. Zero-outflow bundles have free retrieval. Each purchase has its own payment identifier and receipt.

### 4. Execute with your own wallet

Verify the delivered bytes against the signed preview, then independently review, sign and submit with your execution wallet. TaskClient returns unsigned bytes; it never broadcasts the bundle. Paying for preparation or retrieval does not authorize a transfer from the sender.

::task-api-flow::

## A cent to prepare. A measured price to retrieve.

Preparation costs **0.01 USDC per attempt**. Retrieval costs **3% of simulated gross outgoing USDC**, rounded upward to the nearest micro-USDC. There is no $1 base fee. Incoming funds do not offset outgoing funds, and self-transfers are excluded.

| Simulated outgoing USDC | Preparation | Retrieval | Total service fee |
| ----------------------- | ----------- | --------- | ----------------- |
| 0                       | 0.01        | Free      | 0.01 USDC         |
| 0.01                    | 0.01        | 0.0003    | 0.0103 USDC       |
| 0.02                    | 0.01        | 0.0006    | 0.0106 USDC       |
| 100                     | 0.01        | 3         | 3.01 USDC         |

Service fees are separate from the transfer amount and execution gas. The buyer sees the retrieval price before authorizing that purchase. A failed preparation pays for the attempt and produces no purchasable bundle.

An unpaid frozen bundle has a five-minute purchase window. After an accepted purchase, retrieval remains available for 30 days. Free retrieval lasts 30 days from preparation acceptance. If an unpaid quote expires, preparing again is a new paid attempt.

## Two purchases, one recoverable workflow

Both purchases use x402 through Circle Gateway. The client keeps the URL, method and body unchanged within each payment handshake, saves each signed proof before sending it, and reuses that proof on retries. A payment identifier prevents accidental duplicate purchases; it does not grant access to the private result.

TaskClient exposes `prepare()`, `status()`, `retrieve()` and `recover()`, plus `purchase()` to orchestrate the flow with bounded waiting. Separate preparation, retrieval and total spending caps bound service payments. Recovery reuses saved proofs without creating a new payment signature. Keep the private journal to recover after a timeout or restart.

## What we have verified

Local client-to-server acceptance completed both purchases with real Circle Gateway payments on **Arc testnet (5042002)**. Transfers of 0.01 and 0.02 USDC produced retrieval fees of 0.0003 and 0.0006 USDC. Restart and replay returned the same jobs and bundles without additional service debits.

Circle Gateway acceptance and eventual onchain settlement are separate milestones. The service payments were [confirmed in an Arc testnet batch](https://testnet.arcscan.app/tx/0xb3cf37ed0320648f4ad4f8f78310149a10f942da929d8a0ff1b1e1f351c0b1ac). The generated execution bundles were never broadcast. Public staging paid-path validation remains outstanding; this evidence does not establish production readiness.

## The remaining trust boundary

The signed preview binds the request, payer, price and frozen bundle hash. It lets the client check that the delivered bytes match what it inspected. It does not prove ownership of the sender wallet or make the simulation independently verifiable. Buyers still trust Aomi’s simulation infrastructure and must provision trusted attestation keys independently. Independently verifiable computation remains a future direction.

## Example: Alice’s agent finds a dislocation

Alice runs a trading agent across an order-book venue and Arc liquidity. The agent sees a firm bid for EURC on the order book while an Arc pool offers cheaper EURC inventory. It can reason about the opportunity, but it should not improvise transaction bytes with Alice’s money.

Alice already holds EURC. Her agent sells 900 EURC into the firm bid for 990 USDC, then asks the Task API to replenish that inventory from the Arc pool—but only if it can buy at least 900 EURC for no more than 940.50 USDC through contracts Alice has approved.

::task-api-alice::

## Agents buying from agents

Agent service directories and marketplaces are discovery surfaces for this workflow. The integration contract is the same wherever a buyer discovers it: paid preparation, a free signed preview, then a separately priced bundle purchase over [x402](https://www.x402.org). Listing status and endpoint availability are separate from successful paid delivery.

That distribution model is also the larger thesis. A builder’s pricing model, risk engine, routing strategy or operational workflow can become a callable service with a price attached to its outcome. The rails that let one agent buy simulation-verified execution from the Task API can let another sell its own expertise. Agents cease to be only spenders and become sellers; that is the half of an agentic economy that compounds.

## Try it out

Start with the source TaskClient and a configured Arc testnet deployment. Provision the merchant address and trusted attestation keys independently, and fund the payer’s Circle Gateway balance separately. An ordinary wallet balance is not a Gateway balance; the client never makes automatic deposits.

::task-api-quickstart::

**From hackathon infrastructure to Task API.** The Task API grew out of the [Tameion Agents Hackathon](https://tameion.thecanteenapp.com/), hosted by the [Canteen](https://thecanteenapp.com/) team and sponsored by Aomi Labs. It began as an [Execution Kit](https://arc-canteen.aomi.dev/execution-kit) for builders bringing financial agents to Arc. Working alongside those builders revealed a broader need: inspectable execution, machine-native fair exchange and agents selling services to other agents are not hackathon-specific problems. The Task API turns that builder infrastructure into a service for the wider agent economy.

## References

- [Arc economic operating system](https://www.arc.io/blog/arc-economic-os-internet)
- [USDC by Circle](https://www.circle.com/usdc)
- [Circle Wallets](https://www.circle.com/wallets)
- [The fair-exchange problem](https://arxiv.org/abs/0910.4342)
- [Circle Gateway and x402](https://www.circle.com/blog/enabling-machine-to-machine-micropayments-with-gateway-and-usdc)
- [x402](https://www.x402.org)
- [Canteen](https://thecanteenapp.com/)
- [Tameion Agents Hackathon](https://tameion.thecanteenapp.com/)
- [Arc × Canteen Execution Kit](https://arc-canteen.aomi.dev/execution-kit)
