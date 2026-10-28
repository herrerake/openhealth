/**
 * One dot per run with a rolling average of the last 5 runs drawn through them. When lower is
 * better (pace, ground contact) the axis flips so better is always up.
 */
export default function TrendDots({ points, invert = false, label }: { points: number[]; invert?: boolean; label: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (points.length - 1)) * 96;
  const y = (v: number) => {
    const norm = (v - min) / span;
    return 4 + (invert ? norm : 1 - norm) * 36;
  };
  const rolling = points.map((_, i) => {
    const window = points.slice(Math.max(0, i - 4), i + 1);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="h-14 w-full" role="img" aria-label={`${label} across ${points.length} runs`}>
      {points.map((v, i) => (
        <ellipse key={i} cx={x(i)} cy={y(v)} rx={0.7} ry={1.4} className="fill-chart-1/35" />
      ))}
      <polyline
        fill="none"
        className="stroke-chart-1"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        points={rolling.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ")}
      />
    </svg>
  );
}
