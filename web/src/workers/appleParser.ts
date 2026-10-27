// Web Worker: parses an Apple Health export on the athlete's device and streams normalized
// batches back to the page. Raw heart-rate samples never leave the device (D-025).
import { parseAppleExport } from "../../../src/core/apple/parse";
import { unzipExport } from "../../../src/core/apple/unzip";
import type { SourceRecordInput } from "../../../src/core/types";
import { createUploadProgress } from "../lib/progress";

export type ParserMessage =
  | { type: "progress"; percent: number }
  | { type: "batch"; records: SourceRecordInput[] }
  | { type: "done"; records: number; ms: number }
  | { type: "error"; message: string };

const NOT_AN_EXPORT = "That isn't an Apple Health export. On your iPhone: Health → profile → Export All Health Data.";

// A reader loop rather than `for await` over the stream: Safari doesn't iterate ReadableStreams.
async function* readChunks(file: File, onRead: (bytes: number) => void): AsyncIterable<Uint8Array> {
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onRead(value.length);
    yield value;
  }
}

const post = (m: ParserMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<{ type: "parse"; file: File }>) => {
  const { file } = e.data;
  const started = performance.now();
  const progress = createUploadProgress(file.size);
  let lastPercent = -1;
  const onRead = (bytes: number) => {
    progress.read(bytes);
    const percent = progress.percent();
    if (percent !== lastPercent) post({ type: "progress", percent: (lastPercent = percent) });
  };
  // The parser opens the file once per pass.
  const open = () => {
    progress.startPass();
    const chunks = readChunks(file, onRead);
    return file.name.toLowerCase().endsWith(".zip") ? unzipExport(chunks) : chunks;
  };
  let records = 0;
  try {
    for await (const batch of parseAppleExport(open, { batchSize: 1000 })) {
      records += batch.length;
      post({ type: "batch", records: batch });
    }
    if (!records) throw new Error("no Health records");
    post({ type: "done", records, ms: performance.now() - started });
  } catch {
    post({ type: "error", message: NOT_AN_EXPORT });
  }
};
