/**
 * Advisory AI QA against a hosted test Portal (ChatRC by default).
 *
 * Claude drives a real Chromium page through each flow from loadFlows(), using
 * the injected test wallet to sign in. It records screenshots, console errors
 * and findings with reproduction steps under output/ai-qa/<run>/. The result
 * is advice: the process exits 0 whatever Claude finds, and non-zero only when
 * the harness itself cannot run.
 *
 *   AOMI_HOSTED_E2E_PORTAL_URL=https://chat-rc.aomi.dev \
 *   AOMI_HOSTED_E2E_EVM_PRIVATE_KEY=0x<disposable> \
 *   ANTHROPIC_API_KEY=... pnpm ai-qa [--flows <regex>]
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "@playwright/test";
import { hostedPortalUrl, installHostedWallet } from "../hosted-wallet-fixture";
import { loadFlows, type Flow } from "./flows";

type Beta = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultContent =
  Anthropic.Beta.Messages.BetaToolResultBlockParam["content"];

const MODEL = process.env.AOMI_AI_QA_MODEL ?? "claude-opus-5-5";
const MAX_STEPS = Number(process.env.AOMI_AI_QA_MAX_STEPS ?? 30);
// Stops the whole run once this many input tokens (cached reads included) are spent.
const MAX_INPUT_TOKENS = Number(
  process.env.AOMI_AI_QA_MAX_INPUT_TOKENS ?? 6_000_000,
);
const SNAPSHOT_CHARS = 15_000;

type Severity = "high" | "medium" | "low";
type Finding = {
  severity: Severity;
  title: string;
  steps: string[];
  expected: string;
  actual: string;
  screenshot: string;
};
type FlowResult = {
  flow: Flow;
  verdict: "pass" | "fail" | "blocked" | "incomplete";
  summary: string;
  steps: number;
  findings: Finding[];
  consoleErrors: string[];
  failedRequests: string[];
  blockedRequests: string[];
  screenshots: string[];
};

const SYSTEM = `You are a QA tester for the Aomi chat Portal. You test a release candidate in a real browser through tools, and your report is advisory: a person reads it before deciding on a release.

Each task gives one goal, taken from the title of a scripted journey test. That test runs on a fake agent backend; here the agent is real, so test the behaviour the title promises as a user would see it, and adapt steps the real agent makes impossible.

How to work:
- Start with snapshot. It returns the URL and the page's accessibility tree; target elements by role and accessible name from it. Take a screenshot when how something looks matters, or as evidence.
- Sign in only when the goal needs an account: open "Sign in", choose "Connect MetaMask", then "Link wallet and sign in". The page carries an injected test wallet that signs only this site's sign-in challenge. Never type a password, email code, key or card number.
- Real agent replies take up to a minute. Use wait, then snapshot, rather than concluding early.
- Never try to send a transaction, approve a payment or leave the site; such requests are blocked and are not defects.
- Report each defect you actually observe with report_finding, with steps someone else can follow from a fresh page. Do not report the test wallet, blocked transactions, or behaviour the goal does not cover.
- When the goal is shown to work, shown broken, or cannot be tested here, call finish. Keep messages short.`;

const target = {
  type: "object",
  description:
    "Which element. Give role (with name) from the snapshot, or testId, label, placeholder or text.",
  properties: {
    role: { type: "string" },
    name: { type: "string" },
    testId: { type: "string" },
    label: { type: "string" },
    placeholder: { type: "string" },
    text: { type: "string" },
    exact: { type: "boolean" },
    nth: { type: "integer", description: "0-based index when several match" },
  },
  additionalProperties: false,
} as const;

const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "snapshot",
    description: "Current URL, title and accessibility tree of the page.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    description: "A screenshot of the visible page.",
    input_schema: {
      type: "object",
      properties: { fullPage: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "click",
    description: "Click an element.",
    input_schema: {
      type: "object",
      properties: { target },
      required: ["target"],
      additionalProperties: false,
    },
  },
  {
    name: "fill",
    description: "Replace the text in an input or editor.",
    input_schema: {
      type: "object",
      properties: { target, value: { type: "string" } },
      required: ["target", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "press",
    description:
      "Press a key or chord on the focused element, e.g. Enter or Shift+Enter.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "goto",
    description: "Open a path on the Portal origin, e.g. / or /settings.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "reload",
    description: "Reload the page.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "wait",
    description: "Wait, in seconds (at most 60).",
    input_schema: {
      type: "object",
      properties: { seconds: { type: "number" } },
      required: ["seconds"],
      additionalProperties: false,
    },
  },
  {
    name: "set_viewport",
    description: "Resize the page, e.g. 400x800 for a phone.",
    input_schema: {
      type: "object",
      properties: { width: { type: "integer" }, height: { type: "integer" } },
      required: ["width", "height"],
      additionalProperties: false,
    },
  },
  {
    name: "report_finding",
    description:
      "Record a defect you observed. A screenshot is taken automatically.",
    input_schema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["high", "medium", "low"] },
        title: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        expected: { type: "string" },
        actual: { type: "string" },
      },
      required: ["severity", "title", "steps", "expected", "actual"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "End this flow with a verdict.",
    input_schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["pass", "fail", "blocked"] },
        summary: { type: "string" },
      },
      required: ["verdict", "summary"],
      additionalProperties: false,
    },
  },
];

type Target = {
  role?: string;
  name?: string;
  testId?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  exact?: boolean;
  nth?: number;
};

function locate(page: Page, t: Target): Locator {
  const exact = t.exact ?? false;
  let locator: Locator;
  if (t.role)
    locator = page.getByRole(t.role as Parameters<Page["getByRole"]>[0], {
      name: t.name,
      exact,
    });
  else if (t.testId) locator = page.getByTestId(t.testId);
  else if (t.label) locator = page.getByLabel(t.label, { exact });
  else if (t.placeholder)
    locator = page.getByPlaceholder(t.placeholder, { exact });
  else if (t.text) locator = page.getByText(t.text, { exact });
  else throw new Error("target needs role, testId, label, placeholder or text");
  return t.nth === undefined ? locator.first() : locator.nth(t.nth);
}

// The same guard as the hosted wallet journeys: nothing here may move funds.
const FORBIDDEN_PATH =
  /\/(?:api\/bff\/e2e\/execute|v1\/agent\/actions\/[^/]+\/(?:approve|execute)|broadcast)(?:\/|$)/;
const FORBIDDEN_RPC =
  /"method"\s*:\s*"(?:eth_sendRawTransaction|eth_sendTransaction|solana_sendTransaction)"/;

class Usage {
  input = 0;
  cacheRead = 0;
  cacheWrite = 0;
  output = 0;
  add(usage: Anthropic.Beta.Messages.BetaUsage) {
    this.input += usage.input_tokens;
    this.cacheRead += usage.cache_read_input_tokens ?? 0;
    this.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    this.output += usage.output_tokens;
  }
  get totalInput() {
    return this.input + this.cacheRead + this.cacheWrite;
  }
}

async function runFlow(
  client: Anthropic,
  flow: Flow,
  dir: string,
  usage: Usage,
): Promise<FlowResult> {
  mkdirSync(dir, { recursive: true });
  const origin = hostedPortalUrl();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const result: FlowResult = {
    flow,
    verdict: "incomplete",
    summary: "",
    steps: 0,
    findings: [],
    consoleErrors: [],
    failedRequests: [],
    blockedRequests: [],
    screenshots: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error")
      result.consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", (error) =>
    result.consoleErrors.push(`pageerror: ${error.message}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 500)
      result.failedRequests.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      FORBIDDEN_PATH.test(new URL(request.url()).pathname) ||
      FORBIDDEN_RPC.test(request.postData() ?? "")
    ) {
      result.blockedRequests.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  await installHostedWallet(page, "evm");
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  let shots = 0;
  const shoot = async (fullPage = false) => {
    const file = join(dir, `shot-${String(++shots).padStart(2, "0")}.jpg`);
    const data = await page.screenshot({
      type: "jpeg",
      quality: 70,
      fullPage,
      path: file,
    });
    result.screenshots.push(file);
    return { file, data: data.toString("base64") };
  };

  const execute = async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResultContent> => {
    switch (name) {
      case "snapshot": {
        const tree = await page
          .locator("body")
          .ariaSnapshot({ timeout: 10_000 });
        const clipped =
          tree.length > SNAPSHOT_CHARS
            ? `${tree.slice(0, SNAPSHOT_CHARS)}\n…(truncated)`
            : tree;
        return `URL: ${page.url()}\nTitle: ${await page.title()}\n\n${clipped}`;
      }
      case "screenshot": {
        const shot = await shoot(Boolean(input.fullPage));
        return [
          { type: "text", text: `Saved ${shot.file}` },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: shot.data,
            },
          },
        ];
      }
      case "click":
        await locate(page, input.target as Target).click({ timeout: 10_000 });
        return `Clicked. URL: ${page.url()}`;
      case "fill":
        await locate(page, input.target as Target).fill(String(input.value), {
          timeout: 10_000,
        });
        return "Filled.";
      case "press":
        await page.keyboard.press(String(input.key));
        return `Pressed ${input.key}.`;
      case "goto": {
        const url = new URL(String(input.path), origin);
        if (url.origin !== origin)
          throw new Error(`Only ${origin} may be opened`);
        await page.goto(url.href, { waitUntil: "domcontentloaded" });
        return `Opened ${page.url()}`;
      }
      case "reload":
        await page.reload({ waitUntil: "domcontentloaded" });
        return `Reloaded ${page.url()}`;
      case "wait":
        await page.waitForTimeout(
          Math.min(Number(input.seconds) || 1, 60) * 1000,
        );
        return "Waited.";
      case "set_viewport":
        await page.setViewportSize({
          width: Number(input.width),
          height: Number(input.height),
        });
        return "Resized.";
      case "report_finding": {
        const shot = await shoot();
        result.findings.push({
          ...(input as Omit<Finding, "screenshot">),
          screenshot: shot.file,
        });
        return `Recorded with ${shot.file}.`;
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  };

  const messages: Beta[] = [
    {
      role: "user",
      content: `Portal: ${origin}\nGoal (from ${flow.source}): ${flow.goal}\n\nYou have at most ${MAX_STEPS} turns.`,
    },
  ];
  let nudged = false;
  try {
    for (
      ;
      result.steps < MAX_STEPS && usage.totalInput < MAX_INPUT_TOKENS;
      result.steps++
    ) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16_000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
        cache_control: { type: "ephemeral" },
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      usage.add(response.usage);
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "refusal") {
        result.verdict = "blocked";
        result.summary = "The model declined this flow.";
        break;
      }
      const calls = response.content.filter(
        (block): block is Anthropic.Beta.Messages.BetaToolUseBlock =>
          block.type === "tool_use",
      );
      if (calls.length === 0) {
        if (nudged) break;
        nudged = true;
        messages.push({
          role: "user",
          content: "Continue, and call finish when you are done.",
        });
        continue;
      }
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        if (call.name === "finish") {
          result.verdict = input.verdict as FlowResult["verdict"];
          result.summary = String(input.summary ?? "");
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Done.",
          });
          continue;
        }
        try {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: await execute(call.name, input),
          });
        } catch (error) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: String(
              error instanceof Error ? error.message : error,
            ).slice(0, 1000),
          });
        }
      }
      messages.push({ role: "user", content: results });
      if (result.verdict !== "incomplete") break;
    }
  } finally {
    await shoot().catch(() => undefined);
    writeFileSync(
      join(dir, "transcript.json"),
      JSON.stringify(redactImages(messages), null, 2),
    );
    await browser.close();
  }
  if (result.verdict === "incomplete")
    result.summary ||= `Stopped after ${result.steps} turns without a verdict.`;
  return result;
}

function redactImages(messages: Beta[]): unknown {
  return JSON.parse(
    JSON.stringify(messages, (key, value) =>
      key === "data" && typeof value === "string" && value.length > 200
        ? "<image>"
        : value,
    ),
  );
}

function markdown(results: FlowResult[], usage: Usage, runDir: string): string {
  const lines = [
    `# AI QA (advisory) — ${hostedPortalUrl()}`,
    "",
    `Model ${MODEL}; ${results.length} flows; input ${usage.totalInput} tokens (${usage.cacheRead} cached), output ${usage.output}.`,
    `Artifacts: ${runDir}`,
    "",
    "| Flow | Verdict | Findings | Console errors | 5xx |",
    "|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.flow.goal.replace(/\|/g, "/")} | ${r.verdict} | ${r.findings.length} | ${r.consoleErrors.length} | ${r.failedRequests.length} |`,
    ),
  ];
  for (const r of results) {
    lines.push("", `## ${r.flow.goal}`, "", `${r.verdict}: ${r.summary}`);
    for (const f of r.findings) {
      lines.push(
        "",
        `### [${f.severity}] ${f.title}`,
        "",
        ...f.steps.map((step, i) => `${i + 1}. ${step}`),
        "",
        `Expected: ${f.expected}`,
        "",
        `Actual: ${f.actual}`,
        "",
        `Screenshot: ${f.screenshot}`,
      );
    }
    if (r.consoleErrors.length)
      lines.push(
        "",
        "Console errors:",
        ...[...new Set(r.consoleErrors)]
          .slice(0, 10)
          .map((e) => `- \`${e.replace(/`/g, "'")}\``),
      );
    if (r.failedRequests.length)
      lines.push(
        "",
        "Server errors:",
        ...[...new Set(r.failedRequests)].slice(0, 10).map((e) => `- ${e}`),
      );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const filterAt = args.indexOf("--flows");
  const flows = loadFlows(
    filterAt >= 0 ? args[filterAt + 1] : process.env.AOMI_AI_QA_FLOWS,
  );
  if (args.includes("--list")) {
    for (const flow of flows) console.log(`${flow.id}\n  ${flow.goal}`);
    return;
  }
  hostedPortalUrl(); // fails early outside the test Portals
  if (flows.length === 0) throw new Error("No flows match");
  const client = new Anthropic();
  const runDir = join(
    "output",
    "ai-qa",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  const usage = new Usage();
  const results: FlowResult[] = [];
  for (const [index, flow] of flows.entries()) {
    if (usage.totalInput >= MAX_INPUT_TOKENS) {
      console.log(
        `Token budget spent; skipping ${flows.length - index} flows.`,
      );
      break;
    }
    console.log(`[${index + 1}/${flows.length}] ${flow.goal}`);
    try {
      const r = await runFlow(client, flow, join(runDir, flow.id), usage);
      console.log(
        `  ${r.verdict} in ${r.steps} turns, ${r.findings.length} findings: ${r.summary}`,
      );
      results.push(r);
    } catch (error) {
      // Advisory: a flow that cannot start is reported, and the run goes on.
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  harness error: ${message}`);
      results.push({
        flow,
        verdict: "blocked",
        summary: `Harness error: ${message}`,
        steps: 0,
        findings: [],
        consoleErrors: [],
        failedRequests: [],
        blockedRequests: [],
        screenshots: [],
      });
    }
  }
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "report.json"),
    JSON.stringify(
      { model: MODEL, portal: hostedPortalUrl(), usage, results },
      null,
      2,
    ),
  );
  writeFileSync(join(runDir, "report.md"), markdown(results, usage, runDir));
  console.log(`Report: ${join(runDir, "report.md")}`);
}

await main();
