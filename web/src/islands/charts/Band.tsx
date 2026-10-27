/** Recent daily values against the athlete's own normal range (shaded). Missing days break the line. */
export default function Band({ points, low, high }: { points: (number | null)[]; low: number; high: number }) {
  const values = points.filter((p): p is number => p != null);
  const min = Math.min(low, ...values) - 1;
  const max = Math.max(high, ...values) + 1;
  const y = (v: number) => 22 - ((v - min) / (max - min || 1)) * 20;
  const step = 100 / Math.max(points.length - 1, 1);
  const segments: string[][] = [[]];
  points.forEach((p, i) => {
    if (p == null) segments.push([]);
    else segments.at(-1)!.push(`${(i * step).toFixed(2)},${y(p).toFixed(2)}`);
  });
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
      <rect x="0" width="100" y={y(high)} height={Math.max(y(low) - y(high), 0.5)} className="fill-chart-1/15" />
      {segments
        .filter((s) => s.length > 1)
        .map((s, i) => (
          <polyline key={i} fill="none" className="stroke-chart-1" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={s.join(" ")} />
        ))}
    </svg>
  );
}
