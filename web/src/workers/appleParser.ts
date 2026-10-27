// Web Worker: parses an Apple Health export on the athlete's device and streams normalized
// batches back to the page. Raw heart-rate samples never leave the device (D-025).
import { parseAppleExport } from "../../../src/core/apple/parse";
import { unzipExport } from "../../../src/core/apple/unzip";
import type { SourceRecordInput } from "../../../src/core/types";

export type ParserMessage =
  | { type: "progress"; percent: number }
  | { type: "batch"; records: SourceRecordInput[] }
  | { type: "done"; records: number; ms: number }
  | { type: "error"; message: string };

const NOT_AN_EXPORT = "That isn't an Apple Health export. On your iPhone: Health → profile → Export All Health Data.";

// A reader loop rather than `for await` over the stream: Safari doesn't iterate ReadableStreams.
async function* readChunks(file: File): AsyncIterable<Uint8Array> {
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

const post = (m: ParserMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<{ type: "parse"; file: File }>) => {
  const { file } = e.data;
  const started = performance.now();
  const open = () => (file.name.toLowerCase().endsWith(".zip") ? unzipExport(readChunks(file)) : readChunks(file));
  let records = 0;
  let lastPercent = -1;
  try {
    for await (const batch of parseAppleExport(open, {
      batchSize: 1000,
      onProgress: ({ pass, bytes }) => {
        const percent = Math.min(99, Math.round(((pass - 1) * 50 + (bytes / Math.max(file.size, 1)) * 50)));
        if (percent !== lastPercent) post({ type: "progress", percent: (lastPercent = percent) });
      },
    })) {
      records += batch.length;
      post({ type: "batch", records: batch });
    }
    if (!records) throw new Error("no Health records");
    post({ type: "done", records, ms: performance.now() - started });
  } catch {
    post({ type: "error", message: NOT_AN_EXPORT });
  }
};
