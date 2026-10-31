/**
 * Records one master take per scenario.
 *
 * Requires @playwright/test (see demo/README.md). Nothing else in demo/ depends
 * on Playwright, so the fork orchestration in test-env.ts is usable and
 * testable without it.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
// @playwright/test re-exports the driver; importing from "playwright" would rely
// on a transitive dep that pnpm does not hoist.
import { chromium, type Browser } from "@playwright/test";

import { sel } from "./selectors";
import {
  actorsDown,
  actorsUp,
  assertForkedOrDie,
  blockNumber,
  erc20BalanceOf,
  nativeBalance,
  readForkedChains,
  resetChain,
  resyncSimForks,
  seedErc20,
  setBalance,
  toRpcMap,
  wipeAccountCode,
  type ForkedChain,
} from "./test-env";
import {
  assertSurfnetOrDie,
  checkAssertions,
  resetSvm,
  setSolBalance,
  setTokenAccount,
} from "./svm-env";
import type {
  CaptureResult,
  Marker,
  MarkerName,
  Scenario,
} from "../scenarios/types";

const OUT_DIR = join(process.cwd(), "demo", "out");
const PORTAL_URL = process.env.PORTAL_URL ?? "http://localhost:3000";

/**
 * Seeding the portal's E2E wallet is what keeps extension popups and seed
 * phrases off camera: it mints a cookie the portal reads server-side, so the
 * wallet is already "connected" when the page first paints.
 *
 * Requires AOMI_ENABLE_E2E_WALLET=true and a matching AOMI_E2E_WALLET_TOKEN in
 * the portal's env — and note that isE2EWalletEnabled() also demands VERCEL_ENV
 * be UNSET, which a copied .env.local will usually violate.
 */
const E2E_TOKEN = process.env.AOMI_E2E_WALLET_TOKEN ?? "";
/**
 * Anvil dev account 2.
 *
 * NOT account 0 (`0xf39F…2266`), even though that is the faucet wallet
 * `test-env evm up` pre-funds and the obvious choice: it is permanently bound
 * to a different user in the shared account DB, so every signing attempt fails
 * with "wallet is currently bound to another account". Account 2 is unbound and
 * gets funded explicitly below. Override with AOMI_E2E_ADDRESS.
 */
const E2E_ADDRESS =
  process.env.AOMI_E2E_ADDRESS ?? "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
/**
 * The dedicated fork-only Solana demo wallet
 * (`test-env svm wallet --cluster mainnet-beta`); pubkey only — the keypair
 * stays server-side in the portal (AOMI_E2E_SOLANA_KEYPAIR_PATH).
 */
const E2E_SVM_ADDRESS = process.env.AOMI_E2E_SVM_ADDRESS ?? "";

function seedUrl(scenario: Scenario): string {
  const url = new URL("/api/dev/e2e/wallet", PORTAL_URL);
  url.searchParams.set("token", E2E_TOKEN);
  // EVM identity only when the scenario has an EVM leg; a pure-Solana take
  // seeds a Solana-only wallet, exactly like a Solana-native user.
  if (scenario.chains.length > 0) {
    url.searchParams.set("address", E2E_ADDRESS);
    url.searchParams.set("chainId", String(scenario.chains[0] ?? 1));
  }
  if (scenario.svm) {
    if (!E2E_SVM_ADDRESS) {
      throw new Error(
        "Scenario has an svm leg but AOMI_E2E_SVM_ADDRESS is unset.",
      );
    }
    url.searchParams.set("svmAddress", E2E_SVM_ADDRESS);
    url.searchParams.set(
      "svmCluster",
      scenario.svm.cluster === "mainnet-beta" ? "solana:mainnet" : "solana:devnet",
    );
  }
  url.searchParams.set("redirect", "/");
  return url.toString();
}

/** Typing delay per character. Fast enough not to bore, slow enough to read. */
const TYPING_DELAY_MS = 45;

class MarkerLog {
  private readonly startedAt = Date.now();
  private readonly markers: Marker[] = [];

  mark(name: MarkerName): void {
    this.markers.push({ name, offsetMs: Date.now() - this.startedAt });
  }

  all(): Marker[] {
    return [...this.markers];
  }
}

