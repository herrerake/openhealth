// Checks generated fixtures against the source shapes:
// WodUp against its published OpenAPI spec, Mindbody against the Visit model
// field list, Apple Health for well-formed XML.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(HERE, p), "utf8"));
let failed = false;

// WodUp
const spec = read("schemas/wodup-openapi.json");
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, "wodup");
const validateSessions = ajv.getSchema("wodup#/components/schemas/ListAthleteTrainingSessionsResponse");
const sessions = read("data/wodup/training_sessions.json");
if (validateSessions(sessions)) {
  console.log(`wodup: ${sessions.length} training sessions match the OpenAPI spec`);
} else {
  failed = true;
  console.error("wodup: schema errors", validateSessions.errors.slice(0, 10));
}

// Mindbody (no public machine-readable spec; field list from the v6 Visit model)
const VISIT_FIELDS = [
  "AppointmentGenderPreference", "AppointmentId", "AppointmentStatus", "ClassId", "ClientId",
  "EndDateTime", "Id", "LastModifiedDateTime", "LateCancelled", "LocationId", "MakeUp", "Name",
  "ServiceId", "ServiceName", "SignedIn", "StaffId", "StartDateTime", "WebSignup", "Action",
];
const { Visits } = read("data/mindbody/client_visits.json");
const badVisits = Visits.filter((v) => VISIT_FIELDS.some((f) => !(f in v)) || /Z|[+-]\d\d:\d\d$/.test(v.StartDateTime));
if (badVisits.length) {
  failed = true;
  console.error("mindbody: visits missing fields or carrying an offset", badVisits.map((v) => v.Id));
} else {
  console.log(`mindbody: ${Visits.length} visits have every Visit field and site-local times`);
}

// Apple Health
const xmlPath = join(HERE, "data/apple-health/export.xml");
try {
  execFileSync("xmllint", ["--noout", xmlPath]);
  console.log("apple-health: export.xml is well-formed");
} catch (e) {
  failed = true;
  console.error("apple-health: export.xml is not well-formed", e.stderr?.toString());
}

// Every Apple timestamp must carry the America/Chicago offset in effect at that instant.
const laOffset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "longOffset" });
const offsetAt = (ms) => {
  const name = laOffset.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName").value; // "GMT-07:00"
  return name.replace("GMT", "").replace(":", "");
};
let badOffsets = 0;
for (const [, local, off] of readFileSync(xmlPath, "utf8").matchAll(/Date="(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([+-]\d{4})"/g)) {
  const sign = off[0] === "-" ? -1 : 1;
  const ms = Date.parse(`${local.replace(" ", "T")}Z`) - sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3))) * 60_000;
  if (offsetAt(ms) !== off) badOffsets++;
}
if (badOffsets) {
  failed = true;
  console.error(`apple-health: ${badOffsets} timestamps carry the wrong UTC offset for America/Chicago`);
} else {
  console.log("apple-health: every timestamp carries the correct DST offset");
}

process.exit(failed ? 1 : 0);
