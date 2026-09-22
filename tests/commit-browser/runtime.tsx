import { useSyncExternalStore } from "react";
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
