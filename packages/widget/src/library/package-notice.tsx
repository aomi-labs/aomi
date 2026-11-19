"use client";
import type { AomiPackage } from "@aomi-labs/client";
import { ConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { StatusPill } from "@/ui/aomi/status-pill";
import { personSlots, walletLines } from "./model";

/**
 * Shown before a not verified package is first switched on, on this device,
 * for this envelope: what it may reach in plain words (D26). Verified packages
 * start on, so they never get it. Cancelling changes nothing.
 */
export function PackageNotice({
  row,
  onCancel,
  onConfirm,
}: {
  row: AomiPackage | null;
  onCancel: () => void;
  onConfirm: (row: AomiPackage) => void;
}) {
  const slots = row ? personSlots(row) : [];
  const required = slots.filter((slot) => slot.required).map((s) => s.name);
  const optional = slots
    .filter((slot) => !slot.required)
    .map((slot) => `${slot.name} · optional`);
  const lines = row
    ? [
        ...(row.envelope.hosts.length
          ? [`Talks to: ${row.envelope.hosts.join(", ")}`]
          : []),
        ...walletLines(row)
          .filter((line) => line.kind !== "guard")
          .map((line) => line.title),
        ...(required.length ? [`Needs your key: ${required.join(", ")}`] : []),
        ...(optional.length
          ? [`Add your own key: ${optional.join(", ")}`]
          : []),
      ]
    : [];
  return (
    <ConfirmDialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onConfirm={() => row && onConfirm(row)}
      title={row ? `Turn on ${row.display_name}?` : ""}
      description="Aomi has not verified this package."
      confirmLabel="Turn on"
    >
      {row ? (
        <div className="space-y-2">
          <StatusPill tone="neutral">Not verified</StatusPill>
          <ul className="type-control space-y-1">
            {lines.length ? (
              lines.map((line) => (
                <li key={line} className="[overflow-wrap:anywhere]">
                  {line}
                </li>
              ))
            ) : (
              <li>It reaches no outside service and asks for no approvals.</li>
            )}
          </ul>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
