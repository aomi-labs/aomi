export type ChatViewState = {
  draft?: string;
  mentions?: readonly unknown[];
  scroll?: { top: number; atBottom: boolean };
  flags?: Readonly<Record<string, boolean>>;
};

/** Private, bounded UI state. It never contains session or signing state. */
export function createChatViewStore(limit = 20) {
  let version = 0;
  const entries = new Map<string, ChatViewState>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    version: () => version,
    get(threadId: string) {
      return entries.get(threadId);
    },
    patch(threadId: string, patch: Partial<ChatViewState>) {
      const previous = entries.get(threadId);
      entries.delete(threadId);
      entries.set(threadId, { ...previous, ...patch });
      while (entries.size > Math.max(1, limit)) {
        entries.delete(entries.keys().next().value!);
      }
      notify();
    },
    touch(threadId: string) {
      const entry = entries.get(threadId);
      if (!entry) return;
      entries.delete(threadId);
      entries.set(threadId, entry);
    },
    setFlag(threadId: string, key: string, value: boolean) {
      if (entries.get(threadId)?.flags?.[key] === value) return;
      this.patch(threadId, {
        flags: { ...entries.get(threadId)?.flags, [key]: value },
      });
    },
    delete(threadId: string) {
      if (entries.delete(threadId)) notify();
    },
    clear() {
      version++;
      entries.clear();
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type ChatViewStore = ReturnType<typeof createChatViewStore>;
