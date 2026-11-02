import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AomiWidget, type AomiRoutingConfig } from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";
import { markScenario, showModal, type ScenarioKey } from "./mock-desk";

// The playbook buttons put a starter prompt in the composer. They never send:
// the visitor adds the token, reads it and presses send.
const PROMPTS: Record<ScenarioKey, string> = {
  check: "Check this token for risks before I buy $10: ",
  trade: "Quote a $10 USDC swap through FluxBeam into: ",
  earn: "Show me Solomon’s USDv earning workflow. What can I do with $10 USDC?",
  stocks: "Quote $10 USDC of NVIDIA xStock (NVDAx) through Jupiter.",
};

export type LiveDeskOptions = {
  applicationId: string;
  baseUrl?: string;
  telegramUrl: string;
};

const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Replace the concept desk's sample data with the live Aomi chat. */
export function mountLiveDesk({
  applicationId,
  baseUrl,
  telegramUrl,
}: LiveDeskOptions) {
  const shell = q("#desk-shell");
  if (!shell) return;
  shell.classList.add("live");

  const label = q(".demo-label");
  if (label)
    label.innerHTML =
      "<i></i> Live on Solana mainnet · Real quotes · Your wallet signs every transaction";

  // Middle column: the widget takes the place of the canned messages and form.
  q(".chat-top small")?.remove();
  const signingBtn = q("#wallet-btn");
  if (signingBtn) {
    signingBtn.textContent = "How signing works ↗";
    signingBtn.addEventListener("click", () =>
      showModal(
        "Your wallet makes the final call.",
        "Dottie prepares and simulates each move, then shows you the review. Nothing leaves your wallet until you approve it there, and every confirmed move links to the Solana explorer.",
      ),
    );
  }
  const tgSub = q(".tg-header small");
  if (tgSub) tgSub.textContent = "bot · same Dottie, live";
  const mount = el('<div class="live-chat"></div>');
  q("#messages")?.replaceWith(mount);
  q("#composer")?.remove();

  // Left column: no demo wallet; the widget header owns sign-in.
  q(".new-chat")?.remove();
  q(".sidebar-bottom")?.replaceWith(
    el(
      `<div class="sidebar-bottom live-hint"><div class="avatar-dot">✳</div><span><b>Your wallet</b><small>Sign in at the top of the chat</small></span></div>`,
    ),
  );
  markScenario(null);

  // Right column: swap the sample portfolio for how a move works.
  document
    .querySelectorAll(
      ".portfolio .balance-label, .portfolio .balance, .portfolio .holding",
    )
    .forEach((n) => n.remove());
  const corner = q(".portfolio h3");
  if (corner) {
    corner.textContent = "How a move works.";
    corner.after(
      el(`<ol class="live-steps">
        <li><b>Ask</b><small>Paste a token or pick a playbook card.</small></li>
        <li><b>Review</b><small>Risk signals, route, fees and minimum out.</small></li>
        <li><b>Sign</b><small>Approve in your own wallet, or don’t.</small></li>
        <li><b>Done</b><small>A confirmed signature you can open.</small></li>
      </ol>`),
    );
  }

  // Telegram section: point at the real bot when there is one.
  const channelNote = q(".channel-copy small");
  if (channelNote)
    channelNote.textContent = telegramUrl
      ? "Same Dottie, same wallet handoff, in your pocket."
      : "The Telegram bot is on its way. The web desk above is live.";
  if (telegramUrl) {
    const tgBtn = q(".channel-copy .btn");
    if (tgBtn)
      tgBtn.innerHTML =
        '<svg><use href="#tg"/></svg> Open in Telegram <span>↗</span>';
  }

  document.addEventListener("click", (e) => {
    const target = (e.target as Element).closest<HTMLElement>("button");
    const key = target?.dataset.scenario as ScenarioKey | undefined;
    if (!key) return;
    markScenario(key);
    fillComposer(mount, PROMPTS[key]);
  });

  const numericId = Number(applicationId);
  const routing: AomiRoutingConfig =
    Number.isSafeInteger(numericId) && numericId > 0
      ? {
          targets: [{ mode: "direct", apps: [{ applicationId: numericId }] }],
          defaultMode: "direct",
        }
      : { targets: [{ mode: "auto" }] };

  createRoot(mount).render(
    <StrictMode>
      <AomiWidget
        applicationId={applicationId}
        baseUrl={baseUrl}
        theme="light"
        routing={routing}
        auth={{ type: "browser_wallet" }}
        walletFamilies={["solana"]}
        wallets={{ evm: false, solana: { preset: "popular" } }}
        showSidebar={false}
        walletPosition="header"
        features={{ theme: false }}
        height="100%"
        width="100%"
        className="dottie-widget"
      />
    </StrictMode>,
  );
}

/** Put text in the widget composer (a contenteditable) without sending it. */
function fillComposer(root: HTMLElement, text: string) {
  const input = root.querySelector<HTMLElement>(
    '[data-testid="aomi-composer-input"]',
  );
  if (input && input.isContentEditable) {
    input.focus();
    window.getSelection()?.selectAllChildren(input);
    // execCommand keeps the editor's own input handling in the loop.
    if (document.execCommand("insertText", false, text)) return;
  }
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  showModal("Here’s a starter.", `Paste this into the chat: “${text.trim()}”`);
}
