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
try {
  execFileSync("xmllint", ["--noout", join(HERE, "data/apple-health/export.xml")]);
  console.log("apple-health: export.xml is well-formed");
} catch (e) {
  failed = true;
  console.error("apple-health: export.xml is not well-formed", e.stderr?.toString());
}

process.exit(failed ? 1 : 0);
