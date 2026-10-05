import {
  AgentApiError,
  type AgentAppAccessErrorCode,
} from "../agent/transport";

/** CLI fix for each App access failure the public API reports. */
export const APP_ACCESS_CLI_HINTS: Record<AgentAppAccessErrorCode, string> = {
  app_not_found: "App not found. Check the --app or --application-id value.",
  app_inactive:
    "This App isn't active yet. Its owner must deploy and activate it before it can be used.",
  app_key_required:
    "This App is private and needs an App key. Ask the App owner for one, then pass --api-key <key> or set AOMI_API_KEY.",
  app_key_not_scoped:
    "This App key doesn't grant access to this App. Ask the App owner for a key issued for it and pass it with --api-key.",
};

export function mapDeployHttpError(
  status: number,
  message: string,
): DeployCliError {
  if (status === 401 || status === 403) {
    return new DeployCliError("AUTH_FAILED", message);
  }
  return new DeployCliError("BACKEND_ERROR", message);
}

export class CliExit extends Error {
  constructor(public code: number) {
    super();
  }
}

export type DeployCliErrorCode =
  | "AUTH_FAILED"
  | "AUTH_TIMEOUT"
  | "BACKEND_ERROR"
  | "NOT_A_GIT_REPO"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR";

export class DeployCliError extends Error {
  readonly errorCode: DeployCliErrorCode;

  constructor(errorCode: DeployCliErrorCode, message: string) {
    super(message);
    this.name = "DeployCliError";
    this.errorCode = errorCode;
  }

  /**
   * Map a failed backend response. App access codes get their specific fix;
   * any other 401/403 means the login session lapsed.
   */
  static fromHttpFailure(
    response: { status: number; statusText: string },
    bodyText: string,
  ): DeployCliError {
    let body: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON bodies (proxy HTML, empty) fall back to the HTTP status.
    }
    const error = body?.error;
    const detail =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : undefined;
    const code = typeof error === "string" ? error : detail?.code;
    const appAccessCode = AgentApiError.APP_ACCESS_CODES.find(
      (known) => known === code,
    );
    if (appAccessCode) {
      return new DeployCliError(
        "AUTH_FAILED",
        APP_ACCESS_CLI_HINTS[appAccessCode],
      );
    }
    if (response.status === 401 || response.status === 403) {
      return new DeployCliError(
        "AUTH_FAILED",
        "Session expired; run `aomi account login`",
      );
    }
    const message = [error, detail?.message, body?.reason].find(
      (value): value is string => typeof value === "string" && value !== "",
    );
    return new DeployCliError(
      "BACKEND_ERROR",
      message ?? `${response.status} ${response.statusText}`,
    );
  }
}

export function fatal(message: string): never {
  const RED = "\x1b[31m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  const lines = message.split("\n");
  const [headline, ...details] = lines;
  console.error(`${RED}❌ ${headline}${RESET}`);
  for (const detail of details) {
    if (!detail.trim()) {
      console.error("");
      continue;
    }
    console.error(`${DIM}${detail}${RESET}`);
  }

  if (process.env.AOMI_CLI_STRICT_EXIT === "1") {
    throw new CliExit(1);
  }
  process.exit(1);
}
