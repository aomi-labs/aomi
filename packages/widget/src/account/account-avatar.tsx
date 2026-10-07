import { UserRound } from "lucide-react";

export interface AccountAvatarProps {
  seed?: string;
  size?: number;
  className?: string;
}

// Ten hues tuned to read on both the light and the dark surface-2 slot.
const HUES = [
  "#4f8fdc",
  "#7b6ce0",
  "#c264c9",
  "#e0699a",
  "#e8735a",
  "#e39b34",
  "#b9b23a",
  "#5fb35c",
  "#2fa597",
  "#3aa6c9",
];
const CELL = 6.4;
const GAP = 1.9;
const ORIGIN = 20 - (3 * CELL + 2 * GAP) / 2;

function hash(seed: string): number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  }
  // FNV-1a's low bits are weak; finish with murmur3's avalanche.
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * A mirrored 3x3 pattern of rounded tiles in one hue with one accent tile or pair,
 * derived from the account id. It is the account's identity, independent of
 * its wallets, providers, or display name.
 */
export function AccountAvatar({
  seed,
  size = 28,
  className = "",
}: AccountAvatarProps) {
  if (!seed) {
    return (
      <span
        className={`bg-aomi-surface-2 text-aomi-muted inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <UserRound size={size / 2} />
      </span>
    );
  }

  const value = hash(seed);
  // Mix each draw so similar ids do not produce similar patterns.
  const draw = (index: number) => hash(`${value}:${index}`);
  const hue = draw(9) % HUES.length;
  const base = HUES[hue];
  const accent = HUES[(hue + 1 + (draw(0) % 3)) % HUES.length];
  // The accent lands on one middle tile or one mirrored side pair.
  const accentSlot = draw(1) % 6;
  const accentRow = accentSlot % 3;
  const accentOnSide = accentSlot >= 3;

  // Columns 0 and 2 mirror each other.
  const sides = [0, 1, 2].map(
    (row) => (accentOnSide && row === accentRow) || draw(row + 2) % 8 > 2,
  );
  const middle = [0, 1, 2].map(
    (row) => (!accentOnSide && row === accentRow) || draw(row + 5) % 8 > 2,
  );
  if (!sides.some(Boolean)) sides[draw(8) % 3] = true;
  const fill = (side: boolean, row: number) =>
    side === accentOnSide && row === accentRow ? accent : base;

  const tile = (column: number, row: number, fill: string) => (
    <rect
      key={`${column}-${row}`}
      x={ORIGIN + column * (CELL + GAP)}
      y={ORIGIN + row * (CELL + GAP)}
      width={CELL}
      height={CELL}
      rx={2}
      fill={fill}
    />
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-account-avatar=""
      className={`shrink-0 rounded-full ${className}`}
    >
      <circle cx="20" cy="20" r="20" fill="var(--aomi-surface-2, #f4f4f5)" />
      {sides.flatMap((on, row) =>
        on
          ? [tile(0, row, fill(true, row)), tile(2, row, fill(true, row))]
          : [],
      )}
      {middle.map((on, row) => (on ? tile(1, row, fill(false, row)) : null))}
    </svg>
  );
}
