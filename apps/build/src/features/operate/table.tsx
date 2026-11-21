// Table primitives shared by the Operate surfaces: a titled card shell plus the
// header/cell class pair every Operate table uses.

export const TH = "build-row-padding text-left text-[length:var(--aomi-caption)] font-medium";
export const TD = "build-row-padding";

export function Card({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-[var(--aomi-heading-gap)] flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="build-section-title">{title}</h2>
        {right}
      </div>
      <div className="border-border bg-surface overflow-hidden rounded-2xl border">{children}</div>
    </section>
  );
}
