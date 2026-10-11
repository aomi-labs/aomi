"use client";

import { useState } from "react";
import { ChevronDown, FileCode2, Folder, FolderOpen } from "lucide-react";
import styles from "./plugin-sdk-marketing.module.css";

type ProjectFile = {
  path: string;
  label: string;
  language: "rust" | "toml";
  purpose: string;
  source: readonly string[];
};

const projectFiles: readonly ProjectFile[] = [
  {
    path: "src/lib.rs",
    label: "lib.rs",
    language: "rust",
    purpose: "Register the plugin role, tools, and Aomi transaction namespace.",
    source: [
      "// The product-specific role and workflow.",
      'const PREAMBLE: &str = r#"',
      "Read the market, quote the requested outcome,",
      "then pass the selected action to Aomi. Never sign.",
      '"#;',
      "",
      "dyn_aomi_app!(",
      "    app        = client::PolymarketTrader,",
      '    name       = "polymarket-trader",',
      "    preamble   = PREAMBLE,",
      "    tools      = [tool::ReadMarket, tool::QuoteOrder],",
      "    namespaces = [transactions]",
      ");",
    ],
  },
  {
    path: "src/client.rs",
    label: "client.rs",
    language: "rust",
    purpose: "Keep the integrator-owned market API behind one typed client.",
    source: [
      "pub struct PolymarketClient {",
      "    base_url: Url,",
      "    http: Client,",
      "}",
      "",
      "impl PolymarketClient {",
      "    pub async fn market(&self, id: &str) -> Result<Market> {",
      '        self.get(format!("/markets/{id}")).await',
      "    }",
      "",
      "    pub async fn orderbook(&self, token: &str) -> Result<Book> {",
      '        self.get(format!("/orderbook?token={token}")).await',
      "    }",
      "}",
    ],
  },
  {
    path: "src/tool.rs",
    label: "tool.rs",
    language: "rust",
    purpose: "Expose intent-shaped tools instead of every upstream endpoint.",
    source: [
      "#[aomi_tool]",
      "async fn read_market(args: MarketArgs, ctx: DynToolCallCtx) {",
      "    let market = ctx.client().market(&args.market_id).await?;",
      "    Ok(MarketView::from(market))",
      "}",
      "",
      "#[aomi_tool]",
      "async fn quote_order(args: OrderArgs, ctx: DynToolCallCtx) {",
      "    let book = ctx.client().orderbook(&args.token_id).await?;",
      "    Ok(book.quote_bounded(args.limit, args.max_loss))",
      "}",
    ],
  },
  {
    path: "src/types.rs",
    label: "types.rs",
    language: "rust",
    purpose: "Normalize market data and order constraints into stable JSON.",
    source: [
      "#[derive(JsonSchema, Deserialize)]",
      "pub struct OrderArgs {",
      "    pub market_id: String,",
      "    pub outcome: Outcome,",
      "    pub limit: Decimal,",
      "    pub max_loss: UsdAmount,",
      "}",
      "",
      "#[derive(Serialize)]",
      "pub struct OrderQuote {",
      "    pub shares: Decimal,",
      "    pub action: ActionSpec,",
      "}",
    ],
  },
  {
    path: "Cargo.toml",
    label: "Cargo.toml",
    language: "toml",
    purpose: "Compile the plugin as a cdylib against the pinned public SDK.",
    source: [
      "[package]",
      'name = "polymarket-trader"',
      'version = "0.1.0"',
      "",
      "[lib]",
      'crate-type = ["cdylib"]',
      "",
      "[dependencies]",
      'aomi-sdk = "=3.0.3"',
      'serde = { version = "1", features = ["derive"] }',
    ],
  },
] as const;

function SourceLine({ line, index }: { line: string; index: number }) {
  const trimmed = line.trim();
  const className = trimmed.startsWith("//")
    ? styles.fileCodeComment
    : trimmed.startsWith("#") || trimmed.startsWith("dyn_aomi_app!")
      ? styles.fileCodeAccent
      : undefined;

  return (
    <span className={className}>
      <i>{index + 1}</i>
      <code>{line || " "}</code>
    </span>
  );
}

export function PluginFileExplorer() {
  const [selectedPath, setSelectedPath] = useState("src/lib.rs");
  const selected =
    projectFiles.find((file) => file.path === selectedPath) ?? projectFiles[0];
  const sourceFiles = projectFiles.filter((file) =>
    file.path.startsWith("src/"),
  );
  const rootFiles = projectFiles.filter((file) => !file.path.includes("/"));

  return (
    <div className={styles.fileExplorer}>
      <aside className={styles.fileTree} aria-label="polymarket-trader files">
        <header>
          <span>FILES</span>
          <small>polymarket-trader</small>
        </header>

        <div className={styles.fileRoot}>
          <span>
            <ChevronDown aria-hidden />
            <FolderOpen aria-hidden />
            <strong>polymarket-trader</strong>
          </span>

          <div className={styles.fileFolder}>
            <span>
              <ChevronDown aria-hidden />
              <Folder aria-hidden />
              <strong>src</strong>
            </span>
            <div>
              {sourceFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={
                    selected.path === file.path
                      ? styles.fileSelected
                      : undefined
                  }
                  onClick={() => setSelectedPath(file.path)}
                  aria-pressed={selected.path === file.path}
                >
                  <FileCode2 aria-hidden />
                  {file.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.fileRootFiles}>
            {rootFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={
                  selected.path === file.path ? styles.fileSelected : undefined
                }
                onClick={() => setSelectedPath(file.path)}
                aria-pressed={selected.path === file.path}
              >
                <FileCode2 aria-hidden />
                {file.label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className={styles.filePreview} aria-live="polite">
        <header>
          <nav aria-label="Selected file path">
            <span>polymarket-trader</span>
            {selected.path.split("/").map((part) => (
              <span key={part}>{part}</span>
            ))}
          </nav>
          <small>{selected.language}</small>
        </header>
        <p>{selected.purpose}</p>
        <pre>
          {selected.source.map((line, index) => (
            <SourceLine
              key={`${selected.path}-${index}`}
              line={line}
              index={index}
            />
          ))}
        </pre>
      </section>
    </div>
  );
}
