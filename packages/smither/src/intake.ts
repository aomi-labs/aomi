import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { BuildPlan } from "./plan";
import type { PlanStage } from "./plan";
import type { IntentTurn } from "./prompts";

/**
 * Live intake state, streamed to the browser from t=0 — before any Smithers
 * workflow exists. The composer (`distillIntent`) isn't a workflow node (there
 * is no graph until the plan is composed), so it can't ride the gateway; this
 * lightweight channel lets the browser show the conversation, the composer
 * thinking, the plan forming, and the composed stage preview as they happen.
 * When the build starts it flips to `building` with a `buildUrl`, and the page
 * follows to the gateway console — one browser tab across the whole flow.
 */
export type IntakePhase = "intake" | "preview" | "building";

export type IntakeState = {
  packageName: string;
  phase: IntakePhase;
  /** True while a distill call is in flight; drives the thinking indicator. */
  thinking: boolean;
  /** ms epoch the current think started (page computes elapsed). */
  thinkingSince: number | null;
  turns: IntentTurn[];
  draft: Partial<BuildPlan>;
  /** Composed stage preview from the current draft (empty until runnable). */
  stages: PlanStage[];
  /** Gateway console URL, set when the build starts; the page follows to it. */
  buildUrl: string | null;
};

export type IntakeServerHandle = {
  url: string;
  port: number;
  update: (patch: Partial<IntakeState>) => void;
  close: () => void;
};

const DEFAULT_INTAKE_PORT = 7331;

function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", () => resolveProbe(false));
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(() => resolveProbe(true));
    });
  });
}

/**
 * Boot the intake view server. Serves the self-contained page at `/` and the
 * JSON state at `/intake` (polled by the page). Loopback-only — it exposes the
 * in-flight plan and conversation, so it must never bind a routable interface.
 */
export async function startIntakeServer(options: {
  packageName: string;
  host?: string;
  port?: number;
  maxPortTries?: number;
}): Promise<IntakeServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const firstPort = options.port ?? DEFAULT_INTAKE_PORT;
  const tries = Math.max(1, options.maxPortTries ?? 10);

  let state: IntakeState = {
    packageName: options.packageName,
    phase: "intake",
    thinking: false,
    thinkingSince: null,
    turns: [],
    draft: {},
    stages: [],
    buildUrl: null,
  };

  const server = createHttpServer((req, res) => {
    if (req.url === "/intake") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(state));
      return;
    }
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(INTAKE_PAGE);
      return;
    }
    res.writeHead(404).end("not found");
  });

  let bound = -1;
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const port = firstPort + attempt;
    if (!(await probePort(host, port))) {
      lastError = new Error(`port ${port} in use`);
      continue;
    }
    try {
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen({ host, port }, () => {
          server.removeListener("error", reject);
          resolveListen();
        });
      });
      bound = port;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (bound === -1) {
    throw new Error(
      `No free intake port in ${firstPort}..${firstPort + tries - 1}: ${String(
        (lastError as Error | undefined)?.message ?? lastError,
      )}`,
    );
  }

  return {
    url: `http://${host}:${bound}/`,
    port: bound,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    close: () => server.close(),
  };
}

/**
 * Self-contained intake page (aomi-branded, no build step). Polls `/intake`
 * and renders the conversation, composer thinking, forming plan, and composed
 * stage preview; follows `buildUrl` to the gateway console when the build
 * starts. Kept as a plain string so it needs no bundling — the CLI serves it
 * directly.
 */
const INTAKE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>aomi smither · intake</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=PT+Serif:wght@400;700&display=swap" />
<style>
:root {
  --aomi-bg: #fafafa; --aomi-surface: #ffffff; --aomi-ink: #09090b;
  --aomi-muted: #71717a; --aomi-border: #e4e4e7; --aomi-accent: #d3c2d8;
  --aomi-accent-soft: #e3d8e6; --aomi-success: #2e9e6b; --aomi-info: #416cac;
  --aomi-font-display: "PT Serif", ui-serif, Georgia, serif;
  --aomi-font-body: "Geist", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --aomi-font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--aomi-bg); color: var(--aomi-ink); font-family: var(--aomi-font-body); }
