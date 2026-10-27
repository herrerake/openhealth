import { describe, expect, it } from "vitest";
import { createUploadProgress } from "../../web/src/lib/progress";

describe("upload progress", () => {
  it("is measured on bytes read from the file, so a zip doesn't jump to the end", () => {
    const p = createUploadProgress(100);
    p.startPass();
    p.read(50);
    expect(p.percent()).toBe(25);
    p.read(50);
    expect(p.percent()).toBe(50);
    p.startPass();
    p.read(50);
    expect(p.percent()).toBe(75);
  });

  it("never claims 100% before the upload finishes", () => {
    const p = createUploadProgress(10);
    p.startPass();
    p.read(10);
    p.startPass();
    p.read(10);
    expect(p.percent()).toBe(99);
  });
});
