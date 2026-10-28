// Curated major-city time zones for the onboarding picker. Offsets and names come from Intl at runtime,
// so daylight saving is always current.

export interface Zone {
  id: string;
  city: string;
  country: string;
}

export const REGIONS: [string, Zone[]][] = [
  [
    "Americas",
    [
      ["Pacific/Honolulu", "Honolulu", "United States"],
      ["America/Anchorage", "Anchorage", "United States"],
      ["America/Los_Angeles", "Los Angeles", "United States"],
      ["America/Vancouver", "Vancouver", "Canada"],
      ["America/Tijuana", "Tijuana", "Mexico"],
      ["America/Phoenix", "Phoenix", "United States"],
      ["America/Denver", "Denver", "United States"],
      ["America/Mexico_City", "Mexico City", "Mexico"],
      ["America/Chicago", "Chicago", "United States"],
      ["America/Winnipeg", "Winnipeg", "Canada"],
      ["America/New_York", "New York", "United States"],
      ["America/Toronto", "Toronto", "Canada"],
      ["America/Bogota", "Bogotá", "Colombia"],
      ["America/Lima", "Lima", "Peru"],
      ["America/Caracas", "Caracas", "Venezuela"],
      ["America/Halifax", "Halifax", "Canada"],
      ["America/Puerto_Rico", "San Juan", "Puerto Rico"],
      ["America/Santiago", "Santiago", "Chile"],
      ["America/St_Johns", "St. John's", "Canada"],
      ["America/Sao_Paulo", "São Paulo", "Brazil"],
      ["America/Argentina/Buenos_Aires", "Buenos Aires", "Argentina"],
    ],
  ],
  [
    "Europe",
    [
      ["Atlantic/Reykjavik", "Reykjavík", "Iceland"],
      ["Europe/London", "London", "United Kingdom"],
      ["Europe/Dublin", "Dublin", "Ireland"],
      ["Europe/Lisbon", "Lisbon", "Portugal"],
      ["Europe/Madrid", "Madrid", "Spain"],
      ["Europe/Paris", "Paris", "France"],
      ["Europe/Brussels", "Brussels", "Belgium"],
      ["Europe/Amsterdam", "Amsterdam", "Netherlands"],
      ["Europe/Berlin", "Berlin", "Germany"],
      ["Europe/Zurich", "Zurich", "Switzerland"],
      ["Europe/Rome", "Rome", "Italy"],
      ["Europe/Vienna", "Vienna", "Austria"],
      ["Europe/Prague", "Prague", "Czechia"],
      ["Europe/Copenhagen", "Copenhagen", "Denmark"],
      ["Europe/Oslo", "Oslo", "Norway"],
      ["Europe/Stockholm", "Stockholm", "Sweden"],
      ["Europe/Warsaw", "Warsaw", "Poland"],
      ["Europe/Athens", "Athens", "Greece"],
      ["Europe/Helsinki", "Helsinki", "Finland"],
      ["Europe/Kyiv", "Kyiv", "Ukraine"],
      ["Europe/Istanbul", "Istanbul", "Türkiye"],
      ["Europe/Moscow", "Moscow", "Russia"],
    ],
  ],
  [
    "Africa & Middle East",
    [
      ["Africa/Casablanca", "Casablanca", "Morocco"],
      ["Africa/Lagos", "Lagos", "Nigeria"],
      ["Africa/Johannesburg", "Johannesburg", "South Africa"],
      ["Africa/Cairo", "Cairo", "Egypt"],
      ["Asia/Jerusalem", "Jerusalem", "Israel"],
      ["Africa/Nairobi", "Nairobi", "Kenya"],
      ["Asia/Riyadh", "Riyadh", "Saudi Arabia"],
      ["Asia/Tehran", "Tehran", "Iran"],
      ["Asia/Dubai", "Dubai", "United Arab Emirates"],
    ],
  ],
  [
    "Asia",
    [
      ["Asia/Karachi", "Karachi", "Pakistan"],
      ["Asia/Kolkata", "Mumbai, New Delhi", "India"],
      ["Asia/Kathmandu", "Kathmandu", "Nepal"],
      ["Asia/Dhaka", "Dhaka", "Bangladesh"],
      ["Asia/Bangkok", "Bangkok", "Thailand"],
      ["Asia/Ho_Chi_Minh", "Ho Chi Minh City", "Vietnam"],
      ["Asia/Jakarta", "Jakarta", "Indonesia"],
      ["Asia/Singapore", "Singapore", "Singapore"],
      ["Asia/Kuala_Lumpur", "Kuala Lumpur", "Malaysia"],
      ["Asia/Manila", "Manila", "Philippines"],
      ["Asia/Hong_Kong", "Hong Kong", "China"],
      ["Asia/Shanghai", "Beijing, Shanghai", "China"],
      ["Asia/Taipei", "Taipei", "Taiwan"],
      ["Asia/Seoul", "Seoul", "South Korea"],
      ["Asia/Tokyo", "Tokyo", "Japan"],
    ],
  ],
  [
    "Oceania",
    [
      ["Australia/Perth", "Perth", "Australia"],
      ["Australia/Adelaide", "Adelaide", "Australia"],
      ["Australia/Brisbane", "Brisbane", "Australia"],
      ["Australia/Sydney", "Sydney", "Australia"],
      ["Australia/Melbourne", "Melbourne", "Australia"],
      ["Pacific/Auckland", "Auckland", "New Zealand"],
      ["Pacific/Fiji", "Suva", "Fiji"],
    ],
  ],
  ["Universal", [["UTC", "Coordinated Universal Time", ""]]],
].map(([region, zones]) => [
  region as string,
  (zones as string[][]).map(([id, city, country]) => ({ id, city, country })),
]);

export const ALL_ZONES: Zone[] = REGIONS.flatMap(([, zones]) => zones);

/** A zone outside the curated list (the browser's own, say), labeled from its IANA id. */
export function zoneFromId(id: string): Zone {
  const known = ALL_ZONES.find((z) => z.id === id);
  if (known) return known;
  return { id, city: id.split("/").at(-1)!.replaceAll("_", " "), country: "" };
}

function part(id: string, timeZoneName: Intl.DateTimeFormatOptions["timeZoneName"], at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "GMT−5", "GMT+5:30", "GMT" — with a true minus sign for typographic alignment. */
export const offsetLabel = (id: string, at = new Date()) => part(id, "shortOffset", at).replace("-", "−") || "GMT";

/** "Central Time", "Central European Time". Falls back to the offset when Intl has no generic name. */
export const zoneName = (id: string, at = new Date()) => {
  const name = part(id, "longGeneric", at);
  return name && !name.startsWith("GMT") ? name : offsetLabel(id, at);
};

/** Minutes east of UTC, for sorting. */
export function offsetMinutes(id: string, at = new Date()): number {
  const m = offsetLabel(id, at).match(/GMT([+−])(\d+)(?::(\d+))?/);
  if (!m) return 0;
  return (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

export const localTime = (id: string, at = new Date()) => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: id, hour: "numeric", minute: "2-digit" }).format(at);
  } catch {
    return "";
  }
};