/**
 * Did the chain actually move during this take?
 *
 * An earlier version of this watched the BROWSER for requests to the fork port.
 * That was wrong, and it failed every take: the agent's tools execute
 * server-side (backend + BFF executor), so the page legitimately never contacts
 * the fork. Block height is observable from here and cannot be faked by env
 * vars being set in the wrong shell.
 *
 * Only meaningful for scenarios that execute — a read-only turn mines nothing,
 * which is why this is keyed off `scenario.expectsExecution` rather than being
 * applied blindly.
 */
async function forkProgress(
  chains: readonly ForkedChain[],
  requireAll: boolean,
) {
  const before = await Promise.all(chains.map(blockNumber));
  return {
    async settle(): Promise<{ advanced: boolean; detail: string }> {
      const after = await Promise.all(chains.map(blockNumber));
      const detail = chains
        .map((c, i) => `chain ${c.chainId}: ${before[i]} -> ${after[i]}`)
        .join(", ");
      // An actors scenario is cross-chain by construction: the deposit mines
      // on the source fork AND the actor's fill mines on the destination
      // fork. "Some chain moved" would pass a take whose bridge never
      // arrived — the exact half-demo this studio exists to prevent.
      const moved = (n: number, i: number) => n > (before[i] ?? 0);
      const advanced = requireAll
        ? after.every(moved)
        : after.some(moved);
      return { advanced, detail };
    },
  };
}

