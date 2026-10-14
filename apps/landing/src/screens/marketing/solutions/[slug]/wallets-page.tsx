import {
  ArrowRight,
  BadgeCheck,
  Braces,
  Check,
  FlaskConical,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MARKETING_ROOT } from "../../site";
import { MetaMaskWalletFixture } from "./metamask-wallet-fixture";
import { WalletTopology } from "./wallet-topology";
import styles from "./sector-pages.module.css";

const stopBuilding = [
  {
    icon: Braces,
    label: "Coverage",
    title: "Skip the protocol integration desk.",
    body: "Uniswap, Aave, Morpho, Lido, and 40+ protocols across EVM and Solana sit behind one JSON contract. New venues arrive without a new integration.",
  },
  {
    icon: FlaskConical,
    label: "Rehearsal",
    title: "Every action is simulated before signature.",
    body: "The kernel builds exact calldata, runs the whole batch on a forked copy of the chain, then enforces slippage and policy guards. Failures surface at plan time, not inside your user's flow.",
  },
  {
    icon: BadgeCheck,
    label: "Proof",
    title: "A hash is not proof.",
    body: "A watcher checks signer, chain, calldata, and ordering against the sealed Action before your product reports success. Receipts reconcile without your own indexing stack.",
  },
] as const;

export function WalletsPage() {
  return (
    <main className={styles.walletsPage}>
      <section className={`${styles.sectorHero} ${styles.walletsHero}`}>
        <div className={styles.walletsHeroCopy}>
          <p className={styles.eyebrow}>AOMI FOR WALLETS</p>
          <h1>
            Give wallets protocol execution without replacing their agent or
            signer.
          </h1>
          <p className={styles.sectorLede}>
            Whether a wallet team has already built its in-house agentic stack
            or is starting from scratch, Aomi can be the execution layer
            underneath—through a hosted integration or API access—returning
            simulated, policy-checked Actions to the signer it already runs.
          </p>
          <div className={styles.heroActions}>
            <Link to={`${MARKETING_ROOT}/products/rest-apis`}>
              Compare the two APIs <ArrowRight aria-hidden />
            </Link>
            <Link to={`${MARKETING_ROOT}/contact`}>
              Design your integration
            </Link>
          </div>
          <div className={styles.walletHeroProof}>
            {[
              "Your model stays yours",
              "Your signer remains",
              "No Aomi custody",
            ].map((item) => (
              <span key={item}>
                <Check aria-hidden /> {item}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.walletHeroArtifact}>
          <MetaMaskWalletFixture />
        </div>
      </section>

      <section className={styles.walletPromise}>
        <p className={styles.eyebrow}>The pitch</p>
        <h2>Stop rebuilding the transaction layer for every protocol.</h2>
        <p>
          The agent is your product surface and your differentiation. The
          protocol integrations, simulation infrastructure, guard policies, and
          receipt verification underneath it are not. Consume them as an API
          instead.
        </p>
      </section>

      <WalletTopology />

      <section className={styles.apiLanes}>
        <div className={styles.laneBand}>
          <ShieldCheck aria-hidden />
          <strong>Both API lanes resolve to the same sealed Action.</strong>
          <span>
            Send a customer sentence to the Agent API and let Aomi plan, or
            submit the exact action your own agent selected to the Pipeline API.
            One confirm sheet, one signer binding, and nothing re-integrates
            when you move between them.{" "}
            <Link to={`${MARKETING_ROOT}/products/rest-apis`}>
              Compare the two APIs
            </Link>
            .
          </span>
        </div>
      </section>

      <section className={styles.walletControls}>
        {stopBuilding.map(({ icon: Icon, label, title, body }, index) => (
          <article key={label}>
            <div>
              <Icon aria-hidden />
              <span>0{index + 1}</span>
            </div>
            <p>{label}</p>
            <h3>{title}</h3>
            <span>{body}</span>
          </article>
        ))}
      </section>

      <section className={styles.walletReview}>
        <div className={styles.reviewCopy}>
          <p className={styles.eyebrow}>One review surface</p>
          <h2>Component library that renders the action</h2>
          <p>
            Every Action carries a typed, kernel-sealed summary: title, ordered
            steps, cost, and warnings. Your existing review UI renders it
            directly, so what the user approves is exactly what the kernel
            verifies onchain.
          </p>
          <div>
            <span>
              <Check aria-hidden /> Typed summary
            </span>
            <span>
              <Check aria-hidden /> Sealed with the payload
            </span>
            <span>
              <Check aria-hidden /> Renders in your UI
            </span>
          </div>
        </div>

        <div
          className={styles.walletReceipt}
          role="group"
          aria-label="Swap confirmation preview"
        >
          <h3>Swap 0.5 ETH for ~1,240 USDC</h3>
          <div className={styles.walletReceiptSteps}>
            <div>
              <span>Wrap 0.5 ETH</span>
              <strong>−0.5 ETH</strong>
            </div>
            <div>
              <span>
                Swap via Uniswap v3
                <small>Simulated · guards passed</small>
              </span>
              <strong>+1,240.18 USDC</strong>
            </div>
          </div>
          <div className={styles.walletReceiptMeta}>
            <span>Gas: you pay ~$1.20</span>
            <strong>⚠ Price impact 2.3%</strong>
          </div>
          <div className={styles.walletReceiptActions}>
            <span>Reject</span>
            <span>Approve</span>
          </div>
        </div>
      </section>

      <section className={styles.walletBoundary}>
        <div className={styles.boundaryLead}>
          <p className={styles.eyebrow}>The ownership boundary</p>
          <h2>
            Zero malformed encoding: the model handles parameters, not bytes.
          </h2>
          <p>
            On reads, the harness fetches, decodes, and formats before the model
            sees anything. On writes, the model emits high-level intent and the
            harness assembles every byte of the transaction — your signer stays
            the only write authority.
          </p>
        </div>

        <div
          className={styles.boundaryDiagram}
          role="img"
          aria-label="The read/encode harness: the model emits high-level intent only; the read path fetches, calls, and formats before the model sees data, while the write path assembles calldata and hands a wallet request to your signer. The harness owns every byte; the model owns addresses, signatures, and base-unit amounts."
        >
          <div className={styles.bModelNode}>
            MODEL · high-level intent only
          </div>
          <div className={styles.bFork} aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </div>

          <div className={styles.bLanes}>
            <div className={styles.bLaneRead}>
              <span className={styles.bLaneLabel}>READ path</span>
              <div className={styles.bBox}>
                <p>
                  <code>get_contract(addr, chain)</code>
                </p>
                <ul>
                  <li>DB cache hit → return</li>
                  <li>miss → explorer fetch</li>
                  <li>store back + proxy-resolve (EIP-1967)</li>
                </ul>
                <p>
                  <code>get_account_info(addr, chain)</code>
                </p>
                <ul>
                  <li>→ {"{balance, nonce}"} (gateway)</li>
                </ul>
                <p>
                  <code>encode_and_call(sig, args, to)</code>
                </p>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bStep}>
                <code>eth_call(chain, to, calldata)</code>
                <small>(Anvil fork / gateway)</small>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bStep}>
                <span>raw 32-byte result</span>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bStep}>
                <code>format_token_units(raw, dec)</code>
                <code>format_wei_as_eth(wei)</code>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bPill}>human-readable JSON → model</div>
            </div>

            <div className={styles.bLaneWrite}>
              <span className={styles.bLaneLabel}>WRITE path</span>
              <div className={styles.bBox}>
                <p>
                  <code>stage_tx {"{ to, sig, args[] }"}</code>
                </p>
                <ul>
                  <li>args = base units (from model)</li>
                </ul>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bBox}>
                <p>
                  <code>abi_encoder::execute_call</code>
                </p>
                <ul>
                  <li>parse_function_signature → selector = keccak256[:4]</li>
                  <li>parse_param_value (str → DynSolValue)</li>
                  <li>abi_encode_params → 32-byte words</li>
                </ul>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bStep}>
                <span>calldata = 0x⟨selector⟩⟨words⟩</span>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bStep}>
                <code>
                  AssembledEvmTx
                  {"{ from*, chain*, to, value, data, label, kind }"}
                </code>
                <small>(*from / chain injected from wallet ctx)</small>
              </div>
              <span className={styles.bArrow} aria-hidden />
              <div className={styles.bPill}>
                user_state.pending_txs → commit_txs → sign
              </div>
            </div>
          </div>

          <div className={styles.bOwnership}>
            <p>OWNERSHIP — why the model never sees a byte</p>
            <div>
              <span>HARNESS owns</span>
              <strong>
                selector · ABI words · eth_call · result decoding · output
                unit-format
              </strong>
            </div>
            <div>
              <span>MODEL owns</span>
              <strong>addresses · signatures · base-unit amounts</strong>
            </div>
          </div>

          <p className={styles.bCaches}>
            Caches: contract ABI / source (SQLite / Postgres) · proxy-impl
            resolution
          </p>
        </div>

        <p className={styles.boundarySource}>
          From{" "}
          <Link to="/research/$slug" params={{slug: "aomibench-v0-1"}}>
            AomiBench: benchmarking frontier models on onchain execution
          </Link>
        </p>
      </section>

      <section className={styles.walletFit}>
        <div>
          <span>Your wallet keeps</span>
          <strong>Brand · accounts · your agent · the signer</strong>
        </div>
        <div>
          <span>Aomi adds</span>
          <strong>
            Protocol tools · simulation · guards · verified receipts
          </strong>
        </div>
      </section>

      <section className={`${styles.sectorCta} ${styles.walletCta}`}>
        <p className={styles.eyebrow}>Keep the wallet yours</p>
        <h2>Plug execution rails under your agent.</h2>
        <p>
          Bring your model&apos;s output. We will map it onto the Pipeline API,
          bind your signer stack once, and leave custody exactly where it is.
        </p>
        <Link to={`${MARKETING_ROOT}/contact`}>
          Map the integration <ArrowRight aria-hidden />
        </Link>
      </section>
    </main>
  );
}
