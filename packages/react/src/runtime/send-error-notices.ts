import { AgentApiError, type AgentAppAccessErrorCode } from "@aomi-labs/client";
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
      "This App is private — it needs an App key. Ask the App's owner for one and configure it for this chat.",
  },
  app_key_not_scoped: {
    title: "App key not valid for this App",
    message:
      "The configured App key doesn't grant access to this App. Ask the App's owner for a key issued for it.",
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
  // The payment modal has its own copy; only `kind` routes it.
  if (getHttpStatus(error) === 402)
    return {
      notice: {
        type: "error",
        kind: "payment_required",
        title: "You're out of funds",
      },
    };
  const apiError = error instanceof AgentApiError ? error : undefined;
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
