import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { paginateMindbody, paginateWodup } from "../../src/worker/mock/paginate";
import { ROOT, ensureGenerated, readSessions, readVisits } from "./fixture-helpers";

let sessions: any[];
let visits: any[];
let validateSessions: (x: unknown) => boolean;

beforeAll(() => {
  ensureGenerated();
  sessions = readSessions();
  visits = readVisits();
  const spec = JSON.parse(readFileSync(join(ROOT, "fixtures/schemas/wodup-openapi.json"), "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(spec, "wodup");
  validateSessions = ajv.getSchema("wodup#/components/schemas/ListAthleteTrainingSessionsResponse")!;
});

describe("WodUp mock pagination", () => {
  it("walks every WodUp page newest-first", () => {
    let cursor: string | undefined;
    const seen: string[] = [];
    do {
      const { body } = paginateWodup(sessions, { limit: 100, after_cursor: cursor }) as any;
      seen.push(...body.map((s: any) => s.id));
      cursor = body.at(-1)?.id;
    } while (cursor && seen.length < sessions.length);
    expect(seen).toEqual(sessions.map((s: any) => s.id));
  });

  it("defaults to 10 per page", () => {
    expect((paginateWodup(sessions, {}).body as any[]).length).toBe(10);
  });

  it("rejects limit > 100", () => expect(paginateWodup(sessions, { limit: 101 }).status).toBe(400));

  it("rejects an unknown cursor", () => expect(paginateWodup(sessions, { after_cursor: "s_nope" }).status).toBe(400));

  it("returns an empty page after the last item", () => {
    expect(paginateWodup(sessions, { after_cursor: sessions.at(-1).id }).body).toEqual([]);
  });

  it("WodUp pages validate against the OpenAPI spec", () => {
    expect(validateSessions(paginateWodup(sessions, { limit: 100 }).body)).toBe(true);
  });
});

describe("Mindbody mock pagination", () => {
  it("Mindbody offset pagination reports totals", () => {
    const { body } = paginateMindbody(visits, { limit: 200, offset: 200 });
    expect(body.PaginationResponse).toEqual({
      RequestedLimit: 200,
      RequestedOffset: 200,
      PageSize: Math.min(200, visits.length - 200),
      TotalResults: visits.length,
    });
  });

  it("Mindbody filters by date range on local StartDateTime", () => {
    const { body } = paginateMindbody(visits, { startDate: "2026-10-01", endDate: "2026-10-07" });
    expect(body.Visits.length).toBeGreaterThan(0);
    expect(body.Visits.every((v: any) => v.StartDateTime >= "2026-10-01" && v.StartDateTime < "2026-10-08")).toBe(true);
  });

  it("rejects limit > 200", () => expect(paginateMindbody(visits, { limit: 201 }).status).toBe(400));
});