async function runScenario(
  browser: Browser,
  scenario: Scenario,
  chains: readonly ForkedChain[],
): Promise<CaptureResult> {
  const scenarioOut = join(OUT_DIR, scenario.id);
  await mkdir(scenarioOut, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    // Scale factor 1, not the retina 2 the studio started with: the doubled
    // framebuffer was the biggest single RAM cost in the rig, and a Chromium
    // renderer OOM-crash mid-take (2026-08-02) cost a whole recording session.
    // 1440x900 at 1x is still crisp for docs/social cuts; if a hero cut ever
    // truly needs retina, record that one take on a quiet machine.
    deviceScaleFactor: 1,
    recordVideo: { dir: scenarioOut, size: { width: 1440, height: 900 } },
  });

  // --- Camera hygiene -------------------------------------------------
  // Three things that are invisible in day-to-day dev and glaring on camera,
  // all fixed before the first frame rather than clicked away after it.

  // 1. Consent banner. Clicking Decline mid-take is too late: it mounts
  //    lazily, so it sat over the composer for the whole of DS6 turn 1.
  //    Pre-seeding the same key the hook reads means it never renders.
  //    "declined" (not "accepted") — the recorder should not opt a browser
  //    into analytics to get a clean frame.
  // 2. Next's dev-tools indicator renders a red "N Issues" pill bottom-left.
  //    On a product demo it reads as "this app has 3 errors".
  // 3. The thread sidebar is collapsed by clicking its trigger after load —
  //    the portal never mounts shadcn's SidebarProvider, so the usual
  //    `sidebar_state` cookie is not read and has to be a real click. Worth
  //    doing: prior debug threads are on camera otherwise, one of them
  //    titled "Lido ETH Staking Testnet Fail…".
  // An init script (not addStyleTag) so both survive the seed redirect and
  // every later navigation.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("aomi-cookie-consent", "declined");
    } catch {
      // Private-mode storage failures just mean the banner shows; the
      // in-take Decline click below is still there as a fallback.
    }
    const hideDevOverlay = () => {
      const style = document.createElement("style");
      style.textContent =
        "nextjs-portal, [data-nextjs-toast], #__next-build-watcher " +
        "{ display: none !important; }";
      document.head?.appendChild(style);
    };
    if (document.head) hideDevOverlay();
    else document.addEventListener("DOMContentLoaded", hideDevOverlay);
  });

  const markers = new MarkerLog();
  const page = await context.newPage();
  const progress = await forkProgress(
    chains,
    (scenario.actors?.length ?? 0) > 0,
  );

  try {
    if (E2E_TOKEN) {
      const seeded = await page.goto(seedUrl(scenario), {
        waitUntil: "domcontentloaded",
      });
      if (seeded && seeded.status() >= 400) {
        throw new Error(
          `E2E wallet seeding failed with HTTP ${seeded.status()}: ` +
            `${await seeded.text()}\n` +
            `Check AOMI_ENABLE_E2E_WALLET, AOMI_E2E_WALLET_TOKEN, and that ` +
            `VERCEL_ENV is unset in the portal's env.`,
        );
      }
    } else {
      await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });
    }

    // The consent banner overlaps the composer and would sit in every frame.
    // Decline rather than accept — no reason a recording studio opts into
    // tracking. It mounts lazily (it appeared AFTER this point and intercepted
    // a mid-take click once), so this is a repeatable guard, not a one-shot.
    const dismissConsent = async () => {
      const decline = page.getByRole("button", { name: /decline/i }).first();
      if (await decline.isVisible().catch(() => false)) {
        await decline.click();
        await decline
          .waitFor({ state: "hidden", timeout: 5_000 })
          .catch(() => {});
      }
    };
    await dismissConsent();

    /**
     * Keep recording while the thread is still settling. Execution callbacks
     * land after the turn stops streaming and start a new turn of their own;
     * this drains that chain until a grace window passes with no new turn.
     * Used both between prompts and at the end of the take.
     */
    const settleFollowUps = async (): Promise<void> => {
      for (;;) {
        const followUp = await page
          .locator(sel.streaming)
          .waitFor({ state: "visible", timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (!followUp) return;
        await page.locator(sel.streaming).waitFor({
          state: "detached",
          timeout: scenario.timeoutMs ?? 180_000,
        });
        markers.mark("response-complete");
      }
    };

    await page.locator(sel.composer).waitFor({ state: "visible" });

    // Collapse the thread list (see camera hygiene note 3). Verified rather
    // than fired-and-forgotten: a single blind click left the sidebar open on
    // camera, because the widget can still be settling when it lands. Click,
    // confirm the sidebar reports data-state="collapsed", retry once.
    // Best-effort throughout — a visible sidebar is a cosmetic problem, not a
    // reason to lose a take.
    const sidebar = page.locator('[data-slot="sidebar"]').first();
    const sidebarTrigger = page.locator('[data-sidebar="trigger"]').first();
    for (let attempt = 0; attempt < 2; attempt++) {
      const state = await sidebar.getAttribute("data-state").catch(() => null);
      if (state === "collapsed" || state === null) break;
      await sidebarTrigger.click({ timeout: 3_000 }).catch(() => {});
      await sidebar
        .and(page.locator('[data-state="collapsed"]'))
        .waitFor({ timeout: 3_000 })
        .catch(() => {});
    }
    await page.waitForTimeout(400); // let the collapse animation finish

    markers.mark("page-ready");

    for (const prompt of scenario.prompts) {
      await dismissConsent();
      const composer = page.locator(sel.composer);
      await composer.click();
      await composer.pressSequentially(prompt, { delay: TYPING_DELAY_MS });
      // Take 7 lost its first keystroke to hydration ("~~S~~take half…"), and a
      // typo'd prompt is on camera forever. Verify; retype once if mangled.
      const typed = await composer.inputValue().catch(() => null);
      if (typed !== null && typed !== prompt) {
        await composer.fill("");
        await composer.pressSequentially(prompt, { delay: TYPING_DELAY_MS });
      }
      markers.mark("prompt-typed");

      await page.locator(sel.send).click();
      markers.mark("prompt-submitted");

      // Wait on real UI state, never a sleep: the stop button exists only
      // while the turn is streaming.
      await page
        .locator(sel.streaming)
        .waitFor({ state: "visible", timeout: 30_000 });

      await page
        .locator(sel.workingTrace)
        .first()
        .waitFor({ state: "visible", timeout: scenario.timeoutMs ?? 180_000 })
        .then(() => markers.mark("trace-appeared"))
        .catch(() => {
          // Some turns answer without a tool trace; not fatal.
        });

      await page.locator(sel.streaming).waitFor({
        state: "detached",
        timeout: scenario.timeoutMs ?? 180_000,
      });
      markers.mark("response-complete");

      // Settle BEFORE the next prompt, not just at the end of the take. A
      // turn that stops streaming has not necessarily finished: execution
      // callbacks arrive afterwards and trigger one more agent turn, and
      // until that lands the agent does not know its own transaction
      // confirmed. DS6 take 2 typed its approval 1.6s into that gap and the
      // agent answered "no confirmed transaction hash was received … your
      // current balance is ~0.0099 SOL" — an apology, on camera, for a swap
      // and stake that had both succeeded on-chain. Same money-losing shape
      // as the failed demo this studio was built to prevent, so the wait
      // belongs after EVERY turn.
      await settleFollowUps();
    }
    // Two beats of stillness so the cut doesn't land on the last keyframe.
    await page.waitForTimeout(2_000);

    const finalMessage =
      (await page.locator(sel.assistantMessage).last().innerText()) ?? "";

    // Broadcast can trail the final token by several seconds, so poll rather
    // than sampling the instant streaming stops — an execution take should not
    // fail because the tx was still in the mempool when we looked.
    //
    // Execution proof is per-VM: EVM = a block was mined (anvil only mines on
    // transactions); SVM = balance assertions (Surfpool mints slots on a
    // clock, so slot advance proves nothing — see svm-env.ts).
    if (chains.length > 0) {
      let settled = await progress.settle();
      if (scenario.expectsExecution && !settled.advanced) {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && !settled.advanced) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          settled = await progress.settle();
        }
      }
      if (scenario.expectsExecution && !settled.advanced) {
        throw new Error(
          `Scenario "${scenario.id}" declares expectsExecution but the fork never ` +
            `mined a block (${settled.detail}). Nothing was executed on-chain, so ` +
            `this take is not a usable demo.`,
        );
      }
      console.log(`fork blocks: ${settled.detail}`);
      // Cross-chain proof beyond block counts: print the wallet's native
      // balance on every non-source leg, so the console record of a bridge
      // take shows the arrival amount next to the video path.
      for (const chain of chains.slice(1)) {
        const wei = await nativeBalance(chain, E2E_ADDRESS);
        console.log(
          `arrival balance on chain ${chain.chainId}: ${wei} wei ` +
            `(${Number(wei) / 1e18} ETH)`,
        );
      }
    }
    if (scenario.svm?.verify?.length) {
      // Same trailing-broadcast grace as the EVM path, then assert balances.
      let verdict = await checkAssertions(E2E_SVM_ADDRESS, scenario.svm.verify);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && !verdict.ok) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        verdict = await checkAssertions(E2E_SVM_ADDRESS, scenario.svm.verify);
      }
      for (const line of verdict.report) console.log(`svm verify: ${line}`);
      if (!verdict.ok) {
        throw new Error(
          `Scenario "${scenario.id}" failed its SVM balance assertions — ` +
            `nothing (or the wrong thing) executed on the mirror, so this ` +
            `take is not a usable demo.`,
        );
      }
    }

    const video = page.video();
    await context.close(); // video is only finalized on context close
    const videoPath = (await video?.path()) ?? "";

    const result: CaptureResult = {
      scenarioId: scenario.id,
      videoPath,
      markers: markers.all(),
      finalMessage,
    };
    await writeFile(
      join(scenarioOut, "markers.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    return result;
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function main(): Promise<void> {
  const scenarioId = process.argv[2];
  if (!scenarioId) {
    throw new Error("Usage: tsx demo/capture/record.ts <scenario-id>");
  }

  const { scenario } = (await import(
    `../scenarios/${scenarioId}.scenario.ts`
  )) as { scenario: Scenario };

  const hasEvm = scenario.chains.length > 0;
  const chains = hasEvm ? await readForkedChains() : [];
  if (hasEvm) {
    await assertForkedOrDie(chains);
    console.log(
      `Portal must be running with:\n` +
        `  NEXT_PUBLIC_USE_FULL_TESTNET=true\n` +
        `  NEXT_PUBLIC_FULL_TESTNET_RPC_MAP='${toRpcMap(chains)}'\n`,
    );
  }
  if (scenario.svm) {
    await assertSurfnetOrDie();
    console.log(
      `Solana leg: Surfpool mirror verified (portal needs ` +
        `AOMI_E2E_SOLANA_RPC_URL + NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL at the ` +
        `mirror, and the backend SOLANA_MAINNET_RPC_URL likewise).\n`,
    );
  }
  console.log(
    scenario.apps.length
      ? `Backend must expose exactly these apps: ${scenario.apps.join(", ")}\n`
      : `Scenario needs no SDK apps (built-in skills only).\n`,
  );

  try {
    // LLM variance is real and unavoidable: the agent does not build the same
    // instruction bundle every run. Measured on DS6 — one take simulated 8
    // txs clean and executed both legs; the next built 9, failed simulation,
    // and looped on "Correcting Marinade stake account" until the timeout,
    // executing nothing. Roughly two runs in five ended that way.
    //
    // So a take is an attempt, not a guarantee, and the studio shoots until
    // one passes rather than making a human re-run the command. Every attempt
    // re-seeds starting state, and attempts that fail have their video
    // deleted so the output dir holds exactly the take that passed.
    // Warm the portal before attempt 1. A dev-server whose build cache was
    // just wiped compiles pages on first request; the recorder's first
    // navigation then races the compile and the take ends on a blank white
    // frame (observed: attempt 1 reliably lost on a cold portal, attempt 2
    // reliably fine on the warm one). Two sequential loads make the first
    // recorded navigation boring, which is exactly what we want it to be.
    for (let warm = 0; warm < 2; warm++) {
      const ok = await fetch(PORTAL_URL)
        .then((r) => r.ok)
        .catch(() => false);
      if (!ok) {
        throw new Error(`Portal at ${PORTAL_URL} is not answering; start it first.`);
      }
    }

    const attempts = Math.max(1, Number(process.env.RECORD_ATTEMPTS ?? 3));
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) console.log(`\n--- attempt ${attempt}/${attempts} ---`);
      const funded = await seedStartingState(scenario, hasEvm);
      // Actors start AFTER reset + funding (their block cursors begin at the
      // current head, and a reset may have moved the forks' ports), and are
      // torn down per attempt so the next reset can't strand a daemon
      // watching dead endpoints. 4s fill delay: the arrival should land a
      // beat after the agent reports the deposit — suspense, not magic.
      if (scenario.actors?.length) {
        await actorsDown(); // clear any stale daemon from a previous run
        await actorsUp(scenario.actors, 4_000);
        console.log(`actors up: ${scenario.actors.join(", ")}`);
      }
      // One BROWSER per attempt, not one shared across the run. Chromium's
      // renderer is the largest RAM consumer in the rig and the first thing
      // macOS kills under memory pressure — and when the formerly-shared
      // instance crashed during attempt 1 (2026-08-02), attempt 2 died at
      // newContext before doing anything. A crash must cost one attempt,
      // never the run.
      const browser = await chromium.launch();
      try {
        // `funded`, not `chains` — a reset can hand back different ports, and
        // the block-height guard must poll the endpoints the take used.
        const result = await runScenario(browser, scenario, funded);
        console.log(`Recorded ${result.scenarioId} -> ${result.videoPath}`);
        for (const marker of result.markers) {
          console.log(
            `  ${String(marker.offsetMs).padStart(7)}ms  ${marker.name}`,
          );
        }
        await discardFailedTakes(scenario.id, result.videoPath);
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`attempt ${attempt} failed: ${detail.split("\n")[0]}`);
        if (attempt === attempts) {
          throw new Error(
            `All ${attempts} attempts failed for "${scenario.id}". Last ` +
              `error:\n${detail}`,
          );
        }
      } finally {
        await browser.close().catch(() => {
          // A crashed browser throws on close; the attempt already failed.
        });
        if (scenario.actors?.length) await actorsDown();
      }
    }
  } finally {
    // Browsers are owned per-attempt now (see above); nothing run-scoped to
    // close here. The try/finally shape is kept so a future run-scoped
    // resource has an obvious home.
  }
}

