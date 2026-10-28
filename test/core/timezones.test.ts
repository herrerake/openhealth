import { describe, expect, it } from "vitest";
import { ALL_ZONES, localTime, offsetLabel, offsetMinutes, zoneFromId, zoneName } from "../../web/src/lib/timezones";

const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("time zone picker helpers", () => {
  it("labels offsets with a true minus sign and follows daylight saving", () => {
    expect(offsetLabel("America/Chicago", WINTER)).toBe("GMT−6");
    expect(offsetLabel("America/Chicago", SUMMER)).toBe("GMT−5");
    expect(offsetLabel("Europe/London", WINTER)).toBe("GMT");
    expect(offsetLabel("Europe/London", SUMMER)).toBe("GMT+1");
  });

  it("parses whole, half-hour and quarter-hour offsets into minutes", () => {
    expect(offsetMinutes("America/Chicago", WINTER)).toBe(-360);
    expect(offsetMinutes("America/Chicago", SUMMER)).toBe(-300);
    expect(offsetMinutes("America/St_Johns", WINTER)).toBe(-210);
    expect(offsetMinutes("Asia/Kolkata", WINTER)).toBe(330);
    expect(offsetMinutes("Asia/Kathmandu", WINTER)).toBe(345);
    expect(offsetMinutes("UTC", WINTER)).toBe(0);
    expect(offsetMinutes("Europe/London", WINTER)).toBe(0);
  });

  it("names zones generically, falling back to the offset", () => {
    expect(zoneName("America/Chicago", SUMMER)).toBe("Central Time");
    expect(zoneName("UTC", WINTER)).toMatch(/^(Coordinated Universal Time|GMT)$/);
  });

  it("shows local time in the zone", () => {
    // ICU versions differ on the space before AM/PM (regular or narrow no-break).
    expect(localTime("Asia/Tokyo", new Date("2026-01-15T00:00:00Z")).replace(/\s/g, " ")).toBe("9:00 AM");
  });

  it("degrades instead of throwing on an unknown zone", () => {
    expect(offsetLabel("Not/AZone", WINTER)).toBe("GMT");
    expect(offsetMinutes("Not/AZone", WINTER)).toBe(0);
    expect(localTime("Not/AZone", WINTER)).toBe("");
  });

  it("labels a zone outside the curated list from its IANA id", () => {
    expect(zoneFromId("America/Chicago")).toEqual({ id: "America/Chicago", city: "Chicago", country: "United States" });
    expect(zoneFromId("America/Argentina/San_Luis")).toEqual({ id: "America/Argentina/San_Luis", city: "San Luis", country: "" });
  });

  it("lists only unique zones this runtime recognizes", () => {
    expect(new Set(ALL_ZONES.map((z) => z.id)).size).toBe(ALL_ZONES.length);
    for (const z of ALL_ZONES) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z.id }), z.id).not.toThrow();
  });
});
