import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { summarize } from "./hosted-wallet-summary.mjs";

export default class HostedWalletReporter {
  attempts = [];
  total = 0;
  startedAt = new Date().toISOString();

  onBegin(_config, suite) {
    this.total = suite.allTests().length;
  }

  onTestEnd(_test, result) {
    this.attempts.push({ status: result.status, retry: result.retry });
  }

  onEnd(result) {
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    if (sourceSha !== process.env.GITHUB_SHA) {
      throw new Error("Checkout SHA differs from the trusted workflow source");
    }
    const summary = summarize({
      sourceSha,
      runId: process.env.GITHUB_RUN_ID,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      total: this.total,
      attempts: this.attempts,
      fullStatus: result.status,
    });
    mkdirSync("output/hosted-wallet", { recursive: true, mode: 0o700 });
    writeFileSync(
      "output/hosted-wallet/summary.json",
      JSON.stringify(summary, null, 2) + "\n",
      { mode: 0o600 },
    );
    if (summary.status !== "PASS") return { status: "failed" };
  }
}
