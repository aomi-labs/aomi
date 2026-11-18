import { useEffect, useState } from "react";
import { aomiButton, PackageTile } from "@aomi-labs/widget/host-composition";

import { checkIcon } from "./icon-rule";
import { Card } from "./ui";

type Checked = { name: string; url: string } | { name: string; error: string };

/**
 * The package's icon as the Library draws it, and a check for a new one. The
 * icon ships in the repo (`[package] icon` in aomi.toml); this runs the
 * release check's icon rule before the builder commits it.
 */
export function IconCard({ iconUrl }: { iconUrl: string | null }) {
  const [checked, setChecked] = useState<Checked | null>(null);
  const preview = checked && "url" in checked ? checked.url : null;
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const check = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const error = checkIcon(file.name, bytes);
    setChecked(
      error
        ? { name: file.name, error }
        : {
            name: file.name,
            url: URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" })),
          },
    );
  };

  return (
    <Card
      title="Icon"
      origin="repo"
      footer="A square SVG drawn in currentColor, at most 32 KB. Without one the Library shows a package box."
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <PackageTile iconUrl={preview ?? iconUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13px]">
          <label className={`${aomiButton({ size: "sm" })} cursor-pointer self-start`}>
            Check an SVG icon
            <input
              type="file"
              accept=".svg,image/svg+xml"
              aria-label="SVG icon"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void check(file);
              }}
            />
          </label>
          {checked && "error" in checked ? (
            <span role="alert" className="text-aomi-danger">
              {checked.name}: {checked.error}
            </span>
          ) : checked ? (
            <span className="text-aomi-muted">
              {checked.name} passes. Commit it and set <code>icon</code> in aomi.toml.
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
