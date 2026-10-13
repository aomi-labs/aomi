import { useEffect, useState } from "react";

import { establishTelegramLaunch, type LaunchContext } from "@/lib/telegram";

type LaunchState =
  | { status: "loading"; context: null; error: null }
  | { status: "ready"; context: LaunchContext; error: null }
  | { status: "error"; context: null; error: string };

export function useTelegramLaunch(): LaunchState {
  const [state, setState] = useState<LaunchState>({
    status: "loading",
    context: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    void establishTelegramLaunch()
      .then((context) => {
        if (active) setState({ status: "ready", context, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          context: null,
          error:
            error instanceof Error ? error.message : "invalid_telegram_launch",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
