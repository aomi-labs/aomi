import type { ReactNode } from "react";

/**
 * Ported from the aomi-design explainer
 * `communication/info/x402-deferred-credit-gate.html`. The original drew both
 * figures imperatively into empty <svg> nodes on load; the geometry here is the
 * same, emitted as JSX so the charts server-render.
 */

const MONO = "var(--landing-mono)";

const C = {
  bg: "#ffffff",
  ink: "#09090b",
  muted: "#52525b",
  subtle: "#71717a",
  grid: "#e4e4e7",
  gate: "#d9982b",
  gateInk: "#8a6316",
  gateFill: "#fdf6e7",
  green: "#2e9e6b",
  greenInk: "#1f7a51",
  red: "#d2495b",
  redInk: "#b8394a",
  blue: "#416cac",
} as const;

type Point = {
  turn: number;
  bal: number;
  kind: "start" | "pass" | "serve" | "reject";
  cap: boolean;
};

const points: Point[] = [
  { turn: 0, bal: 1, kind: "start", cap: false },
  { turn: 1, bal: -4, kind: "pass", cap: true },
  { turn: 2, bal: -9, kind: "serve", cap: false },
  { turn: 3, bal: -14, kind: "serve", cap: false },
  { turn: 4, bal: -14, kind: "reject", cap: true },
];

const TOPUP_BAL = 6;

const W = 1000;
const H = 390;
const L = 70;
const R = 40;
const T = 44;
const B = 70;
const pw = W - L - R;
const ph = H - T - B;
const vMax = 7;
const vMin = -18;

const x = (t: number) => L + (t / 4) * pw;
const y = (v: number) => T + ((vMax - v) / (vMax - vMin)) * ph;
const y0 = y(0);

const kindColour: Record<Point["kind"], string> = {
  start: C.subtle,
  pass: C.green,
  serve: C.subtle,
  reject: C.red,
};

function gateGlyph(cx: number, state: "open" | "closed"): ReactNode {
  const c = state === "open" ? C.green : C.red;
  const ink = state === "open" ? C.greenInk : C.redInk;

  if (state === "open") {
    return (
      <g key={`gate-${cx}`}>
        <circle
          cx={cx}
          cy={y0}
          r={4.5}
          fill={c}
          stroke={C.bg}
          strokeWidth={1.5}
        />
        <line
          x1={cx}
          y1={y0}
          x2={cx - 28}
          y2={y0 - 30}
          stroke={c}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <circle cx={cx - 28} cy={y0 - 30} r={3} fill={c} />
        <line
          x1={cx}
          y1={y0}
          x2={cx - 42}
          y2={y0}
          stroke={c}
          strokeWidth={1}
          strokeDasharray="2 4"
          opacity={0.45}
        />
        <text
          x={cx - 28}
          y={y0 - 40}
          textAnchor="middle"
          fill={ink}
          fontSize={11}
          fontWeight={700}
          fontFamily={MONO}
        >
          GATE OPEN
        </text>
      </g>
    );
  }

  const ax = cx - 54;
  return (
    <g key={`gate-${cx}`}>
      <line
        x1={cx}
        y1={y0}
        x2={ax}
        y2={y0}
        stroke={c}
        strokeWidth={5}
        strokeLinecap="round"
      />
      {[1, 2, 3, 4].map((i) => {
        const hx = cx - 11 * i;
        return (
          <line
            key={i}
            x1={hx}
            y1={y0 - 4}
            x2={hx - 6}
            y2={y0 + 4}
            stroke={C.bg}
            strokeWidth={1.6}
          />
        );
      })}
      <circle cx={ax} cy={y0} r={3} fill={c} />
      <circle
        cx={cx}
        cy={y0}
        r={4.5}
        fill={c}
        stroke={C.bg}
        strokeWidth={1.5}
      />
      <text
        x={cx - 6}
        y={y0 - 12}
        textAnchor="end"
        fill={ink}
        fontSize={11}
        fontWeight={700}
        fontFamily={MONO}
      >
        GATE SHUT · 402
      </text>
    </g>
  );
}

