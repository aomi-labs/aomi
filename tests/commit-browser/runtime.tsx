import { useSyncExternalStore } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CommitController } from "../../packages/client/src/commits";

export let controller: CommitController;
export function install(next: CommitController) {
  controller = next;
}
export function useAomiRuntime() {
  return {
    commitController: controller,
    commits: useSyncExternalStore(controller.subscribe, controller.all),
  };
}
export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(...inputs));
}
