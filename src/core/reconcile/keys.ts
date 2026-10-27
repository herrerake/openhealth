/** Stable identity of a reconciled session (and of a decision about it): its primary source keys, sorted. */
export function scopeKey(recordNaturalKeys: string[]): string {
  return [...recordNaturalKeys].sort().join("+");
}
