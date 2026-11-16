"use client";
import type { AomiPackage } from "@aomi-labs/client";
import { ConfirmDialog } from "@/ui/aomi/confirm-dialog";
import { VerifiedPill } from "./library-detail-panel";
import { askLines, personSlots } from "./model";

/**
 * Shown before a package is first switched on, on this device, for this
 * envelope: what it may reach in plain words. Cancelling changes nothing.
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
  const keys = row ? personSlots(row).map((slot) => slot.name) : [];
  const lines = row
    ? [
        ...(row.envelope.hosts.length
          ? [`Talks to: ${row.envelope.hosts.join(", ")}`]
          : []),
        ...askLines(row.envelope).map((line) => `Can ask you to: ${line}`),
        ...(keys.length ? [`Needs your key: ${keys.join(", ")}`] : []),
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
      description={
        row?.verified
          ? "Aomi verified what this package can do."
          : "Aomi has not verified this package."
      }
      confirmLabel="Turn on"
    >
      {row ? (
        <div className="space-y-2">
          <VerifiedPill verified={row.verified} />
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
