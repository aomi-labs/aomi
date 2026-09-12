"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import styles from "./rest-api.module.css";

const tokenPattern =
  /(#[^\n]*|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|https?:\/\/[^\s\\]+|\b(?:import|from|const|for|await|of|if|return|true|false)\b|\b(?:app|wallet|type|text|action)\b(?=\s*:)|--?[A-Za-z]+|\b\d[\d,.]*\b)/g;

function tokenClass(token: string) {
  if (token.startsWith("#") || token.startsWith("//")) {
    return styles.codeComment;
  }
  if (/^["'`]/.test(token)) return styles.codeString;
  if (token.startsWith("http")) return styles.codeProperty;
  if (token.startsWith("-")) return styles.codeProperty;
  if (/^\d/.test(token)) return styles.codeNumber;
  if (["app", "wallet", "type", "text", "action"].includes(token)) {
    return styles.codeProperty;
  }
  return styles.codeKeyword;
}

function highlightedLine(line: string) {
  const parts = [];
  let cursor = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(line.slice(cursor, index));
    parts.push(
      <span key={`${index}-${match[0]}`} className={tokenClass(match[0])}>
        {match[0]}
      </span>,
    );
    cursor = index + match[0].length;
  }

  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

export function ClientExample({
  sdkExample,
  curlExample,
}: {
  sdkExample: string;
  curlExample: string;
}) {
  const [mode, setMode] = useState<"curl" | "ts">("curl");
  const [copied, setCopied] = useState(false);
  const value = mode === "curl" ? curlExample : sdkExample;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={styles.sdkCode}>
      <div className={styles.codeTopline}>
        <div className={styles.codeTabs} role="tablist" aria-label="Example">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "curl"}
            className={mode === "curl" ? styles.codeTabActive : ""}
            onClick={() => setMode("curl")}
          >
            curl
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "ts"}
            className={mode === "ts" ? styles.codeTabActive : ""}
            onClick={() => setMode("ts")}
          >
            TypeScript
          </button>
        </div>
        <span>{mode === "curl" ? "chat.aomi.dev" : "@aomi-labs/client"}</span>
      </div>
      <div className={styles.codeBody}>
        <button
          type="button"
          className={styles.codeCopy}
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </button>
        <pre key={mode}>
          <code>
            {value.split("\n").map((line, index) => (
              <span
                key={`${mode}-${index}`}
                className={`${styles.codeLine} ${index === (mode === "curl" ? 0 : 3) ? styles.codeLineFocus : ""}`}
              >
                {highlightedLine(line) || "\u00a0"}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
