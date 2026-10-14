import { readFileSync } from "node:fs";

function withoutTrailingLineBreak(value: string): string {
  return value.replace(/\r?\n$/, "");
}

/** Read one secret without echoing it or accepting it on the command line. */
export async function readSecretInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const value = withoutTrailingLineBreak(readFileSync(0, "utf8"));
    if (!value) throw new Error("Credential value cannot be empty.");
    return value;
  }

  process.stderr.write(prompt);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else if (!value) reject(new Error("Credential value cannot be empty."));
      else resolve(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Credential entry cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    stdin.on("data", onData);
  });
}
