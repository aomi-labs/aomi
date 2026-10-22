import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { SendOptions } from "@aomi-labs/client";
import { appendCapabilityHints } from "./capability-hints";

function textContent(content: ThreadMessageLike["content"]): string {
  return typeof content === "string"
    ? content
    : content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}

/** Composer paths share hint encoding and raw-draft recovery. */
export async function submitComposerMessage(
  message: Pick<ThreadMessageLike, "content"> & Pick<AppendMessage, "runConfig">,
  send: (text: string) => Promise<void>,
  restore: (text: string) => void,
): Promise<void> {
  const text = textContent(message.content);
  if (!text.trim()) return;
  try {
    await send(
      appendCapabilityHints(
        text,
        message.runConfig?.custom?.aomiCapabilityHints,
      ),
    );
  } catch (error) {
    restore(text);
    throw error;
  }
}

/** Edit and Rerun replace the conversation from a durable message, as in a
 * linear chat; the server runs the replacement as a normal turn. */
export function messageActions({
  messages,
  send,
  restore,
  unavailable,
}: {
  messages: readonly ThreadMessageLike[];
  send: (text: string, options?: SendOptions) => Promise<void>;
  restore: (text: string) => void;
  unavailable: (message: string) => void;
}) {
  const submit = async (
    text: string,
    options: SendOptions | undefined,
    onFailure: () => void,
  ) => {
    try {
      await send(text, options);
    } catch {
      onFailure();
    }
  };
  /** Replace the conversation from a user message with `text`. */
  const replace = async (
    request: ThreadMessageLike | undefined,
    text: string,
    capabilities: unknown,
    failure: string,
  ) => {
    const target = request?.metadata?.custom?.aomiUserMessageKey;
    if (request?.role !== "user" || typeof target !== "string" || !target) {
      unavailable("Only a saved request can be edited or rerun");
      return;
    }
    await submit(
      appendCapabilityHints(text, capabilities),
      { edit: target },
      () => unavailable(failure),
    );
  };
  return {
    onNew: async (message: AppendMessage) => {
      // The orchestrator already reports the error; native callbacks consume it.
      await submitComposerMessage(message, send, restore).catch(() => {});
    },
    onEdit: async (message: AppendMessage) => {
      const original = messages.find(
        (candidate) => candidate.id === message.sourceId,
      );
      const revised = textContent(message.content);
      if (!revised.trim()) return;
      await replace(
        original,
        revised,
        message.runConfig?.custom?.aomiCapabilityHints ?? {
          capabilities: original?.metadata?.custom?.aomiCapabilityHints,
        },
        "Couldn't edit the message. Try again.",
      );
    },
    // Rerun resends the request before the answer, replacing that answer and
    // everything after it. This also works for failed or stopped answers.
    onReload: async (parentId: string | null) => {
      const parentIndex =
        parentId === null
          ? -1
          : messages.findIndex((message) => message.id === parentId);
      const request = messages
        .slice(0, parentIndex + 1)
        .findLast((message) => message.role === "user");
      await replace(
        request,
        request ? textContent(request.content) : "",
        { capabilities: request?.metadata?.custom?.aomiCapabilityHints },
        "Couldn't rerun the response. Try again.",
      );
    },
  };
}