/**
 * Reset and re-seed every balance the scenario depends on, and return the
 * EVM forks the take should be verified against. Runs before EVERY attempt.
 */
async function seedStartingState(
  scenario: Scenario,
  hasEvm: boolean,
): Promise<readonly ForkedChain[]> {
  // Identical starting state for every take. Reset REFORKS the chain, which
  // wipes any prior funding — so fund after, never before (take 10 read a
  // default 10,000 ETH balance because funding preceded the reset, and the
  // agent dutifully proposed staking 5,000 ETH on camera).
  for (const chainId of scenario.chains) {
    await resetChain(chainId);
  }
  if (scenario.svm) {
    await resetSvm(scenario.svm.cluster);
    // Reset does not re-airdrop (svm-env.ts), so the studio writes every
    // balance the scenario depends on. Without this a take silently inherits
    // the previous take's leftovers.
    if (scenario.svm.fund) {
      await setSolBalance(E2E_SVM_ADDRESS, scenario.svm.fund.sol);
      console.log(`svm funded SOL: ${scenario.svm.fund.sol} lamports`);
    }
    for (const account of scenario.svm.tokenAccounts ?? []) {
      await setTokenAccount(E2E_SVM_ADDRESS, account.mint, account.amount);
      console.log(
        `svm seeded ${account.symbol}: ${account.amount} base units`,
      );
    }
  }
  // Ports can change across resets — and pids.json may list chains this
  // scenario never declared (the harness serves several scenarios' worth of
  // forks at once). Verify against exactly the scenario's chains, in the
  // scenario's order: chains[0] is the SOURCE leg and the only one funded.
  const forked = hasEvm ? await readForkedChains() : [];
  const funded = scenario.chains.map((chainId) => {
    const chain = forked.find((c) => c.chainId === chainId);
    if (!chain) {
      throw new Error(
        `Scenario "${scenario.id}" declares chain ${chainId} but the ` +
          `test-env has no fork for it. Run:\n\n` +
          `  FULL_TESTNETS=true aomi test-env evm up --chains ${scenario.chains.join(",")}\n`,
      );
    }
    return chain;
  });
  if (hasEvm) await assertForkedOrDie(funded);
  for (const [index, chain] of funded.entries()) {
    // 7702 booby-trap guard on EVERY leg (see wipeAccountCode) — a bridge
    // fill delivering native ETH into a sweeper-delegated wallet is stolen
    // in the same transaction, invisibly.
    await wipeAccountCode(chain, E2E_ADDRESS);

    // Fund the SOURCE chain only — and ZERO the wallet on every other
    // leg. Anvil pre-funds its dev accounts with 10,000 ETH on every
    // fresh fork, and that prefund reads as the wallet's destination
    // balance: one take's agent looked at Base, saw 10,000 ETH, and
    // (honestly!) closed with "this is fork-default state, I can't tell
    // whether the fill landed" — a truthful sentence that kills a bridge
    // demo. Zeroed, the arrival reads exactly the bridged amount.
    if (index > 0) {
      await setBalance(chain, E2E_ADDRESS, "0x0");
      continue;
    }

    // 10 ETH: enough to demo, small enough to look like a person.
    await setBalance(chain, E2E_ADDRESS, "0x8AC7230489E80000");

    for (const token of scenario.erc20 ?? []) {
      await seedErc20(
        chain,
        token.token,
        token.holder,
        E2E_ADDRESS,
        token.amount,
      );
      const balance = await erc20BalanceOf(chain, token.token, E2E_ADDRESS);
      if (balance < BigInt(token.amount)) {
        throw new Error(
          `Seeding ${token.symbol} failed: wallet holds ${balance}, wanted ` +
            `${token.amount}. Does holder ${token.holder} actually have it on ` +
            `this fork?`,
        );
      }
      console.log(`seeded ${token.symbol}: ${balance} base units`);
    }
  }

  // Make the backend's READ path see the seeded state. The agent reads
  // balances through the backend's sim forks, which snapshot the proxies
  // at backend boot and — in this backend mode — never refork on their
  // own. Force each sim to re-fork from its freshly-seeded proxy, THEN
  // mirror the wallet's native state onto every sim: anvil_reset
  // re-applies anvil's genesis prefund, so dev-account NATIVE balances on
  // a sim read 10,000 ETH no matter what the proxy holds (an agent staked
  // "half" of that phantom balance — 5,000 ETH of a 10 ETH wallet).
  // ERC-20 balances fork through and need no mirroring.
  if (funded.length > 0) {
    const sims = await resyncSimForks(funded);
    for (const sim of sims) {
      await wipeAccountCode(sim, E2E_ADDRESS);
      const isSource = sim.chainId === scenario.chains[0];
      await setBalance(sim, E2E_ADDRESS, isSource ? "0x8AC7230489E80000" : "0x0");
      console.log(
        `mirrored wallet state onto sim :${sim.port} (chain ${sim.chainId}, ${isSource ? "10" : "0"} ETH)`,
      );
    }
    const settleMs = Number(process.env.DEMO_SEED_SETTLE_MS ?? 3_000);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }

  return funded;
}

/**
 * Delete videos from failed attempts, leaving only the take that passed.
 * Without this the output dir accumulates one .webm per attempt and any
 * "pick the video" step downstream has to guess which one is the real take.
 */
async function discardFailedTakes(
  scenarioId: string,
  keepPath: string,
): Promise<void> {
  const dir = join(OUT_DIR, scenarioId);
  const keep = basename(keepPath);
  for (const entry of await readdir(dir)) {
    if (entry.endsWith(".webm") && entry !== keep) {
      await rm(join(dir, entry), { force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
