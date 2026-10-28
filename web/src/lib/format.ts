import { formatLoad, formatRounds, formatTime } from "../../../src/core/format";

export { formatLoad, formatPercent, formatRounds, formatSleep, formatTime } from "../../../src/core/format";

/** A benchmark value in its own unit: times as h:mm:ss, AMRAPs in rounds, lifts in pounds. */
export const formatBenchmark = (unit: string, v: number) => (unit === "s" ? formatTime(v) : unit === "rounds" ? formatRounds(v) : formatLoad(v));
