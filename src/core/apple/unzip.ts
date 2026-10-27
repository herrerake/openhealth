import { Unzip, UnzipInflate } from "fflate";

/** Streams `apple_health_export/export.xml` out of the Health app's export.zip. */
export async function* unzipExport(chunks: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  const out: Uint8Array[] = [];
  let found = false;
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (found || !/(^|\/)export\.xml$/.test(file.name)) return;
    found = true;
    file.ondata = (err, data) => {
      if (err) failure = err;
      else if (data.length) out.push(data);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  for await (const chunk of chunks) {
    unzip.push(chunk);
    if (failure) throw failure;
    while (out.length) yield out.shift()!;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  while (out.length) yield out.shift()!;
  if (!found) throw new Error("Apple Health export zip has no export.xml");
}
