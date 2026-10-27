// Display formatting shared by the API (tile display strings) and the web app.

export function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const formatLoad = (lbs: number) => `${Math.round(lbs * 10) / 10} lb`;

export function formatSleep(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export const formatPercent = (share: number) => `${Math.round(share * 100)}%`;
