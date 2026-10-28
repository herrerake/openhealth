// Display formatting shared by the API (tile display strings) and the web app.

export function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  const mmss = `${Math.floor((s % 3600) / 60)}:${String(s % 60).padStart(2, "0")}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss.padStart(5, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** AMRAP scores are stored as rounds plus the finished share of the next round (5.4). */
export const formatRounds = (rounds: number) => `${Math.round(rounds * 10) / 10} rounds`;

export const formatLoad = (lbs: number) => `${Math.round(lbs * 10) / 10} lb`;

export function formatSleep(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export const formatPercent = (share: number) => `${Math.round(share * 100)}%`;
