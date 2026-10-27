/**
 * Upload progress for the two-pass Apple parser, measured on bytes read from the file itself.
 * (The parser reports decompressed XML bytes, which for an iPhone export.zip are 10–20× the file size.)
 */
export function createUploadProgress(fileSize: number) {
  let pass = 0;
  let read = 0;
  return {
    startPass() {
      pass++;
      read = 0;
    },
    read(bytes: number) {
      read += bytes;
    },
    percent(): number {
      const within = Math.min(read / Math.max(fileSize, 1), 1);
      return Math.min(99, Math.round((Math.max(pass, 1) - 1) * 50 + within * 50));
    },
  };
}
