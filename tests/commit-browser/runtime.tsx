import { useSyncExternalStore } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  CommitController,
  CommitCapabilities,
} from "../../packages/client/src/commits";

export let controller: CommitController;
export let capabilities: CommitCapabilities = {};
export function install(next: CommitController, wallet: CommitCapabilities) {
  controller = next;
  capabilities = wallet;
}
export function useAomiRuntime() {
  return {
    commitController: controller,
    commits: useSyncExternalStore(controller.subscribe, controller.all),
  };
}
export function useCommitCapabilities() {
  return capabilities;
}
export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(...inputs));
}
