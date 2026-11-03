import {
  AgentApiError,
  isAomiError,
  type AgentAppAccessErrorCode,
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

/** What to tell the user when a message could not be sent. */
export function describeSendFailure(
  error: unknown,
  startUncertain: boolean,
): SendFailure {
  const apiError = error instanceof AgentApiError ? error : undefined;
  // The builder owes, not the user: topping up the user's own balance
  // wouldn't help, so this must not open the payment modal.
  if (isAomiError(error, "builder_debt"))
    return {
      notice: {
        type: "error",
        title: "App paused",
        message:
          "This App is temporarily unavailable because its builder needs to add funds. Your own balance isn't affected.",
      },
    };
  // Too many guest sign-ins from this network; the message was never sent.
  if (isAomiError(error, "guest_rate_limited")) {
    const seconds = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
    const wait =
      seconds === undefined
        ? "in a little while"
        : seconds < 120
          ? `in ${Math.max(1, seconds)} seconds`
          : `in about ${Math.ceil(seconds / 60)} minutes`;
    return {
      notice: {
        type: "error",
        title: "Too many requests",
        message: `Too many guest sessions were started from your network. Send your message again ${wait}.`,
      },
    };
  }
  // Only the user's own credit exhaustion opens the payment modal, whose
  // copy is its own; `kind` routes it. A code-less 402 is the same refusal
  // from an older server.
  if (getHttpStatus(error) === 402) {
    const code = isAomiError(error) ? error.code : undefined;
    if (!code || code === "payment_required")
      return {
        notice: {
          type: "error",
          kind: "payment_required",
          title: "You're out of funds",
        },
      };
    return {
      notice: {
        type: "error",
        title: "App unavailable",
        message:
          "This App can't answer messages right now. Your own balance isn't affected.",
      },
    };
  }
  if (apiError?.appAccessCode)
    return {
      notice: { type: "error", ...APP_ACCESS_NOTICES[apiError.appAccessCode] },
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
