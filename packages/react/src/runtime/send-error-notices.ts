import {
  AgentApiError,
  isAomiError,
  type AgentAppAccessErrorCode,
  type AomiApiError,
} from "@aomi-labs/client";
import type { NotificationData } from "../contexts/notification-context";
import { getHttpStatus } from "./http-status";

/**
 * Copy for App access failures. These say nothing about the conversation, so
 * the persisted thread stays pinned; changing the App or its key fixes them.
 */
const APP_ACCESS_NOTICES: Record<
  AgentAppAccessErrorCode,
  { title: string; message: string }
> = {
  app_not_found: {
    title: "App not found",
    message:
      "This App doesn't exist or is no longer available. Check the App name or ID configured for this chat.",
  },
  app_inactive: {
    title: "App not active",
    message:
      "This App isn't active yet. Its owner needs to deploy and activate it before it can answer messages.",
  },
  app_key_required: {
    title: "App key required",
    message:
      "This App is private — it needs an App key. Enter the key its builder shared with you, then send your message again.",
  },
  app_key_not_scoped: {
    title: "App key not valid for this App",
    message:
      "The configured App key doesn't grant access to this App. Its builder may have regenerated it; ask them for the current key.",
  },
};

export type SendFailure = {
  notice: NotificationData;
  /** The chat is gone for this user; stop reopening it on load. */
  forgetThread?: boolean;
};

/**
 * What to tell the user when a message could not be sent. `directApp` says
 * the chat names one App, so a refusal there is about that App.
 */
export function describeSendFailure(
  error: unknown,
  startUncertain: boolean,
  directApp = false,
): SendFailure {
  const apiError = error instanceof AgentApiError ? error : undefined;
  const status = getHttpStatus(error);
  // The builder owes, not the user: topping up the user's own balance
  // wouldn't help, so this must not open the payment modal.
  if (apiError?.code === "builder_debt")
    return {
      notice: {
        type: "error",
        title: "App paused",
        message:
          "This App's builder needs to add funds before it can answer messages. Your own balance isn't affected.",
      },
    };
  // The payment modal has its own copy; only `kind` routes it.
  if (status === 402)
    return {
      notice: {
        type: "error",
        kind: "payment_required",
        title: "You're out of funds",
      },
    };
  if (apiError?.appAccessCode)
    return {
      notice: { type: "error", ...APP_ACCESS_NOTICES[apiError.appAccessCode] },
    };
  if (apiError?.code === "app_loading")
    return {
      notice: {
        type: "error",
        title: "App starting",
        message:
          "This App is still loading on the server. Send your message again in a few seconds.",
      },
    };
  // A wrong App ID reaches the backend as a generic refusal.
  if (
    directApp &&
    apiError &&
    (status === 403 ||
      (status === 404 && apiError.code !== "session_not_found"))
  )
    return {
      notice: {
        type: "error",
        title: "App not available",
        message:
          "This App ID isn't available. Check the applicationId configured for this chat.",
      },
    };
  if (apiError?.code === "session_not_found")
    return {
      forgetThread: true,
      notice: {
        type: "error",
        title: "Conversation unavailable",
        message:
          "This conversation is no longer accessible. Start a new chat and send your message again.",
      },
    };
  if (apiError?.code === "execution_conflict")
    return {
      notice: {
        type: "error",
        title: "Account busy",
        message:
          "Another operation is still running. Your message is in the composer; send it when that operation finishes.",
      },
    };
  if (startUncertain)
    return {
      notice: {
        type: "error",
        title: "Unable to confirm message",
        message: `${error instanceof Error ? error.message : "The start response was unavailable"}. The request may have been accepted. Use Stop to check and stop it.`,
      },
    };
  if (status === 429) {
    // Guest sign-in carries the server's Retry-After in its details.
    const details = isAomiError(error)
      ? ((error as AomiApiError).details as { retryAfter?: unknown } | null)
      : undefined;
    const seconds = Number(details?.retryAfter);
    return {
      notice: {
        type: "error",
        title: "Too many requests",
        message: `${seconds > 0 ? `Wait ${seconds} ${seconds === 1 ? "second" : "seconds"}` : "Wait a moment"}, then send your message again.`,
      },
    };
  }
  return {
    notice: {
      type: "error",
      title: "Message not sent",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong sending your message. Please try again.",
    },
  };
}
