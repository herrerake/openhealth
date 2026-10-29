import { useState } from "react";

export interface BlockPoint {
  block: number;
  value: number;
  display: string;
}

/**
 * One dot per block for the same week's session, joined by a thin line, the current block filled.
 * Hovering or focusing a dot names its block and score; the axis starts at the lowest score, not zero.
 */
export default function BlockDots({ points, current, label }: { points: BlockPoint[]; current: number; label: string }) {
  const [hover, setHover] = useState<BlockPoint | null>(null);
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const x = (i: number) => 4 + (i / (points.length - 1)) * 92;
  const y = (v: number) => 6 + (1 - (v - min) / span) * 30;
  const shown = hover ?? points.at(-1)!;
  return (
    <div className="grid gap-1">
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" className="h-16 w-full overflow-visible" role="img" aria-label={`${label}, block ${points[0].block} to ${points.at(-1)!.block}`}>
        <polyline
          fill="none"
          className="stroke-chart-1/60"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          points={points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ")}
        />
        {points.map((p, i) => (
          <g
            key={p.block}
            tabIndex={0}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p)}
            onBlur={() => setHover(null)}
            className="outline-none"
          >
            <title>{`Block ${p.block}: ${p.display}`}</title>
            {/* The hit target is wider than the dot. */}
            <rect x={x(i) - 46 / points.length} y={0} width={92 / points.length} height={42} fill="transparent" />
            <ellipse
              cx={x(i)}
              cy={y(p.value)}
              rx={p.block === current || hover?.block === p.block ? 1.6 : 1.1}
              ry={p.block === current || hover?.block === p.block ? 3.2 : 2.2}
              className={p.block === current ? "fill-chart-1 stroke-card" : "fill-card stroke-chart-1"}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
        <span>Block {points[0].block}</span>
        <span className="text-foreground">
          Block {shown.block}: {shown.display}
        </span>
        <span>Block {points.at(-1)!.block}</span>
      </div>
    </div>
  );
}