export function BalanceTimeline() {
  const balancePath = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.turn)} ${y(p.bal)} `)
    .join("");

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Balance timeline with pay gate. The balance runs negative across turns two and three, and the gate rejects at turn four until a top-up lifts it back above zero."
    >
      <defs>
        <marker
          id="prArrowHead"
          markerWidth={9}
          markerHeight={9}
          refX={4.5}
          refY={4.5}
          orient="auto"
        >
          <path d="M0 0 L9 4.5 L0 9 z" fill={C.blue} />
        </marker>
      </defs>

      {/* credit zone below the gate */}
      <rect
        x={L}
        y={y0}
        width={pw}
        height={y(vMin) - y0}
        fill={C.red}
        fillOpacity={0.05}
      />
      <text
        x={L + 8}
        y={y(vMin) - 12}
        textAnchor="start"
        fill={C.redInk}
        fontSize={11.5}
        fontFamily={MONO}
        opacity={0.9}
      >
        ▽ credit zone — turns served on IOU while below the gate
      </text>

      {/* negative grid lines */}
      {[-4, -9, -14].map((v) => (
        <g key={v}>
          <line
            x1={L}
            y1={y(v)}
            x2={W - R}
            y2={y(v)}
            stroke={C.grid}
            strokeWidth={1}
            strokeDasharray="3 5"
          />
          <text
            x={L - 12}
            y={y(v) + 4}
            textAnchor="end"
            fill={C.muted}
            fontSize={12}
            fontFamily={MONO}
          >
            {v}
          </text>
        </g>
      ))}

      {/* the pay gate rail at balance = 0 */}
      <line x1={L} y1={y0} x2={W - R} y2={y0} stroke={C.gate} strokeWidth={3} />
      {Array.from(
        { length: Math.floor((W - R - 6 - (L + 6)) / 22) + 1 },
        (_, i) => {
          const gx = L + 6 + i * 22;
          return (
            <line
              key={gx}
              x1={gx}
              y1={y0 - 3.5}
              x2={gx}
              y2={y0 + 3.5}
              stroke={C.gate}
              strokeWidth={1}
              opacity={0.5}
            />
          );
        },
      )}
      <text
        x={L - 12}
        y={y0 + 4}
        textAnchor="end"
        fill={C.gateInk}
        fontSize={12}
        fontWeight={700}
        fontFamily={MONO}
      >
        0
      </text>
      <rect
        x={632 - 123}
        y={y0 - 11}
        width={246}
        height={22}
        rx={11}
        fill={C.gateFill}
        stroke={C.gate}
        strokeWidth={1}
      />
      <text
        x={632}
        y={y0 + 4}
        textAnchor="middle"
        fill={C.gateInk}
        fontSize={11.5}
        fontWeight={700}
        fontFamily={MONO}
      >
        PAY GATE — clears if balance ≥ 0
      </text>

      {/* balance trajectory */}
      <path
        d={balancePath}
        fill="none"
        stroke={C.blue}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <line
        x1={x(4)}
        y1={y(-14)}
        x2={x(4)}
        y2={y(TOPUP_BAL)}
        stroke={C.blue}
        strokeWidth={2.5}
        strokeDasharray="2 6"
        strokeLinecap="round"
        markerEnd="url(#prArrowHead)"
      />
      <line
        x1={x(1)}
        y1={y0}
        x2={x(1)}
        y2={y(-4)}
        stroke={C.green}
        strokeWidth={1}
        strokeDasharray="2 4"
        opacity={0.55}
      />

      {/* nodes */}
      {points.map((p) => {
        const c = kindColour[p.kind];
        const above = p.kind === "start";
        return (
          <g key={p.turn}>
            {p.cap ? (
              <circle
                cx={x(p.turn)}
                cy={y(p.bal)}
                r={11}
                fill="none"
                stroke={c}
                strokeWidth={1.5}
                strokeDasharray="2 3"
              />
            ) : null}
            <circle
              cx={x(p.turn)}
              cy={y(p.bal)}
              r={6}
              fill={c}
              stroke={C.bg}
              strokeWidth={2}
            />
            <text
              x={x(p.turn)}
              y={y(p.bal) + (above ? -16 : 24)}
              textAnchor="middle"
              fill={C.ink}
              fontSize={12.5}
              fontWeight={700}
              fontFamily={MONO}
            >
              {(p.bal > 0 ? "+" : "") + p.bal}
            </text>
          </g>
        );
      })}

      {gateGlyph(x(1), "open")}
      {gateGlyph(x(4), "closed")}

      {/* x-axis */}
      {points.map((p) => (
        <g key={`ax-${p.turn}`}>
          <text
            x={x(p.turn)}
            y={H - 32}
            textAnchor="middle"
            fill={C.muted}
            fontSize={12}
            fontFamily={MONO}
          >
            {p.turn === 0 ? "start" : `turn ${p.turn}`}
          </text>
          {p.cap ? (
            <text
              x={x(p.turn)}
              y={H - 16}
              textAnchor="middle"
              fill={C.gateInk}
              fontSize={10}
              fontFamily={MONO}
            >
              ◆ checkpoint
            </text>
          ) : null}
        </g>
      ))}

      {/* callouts */}
      <text
        x={x(1)}
        y={y(-4) + 42}
        textAnchor="middle"
        fill={C.greenInk}
        fontSize={11.5}
        fontFamily={MONO}
      >
        served ✓ (was ≥ 0 at the gate)
      </text>
      <text
        x={(x(2) + x(3)) / 2}
        y={y(-9) - 16}
        textAnchor="middle"
        fill={C.muted}
        fontSize={11.5}
        fontFamily={MONO}
      >
        no check · serve on credit
      </text>
      <text
        x={x(4)}
        y={y(-14) + 42}
        textAnchor="end"
        fill={C.redInk}
        fontSize={11.5}
        fontFamily={MONO}
      >
        blocked ✗ (below gate → 402)
      </text>
      <text
        x={x(4) - 14}
        y={y(TOPUP_BAL) + 3}
        textAnchor="end"
        fill={C.blue}
        fontSize={11.5}
        fontFamily={MONO}
      >
        top-up lifts back through gate
      </text>
    </svg>
  );
}

const CX0 = 200;
const CX1 = 946;
const CN = 6;
const cw = (CX1 - CX0) / CN;
const ccx = (i: number) => CX0 + (i - 0.5) * cw;

const lanes = [
  {
    y: 80,
    coinY: 114,
    title: "Normal x402",
    sub: "gate on every turn",
    checked: () => true,
    ours: false,
    tallyY: 140,
    tally: "6 gate checks · 6 settlements / 6 turns",
  },
  {
    y: 214,
    coinY: 248,
    title: "Our deferred gate",
    sub: "gate every TURN_CAP = 3",
    checked: (i: number) => i === 1 || i === 4,
    ours: true,
    tallyY: 274,
    tally:
      "2 gate checks · 2 settlements / 6 turns — about 3× fewer, and faster",
  },
] as const;

export function GateComparison() {
  return (
    <svg
      className="chart"
      viewBox="0 0 1000 300"
      role="img"
      aria-label="Normal x402 checks the gate and bills on all six turns. The deferred gate checks twice and bills twice across the same six turns."
    >
      <text
        x={14}
        y={22}
        fill={C.subtle}
        fontSize={10.5}
        fontFamily={MONO}
        letterSpacing="0.08em"
      >
        GATE CHECKS &amp; BILLING · 6 TURNS
      </text>
      <line
        x1={12}
        y1={154}
        x2={988}
        y2={154}
        stroke={C.grid}
        strokeWidth={1}
      />

      {lanes.map((lane) => (
        <g key={lane.title}>
          <text
            x={14}
            y={lane.y - 3}
            fill={C.ink}
            fontSize={13}
            fontWeight={700}
            fontFamily={MONO}
          >
            {lane.title}
          </text>
          <text
            x={14}
            y={lane.y + 15}
            fill={C.muted}
            fontSize={11}
            fontFamily={MONO}
          >
            {lane.sub}
          </text>

          <line
            x1={CX0}
            y1={lane.y}
            x2={CX1}
            y2={lane.y}
            stroke={C.grid}
            strokeWidth={2}
          />

          {Array.from({ length: CN }, (_, k) => k + 1).map((i) =>
            lane.ours && !lane.checked(i) ? (
              <line
                key={`flow-${i}`}
                x1={i === 1 ? CX0 : ccx(i - 1)}
                y1={lane.y}
                x2={ccx(i)}
                y2={lane.y}
                stroke={C.green}
                strokeWidth={2.5}
                opacity={0.8}
              />
            ) : null,
          )}

          {Array.from({ length: CN }, (_, k) => k + 1).map((i) => {
            const isChk = lane.checked(i);
            const bx = ccx(i) - 30;
            return (
              <g key={`turn-${i}`}>
                {isChk ? (
                  <>
                    <line
                      x1={bx}
                      y1={lane.y - 17}
                      x2={bx}
                      y2={lane.y + 17}
                      stroke={C.gate}
                      strokeWidth={2.5}
                    />
                    <line
                      x1={bx - 3.5}
                      y1={lane.y - 13}
                      x2={bx - 3.5}
                      y2={lane.y + 13}
                      stroke={C.gate}
                      strokeWidth={1}
                      opacity={0.55}
                    />
                    <circle
                      cx={ccx(i)}
                      cy={lane.coinY}
                      r={8}
                      fill={C.gate}
                      fillOpacity={0.14}
                      stroke={C.gate}
                      strokeWidth={1}
                    />
                    <text
                      x={ccx(i)}
                      y={lane.coinY + 3.6}
                      textAnchor="middle"
                      fill={C.gateInk}
                      fontSize={10}
                      fontWeight={700}
                      fontFamily={MONO}
                    >
                      $
                    </text>
                  </>
                ) : (
                  <text
                    x={ccx(i)}
                    y={lane.coinY + 3.6}
                    textAnchor="middle"
                    fill={C.greenInk}
                    fontSize={9.5}
                    fontFamily={MONO}
                    opacity={0.95}
                  >
                    no bill
                  </text>
                )}
                <circle
                  cx={ccx(i)}
                  cy={lane.y}
                  r={15}
                  fill={C.bg}
                  stroke={isChk ? C.gate : C.green}
                  strokeWidth={2}
                />
                <text
                  x={ccx(i)}
                  y={lane.y + 4}
                  textAnchor="middle"
                  fill={C.ink}
                  fontSize={12}
                  fontWeight={700}
                  fontFamily={MONO}
                >
                  {i}
                </text>
              </g>
            );
          })}

          <text
            x={CX0}
            y={lane.tallyY}
            fill={lane.ours ? C.greenInk : C.muted}
            fontSize={11.5}
            fontFamily={MONO}
          >
            {lane.tally}
          </text>
        </g>
      ))}
    </svg>
  );
}
