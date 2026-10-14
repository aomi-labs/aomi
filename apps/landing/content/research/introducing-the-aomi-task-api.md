<!--
Aomi Blog post — introducing-the-aomi-task-api
slug: introducing-the-aomi-task-api
tag: launch
Figures live in public/research/introducing-the-aomi-task-api/figures/.
-->

# Introducing the Aomi Task API: verified execution as a service, settled in USDC on Arc

## The agentic economy needs reliable execution and two-sided services

Since launch, [Arc](https://www.arc.io/blog/arc-economic-os-internet) has been building an agentic economy with real participants. Trading venues are opening their markets to agents. Protocols are exposing their contracts to them. Builders are shipping agents that pay invoices, rebalance treasuries and route liquidity. The agents are arriving, and the [onchain settlement rail](https://www.circle.com/usdc) is already here.

For that economy to thrive beyond the noise, two conditions must hold.

### #1 Agents deliver reliable onchain execution

Reliability on every task means yielding an outcome the buyer can inspect before money moves. Agentic services with probabilistic outcomes are not sustainable: buyers would be taking risks and making bets.

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

An agent sends a task describing what it wants to do, together with constraints such as target addresses, spending limits, slippage and other dos and don’ts. In headless mode, the Task API resolves the intent, constructs the transaction and rehearses it against live Arc state. It returns a simulation-verified outcome: which balances move, which approvals are granted and whether every limit holds.

If the buyer accepts the outcome, it pays in USDC and receives the exact transaction. The deliverable is not an ambiguous plan or suggestion, but signable bytes that produce the inspected result.

The buyer’s [Circle wallet](https://www.circle.com/wallets) signs and submits the transaction. The Task API never holds a key; it is aware only of public wallet addresses. If the buyer does not sign, the transaction expires and is discarded. Nothing happens.

![Task, payment and execution authorities remain separate. The buyer’s agent signs the task, the Task API rehearses it and returns a quote, the buyer separately pays for the artifact, and its Circle wallet separately signs the exact transaction before Arc settlement.](/research/introducing-the-aomi-task-api/figures/sequence.png)

## Pay for outcomes, not tokens

The Task API charges $1 plus 3% of the sender’s gross outgoing USDC, measured from the rehearsed transaction before purchase.

Because every task is simulated before purchase, the rehearsed outcome is both the deliverable and the audit trail against which the charge is calculated. Arc executes the resulting onchain service and settles its payment.

This is the most practical benefit of using a blockchain as the platform for agentic activity: when software actions carry real-world consequences, execution, verification and payment share the same observable foundation.

Most agent vendors bill the buyer for tokens, regardless of whether the agent completes the task. Most outcome-based products are not agent-friendly either. A service may charge for a generated slide deck, for example, but the workflow still assumes a person will create an account, iterate on the slides, enter a credit card and approve payment before downloading the result.

![Token metering compared with outcome pricing. Conventional systems bill for effort whether or not there is a result; the Task API prices a rehearsed outcome that the buyer can inspect before purchase.](/research/introducing-the-aomi-task-api/figures/pricing.png)

The Task API is headless and purchased one task at a time, making it native to machine workflows. Together, x402 settlement and pre-purchase simulation address the [fair-exchange problem](https://arxiv.org/abs/0910.4342): the seller can rely on settlement while the buyer can inspect the outcome before paying for it. Simulation is preserved within the agent’s tool trace, confining the decisive computation to an auditable part of the exchange.

## The remaining trust boundary

In V1, the Task API furnishes verification through its simulation infrastructure: the buyer receives a deterministic rehearsal, bounded transaction bytes and an audit trail before purchase. The direction for V2 is to make that computation independently verifiable. Candidate approaches include trusted execution environments, zero-knowledge proofs and durable audit attestations; the protocol design remains open while we evaluate which combination best supports trust-minimized exchange.

## Example: Alice’s agent finds a dislocation

Alice runs a trading agent across an order-book venue and Arc liquidity. The agent sees a firm bid for EURC on the order book while an Arc pool offers cheaper EURC inventory. It can reason about the opportunity, but it should not improvise transaction bytes with Alice’s money.

Alice already holds EURC. Her agent sells 900 EURC into the firm bid for 990 USDC, then asks the Task API to replenish that inventory from the Arc pool—but only if it can buy at least 900 EURC for no more than 940.50 USDC through contracts Alice has approved.

::task-api-alice::

## Agents buying from agents

The Task API is listed on [NoHumans](https://nohumans.directory/), [Open402](https://github.com/ArcedeDev/open-402), [Agent402](https://agent402.tools/marketplace) and [Superstables](https://www.superstables.com/). Builders can also inspect its contract and examples through [Postman](https://www.postman.com/) and the Arc Showcase. Every surface resolves to the same headless service: a wallet-signed request, a simulation-verified result and USDC settlement over [x402](https://www.x402.org).

That distribution model is also the larger thesis. A builder’s pricing model, risk engine, routing strategy or operational workflow can become a callable service with a price attached to its outcome. The rails that let one agent buy simulation-verified execution from the Task API can let another sell its own expertise. Agents cease to be only spenders and become sellers; that is the half of an agentic economy that compounds.

## Try it out

The fastest way to understand the protocol is to send one bounded task. The production Task API exposes the complete signature-first exchange, from wallet authorization to a simulation-verified 402 outcome.

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
