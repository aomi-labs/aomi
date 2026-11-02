import styles from "./sector-pages.module.css";

const legend = [
  { tone: "authority", label: "signing authority — holds a key" },
  { tone: "wallet", label: "wallet · public key" },
  { tone: "chain", label: "chain" },
  { tone: "queue", label: "queued tx" },
] as const;

const stacked = [
  {
    step: "01",
    title: "Logins",
    body: "Alice signs in with Para and with Privy. Both resolve to one canonical user, so the account is the person, not the credential.",
  },
  {
    step: "02",
    title: "Wallets and chains",
    body: "Each login attaches wallets, and the thread context holds which wallet covers which chain. 0x123… covers Base and Arbitrum, 0x456… covers Base and Optimism, N2e3df… covers Solana.",
  },
  {
    step: "03",
    title: "Queues",
    body: "Transactions queue per public key rather than per user, so work on one wallet never blocks another.",
  },
  {
    step: "04",
    title: "Resolution",
    body: "Every queue maps to exactly one signer. The EVM wallets resolve to a human signature through Para or MetaMask. The Solana wallet resolves to a delegated key that signs without a prompt.",
  },
] as const;

export function WalletTopology() {
  return (
    <section id="wallet-topology" className={styles.topology}>
      <header className={styles.splitHeading}>
        <div>
          <p className={styles.eyebrow}>THE MENTAL MODEL</p>
          <h2>Access control model with full permission guardrails</h2>
        </div>
        <p>
          One user can hold several logins, several wallets, and several chains
          at once. Transactions queue per public key, and every queue maps back
          to the one signer allowed to serve it. Your signer stays the authority
          in every path.
        </p>
      </header>

      <ul className={styles.topoLegend}>
        {legend.map((item) => (
          <li key={item.tone} data-tone={item.tone}>
            <i aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>

      <div className={styles.topoCanvas}>
        <svg
          viewBox="0 0 1280 640"
          role="img"
          aria-label="Two logins resolve to one user, whose wallets cover four chains. Transactions queue per public key, and each queue resolves to either a human signer or a delegated signer."
        >
          <defs>
            <marker
              id="topoArrowGrey"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.topoHeadGrey} />
            </marker>
            <marker
              id="topoArrowSync"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.topoHeadSync} />
            </marker>
            <marker
              id="topoArrowAsync"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                className={styles.topoHeadAsync}
              />
            </marker>
          </defs>

          {/* column headers */}
          <text x="112" y="28" className={styles.topoColTitle}>
            AUTH IDENTITIES
          </text>
          <text x="112" y="47" className={styles.topoColSub}>
            two logins, one person
          </text>

          <text x="460" y="28" className={styles.topoColTitle}>
            THREAD CONTEXT = USER STATE
          </text>
          <text x="460" y="47" className={styles.topoColSub}>
            wallet × chain topology
          </text>

          <text x="862" y="28" className={styles.topoColTitle}>
            TX QUEUES
          </text>
          <text x="862" y="47" className={styles.topoColSub}>
            keyed by public key
          </text>

          <text x="1100" y="28" className={styles.topoColTitle}>
            RESOLUTION
          </text>
          <text x="1100" y="47" className={styles.topoColSub}>
            which key actually signs
          </text>

          {/* thread context container */}
          <rect
            x="230"
            y="72"
            width="460"
            height="486"
            rx="18"
            className={styles.topoBox}
          />

          {/* login -> wallet */}
          <path
            d="M 138 186 C 200 178, 240 174, 292 176"
            className={styles.topoEdgeGrey}
            markerEnd="url(#topoArrowGrey)"
          />
          <path
            d="M 138 200 C 200 250, 235 300, 292 318"
            className={styles.topoEdgeGrey}
            markerEnd="url(#topoArrowGrey)"
          />
          <path
            d="M 138 430 C 200 452, 240 472, 292 480"
            className={styles.topoEdgeGrey}
            markerEnd="url(#topoArrowGrey)"
          />

          {/* wallet -> chain */}
          <path d="M 346 168 L 576 152" className={styles.topoEdgeFaint} />
          <path d="M 346 186 L 576 384" className={styles.topoEdgeFaint} />
          <path d="M 346 310 L 576 160" className={styles.topoEdgeFaint} />
          <path d="M 346 322 L 576 268" className={styles.topoEdgeFaint} />
          <path d="M 346 484 L 576 502" className={styles.topoEdgeFaint} />

          {/* thread context -> queues */}
          <path
            d="M 692 176 L 742 176"
            className={styles.topoEdgeGrey}
            markerEnd="url(#topoArrowGrey)"
          />
          <path
            d="M 692 320 L 742 320"
            className={styles.topoEdgeGrey}
            markerEnd="url(#topoArrowGrey)"
          />
          <path
            d="M 692 480 L 742 480"
            className={styles.topoEdgeGrey}
            markerEnd="url(#topoArrowGrey)"
          />

          {/* queue -> signer */}
          <path
            d="M 896 172 C 950 168, 975 200, 1000 238"
            className={styles.topoEdgeSync}
            markerEnd="url(#topoArrowSync)"
          />
          <path
            d="M 896 314 C 950 300, 972 282, 1000 262"
            className={styles.topoEdgeSync}
            markerEnd="url(#topoArrowSync)"
          />
          <path
            d="M 896 480 L 1000 472"
            className={styles.topoEdgeAsync}
            markerEnd="url(#topoArrowAsync)"
          />

          <text x="950" y="150" className={styles.topoEdgeLabelSync}>
            human signs
          </text>
          <text x="950" y="450" className={styles.topoEdgeLabelAsync}>
            auto-signs
          </text>

          {/* logins */}
          <circle cx="112" cy="190" r="26" className={styles.topoAuthority} />
          <text x="112" y="234" className={styles.topoNodeLabelPink}>
            para login
          </text>

          <circle cx="112" cy="424" r="26" className={styles.topoAuthority} />
          <text x="112" y="468" className={styles.topoNodeLabelPink}>
            privy login
          </text>
          <text x="112" y="486" className={styles.topoNodeSub}>
            delegation key
          </text>
          <text x="112" y="501" className={styles.topoNodeSub}>
            registered here
          </text>

          {/* wallets */}
          <circle cx="320" cy="176" r="25" className={styles.topoWallet} />
          <text x="320" y="218" className={styles.topoNodeLabelBlue}>
            0x123…
          </text>

          <circle cx="320" cy="320" r="25" className={styles.topoWallet} />
          <text x="320" y="362" className={styles.topoNodeLabelBlue}>
            0x456…
          </text>

          <circle cx="320" cy="480" r="25" className={styles.topoWallet} />
          <text x="320" y="522" className={styles.topoNodeLabelBlue}>
            N2e3df…
          </text>

          {/* chains */}
          <circle cx="600" cy="148" r="23" className={styles.topoChain} />
          <text x="600" y="188" className={styles.topoNodeLabelChain}>
            Base
          </text>

          <circle cx="600" cy="264" r="23" className={styles.topoChain} />
          <text x="600" y="304" className={styles.topoNodeLabelChain}>
            Optimism
          </text>

          <circle cx="600" cy="382" r="23" className={styles.topoChain} />
          <text x="600" y="422" className={styles.topoNodeLabelChain}>
            Arbitrum
          </text>

          <circle cx="600" cy="500" r="23" className={styles.topoChain} />
          <text x="600" y="540" className={styles.topoNodeLabelChain}>
            Solana
          </text>

          {/* queue slots */}
          {[176, 320, 480].map((y, row) => (
            <g key={y}>
              {[0, 1, 2].slice(0, row === 1 ? 2 : 3).map((slot) => (
                <rect
                  key={slot}
                  x={748 + slot * 23}
                  y={y - 14}
                  width="17"
                  height="28"
                  rx="4"
                  className={styles.topoQueueSlot}
                />
              ))}
            </g>
          ))}

          {/* canonical user grouping */}
          <rect
            x="838"
            y="138"
            width="66"
            height="400"
            rx="22"
            className={styles.topoCanonical}
          />
          <text x="871" y="560" className={styles.topoCanonicalLabel}>
            one canonical user_id
          </text>

          <circle cx="871" cy="176" r="24" className={styles.topoWallet} />
          <text x="871" y="217" className={styles.topoNodeLabelBlue}>
            0x123…
          </text>

          <circle cx="871" cy="320" r="24" className={styles.topoWallet} />
          <text x="871" y="361" className={styles.topoNodeLabelBlue}>
            0x456…
          </text>

          <circle cx="871" cy="480" r="24" className={styles.topoWallet} />
          <text x="871" y="521" className={styles.topoNodeLabelBlue}>
            N2e3df…
          </text>

          {/* signers */}
          <circle cx="1026" cy="250" r="26" className={styles.topoAuthority} />
          <text x="1062" y="246" className={styles.topoSignerName}>
            sync signer
          </text>
          <text x="1062" y="266" className={styles.topoSignerSub}>
            human · via Para or MetaMask
          </text>

          <circle cx="1026" cy="470" r="26" className={styles.topoAuthority} />
          <text x="1062" y="466" className={styles.topoSignerName}>
            async signer
          </text>
          <text x="1062" y="486" className={styles.topoSignerSub}>
            Aomi KMS · Privy delegated
          </text>

          {/* resolved identity band */}
          <rect
            x="230"
            y="580"
            width="674"
            height="46"
            rx="10"
            className={styles.topoIdentityBand}
          />
          <text x="567" y="600" className={styles.topoIdentityName}>
            alice@gmail.com
          </text>
          <text x="567" y="616" className={styles.topoIdentitySub}>
            resolved as one canonical user_id
          </text>
        </svg>
      </div>

      <ol className={styles.topoStack}>
        {stacked.map(({ step, title, body }) => (
          <li key={step}>
            <span>{step}</span>
            <strong>{title}</strong>
            <p>{body}</p>
          </li>
        ))}
      </ol>

      <div className={styles.topoCallouts}>
        <p data-tone="sync">
          A transaction for <strong>Base</strong> is built for{" "}
          <code>0x456…</code> and resolves to a <strong>Para</strong> signature,
          with the human in the loop.
        </p>
        <p data-tone="async">
          A transaction for <strong>Solana</strong> is built for{" "}
          <code>N2e3df…</code> and is authorized through <strong>Privy</strong>{" "}
          to be signed by a delegated key that Aomi manages.
        </p>
      </div>
    </section>
  );
}
