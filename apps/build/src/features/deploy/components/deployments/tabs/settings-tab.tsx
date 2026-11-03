import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { deleteProject } from "@/features/deploy/client";
import { buildQueryKeys } from "@/features/deploy/query-keys";
import { useProjectDetail } from "@/features/deploy/hooks/use-project-detail";
import { projectSdk } from "../sdk-compatibility";
import { SdkBadge } from "../ui/sdk-badge";
import { EmptyPanel } from "../ui/state-panels";

type Detail = ReturnType<typeof useProjectDetail>;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 px-4 py-3">
      <dt className="text-dim">{label}</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  );
}

export function SettingsTab({ detail }: { detail: Detail }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const queries = useQueryClient();
  const source = detail.source;
  if (!source) {
    return <EmptyPanel>Project not found.</EmptyPanel>;
  }
  const required = detail.sdk?.sdkStatus.requiredVersion ?? null;
  const sdk = projectSdk(source, required);

  const name = source.repositoryLink?.split("/").pop() || String(source.id);
  async function remove() {
    if (!source || confirmation !== name || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProject(source.id);
      await queries.cancelQueries({ queryKey: buildQueryKeys.all });
      queries.removeQueries({ queryKey: buildQueryKeys.all });
      await router.navigate({
        to: "/projects",
        search: { platform: source.platformName },
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete project.",
      );
      setDeleting(false);
    }
  }

  return (
    <div className="text-sm">
      <dl className="divide-border divide-y">
        <Row label="Repository" value={source.repositoryLink ?? "-"} />
        <Row label="Project ID" value={`#${source.id}`} />
        <Row label="Installation" value={String(source.installationId)} />
      </dl>
      <div className="border-border flex items-center justify-between border-t px-4 py-3">
        <div>
          <div className="font-medium">SDK compatibility</div>
          <div className="text-dim mt-1 text-xs">
            Backend requires {required ?? "unknown"}
            {sdk.warning ? ` · ${sdk.warning}` : ""}
          </div>
        </div>
        <SdkBadge sdk={sdk} />
      </div>
      <div className="border-border border-t px-4 py-4">
        <div className="text-foreground text-sm font-medium">
          Project management
        </div>
        <p className="text-dim mt-1 text-xs leading-5">
          Transfer management of this project and its connected bots to your
          account. You must be a GitHub repository administrator.
        </p>
        <a
          href={`/api/build/auth/github/claim?projectId=${source.id}`}
          className="border-border text-foreground hover:bg-muted mt-3 inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium"
        >
          Transfer management to me
        </a>
      </div>
      <div className="border-border border-t px-4 py-4">
        <div className="text-foreground text-sm font-medium">Danger zone</div>
        <p className="text-dim mt-1 text-xs">
          Permanently delete this project, its Apps, deployments, and stored
          secrets from this environment. Your GitHub repository stays intact.
        </p>
        <Dialog.Root
          open={open}
          onOpenChange={(value) => {
            if (deleting) return;
            setOpen(value);
            setConfirmation("");
            setError(null);
          }}
        >
          <Dialog.Trigger className="mt-3 rounded-md border border-red-500 px-3 py-2 text-red-600">
            Delete project
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <Dialog.Content className="border-border bg-background text-foreground fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-lg">
              <Dialog.Title className="text-lg font-medium">
                Delete {name}?
              </Dialog.Title>
              <Dialog.Description className="text-dim mt-3 text-sm">
                This permanently removes the project and its Apps, deployments,
                and stored secrets from this environment. Your GitHub repository
                stays intact. This cannot be undone.
              </Dialog.Description>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void remove();
                }}
              >
                <label
                  className="mt-4 block text-sm"
                  htmlFor="delete-project-confirmation"
                >
                  Type {name} to confirm
                </label>
                <input
                  id="delete-project-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={deleting}
                  autoComplete="off"
                  className="border-border mt-2 w-full rounded-md border p-2"
                />
                {error && (
                  <p role="alert" className="mt-3 text-red-600">
                    {error}
                  </p>
                )}
                <div className="mt-5 flex justify-end gap-3">
                  <Dialog.Close
                    type="button"
                    disabled={deleting}
                    className="border-border rounded-md border px-3 py-2"
                  >
                    Cancel
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={confirmation !== name || deleting}
                    className="rounded-md bg-red-600 px-3 py-2 text-white disabled:opacity-40"
                  >
                    {deleting ? "Deleting…" : "Delete project"}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}
