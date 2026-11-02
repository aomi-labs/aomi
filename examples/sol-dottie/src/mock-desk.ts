// The sample-data desk from the Sol Dottie concept. It runs when no live
// Application ID is configured, and the landing chrome (modal, Web/Telegram
// switch, blueprint tabs) runs in both modes.

export type ScenarioKey = "check" | "trade" | "earn" | "stocks";

type Scenario = {
  user: string;
  text: string;
  card: string;
  actions: Array<[label: string, next: ScenarioKey | "plan"]>;
};

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

export const scenarios: Record<ScenarioKey, Scenario> = {
  check: {
    user: "Check this token before I buy $10.",
    text: "Let’s take a look before you make a move. Here’s how I’d explain the report.",
    card: `<div class="result-title"><span>◎ SAMPLE TOKEN · RugCheck</span><small>REVIEW FLAGS</small></div><div class="card-body"><div class="risk-line"><span>△</span><div><b>A few wallets hold a large share.</b><small>Concentrated ownership can amplify selling pressure.</small></div></div><div class="risk-line"><span>△</span><div><b>Liquidity needs a closer look.</b><small>A small pool can make getting out more expensive.</small></div></div><div class="risk-line ok"><span>✓</span><div><b>No active mint authority in this example.</b><small>One positive signal, not a guarantee of safety.</small></div></div></div><div class="card-foot"><span>ILLUSTRATIVE REPORT</span><span>POWERED BY RUGCHECK ↗</span></div>`,
    actions: [
      ["See a FluxBeam preview", "trade"],
      ["Explore earning", "earn"],
    ],
  },
  trade: {
    user: "Show me a $10 trade through FluxBeam.",
    text: "Here’s the shape of your trade review. You choose the venue; your wallet makes the final call.",
    card: `<div class="result-title"><span>⇄ Direct FluxBeam swap</span><small>MOCK QUOTE</small></div><div class="card-body"><div class="quote-row"><span>You spend</span><b>10.00 USDC</b></div><div class="quote-row"><span>You receive</span><b>Sample token</b></div><div class="quote-row"><span>Route</span><b>FluxBeam direct pool</b></div><div class="quote-row"><span>Slippage limit</span><b>0.50% · illustrative</b></div><p class="inline-note">The live version will show exact output, minimum received, all fees and quote expiry from a verified route.</p><button class="mock-review" data-review="trade">Review demo trade ↗</button></div><div class="card-foot"><span>NO LIVE PRICE OR TRANSACTION</span><span>YOUR WALLET · YOUR CALL</span></div>`,
    actions: [
      ["Check the token first", "check"],
      ["Show stock-token support", "stocks"],
    ],
  },
  earn: {
    user: "Can my spare dollars do something useful?",
    text: "Let’s explore Solomon’s USDv workflow. I’ll explain how it works before offering any action.",
    card: `<div class="result-title"><span>✳ Solomon · USDv</span><small>CONCEPT FLOW</small></div><div class="card-body"><div class="quote-row"><span>Opportunity</span><b>USDv earning enrollment</b></div><div class="quote-row"><span>Rate</span><b>Fetch from current source</b></div><div class="quote-row"><span>Entry route</span><b>Verify current integration</b></div><p class="inline-note">Solomon’s current site describes rewards after eligible enrollment, without staking. Older vault examples differ. This mock does not imply enrollment is integrated or returns are guaranteed.</p><button class="mock-review" data-review="earn">Explore the earning flow ↗</button></div><div class="card-foot"><span>CURRENT CONTRACT TO VERIFY</span><span>SOLOMON ↗</span></div>`,
    actions: [
      ["Back to token research", "check"],
      ["View the build plan", "plan"],
    ],
  },
  stocks: {
    user: "Show me $10 of Nvidia’s stock token.",
    text: "Your familiar core tools are still here. I’d resolve the authentic stock-token mint, then ask the existing Jupiter integration for a quote.",
    card: `<div class="result-title"><span>▥ NVIDIA xStock · NVDAx</span><small>SAMPLE PREVIEW</small></div><div class="card-body"><div class="quote-row"><span>Spend</span><b>10.00 USDC</b></div><div class="quote-row"><span>Asset</span><b>Verified Solana mint</b></div><div class="quote-row"><span>Execution</span><b>Existing core Jupiter</b></div><p class="inline-note">Tokenized exposure is different from owning the underlying share. The live flow must check asset identity, route availability and applicable eligibility.</p><button class="mock-review" data-review="stocks">Review stock-token concept ↗</button></div><div class="card-foot"><span>EXISTING CORE CAPABILITY</span><span>NOT A LIVE QUOTE</span></div>`,
    actions: [
      ["Try the custom venue", "trade"],
      ["Explore Solomon", "earn"],
    ],
  },
};

