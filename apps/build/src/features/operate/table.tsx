// Table primitives shared by the Operate surfaces: a titled card shell plus the
// header/cell class pair every Operate table uses.

export const TH = "px-3 py-2 text-left text-xs uppercase text-dim font-medium";
export const TD = "px-3 py-2";

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
    <div className="border-border bg-surface rounded-md border">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-dim text-xs font-medium uppercase">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
