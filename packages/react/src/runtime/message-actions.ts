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
    options?: SendOptions,
    restoreText = text,
  ) => {
    try {
      await send(text, options);
    } catch {
      if (options?.edit) unavailable("Couldn't edit the message. Try again.");
      else if (options?.regenerate)
        unavailable("Couldn't rerun the response. Try again.");
      else restore(restoreText);
    }
  };
  return {
    onNew: async (message: AppendMessage) => {
      const text = textContent(message.content);
      if (text.trim())
        await submit(
          appendCapabilityHints(
            text,
            message.runConfig?.custom?.aomiCapabilityHints,
          ),
          undefined,
          text,
        );
    },
    onEdit: async (message: AppendMessage) => {
      const original = messages.find(
        (candidate) => candidate.id === message.sourceId,
      );
      if (!original || original.role !== "user") {
        unavailable("The selected message is no longer available");
        return;
      }
      const revised = textContent(message.content);
      if (!revised.trim()) return;
      const target = original.metadata?.custom?.aomiUserMessageKey;
      if (typeof target !== "string" || !target) {
        unavailable("Only a saved user message can be edited");
        return;
      }
      const hints = message.runConfig?.custom?.aomiCapabilityHints ?? {
        capabilities: original.metadata?.custom?.aomiCapabilityHints,
      };
      await submit(
        appendCapabilityHints(revised, hints),
        { edit: target },
        revised,
      );
    },
    onReload: async (parentId: string | null) => {
      const parentIndex =
        parentId === null
          ? -1
          : messages.findIndex((message) => message.id === parentId);
      if (parentId !== null && parentIndex < 0) {
        unavailable("The selected response is no longer available");
        return;
      }
      const answer = messages[parentIndex + 1];
      const target = answer?.metadata?.custom?.aomiResponseMessageKey;
      if (
        answer?.role !== "assistant" ||
        typeof target !== "string" ||
        !target
      ) {
        unavailable("Only a completed answer can be rerun");
        return;
      }
      const request = messages
        .slice(0, parentIndex + 1)
        .findLast((message) => message.role === "user");
      if (!request) {
        unavailable("The original request is no longer available");
        return;
      }
      await submit(textContent(request.content), { regenerate: target });
    },
  };
}
