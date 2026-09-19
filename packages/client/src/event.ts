// =============================================================================
// Typed EventEmitter (browser-safe, no Node.js deps)
// =============================================================================

type Listener<T = unknown> = (payload: T) => void;

/**
 * Minimal typed event emitter with wildcard support.
 *
 * ```ts
 * type Events = { message: string; error: { code: number } };
 * const ee = new TypedEventEmitter<Events>();
 * ee.on("message", (msg) => console.log(msg));
 * ee.emit("message", "hello");
 * ```
 */
export class TypedEventEmitter<
  EventMap extends Record<string, unknown> = Record<string, unknown>,
> {
  private listeners = new Map<string, Set<Listener<never>>>();

  on<K extends keyof EventMap & string>(
    type: K,
    handler: Listener<EventMap[K]>,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler as Listener<never>);

    return () => {
      set!.delete(handler as Listener<never>);
      if (set!.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  once<K extends keyof EventMap & string>(
    type: K,
    handler: Listener<EventMap[K]>,
  ): () => void {
    const wrapper = ((payload: EventMap[K]) => {
      unsub();
      handler(payload);
    }) as Listener<EventMap[K]>;

    const unsub = this.on(type, wrapper);
    return unsub;
  }

  emit<K extends keyof EventMap & string>(type: K, payload: EventMap[K]): void {
    const typeSet = this.listeners.get(type);
    if (typeSet) {
      for (const handler of typeSet) {
        (handler as Listener<EventMap[K]>)(payload);
      }
    }

    if (type !== "*") {
      const wildcardSet = this.listeners.get("*");
      if (wildcardSet) {
        for (const handler of wildcardSet) {
          (handler as Listener<unknown>)({ type, payload });
        }
      }
    }
  }

  off<K extends keyof EventMap & string>(
    type: K,
    handler: Listener<EventMap[K]>,
  ): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(handler as Listener<never>);
      if (set.size === 0) {
        this.listeners.delete(type);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