function render(key: ScenarioKey) {
  const s = scenarios[key];
  $("#messages").innerHTML =
    `<div class="user-msg"></div><div class="assistant-msg"><div class="assistant-head"><svg><use href="#dottie"/></svg> DOTTIE <span style="font:11px var(--mono);color:#a38aad;margin-left:auto">SAMPLE CONVERSATION</span></div><p></p><div class="result-card">${s.card}</div><div class="followup">${s.actions.map(([label, k]) => `<button data-next="${k}">${label} ↗</button>`).join("")}</div></div>`;
  $(".user-msg").textContent = s.user;
  $(".assistant-msg>p").textContent = s.text;
  markScenario(key);
}

export function markScenario(key: ScenarioKey | null) {
  document
    .querySelectorAll<HTMLElement>(".scenario")
    .forEach((b) => b.classList.toggle("active", b.dataset.scenario === key));
}

export function setMode(mode: "web" | "telegram") {
  $("#desk-shell").classList.toggle("telegram-mode", mode === "telegram");
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
}

type ModalAction = { label: string; run: () => void };

let modalKicker = "SOL DOTTIE / INTERACTIVE CONCEPT";

export function showModal(title: string, text: string, action?: ModalAction) {
  const modal = $<HTMLDialogElement>("#modal");
  $("#modal-body").innerHTML = '<span class="mono"></span><h3></h3><p></p>';
  $("#modal-body .mono").textContent = modalKicker;
  $("#modal-body h3").textContent = title;
  $("#modal-body p").textContent = text;
  if (action) {
    const b = document.createElement("button");
    b.className = "btn primary";
    b.textContent = action.label;
    b.addEventListener("click", () => {
      modal.close();
      action.run();
    });
    $("#modal-body").append(b);
  }
  if (!modal.open) modal.showModal();
}

function selectPanel(id: string) {
  document
    .querySelectorAll<HTMLElement>(".blueprint-panel")
    .forEach((p) => (p.hidden = p.id !== id));
  document
    .querySelectorAll<HTMLElement>("[data-panel]")
    .forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.panel === id)),
    );
}

/** Page chrome shared by both modes. `onTelegram` handles "Meet me on Telegram". */
export function initChrome(onTelegram: () => void, kicker?: string) {
  if (kicker) modalKicker = kicker;
  document.addEventListener("click", (e) => {
    const target = (e.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    if (target.dataset.mode) setMode(target.dataset.mode as "web" | "telegram");
    if (target.dataset.open === "telegram") onTelegram();
    if (target.dataset.panel) selectPanel(target.dataset.panel);
    if (target.id === "print-plan") window.print();
    if (target.classList.contains("modal-close"))
      $<HTMLDialogElement>("#modal").close();
  });
  const modal = $<HTMLDialogElement>("#modal");
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return;
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      modal.close();
  });
  setMode("web");
}

/** The sample-data desk: canned scenarios, a keyword "composer" and review modals. */
export function initMockDesk() {
  document.addEventListener("click", (e) => {
    const target = (e.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    if (target.dataset.scenario) render(target.dataset.scenario as ScenarioKey);
    if (target.dataset.next) {
      if (target.dataset.next === "plan") {
        $("#blueprint").scrollIntoView();
        return;
      }
      render(target.dataset.next as ScenarioKey);
    }
    if (target.dataset.review === "trade")
      showModal(
        "Your move, previewed.",
        "This is an interaction mock. A live review would show exact transaction effects, fees, minimum output and expiry before asking your wallet to sign. No transaction is created here.",
        {
          label: "Show a sample receipt →",
          run: () =>
            showModal(
              "This is what done looks like.",
              "SAMPLE RECEIPT — A real confirmation would include the Solana signature, explorer link and updated holdings. No trade was submitted or confirmed in this mock.",
            ),
        },
      );
    if (target.dataset.review === "earn")
      showModal(
        "Understand it. Then decide.",
        "The implementation must verify Solomon’s current enrollment contract, eligible balances, reward source and exit behavior. This concept intentionally avoids inventing a deposit transaction or yield percentage.",
        {
          label: "See the implementation plan ↗",
          run: () => {
            $("#blueprint").scrollIntoView();
            selectPanel("readiness");
          },
        },
      );
    if (target.dataset.review === "stocks")
      showModal(
        "Same engine. More possibilities.",
        "Stock-token support reuses core Jupiter. Dottie adds a verified asset catalog and a clear review, while the live app checks the available route and eligibility. This is a sample, not a live stock order.",
      );
    if (target.classList.contains("new-chat")) render("check");
    if (target.id === "wallet-btn")
      showModal(
        "Your demo wallet.",
        "These are illustrative holdings, not a connected account. The real app will use the current Aomi wallet selection and Action flow. This mock never requests keys, signatures or funds.",
      );
  });
  $<HTMLFormElement>("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("#composer input");
    const value = input.value.trim();
    if (!value) return;
    const q = value.toLowerCase();
    const key: ScenarioKey = /stock|nvidia|nvda|equity/.test(q)
      ? "stocks"
      : /earn|dollar|solomon|usdv|yield/.test(q)
        ? "earn"
        : /swap|trade|buy|fluxbeam/.test(q) && !/check|risk/.test(q)
          ? "trade"
          : "check";
    render(key);
    $(".user-msg").textContent = value;
    input.value = "";
  });
  render("check");
}