.page { max-width: 820px; margin: 0 auto; padding: 28px 20px 64px; }
.topbar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 18px; }
.brand { display: flex; align-items: baseline; gap: 8px; }
.wordmark { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.wordmark-sub { color: var(--aomi-muted); font-size: 15px; }
.status { display: flex; align-items: center; gap: 8px; color: var(--aomi-muted); font-size: 13px; }
.dot { width: 8px; height: 8px; border-radius: 9999px; background: var(--aomi-muted); }
.dot-live { background: var(--aomi-info); box-shadow: 0 0 0 3px rgba(65,108,172,0.16); animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.eyebrow { text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px; color: var(--aomi-muted); }
.package-title { font-family: var(--aomi-font-display); font-size: 36px; line-height: 1.1; margin: 4px 0 20px; font-weight: 700; }
.card { background: var(--aomi-surface); border: 1px solid var(--aomi-border); border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(26,22,20,0.04); }
.card-title { font-size: 13px; font-weight: 500; color: var(--aomi-muted); margin-bottom: 12px; }
.turns { display: flex; flex-direction: column; gap: 10px; }
.turn { display: flex; gap: 10px; }
.turn-who { font-family: var(--aomi-font-mono); font-size: 12px; color: var(--aomi-muted); min-width: 56px; padding-top: 2px; }
.turn-smither .turn-text { color: var(--aomi-ink); }
.turn-user .turn-text { color: var(--aomi-info); }
.turn-text { white-space: pre-wrap; line-height: 1.5; font-size: 14px; }
.thinking { color: var(--aomi-muted); font-style: italic; font-size: 14px; margin-top: 8px; }
.plan-grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 14px; }
.plan-key { color: var(--aomi-muted); font-family: var(--aomi-font-mono); font-size: 12px; padding-top: 2px; }
.plan-val { word-break: break-word; }
.stage-rail { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.stage-row { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 10px; font-size: 14px; }
.stage-dot { width: 10px; height: 10px; border-radius: 9999px; border: 2px solid var(--aomi-border); flex-shrink: 0; }
.stage-dot.clarify { border-color: var(--aomi-info); }
.stage-dot.approval { border-color: var(--aomi-accent); }
.stage-kind { font-size: 11px; text-transform: lowercase; color: var(--aomi-muted); font-family: var(--aomi-font-mono); }
.empty { color: var(--aomi-muted); font-size: 14px; }
.banner { background: var(--aomi-accent-soft); border-radius: 12px; padding: 12px 16px; font-size: 14px; margin-bottom: 16px; }
.footnote { color: var(--aomi-muted); font-size: 12px; text-align: center; margin-top: 24px; }
</style>
</head>
<body>
<div class="page">
  <div class="topbar">
    <div class="brand"><span class="wordmark">aomi</span><span class="wordmark-sub">smither</span></div>
    <div class="status"><span id="status-dot" class="dot"></span><span id="status-text">connecting…</span></div>
  </div>
  <div class="eyebrow">composing workflow</div>
  <h1 class="package-title" id="package-title">…</h1>
  <div id="banner"></div>
  <div class="card">
    <div class="card-title">Intake conversation</div>
    <div class="turns" id="turns"><div class="empty">Waiting for the conversation…</div></div>
    <div class="thinking" id="thinking" style="display:none"></div>
  </div>
  <div class="card">
    <div class="card-title">Plan taking shape</div>
    <div id="plan"><div class="empty">Nothing decided yet.</div></div>
  </div>
  <div class="card">
    <div class="card-title">Composed workflow</div>
    <ul class="stage-rail" id="stages"><li class="empty">Stages appear as the plan firms up.</li></ul>
  </div>
  <div class="footnote">aomi smither · intake — this view follows into the live build console when the run starts</div>
</div>
<script>
const PLAN_KEYS = ["package","source","openApiUrl","userStory","builder","review","reviewer","smoke","deploy"];
function esc(s){ return String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function renderTurns(turns){
  const el = document.getElementById("turns");
  if(!turns || !turns.length){ el.innerHTML = '<div class="empty">Waiting for the conversation…</div>'; return; }
  el.innerHTML = turns.map(t =>
    '<div class="turn turn-'+t.role+'"><div class="turn-who">'+esc(t.role)+'</div><div class="turn-text">'+esc(t.text)+'</div></div>'
  ).join("");
}
function renderThinking(state){
  const el = document.getElementById("thinking");
  if(state.thinking){
    const secs = state.thinkingSince ? Math.max(0, Math.round((Date.now()-state.thinkingSince)/1000)) : 0;
    el.style.display = "block";
    el.textContent = "composer thinking… ("+secs+"s)";
  } else { el.style.display = "none"; }
}
function renderPlan(draft){
  const el = document.getElementById("plan");
  const rows = PLAN_KEYS.filter(k => draft[k] !== undefined && draft[k] !== "" )
    .map(k => '<div class="plan-key">'+k+'</div><div class="plan-val">'+esc(draft[k])+'</div>');
  el.innerHTML = rows.length ? '<div class="plan-grid">'+rows.join("")+'</div>' : '<div class="empty">Nothing decided yet.</div>';
}
function renderStages(stages){
  const el = document.getElementById("stages");
  if(!stages || !stages.length){ el.innerHTML = '<li class="empty">Stages appear as the plan firms up.</li>'; return; }
  el.innerHTML = stages.map(s =>
    '<li class="stage-row"><span class="stage-dot '+esc(s.kind)+'"></span><span style="flex:1">'+esc(s.label)+'</span><span class="stage-kind">'+esc(s.kind)+'</span></li>'
  ).join("");
}
let followed = false;
async function tick(){
  try {
    const res = await fetch("/intake", { cache: "no-store" });
    const state = await res.json();
    document.getElementById("package-title").textContent = state.package || "…";
    document.getElementById("status-dot").className = "dot " + (state.thinking ? "dot-live" : "");
    document.getElementById("status-text").textContent =
      state.phase === "building" ? "build started" : state.thinking ? "composing" : state.phase;
    renderTurns(state.turns);
    renderThinking(state);
    renderPlan(state.draft || {});
    renderStages(state.stages);
    const banner = document.getElementById("banner");
    if(state.phase === "preview"){
      banner.innerHTML = '<div class="banner">Plan is runnable — confirm it in the terminal to start the build.</div>';
    } else if(state.phase === "building" && state.buildUrl){
      banner.innerHTML = '<div class="banner">Build started — following to the live console…</div>';
      if(!followed){ followed = true; setTimeout(() => { location.href = state.buildUrl; }, 900); }
    } else { banner.innerHTML = ""; }
  } catch (e) {
    document.getElementById("status-text").textContent = "disconnected";
  }
}
tick();
setInterval(tick, 700);
</script>
</body>
</html>`;
