/** Trend line over a benchmark's attempts. For times, lower is drawn higher (better is up). */
export default function Sparkline({ points, invert = false, className = "" }: { points: number[]; invert?: boolean; className?: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const norm = (p - min) / span;
    const y = 4 + (invert ? norm : 1 - norm) * 16;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={`h-6 text-chart-1 ${className || "w-24"}`} aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={coords.join(" ")} />
    </svg>
  );
}
