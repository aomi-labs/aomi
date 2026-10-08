import { UserRound } from "lucide-react";

export interface AccountAvatarProps {
  seed?: string;
  size?: number;
  className?: string;
}

// Ten deep hues, so white tiles read on every one in both themes.
const HUES = [
  "#3b7ddd",
  "#6a5ae0",
  "#a855c8",
  "#d9548a",
  "#e0603f",
  "#d98a1c",
  "#7a9a2a",
  "#3f9f5a",
  "#1f9a8c",
  "#2a93bf",
];
// Mirrored 3x3 patterns as [side rows, middle rows] bitmasks (bit n = row n).
// Each has 7-9 tiles and no empty top or bottom row, so every avatar looks
// full and centred.
const PATTERNS: ReadonlyArray<readonly [number, number]> = [
  [3, 7],
  [5, 7],
  [6, 7],
  [7, 1],
  [7, 2],
  [7, 3],
  [7, 4],
  [7, 5],
  [7, 6],
  [7, 7],
];
const CELL = 6.4;
const GAP = 1.9;
const ORIGIN = 20 - (3 * CELL + 2 * GAP) / 2;
const ROWS = [0, 1, 2];

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
 * A rounded square in one hue with a mirrored 3x3 pattern of white tiles,
 * one tile or mirrored pair dimmed, derived from the account id. It is the
 * account's identity, independent of its wallets, providers, or display name,
 * and owns its own shape so every surface draws it the same way.
 */
export function AccountAvatar({
  seed,
  size = 28,
  className = "",
}: AccountAvatarProps) {
  const radius = Math.round(size / 4);
  if (!seed) {
    return (
      <span
        className={`bg-aomi-surface-2 text-aomi-muted inline-flex shrink-0 items-center justify-center ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
        aria-hidden="true"
      >
        <UserRound size={size / 2} />
      </span>
    );
  }

  const value = hash(seed);
  // Mix each draw so similar ids do not produce similar patterns.
  const draw = (index: number) => hash(`${value}:${index}`);
  const [sideMask, middleMask] = PATTERNS[draw(0) % PATTERNS.length];
  const sides = ROWS.filter((row) => sideMask & (1 << row));
  const middle = ROWS.filter((row) => middleMask & (1 << row));
  // The dimmed tile is one filled middle tile or one filled side pair.
  const dimmed = [
    ...middle.map((row) => `1-${row}`),
    ...sides.map((row) => `0-${row}`),
  ][draw(1) % (middle.length + sides.length)];

  const tile = (column: number, row: number) => (
    <rect
      key={`${column}-${row}`}
      x={ORIGIN + column * (CELL + GAP)}
      y={ORIGIN + row * (CELL + GAP)}
      width={CELL}
      height={CELL}
      rx={2}
      fill="#fff"
      fillOpacity={dimmed === `${column === 1 ? 1 : 0}-${row}` ? 0.5 : 1}
      data-avatar-tile=""
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
      className={`shrink-0 ${className}`}
    >
      <rect
        width="40"
        height="40"
        rx="10"
        fill={HUES[draw(2) % HUES.length]}
        data-avatar-ground=""
      />
      {sides.flatMap((row) => [tile(0, row), tile(2, row)])}
      {middle.map((row) => tile(1, row))}
    </svg>
  );
}
