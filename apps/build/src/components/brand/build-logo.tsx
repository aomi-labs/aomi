import { AomiLogo } from "@aomi-labs/widget/host-composition";

/** The wordmark with the BUILD chip, as the Portal's product switcher draws it. */
export function BuildLogo() {
  return (
    <span className="flex items-center gap-2">
      <AomiLogo className="text-[17px]" />
      <span className="bg-aomi-surface-2 text-aomi-muted flex h-[17px] items-center rounded-sm px-1.5 text-[10px] font-medium uppercase leading-none tracking-wide">
        Build
      </span>
    </span>
  );
}
